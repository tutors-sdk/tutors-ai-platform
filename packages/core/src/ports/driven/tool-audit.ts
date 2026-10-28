import type { ToolCallRecord, ToolCallQuery, RecordedToolCall } from '../../domain/tool-audit.ts';

/** Driven port: the append-only record of every tool call an exchange attempted. */
export interface ToolAudit {
  /** Appends and returns the stored record with its assigned sequence. */
  append(record: ToolCallRecord): Promise<RecordedToolCall>;
  /** Matching records in ascending sequence order. */
  read(query: ToolCallQuery): Promise<readonly RecordedToolCall[]>;
}
