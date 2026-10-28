import type { ToolDefinition } from '../../domain/tools.ts';

export interface ToolHostCall {
  readonly server: string;
  readonly name: string;
  /** Already checked by the harness against the tool's input schema. */
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

/** What a tool returned, reduced to text. The text is untrusted data. */
export interface ToolHostResult {
  readonly text: string;
  /** The tool reported that it failed. */
  readonly isError: boolean;
  /** Content parts that were not text and were dropped. */
  readonly omittedParts: number;
}

/**
 * Driven port: the servers that run tools, addressed by configured name.
 * Failures are thrown as PortError with kind "unavailable", "timeout",
 * "invalid-response" or "rejected". Only the ToolHarness calls it.
 */
export interface ToolHost {
  /** Every tool the server offers now, each with the digest of its definition. */
  listTools(server: string, timeoutMs: number): Promise<readonly ToolDefinition[]>;
  callTool(call: ToolHostCall): Promise<ToolHostResult>;
}
