import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-failure-injection-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.OPERATIONAL_DB_LOCAL_PATH = join(tempRoot, 'operational.db');
process.env.D1_LOCAL = '1';
process.env.CONTENT_SOURCE = 'd1';
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'failure-injection-test-secret';
process.env.TEST_MODE = '1';

import type { D1Client as D1ClientType } from '../src/core/content/d1-client';

const { D1Client, getD1Client } = await import('../src/core/content/d1-client');
const {
  syncContentTables,
  recordSyncState,
  D1SyncError,
  D1SyncIntegrityError,
  D1SyncConcurrentEditError,
} = await import('../src/core/content/d1-sync');
const {
  assertContentSyncStateReady,
  ContentBuildSyncStateError,
} = await import('../src/core/content/d1-schema-check');
const {
  createPublication,
  getPublication,
  listActivePublications,
  markDeploying,
  markBuilt,
  markPublished,
  markFailed,
  refreshPublicationStatuses,
  assertPublicationsTable,
} = await import('../src/core/operational/publication-service');
const { getNeonClient } = await import('../src/core/operational/neon-client');
const { syncContent } = await import('../scripts/sync-content');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

async function seedInitialRuntimeContent(d1: D1ClientType) {
  await d1.query(
    `INSERT INTO site_settings
       (id, name, legal_name, tagline, short_description, logo_url, favicon_url, phone, whatsapp, email,
        address, venue_address, business_hours, default_title, default_description, og_image_url)
     VALUES ('global', 'Event Point Test', 'Event Point', 'Weddings', 'Decor', '', '', '+91 90000 00001',
             '919000000001', 'test@eventpoint.test', 'Ranchi', 'Ranchi', 'Daily', 'Event Point', 'Desc', '')`,
  );

  const pages = ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'];
  for (const p of pages) {
    await d1.query('INSERT INTO page_content (page_key, title, published) VALUES (?, ?, 1)', [p, p]);
  }

  // Seed 2 mandaps
  await d1.query(
    `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
     VALUES ('Royal Rajwada Mandap', 'royal-rajwada-mandap', 'Traditional Royal', 15000000, 1, 1)`,
  );
  await d1.query(
    `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
     VALUES ('Floral Bloom Mandap', 'floral-bloom-mandap', 'Modern Floral', 12000000, 2, 1)`,
  );

  // Seed 2 stages
  await d1.query(
    `INSERT INTO stages (name, slug, style_category, price_starting_paise, sort_order, is_visible)
     VALUES ('Grand Prism Stage', 'grand-prism-stage', 'Modern Luxe', 20000000, 1, 1)`,
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

async function seedBaselineDestination(dest: D1ClientType) {
  // Pre-populate destination with known baseline data so we can verify rollback
  await dest.query(
    `INSERT INTO site_settings
       (id, name, legal_name, tagline, short_description, logo_url, favicon_url, phone, whatsapp, email,
        address, venue_address, business_hours, default_title, default_description, og_image_url)
     VALUES ('global', 'Pre-Sync Name', 'Pre-Sync Legal', 'Weddings', 'Decor', '', '', '+91 90000 00001',
             '919000000001', 'test@eventpoint.test', 'Ranchi', 'Ranchi', 'Daily', 'Pre-Sync Title', 'Desc', '')`,
  );
  await dest.query(
    `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
     VALUES ('Old Mandap', 'old-mandap', 'Traditional Royal', 10000000, 1, 1)`,
  );
}

test('1. Failure during destination table clearing triggers full rollback and marks failed state', async () => {
  const runtimeClient = getD1Client();
  await seedInitialRuntimeContent(runtimeClient);

  const destDbPath = join(tempRoot, 'fail-clear-dest.db');
  const destClient = new D1Client({ localDbPath: destDbPath });
  await seedBaselineDestination(destClient);

  // Verify baseline exists
  const baselineMandap = await destClient.query<any>("SELECT * FROM mandaps WHERE slug = 'old-mandap'");
  assert.equal(baselineMandap.results?.length, 1);

  // Inject failure right before destination clearing
  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onBeforeDestClear: async () => {
          throw new D1SyncError('Simulated network disruption during destination clear');
        },
      });
    },
    (err: Error) => err instanceof D1SyncError && err.message.includes('Simulated network disruption'),
  );

  // Verify destination snapshot was restored to pre-sync state
  const restoredMandap = await destClient.query<any>("SELECT * FROM mandaps WHERE slug = 'old-mandap'");
  assert.equal(restoredMandap.results?.length, 1, 'Pre-sync mandap must be restored');
  assert.equal(restoredMandap.results?.[0]?.name, 'Old Mandap');

  // Verify _content_sync_state is marked 'failed'
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');
  assert.match(syncState.results?.[0]?.error, /Simulated network disruption/);

  // Verify downstream snapshot preflight strictly refuses to proceed
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1'),
    (err: Error) => err instanceof ContentBuildSyncStateError && err.message.includes("'failed' state"),
  );

  destClient.close();
});

