import { PortError } from '../domain/errors.ts';
import type { LearnerContext } from '../domain/learner.ts';
import type { PedagogicalPolicy } from '../domain/policy.ts';
import type { ToolCallRecord } from '../domain/tool-audit.ts';
import { schemaViolation, unsupportedSchema } from '../domain/tool-schema.ts';
import type { ToolCall, ToolCallOutcome, ToolDefinition, ToolExclusion, ToolGrant, ToolPolicy, ToolRefusalReason, ToolSession } from '../domain/tools.ts';
import type { Clock } from '../ports/driven/clock.ts';
import { NO_TELEMETRY, type Span, type Telemetry } from '../ports/driven/telemetry.ts';
import type { ToolAudit } from '../ports/driven/tool-audit.ts';
import type { ToolHost, ToolHostResult } from '../ports/driven/tool-host.ts';
import { traced } from './traced.ts';

export interface ToolHarnessDeps {
  readonly host: ToolHost;
  readonly audit: ToolAudit;
  readonly clock: Clock;
  readonly telemetry?: Telemetry;
  /** Recorded as the source of every audit record. */
  readonly source: string;
}

/** The exchange tools are opened for: who is asking, under which policy. */
export interface ToolExchange {
  readonly learner: LearnerContext;
  readonly policy: PedagogicalPolicy;
}

/** The longest server or tool name the audit keeps from a call the model made up. */
const MAX_AUDITED_NAME = 200;

