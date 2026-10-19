#!/usr/bin/env node
// Fails when a package's mutation score falls below its recorded baseline.
// Raise the baseline in mutation-baseline.json as scores improve; never lower it
// without an ADR (scripts/check-ratchets.ts fails a pull request that does).
//
//   node scripts/check-mutation.mjs             # every package in mutation-baseline.json
//   node scripts/check-mutation.mjs --fixture   # the gate's self-test on the known-weak fixture
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function tally(report) {
  const { files } = JSON.parse(readFileSync(report, 'utf8'));
  const mutants = Object.values(files).flatMap((f) => f.mutants);
  const detected = mutants.filter((m) => m.status === 'Killed' || m.status === 'Timeout').length;
  const valid = mutants.filter((m) => !['CompileError', 'RuntimeError', 'Ignored'].includes(m.status)).length;
  return { detected, valid, score: valid === 0 ? 100 : (100 * detected) / valid };
}

if (process.argv.includes('--fixture')) {
  // A gate that reports 100% for everything, or 0%, cannot tell good tests from bad ones.
  const report = join(root, 'scripts/mutation-fixture/reports/mutation/mutation.json');
  if (!existsSync(report)) {
    console.error(`No fixture report at ${report}; run pnpm mutation:fixture`);
    process.exit(1);
  }
  const { detected, valid } = tally(report);
  if (detected === 0 || detected === valid) {
    console.error(`Mutation fixture: ${detected}/${valid} detected. The weak fixture must lose some mutants and keep others, or the gate measures nothing.`);
    process.exit(1);
  }
  console.log(`Mutation fixture: ${detected}/${valid} detected, ${valid - detected} survived, as a weak suite should.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(join(root, 'mutation-baseline.json'), 'utf8'));
const failures = [];

for (const [pkg, minimum] of Object.entries(baseline.packages)) {
  const report = join(root, pkg, 'reports/mutation/mutation.json');
  if (!existsSync(report)) {
    failures.push(`${pkg}: no mutation report at ${report}; run pnpm mutation first`);
    continue;
  }
  const { detected, valid, score } = tally(report);
  const line = `${pkg}: ${score.toFixed(2)}% (${detected}/${valid}), baseline ${minimum}%`;
  if (score + 1e-9 < minimum) failures.push(`${line} — score fell`);
  else console.log(line);
}

if (failures.length > 0) {
  console.error(`Mutation gate failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
