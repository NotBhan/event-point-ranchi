import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-bootstrap-test-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.OPERATIONAL_DB_LOCAL_PATH = join(tempRoot, 'operational.db');
process.env.D1_LOCAL = '1';
process.env.CONTENT_SOURCE = 'd1';
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'bootstrap-test-secret';
process.env.TEST_MODE = '1';

import type { D1Client as D1ClientType } from '../src/core/content/d1-client';

const { D1Client, getD1Client } = await import('../src/core/content/d1-client');
const {
  syncContentTables,
  recordSyncState,
  computeSourceFingerprint,
  CONTENT_SYNC_TABLES_ORDERED,
  D1SyncError,
} = await import('../src/core/content/d1-sync');
const {
  assertContentSyncStateReady,
  ContentBuildSyncStateError,
} = await import('../src/core/content/d1-schema-check');
const { syncContent } = await import('../scripts/sync-content');
const {
  bootstrapBuildD1,
  resolveBootstrapCredentials,
} = await import('../scripts/bootstrap-build-d1');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

async function seedInitialRuntimeContent(d1: D1ClientType) {
  await d1.query(
    `INSERT INTO site_settings
       (id, name, legal_name, tagline, short_description, logo_url, favicon_url, phone, whatsapp, email,
        address, venue_address, business_hours, default_title, default_description, og_image_url)
     VALUES ('global', 'Event Point Bootstrap', 'Event Point', 'Weddings', 'Decor', '', '', '+91 90000 00001',
             '919000000001', 'test@eventpoint.test', 'Ranchi', 'Ranchi', 'Daily', 'Event Point', 'Desc', '')`,
  );

  const pages = ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'];
  for (const p of pages) {
    await d1.query('INSERT INTO page_content (page_key, title, published) VALUES (?, ?, 1)', [p, p]);
  }

  // Seed 2 mandaps
  await d1.query(
    `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
     VALUES ('Royal Mandap', 'royal-mandap', 'Traditional Royal', 15000000, 1, 1)`,
  );
  await d1.query(
    `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
     VALUES ('Floral Mandap', 'floral-mandap', 'Modern Floral', 12000000, 2, 1)`,
  );

  // Seed 2 stages
  await d1.query(
    `INSERT INTO stages (name, slug, style_category, price_starting_paise, sort_order, is_visible)
     VALUES ('Prism Stage', 'prism-stage', 'Modern Luxe', 20000000, 1, 1)`,
  );

  // Seed furniture category and items
  const catRes = await d1.query<{ id: number }>(
    "INSERT INTO furniture_categories (name, slug, icon, sort_order, is_visible) VALUES ('Chairs', 'chairs', 'chair', 1, 1)",
  );
  const catId = Number(catRes.meta.last_row_id);
  await d1.query(
    `INSERT INTO furniture_items (category_id, name, slug, price_paise, sort_order, is_visible)
     VALUES (?, 'Chiavari Chair', 'chiavari-chair', 15000, 1, 1)`,
    [catId],
  );

  // Seed catering package and menu
  const pkgRes = await d1.query<{ id: number }>(
    `INSERT INTO catering_packages (name, slug, price_per_plate_paise, sort_order, is_visible)
     VALUES ('Royal Feast', 'royal-feast', 150000, 1, 1)`,
  );
  const pkgId = Number(pkgRes.meta.last_row_id);
  const secRes = await d1.query<{ id: number }>(
    "INSERT INTO menu_sections (package_id, title, sort) VALUES (?, 'Starters', 1)",
    [pkgId],
  );
  const secId = Number(secRes.meta.last_row_id);
  const menuCatRes = await d1.query<{ id: number }>(
    "INSERT INTO menu_categories (section_id, title, sort) VALUES (?, 'Veg Starters', 1)",
    [secId],
  );
  const menuCatId = Number(menuCatRes.meta.last_row_id);
  await d1.query(
    "INSERT INTO menu_items (category_id, name, is_available, sort) VALUES (?, 'Paneer Tikka', 1, 1)",
    [menuCatId],
  );

  // Seed gallery
  const galCatRes = await d1.query<{ id: number }>(
    "INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES ('Mandap Gallery', 'mandap-gallery', 1, 1)",
  );
  const galCatId = Number(galCatRes.meta.last_row_id);
  await d1.query(
    "INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible) VALUES (?, 'Mandap 1', '/img1.webp', 'Mandap 1', 1, 1)",
    [galCatId],
  );
}

