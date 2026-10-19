import { expect, it } from 'vitest';
import { grade } from '../src/grade.ts';

// Weak on purpose: no boundary is tested, so boundary mutants survive. If this ever kills every
// mutant, or none, the mutation gate can no longer be shown to tell the difference.
it('grades a clear distinction', () => {
  expect(grade(95)).toBe('distinction');
});
