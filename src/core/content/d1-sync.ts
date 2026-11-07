import { createHash, randomUUID } from 'node:crypto';
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
  tableDigests: Record<ContentSyncTable, string>;
  fingerprint: string;
  totalRows: number;
  durationMs: number;
}

export interface SyncD1SkippedResult {
  success: true;
  skipped: true;
  reason: string;
}

export interface SyncContentOptions {
  manifestVersion?: string;
  onBeforeDestClear?: () => Promise<void> | void;
  onMiddleCopyBatch?: (table: string, batchIndex: number) => Promise<void> | void;
  onBeforeIntegrityVerify?: (dest: D1QueryExecutor) => Promise<void> | void;
  onBeforeFinalFingerprint?: (source: D1QueryExecutor) => Promise<void> | void;
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

export class D1SyncIntegrityError extends D1SyncError {
  constructor(message: string) {
    super(message);
    this.name = 'D1SyncIntegrityError';
  }
}

export class D1SyncConcurrentEditError extends D1SyncError {
  constructor(message: string) {
    super(message);
    this.name = 'D1SyncConcurrentEditError';
  }
}

function cleanParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Computes a deterministic SHA-256 digest of table rows.
 * Rows and columns are sorted canonically to guarantee reproducibility.
 */
export function computeTableDigest(rows: Array<Record<string, unknown>>): string {
  const sortedRows = [...rows].sort((a, b) => {
    const keyA = String(a.id ?? a.page_key ?? a.sectionKey ?? a.key ?? JSON.stringify(a));
    const keyB = String(b.id ?? b.page_key ?? b.sectionKey ?? b.key ?? JSON.stringify(b));
    return keyA.localeCompare(keyB);
  });

  const lines = sortedRows.map((row) => {
    const sortedKeys = Object.keys(row).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      let val = row[key];
      if (val === undefined) val = null;
      if (typeof val === 'boolean') val = val ? 1 : 0;
      normalized[key] = val;
    }
    return JSON.stringify(normalized);
  });

  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Reads all rows from source for all 23 tables and computes both per-table
 * digests and an overall SHA-256 fingerprint of the entire content snapshot.
 */
export async function computeSourceFingerprint(source: D1QueryExecutor): Promise<{
  fingerprint: string;
  tableDigests: Record<ContentSyncTable, string>;
  tableCounts: Record<ContentSyncTable, number>;
  totalRows: number;
  tableData: Map<ContentSyncTable, Array<Record<string, unknown>>>;
}> {
  const tableData = new Map<ContentSyncTable, Array<Record<string, unknown>>>();
  const tableDigests = {} as Record<ContentSyncTable, string>;
  const tableCounts = {} as Record<ContentSyncTable, number>;
  let totalRows = 0;

  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const res = await source.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    const rows = (res.results ?? []).map((row) => ({ ...row }));
    tableData.set(table, rows);
    tableCounts[table] = rows.length;
    totalRows += rows.length;
    tableDigests[table] = computeTableDigest(rows);
  }

  const overallHash = createHash('sha256');
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    overallHash.update(`${table}:${tableDigests[table]}\n`);
  }
  const fingerprint = overallHash.digest('hex');

  return { fingerprint, tableDigests, tableCounts, totalRows, tableData };
}

/**
 * Captures an in-memory snapshot of all destination tables prior to synchronization.
 * Used to roll back destination in case of any failure.
 */
export async function captureDestinationSnapshot(
  dest: D1QueryExecutor,
): Promise<Map<ContentSyncTable, Array<Record<string, unknown>>>> {
  const snapshot = new Map<ContentSyncTable, Array<Record<string, unknown>>>();
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    try {
      const res = await dest.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
      snapshot.set(table, (res.results ?? []).map((r) => ({ ...r })));
    } catch {
      snapshot.set(table, []);
    }
  }
  return snapshot;
}

/**
 * Restores destination tables from an in-memory snapshot in parent-first order.
 */
