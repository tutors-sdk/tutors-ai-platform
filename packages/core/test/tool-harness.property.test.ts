import {
  aGrant,
  aLearner,
  aPolicy,
  aToolPolicy,
  assertProperty,
  expectCounterexample,
  FakeToolHost,
  FixedClock,
  InMemoryToolAudit,
  type FakeTool,
} from '@tutors-ai/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PortError,
  ToolHarness,
  type Clock,
  type ToolAudit,
  type ToolCall,
  type ToolCallOutcome,
  type ToolDefinition,
  type ToolExchange,
  type ToolHost,
  type ToolPolicy,
  type ToolSession,
} from '../src/index.ts';

const CALL_TIMEOUT_MS = 3_000;
const BUDGET_MS = 10_000;

const SEARCH: FakeTool = {
  name: 'search',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  run: () => ({ text: 'found' }),
};

/** One step the model might take: a call, and what the server and the clock do meanwhile. */
interface Step {
  readonly granted: boolean;
  readonly valid: boolean;
  /** The server fails the call as unavailable. */
  readonly serverFails: boolean;
  /** Time that passes before the call. */
  readonly idleMs: number;
  /** Time the server takes, if called. */
  readonly serverMs: number;
}

const steps = fc.array(
  fc.record({
    granted: fc.boolean(),
    valid: fc.boolean(),
    serverFails: fc.boolean(),
    idleMs: fc.nat({ max: 3_000 }),
    serverMs: fc.nat({ max: 3_000 }),
  }),
  { maxLength: 12 },
);

const callFor = (step: Step): ToolCall => ({
  server: 'docs',
  name: step.granted ? 'search' : 'admin',
  arguments: step.valid ? { query: 'loops' } : { query: 1 },
});

/** What the specification says each step's outcome is (HAR-007 to HAR-011), and whether the server is called. */
function expected(maxCalls: number, run: readonly Step[]): { outcome: ToolCallOutcome['kind'] | ToolCallOutcome; timeoutMs?: number }[] {
  let elapsed = 0;
  return run.map((step, i) => {
    elapsed += step.idleMs;
    const refused = (reason: string) => ({ outcome: { kind: 'refused', reason } as unknown as ToolCallOutcome });
    if (i + 1 > maxCalls) return refused('budget-exhausted');
    if (!step.granted) return refused('not-granted');
    const remaining = BUDGET_MS - elapsed;
    if (remaining <= 0) return refused('budget-exhausted');
    if (!step.valid) return refused('invalid-arguments');
    elapsed += step.serverMs;
    return { outcome: step.serverFails ? 'failed' : 'result', timeoutMs: Math.min(CALL_TIMEOUT_MS, remaining) };
  });
}

interface Deps {
  readonly host: ToolHost;
  readonly audit: ToolAudit;
  readonly clock: Clock;
}

type Opener = (deps: Deps, exchange: ToolExchange) => Promise<ToolSession>;

const real: Opener = (deps, exchange) => new ToolHarness({ ...deps, source: 'property' }).open(exchange);

/**
 * Drives `open` and the model with the same steps and requires them to agree:
 * every outcome, which calls reached the server and with what timeout, and one
 * audit record per call.
 */
function agreesWithModel(open: Opener) {
  return fc.asyncProperty(fc.integer({ min: 1, max: 6 }), steps, async (maxCalls, run) => {
    const fake = new FakeToolHost({ docs: [SEARCH, { name: 'admin' }] });
    const clock = new FixedClock();
    const audit = new InMemoryToolAudit();
    let current: Step | undefined;
    const timeouts: number[] = [];
    const host: ToolHost = {
      listTools: (server, timeoutMs) => fake.listTools(server, timeoutMs),
      callTool: async (call) => {
        timeouts.push(call.timeoutMs);
        clock.advance(current?.serverMs ?? 0);
        if (current?.serverFails === true) throw new PortError('ToolHost', 'unavailable', 'down');
        return fake.callTool(call);
      },
    };
    const policy: ToolPolicy = aToolPolicy({ grants: [aGrant(fake.definition('docs', 'search'))], maxCalls, callTimeoutMs: CALL_TIMEOUT_MS, exchangeBudgetMs: BUDGET_MS });
    const session = await open({ host, audit, clock }, { learner: aLearner(), policy: aPolicy({ tools: policy }) });
    const outcomes: unknown[] = [];
    for (const step of run) {
      current = step;
      clock.advance(step.idleMs);
      const outcome = await session.call(callFor(step));
      outcomes.push(outcome.kind === 'refused' ? { kind: 'refused', reason: outcome.reason } : outcome.kind);
    }
    const model = expected(maxCalls, run);
    expect(outcomes).toEqual(model.map((m) => m.outcome));
    expect(audit.all.map((r) => r.outcome)).toEqual(model.map((m) => (typeof m.outcome === 'string' ? m.outcome : m.outcome.kind)));
    expect(timeouts).toEqual(model.flatMap((m) => (m.timeoutMs === undefined ? [] : [m.timeoutMs])));
  });
}

