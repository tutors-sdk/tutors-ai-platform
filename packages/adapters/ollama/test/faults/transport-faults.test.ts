import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.ts';
import { isKnownGap } from './knownGaps.ts';
import { brokenInvariants, observe, report } from './runner.ts';
import { TARGETS } from './targets.ts';

describe('Ollama fault catalogue', () => {
  for (const target of TARGETS) {
    for (const fault of CATALOGUE.filter((f) => f.appliesTo?.(target) ?? true)) {
      const gap = isKnownGap(fault.id, target.name);
      it(`${fault.spec} ${fault.id} on ${target.name}`, async () => {
        const broken = brokenInvariants(fault.expected({ target }), await observe(fault, target));
        if (gap) expect(broken, `"${fault.id}" on "${target.name}" passes now: remove it from known-gaps.json`).not.toEqual([]);
        else expect(broken, report(fault, target, broken)).toEqual([]);
      });
    }
  }
});
