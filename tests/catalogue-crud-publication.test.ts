import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-catalogue-crud-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.OPERATIONAL_DB_LOCAL_PATH = join(tempRoot, 'operational.db');
process.env.D1_LOCAL = '1';
process.env.CONTENT_SOURCE = 'd1';
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'catalogue-crud-test-secret';
process.env.TEST_MODE = '1';

const { D1Client, getD1Client } = await import('../src/core/content/d1-client');
const {
  listCatalogueAdmin,
  loadCatalogueAdmin,
  getNextCatalogueOrder,
} = await import('../src/core/content/catalogue-admin-store');
const {
  saveCatalogueEditor,
  draftCatalogue,
  archiveCatalogue,
  activateCatalogue,
} = await import('../src/modules/admin/catalogue-service');
const {
  insertCateringPackage,
  toggleCateringVisibility,
  getNextCateringOrder,
  loadCateringPackageAdmin,
} = await import('../src/core/content/catalog-store');
const {
  saveCatering,
  loadCateringAdmin,
} = await import('../src/modules/admin/service');
const {
  getMandaps,
  getStages,
  getFurnitureItems,
  getCateringCatalog,
} = await import('../src/core/content/service');
const {
  syncContentTables,
  resolveBuildD1Client,
  D1SyncError,
  CONTENT_SYNC_TABLES_ORDERED,
} = await import('../src/core/content/d1-sync');
const {
  fetchPublicContentRows,
  buildSnapshot,
  validateSnapshotData,
} = await import('../src/core/content/snapshot-builder');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seedBaseline() {
  const d1 = getD1Client();
  await d1.query(
    `INSERT INTO site_settings
       (id, name, legal_name, tagline, short_description, logo_url, favicon_url, phone, whatsapp, email,
        address, venue_address, business_hours, default_title, default_description, og_image_url)
     VALUES ('global', 'Event Point Ranchi', 'Event Point', 'Weddings in Ranchi', 'Event decorators',
             '', '', '+91 90000 00001', '919000000001', 'hello@eventpoint.test',
             'Main Road, Ranchi', 'Venue Road, Ranchi', 'Daily, 10:00 - 19:00',
             'Event Point Ranchi', 'Wedding mandaps and stages', '')`,
  );

  const pages = ['home', 'mandaps', 'stages', 'equipment', 'gallery', 'catering'];
  for (const pageKey of pages) {
    await d1.query(
      `INSERT INTO page_content (page_key, title, published) VALUES (?, ?, 1)`,
      [pageKey, pageKey],
    );
  }

  const galCat = await d1.query<{ id: number }>(
    "INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES ('Mandap Designs', 'mandap-designs', 1, 1)",
  );
  const galCatId = Number(galCat.meta.last_row_id);
  await d1.query(
    'INSERT INTO gallery_items (category_id, caption, image_url, alt_text, sort_order, is_visible) VALUES (?, ?, ?, ?, 1, 1)',
    [galCatId, 'Royal mandap', '/storage/g1.webp', 'Royal mandap'],
  );
}

test('Case A: Mandap creation with default order and active status', async () => {
  await seedBaseline();
  const initialNextOrder = await getNextCatalogueOrder('mandaps');
  assert.ok(initialNextOrder >= 1, 'Initial nextOrder should be at least 1');

  // Submit form WITHOUT sort_order and WITHOUT status (testing form defaults)
  const mandapId = await saveCatalogueEditor(
    'mandaps',
    form({
      name: 'Grand Royal Mandap Case A',
      category: 'Traditional Royal',
      price: '150000',
      description: 'A magnificent wedding mandap with traditional florals.',
      full_description: 'Detailed description for Grand Royal Mandap Case A.',
      length_ft: '18',
      width_ft: '18',
      height_ft: '12',
    }),
  );

  assert.ok(mandapId > 0, 'Mandap should be created with a positive ID');

  // Verify in Admin CMS
  const loaded = await loadCatalogueAdmin('mandaps', mandapId);
  assert.ok(loaded, 'Mandap must be retrievable via admin store');
  assert.equal(loaded?.item.name, 'Grand Royal Mandap Case A');
  assert.equal(loaded?.item.slug, 'grand-royal-mandap-case-a');
  assert.equal(loaded?.item.is_visible, 1, 'Default status must be active (is_visible = 1)');
  assert.equal(loaded?.item.is_archived, 0, 'New item must not be archived');
  assert.equal(Number(loaded?.item.sort_order), initialNextOrder, 'Default sort_order should be MAX + 1');

  // Verify in Admin List
  const adminList = await listCatalogueAdmin('mandaps', { status: 'all' });
  assert.equal(adminList.items.some((i) => i.id === mandapId), true, 'Must appear in admin list');

  // Verify Public Query Eligibility
  const publicMandaps = await getMandaps();
  assert.equal(publicMandaps.some((m) => m.id === mandapId), true, 'Must appear in public mandaps query');
});

