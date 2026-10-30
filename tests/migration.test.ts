import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.sql?raw')) {
      const sql = readFileSync(fileURLToPath(url), 'utf8');
      return {
        format: 'module',
        source: `export default ${JSON.stringify(sql)};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-migration-test-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'migration-test-secret';

const { GET } = await import('../src/pages/storage/[...path]');
const { getFilebaseClient, resetFilebaseClient } = await import('../src/core/storage/filebase');
const { INITIAL_STORAGE_OBJECTS } = await import('../src/core/storage/initial-storage-objects');
const { seedDatabase } = await import('../src/core/seed');
const schemaSql = (await import('../src/core/schema.sql?raw')).default;
const { initStorageSchema } = await import('../src/core/storage/schema');

after(() => {
  resetFilebaseClient();
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
});

test('1. edge delivery endpoint returns 200 with proper headers for existing objects', async () => {
  const client = getFilebaseClient();
  const testKey = 'assets/banners/mandaps/banner-hero.webp';
  const testBody = Buffer.from('RIFF....WEBPfakeimagebytes');

  await client.putObject({
    key: testKey,
    body: testBody,
    contentType: 'image/webp',
  });

  const request = new Request(`http://localhost:4321/storage/${testKey}`);
  const response = await GET({
    params: { path: testKey },
    request,
  } as never);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('content-length'), String(testBody.length));
  assert.ok(response.headers.get('etag'));
  assert.ok(response.headers.get('cache-control')?.includes('immutable'));

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(buffer, testBody);
});

test('2. edge delivery endpoint returns 304 Not Modified when ETag matches If-None-Match', async () => {
  const client = getFilebaseClient();
  const testKey = 'assets/halls/1/primary.webp';
  const testBody = Buffer.from('RIFF....WEBPprimaryhall1');

  const { etag } = await client.putObject({
    key: testKey,
    body: testBody,
    contentType: 'image/webp',
  });

  const quotedEtag = `"${etag.replace(/"/g, '')}"`;
  const request = new Request(`http://localhost:4321/storage/${testKey}`, {
    headers: { 'if-none-match': quotedEtag },
  });

  const response = await GET({
    params: { path: testKey },
    request,
  } as never);

  assert.equal(response.status, 304);
  assert.equal(response.headers.get('etag'), quotedEtag);
  assert.ok(response.headers.get('cache-control')?.includes('immutable'));
});

test('3. edge delivery endpoint prevents path traversal attacks', async () => {
  const request = new Request('http://localhost:4321/storage/../../etc/passwd');
  const response = await GET({
    params: { path: '../../etc/passwd' },
    request,
  } as never);

  assert.equal(response.status, 403);
});

test('4. edge delivery endpoint returns 404 for missing objects', async () => {
  const request = new Request('http://localhost:4321/storage/assets/nonexistent.webp');
  const response = await GET({
    params: { path: 'assets/nonexistent.webp' },
    request,
  } as never);

  assert.equal(response.status, 404);
});

test('5. migration manifest records migration status and quotas within limits', () => {
  const manifestRaw = readFileSync('data/migration-manifest.json', 'utf8');
  const manifest = JSON.parse(manifestRaw);

  assert.ok(manifest.items.length >= 88);
  assert.equal(manifest.failedCount, 0);

  // Gallery storage used is <= 3 GiB limit
  assert.ok(manifest.galleryUsageAfter <= 3 * 1024 * 1024 * 1024);
  // Asset storage used is <= 1 GiB limit
  assert.ok(manifest.assetUsageAfter <= 1 * 1024 * 1024 * 1024);

  // Every successfully migrated or already migrated item has a valid destinationKey and publicUrl starting with /storage/
  for (const item of manifest.items) {
    if (item.status === 'success' || item.status === 'already_migrated') {
      assert.ok(item.destinationKey);
      assert.ok(item.publicUrl.startsWith('/storage/'));
    }
  }
});

