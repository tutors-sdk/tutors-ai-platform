import { createHash } from 'node:crypto';
import {
  canonicalToolDefinition,
  PortError,
  type ToolDefinition,
  type ToolGrant,
  type ToolHost,
  type ToolHostCall,
  type ToolHostResult,
  type ToolPolicy,
} from '@tutors-ai/core';

/** `sha256:<hex>` of a definition's canonical form: the digest every ToolHost must give (TH-002). */
export function toolDigest(definition: Omit<ToolDefinition, 'server' | 'digest'>): string {
  return `sha256:${createHash('sha256').update(canonicalToolDefinition(definition)).digest('hex')}`;
}

export interface FakeTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly readOnly?: boolean;
  /** Builds the result; by default the tool answers with its arguments as JSON. */
  readonly run?: (args: Readonly<Record<string, unknown>>) => Partial<ToolHostResult>;
  /** Simulated latency; a call whose timeout is shorter fails with a timeout PortError. */
  readonly latencyMs?: number;
}

/** The definition a server would list for `tool`, digest included. */
export function aToolDefinition(server: string, tool: FakeTool): ToolDefinition {
  const definition = {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description ?? `The ${tool.name} tool.`,
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    readOnly: tool.readOnly ?? true,
  };
  return { server, ...definition, digest: toolDigest(definition) };
}

/** A grant for exactly this definition. */
export function aGrant(definition: ToolDefinition): ToolGrant {
  return { server: definition.server, tool: definition.name, digest: definition.digest };
}

export function aToolPolicy(overrides: Partial<ToolPolicy> = {}): ToolPolicy {
  return {
    grants: [],
    maxCalls: 4,
    callTimeoutMs: 2_000,
    exchangeBudgetMs: 10_000,
    maxArgumentChars: 2_000,
    maxResultChars: 4_000,
    ...overrides,
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scripted tool servers. Records every listing and call so tests can see what reached a server. */
export class FakeToolHost implements ToolHost {
  readonly listings: { readonly server: string; readonly timeoutMs: number }[] = [];
  readonly calls: ToolHostCall[] = [];
  /** Servers that cannot be reached. */
  readonly down = new Set<string>();
  readonly #servers = new Map<string, readonly FakeTool[]>();

  constructor(servers: Readonly<Record<string, readonly FakeTool[]>> = {}) {
    for (const [server, tools] of Object.entries(servers)) this.#servers.set(server, tools);
  }

  /** Replaces what a server offers, e.g. to change a definition after it was granted. */
  serve(server: string, tools: readonly FakeTool[]): void {
    this.#servers.set(server, tools);
  }

  /** The definition this host lists for a tool, for writing grants. */
  definition(server: string, name: string): ToolDefinition {
    const tool = this.#servers.get(server)?.find((t) => t.name === name);
    if (tool === undefined) throw new Error(`no tool ${server}/${name}`);
    return aToolDefinition(server, tool);
  }

  async listTools(server: string, timeoutMs: number): Promise<readonly ToolDefinition[]> {
    this.listings.push({ server, timeoutMs });
    return this.#reach(server).map((tool) => aToolDefinition(server, tool));
  }

  async callTool(call: ToolHostCall): Promise<ToolHostResult> {
    this.calls.push(call);
    const tool = this.#reach(call.server).find((t) => t.name === call.name);
    if (tool === undefined) throw new PortError('ToolHost', 'rejected', `${call.server} has no tool ${call.name}`);
    const latency = tool.latencyMs ?? 0;
    if (latency > call.timeoutMs) {
      await wait(call.timeoutMs);
      throw new PortError('ToolHost', 'timeout', `${call.server}/${call.name} exceeded ${call.timeoutMs}ms`);
    }
    if (latency > 0) await wait(latency);
    const result = tool.run?.(call.arguments) ?? {};
    return { text: result.text ?? JSON.stringify(call.arguments), isError: result.isError ?? false, omittedParts: result.omittedParts ?? 0 };
  }

  #reach(server: string): readonly FakeTool[] {
    const tools = this.#servers.get(server);
    if (tools === undefined || this.down.has(server)) throw new PortError('ToolHost', 'unavailable', `tool server ${server} cannot be reached`);
    return tools;
  }
}