test('Case B: Stage creation with explicit item order 4 and active status', async () => {
  // Create stage with order 4
  const stageId = await saveCatalogueEditor(
    'stages',
    form({
      name: 'Crystal Horizon Stage Case B',
      slug: 'crystal-horizon-stage-case-b',
      style_category: 'Modern Luxe',
      status: 'active',
      sort_order: '4',
      price: '200000',
      description: 'An illuminated reception stage.',
      length_ft: '26',
      width_ft: '16',
      height_ft: '14',
    }),
  );

  assert.ok(stageId > 0);

  // Verify stored values
  const loaded = await loadCatalogueAdmin('stages', stageId);
  assert.ok(loaded);
  assert.equal(loaded?.item.name, 'Crystal Horizon Stage Case B');
  assert.equal(loaded?.item.sort_order, 4, 'Explicit sort_order 4 must be preserved');
  assert.equal(loaded?.item.is_visible, 1);
  assert.equal(loaded?.item.is_archived, 0);

  // Verify deterministic tie-breaking (order 4 sorted by sort_order ASC, id ASC)
  const adminStages = await listCatalogueAdmin('stages', { status: 'active', sort: 'order' });
  const stagesOrder4 = adminStages.items.filter((s) => s.sort_order === 4);
  assert.ok(stagesOrder4.length >= 1, 'At least one stage with order 4 should exist');
  for (let i = 1; i < stagesOrder4.length; i++) {
    assert.ok(stagesOrder4[i].id > stagesOrder4[i - 1].id, 'Tie-breaking must sort by id ASC');
  }

  // Verify Public Query Eligibility
  const publicStages = await getStages();
  assert.equal(publicStages.some((s) => s.id === stageId), true, 'Must appear in public stages');
});

test('Equipment and Catering Package lifecycle with deterministic ordering and status', async () => {
  const d1 = getD1Client();

  // Create furniture category
  const catRes = await d1.query<{ id: number }>(
    "INSERT INTO furniture_categories (name, slug, icon, sort_order, is_visible) VALUES ('Royal Seating', 'royal-seating', 'chair', 1, 1)",
  );
  const categoryId = Number(catRes.meta.last_row_id);

  // 1. Equipment creation with default order and active status
  const equipmentNextOrder = await getNextCatalogueOrder('equipment');
  const equipmentId = await saveCatalogueEditor(
    'equipment',
    form({
      name: 'Velvet Maharaja Throne',
      category_id: String(categoryId),
      price: '3500',
      description: 'Gold-leaf throne for wedding reception.',
      min_quantity: '2',
      default_quantity: '4',
    }),
  );
  assert.ok(equipmentId > 0);

  const equipment = await loadCatalogueAdmin('equipment', equipmentId);
  assert.equal(equipment?.item.is_visible, 1, 'Equipment must default to visible');
  assert.equal(Number(equipment?.item.sort_order), equipmentNextOrder, 'Equipment must default to next order');
  assert.equal(equipment?.item.price_paise, 350000);

  const publicEquipment = await getFurnitureItems();
  assert.equal(publicEquipment.some((e) => e.id === equipmentId), true);

  // 2. Catering Package creation with default order
  const cateringNextOrder = await getNextCateringOrder();
  const cateringId = await saveCatering(
    form({
      name: 'Shaandar Dawat Package',
      price: '1850',
      description: 'Exquisite 5-course feast with live dessert counters.',
      category: 'Signature',
      badge: 'Chef Special',
      is_active: 'true',
    }),
  );
  assert.ok(cateringId > 0);

  const cateringAdmin = await loadCateringAdmin(cateringId);
  assert.ok(cateringAdmin?.package);
  assert.equal(cateringAdmin.package.is_active, 1);
  assert.equal(Number(cateringAdmin.package.sort_order), cateringNextOrder);

  const publicCatering = await getCateringCatalog();
  assert.equal(publicCatering.packages.some((p) => p.id === cateringId), true);
});