// ---------------------------------------------------------------------------
// 1. First synchronization when _content_sync_state is absent
// ---------------------------------------------------------------------------
test('1. First synchronization initializes _content_sync_state when absent', async () => {
  const runtimeClient = getD1Client();
  await seedInitialRuntimeContent(runtimeClient);

  const destDbPath = join(tempRoot, 'dest-bootstrap-1.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  // Verify _content_sync_state table does not exist initially
  const tableCheck = await destClient.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_content_sync_state'",
  );
  assert.equal(tableCheck.results?.length ?? 0, 0, '_content_sync_state must be absent before first sync');

  // Downstream preflight strictly fails closed when table is absent
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1', { isVercelBuild: true }),
    (err: Error) =>
      err instanceof ContentBuildSyncStateError &&
      err.message.includes('does not contain _content_sync_state table'),
  );

  // Execute first synchronization
  const result = await syncContentTables(runtimeClient, destClient, {
    manifestVersion: 'bootstrap-v1',
  });
  assert.equal(result.success, true);

  // Verify _content_sync_state was created and marked 'ready'
  const stateRow = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(stateRow.results?.length, 1);
  assert.equal(stateRow.results?.[0]?.status, 'ready');
  assert.equal(stateRow.results?.[0]?.manifest_version, 'bootstrap-v1');
  assert.ok(stateRow.results?.[0]?.sync_id, 'Must have a sync_id');
  assert.equal(stateRow.results?.[0]?.error, null);

  // Verify preflight now succeeds
  await assert.doesNotReject(async () => {
    await assertContentSyncStateReady(destClient, 'build-d1', { isVercelBuild: true });
  });

  destClient.close();
});

// ---------------------------------------------------------------------------
// 2. Successful initialization and synchronization
// ---------------------------------------------------------------------------
test('2. Successful initialization verifies full 23-table parity, SHA-256 digests, and foreign keys', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'dest-bootstrap-2.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  const result = await syncContentTables(runtimeClient, destClient);
  assert.equal(result.success, true);
  assert.ok(result.totalRows > 0);

  // Check all 23 tables exist and row counts match
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const rRes = await runtimeClient.query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    const dRes = await destClient.query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    assert.equal(
      Number(dRes.results?.[0]?.count ?? 0),
      Number(rRes.results?.[0]?.count ?? 0),
      `Table count must match for ${table}`,
    );
  }

  // Verify digests match
  const sourceFp = await computeSourceFingerprint(runtimeClient);
  assert.equal(result.fingerprint, sourceFp.fingerprint);
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    assert.equal(result.tableDigests[table], sourceFp.tableDigests[table]);
  }

  destClient.close();
});

// ---------------------------------------------------------------------------
// 3. Failure during initial synchronization
// ---------------------------------------------------------------------------
test('3. Failure during initial synchronization restores destination and marks failed state', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'dest-bootstrap-3.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  // Baseline data in destination before initial sync
  await destClient.query(
    `INSERT INTO site_settings (id, name, legal_name, tagline, short_description, logo_url, favicon_url,
      phone, whatsapp, email, address, venue_address, business_hours, default_title, default_description, og_image_url)
     VALUES ('global', 'Pre-Sync Name', 'Pre-Sync Legal', 'Tag', 'Desc', '', '', '+91 90000 00001',
             '919000000001', 'pre@test.test', 'Ranchi', 'Ranchi', 'Daily', 'Title', 'Desc', '')`,
  );

  // Inject failure during middle copy batch
  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onMiddleCopyBatch: async () => {
          throw new D1SyncError('Simulated network timeout during initial bootstrap');
        },
      });
    },
    (err: Error) => err instanceof D1SyncError && err.message.includes('Simulated network timeout'),
  );

  // Destination baseline restored
  const restoredSetting = await destClient.query<any>("SELECT name FROM site_settings WHERE id = 'global'");
  assert.equal(restoredSetting.results?.[0]?.name, 'Pre-Sync Name');

  // Destination state is marked 'failed'
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');
  assert.match(syncState.results?.[0]?.error, /Simulated network timeout/);

  // Preflight strictly refuses snapshot build
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1', { isVercelBuild: true }),
    (err: Error) => err instanceof ContentBuildSyncStateError && err.message.includes("'failed' state"),
  );

  destClient.close();
});

