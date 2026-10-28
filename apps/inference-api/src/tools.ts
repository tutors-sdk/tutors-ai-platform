import {
  PortError,
  unsupportedSchema,
  type Clock,
  type PedagogicalPolicy,
  type ToolDefinition,
  type ToolHarness,
  type ToolHost,
} from '@tutors-ai/core';

/**
 * The operator's view of the tool path, run inside the API's container
 * (`node /opt/app/tools.mjs`), with the API's own configuration:
 *
 *   list <server>                 each tool the server offers, with the grant that would pin it
 *   check <server> <tool> [json]  one call through the whole harness, audited like any other
 *
 * `check` exists to prove the path (network, token, protocol, audit) before a
 * tool is granted to learners. It grants the tool at the digest the server
 * lists now, so it says nothing about whether a policy's pin still holds. The
 * harness still applies: a tool that is not read-only is never called.
 */
export interface ToolsCommandDeps {
  readonly harness: ToolHarness;
  readonly host: ToolHost;
  readonly clock: Clock;
  readonly out: (line: string) => void;
  /** Bounds the listing and the call. */
  readonly timeoutMs: number;
}

export const USAGE = 'usage: tools list <server> | tools check <server> <tool> [arguments as JSON]';

/** The audit's names for what `check` does, so its records are told apart from learners'. */
export const CHECK_LEARNER = 'operator-check';

/** One line of `list`: what a lecturer copies into a policy, and whether the harness would offer it. */
export function describeTool(definition: ToolDefinition): Record<string, unknown> {
  const schema = definition.inputSchema['type'] !== 'object' ? 'the input schema is not an object' : unsupportedSchema(definition.inputSchema);
  return {
    grant: { server: definition.server, tool: definition.name, digest: definition.digest },
    readOnly: definition.readOnly,
    schema: schema ?? 'supported',
    description: definition.description,
  };
}

/** A policy that grants exactly one tool, for one call. */
export function checkPolicy(definition: ToolDefinition, timeoutMs: number): PedagogicalPolicy {
  return {
    id: CHECK_LEARNER,
    version: '0',
    level: CHECK_LEARNER,
    maxDepth: 'redirect',
    memory: { kind: 'none', sharing: 'private' },
    maxResponseChars: 0,
    maxMaterial: 0,
    tools: {
      grants: [{ server: definition.server, tool: definition.name, digest: definition.digest }],
      maxCalls: 1,
      callTimeoutMs: timeoutMs,
      exchangeBudgetMs: timeoutMs * 2,
      maxArgumentChars: 10_000,
      maxResultChars: 2_000,
    },
  };
}

/** Runs one command and returns the exit code: 0 only when the tool answered without error. */
export async function runToolsCommand(argv: readonly string[], deps: ToolsCommandDeps): Promise<number> {
  const [command, server, tool, json] = argv;
  const print = (value: unknown) => deps.out(JSON.stringify(value));
  if (server === undefined || !((command === 'list' && tool === undefined) || (command === 'check' && tool !== undefined && argv.length <= 4))) {
    deps.out(USAGE);
    return 2;
  }
  let definitions: readonly ToolDefinition[];
  try {
    definitions = await deps.host.listTools(server, deps.timeoutMs);
  } catch (error) {
    if (!PortError.is(error)) throw error;
    print({ server, error: error.kind, detail: error.message });
    return 1;
  }
  if (command === 'list') {
    for (const definition of definitions) print(describeTool(definition));
    return 0;
  }
  const definition = definitions.find((d) => d.name === tool);
  if (definition === undefined) {
    print({ server, tool, error: 'not-offered' });
    return 1;
  }
  let args: unknown;
  try {
    args = JSON.parse(json ?? '{}');
  } catch {
    print({ server, tool, error: 'the arguments are not JSON' });
    return 2;
  }
  const at = deps.clock.now().toISOString();
  const session = await deps.harness.open({
    learner: { learnerId: CHECK_LEARNER, sessionId: `${CHECK_LEARNER}-${at}`, courseId: CHECK_LEARNER, level: CHECK_LEARNER, memory: { kind: 'none', sharing: 'private' } },
    policy: checkPolicy(definition, deps.timeoutMs),
  });
  if (session.tools.length === 0) {
    print({ server, tool, excluded: session.excluded.map((e) => e.reason) });
    return 1;
  }
  const outcome = await session.call({ server, name: definition.name, arguments: args });
  print({ server, tool, digest: definition.digest, outcome });
  return outcome.kind === 'result' && !outcome.isError ? 0 : 1;
}