export async function restoreDestinationSnapshot(
  dest: D1QueryExecutor,
  snapshot: Map<ContentSyncTable, Array<Record<string, unknown>>>,
): Promise<void> {
  const reverseTables = [...CONTENT_SYNC_TABLES_ORDERED].reverse();
  for (const table of reverseTables) {
    await dest.query(`DELETE FROM ${table}`).catch(() => {});
  }

  const BATCH_CHUNK_SIZE = 50;
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const rows = snapshot.get(table) ?? [];
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
}

/**
 * Creates the _content_sync_state metadata table in destination if it does not exist.
 */
export async function ensureSyncStateTable(dest: D1QueryExecutor): Promise<void> {
  await dest.query(`
    CREATE TABLE IF NOT EXISTS _content_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      sync_id TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      manifest_version TEXT,
      total_rows INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT
    )
  `);
}

/**
 * Atomically updates the singleton sync state row in destination D1.
 */
export async function recordSyncState(
  dest: D1QueryExecutor,
  data: {
    status: 'syncing' | 'ready' | 'failed';
    syncId: string;
    sourceFingerprint: string;
    manifestVersion?: string;
    totalRows?: number;
    startedAt?: string;
    completedAt?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await ensureSyncStateTable(dest);
  await dest.query('DELETE FROM _content_sync_state WHERE id = 1');
  await dest.query(
    `INSERT INTO _content_sync_state
       (id, status, sync_id, source_fingerprint, manifest_version, total_rows, started_at, completed_at, error)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.status,
      data.syncId,
      data.sourceFingerprint,
      data.manifestVersion ?? null,
      data.totalRows ?? 0,
      data.startedAt ?? new Date().toISOString(),
      data.completedAt ?? null,
      data.error ?? null,
    ],
  );
}

/**
 * Verifies that every destination table produces the exact same SHA-256 digest as the source.
 */
export async function verifyDestinationIntegrity(
  dest: D1QueryExecutor,
  expectedDigests: Record<ContentSyncTable, string>,
): Promise<void> {
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const res = await dest.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    const rows = res.results ?? [];
    const actualDigest = computeTableDigest(rows);
    const expectedDigest = expectedDigests[table];
    if (actualDigest !== expectedDigest) {
      throw new D1SyncIntegrityError(
        `[d1-sync] Content digest mismatch for table "${table}": expected ${expectedDigest}, found ${actualDigest}.`,
      );
    }
  }
}

export const FK_INTEGRITY_CHECKS: Array<{ name: string; table: string; query: string }> = [
  {
    name: 'mandap_gallery -> mandaps',
    table: 'mandap_gallery',
    query: 'SELECT COUNT(*) AS count FROM mandap_gallery WHERE mandap_id NOT IN (SELECT id FROM mandaps)',
  },
  {
    name: 'stage_gallery -> stages',
    table: 'stage_gallery',
    query: 'SELECT COUNT(*) AS count FROM stage_gallery WHERE stage_id NOT IN (SELECT id FROM stages)',
  },
  {
    name: 'furniture_items -> furniture_categories',
    table: 'furniture_items',
    query:
      'SELECT COUNT(*) AS count FROM furniture_items WHERE category_id IS NOT NULL AND category_id NOT IN (SELECT id FROM furniture_categories)',
  },
  {
    name: 'furniture_item_images -> furniture_items',
    table: 'furniture_item_images',
    query: 'SELECT COUNT(*) AS count FROM furniture_item_images WHERE item_id NOT IN (SELECT id FROM furniture_items)',
  },
  {
    name: 'catering_package_images -> catering_packages',
    table: 'catering_package_images',
    query:
      'SELECT COUNT(*) AS count FROM catering_package_images WHERE package_id NOT IN (SELECT id FROM catering_packages)',
  },
  {
    name: 'catering_features -> catering_packages',
    table: 'catering_features',
    query:
      'SELECT COUNT(*) AS count FROM catering_features WHERE package_id NOT IN (SELECT id FROM catering_packages)',
  },
  {
    name: 'banner_features -> catering_packages',
    table: 'banner_features',
    query: 'SELECT COUNT(*) AS count FROM banner_features WHERE package_id NOT IN (SELECT id FROM catering_packages)',
  },
  {
    name: 'guest_pricing -> catering_packages',
    table: 'guest_pricing',
    query: 'SELECT COUNT(*) AS count FROM guest_pricing WHERE package_id NOT IN (SELECT id FROM catering_packages)',
  },
  {
    name: 'menu_sections -> catering_packages',
    table: 'menu_sections',
    query: 'SELECT COUNT(*) AS count FROM menu_sections WHERE package_id NOT IN (SELECT id FROM catering_packages)',
  },
  {
    name: 'menu_categories -> menu_sections',
    table: 'menu_categories',
    query: 'SELECT COUNT(*) AS count FROM menu_categories WHERE section_id NOT IN (SELECT id FROM menu_sections)',
  },
  {
    name: 'menu_items -> menu_categories',
    table: 'menu_items',
    query: 'SELECT COUNT(*) AS count FROM menu_items WHERE category_id NOT IN (SELECT id FROM menu_categories)',
  },
  {
    name: 'gallery_items -> gallery_categories',
    table: 'gallery_items',
    query: 'SELECT COUNT(*) AS count FROM gallery_items WHERE category_id NOT IN (SELECT id FROM gallery_categories)',
  },
];

/**
 * Verifies foreign key referential integrity across all relationships in destination D1.
 */
export async function verifyDestinationForeignKeys(dest: D1QueryExecutor): Promise<void> {
  for (const check of FK_INTEGRITY_CHECKS) {
    const res = await dest.query<{ count: number }>(check.query);
    const count = Number(res.results?.[0]?.count ?? 0);
    if (count > 0) {
      throw new D1SyncIntegrityError(
        `[d1-sync] Foreign key integrity violation in destination: ${count} orphaned rows in "${check.table}" (${check.name}).`,
      );
    }
  }
}

/**
 * Verifies catalogue field constraints in destination D1.
 */
export async function verifyDestinationCatalogueFields(dest: D1QueryExecutor): Promise<void> {
  const queries = [
    {
      table: 'mandaps',
      query: 'SELECT COUNT(*) AS count FROM mandaps WHERE price_starting_paise < 0 OR sort_order IS NULL',
    },
    {
      table: 'stages',
      query: 'SELECT COUNT(*) AS count FROM stages WHERE price_starting_paise < 0 OR sort_order IS NULL',
    },
    {
      table: 'furniture_items',
      query: 'SELECT COUNT(*) AS count FROM furniture_items WHERE price_paise < 0 OR sort_order IS NULL',
    },
    {
      table: 'catering_packages',
      query: 'SELECT COUNT(*) AS count FROM catering_packages WHERE price_per_plate_paise < 0 OR sort_order IS NULL',
    },
  ];

  for (const q of queries) {
    const res = await dest.query<{ count: number }>(q.query);
    const count = Number(res.results?.[0]?.count ?? 0);
    if (count > 0) {
      throw new D1SyncIntegrityError(
        `[d1-sync] Field constraint violation in destination: found ${count} invalid rows in "${q.table}" (negative price or null sort_order).`,
      );
    }
  }
}

/**
 * Synchronizes all content and catalogue tables from source D1 to destination D1 with
 * comprehensive atomicity, integrity verification, concurrent edit safeguards, and rollback.
 */
export async function syncContentTables(
  source: D1QueryExecutor,
  dest: D1QueryExecutor,
  options?: SyncContentOptions,
): Promise<SyncD1Result> {
  if (source === dest) {
    throw new D1SyncError('Source and destination D1 executors cannot be the same instance.');
  }

  const startTime = Date.now();
  const syncId = randomUUID();
  const startedAt = new Date().toISOString();

  // 1. Fetch all rows from source and compute initial fingerprint
  const {
    fingerprint: initialFingerprint,
    tableDigests: sourceTableDigests,
    tableCounts,
    totalRows,
    tableData,
  } = await computeSourceFingerprint(source);

  // 2. Snapshot current destination state prior to any modification
  const destSnapshot = await captureDestinationSnapshot(dest);

  // 3. Record 'syncing' status in destination
  await recordSyncState(dest, {
    status: 'syncing',
    syncId,
    sourceFingerprint: initialFingerprint,
    manifestVersion: options?.manifestVersion,
    totalRows,
    startedAt,
  });

  try {
    if (options?.onBeforeDestClear) {
      await options.onBeforeDestClear();
    }

    // 4. Clear destination in reverse dependency order (children before parents)
    const reverseTables = [...CONTENT_SYNC_TABLES_ORDERED].reverse();
    for (const table of reverseTables) {
      await dest.query(`DELETE FROM ${table}`);
    }

    // 5. Insert rows into destination in dependency order (parents before children)
    const BATCH_CHUNK_SIZE = 50;
    let batchCounter = 0;
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
        batchCounter++;
        if (options?.onMiddleCopyBatch) {
          await options.onMiddleCopyBatch(table, batchCounter);
        }
        const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE);
        await dest.batch(chunk);
      }
    }

    // 6. Verify count parity for every table
    for (const table of CONTENT_SYNC_TABLES_ORDERED) {
      const expected = tableCounts[table];
      const checkRes = await dest.query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
      const actual = Number(checkRes.results?.[0]?.count ?? 0);
      if (actual !== expected) {
        throw new D1SyncParityError(table, expected, actual);
      }
    }

    if (options?.onBeforeIntegrityVerify) {
      await options.onBeforeIntegrityVerify(dest);
    }

    // 7. Verify SHA-256 table digests
    await verifyDestinationIntegrity(dest, sourceTableDigests);

    // 8. Verify Foreign Key relationships & catalogue fields
    await verifyDestinationForeignKeys(dest);
    await verifyDestinationCatalogueFields(dest);

    if (options?.onBeforeFinalFingerprint) {
      await options.onBeforeFinalFingerprint(source);
    }

    // 9. Re-check source fingerprint for concurrent modifications
    const finalSourceCheck = await computeSourceFingerprint(source);
    if (finalSourceCheck.fingerprint !== initialFingerprint) {
      throw new D1SyncConcurrentEditError(
        `[d1-sync] Concurrent catalogue edit detected in source during synchronization. ` +
          `Initial fingerprint: ${initialFingerprint.substring(0, 8)}, final: ${finalSourceCheck.fingerprint.substring(0, 8)}. ` +
          'Aborting synchronization to prevent torn publication.',
      );
    }

    // 10. Mark destination 'ready'
    const completedAt = new Date().toISOString();
    await recordSyncState(dest, {
      status: 'ready',
      syncId,
      sourceFingerprint: initialFingerprint,
      manifestVersion: options?.manifestVersion,
      totalRows,
      startedAt,
      completedAt,
      error: null,
    });

    return {
      success: true,
      tableCounts,
      tableDigests: sourceTableDigests,
      fingerprint: initialFingerprint,
      totalRows,
      durationMs: Date.now() - startTime,
    };
  } catch (syncError) {
    const errorMessage = syncError instanceof Error ? syncError.message : String(syncError);
    console.error(`[d1-sync] Synchronization error: ${errorMessage}. Rolling back destination to pre-sync state...`);
    try {
      await restoreDestinationSnapshot(dest, destSnapshot);
      console.log('[d1-sync] Destination successfully restored to pre-sync state.');
    } catch (rollbackError) {
      console.error(
        `[d1-sync] Destination rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }

    // Ensure destination sync state reflects failed status
    await recordSyncState(dest, {
      status: 'failed',
      syncId,
      sourceFingerprint: initialFingerprint,
      manifestVersion: options?.manifestVersion,
      totalRows,
      startedAt,
      completedAt: new Date().toISOString(),
      error: errorMessage,
    }).catch(() => {});

    throw syncError;
  }
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
  manifestVersion?: string;
  onBeforeDestClear?: () => Promise<void> | void;
  onMiddleCopyBatch?: (table: string, batchIndex: number) => Promise<void> | void;
  onBeforeIntegrityVerify?: (dest: D1QueryExecutor) => Promise<void> | void;
  onBeforeFinalFingerprint?: (source: D1QueryExecutor) => Promise<void> | void;
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

  return syncContentTables(source, dest, options);
}