// ---------------------------------------------------------------------------
// 4. Initial synchronization rollback failure
// ---------------------------------------------------------------------------
test('4. Initial synchronization rollback failure retains dual errors and blocks deployment', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'dest-bootstrap-4.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onBeforeDestClear: async () => {
          throw new D1SyncError('Primary initial sync failure');
        },
        onBeforeRollback: async () => {
          throw new Error('Rollback failure in initial bootstrap');
        },
      });
    },
    (err: Error) =>
      err instanceof D1SyncError &&
      err.message.includes('Primary initial sync failure') &&
      err.message.includes('Rollback failure in initial bootstrap'),
  );

  // Verify _content_sync_state recorded failed with both diagnostics
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');
  assert.match(syncState.results?.[0]?.error, /Primary initial sync failure/);
  assert.match(syncState.results?.[0]?.error, /Rollback failure/);

  destClient.close();
});

// ---------------------------------------------------------------------------
// 5. Build attempted while state is 'syncing'
// ---------------------------------------------------------------------------
test('5. Build attempted while state is syncing is strictly refused', async () => {
  const destDbPath = join(tempRoot, 'dest-bootstrap-5.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  await recordSyncState(destClient, {
    status: 'syncing',
    syncId: 'in-flight-sync-id',
    sourceFingerprint: 'abcd1234',
    totalRows: 10,
    startedAt: new Date().toISOString(),
  });

  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1', { isVercelBuild: true }),
    (err: Error) =>
      err instanceof ContentBuildSyncStateError &&
      err.message.includes("currently in 'syncing' state"),
  );

  destClient.close();
});

// ---------------------------------------------------------------------------
// 6. Build attempted while state is 'failed'
// ---------------------------------------------------------------------------
test('6. Build attempted while state is failed is strictly refused', async () => {
  const destDbPath = join(tempRoot, 'dest-bootstrap-6.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  await recordSyncState(destClient, {
    status: 'failed',
    syncId: 'prior-failure-sync-id',
    sourceFingerprint: 'abcd1234',
    totalRows: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    error: 'Digest mismatch on stages table',
  });

  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1', { isVercelBuild: true }),
    (err: Error) =>
      err instanceof ContentBuildSyncStateError &&
      err.message.includes("is in 'failed' state"),
  );

  destClient.close();
});

// ---------------------------------------------------------------------------
// 7. Build allowed after successful synchronization
// ---------------------------------------------------------------------------
test('7. Build allowed after successful synchronization and generates snapshot', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'dest-bootstrap-7.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  // Synchronize to ready
  await syncContentTables(runtimeClient, destClient);

  // Preflight succeeds
  await assert.doesNotReject(async () => {
    await assertContentSyncStateReady(destClient, 'build-d1', { isVercelBuild: true });
  });

  // Snapshot generation succeeds
  const outputDir = join(tempRoot, 'snapshot-output-7');
  const manifest = await syncContent({ fetcher: destClient, outputDir });
  assert.ok(manifest.contentVersion);
  assert.ok(existsSync(join(outputDir, 'public-content.json')));
  assert.ok(existsSync(join(outputDir, 'manifest.json')));

  destClient.close();
});