test('2. Failure during middle copy batch triggers complete rollback to pre-sync state', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'fail-middle-batch-dest.db');
  const destClient = new D1Client({ localDbPath: destDbPath });
  await seedBaselineDestination(destClient);

  // Inject failure during copying of furniture_items (child table)
  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onMiddleCopyBatch: async (table: string) => {
          if (table === 'furniture_items') {
            throw new D1SyncError('Simulated D1 rate limit / payload timeout on furniture_items batch');
          }
        },
      });
    },
    (err: Error) => err instanceof D1SyncError && err.message.includes('furniture_items batch'),
  );

  // Assert destination is NOT left in a half-populated or dirty state
  // Pre-sync rows must be fully intact
  const restoredMandap = await destClient.query<any>("SELECT * FROM mandaps WHERE slug = 'old-mandap'");
  assert.equal(restoredMandap.results?.length, 1, 'Baseline rows must be restored');

  // Any partially copied source rows must NOT exist in destination
  const partialSourceMandap = await destClient.query<any>(
    "SELECT * FROM mandaps WHERE slug = 'royal-rajwada-mandap'",
  );
  assert.equal(partialSourceMandap.results?.length, 0, 'Partial source rows must not remain');

  // Verify _content_sync_state recorded the failure
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');

  // Snapshot generation must refuse
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1'),
    (err: Error) => err instanceof ContentBuildSyncStateError,
  );

  destClient.close();
});

test('3. Failure during integrity verification (tampered data detected) rolls back destination', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'fail-integrity-dest.db');
  const destClient = new D1Client({ localDbPath: destDbPath });
  await seedBaselineDestination(destClient);

  // Tamper with destination data right before integrity verification runs
  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onBeforeIntegrityVerify: async (dest) => {
          // Mutate a mandap name, corrupting SHA-256 digest
          await dest.query(
            "UPDATE mandaps SET name = 'Corrupted In-Flight Name' WHERE slug = 'royal-rajwada-mandap'",
          );
        },
      });
    },
    (err: Error) => err instanceof D1SyncIntegrityError && err.message.includes('Content digest mismatch'),
  );

  // Assert rollback restored the baseline
  const baseline = await destClient.query<any>("SELECT * FROM mandaps WHERE slug = 'old-mandap'");
  assert.equal(baseline.results?.length, 1);

  // Assert sync state is failed
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');

  destClient.close();
});

test('4. Source data changing during synchronization is detected by before/after fingerprint', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'fail-concurrent-edit-dest.db');
  const destClient = new D1Client({ localDbPath: destDbPath });
  await seedBaselineDestination(destClient);

  // Simulate an administrator concurrently inserting a new mandap in runtime D1 during sync
  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onBeforeFinalFingerprint: async (source) => {
          await source.query(
            `INSERT INTO mandaps (name, slug, category, price_starting_paise, sort_order, is_visible)
             VALUES ('Concurrent Midnight Mandap', 'concurrent-midnight-mandap', 'Traditional Royal', 18000000, 5, 1)`,
          );
        },
      });
    },
    (err: Error) =>
      err instanceof D1SyncConcurrentEditError &&
      err.message.includes('Concurrent catalogue edit detected in source during synchronization'),
  );

  // Destination rolled back to pre-sync state
  const baseline = await destClient.query<any>("SELECT * FROM mandaps WHERE slug = 'old-mandap'");
  assert.equal(baseline.results?.length, 1);

  // The admin's concurrent edit in runtime D1 is completely safe and intact
  const runtimeMandap = await runtimeClient.query<any>(
    "SELECT * FROM mandaps WHERE slug = 'concurrent-midnight-mandap'",
  );
  assert.equal(runtimeMandap.results?.length, 1, 'Admin edit in runtime D1 must remain safe');

  // Destination sync state is failed
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');

  destClient.close();
});

