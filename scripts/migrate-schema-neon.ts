/**
 * Applies versioned operational-database migrations.
 *
 * This is the only supported way to change the operational schema. Normal
 * requests never perform DDL: they assert the expected columns exist and fail
 * with an actionable message if this script has not been run.
 *
 * Usage:
 *   npm run db:migrate:schema              # report applied/pending migrations
 *   npm run db:migrate:schema -- --apply   # apply pending migrations
 *
 * Deployment order: run `--apply` against the target database *before* the
 * deployment that depends on the new columns receives traffic.
 */
import { getNeonClient, type NeonOperationalClient } from '../src/core/operational/neon-client';
import {
  applyMigrations,
  migrationDialect,
  migrationStatus,
  SCHEMA_MIGRATIONS,
} from '../src/core/operational/migrations';

function describeTarget(client: NeonOperationalClient): string {
  if (!client.isUsingRemote()) return 'local SQLite fallback (development / CI only)';

  let host = 'unknown host';
  try {
    const raw = process.env.DATABASE_URL ?? '';
    const parsed = new URL(raw.replace(/^postgres(ql)?:\/\//, 'http://'));
    host = parsed.hostname;
  } catch {
    // Never print the connection string itself.
  }
  return `Neon PostgreSQL @ ${host}`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const client = getNeonClient();
  const dialect = migrationDialect(client);

  console.log(`Target   : ${describeTarget(client)} (${dialect})`);
  console.log(`Migrations: ${SCHEMA_MIGRATIONS.length}`);

  if (!apply) {
    const status = await migrationStatus(client);
    console.log(`Applied  : ${status.applied.length}${status.applied.length ? ` — ${status.applied.join(', ')}` : ''}`);
    console.log(`Pending  : ${status.pending.length}${status.pending.length ? ` — ${status.pending.join(', ')}` : ''}`);
    if (status.pending.length > 0) {
      console.log('\nNothing changed. Re-run with --apply to apply the pending migrations.');
    }
    return;
  }

  if (process.env.TEST_MODE === '1' && process.env.ALLOW_LIVE_DB_TESTS !== '1' && client.isUsingRemote()) {
    throw new Error('Refusing to migrate a live database during a test run. Unset TEST_MODE or set ALLOW_LIVE_DB_TESTS=1.');
  }

  const result = await applyMigrations(client);
  console.log(`Applied  : ${result.applied.length}${result.applied.length ? ` — ${result.applied.join(', ')}` : ''}`);
  console.log(`Skipped  : ${result.skipped.length}${result.skipped.length ? ` — ${result.skipped.join(', ')}` : ''}`);
  if (result.applied.length === 0) console.log('Schema already up to date.');
}

main()
  .catch((error) => {
    console.error('\nMigration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Local fallback handles are closed by the process exit; the pool is left
    // to the default drain so the CLI exits promptly either way.
  });
