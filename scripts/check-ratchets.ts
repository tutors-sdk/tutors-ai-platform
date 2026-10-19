#!/usr/bin/env node
// One-way ratchets. Each file below holds a floor that may only rise or a list of exceptions
// that may only shrink; this compares it with the copy on the base ref and fails a change that
// moves it the wrong way, so a pull request cannot exempt itself. With no readable base ref it
// fails closed. See docs/testing.md.
//
//   RATCHET_BASE_REF=HEAD^1 node scripts/check-ratchets.ts   # CI: the base tip of the PR merge
//   node scripts/check-ratchets.ts                           # locally: the merge base with origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/source.ts';

type Json = unknown;

export interface Ratchet {
  readonly file: string;
  /** Problems with moving from `base` to `head`; `base` is undefined when the file is new. */
  check(head: Json, base: Json): string[];
}

/** mutation-baseline.json: a package's floor may rise, never fall or disappear. */
export function floorsMayOnlyRise(head: Json, base: Json): string[] {
  const now = (head as { packages?: Record<string, number> }).packages ?? {};
  const before = (base as { packages?: Record<string, number> }).packages ?? {};
  return Object.entries(before).flatMap(([pkg, floor]) => {
    if (!(pkg in now)) return [`${pkg}: its mutation floor (${floor}%) was removed`];
    return now[pkg]! < floor ? [`${pkg}: mutation floor lowered from ${floor}% to ${now[pkg]}%`] : [];
  });
}

/** determinism-baseline.json: no file may gain a site or an entry. */
export function sitesMayOnlyShrink(head: Json, base: Json): string[] {
  const now = (head as { sites?: Record<string, Record<string, number>> }).sites ?? {};
  const before = (base as { sites?: Record<string, Record<string, number>> }).sites ?? {};
  return Object.entries(now).flatMap(([file, constructs]) =>
    Object.entries(constructs).flatMap(([construct, n]) => {
      const allowed = before[file]?.[construct] ?? 0;
      return n > allowed ? [`${file}: baseline for ${construct} raised from ${allowed} to ${n}`] : [];
    }),
  );
}

/** known-gaps.json: an entry may be removed, never added or widened to more targets. */
export function gapsMayOnlyShrink(head: Json, base: Json): string[] {
  const before = new Set((base as { fault: string; targets: string[] }[]).flatMap((g) => g.targets.map((t) => `${g.fault} on ${t}`)));
  return (head as { fault: string; targets: string[] }[]).flatMap((g) =>
    g.targets.filter((t) => !before.has(`${g.fault} on ${t}`)).map((t) => `known gap added: ${g.fault} on ${t}`),
  );
}

export const RATCHETS: readonly Ratchet[] = [
  { file: 'mutation-baseline.json', check: floorsMayOnlyRise },
  { file: 'scripts/determinism-baseline.json', check: sitesMayOnlyShrink },
  { file: 'packages/adapters/ollama/test/faults/known-gaps.json', check: gapsMayOnlyShrink },
];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function baseRef(): string {
  const ref = process.env['RATCHET_BASE_REF']?.trim();
  if (ref) return git(['rev-parse', '--verify', `${ref}^{commit}`]);
  return git(['merge-base', 'HEAD', 'origin/main']);
}

function atBase(ref: string, file: string): Json | undefined {
  let text: string;
  try {
    text = git(['show', `${ref}:${file}`]);
  } catch {
    return undefined;
  }
  return JSON.parse(text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let ref: string;
  try {
    ref = baseRef();
  } catch {
    console.error('Ratchet check cannot read its base ref (set RATCHET_BASE_REF, or fetch origin/main); failing closed.');
    process.exit(2);
  }
  const problems = RATCHETS.flatMap(({ file, check }) => {
    const base = atBase(ref, file);
    if (base === undefined) return [];
    return check(JSON.parse(readFileSync(join(ROOT, file), 'utf8')), base).map((p) => `${file}: ${p}`);
  });
  if (problems.length > 0) {
    console.error(`Ratchets moved the wrong way against ${ref.slice(0, 12)}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Ratchets hold against ${ref.slice(0, 12)} (${RATCHETS.map((r) => r.file).join(', ')}).`);
}
