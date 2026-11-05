export interface SchemaQueryClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ results: T[] }>;
}

export interface D1ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
}

export class ContentBuildSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentBuildSchemaError';
  }
}

/**
 * Read-only preflight for the build-time content database. It runs before the
 * large catalogue batch so a missing additive migration fails with an
 * actionable message instead of a generic D1 SQL error.
 */
export async function assertContentBuildSchema(
  client: SchemaQueryClient,
  databaseIdentity: string,
): Promise<void> {
  const result = await client.query<D1ColumnInfo>('PRAGMA table_info(menu_items)');
  const sort = (result.results ?? []).find((column) => column.name === 'sort');

  if (!sort) {
    throw new ContentBuildSchemaError(
      `[sync:content] D1 schema preflight failed for ${databaseIdentity}: missing menu_items.sort. ` +
        'Apply the additive migration with `npm run db:migrate:catalogue-admin` to the intended isolated build D1, ' +
        'then rerun the build. The build never migrates a remote database automatically.',
    );
  }

  const type = String(sort.type ?? '').trim().toUpperCase();
  const notNull = Number(sort.notnull);
  const defaultValue = String(sort.dflt_value ?? '').trim();
  if (type !== 'INTEGER' || notNull !== 1 || defaultValue !== '0') {
    throw new ContentBuildSchemaError(
      `[sync:content] D1 schema preflight failed for ${databaseIdentity}: menu_items.sort must be ` +
        `INTEGER NOT NULL DEFAULT 0 (found ${type || 'unknown'}, notnull=${notNull}, default=${defaultValue || 'none'}). ` +
        'Apply the reviewed migration to the intended isolated build D1; do not alter the build to bypass this check.',
    );
  }
}
