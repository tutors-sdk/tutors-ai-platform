/**
 * Tools: capabilities a model may use during an exchange, served by tool
 * servers (MCP servers, in the first adapter) and always reached through the
 * tool harness (docs/adr/0008). The core never learns the transport.
 */

/**
 * A tool as its server describes it, identified by a content digest of that
 * description so that a server cannot change what a grant approved without
 * the change being noticed.
 */
export interface ToolDefinition {
  /** The configured name of the server that offers it. */
  readonly server: string;
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** JSON Schema for the arguments; the harness enforces a subset (tool-schema.ts). */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** The server declares the tool has no side effects. A hint; the grant is the decision. */
  readonly readOnly: boolean;
  /** `sha256:<hex>` of canonicalToolDefinition. */
  readonly digest: string;
}

/** One tool a policy lets the model use, pinned to the definition that was reviewed. */
export interface ToolGrant {
  readonly server: string;
  readonly tool: string;
  readonly digest: string;
}

/**
 * What a policy allows an exchange to do with tools. Absent from a policy,
 * the exchange has no tools at all.
 */
export interface ToolPolicy {
  readonly grants: readonly ToolGrant[];
  /** Call attempts per exchange, refused ones included. */
  readonly maxCalls: number;
  /** The longest any one listing or call may take. */
  readonly callTimeoutMs: number;
  /** Wall time for all tool work in one exchange, from opening the session. */
  readonly exchangeBudgetMs: number;
  /** Longest serialised arguments a call may send. */
  readonly maxArgumentChars: number;
  /** Tool output longer than this is truncated before the model sees it. */
  readonly maxResultChars: number;
}

/** Why a granted tool is not offered to the model in this exchange. */
export type ToolExclusionReason = 'server-unavailable' | 'not-offered' | 'definition-changed' | 'not-read-only' | 'unsupported-schema';

export interface ToolExclusion {
  readonly server: string;
  readonly tool: string;
  readonly reason: ToolExclusionReason;
}

/** A call as the model asked for it. Nothing in it is trusted. */
export interface ToolCall {
  readonly server: string;
  readonly name: string;
  readonly arguments: unknown;
}

export type ToolRefusalReason = 'budget-exhausted' | 'not-granted' | 'invalid-arguments';

export type ToolCallOutcome =
  /** The harness did not call the tool. `detail` is the harness's own words, safe to show the model. */
  | { readonly kind: 'refused'; readonly reason: ToolRefusalReason; readonly detail: string }
  /** The tool server failed; the port error kind says how. */
  | { readonly kind: 'failed'; readonly error: 'unavailable' | 'timeout' | 'invalid-response' | 'rejected' }
  /**
   * The tool answered. `text` is untrusted data from outside the platform: it
   * may be shown to the model as a tool result, never as instructions.
   */
  | {
      readonly kind: 'result';
      readonly text: string;
      /** The tool reported that it failed. */
      readonly isError: boolean;
      readonly truncated: boolean;
      /** Non-text content the server returned and the harness dropped. */
      readonly omittedParts: number;
    };

/** The tools one exchange may use, and how it uses them. Opened per exchange by the ToolHarness. */
export interface ToolSession {
  /** What the model may be told about: granted, offered as pinned, read-only and enforceable. */
  readonly tools: readonly ToolDefinition[];
  readonly excluded: readonly ToolExclusion[];
  call(call: ToolCall): Promise<ToolCallOutcome>;
}

/**
 * The part of a definition its digest covers, as canonical JSON: object keys
 * sorted, no whitespace, absent optional fields left out. Adapters hash this
 * with SHA-256, so every adapter and every grant agree on what a digest means.
 */
export function canonicalToolDefinition(definition: Omit<ToolDefinition, 'server' | 'digest'>): string {
  return canonicalJson({
    name: definition.name,
    // An absent title is left out, as canonicalJson leaves out every undefined field.
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    readOnly: definition.readOnly,
  });
}

/** JSON with object keys in code-unit order at every depth. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const entries = Object.keys(record)
      .sort()
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
