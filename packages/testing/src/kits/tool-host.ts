import { createHash } from 'node:crypto';
import { canonicalToolDefinition, PortError, type ToolHost } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';

/** The server name every subject serves the kit's tools under. */
export const KIT_SERVER = 'kit';

const TEXT_ARGUMENT = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } as const;

/**
 * The tools a subject's server must offer, and how each must behave. An
 * adapter's test builds a real server with exactly these; the fake runs them
 * in memory.
 */
export const KIT_TOOLS = {
  /** Read-only; answers with one text part: the `text` argument. */
  echo: { name: 'echo', title: 'Echo', description: 'Repeats the text it is given.', inputSchema: TEXT_ARGUMENT, readOnly: true },
  /** Read-only; answers `failed: <text>` and reports an error. */
  fail: { name: 'fail', description: 'Always reports that it failed.', inputSchema: TEXT_ARGUMENT, readOnly: true },
  /** Read-only; answers a text part `first`, an image part, and a text part `second`. */
  mixed: { name: 'mixed', description: 'Answers with text and an image.', inputSchema: { type: 'object', properties: {} }, readOnly: true },
  /** Read-only; answers `late` after the subject's `slowerThanMs`. */
  slow: { name: 'slow', description: 'Takes its time.', inputSchema: { type: 'object', properties: {} }, readOnly: true },
  /** Not declared read-only; answers `written`. */
  write: { name: 'write', description: 'Changes something.', inputSchema: { type: 'object', properties: {} }, readOnly: false },
} as const;

/** The description `changed` subjects give `echo` instead. */
export const KIT_CHANGED_ECHO_DESCRIPTION = 'Repeats the text it is given, loudly.';

export interface ToolHostSubject {
  /** A host whose kit server is up and offers KIT_TOOLS. */
  readonly working: () => ToolHost | Promise<ToolHost>;
  /** As `working`, but `echo` has KIT_CHANGED_ECHO_DESCRIPTION. */
  readonly changed: () => ToolHost | Promise<ToolHost>;
  /** A host whose kit server is configured but cannot be reached. */
  readonly unreachable: () => ToolHost | Promise<ToolHost>;
  readonly slowerThanMs: number;
  /** Per-test timeout for suites that start real servers. */
  readonly testTimeoutMs?: number;
}

async function failure(promise: Promise<unknown>): Promise<PortError> {
  try {
    await promise;
  } catch (error) {
    expect(PortError.is(error), `expected a PortError, got ${String(error)}`).toBe(true);
    return error as PortError;
  }
  throw new Error('expected the call to fail');
}

const sha256 = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

/** The ToolHost contract. An adapter may be wired only when this passes. */
export function toolHostContract(name: string, subject: ToolHostSubject): void {
  const timeout = subject.testTimeoutMs ?? 5_000;
  const call = (tool: string, args: Readonly<Record<string, unknown>> = {}, timeoutMs = 5_000) => ({ server: KIT_SERVER, name: tool, arguments: args, timeoutMs });

  describe(`ToolHost contract: ${name}`, () => {
    it('TH-001 lists every tool the server offers, naming the server, with its definition and read-only declaration', { timeout }, async () => {
      const listed = await (await subject.working()).listTools(KIT_SERVER, 5_000);
      const byName = new Map(listed.map((d) => [d.name, d]));
      expect([...byName.keys()].sort()).toEqual(Object.keys(KIT_TOOLS).sort());
      for (const tool of Object.values(KIT_TOOLS)) {
        expect(byName.get(tool.name)).toMatchObject({ server: KIT_SERVER, ...tool });
      }
      expect(byName.get('fail')?.title).toBeUndefined();
    });

    it('TH-002 digests the canonical definition, keeping the digest while it is unchanged and changing it when it changes', { timeout }, async () => {
      const host = await subject.working();
      const first = await host.listTools(KIT_SERVER, 5_000);
      for (const { server: _server, digest, ...definition } of first) expect(digest).toBe(sha256(canonicalToolDefinition(definition)));
      const again = await host.listTools(KIT_SERVER, 5_000);
      expect(again.map((d) => d.digest).sort()).toEqual(first.map((d) => d.digest).sort());
      const changed = await (await subject.changed()).listTools(KIT_SERVER, 5_000);
      const echo = (list: typeof first) => list.find((d) => d.name === 'echo');
      expect(echo(changed)?.description).toBe(KIT_CHANGED_ECHO_DESCRIPTION);
      expect(echo(changed)?.digest).not.toBe(echo(first)?.digest);
      expect(changed.find((d) => d.name === 'fail')?.digest).toBe(first.find((d) => d.name === 'fail')?.digest);
    });

    it('TH-003 sends the arguments and returns the text parts joined, the error flag and the parts dropped', { timeout }, async () => {
      const host = await subject.working();
      expect(await host.callTool(call('echo', { text: 'hello, tools' }))).toEqual({ text: 'hello, tools', isError: false, omittedParts: 0 });
      expect(await host.callTool(call('fail', { text: 'nope' }))).toEqual({ text: 'failed: nope', isError: true, omittedParts: 0 });
      expect(await host.callTool(call('mixed'))).toEqual({ text: 'first\nsecond', isError: false, omittedParts: 1 });
    });

    it('TH-004 fails as unavailable when the server cannot be reached or is not configured', { timeout }, async () => {
      const down = await subject.unreachable();
      expect((await failure(down.listTools(KIT_SERVER, 2_000))).kind).toBe('unavailable');
      expect((await failure(down.callTool(call('echo', { text: 'x' }, 2_000)))).kind).toBe('unavailable');
      const host = await subject.working();
      expect((await failure(host.listTools('not-configured', 2_000))).kind).toBe('unavailable');
      expect((await failure(host.callTool({ ...call('echo', { text: 'x' }), server: 'not-configured' }))).kind).toBe('unavailable');
    });

    it('TH-005 fails as timeout once the timeout passes', { timeout }, async () => {
      const host = await subject.working();
      const timeoutMs = Math.max(1, Math.floor(subject.slowerThanMs / 2));
      const started = Date.now();
      expect((await failure(host.callTool(call('slow', {}, timeoutMs)))).kind).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(subject.slowerThanMs + 1_000);
    });

    it('TH-006 fails as rejected when the server refuses the call', { timeout }, async () => {
      const host = await subject.working();
      const error = await failure(host.callTool(call('no-such-tool')));
      expect(error.kind).toBe('rejected');
      expect(error.port).toBe('ToolHost');
    });
  });
}
