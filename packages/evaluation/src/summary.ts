import type { EvaluationReport } from '@tutors-ai/core';

/** A short, human-readable summary of a report, for CI logs and pull requests. */
export function summarise(report: EvaluationReport): string {
  const passed = report.results.filter((r) => r.passed).length;
  const lines = [
    `Golden set ${report.goldenSet.id} v${report.goldenSet.version}: ${passed}/${report.results.length} passed`,
    `Model ${report.model === null ? 'unknown' : `${report.model.name} (${report.model.digest})`}, prompt ${report.promptVersion ?? 'unknown'}, policies ${report.policyVersions.join(', ') || 'none'}`,
  ];
  for (const r of report.results.filter((x) => !x.passed)) {
    lines.push(`  FAIL ${r.caseId}: ${r.failures.map((f) => `[${f.judge}] ${f.message}`).join('; ')}`);
  }
  const advisory = report.results.flatMap((r) => r.scores.filter((s) => !s.gating).map((s) => `${r.caseId} ${s.judge}=${s.score}`));
  if (advisory.length > 0) lines.push(`Advisory scores (not gating): ${advisory.join(', ')}`);
  if (report.drift !== null) {
    const changed = report.drift.changed.length === 0 ? 'nothing' : report.drift.changed.join(', ');
    lines.push(`Drift since the accepted run (changed: ${changed}): ${report.drift.regressions} regression(s)`);
    for (const c of report.drift.cases.filter((x) => x.drift !== 'still-passing')) lines.push(`  ${c.drift} ${c.caseId}`);
  }
  return lines.join('\n');
}

/** A run is accepted when every case passes and nothing regressed. */
export function accepted(report: EvaluationReport): boolean {
  return report.passed && (report.drift?.regressions ?? 0) === 0;
}
