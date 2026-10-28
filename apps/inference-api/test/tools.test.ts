import { ToolHarness } from '@tutors-ai/core';
import { FakeToolHost, FixedClock, InMemoryToolAudit, KIT_TOOLS } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { CHECK_LEARNER, checkPolicy, describeTool, runToolsCommand, USAGE } from '../src/tools.ts';

function subject() {
  const host = new FakeToolHost({
    glossary: [
      KIT_TOOLS.echo,
      { ...KIT_TOOLS.fail, run: (args) => ({ text: `failed: ${String(args['text'])}`, isError: true }) },
      KIT_TOOLS.write,
      { name: 'loose', inputSchema: { type: 'object', properties: { q: { anyOf: [{ type: 'string' }] } } } },
      { name: 'bare', inputSchema: { type: 'string' } },
    ],
  });
  const audit = new InMemoryToolAudit();
  const clock = new FixedClock('2026-10-28T10:00:00Z');
  const lines: string[] = [];
  const run = (...argv: string[]) =>
    runToolsCommand(argv, { harness: new ToolHarness({ host, audit, clock, source: 'tools-cli' }), host, clock, out: (l) => lines.push(l), timeoutMs: 3_000 });
  const printed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { host, audit, lines, printed, run };
}

describe('the operator tools command', () => {
  it('lists each tool with the grant that would pin it and whether the harness could offer it', async () => {
    const s = subject();
    expect(await s.run('list', 'glossary')).toBe(0);
    const echo = s.host.definition('glossary', 'echo');
    expect(s.printed()[0]).toEqual({
      grant: { server: 'glossary', tool: 'echo', digest: echo.digest },
      readOnly: true,
      schema: 'supported',
      description: KIT_TOOLS.echo.description,
    });
    expect(s.printed().map((p) => [(p['grant'] as { tool: string }).tool, p['readOnly'], p['schema']])).toEqual([
      ['echo', true, 'supported'],
      ['fail', true, 'supported'],
      ['write', false, 'supported'],
      ['loose', true, expect.stringContaining('anyOf')],
      ['bare', true, 'the input schema is not an object'],
    ]);
    expect(s.host.listings).toEqual([{ server: 'glossary', timeoutMs: 3_000 }]);
    expect(s.audit.all).toEqual([]);
  });

  it('checks one call through the harness, audited under its own names, and succeeds only on an answer', async () => {
    const s = subject();
    expect(await s.run('check', 'glossary', 'echo', '{"text":"loop"}')).toBe(0);
    expect(s.printed()).toEqual([
      {
        server: 'glossary',
        tool: 'echo',
        digest: s.host.definition('glossary', 'echo').digest,
        outcome: { kind: 'result', text: '{"text":"loop"}', isError: false, truncated: false, omittedParts: 0 },
      },
    ]);
    expect(s.audit.all).toEqual([
      expect.objectContaining({
        learnerId: CHECK_LEARNER,
        sessionId: `${CHECK_LEARNER}-2026-10-28T10:00:00.000Z`,
        courseId: CHECK_LEARNER,
        policyId: CHECK_LEARNER,
        server: 'glossary',
        tool: 'echo',
        outcome: 'result',
        isError: false,
        source: 'tools-cli',
      }),
    ]);
    expect(s.host.calls).toEqual([{ server: 'glossary', name: 'echo', arguments: { text: 'loop' }, timeoutMs: 3_000 }]);
  });

  it('fails a check when the tool reports an error, refuses the arguments, or is not read-only', async () => {
    const s = subject();
    expect(await s.run('check', 'glossary', 'fail', '{"text":"x"}')).toBe(1);
    expect(await s.run('check', 'glossary', 'echo')).toBe(1);
    expect(s.printed()[1]).toMatchObject({ outcome: { kind: 'refused', reason: 'invalid-arguments' } });
    expect(await s.run('check', 'glossary', 'write')).toBe(1);
    expect(s.printed()[2]).toEqual({ server: 'glossary', tool: 'write', excluded: ['not-read-only'] });
    expect(s.host.calls.map((c) => c.name)).toEqual(['fail']);
    expect(s.audit.all.map((r) => r.outcome)).toEqual(['result', 'refused']);
  });

  it('reports a server it cannot reach, a tool it does not offer, and arguments that are not JSON', async () => {
    const s = subject();
    s.host.down.add('glossary');
    expect(await s.run('list', 'glossary')).toBe(1);
    expect(await s.run('check', 'glossary', 'echo')).toBe(1);
    s.host.down.delete('glossary');
    expect(await s.run('check', 'glossary', 'nothing')).toBe(1);
    expect(await s.run('check', 'glossary', 'echo', '{')).toBe(2);
    expect(s.printed()).toEqual([
      { server: 'glossary', error: 'unavailable', detail: 'tool server glossary cannot be reached' },
      { server: 'glossary', error: 'unavailable', detail: 'tool server glossary cannot be reached' },
      { server: 'glossary', tool: 'nothing', error: 'not-offered' },
      { server: 'glossary', tool: 'echo', error: 'the arguments are not JSON' },
    ]);
    expect(s.audit.all).toEqual([]);
  });

  const MISUSED: readonly (readonly string[])[] = [[], ['list'], ['list', 'a', 'b'], ['check', 'a'], ['check', 'a', 'b', '{}', 'more'], ['call', 'a', 'b']];
  for (const argv of MISUSED) {
    it(`prints the usage for "${argv.join(' ')}" without reaching a server`, async () => {
      const s = subject();
      expect(await s.run(...argv)).toBe(2);
      expect(s.lines).toEqual([USAGE]);
      expect(s.host.listings).toEqual([]);
    });
  }

  it('grants exactly the one tool, for one call, within the timeout', () => {
    const echo = new FakeToolHost({ glossary: [KIT_TOOLS.echo] }).definition('glossary', 'echo');
    expect(checkPolicy(echo, 4_000).tools).toEqual({
      grants: [{ server: 'glossary', tool: 'echo', digest: echo.digest }],
      maxCalls: 1,
      callTimeoutMs: 4_000,
      exchangeBudgetMs: 8_000,
      maxArgumentChars: 10_000,
      maxResultChars: 2_000,
    });
    expect(describeTool(echo)['grant']).toEqual({ server: 'glossary', tool: 'echo', digest: echo.digest });
  });
});