test('6. local original image files remain untouched on disk', () => {
  const localArchiveImages = [
    'public/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
    'public/images/archive/fernando-alvarez-rodriguez-M7GddPqJowg-unsplash.jpg',
    'public/images/archive/point3d-commercial-imaging-ltd-oxeCZrodz78-unsplash.jpg',
    'public/images/archive/bilderboken-rlwE8f8anOc-unsplash.jpg',
    'public/images/archive/runnyrem-LfqmND-hym8-unsplash.jpg',
  ];

  for (const relPath of localArchiveImages) {
    assert.ok(existsSync(relPath), `Original file must be preserved: ${relPath}`);
  }
});

test('7. fresh seedDatabase populates /storage/ URLs and initial storage objects', () => {
  const freshDb = new DatabaseSync(':memory:');
  freshDb.exec(schemaSql);
  initStorageSchema(freshDb);
  seedDatabase(freshDb);

  // Check storage_objects
  const countRow = freshDb.prepare('SELECT COUNT(*) as c FROM storage_objects').get() as { c: number };
  assert.ok(countRow.c >= 88, `Expected at least 88 storage objects, found ${countRow.c}`);

  // Check that all mandap images start with /storage/
  const mandapImages = freshDb.prepare('SELECT image FROM mandaps').all() as Array<{ image: string }>;
  assert.ok(mandapImages.length > 0);
  for (const row of mandapImages) {
    assert.ok(row.image.startsWith('/storage/'), `Expected /storage/ path, got: ${row.image}`);
  }

  // Check that all stage images start with /storage/
  const stageImages = freshDb.prepare('SELECT image FROM stages').all() as Array<{ image: string }>;
  assert.ok(stageImages.length > 0);
  for (const row of stageImages) {
    assert.ok(row.image.startsWith('/storage/'), `Expected /storage/ path, got: ${row.image}`);
  }

  // Check that all hall images start with /storage/
  const hallImages = freshDb.prepare('SELECT image, banner_image FROM halls').all() as Array<{ image: string; banner_image: string }>;
  assert.ok(hallImages.length > 0);
  for (const row of hallImages) {
    assert.ok(row.image.startsWith('/storage/'), `Expected /storage/ path, got: ${row.image}`);
    assert.ok(row.banner_image.startsWith('/storage/'), `Expected /storage/ banner, got: ${row.banner_image}`);
  }

  // Check that rooms table is removed
  const roomTable = freshDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get();
  assert.equal(roomTable, undefined, 'rooms table must not exist');

  // Check that all catering images start with /storage/
  const cateringImages = freshDb.prepare('SELECT image FROM catering_packages').all() as Array<{ image: string }>;
  assert.ok(cateringImages.length > 0);
  for (const row of cateringImages) {
    assert.ok(row.image.startsWith('/storage/'), `Expected /storage/ path, got: ${row.image}`);
  }

  // Check homepage hero image
  const homepageRow = freshDb.prepare('SELECT hero_image FROM homepage WHERE id = 1').get() as { hero_image: string };
  assert.ok(homepageRow.hero_image.startsWith('/storage/'));

  // Check page_settings hero images
  const pageBanners = freshDb.prepare('SELECT hero_image FROM page_settings').all() as Array<{ hero_image: string }>;
  assert.equal(pageBanners.length, 4);
  for (const row of pageBanners) {
    assert.ok(row.hero_image.startsWith('/storage/'));
  }
});

test('8. initial storage objects metadata contains 90 registered items with valid categories', () => {
  assert.equal(INITIAL_STORAGE_OBJECTS.length, 90);

  const galleryObjs = INITIAL_STORAGE_OBJECTS.filter((o) => o.storage_category === 'gallery');
  const assetObjs = INITIAL_STORAGE_OBJECTS.filter((o) => o.storage_category === 'asset');

  assert.equal(galleryObjs.length, 11);
  assert.equal(assetObjs.length, 79);

  const galleryBytes = galleryObjs.reduce((acc, o) => acc + o.size_bytes, 0);
  const assetBytes = assetObjs.reduce((acc, o) => acc + o.size_bytes, 0);

  assert.ok(galleryBytes < 3 * 1024 * 1024 * 1024);
  assert.ok(assetBytes < 1024 * 1024 * 1024);
});
