import { D1Client, getD1Client } from './d1-client';

export const CONTENT_SYNC_TABLES_ORDERED = [
  'site_settings',
  'page_content',
  'seo_settings',
  'homepage_sections',
  'services',
  'video_previews',
  'mandaps',
  'mandap_gallery',
  'stages',
  'stage_gallery',
  'furniture_categories',
  'furniture_items',
  'furniture_item_images',
  'catering_packages',
  'catering_package_images',
  'catering_features',
  'banner_features',
  'guest_pricing',
  'menu_sections',
  'menu_categories',
  'menu_items',
  'gallery_categories',
  'gallery_items',
] as const;

export type ContentSyncTable = (typeof CONTENT_SYNC_TABLES_ORDERED)[number];

export interface D1QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ results?: T[]; meta?: any }>;
  batch<T = Record<string, unknown>>(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<Array<{ results?: T[] }>>;
}

export interface SyncD1Result {
  success: boolean;
  tableCounts: Record<ContentSyncTable, number>;
  totalRows: number;
  durationMs: number;
}

export interface SyncD1SkippedResult {
  success: true;
  skipped: true;
  reason: string;
}

export class D1SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'D1SyncError';
  }
}

export class D1SyncParityError extends D1SyncError {
  public readonly table: string;
  public readonly sourceCount: number;
  public readonly destCount: number;

  constructor(table: string, sourceCount: number, destCount: number) {
    super(
      `[d1-sync] Parity check failed for table "${table}": source has ${sourceCount} rows, destination has ${destCount} rows.`,
    );
    this.name = 'D1SyncParityError';
    this.table = table;
    this.sourceCount = sourceCount;
    this.destCount = destCount;
  }
}

function cleanParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Synchronizes all content and catalogue tables from source D1 to destination D1.
 *
 * Requirements:
 * - Deterministic, parent-first insertion and child-first deletion to preserve foreign key constraints.
 * - Preserves all IDs, column data, ordering, and visibility.
 * - Batches INSERT statements into chunks (50 statements per batch) to respect D1 payload limits.
 * - Verifies row count parity across all tables after completion.
 * - Strictly prevents copying when source and destination are identical instances.
 */
export async function syncContentTables(
  source: D1QueryExecutor,
  dest: D1QueryExecutor,
): Promise<SyncD1Result> {
  if (source === dest) {
    throw new D1SyncError('Source and destination D1 executors cannot be the same instance.');
  }

  const startTime = Date.now();
  const tableCounts = {} as Record<ContentSyncTable, number>;
  let totalRows = 0;

  // 1. Fetch all rows from source for every table
  const tableData = new Map<ContentSyncTable, Array<Record<string, unknown>>>();
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const res = await source.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    const rows = (res.results ?? []).map((row) => ({ ...row }));
    tableData.set(table, rows);
    tableCounts[table] = rows.length;
    totalRows += rows.length;
  }

  // 2. Clear destination in reverse dependency order (children before parents)
  const reverseTables = [...CONTENT_SYNC_TABLES_ORDERED].reverse();
  for (const table of reverseTables) {
    await dest.query(`DELETE FROM ${table}`);
  }

  // 3. Insert rows into destination in dependency order (parents before children)
  const BATCH_CHUNK_SIZE = 50;
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const rows = tableData.get(table) ?? [];
    if (rows.length === 0) continue;

    const statements: Array<{ sql: string; params: unknown[] }> = [];
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
      const params = columns.map((col) => cleanParam(row[col]));
      statements.push({ sql, params });
    }

    for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
      const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE);
      await dest.batch(chunk);
    }
  }

  // 4. Verify count parity for every table
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const expected = tableCounts[table];
    const checkRes = await dest.query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    const actual = Number(checkRes.results?.[0]?.count ?? 0);
    if (actual !== expected) {
      throw new D1SyncParityError(table, expected, actual);
    }
  }

  return {
    success: true,
    tableCounts,
    totalRows,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Resolves a dedicated D1 client for build D1 using CONTENT_BUILD_D1_* environment variables.
 * Returns null if no build D1 credentials are configured.
 * Throws if configuration is partial or matches the runtime database ID.
 */
export function resolveBuildD1Client(
  env: Record<string, string | undefined> = process.env,
): D1Client | null {
  const accountId = (env.CONTENT_BUILD_D1_ACCOUNT_ID ?? '').trim();
  const databaseId = (env.CONTENT_BUILD_D1_DATABASE_ID ?? '').trim();
  const apiToken = (env.CONTENT_BUILD_D1_API_TOKEN ?? '').trim();

  const anyConfigured = Boolean(accountId || databaseId || apiToken);
  const allConfigured = Boolean(accountId && databaseId && apiToken);

  if (anyConfigured && !allConfigured) {
    throw new D1SyncError(
      '[d1-sync] Incomplete CONTENT_BUILD_D1_* configuration. All of CONTENT_BUILD_D1_ACCOUNT_ID, CONTENT_BUILD_D1_DATABASE_ID, and CONTENT_BUILD_D1_API_TOKEN must be set.',
    );
  }

  if (!allConfigured) {
    return null;
  }

  const runtimeDbId = (env.CLOUDFLARE_DATABASE_ID ?? '').trim();
  if (runtimeDbId && databaseId === runtimeDbId) {
    throw new D1SyncError(
      '[d1-sync] CONTENT_BUILD_D1_DATABASE_ID cannot be identical to CLOUDFLARE_DATABASE_ID. Build D1 must be an isolated database.',
    );
  }

  return new D1Client({
    accountId,
    databaseId,
    apiToken,
    timeoutMs: Number(env.CONTENT_SYNC_TIMEOUT_MS || 20000),
  });
}

/**
 * Synchronizes the runtime D1 catalogue tables to the dedicated build D1.
 * If dedicated build D1 credentials are not present, reports skipped without failing.
 */
export async function syncRuntimeToBuildD1(options?: {
  sourceClient?: D1QueryExecutor;
  destClient?: D1QueryExecutor;
  env?: Record<string, string | undefined>;
}): Promise<SyncD1Result | SyncD1SkippedResult> {
  const env = options?.env ?? process.env;
  const source = options?.sourceClient ?? getD1Client();
  const dest = options?.destClient ?? resolveBuildD1Client(env);

  if (!dest) {
    return {
      success: true,
      skipped: true,
      reason: 'CONTENT_BUILD_D1_* credentials not configured; build D1 synchronization skipped.',
    };
  }

  return syncContentTables(source, dest);
}
