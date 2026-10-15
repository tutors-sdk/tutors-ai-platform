#!/usr/bin/env node
// Fails when a package's mutation score falls below its recorded baseline.
// Raise the baseline in mutation-baseline.json as scores improve; never lower it
// without an ADR.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseline = JSON.parse(readFileSync(join(root, 'mutation-baseline.json'), 'utf8'));
const failures = [];

for (const [pkg, minimum] of Object.entries(baseline.packages)) {
  const report = join(root, pkg, 'reports/mutation/mutation.json');
  if (!existsSync(report)) {
    failures.push(`${pkg}: no mutation report at ${report}; run pnpm mutation first`);
    continue;
  }
  const { files } = JSON.parse(readFileSync(report, 'utf8'));
  const mutants = Object.values(files).flatMap((f) => f.mutants);
  const detected = mutants.filter((m) => m.status === 'Killed' || m.status === 'Timeout').length;
  const valid = mutants.filter((m) => !['CompileError', 'RuntimeError', 'Ignored'].includes(m.status)).length;
  const score = valid === 0 ? 100 : (100 * detected) / valid;
  const line = `${pkg}: ${score.toFixed(2)}% (${detected}/${valid}), baseline ${minimum}%`;
  if (score + 1e-9 < minimum) failures.push(`${line} — score fell`);
  else console.log(line);
}

if (failures.length > 0) {
  console.error(`Mutation gate failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
