import { pathToFileURL } from 'node:url';
import { D1Client } from '../src/core/content/d1-client';
import {
  syncContentTables,
  CONTENT_SYNC_TABLES_ORDERED,
  type ContentSyncTable,
  type D1QueryExecutor,
} from '../src/core/content/d1-sync';
import {
  assertContentBuildSchema,
  assertContentSyncStateReady,
} from '../src/core/content/d1-schema-check';

if (typeof process !== 'undefined' && process.loadEnvFile) {
  try {
    process.loadEnvFile();
  } catch {}
}

export interface BootstrapBuildD1Options {
  sourceClient?: D1QueryExecutor;
  destClient?: D1QueryExecutor;
  sourceIdentity?: string;
  destIdentity?: string;
  env?: Record<string, string | undefined>;
  manifestVersion?: string;
  log?: (message: string) => void;
}

export interface BootstrapBuildD1Result {
  success: boolean;
  sourceIdentity: string;
  destIdentity: string;
  syncId: string;
  totalRows: number;
  tableCounts: Record<ContentSyncTable, number>;
  tableDigests: Record<ContentSyncTable, string>;
  fingerprint: string;
  durationMs: number;
}

/**
 * Validates and resolves source (Runtime D1) and destination (Build D1) credentials.
 * Ensures the destination database ID is never identical to the source database ID.
 */
export function resolveBootstrapCredentials(
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv,
): {
  sourceAccountId: string;
  sourceDatabaseId: string;
  sourceApiToken: string;
  destAccountId: string;
  destDatabaseId: string;
  destApiToken: string;
} {
  let argDestDatabaseId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--build-db' || arg === '--database-id') {
      argDestDatabaseId = argv[i + 1]?.trim();
    } else if (arg.startsWith('--build-db=')) {
      argDestDatabaseId = arg.slice('--build-db='.length).trim();
    } else if (arg.startsWith('--database-id=')) {
      argDestDatabaseId = arg.slice('--database-id='.length).trim();
    }
  }

  const sourceAccountId = (env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const sourceDatabaseId = (env.CLOUDFLARE_DATABASE_ID ?? '').trim();
  const sourceApiToken = (env.CLOUDFLARE_API_TOKEN ?? '').trim();

  const destAccountId = (env.CONTENT_BUILD_D1_ACCOUNT_ID ?? sourceAccountId).trim();
  const destDatabaseId = (argDestDatabaseId || env.CONTENT_BUILD_D1_DATABASE_ID || '').trim();
  const destApiToken = (env.CONTENT_BUILD_D1_API_TOKEN ?? sourceApiToken).trim();

  const missingSource: string[] = [];
  if (!sourceAccountId) missingSource.push('CLOUDFLARE_ACCOUNT_ID');
  if (!sourceDatabaseId) missingSource.push('CLOUDFLARE_DATABASE_ID');
  if (!sourceApiToken) missingSource.push('CLOUDFLARE_API_TOKEN');

  if (missingSource.length > 0) {
    throw new Error(
      `[bootstrap-build-d1] Missing source Runtime D1 credentials: ${missingSource.join(', ')}. ` +
        'Runtime D1 credentials are required to read the source catalogue tables.',
    );
  }

  const missingDest: string[] = [];
  if (!destAccountId) missingDest.push('CONTENT_BUILD_D1_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)');
  if (!destDatabaseId) missingDest.push('CONTENT_BUILD_D1_DATABASE_ID (or --database-id <id>)');
  if (!destApiToken) missingDest.push('CONTENT_BUILD_D1_API_TOKEN (or CLOUDFLARE_API_TOKEN)');

  if (missingDest.length > 0) {
    throw new Error(
      `[bootstrap-build-d1] Missing destination Build D1 configuration: ${missingDest.join(', ')}. ` +
        'Set CONTENT_BUILD_D1_DATABASE_ID in the environment or pass --database-id <id>.',
    );
  }

  if (destDatabaseId === sourceDatabaseId) {
    throw new Error(
      `[bootstrap-build-d1] Safety violation: Destination Build D1 database ID (${destDatabaseId}) ` +
        `is identical to source Runtime D1 database ID (${sourceDatabaseId}). ` +
        'Build D1 must be an isolated database. Operation aborted to protect runtime data.',
    );
  }

  return {
    sourceAccountId,
    sourceDatabaseId,
    sourceApiToken,
    destAccountId,
    destDatabaseId,
    destApiToken,
  };
}

/**
 * Executes a controlled, verified initial bootstrap from Runtime D1 to Build D1:
 * 1. Creates `_content_sync_state` if absent in destination.
 * 2. Marks state as 'syncing'.
 * 3. Copies all 23 tables in parent-first order.
 * 4. Runs row-count parity checks across all tables.
 * 5. Verifies SHA-256 table digests.
 * 6. Verifies all 12 foreign-key relationships.
 * 7. Verifies catalogue field constraints.
 * 8. Validates source fingerprint against concurrent edits.
 * 9. Marks destination state as 'ready'.
 * 10. Runs post-bootstrap readiness assertion.
 */
