#!/usr/bin/env node
// Determinism: production code reads time and randomness only through something a test can
// control (the Clock port, the resilience Timer, an injected random). Each construct below is
// allowed only in the allow-listed modules; the sites that predate this check are counted in
// scripts/determinism-baseline.json, which may only shrink. See docs/testing.md.
//
//   node scripts/check-determinism.ts            # check
//   node scripts/check-determinism.ts --update   # lower baseline entries that have shrunk
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly, lineAt, rel, ROOT, walk } from './lib/source.ts';

const COMMENT = 'Time and randomness read outside an injected Clock or Timer, per file. Only shrinks: node scripts/check-determinism.ts --update.';

export const CONSTRUCTS: Readonly<Record<string, RegExp>> = {
  'Date.now()': /\bDate\s*\.\s*now\s*\(/g,
  'new Date()': /\bnew\s+Date\s*\(\s*\)/g,
  'Math.random()': /\bMath\s*\.\s*random\b/g,
  'performance.now()': /\bperformance\s*\.\s*now\s*\(/g,
  'process.hrtime': /\bprocess\s*\.\s*hrtime\b/g,
  setTimeout: /\bsetTimeout\s*\(/g,
  setInterval: /\bsetInterval\s*\(/g,
  setImmediate: /\bsetImmediate\s*\(/g,
  'AbortSignal.timeout()': /\bAbortSignal\s*\.\s*timeout\s*\(/g,
};

/** The modules whose job is to be the clock. */
export const ALLOWED = [/^packages\/adapters\/system\/src\//, /^packages\/adapters\/resilience\/src\/timer\.ts$/];

export type Counts = Record<string, Record<string, number>>;

export interface Site {
  readonly file: string;
  readonly line: number;
  readonly construct: string;
}

export function sites(file: string, source: string): Site[] {
  if (ALLOWED.some((p) => p.test(file))) return [];
  const code = codeOnly(source);
  return Object.entries(CONSTRUCTS).flatMap(([construct, pattern]) => [...code.matchAll(pattern)].map((m) => ({ file, line: lineAt(code, m.index), construct })));
}

export function count(found: readonly Site[]): Counts {
  const counts: Counts = {};
  for (const { file, construct } of found) {
    counts[file] ??= {};
    counts[file][construct] = (counts[file][construct] ?? 0) + 1;
  }
  return counts;
}

/** Compares counts with the baseline: a new site fails, and so does an entry that has shrunk but not been lowered. */
export function compare(counts: Counts, baseline: Counts, found: readonly Site[]): string[] {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
  for (const file of [...keys].sort()) {
    const constructs = new Set([...Object.keys(counts[file] ?? {}), ...Object.keys(baseline[file] ?? {})]);
    for (const construct of constructs) {
      const now = counts[file]?.[construct] ?? 0;
      const allowed = baseline[file]?.[construct] ?? 0;
      if (now > allowed) {
        const lines = found.filter((s) => s.file === file && s.construct === construct).map((s) => s.line);
        problems.push(`${file}:${lines.join(',')} uses ${construct} ${now} time(s), baseline ${allowed}: take time or randomness from an injected Clock, Timer or random instead`);
      } else if (now < allowed) {
        problems.push(`${file} uses ${construct} ${now} time(s) but the baseline allows ${allowed}: lower it with --update`);
      }
    }
  }
  return problems;
}

/** The baseline with every entry lowered to its current count; never raised. */
export function lowered(counts: Counts, baseline: Counts): Counts {
  const next: Counts = {};
  for (const [file, constructs] of Object.entries(baseline)) {
    for (const [construct, allowed] of Object.entries(constructs)) {
      const now = Math.min(allowed, counts[file]?.[construct] ?? 0);
      if (now > 0) (next[file] ??= {})[construct] = now;
    }
  }
  return next;
}

export function productionFiles(root = ROOT): string[] {
  const isSource = (p: string) => /\/src\/.+\.ts$/.test(p) && !p.includes('/packages/testing/');
  return [...walk(join(root, 'packages'), isSource), ...walk(join(root, 'apps'), isSource)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baselinePath = join(ROOT, 'scripts/determinism-baseline.json');
  const { sites: baseline } = JSON.parse(readFileSync(baselinePath, 'utf8')) as { sites: Counts };
  const files = productionFiles();
  const found = files.flatMap((f) => sites(rel(f), readFileSync(f, 'utf8')));
  const counts = count(found);
  if (process.argv.includes('--update')) {
    const next = lowered(counts, baseline);
    writeFileSync(baselinePath, `${JSON.stringify({ $comment: COMMENT, sites: next }, null, 2)}\n`);
    console.log('Determinism baseline lowered to the current counts.');
  }
  const problems = compare(counts, process.argv.includes('--update') ? lowered(counts, baseline) : baseline, found);
  if (problems.length > 0) {
    console.error(`Determinism check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Determinism holds across ${files.length} production files (${found.length} baselined sites).`);
}
