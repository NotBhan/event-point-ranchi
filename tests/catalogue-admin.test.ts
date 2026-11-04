import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-catalogue-admin-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.OPERATIONAL_DB_LOCAL_PATH = join(tempRoot, 'operational.db');
process.env.D1_LOCAL = '1';
process.env.CONTENT_SOURCE = 'd1';
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'catalogue-admin-test-secret';
process.env.TEST_MODE = '1';

const { getD1Client } = await import('../src/core/content/d1-client');
const { migrateCatalogueAdmin } = await import('../scripts/migrate-catalogue-admin-d1');
const {
  addCatalogueImage,
  listCatalogueAdmin,
  loadCatalogueAdmin,
  moveCatalogueImage,
  updateCatalogueImage,
} = await import('../src/core/content/catalogue-admin-store');
const {
  archiveCatalogue,
  activateCatalogue,
  duplicateCatalogue,
  saveCatalogueEditor,
} = await import('../src/modules/admin/catalogue-service');
const { getMandaps } = await import('../src/core/content/service');
const { catalogueList } = await import('../src/modules/admin/handlers/catalogue');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function adminContext(search = '') {
  return {
    auth: { isAdmin: true, isEditor: true },
    url: new URL(`http://localhost/admin/mandaps${search}`),
    request: new Request('http://localhost/admin/mandaps'),
    cookies: {},
    csrf: 'test',
  } as never;
}

test('catalogue D1 migration is idempotent', async () => {
  const first = await migrateCatalogueAdmin(getD1Client());
  const second = await migrateCatalogueAdmin(getD1Client());
  assert.deepEqual(first.addedColumns, []);
  assert.deepEqual(second.addedColumns, []);
  const columns = await getD1Client().query<{ name: string }>('PRAGMA table_info(furniture_items)');
  assert.equal(columns.results.some((column) => column.name === 'is_archived'), true);
  const images = await getD1Client().query("SELECT name FROM sqlite_master WHERE type='table' AND name='catering_package_images'");
  assert.equal(images.results.length, 1);
});

test('creates, lists, archives, reactivates and duplicates a mandap', async () => {
  const mandapId = await saveCatalogueEditor(
    'mandaps',
    form({
      name: 'Test Heritage Mandap',
      slug: 'test-heritage-mandap',
      category: 'Traditional Royal',
      status: 'active',
      price: '250000',
      description: 'A carved mandap.',
      full_description: 'A full description for the public detail page.',
      length_ft: '20',
      width_ft: '18',
      height_ft: '14',
      features: 'Carved pillars\nFloral canopy',
      sort_order: '4',
    }),
  );

  const listed = await listCatalogueAdmin('mandaps', { status: 'active' });
  assert.equal(listed.items.some((item) => item.id === mandapId && item.name === 'Test Heritage Mandap'), true);
  const loaded = await loadCatalogueAdmin('mandaps', mandapId);
  assert.equal(loaded?.item.slug, 'test-heritage-mandap');
  assert.equal(loaded?.item.price_starting_paise, 25_000_000);
  assert.equal(loaded?.item.full_description, 'A full description for the public detail page.');

  const publicMandaps = await getMandaps();
  assert.equal(publicMandaps.some((item) => item.id === mandapId), true);

  await archiveCatalogue('mandaps', mandapId);
  assert.equal((await getMandaps()).some((item) => item.id === mandapId), false);
  assert.equal((await listCatalogueAdmin('mandaps', { status: 'archived' })).items.some((item) => item.id === mandapId), true);

  await activateCatalogue('mandaps', mandapId);
  assert.equal((await getMandaps()).some((item) => item.id === mandapId), true);

  const duplicateId = await duplicateCatalogue('mandaps', mandapId);
  const duplicate = await loadCatalogueAdmin('mandaps', duplicateId);
  assert.equal(duplicate?.item.name, 'Test Heritage Mandap (copy)');
  assert.notEqual(duplicate?.item.slug, 'test-heritage-mandap');
  assert.equal(duplicate?.item.is_visible, 0);
});

test('creates stage and equipment records with category and price', async () => {
  const category = await getD1Client().query(
    "INSERT INTO furniture_categories (name, slug, icon, sort_order, is_visible) VALUES ('Test Chairs', 'test-chairs', 'chair', 1, 1)",
  );
  const categoryId = Number(category.meta.last_row_id);

  const stageId = await saveCatalogueEditor(
    'stages',
    form({
      name: 'Test Stage',
      slug: 'test-stage',
      style_category: 'Royal Reception',
      status: 'active',
      price: '0',
      pricing_mode: 'on_request',
      description: 'Test stage',
    }),
  );
  assert.ok(stageId > 0);

  const equipmentId = await saveCatalogueEditor(
    'equipment',
    form({
      name: 'Test Chair',
      slug: 'test-chair',
      category_id: String(categoryId),
      status: 'active',
      price: '450',
      description: 'Test chair',
      specifications: 'Gold finish',
      min_quantity: '4',
      default_quantity: '8',
    }),
  );
  const equipment = await loadCatalogueAdmin('equipment', equipmentId);
  assert.equal(equipment?.item.price_paise, 45000);
  assert.equal(equipment?.item.category_id, categoryId);
});

test('image records support alt text and ordering without deleting storage', async () => {
  const itemId = await saveCatalogueEditor(
    'mandaps',
    form({ name: 'Image Mandap', slug: 'image-mandap', status: 'draft', price: '0' }),
  );
  const first = await addCatalogueImage('mandaps', itemId, '/storage/assets/mandaps/test/one.webp', 'One');
  const second = await addCatalogueImage('mandaps', itemId, '/storage/assets/mandaps/test/two.webp', 'Two');
  await updateCatalogueImage('mandaps', first, 'Updated alt');
  await moveCatalogueImage('mandaps', second, 'up');
  const loaded = await loadCatalogueAdmin('mandaps', itemId);
  assert.equal(loaded?.images.length, 2);
  assert.equal(loaded?.images.some((image) => image.alt_text === 'Updated alt'), true);
});

test('catalogue handlers require admin and return awaited props', async () => {
  const denied = await catalogueList(
    {
      auth: { isAdmin: false, isEditor: false },
      url: new URL('http://localhost/admin/mandaps'),
      request: new Request('http://localhost/admin/mandaps'),
      cookies: {},
      csrf: 'test',
    } as never,
    'mandaps',
  );
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 303);

  const result = await catalogueList(adminContext(), 'mandaps');
  assert.ok(!(result instanceof Response));
  assert.ok(Array.isArray(result.props?.items));
  assert.ok(result.props.items.length > 0);
});