/** A policy that grants nothing: every call is refused as not granted. */
const NO_TOOLS: ToolPolicy = {
  grants: [],
  maxCalls: Infinity,
  callTimeoutMs: 0,
  exchangeBudgetMs: 0,
  maxArgumentChars: 0,
  maxResultChars: 0,
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The only way the platform reaches a tool (docs/adr/0008). It offers a model
 * only the tools its policy grants, pinned to the reviewed definition, and
 * checks every call against the grant, the exchange's budget and the tool's
 * input schema before it leaves the platform. Every attempt is audited.
 * Spec: packages/core/spec/services/tool-harness.ears.md.
 */
export class ToolHarness {
  readonly #deps: ToolHarnessDeps;
  readonly #telemetry: Telemetry;

  constructor(deps: ToolHarnessDeps) {
    this.#deps = deps;
    this.#telemetry = deps.telemetry ?? NO_TELEMETRY;
  }

  /** Opens the tools for one exchange. `parent` is the exchange's span; listing and every call are traced under it. */
  async open(exchange: ToolExchange, parent?: Span): Promise<ToolSession> {
    const span = this.#telemetry.startSpan('ToolHarness.open', { 'policy.version': exchange.policy.version }, parent);
    try {
      const session = await this.#open(exchange, span, parent);
      span.setAttribute('tools.offered', session.tools.length);
      span.setAttribute('tools.excluded', session.excluded.map((e) => `${e.server}/${e.tool}:${e.reason}`).join(','));
      span.end('ok');
      return session;
    } catch (error) {
      span.end('error');
      throw error;
    }
  }

  async #open(exchange: ToolExchange, span: Span, parent: Span | undefined): Promise<ToolSession> {
    // HAR-001: with no tool policy there are no grants, so no server is listed.
    const policy = exchange.policy.tools ?? NO_TOOLS;
    const openedAt = this.#now();
    const tools: ToolDefinition[] = [];
    const excluded: ToolExclusion[] = [];
    const servers = [...new Set(policy.grants.map((g) => g.server))];
    for (const server of servers) {
      const grants = policy.grants.filter((g) => g.server === server);
      // HAR-002
      let offered: readonly ToolDefinition[];
      try {
        const timeoutMs = Math.min(policy.callTimeoutMs, this.#remaining(policy, openedAt));
        offered = await traced(this.#telemetry, span, 'ToolHost.listTools', () => this.#deps.host.listTools(server, timeoutMs));
      } catch (error) {
        if (!PortError.is(error)) throw error;
        excluded.push(...grants.map((g) => ({ server, tool: g.tool, reason: 'server-unavailable' as const })));
        continue;
      }
      for (const grant of grants) {
        // HAR-003
        const decided = admit(grant, offered.filter((d) => d.server === server && d.name === grant.tool));
        if ('reason' in decided) excluded.push(decided);
        else tools.push(decided);
      }
    }
    return this.#session(exchange, parent, policy, tools, excluded, openedAt);
  }

  #session(
    exchange: ToolExchange,
    parent: Span | undefined,
    policy: ToolPolicy,
    tools: readonly ToolDefinition[],
    excluded: readonly ToolExclusion[],
    openedAt: number,
  ): ToolSession {
    let attempts = 0;
    return {
      tools,
      excluded,
      call: async (call) => {
        attempts += 1;
        return this.#call(exchange, parent, policy, tools, attempts, openedAt, call);
      },
    };
  }

  async #call(
    exchange: ToolExchange,
    parent: Span | undefined,
    policy: ToolPolicy,
    tools: readonly ToolDefinition[],
    attempt: number,
    openedAt: number,
    call: ToolCall,
  ): Promise<ToolCallOutcome> {
    const tool = tools.find((t) => t.server === call.server && t.name === call.name);
    // Names the model made up are its text, which spans never carry; granted names are policy data.
    const span = this.#telemetry.startSpan('ToolHarness.call', tool === undefined ? {} : { 'tool.server': tool.server, 'tool.name': tool.name }, parent);
    const startedAt = this.#now();
    const serialised = serialise(call.arguments);
    try {
      const [outcome, resultChars] = await this.#decide(policy, tool, attempt, openedAt, call, serialised, span);
      span.setAttribute('tool.outcome', outcome.kind);
      if (outcome.kind === 'refused') span.setAttribute('tool.refusal', outcome.reason);
      if (outcome.kind === 'failed') span.setAttribute('port.error', outcome.error);
      // HAR-013, HAR-014
      const record = this.#record(exchange, call, tool, outcome, serialised?.length ?? 0, resultChars, startedAt);
      await traced(this.#telemetry, span, 'ToolAudit.append', () => this.#deps.audit.append(record));
      span.end('ok');
      return outcome;
    } catch (error) {
      span.end('error');
      throw error;
    }
  }

  /** The outcome of one attempt, and how many characters of text the tool returned. */
  async #decide(
    policy: ToolPolicy,
    tool: ToolDefinition | undefined,
    attempt: number,
    openedAt: number,
    call: ToolCall,
    serialised: string | undefined,
    span: Span,
  ): Promise<readonly [ToolCallOutcome, number]> {
    // HAR-008
    if (attempt > policy.maxCalls) return refuse('budget-exhausted', `no more than ${policy.maxCalls} tool calls per exchange`);
    // HAR-007
    if (tool === undefined) return refuse('not-granted', `${String(call.server)}/${String(call.name)} is not available in this exchange`);
    // HAR-009
    const remaining = this.#remaining(policy, openedAt);
    if (remaining <= 0) return refuse('budget-exhausted', 'the time for tools in this exchange has run out');
    // HAR-010: what is checked is a JSON copy, and the copy is what is sent.
    const args: unknown = serialised === undefined ? undefined : JSON.parse(serialised);
    if (!isRecord(args)) return refuse('invalid-arguments', 'arguments must be a JSON object');
    if ((serialised as string).length > policy.maxArgumentChars) {
      return refuse('invalid-arguments', `arguments must be at most ${policy.maxArgumentChars} characters of JSON`);
    }
    const violation = schemaViolation(tool.inputSchema, args);
    if (violation !== null) return refuse('invalid-arguments', violation);
    // HAR-011
    let result: ToolHostResult;
    try {
      result = await traced(this.#telemetry, span, 'ToolHost.callTool', () =>
        this.#deps.host.callTool({ server: tool.server, name: tool.name, arguments: args, timeoutMs: Math.min(policy.callTimeoutMs, remaining) }),
      );
    } catch (error) {
      if (PortError.is(error)) return [{ kind: 'failed', error: error.kind }, 0];
      throw error;
    }
    // HAR-012
    const truncated = result.text.length > policy.maxResultChars;
    const outcome: ToolCallOutcome = {
      kind: 'result',
      text: truncated ? result.text.slice(0, policy.maxResultChars) : result.text,
      isError: result.isError,
      truncated,
      omittedParts: result.omittedParts,
    };
    return [outcome, result.text.length];
  }

  #record(
    exchange: ToolExchange,
    call: ToolCall,
    tool: ToolDefinition | undefined,
    outcome: ToolCallOutcome,
    argumentChars: number,
    resultChars: number,
    startedAt: number,
  ): ToolCallRecord {
    const { learner, policy } = exchange;
    return {
      learnerId: learner.learnerId,
      sessionId: learner.sessionId,
      courseId: learner.courseId,
      policyId: policy.id,
      policyVersion: policy.version,
      server: String(call.server).slice(0, MAX_AUDITED_NAME),
      tool: String(call.name).slice(0, MAX_AUDITED_NAME),
      ...(tool === undefined ? {} : { digest: tool.digest }),
      outcome: outcome.kind,
      ...(outcome.kind === 'refused' ? { reason: outcome.reason } : {}),
      ...(outcome.kind === 'failed' ? { reason: outcome.error } : {}),
      ...(outcome.kind === 'result' ? { isError: outcome.isError } : {}),
      argumentChars,
      resultChars,
      elapsedMs: this.#now() - startedAt,
      calledAt: new Date(startedAt),
      source: this.#deps.source,
    };
  }

  #now(): number {
    return this.#deps.clock.now().getTime();
  }

  #remaining(policy: ToolPolicy, openedAt: number): number {
    return policy.exchangeBudgetMs - (this.#now() - openedAt);
  }
}

/** HAR-004, HAR-005, HAR-006: a granted tool is offered only as pinned, read-only and enforceable. */
function admit(grant: ToolGrant, named: readonly ToolDefinition[]): ToolDefinition | ToolExclusion {
  const exclude = (reason: ToolExclusion['reason']): ToolExclusion => ({ server: grant.server, tool: grant.tool, reason });
  if (named.length === 0) return exclude('not-offered');
  const pinned = named.find((d) => d.digest === grant.digest);
  if (pinned === undefined) return exclude('definition-changed');
  if (!pinned.readOnly) return exclude('not-read-only');
  if (pinned.inputSchema['type'] !== 'object' || unsupportedSchema(pinned.inputSchema) !== null) return exclude('unsupported-schema');
  return pinned;
}

function refuse(reason: ToolRefusalReason, detail: string): readonly [ToolCallOutcome, number] {
  return [{ kind: 'refused', reason, detail }, 0];
}

/** The arguments as JSON, or undefined when they cannot be serialised. */
function serialise(value: unknown): string | undefined {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    // Cyclic, or holding a BigInt: not JSON, so refused as invalid arguments.
  }
  return json;
}
