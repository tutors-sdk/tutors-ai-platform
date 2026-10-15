/**
 * The slice of a PostgreSQL client the adapters use. `pg.Pool` and `pg.Client`
 * satisfy it; tests can pass anything that speaks SQL with $n parameters.
 */
export interface SqlClient {
  query<R extends object = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

/** Quotes a schema name after checking it is a plain identifier. */
export function schemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error(`invalid schema name "${schema}"`);
  return `"${schema}"`;
}
