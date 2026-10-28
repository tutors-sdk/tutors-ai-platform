import { PortError, type ToolDefinition, type ToolHost, type ToolHostCall, type ToolHostResult } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_HOST_RESILIENCE, ResilientToolHost, type ToolHostResilienceEvent, type ToolHostResilienceOptions } from '../src/index.ts';
import { ManualTimer, outcome, settle } from './support.ts';

const OPTIONS: ToolHostResilienceOptions = {
  circuit: { failureThreshold: 2, resetAfterMs: 1_000 },
  bulkhead: { maxConcurrent: 1, maxQueued: 1 },
};

const RESULT: ToolHostResult = { text: 'found', isError: false, omittedParts: 0 };
const LISTING: readonly ToolDefinition[] = [];

interface Pending {
  readonly op: 'list' | 'call';
  readonly server: string;
  readonly timeoutMs: number;
  readonly call?: ToolHostCall;
  answer(): void;
  fail(error: unknown): void;
}

/** A host whose every listing and call waits until the test answers it. */
class ControlledToolHost implements ToolHost {
  readonly pending: Pending[] = [];
  readonly #answered = new Set<Pending>();

  get open(): Pending[] {
    return this.pending.filter((p) => !this.#answered.has(p));
  }

  listTools(server: string, timeoutMs: number): Promise<readonly ToolDefinition[]> {
    return this.#wait<readonly ToolDefinition[]>({ op: 'list', server, timeoutMs }, LISTING);
  }

  callTool(call: ToolHostCall): Promise<ToolHostResult> {
    return this.#wait<ToolHostResult>({ op: 'call', server: call.server, timeoutMs: call.timeoutMs, call }, RESULT);
  }

  #wait<T>(request: Omit<Pending, 'answer' | 'fail'>, value: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = {
        ...request,
        answer: () => {
          this.#answered.add(pending);
          resolve(value);
        },
        fail: (error) => {
          this.#answered.add(pending);
          reject(error);
        },
      };
      this.pending.push(pending);
    });
  }
}

function subject(options: ToolHostResilienceOptions = OPTIONS) {
  const inner = new ControlledToolHost();
  const timer = new ManualTimer();
  const events: ToolHostResilienceEvent[] = [];
  const host = new ResilientToolHost(inner, options, { timer, observe: (e) => events.push(e) });
  return { inner, timer, events, host };
}

const call = (server = 'docs', timeoutMs = 5_000): ToolHostCall => ({ server, name: 'search', arguments: { query: 'x' }, timeoutMs });
const unavailable = () => new PortError('ToolHost', 'unavailable', 'connection refused');
const timeout = () => new PortError('ToolHost', 'timeout', 'too slow');

async function expectPortError(promise: Promise<unknown>, kind: PortError['kind'], message: RegExp): Promise<void> {
  const { error } = await outcome(promise);
  expect(PortError.is(error)).toBe(true);
  expect(error).toMatchObject({ port: 'ToolHost', kind });
  expect((error as PortError).message).toMatch(message);
}

/** Fails `n` calls to `server` in a row and waits for them to settle. */
async function failCalls(s: ReturnType<typeof subject>, n: number, server = 'docs', error: () => unknown = unavailable) {
  for (let i = 0; i < n; i += 1) {
    const result = outcome(s.host.callTool(call(server)));
    await settle();
    s.inner.open.at(-1)?.fail(error());
    await result;
  }
}

