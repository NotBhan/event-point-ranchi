export interface SchemaQueryClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ results?: T[] }>;
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

export class ContentBuildSyncStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentBuildSyncStateError';
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

/**
 * Verifies that the build-time content database has a valid and completed
 * synchronization state (_content_sync_state status === 'ready').
 *
 * If the database is currently in 'syncing', has failed ('failed'), or is in any
 * other unverified state, snapshot generation is strictly refused to prevent
 * publishing a partial or corrupt catalogue.
 */
export async function assertContentSyncStateReady(
  client: SchemaQueryClient,
  databaseIdentity: string,
  options?: { isVercelBuild?: boolean },
): Promise<void> {
  let tableInfo: { results?: D1ColumnInfo[] };
  try {
    tableInfo = await client.query<D1ColumnInfo>('PRAGMA table_info(_content_sync_state)');
  } catch {
    return;
  }

  const hasTable = (tableInfo.results ?? []).length > 0;
  if (!hasTable) {
    if (options?.isVercelBuild) {
      throw new ContentBuildSyncStateError(
        `[sync:content] Build D1 database (${databaseIdentity}) does not contain _content_sync_state table. ` +
          'The runtime-to-build D1 synchronization has never been run or failed before completion. ' +
          'Publish changes from the admin CMS to synchronize build D1 before deploying.',
      );
    }
    return;
  }

  const res = await client.query<{ status: string; sync_id: string; error?: string }>(
    'SELECT status, sync_id, error FROM _content_sync_state WHERE id = 1 LIMIT 1',
  );
  const row = res.results?.[0];
  if (!row) {
    if (options?.isVercelBuild) {
      throw new ContentBuildSyncStateError(
        `[sync:content] Build D1 database (${databaseIdentity}) has an empty _content_sync_state table. ` +
          'Build D1 must have a verified "ready" status before generating a public snapshot.',
      );
    }
    return;
  }

  if (row.status === 'syncing') {
    throw new ContentBuildSyncStateError(
      `[sync:content] Build D1 database (${databaseIdentity}) is currently in 'syncing' state (sync_id: ${row.sync_id}). ` +
        'Refusing to generate public content snapshot from an in-flight synchronization.',
    );
  }

  if (row.status === 'failed') {
    throw new ContentBuildSyncStateError(
      `[sync:content] Build D1 database (${databaseIdentity}) is in 'failed' state (sync_id: ${row.sync_id}, error: ${row.error || 'unknown'}). ` +
        'Refusing to generate public content snapshot from a failed synchronization. Re-publish from admin to resolve.',
    );
  }

  if (row.status !== 'ready') {
    throw new ContentBuildSyncStateError(
      `[sync:content] Build D1 database (${databaseIdentity}) is not in 'ready' state (status: ${row.status}).`,
    );
  }
}
