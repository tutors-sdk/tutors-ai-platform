import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintTestFile, testFiles } from '../check-suite-health.ts';
import { codeOnly } from '../lib/source.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/suite-health/${name}`, import.meta.url), 'utf8');

describe('suite-health lint', () => {
  it('reports each rule on its fixture line, and nothing else', () => {
    const findings = lintTestFile('packages/x/test/violations.test.ts', fixture('violations.fixture.ts'));
    expect(findings.map((f) => [f.line, f.rule])).toEqual([
      [4, 'focused'],
      [5, 'skipped'],
      [6, 'skipped'],
      [7, 'expected-failure'],
      [8, 'conditional-skip'],
      [9, 'unrestored-timers'],
      [10, 'unrestored-console'],
    ]);
    expect(findings.every((f) => f.file === 'packages/x/test/violations.test.ts' && f.message.length > 0)).toBe(true);
  });

  it('lets integration and soak tests skip themselves when their service is absent', () => {
    for (const file of ['apps/a/test/a.integration.test.ts', 'apps/a/test/a.soak.test.ts']) {
      expect(lintTestFile(file, fixture('violations.fixture.ts')).map((f) => f.rule)).not.toContain('conditional-skip');
    }
  });

  it('finds nothing in compliant code, nor in comments, strings and regexes', () => {
    expect(lintTestFile('packages/x/test/clean.test.ts', fixture('clean.fixture.ts'))).toEqual([]);
  });

  it('scans the real test files, but not its own fixtures', () => {
    const files = testFiles();
    expect(files.some((f) => f.endsWith('packages/core/test/assist-student.test.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('scripts/test/suite-health.test.ts'))).toBe(true);
    expect(files.some((f) => f.includes('/fixtures/'))).toBe(false);
  });
});

describe('codeOnly', () => {
  it('blanks comments, strings, templates and regexes but keeps code and line numbers', () => {
    const source = "a('x // y'); // it.only(\nb(/\"q/g, `t\n${1}`); /* c\nd */ e";
    const code = codeOnly(source);
    expect(code.split('\n')).toHaveLength(source.split('\n').length);
    expect(code.replace(/\s+/g, ' ')).toBe("a(' '); b(/ g, ` `); / / e");
    expect(codeOnly('const r = x / y / z;')).toBe('const r = x / y / z;');
    expect(codeOnly("return /'/.test(s)")).toBe('return / /.test(s)');
  });
});
