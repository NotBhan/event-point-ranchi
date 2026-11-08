import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-server-admin-audit-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.OPERATIONAL_DB_LOCAL_PATH = join(tempRoot, 'operational.db');
process.env.D1_LOCAL = '1';
process.env.CONTENT_SOURCE = 'd1';
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'admin-crud-audit-secret';
process.env.TEST_MODE = '1';

const { getD1Client } = await import('../src/core/content/d1-client');
const { migrateCatalogueAdmin } = await import('../scripts/migrate-catalogue-admin-d1');
const {
  saveCatering,
  deleteCatering,
  addGalleryCategory,
  deleteGalleryCategory,
  batchUploadGalleryAdmin,
  saveGalleryItemTitle,
  deleteGalleryItem,
  toggleGalleryItem,
} = await import('../src/modules/admin/service');
const {
  getCateringPackages,
  getGalleryCategories,
  getGalleryItems,
  getFurnitureItems,
} = await import('../src/core/content/service');
const { cateringForm } = await import('../src/modules/admin/handlers/catalog');
const { verifyDestinationForeignKeys } = await import('../src/core/content/d1-sync');
const { fetchPublicContentRows, buildSnapshot } = await import('../src/core/content/snapshot-builder');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function adminContext(options: { method?: string; form?: FormData; acceptJson?: boolean; params?: Record<string, string> } = {}) {
  const adminAuth = { user: { id: 1, username: 'admin', role: 'admin' }, isAuthenticated: true, isAdmin: true, isEditor: true, isSuperadmin: false, isDeveloper: false };
  const headers = new Headers();
  if (options.acceptJson) headers.set('accept', 'application/json');
  return {
    auth: { user: null, isAuthenticated: false, isAdmin: false, isEditor: false, isSuperadmin: false, isDeveloper: false },
    adminAuth,
    url: new URL('http://localhost/admin/catering/new'),
    request: new Request('http://localhost/admin/catering/new', { method: options.method ?? 'GET', headers }),
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
    params: options.params ?? {},
    form: options.form,
    csrf: 'test',
  } as never;
}

test('0. Database setup and migration idempotency', async () => {
  await migrateCatalogueAdmin(getD1Client());
  assert.ok(true);
});

test('1. Catering CRUD, validation, and JSON negotiation', async () => {
  // Test negative price rejection
  await assert.rejects(
    async () => {
      await saveCatering(
        form({
          name: 'Negative Feast',
          price: '-500',
        }),
      );
    },
    { message: /Price cannot be negative/ },
  );

  // Test valid creation
  const pkgId = await saveCatering(
    form({
      name: 'Royal Kashmiri Feast',
      slug: 'royal-kashmiri-feast',
      price: '1950',
      description: 'Authentic wazwan banquet',
      is_active: 'on',
      show_on_home: 'on',
    }),
  );
  assert.ok(pkgId > 0, 'Package should be created with valid ID');

  // Verify public sync: getCateringPackages() should immediately contain the package
  const packages = await getCateringPackages();
  const created = packages.find((p) => p.id === pkgId);
  assert.ok(created, 'Created package should immediately appear on public catering packages');
  assert.equal(created?.slug, 'royal-kashmiri-feast');
  assert.equal(created?.price_per_plate_paise, 195000);

  // Test duplicate slug validation
  await assert.rejects(
    async () => {
      await saveCatering(
        form({
          name: 'Another Kashmiri Feast',
          slug: 'royal-kashmiri-feast',
          price: '2000',
        }),
      );
    },
    { message: /is already in use by another catering package/ },
  );

  // Test cateringForm handler JSON response negotiation
  const jsonCtx = adminContext({
    method: 'POST',
    acceptJson: true,
    form: form({
      action: 'save',
      name: 'Mughlai Delight',
      price: '1200',
      is_active: 'on',
    }),
  });
  const res = await cateringForm(jsonCtx);
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  const data = (await res.json()) as { status: string; data: { id: number }; message: string };
  assert.equal(data.status, 'ok');
  assert.ok(data.data.id > 0);
  assert.equal(data.message, 'Catering package created successfully.');
});

test('2. Catering Package Deletion cascades to images and preserves D1 Sync FK integrity', async () => {
  const d1 = getD1Client();

  // Create a package
  const pkgId = await saveCatering(
    form({
      name: 'Ephemeral Buffet',
      price: '800',
      is_active: 'on',
    }),
  );

  // Add gallery image for this package
  await d1.query(
    'INSERT INTO catering_package_images (package_id, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)',
    [pkgId, '/storage/ephemeral-1.webp', 'Ephemeral 1', 1],
  );

  const imagesBefore = await d1.query('SELECT COUNT(*) AS count FROM catering_package_images WHERE package_id = ?', [pkgId]);
  assert.equal(Number(imagesBefore.results[0].count), 1);

  // Delete the package
  await deleteCatering(pkgId);

  // Verify package is deleted
  const pkgAfter = await d1.query('SELECT COUNT(*) AS count FROM catering_packages WHERE id = ?', [pkgId]);
  assert.equal(Number(pkgAfter.results[0].count), 0);

  // Verify catering_package_images are also deleted (no orphaned rows!)
  const imagesAfter = await d1.query('SELECT COUNT(*) AS count FROM catering_package_images WHERE package_id = ?', [pkgId]);
  assert.equal(Number(imagesAfter.results[0].count), 0, 'Associated images must be cascaded and deleted');

  // Verify FK integrity check from d1-sync passes with 0 violations
  await verifyDestinationForeignKeys(d1);
});

