import { anEvidence, FixedClock, InMemoryEvidenceStore } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { DomainRuleViolation, RecordEvidenceService, type NewEvidence } from '../src/index.ts';

function setup() {
  const clock = new FixedClock('2026-10-15T09:00:00Z');
  const evidence = new InMemoryEvidenceStore(clock);
  return { clock, evidence, service: new RecordEvidenceService({ evidence, clock, maxClockSkewMs: 60_000 }) };
}

async function violation(e: Partial<NewEvidence> | NewEvidence): Promise<string> {
  const { service, evidence } = setup();
  try {
    await service.record({ ...anEvidence(), ...e } as NewEvidence);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainRuleViolation);
    expect(evidence.all).toHaveLength(0);
    expect(error).toMatchObject({ name: 'DomainRuleViolation' });
    expect((error as Error).message.length).toBeGreaterThan(0);
    return (error as DomainRuleViolation).rule;
  }
  throw new Error('expected a rule violation');
}

describe('RecordEvidence', () => {
  it('RE-001 rejects an unknown evidence type', async () => {
    expect(await violation({ type: 'lab-closed' as NewEvidence['type'] })).toBe('RE-001');
  });

  it('RE-002 rejects evidence with an empty learner, session, course or source', async () => {
    for (const field of ['learnerId', 'sessionId', 'courseId', 'source'] as const) {
      expect(await violation({ [field]: '  ' })).toBe('RE-002');
    }
  });

  it('RE-003 rejects confidence outside 0..1 and accepts the bounds', async () => {
    for (const confidence of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await violation({ confidence })).toBe('RE-003');
    }
    const { service } = setup();
    await expect(service.record(anEvidence({ confidence: 0 }))).resolves.toBeDefined();
    await expect(service.record(anEvidence({ confidence: 1 }))).resolves.toBeDefined();
  });

  it('RE-004 rejects an observation stamped beyond the allowed clock skew, or an invalid date', async () => {
    expect(await violation({ observedAt: new Date('2026-10-15T09:01:00.001Z') })).toBe('RE-004');
    expect(await violation({ observedAt: new Date('not a date') })).toBe('RE-004');
    const { service } = setup();
    await expect(service.record(anEvidence({ observedAt: new Date('2026-10-15T09:01:00Z') }))).resolves.toBeDefined();
  });

  it('RE-005 rejects a retention that is not a storable scope', async () => {
    expect(await violation({ retention: 'none' })).toBe('RE-005');
    expect(await violation({ retention: 'forever' as NewEvidence['retention'] })).toBe('RE-005');
  });

  it('RE-006 requires a valid depth on assistance-given evidence and forbids it elsewhere', async () => {
    expect(await violation({ type: 'assistance-given' })).toBe('RE-006');
    expect(await violation({ type: 'assistance-given', depth: 'essay' as never })).toBe('RE-006');
    expect(await violation({ type: 'lab-opened', depth: 'hint' })).toBe('RE-006');
    const { service } = setup();
    await expect(service.record(anEvidence({ type: 'assistance-given', depth: 'hint' }))).resolves.toBeDefined();
  });

  it('RE-007 appends valid evidence and returns it with its sequence', async () => {
    const { service, evidence } = setup();
    const recorded = await service.record(anEvidence({ type: 'outcome-demonstrated', retention: 'programme' }));
    expect(recorded).toMatchObject({ type: 'outcome-demonstrated', sequence: 1 });
    expect(evidence.all).toEqual([recorded]);
  });
});