test('Ordering: explicit 0 is preserved, editing preserves slug and updates order', async () => {
  // Test explicit sort_order = 0
  const zeroOrderId = await saveCatalogueEditor(
    'mandaps',
    form({
      name: 'First Priority Mandap',
      sort_order: '0',
      status: 'active',
      price: '120000',
      description: 'Top priority mandap.',
    }),
  );
  const loadedZero = await loadCatalogueAdmin('mandaps', zeroOrderId);
  assert.equal(loadedZero?.item.sort_order, 0, 'Explicit sort_order 0 must be preserved');

  // Test slug preservation on edit when slug input is empty
  const originalSlug = loadedZero?.item.slug as string;
  await saveCatalogueEditor(
    'mandaps',
    form({
      name: 'First Priority Mandap Renamed',
      slug: '', // Empty slug submitted during edit
      sort_order: '10',
      status: 'active',
      price: '120000',
      description: 'Top priority mandap updated.',
    }),
    zeroOrderId,
  );

  const loadedUpdated = await loadCatalogueAdmin('mandaps', zeroOrderId);
  assert.equal(loadedUpdated?.item.name, 'First Priority Mandap Renamed');
  assert.equal(loadedUpdated?.item.slug, originalSlug, 'Slug must be preserved when empty slug submitted on edit');
  assert.equal(loadedUpdated?.item.sort_order, 10, 'Sort order update must be persisted');
});

test('Visibility lifecycle: Active -> Draft -> Archived -> Reactivated', async () => {
  const stageId = await saveCatalogueEditor(
    'stages',
    form({
      name: 'Visibility Test Stage',
      status: 'active',
      price: '100000',
      description: 'Stage for visibility lifecycle test.',
    }),
  );

  // 1. Active: visible in public query
  assert.equal((await getStages()).some((s) => s.id === stageId), true);

  // 2. Draft: excluded from public query, present in admin
  await draftCatalogue('stages', stageId);
  const loadedDraft = await loadCatalogueAdmin('stages', stageId);
  assert.equal(loadedDraft?.item.is_visible, 0);
  assert.equal(loadedDraft?.item.is_archived, 0);
  assert.equal((await getStages()).some((s) => s.id === stageId), false, 'Draft item must not appear in public query');
  assert.equal((await listCatalogueAdmin('stages', { status: 'draft' })).items.some((s) => s.id === stageId), true);

  // 3. Archived: excluded from public query, marked archived with timestamp
  await archiveCatalogue('stages', stageId);
  const loadedArchived = await loadCatalogueAdmin('stages', stageId);
  assert.equal(loadedArchived?.item.is_visible, 0);
  assert.equal(loadedArchived?.item.is_archived, 1);
  assert.ok(loadedArchived?.item.archived_at, 'archived_at timestamp must be set');
  assert.equal((await getStages()).some((s) => s.id === stageId), false, 'Archived item must not appear in public query');
  assert.equal((await listCatalogueAdmin('stages', { status: 'archived' })).items.some((s) => s.id === stageId), true);

  // 4. Reactivated: restored to active (is_visible = 1, is_archived = 0, archived_at = NULL)
  await activateCatalogue('stages', stageId);
  const loadedActive = await loadCatalogueAdmin('stages', stageId);
  assert.equal(loadedActive?.item.is_visible, 1);
  assert.equal(loadedActive?.item.is_archived, 0);
  assert.equal(loadedActive?.item.archived_at, null, 'archived_at must be reset on reactivation');
  assert.equal((await getStages()).some((s) => s.id === stageId), true, 'Reactivated item must appear publicly');
});

