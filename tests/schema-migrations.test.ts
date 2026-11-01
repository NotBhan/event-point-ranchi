import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedOperationalDb } from './helpers/isolated-db';

useIsolatedOperationalDb('schema-migrations');
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const {
  SCHEMA_MIGRATIONS,
  applyMigrations,
  migrationStatus,
  migrationDialect,
} = await import('../src/core/operational/migrations');

function freshClient() {
  return getNeonClient();
}

test('migration ids are unique and ordered', () => {
  const ids = SCHEMA_MIGRATIONS.map((migration) => migration.id);
  assert.equal(new Set(ids).size, ids.length, 'migration ids must be unique');
  assert.deepEqual(ids, [...ids].sort(), 'migrations must be listed in applied order');
  assert.ok(SCHEMA_MIGRATIONS.every((migration) => migration.description.length > 0));
});

test('status reports every migration as pending before the first run', async () => {
  const client = freshClient();
  // Start from a database where the bookkeeping table does not exist yet.
  await client.query('DROP TABLE IF EXISTS schema_migrations');

  const status = await migrationStatus(client);
  assert.equal(status.dialect, 'sqlite');
  assert.deepEqual(status.applied, []);
  assert.deepEqual(status.pending, SCHEMA_MIGRATIONS.map((migration) => migration.id));
});

test('applying migrations creates the deposit snapshot and the publications ledger', async () => {
  const client = freshClient();
  const result = await applyMigrations(client);
  assert.equal(result.dialect, 'sqlite');
  assert.deepEqual(result.applied, SCHEMA_MIGRATIONS.map((migration) => migration.id));

  const columns = await client.query<{ name: string }>('PRAGMA table_info(bookings)');
  const names = columns.rows.map((row) => row.name);
  assert.ok(names.includes('deposit_type'));
  assert.ok(names.includes('deposit_value'));

  const publications = await client.query('SELECT id FROM content_publications LIMIT 0');
  assert.ok(Array.isArray(publications.rows));
});

test('migrations are idempotent — a second run applies nothing', async () => {
  const client = freshClient();
  const second = await applyMigrations(client);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, SCHEMA_MIGRATIONS.map((migration) => migration.id));

  const status = await migrationStatus(client);
  assert.deepEqual(status.pending, []);
});

test('a migration that has been recorded is not re-executed even if the schema drifted', async () => {
  const client = freshClient();
  // Re-running must not throw even though the columns already exist.
  await applyMigrations(client);
  await applyMigrations(client);

  const recorded = await client.query<{ count: number }>('SELECT COUNT(*) AS count FROM schema_migrations');
  assert.equal(Number(recorded.rows[0].count), SCHEMA_MIGRATIONS.length);
});

test('the dialect is derived from the client, not from configuration', () => {
  const client = freshClient();
  assert.equal(migrationDialect(client), client.isUsingRemote() ? 'postgres' : 'sqlite');
});

test('a missing schema fails with an actionable message instead of running DDL on a request', async () => {
  const { assertBookingDepositColumns } = await import('../src/core/operational/service');
  const client = freshClient();

  // The assertion is memoised per client, so reset the global singleton to get
  // an unverified client, then drop the columns it expects.
  const { resetNeonClient } = await import('../src/core/operational/neon-client');
  await resetNeonClient();

  const { DatabaseSync } = await import('node:sqlite');
  const path = process.env.OPERATIONAL_DB_LOCAL_PATH!;
  const db = new DatabaseSync(path);
  db.exec('DROP INDEX IF EXISTS idx_bookings_deposit_type');
  db.exec('ALTER TABLE bookings DROP COLUMN deposit_type');
  db.exec('ALTER TABLE bookings DROP COLUMN deposit_value');
  db.close();

  await assert.rejects(() => assertBookingDepositColumns(), /db:migrate:schema/);
  assert.ok(client !== null);
});