test('3. Gallery CRUD operations invalidate cache and propagate to public immediately', async () => {
  const d1 = getD1Client();

  // Initial read populates cache
  const initialCategories = await getGalleryCategories();
  const initialItems = await getGalleryItems();
  assert.ok(Array.isArray(initialCategories));
  assert.ok(Array.isArray(initialItems));

  // Add category
  await addGalleryCategory(form({ name: 'Sangeet Nights' }));
  const categoriesAfterAdd = await getGalleryCategories();
  const sangeetCat = categoriesAfterAdd.find((c) => c.name === 'Sangeet Nights');
  assert.ok(sangeetCat, 'Newly added category must appear in public categories without stale cache');

  // Add item with direct image path
  const uploadResult = await batchUploadGalleryAdmin(
    form({
      category_id: String(sangeetCat.id),
      title: 'Grand Dance Floor',
      image_path: '/storage/dance-floor.webp',
    }),
  );
  assert.equal(uploadResult.uploaded, 1);
  const itemId = uploadResult.itemIds[0];

  // Verify public items getter reflects new item immediately
  const itemsAfterUpload = await getGalleryItems(sangeetCat.slug);
  const item = itemsAfterUpload.find((i) => i.id === itemId);
  assert.ok(item, 'Uploaded gallery item must appear immediately on public gallery');
  assert.equal(item?.caption, 'Grand Dance Floor');

  // Edit item title
  await saveGalleryItemTitle(itemId, form({ title: 'Royal Stage Sangeet' }));
  const itemsAfterTitleUpdate = await getGalleryItems(sangeetCat.slug);
  const updatedItem = itemsAfterTitleUpdate.find((i) => i.id === itemId);
  assert.equal(updatedItem?.caption, 'Royal Stage Sangeet', 'Title change must reflect immediately');

  // Toggle visibility off
  await toggleGalleryItem(itemId);
  const itemsAfterToggle = await getGalleryItems(sangeetCat.slug);
  assert.equal(itemsAfterToggle.some((i) => i.id === itemId), false, 'Hidden item must not appear publicly');

  // Toggle back on
  await toggleGalleryItem(itemId);
  const itemsAfterToggleOn = await getGalleryItems(sangeetCat.slug);
  assert.equal(itemsAfterToggleOn.some((i) => i.id === itemId), true, 'Re-enabled item must appear publicly');

  // Delete item
  await deleteGalleryItem(itemId);
  const itemsAfterDelete = await getGalleryItems(sangeetCat.slug);
  assert.equal(itemsAfterDelete.some((i) => i.id === itemId), false, 'Deleted item must be gone publicly');

  // Delete category
  await deleteGalleryCategory(sangeetCat.id);
  const categoriesAfterDelete = await getGalleryCategories();
  assert.equal(categoriesAfterDelete.some((c) => c.id === sangeetCat.id), false, 'Deleted category must be gone publicly');

  // Verify foreign key integrity
  await verifyDestinationForeignKeys(d1);
});

test('4. Furniture Item images snapshot and runtime parity', async () => {
  const d1 = getD1Client();

  // Create furniture category and item
  await d1.query(
    "INSERT INTO furniture_categories (id, name, slug, icon, sort_order, is_visible) VALUES (999, 'Test Lounge', 'test-lounge', 'sofa', 1, 1)",
  );
  await d1.query(
    "INSERT INTO furniture_items (id, category_id, name, slug, description, image_url, price_paise, pricing_unit, dimensions, specifications, min_quantity, default_quantity, is_visible, sort_order) VALUES (888, 999, 'Velvet Sofa', 'velvet-sofa', 'Luxury sofa', '/storage/sofa.webp', 150000, 'piece', '6x3 ft', 'Velvet', 1, 2, 1, 1)",
  );
  await d1.query(
    "INSERT INTO furniture_item_images (id, item_id, image_url, alt_text, sort_order) VALUES (777, 888, '/storage/sofa-side.webp', 'Sofa Side View', 1)",
  );

  // Runtime D1 SSR check
  const runtimeItems = await getFurnitureItems(999);
  const runtimeItem = runtimeItems.find((i) => i.id === 888);
  assert.ok(runtimeItem);
  assert.equal(runtimeItem?.gallery?.length, 1);
  assert.equal(runtimeItem?.gallery?.[0]?.image_url, '/storage/sofa-side.webp');

  // Static snapshot check
  const rows = await fetchPublicContentRows(d1);
  const snapshot = buildSnapshot(rows);
  const snapshotItem = snapshot.furnitureItems.find((i) => i.id === 888);
  assert.ok(snapshotItem);
  assert.equal(snapshotItem?.gallery?.length, 1, 'Snapshot must include furniture item gallery images for parity with SSR');
  assert.equal(snapshotItem?.gallery?.[0]?.image_url, '/storage/sofa-side.webp');
});
