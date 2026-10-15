import { anEvidence, evidenceStoreContract, FixedClock, learnerMemoryContract } from '@tutors-ai/testing';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate, PostgresEvidenceStore, PostgresLearnerMemory } from '../src/index.ts';

// Runs both kits against a real PostgreSQL. CI starts one; locally:
//   PG_URL=postgres://postgres@localhost:5432/postgres pnpm test:integration
// Every test gets a fresh schema, so runs never see each other's rows.

const url = process.env.PG_URL;
const pool = url === undefined ? undefined : new pg.Pool({ connectionString: url, max: 4 });
const schemas: string[] = [];

async function freshSchema(): Promise<string> {
  const schema = `kit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  schemas.push(schema);
  await migrate(pool as pg.Pool, schema);
  return schema;
}

afterAll(async () => {
  if (pool === undefined) return;
  for (const s of schemas) await pool.query(`drop schema if exists "${s}" cascade`);
  await pool.end();
});

if (pool !== undefined) {
  evidenceStoreContract('PostgresEvidenceStore', {
    store: async () => new PostgresEvidenceStore(pool, new FixedClock(), await freshSchema()),
  });
  learnerMemoryContract('PostgresLearnerMemory', {
    memory: async () => new PostgresLearnerMemory(pool, await freshSchema()),
  });
}

describe.skipIf(pool === undefined)('PostgreSQL specifics', () => {
  it('refuses to change stored evidence, even through SQL', async () => {
    const schema = await freshSchema();
    const store = new PostgresEvidenceStore(pool as pg.Pool, new FixedClock(), schema);
    await store.append(anEvidence());
    await expect((pool as pg.Pool).query(`update "${schema}".evidence set confidence = 0`)).rejects.toThrow('append-only');
  });

  it('applies each migration once', async () => {
    const schema = await freshSchema();
    expect(await migrate(pool as pg.Pool, schema)).toEqual([]);
  });

  it('enforces the evidence vocabulary in the table as well as in the core', async () => {
    const schema = await freshSchema();
    const store = new PostgresEvidenceStore(pool as pg.Pool, new FixedClock(), schema);
    await expect(store.append(anEvidence({ confidence: 2 }))).rejects.toThrow();
    await expect(store.append(anEvidence({ retention: 'none' }))).rejects.toThrow();
  });
});