// ---------------------------------------------------------------------------
// 8. Repeated synchronization when state table already exists
// ---------------------------------------------------------------------------
test('8. Repeated synchronization updates existing state table idempotently', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'dest-bootstrap-8.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  // 1st sync
  const res1 = await syncContentTables(runtimeClient, destClient, { manifestVersion: 'v1' });
  assert.equal(res1.success, true);
  const state1 = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  const syncId1 = state1.results?.[0]?.sync_id;
  assert.ok(syncId1);

  // Modify source content
  await runtimeClient.query(
    `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
     VALUES ('New Mandap v2', 'new-mandap-v2', 'Traditional', 18000000, 3, 1)`,
  );

  // 2nd sync
  const res2 = await syncContentTables(runtimeClient, destClient, { manifestVersion: 'v2' });
  assert.equal(res2.success, true);
  assert.notEqual(res2.fingerprint, res1.fingerprint);

  const state2 = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(state2.results?.[0]?.status, 'ready');
  assert.equal(state2.results?.[0]?.manifest_version, 'v2');
  assert.notEqual(state2.results?.[0]?.sync_id, syncId1, 'Must have a new unique sync_id');
  assert.equal(state2.results?.[0]?.source_fingerprint, res2.fingerprint);

  // Destination reflects updated content
  const mandapCheck = await destClient.query<any>("SELECT * FROM mandaps WHERE slug = 'new-mandap-v2'");
  assert.equal(mandapCheck.results?.length, 1);

  destClient.close();
});

// ---------------------------------------------------------------------------
// 9. Absent state table never results in unverified snapshot
// ---------------------------------------------------------------------------
test('9. Invariant: Absent state table never allows unverified snapshot generation', async () => {
  const destDbPath = join(tempRoot, 'dest-bootstrap-9.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  // Absent _content_sync_state must throw in Vercel build
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'unbootstrapped-build-d1', { isVercelBuild: true }),
    (err: Error) =>
      err instanceof ContentBuildSyncStateError &&
      err.message.includes('does not contain _content_sync_state table'),
  );

  destClient.close();
});

// ---------------------------------------------------------------------------
// 10. Bootstrap script credentials and isolation guard
// ---------------------------------------------------------------------------
test('10. bootstrapBuildD1 rejects identical source and destination database IDs', () => {
  assert.throws(
    () =>
      resolveBootstrapCredentials({
        CLOUDFLARE_ACCOUNT_ID: 'same-account',
        CLOUDFLARE_DATABASE_ID: 'same-db-uuid',
        CLOUDFLARE_API_TOKEN: 'token',
        CONTENT_BUILD_D1_DATABASE_ID: 'same-db-uuid',
      }),
    /Safety violation: Destination Build D1 database ID.*is identical to source Runtime D1 database ID/,
  );
});

test('11. bootstrapBuildD1 rejects missing destination database ID', () => {
  assert.throws(
    () =>
      resolveBootstrapCredentials(
        {
          CLOUDFLARE_ACCOUNT_ID: 'acct',
          CLOUDFLARE_DATABASE_ID: 'source-db',
          CLOUDFLARE_API_TOKEN: 'token',
        },
        ['node', 'scripts/bootstrap-build-d1.ts'],
      ),
    /Missing destination Build D1 configuration/,
  );
});

test('12. bootstrapBuildD1 executes full verified bootstrap programmatically', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'dest-bootstrap-12.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  const loggedMessages: string[] = [];
  const result = await bootstrapBuildD1({
    sourceClient: runtimeClient,
    destClient,
    sourceIdentity: 'test-runtime',
    destIdentity: 'test-build',
    log: (msg) => loggedMessages.push(msg),
  });

  assert.equal(result.success, true);
  assert.ok(result.totalRows > 0);
  assert.ok(loggedMessages.some((m) => m.includes('Readiness verification PASSED')));

  // Verify post-bootstrap readiness
  await assert.doesNotReject(async () => {
    await assertContentSyncStateReady(destClient, 'test-build', { isVercelBuild: true });
  });

  destClient.close();
});