describe('ResilientToolHost', () => {
  it('RTH-001 passes listings and calls through while closed, with the arguments and the timeout', async () => {
    const s = subject();
    const listing = s.host.listTools('docs', 3_000);
    await settle();
    expect(s.inner.open[0]).toMatchObject({ op: 'list', server: 'docs', timeoutMs: 3_000 });
    s.inner.open[0]?.answer();
    expect(await listing).toBe(LISTING);
    const result = s.host.callTool(call('docs', 4_000));
    await settle();
    expect(s.inner.open[0]?.call).toEqual(call('docs', 4_000));
    s.inner.open[0]?.answer();
    expect(await result).toBe(RESULT);
    expect(s.host.circuit('docs')).toBe('closed');
    expect(s.events).toEqual([]);
  });

  it('RTH-002 opens one server’s circuit after consecutive failures, timeouts and listings included, leaving the others closed', async () => {
    const s = subject();
    const listing = outcome(s.host.listTools('docs', 1_000));
    await settle();
    s.inner.open[0]?.fail(timeout());
    await listing;
    expect(s.host.circuit('docs')).toBe('closed');
    await failCalls(s, 1, 'docs', unavailable);
    expect(s.host.circuit('docs')).toBe('open');
    expect(s.host.circuit('glossary')).toBe('closed');
    expect(s.events).toEqual([{ type: 'circuit', from: 'closed', to: 'open', server: 'docs' }]);
    const other = s.host.callTool(call('glossary'));
    await settle();
    s.inner.open[0]?.answer();
    expect(await other).toBe(RESULT);
  });

  it('RTH-002 counts only consecutive failures: an answer in between starts the count again', async () => {
    const s = subject();
    await failCalls(s, 1);
    const ok = s.host.callTool(call());
    await settle();
    s.inner.open[0]?.answer();
    await ok;
    await failCalls(s, 1);
    expect(s.host.circuit('docs')).toBe('closed');
  });

  it('RTH-003 fails fast while open, without calling the server, and reports the shed call', async () => {
    const s = subject();
    await failCalls(s, 2);
    const before = s.inner.pending.length;
    await expectPortError(s.host.callTool(call()), 'unavailable', /^the circuit to tool server "docs" is open; the call failed fast$/);
    await expectPortError(s.host.listTools('docs', 1_000), 'unavailable', /circuit to tool server "docs" is open/);
    expect(s.inner.pending).toHaveLength(before);
    expect(s.events.slice(1)).toEqual([
      { type: 'shed', reason: 'circuit-open', server: 'docs' },
      { type: 'shed', reason: 'circuit-open', server: 'docs' },
    ]);
  });

  it('RTH-004 admits one probe after the reset period and closes on an answer', async () => {
    const s = subject({ ...OPTIONS, bulkhead: { maxConcurrent: 2, maxQueued: 0 } });
    await failCalls(s, 2);
    await s.timer.advance(999);
    await expectPortError(s.host.callTool(call()), 'unavailable', /circuit/);
    await s.timer.advance(1);
    const probe = s.host.callTool(call());
    await settle();
    await expectPortError(s.host.callTool(call()), 'unavailable', /circuit/);
    expect(s.host.circuit('docs')).toBe('half-open');
    s.inner.open[0]?.answer();
    expect(await probe).toBe(RESULT);
    expect(s.host.circuit('docs')).toBe('closed');
  });

  it('RTH-004 opens again when the probe fails', async () => {
    const s = subject();
    await failCalls(s, 2);
    await s.timer.advance(1_000);
    await failCalls(s, 1, 'docs', timeout);
    expect(s.host.circuit('docs')).toBe('open');
    expect(s.events.filter((e) => e.type === 'circuit').map((e) => e.type === 'circuit' && e.to)).toEqual(['open', 'half-open', 'open']);
  });

  const ANSWERS: readonly (readonly [string, () => unknown])[] = [
    ['invalid-response', () => new PortError('ToolHost', 'invalid-response', 'bad JSON')],
    ['rejected', () => new PortError('ToolHost', 'rejected', 'no such tool')],
    ['any other error', () => new Error('bug')],
  ];
  for (const [name, error] of ANSWERS) {
    it(`RTH-005 counts ${name} as an answer from the server`, async () => {
      const s = subject();
      await failCalls(s, 1);
      await failCalls(s, 1, 'docs', error);
      await failCalls(s, 1);
      expect(s.host.circuit('docs')).toBe('closed');
    });
  }

  it('RTH-006 never retries, even an unavailable failure', async () => {
    const s = subject({ circuit: { failureThreshold: 5, resetAfterMs: 1_000 }, bulkhead: OPTIONS.bulkhead });
    await expect(failCalls(s, 1)).resolves.toBeUndefined();
    await s.timer.advance(10_000);
    expect(s.inner.pending).toHaveLength(1);
  });

  it('RTH-007 queues a call to a busy server, admits it when the first finishes, with only the time left', async () => {
    const s = subject();
    const first = s.host.callTool(call('docs', 5_000));
    const second = s.host.callTool(call('docs', 5_000));
    await settle();
    expect(s.inner.open).toHaveLength(1);
    await s.timer.advance(2_000);
    s.inner.open[0]?.answer();
    await first;
    await settle();
    expect(s.inner.open[0]?.timeoutMs).toBe(3_000);
    s.inner.open[0]?.answer();
    expect(await second).toBe(RESULT);
  });

  it('RTH-007 sheds a call that finds the queue full, and keeps each server’s bulkhead separate', async () => {
    const s = subject();
    void outcome(s.host.callTool(call()));
    void outcome(s.host.callTool(call()));
    await expectPortError(s.host.callTool(call()), 'unavailable', /^tool server "docs" is saturated; the call was shed$/);
    const other = s.host.callTool(call('glossary'));
    await settle();
    expect(s.inner.open.map((p) => p.server)).toEqual(['docs', 'glossary']);
    s.inner.open[1]?.answer();
    expect(await other).toBe(RESULT);
    expect(s.events).toEqual([{ type: 'shed', reason: 'queue-full', server: 'docs' }]);
  });

  it('RTH-007 fails a queued call as timeout when its time runs out, and frees its place', async () => {
    const s = subject();
    void outcome(s.host.callTool(call('docs', 10_000)));
    const queued = s.host.callTool(call('docs', 1_000));
    void outcome(queued);
    await s.timer.advance(1_000);
    await expectPortError(queued, 'timeout', /^tool server "docs" was busy until the request timed out$/);
    void outcome(s.host.callTool(call('docs', 1_000)));
    expect(s.events).toEqual([{ type: 'shed', reason: 'queue-timeout', server: 'docs' }]);
    expect(s.timer.pending).toBe(1);
  });

  it('RTH-007 releases the place of a call that failed, so the next can run', async () => {
    const s = subject({ circuit: { failureThreshold: 9, resetAfterMs: 1_000 }, bulkhead: { maxConcurrent: 1, maxQueued: 0 } });
    await failCalls(s, 1);
    const next = s.host.callTool(call());
    await settle();
    s.inner.open[0]?.answer();
    expect(await next).toBe(RESULT);
  });

  it('RTH-008 names the server in every event, and reports circuit changes', async () => {
    const s = subject();
    await failCalls(s, 2, 'glossary');
    expect(s.events).toEqual([{ type: 'circuit', from: 'closed', to: 'open', server: 'glossary' }]);
  });

  it('RTH-001 defaults to three failures, a 30 s reset, and four calls in flight with sixteen queued', () => {
    expect(DEFAULT_TOOL_HOST_RESILIENCE).toEqual({ circuit: { failureThreshold: 3, resetAfterMs: 30_000 }, bulkhead: { maxConcurrent: 4, maxQueued: 16 } });
    const host = new ResilientToolHost(new ControlledToolHost());
    expect(host.circuit('docs')).toBe('closed');
  });
});
