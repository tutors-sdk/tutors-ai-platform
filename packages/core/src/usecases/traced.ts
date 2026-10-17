import { PortError } from '../domain/errors.ts';
import type { Span, Telemetry } from '../ports/driven/telemetry.ts';

/**
 * Runs one driven-port call in a child span of `parent`, named
 * `<Port>.<operation>`, so traces show where an exchange spent its time and
 * which port failed. A port error's kind is kept as `port.error`.
 */
export async function traced<T>(telemetry: Telemetry, parent: Span, name: string, call: () => Promise<T>): Promise<T> {
  const span = telemetry.startSpan(name, {}, parent);
  try {
    const result = await call();
    span.end('ok');
    return result;
  } catch (error) {
    if (PortError.is(error)) span.setAttribute('port.error', error.kind);
    span.end('error');
    throw error;
  }
}
