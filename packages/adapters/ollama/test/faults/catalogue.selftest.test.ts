import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOGUE, GOOD_ANSWER, GOOD_EXCHANGE } from './catalogue.ts';
import { WEAK_FAULT, WEAK_FAULT_PROBLEMS } from './fixtures/weak-fault.ts';
import { KNOWN_GAPS } from './knownGaps.ts';
import { brokenInvariants, observe, report } from './runner.ts';
import { TARGETS } from './targets.ts';
import type { Outcome } from './types.ts';
import { catalogueProblems, requirementIds } from './validate.ts';

describe('the fault catalogue gate', () => {
  it('holds the count of faults without a real requirement or a full outcome at zero', () => {
    expect(catalogueProblems(CATALOGUE, TARGETS)).toEqual([]);
  });

  it('cites every Ollama-specific requirement at least once', () => {
    const cited = new Set(CATALOGUE.map((f) => f.spec));
    const oll = [...requirementIds()].filter((id) => id.startsWith('OLL-'));
    expect(oll.length).toBeGreaterThan(0);
    expect(oll.filter((id) => !cited.has(id))).toEqual([]);
  });

  it('rejects the weak fixture on every count', () => {
    const problems = catalogueProblems([...CATALOGUE, WEAK_FAULT], TARGETS);
    for (const expected of WEAK_FAULT_PROBLEMS) expect(problems.some((p) => expected.test(p)), String(expected)).toBe(true);
    // Each of the three targets is checked, and the catalogue itself adds nothing.
    expect(problems.every((p) => p.startsWith('fault "Weak_Fault"'))).toBe(true);
  });

  it('rejects a fault that serves the good exchange, states no settlement or applies to no target', () => {
    const base = CATALOGUE.find((f) => f.id === 'wrong-content-type')!;
    const problems = catalogueProblems(
      [
        { ...base, id: 'no-change', exchange: () => GOOD_EXCHANGE },
        { ...base, id: 'no-settlement', exchange: () => [], expected: () => ({ requests: 1, elapsedMs: { min: 0, max: 1 }, events: [] }) as unknown as Outcome },
        { ...base, id: 'no-target', appliesTo: () => false },
        { ...base, id: 'bad-window', exchange: () => [{ status: 418 }], expected: () => ({ ...base.expected({ target: TARGETS[0]! }), elapsedMs: { min: 5, max: 1 } }) },
        { ...base, id: 'no-kind', exchange: () => [{ status: 419 }], expected: () => ({ settlement: { rejects: { message: /^x/ } }, requests: 1, elapsedMs: { min: 0, max: 1 }, events: [] }) as unknown as Outcome },
      ],
      TARGETS,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'fault "no-change" on "complete": serves the good exchange unchanged',
        'fault "no-settlement" on "complete": states no settlement',
        'fault "no-target": applies to no target',
        'fault "bad-window" on "complete": states no elapsed-time window',
        'fault "no-kind" on "complete": names no error kind',
      ]),
    );
  });
});

describe('the fault runner', () => {
  const fault = CATALOGUE.find((f) => f.id === 'chat-503-html')!;
  const target = TARGETS.find((t) => t.name === 'resilient complete')!;

  it('reports every invariant a wrong expectation breaks, and none for the right one', async () => {
    const seen = await observe(fault, target);
    expect(brokenInvariants(fault.expected({ target }), seen)).toEqual([]);
    const wrong: Outcome = {
      settlement: { rejects: { kind: 'timeout', message: /^nothing like it$/ } },
      requests: 7,
      elapsedMs: { min: 5_000, max: 5_100 },
      events: [],
    };
    const broken = brokenInvariants(wrong, seen);
    expect(broken.map((b) => b.split(':')[0])).toEqual(['kind', 'message', 'requests', 'elapsed', 'events']);
    expect(brokenInvariants({ ...wrong, settlement: { resolves: GOOD_ANSWER } }, seen)[0]).toMatch(/^settlement: expected the call to resolve, it rejected with PortError\(unavailable\)/);
  });

  it('reports a call that resolves when it should reject, a wrong answer, and an error that is not a port error', async () => {
    const good = CATALOGUE.find((f) => f.id === 'wrong-content-type')!;
    const seen = await observe(good, TARGETS[0]!);
    expect(brokenInvariants(fault.expected({ target: TARGETS[0]! }), seen)[0]).toMatch(/^settlement: expected a unavailable port error, the call resolved/);
    const wrongAnswer = { ...good.expected({ target: TARGETS[0]! }), settlement: { resolves: { ...GOOD_ANSWER, depth: 'redirect' } } };
    expect(brokenInvariants(wrongAnswer, seen)[0]).toMatch(/^answer: expected /);
    const notPortError = { ...seen, result: { error: new TypeError('boom') } };
    expect(brokenInvariants(fault.expected({ target: TARGETS[0]! }), notPortError)[0]).toBe('error: expected a PortError, got TypeError "boom"');
  });

  it('names the fault, the target, the requirement and a reproduce command when it fails', () => {
    const message = report(fault, target, ['requests: expected 3, sent 4']);
    expect(message).toBe(
      [
        'Fault "chat-503-html" (The chat answers 503 with an HTML page from a proxy) on target "resilient complete" broke 1 invariant(s) of OLL-001:',
        '  - requests: expected 3, sent 4',
        'Reproduce: pnpm vitest run packages/adapters/ollama/test/faults -t "chat-503-html on resilient complete"',
      ].join('\n'),
    );
  });
});

describe('known gaps', () => {
  it('lists only faults and targets that exist, each with a reason', () => {
    const raw = JSON.parse(readFileSync(new URL('./known-gaps.json', import.meta.url), 'utf8')) as unknown[];
    expect(raw).toEqual(KNOWN_GAPS);
    for (const gap of KNOWN_GAPS) {
      expect(CATALOGUE.map((f) => f.id)).toContain(gap.fault);
      for (const t of gap.targets) expect(TARGETS.map((x) => x.name)).toContain(t);
      expect(gap.reason.length).toBeGreaterThan(0);
    }
  });
});