/** A harness written the obvious way, with one flaw each, for the property to catch. */
function flawed(flaw: 'counts-only-served-calls' | 'ignores-budget-time' | 'calls-before-validating' | 'audits-only-served-calls'): Opener {
  return async ({ host, audit, clock }, exchange) => {
    const policy = exchange.policy.tools as ToolPolicy;
    const tools: ToolDefinition[] = (await host.listTools('docs', CALL_TIMEOUT_MS)).filter((d) => d.name === 'search');
    const openedAt = clock.now().getTime();
    let attempts = 0;
    let served = 0;
    return {
      tools,
      excluded: [],
      call: async (call) => {
        attempts += 1;
        const decide = async (): Promise<ToolCallOutcome> => {
          const counted = flaw === 'counts-only-served-calls' ? served + 1 : attempts;
          if (counted > policy.maxCalls) return { kind: 'refused', reason: 'budget-exhausted', detail: '' };
          if (call.name !== 'search') return { kind: 'refused', reason: 'not-granted', detail: '' };
          const remaining = BUDGET_MS - (clock.now().getTime() - openedAt);
          if (flaw !== 'ignores-budget-time' && remaining <= 0) return { kind: 'refused', reason: 'budget-exhausted', detail: '' };
          const valid = typeof (call.arguments as { query?: unknown }).query === 'string';
          if (flaw !== 'calls-before-validating' && !valid) return { kind: 'refused', reason: 'invalid-arguments', detail: '' };
          served += 1;
          const timeoutMs = flaw === 'ignores-budget-time' ? CALL_TIMEOUT_MS : Math.min(CALL_TIMEOUT_MS, remaining);
          try {
            const result = await host.callTool({ server: 'docs', name: 'search', arguments: call.arguments as Record<string, unknown>, timeoutMs });
            if (!valid) return { kind: 'refused', reason: 'invalid-arguments', detail: '' };
            return { kind: 'result', text: result.text, isError: result.isError, truncated: false, omittedParts: 0 };
          } catch {
            return { kind: 'failed', error: 'unavailable' };
          }
        };
        const outcome = await decide();
        if (flaw !== 'audits-only-served-calls' || outcome.kind !== 'refused') {
          await audit.append({ ...aRecord(exchange), tool: call.name, outcome: outcome.kind });
        }
        return outcome;
      },
    };
  };
}

const aRecord = (exchange: ToolExchange) => ({
  learnerId: exchange.learner.learnerId,
  sessionId: exchange.learner.sessionId,
  courseId: exchange.learner.courseId,
  policyId: exchange.policy.id,
  policyVersion: exchange.policy.version,
  server: 'docs',
  argumentChars: 0,
  resultChars: 0,
  elapsedMs: 0,
  calledAt: new Date(0),
  source: 'flawed',
});

describe('ToolHarness against a model of its budget, grant and validation rules', () => {
  it('HAR-008 HAR-009 HAR-010 HAR-013 agrees with the model for any sequence of calls, server failures and delays', async () => {
    await assertProperty(agreesWithModel(real));
  });

  for (const flaw of ['counts-only-served-calls', 'ignores-budget-time', 'calls-before-validating', 'audits-only-served-calls'] as const) {
    it(`finds a counterexample against a harness that ${flaw.replaceAll('-', ' ')}`, async () => {
      await expectCounterexample(agreesWithModel(flawed(flaw)));
    });
  }
});
