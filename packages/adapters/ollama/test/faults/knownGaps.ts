import { readFileSync } from 'node:fs';
import type { KnownGap } from './types.ts';

/**
 * Faults that expose a bug not yet fixed. A listed fault that starts passing
 * fails the run until its entry is removed, and the ratchet in
 * scripts/check-ratchets.mjs fails a pull request that adds one.
 */
export const KNOWN_GAPS: readonly KnownGap[] = JSON.parse(readFileSync(new URL('./known-gaps.json', import.meta.url), 'utf8')) as KnownGap[];

export const isKnownGap = (fault: string, target: string) => KNOWN_GAPS.some((g) => g.fault === fault && g.targets.includes(target));
