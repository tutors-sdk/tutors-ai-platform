import type { ToolAudit, ToolCallRecord } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';

export interface ToolAuditSubject {
  /** A fresh, empty audit for each test. */
  readonly audit: () => ToolAudit | Promise<ToolAudit>;
}

export function aToolCallRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    learnerId: 'learner-1',
    sessionId: 'session-1',
    courseId: 'course-1',
    policyId: 'final-year',
    policyVersion: '0.1.0',
    server: 'docs',
    tool: 'search',
    digest: `sha256:${'a'.repeat(64)}`,
    outcome: 'result',
    isError: false,
    argumentChars: 20,
    resultChars: 300,
    elapsedMs: 12,
    calledAt: new Date('2026-10-28T09:00:00Z'),
    source: 'inference-api',
    ...overrides,
  };
}

/** The ToolAudit contract. An adapter may be wired only when this passes. */
export function toolAuditContract(name: string, subject: ToolAuditSubject): void {
  describe(`ToolAudit contract: ${name}`, () => {
    it('TA-001 assigns strictly increasing sequence numbers on append', async () => {
      const audit = await subject.audit();
      const a = await audit.append(aToolCallRecord());
      const b = await audit.append(aToolCallRecord({ outcome: 'refused', reason: 'not-granted' }));
      expect(b.sequence).toBeGreaterThan(a.sequence);
    });

    it('TA-002 returns records exactly as appended, in sequence order', async () => {
      const audit = await subject.audit();
      const input = [
        aToolCallRecord(),
        aToolCallRecord({ outcome: 'refused', reason: 'invalid-arguments', resultChars: 0 }),
        (({ isError: _isError, ...failed }) => failed)(aToolCallRecord({ outcome: 'failed', reason: 'timeout' })),
      ];
      for (const r of input) await audit.append(r);
      const read = await audit.read({ courseId: 'course-1' });
      expect(read).toHaveLength(3);
      expect(read.map((r) => r.sequence)).toEqual([...read.map((r) => r.sequence)].sort((x, y) => x - y));
      read.forEach((r, i) => {
        const { sequence: _sequence, ...rest } = r;
        expect(rest).toEqual(input[i]);
      });
    });

    it('TA-003 filters by course, learner and sequence', async () => {
      const audit = await subject.audit();
      await audit.append(aToolCallRecord());
      const second = await audit.append(aToolCallRecord({ learnerId: 'learner-2' }));
      await audit.append(aToolCallRecord());
      await audit.append(aToolCallRecord({ courseId: 'course-2' }));
      expect(await audit.read({ courseId: 'course-1' })).toHaveLength(3);
      expect(await audit.read({ courseId: 'course-1', learnerId: 'learner-2' })).toHaveLength(1);
      expect(await audit.read({ courseId: 'course-1', afterSequence: second.sequence })).toHaveLength(1);
      expect(await audit.read({ courseId: 'course-3' })).toEqual([]);
    });

    it('TA-004 leaves earlier records unchanged by later appends', async () => {
      const audit = await subject.audit();
      await audit.append(aToolCallRecord());
      const before = await audit.read({ courseId: 'course-1' });
      await audit.append(aToolCallRecord({ tool: 'other' }));
      expect((await audit.read({ courseId: 'course-1' })).slice(0, before.length)).toEqual(before);
    });

    it('TA-005 keeps only the fields of a record, so text smuggled in alongside never reaches the audit', async () => {
      const audit = await subject.audit();
      const smuggled = { ...aToolCallRecord(), arguments: { text: 'my essay' }, text: 'the result' } as ToolCallRecord;
      await audit.append(smuggled);
      const [stored] = await audit.read({ courseId: 'course-1' });
      expect(JSON.stringify(stored)).not.toContain('my essay');
      expect(JSON.stringify(stored)).not.toContain('the result');
    });
  });
}
