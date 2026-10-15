import { DEFAULT_INSIGHT_THRESHOLDS, type InsightThresholds } from '@tutors-ai/core';

export interface Config {
  readonly pgUrl: string;
  readonly pgSchema: string;
  /** Course exports; every course found there is analysed unless COURSE_IDS narrows it. */
  readonly courseExportDir: string;
  readonly courseIds: readonly string[] | undefined;
  readonly thresholds: InsightThresholds;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Env = Readonly<Record<string, string | undefined>>;

function share(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!(value >= 0 && value <= 1)) throw new ConfigError(`${key} must be a share between 0 and 1, got "${raw}"`);
  return value;
}

/** Reads and validates configuration, failing fast with the problem named. */
export function readConfig(env: Env): Config {
  const pgUrl = env['PG_URL']?.trim() ?? '';
  if (pgUrl === '') throw new ConfigError('PG_URL is required');
  const courseExportDir = env['COURSE_EXPORT_DIR']?.trim() ?? '';
  if (courseExportDir === '') throw new ConfigError('COURSE_EXPORT_DIR is required');
  const ids = env['COURSE_IDS']?.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const rawMin = env['INSIGHTS_MIN_COHORT']?.trim();
  const minCohort = rawMin === undefined || rawMin === '' ? DEFAULT_INSIGHT_THRESHOLDS.minCohort : Number(rawMin);
  // Below three learners an aggregate all but names someone.
  if (!Number.isInteger(minCohort) || minCohort < 3) throw new ConfigError('INSIGHTS_MIN_COHORT must be an integer of at least 3');
  const d = DEFAULT_INSIGHT_THRESHOLDS;
  return {
    pgUrl,
    pgSchema: env['PG_SCHEMA']?.trim() || 'public',
    courseExportDir,
    courseIds: ids === undefined || ids.length === 0 ? undefined : ids,
    thresholds: {
      minCohort,
      stallShare: share(env, 'INSIGHTS_STALL_SHARE', d.stallShare),
      helpShare: share(env, 'INSIGHTS_HELP_SHARE', d.helpShare),
      completionShare: share(env, 'INSIGHTS_COMPLETION_SHARE', d.completionShare),
      explanationShare: share(env, 'INSIGHTS_EXPLANATION_SHARE', d.explanationShare),
    },
  };
}
