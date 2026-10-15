import { schemaName, type SqlClient } from './sql.ts';

/**
 * Ordered, append-only list of migrations. Never edit one that has shipped;
 * add a new one instead.
 */
const MIGRATIONS: readonly { readonly id: string; readonly up: (s: string) => string }[] = [
  {
    id: '001-evidence-and-memory',
    up: (s) => `
      create table ${s}.evidence (
        sequence     bigserial primary key,
        type         text not null,
        learner_id   text not null,
        session_id   text not null,
        course_id    text not null,
        lab_id       text,
        step_id      text,
        observed_at  timestamptz not null,
        recorded_at  timestamptz not null,
        source       text not null,
        confidence   double precision not null check (confidence >= 0 and confidence <= 1),
        retention    text not null check (retention in ('session', 'course', 'programme')),
        depth        text check (depth in ('redirect', 'hint', 'explanation')),
        detail       jsonb
      );
      create index evidence_course_idx on ${s}.evidence (course_id, sequence);
      create index evidence_learner_idx on ${s}.evidence (learner_id);

      -- Evidence is append-only: rows may be deleted by retention or erasure, never changed.
      create function ${s}.evidence_append_only() returns trigger language plpgsql as $$
      begin
        raise exception 'evidence is append-only';
      end $$;
      create trigger evidence_append_only before update on ${s}.evidence
        for each row execute function ${s}.evidence_append_only();

      create table ${s}.learner_memory (
        id            bigserial primary key,
        learner_id    text not null,
        session_id    text not null,
        course_id     text not null,
        programme_id  text,
        sharing       text not null check (sharing in ('private', 'cohort')),
        recorded_at   timestamptz not null,
        question      text not null,
        answer        text not null
      );
      create index learner_memory_learner_idx on ${s}.learner_memory (learner_id, id);
      create index learner_memory_cohort_idx on ${s}.learner_memory (course_id, id) where sharing = 'cohort';
    `,
  },
  {
    id: '002-memory-retention',
    up: (s) => `
      -- Memory now records the scope it was kept for, so a session or course end can expire it (docs/adr/0004).
      alter table ${s}.learner_memory
        add column retention text not null default 'course' check (retention in ('session', 'course', 'programme'));
      create index learner_memory_session_idx on ${s}.learner_memory (session_id) where retention = 'session';
    `,
  },
  {
    id: '003-insight-runs',
    up: (s) => `
      -- One row per run of the insights worker; insights hold aggregates and sequences, never learner ids.
      create table ${s}.insight_runs (
        id               bigserial primary key,
        course_id        text not null,
        produced_at      timestamptz not null,
        insights         jsonb not null,
        recommendations  jsonb not null
      );
      create index insight_runs_course_idx on ${s}.insight_runs (course_id, produced_at desc, id desc);
    `,
  },
];

/** Applies any migrations not yet recorded in `<schema>.schema_migrations`. Safe to run on every start. */
export async function migrate(client: SqlClient, schema = 'public'): Promise<readonly string[]> {
  const s = schemaName(schema);
  await client.query(`create schema if not exists ${s}`);
  await client.query(`create table if not exists ${s}.schema_migrations (id text primary key, applied_at timestamptz not null default now())`);
  const { rows } = await client.query<{ id: string }>(`select id from ${s}.schema_migrations`);
  const applied = new Set(rows.map((r) => r.id));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await client.query('begin');
    try {
      await client.query(m.up(s));
      await client.query(`insert into ${s}.schema_migrations (id) values ($1)`, [m.id]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
    ran.push(m.id);
  }
  return ran;
}