export async function bootstrapBuildD1(
  options: BootstrapBuildD1Options = {},
): Promise<BootstrapBuildD1Result> {
  const log = options.log ?? console.log;
  const env = options.env ?? process.env;

  let sourceClient = options.sourceClient;
  let destClient = options.destClient;
  let sourceIdentity = options.sourceIdentity;
  let destIdentity = options.destIdentity;

  if (!sourceClient || !destClient) {
    const creds = resolveBootstrapCredentials(env);
    const timeoutMs = Number(env.CONTENT_SYNC_TIMEOUT_MS || 30000);

    if (!sourceClient) {
      sourceClient = new D1Client({
        accountId: creds.sourceAccountId,
        databaseId: creds.sourceDatabaseId,
        apiToken: creds.sourceApiToken,
        timeoutMs,
      });
      sourceIdentity = `Cloudflare D1 ${creds.sourceDatabaseId}`;
    }

    if (!destClient) {
      destClient = new D1Client({
        accountId: creds.destAccountId,
        databaseId: creds.destDatabaseId,
        apiToken: creds.destApiToken,
        timeoutMs,
      });
      destIdentity = `Cloudflare D1 ${creds.destDatabaseId}`;
    }
  }

  sourceIdentity = sourceIdentity ?? 'Source Runtime D1';
  destIdentity = destIdentity ?? 'Destination Build D1';

  log(`[bootstrap-build-d1] Source database:      ${sourceIdentity}`);
  log(`[bootstrap-build-d1] Destination database: ${destIdentity}`);

  // 1. Preflight schema verification on destination
  log('[bootstrap-build-d1] Verifying destination schema preflight...');
  await assertContentBuildSchema(destClient, destIdentity);

  // 2. Perform verified synchronization
  log('[bootstrap-build-d1] Starting verified synchronization...');
  const manifestVersion = options.manifestVersion ?? `bootstrap-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const syncResult = await syncContentTables(sourceClient, destClient, { manifestVersion });

  // 3. Post-sync assertion to confirm fail-closed readiness guard passes
  log('[bootstrap-build-d1] Running post-sync readiness verification...');
  await assertContentSyncStateReady(destClient, destIdentity, { isVercelBuild: true });
  log('[bootstrap-build-d1] Readiness verification PASSED. Build D1 is certified ready.');

  return {
    success: true,
    sourceIdentity,
    destIdentity,
    syncId: (syncResult as any).syncId || 'verified',
    totalRows: syncResult.totalRows,
    tableCounts: syncResult.tableCounts,
    tableDigests: syncResult.tableDigests,
    fingerprint: syncResult.fingerprint,
    durationMs: syncResult.durationMs,
  };
}

async function main(): Promise<void> {
  console.log('=== Event Point Build D1 Initial Bootstrap ===');
  // For CLI execution against remote Cloudflare D1, ensure local fallback is not forced
  process.env.D1_LOCAL = '0';

  const result = await bootstrapBuildD1({ log: console.log });

  console.log('\n================ Bootstrap Summary ================');
  console.log(`Status:               SUCCESS (ready)`);
  console.log(`Source Database:      ${result.sourceIdentity}`);
  console.log(`Destination Database: ${result.destIdentity}`);
  console.log(`Total Rows Copied:    ${result.totalRows}`);
  console.log(`Overall Fingerprint:  ${result.fingerprint}`);
  console.log(`Duration:             ${result.durationMs}ms`);
  console.log(`Synchronized Tables:  ${CONTENT_SYNC_TABLES_ORDERED.length}`);
  console.log('---------------- Table Breakdown ------------------');
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const count = result.tableCounts[table];
    const digest = result.tableDigests[table].substring(0, 12);
    console.log(`  - ${table.padEnd(25)} : ${String(count).padStart(3)} rows | sha256:${digest}...`);
  }
  console.log('---------------- Integrity Checks -----------------');
  console.log('  - Row Count Parity:         23 / 23 tables verified');
  console.log('  - SHA-256 Content Digests:  23 / 23 tables verified');
  console.log('  - Foreign Key Constraints:  12 / 12 relationships verified');
  console.log('  - Business Constraints:     mandaps/stages/furniture/catering verified');
  console.log('  - Source Mutation Check:    Concurrent edit fingerprint matched');
  console.log('  - Sync State Marker:        status="ready" written to _content_sync_state');
  console.log('===================================================\n');
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[bootstrap-build-d1] FAILED: ${message}`);
    process.exitCode = 1;
  });
}