test('5. Deploy hook returning an error records failed state and releases publication lock', async () => {
  const neon = getNeonClient();
  await assertPublicationsTable(neon);

  // Acquire publication lock
  const pubRes = await createPublication({
    requestedBy: 1,
    requestedByName: 'Test Admin',
    requestedVersion: 'v1.0.0-test5',
  });
  assert.equal(pubRes.created, true);
  assert.ok(pubRes.publication);
  const pubId = pubRes.publication.id;

  // Verify lock is held
  const activeBefore = await listActivePublications(neon);
  assert.equal(activeBefore.some((p) => p.id === pubId), true);

  // Simulate deploy hook rejection (HTTP 500)
  const hookError = 'The Vercel deploy hook rejected the request (status 500).';
  await markFailed(pubId, hookError, neon);

  // Verify publication status is failed with exact error recorded
  const pubAfter = await getPublication(pubId, neon);
  assert.equal(pubAfter?.status, 'failed');
  assert.equal(pubAfter?.error, hookError);
  assert.ok(pubAfter?.completed_at, 'completed_at must be populated');

  // Verify publication lock is completely released
  const activeAfter = await listActivePublications(neon);
  assert.equal(activeAfter.some((p) => p.id === pubId), false, 'Lock must be freed');
});

test('6. Deployment build failing after hook succeeds transitions to failed and unlocks', async () => {
  const neon = getNeonClient();
  const pubRes = await createPublication({
    requestedBy: 1,
    requestedByName: 'Test Admin',
    requestedVersion: 'v1.0.0-test6',
  });
  assert.equal(pubRes.created, true);
  const pubId = pubRes.publication!.id;

  // Deploy hook succeeds
  await markDeploying(pubId, { deployHookStatus: 201, deploymentUrl: 'https://preview-test6.vercel.app' }, neon);
  assert.equal((await getPublication(pubId, neon))?.status, 'deploying');

  // Post-build webhook marks built
  await markBuilt(pubId, { builtVersion: 'v1.0.0-test6', deploymentId: 'dpl_test6' }, neon);
  assert.equal((await getPublication(pubId, neon))?.status, 'built');

  // Mock Vercel reporting deployment failure (ERROR state)
  process.env.VERCEL_API_TOKEN = 'mock-token';
  process.env.VERCEL_PROJECT_ID = 'mock-project';

  const mockFetcher = async () => {
    return new Response(
      JSON.stringify({
        deployments: [
          {
            uid: 'dpl_test6',
            url: 'preview-test6.vercel.app',
            state: 'ERROR',
            errorMessage: 'Astro build failed: missing public snapshot',
            createdAt: Date.now(),
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const refreshResult = await refreshPublicationStatuses(neon, mockFetcher as any);
  assert.equal(refreshResult.updated, 1);

  // Verify publication is marked failed with Vercel error
  const pubFailed = await getPublication(pubId, neon);
  assert.equal(pubFailed?.status, 'failed');
  assert.equal(pubFailed?.error, 'Astro build failed: missing public snapshot');
  assert.ok(pubFailed?.completed_at);

  // Verify lock is released
  const active = await listActivePublications(neon);
  assert.equal(active.some((p) => p.id === pubId), false);
});

test('7. Publication ledger state remains accurate across all failure scenarios', async () => {
  const neon = getNeonClient();
  const pubRes = await createPublication({
    requestedBy: 2,
    requestedByName: 'Auditor',
    requestedVersion: 'v1.0.0-audit',
  });
  assert.equal(pubRes.created, true);
  const pubId = pubRes.publication!.id;

  // Simulate D1 synchronization failure
  const syncFailureMsg = 'D1 synchronization failed: foreign key violation in stage_gallery';
  await markFailed(pubId, syncFailureMsg, neon);

  const publication = await getPublication(pubId, neon);
  assert.equal(publication?.id, pubId);
  assert.equal(publication?.status, 'failed');
  assert.equal(publication?.requested_version, 'v1.0.0-audit');
  assert.equal(publication?.error, syncFailureMsg);
  assert.ok(publication?.requested_at);
  assert.ok(publication?.completed_at);

  // Ensure no active publications exist in ledger
  const active = await listActivePublications(neon);
  assert.equal(active.length, 0);
});

test('8. Subsequent publication recovers correctly after prior failure', async () => {
  const runtimeClient = getD1Client();
  const neon = getNeonClient();

  const destDbPath = join(tempRoot, 'recovery-build-d1.db');
  const destClient = new D1Client({ localDbPath: destDbPath });

  // 1. Prior failure: dest is in 'failed' state
  await recordSyncState(destClient, {
    status: 'failed',
    syncId: 'failed-sync-id',
    sourceFingerprint: 'dummy-fingerprint',
    totalRows: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    error: 'Prior batch write timeout',
  });

  // Verify build preflight blocks this failed state
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'recovery-build-d1'),
    (err: Error) => err instanceof ContentBuildSyncStateError,
  );

  // 2. New publication request is initiated
  const pubRes = await createPublication({
    requestedBy: 1,
    requestedByName: 'Test Admin',
    requestedVersion: 'v2.0.0-recovered',
  });
  assert.equal(pubRes.created, true, 'Subsequent publication must not be blocked');
  const pubId = pubRes.publication!.id;

  // 3. Synchronization executes cleanly
  const syncResult = await syncContentTables(runtimeClient, destClient, {
    manifestVersion: 'v2.0.0-recovered',
  });
  assert.equal(syncResult.success, true);
  assert.ok(syncResult.totalRows > 0);

  // 4. Verify dest sync state is now 'ready'
  const stateRow = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(stateRow.results?.[0]?.status, 'ready');
  assert.equal(stateRow.results?.[0]?.error, null);

  // 5. Build preflight now succeeds without error
  await assert.doesNotReject(async () => assertContentSyncStateReady(destClient, 'recovery-build-d1'));

  // 6. Snapshot generation succeeds from build D1
  const outputDir = join(tempRoot, 'snapshot-recovery-out');
  const manifest = await syncContent({
    fetcher: destClient,
    outputDir,
    generatedAt: new Date().toISOString(),
  });
  assert.ok(manifest.contentVersion);
  assert.ok(manifest.counts.mandaps >= 2);

  // 7. Complete publication lifecycle: deploying -> built -> published
  await markDeploying(pubId, { deployHookStatus: 200, deploymentUrl: 'https://eventpoint-recovered.vercel.app' }, neon);
  await markBuilt(pubId, { builtVersion: 'v2.0.0-recovered', deploymentId: 'dpl_recovered' }, neon);
  await markPublished(pubId, { publishedVersion: 'v2.0.0-recovered', deploymentId: 'dpl_recovered' }, neon);

  const finalPub = await getPublication(pubId, neon);
  assert.equal(finalPub?.status, 'published');
  assert.equal(finalPub?.published_version, 'v2.0.0-recovered');
  assert.equal(finalPub?.error, '');

  destClient.close();
});

test('9. Rollback failure retains both original and rollback errors and leaves destination marked unsafe', async () => {
  const runtimeClient = getD1Client();
  const destDbPath = join(tempRoot, 'fail-rollback-dest.db');
  const destClient = new D1Client({ localDbPath: destDbPath });
  await seedBaselineDestination(destClient);

  // Both sync fails AND rollback fails
  await assert.rejects(
    async () => {
      await syncContentTables(runtimeClient, destClient, {
        onBeforeDestClear: async () => {
          throw new D1SyncError('Primary sync clearing failed');
        },
        onBeforeRollback: async () => {
          throw new Error('Secondary rollback connection dropped');
        },
      });
    },
    (err: Error) => {
      assert.ok(err instanceof D1SyncError);
      assert.match(err.message, /Primary sync clearing failed/);
      assert.match(err.message, /Rollback also failed: Secondary rollback connection dropped/);
      return true;
    },
  );

  // Verify _content_sync_state contains BOTH errors in diagnostic information
  const syncState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(syncState.results?.[0]?.status, 'failed');
  assert.match(syncState.results?.[0]?.error, /Primary sync clearing failed/);
  assert.match(syncState.results?.[0]?.error, /Rollback also failed: Secondary rollback connection dropped/);

  // Destination strictly blocks snapshot generation
  await assert.rejects(
    async () => assertContentSyncStateReady(destClient, 'build-d1'),
    (err: Error) => err instanceof ContentBuildSyncStateError && err.message.includes("'failed' state"),
  );

  // Subsequent publication recovers cleanly without touching Production
  const recoveredResult = await syncContentTables(runtimeClient, destClient);
  assert.equal(recoveredResult.success, true);
  const recoveredState = await destClient.query<any>('SELECT * FROM _content_sync_state WHERE id = 1');
  assert.equal(recoveredState.results?.[0]?.status, 'ready');
  assert.equal(recoveredState.results?.[0]?.error, null);

  destClient.close();
});