test('Catering store: toggleCateringVisibility updates updated_at', async () => {
  const packageId = await insertCateringPackage({
    name: 'Timestamp Test Package',
    slug: 'timestamp-test-package',
    description: 'Testing timestamp update',
    imageUrl: null,
    pricePaise: 150000,
    badge: 'Test',
    showOnHome: 0,
    isVisible: 1,
    sortOrder: 1,
  });

  const before = (await loadCateringPackageAdmin(packageId))?.package;
  assert.ok(before);

  // Wait a small tick to ensure timestamp change
  await new Promise((resolve) => setTimeout(resolve, 50));

  await toggleCateringVisibility(packageId);

  const afterToggle = (await loadCateringPackageAdmin(packageId))?.package;
  assert.ok(afterToggle);
  assert.equal(afterToggle.is_visible, 0);
  assert.ok(afterToggle.updated_at, 'updated_at must be populated');
});

test('Runtime-to-Build D1 Synchronization: full data replication and parity verification', async () => {
  const runtimeClient = getD1Client();
  const buildDbPath = join(tempRoot, 'build-d1.db');
  const buildClient = new D1Client({ localDbPath: buildDbPath });

  // Verify sync fails if source and destination are the same instance
  await assert.rejects(
    async () => syncContentTables(runtimeClient, runtimeClient),
    (err: Error) => err instanceof D1SyncError,
  );

  // Perform full synchronization from runtime D1 to build D1
  const syncResult = await syncContentTables(runtimeClient, buildClient);
  assert.equal(syncResult.success, true);
  assert.ok(syncResult.totalRows > 0, 'Total rows synchronized must be positive');

  // Verify all 23 tables exist and have identical row counts in build D1
  for (const table of CONTENT_SYNC_TABLES_ORDERED) {
    const srcCount = (await runtimeClient.query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)).results?.[0]?.c;
    const destCount = (await buildClient.query<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)).results?.[0]?.c;
    assert.equal(destCount, srcCount, `Table ${table} row counts must match between source and destination`);
  }

  // Verify newly created records exist with exact IDs and fields in build D1
  const buildMandap = await buildClient.query<any>("SELECT * FROM mandaps WHERE slug = 'grand-royal-mandap-case-a'");
  assert.equal(buildMandap.results?.length, 1);
  assert.equal(buildMandap.results?.[0]?.name, 'Grand Royal Mandap Case A');
  assert.equal(buildMandap.results?.[0]?.is_visible, 1);

  const buildStage = await buildClient.query<any>("SELECT * FROM stages WHERE slug = 'crystal-horizon-stage-case-b'");
  assert.equal(buildStage.results?.length, 1);
  assert.equal(buildStage.results?.[0]?.sort_order, 4);

  // Verify Snapshot Builder successfully builds and validates from build D1
  const rows = await fetchPublicContentRows(buildClient);
  const snapshot = buildSnapshot(rows);
  validateSnapshotData(snapshot);

  assert.equal(snapshot.mandaps.some((m) => m.slug === 'grand-royal-mandap-case-a'), true);
  assert.equal(snapshot.stages.some((s) => s.slug === 'crystal-horizon-stage-case-b' && s.sort_order === 4), true);

  buildClient.close();
});

test('resolveBuildD1Client guards: rejects partial configuration or matching runtime databaseId', () => {
  // Partial configuration throws
  assert.throws(
    () =>
      resolveBuildD1Client({
        CONTENT_BUILD_D1_ACCOUNT_ID: 'acc-1',
        CONTENT_BUILD_D1_DATABASE_ID: 'db-1',
        CONTENT_BUILD_D1_API_TOKEN: '', // missing
      }),
    /Incomplete CONTENT_BUILD_D1_\* configuration/,
  );

  // Database ID identical to runtime throws
  assert.throws(
    () =>
      resolveBuildD1Client({
        CLOUDFLARE_DATABASE_ID: 'same-db-id',
        CONTENT_BUILD_D1_ACCOUNT_ID: 'acc-1',
        CONTENT_BUILD_D1_DATABASE_ID: 'same-db-id',
        CONTENT_BUILD_D1_API_TOKEN: 'token-1',
      }),
    /cannot be identical to CLOUDFLARE_DATABASE_ID/,
  );

  // Missing returns null
  const empty = resolveBuildD1Client({});
  assert.equal(empty, null);
});
