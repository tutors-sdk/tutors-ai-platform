#!/usr/bin/env node
// Suite health: tests that cannot fail, or that hide failures, fail the build. A test that
// asserts nothing is caught at run time instead (expect.requireAssertions in vitest.config.ts).
// See docs/testing.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly, lineAt, rel, ROOT, walk } from './lib/source.ts';

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly allowedIn?: (file: string) => boolean;
}

const RULES: readonly Rule[] = [
  { id: 'focused', pattern: /\b(?:describe|it|test|suite)\s*\.\s*only\s*\(|\bf(?:it|describe)\s*\(/g, message: 'a focused test runs alone and hides every other result' },
  { id: 'skipped', pattern: /\b(?:describe|it|test|suite)\s*\.\s*(?:skip|todo)\s*\(|\bx(?:it|describe)\s*\(/g, message: 'a skipped test protects nothing; delete it or make it pass' },
  { id: 'expected-failure', pattern: /\b(?:it|test)\s*\.\s*fails\s*\(/g, message: 'a test that passes by failing hides the failure it expects' },
  {
    id: 'conditional-skip',
    pattern: /\.\s*(?:skipIf|runIf)\s*\(/g,
    message: 'only integration and soak tests may skip themselves; a unit test always runs',
    allowedIn: (file) => /\.(?:integration|soak)\.test\.ts$/.test(file),
  },
];

/** Findings for one test file. */
export function lintTestFile(file: string, source: string): Finding[] {
  const code = codeOnly(source);
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (rule.allowedIn?.(file)) continue;
    for (const match of code.matchAll(rule.pattern)) findings.push({ file, line: lineAt(code, match.index), rule: rule.id, message: rule.message });
  }
  if (/\buseFakeTimers\s*\(/.test(code) && !/\buseRealTimers\s*\(/.test(code)) {
    findings.push({ file, line: lineAt(code, code.search(/\buseFakeTimers\s*\(/)), rule: 'unrestored-timers', message: 'fake timers left installed leak into the next test; call vi.useRealTimers()' });
  }
  if (/\bspyOn\s*\(\s*console\b/.test(code) && !/\b(?:mockRestore|restoreAllMocks)\s*\(/.test(code)) {
    findings.push({ file, line: lineAt(code, code.search(/\bspyOn\s*\(\s*console\b/)), rule: 'unrestored-console', message: 'a console spy that is never restored swallows output from later tests' });
  }
  return findings;
}

export function testFiles(root = ROOT): string[] {
  const isTest = (p: string) => /\/test\/.+\.ts$/.test(p);
  return [...walk(join(root, 'packages'), isTest), ...walk(join(root, 'apps'), isTest), ...walk(join(root, 'scripts/test'), (p) => p.endsWith('.ts'))];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = testFiles();
  const findings = files.flatMap((f) => lintTestFile(rel(f), readFileSync(f, 'utf8')));
  if (findings.length > 0) {
    console.error(`Suite health failed (${findings.length}):\n  ${findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message}`).join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Suite health holds across ${files.length} test files.`);
}
