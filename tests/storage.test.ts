import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type {
  PutObjectInput,
  PutObjectResult,
  StoredObject,
} from '../src/core/storage/filebase';
import type { AuthState, CookieJar, PageContext } from '../src/core/types';

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

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-storage-test-'));

process.env.DATA_DIR = join(tempRoot, 'data');
process.env.STORAGE_DRIVER = 'mock';
process.env.FILEBASE_PUBLIC_BASE_URL = 'https://cdn.event-point.test';
process.env.APP_SECRET = 'storage-test-secret';
// Catalog reads/writes go through D1; force its SQLite fallback so the test
// never touches the production content database.
process.env.D1_LOCAL = '1';
delete process.env.GALLERY_STORAGE_LIMIT_BYTES;
delete process.env.ASSET_STORAGE_LIMIT_BYTES;

const { getDb, closeDb, all, one } = await import('../src/core/db');
const {
  MockFilebaseClient,
  getFilebaseClient,
  resetFilebaseClient,
} = await import('../src/core/storage/filebase');
const {
  DEFAULT_ASSET_LIMIT_BYTES,
  DEFAULT_GALLERY_LIMIT_BYTES,
} = await import('../src/core/storage/config');
const {
  ImageValidationError,
  MAX_DECODED_DIMENSION,
  MAX_INPUT_BYTES,
  optimizeImage,
} = await import('../src/core/storage/optimizer');
const quota = await import('../src/core/storage/quota');
const {
  ImageStorageService,
  QuotaExceededError,
} = await import('../src/core/storage/service');
const { galleryAdmin } = await import('../src/modules/admin/handlers/catalog');
const { loadGalleryPage } = await import('../src/modules/gallery/service');
const { getD1Client } = await import('../src/core/content/d1-client');

async function findD1GalleryItem(id: number) {
  const res = await getD1Client().query<{ id: number }>(
    'SELECT id FROM gallery_items WHERE id = ? LIMIT 1',
    [id],
  );
  return (res.results ?? [])[0] ?? null;
}
const { imageUrl } = await import('../src/core/http');
const { authStateFor, emptyAuth } = await import('../src/core/auth');

type StorageService = InstanceType<typeof ImageStorageService>;
type MockClient = InstanceType<typeof MockFilebaseClient>;

class TrackingFilebaseClient extends MockFilebaseClient {
  readonly events: string[] = [];
  readonly puts: Array<{ key: string; body: Buffer; contentType?: string }> = [];
  readonly snapshotsAtDelete: Array<
    Array<{ object_id: string; status: string; object_key: string }>
  > = [];

  override async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    this.events.push(`put:${input.key}`);
    this.puts.push({
      key: input.key,
      body: typeof input.body === 'string' ? Buffer.from(input.body) : Buffer.from(input.body),
      contentType: input.contentType,
    });
    return super.putObject(input);
  }

  override async headObject(key: string): Promise<StoredObject | null> {
    this.events.push(`head:${key}`);
    return super.headObject(key);
  }

  override async deleteObject(key: string): Promise<void> {
    this.events.push(`delete:${key}`);
    this.snapshotsAtDelete.push(
      all<{ object_id: string; status: string; object_key: string }>(
        'SELECT object_id, status, object_key FROM storage_objects ORDER BY id',
      ),
    );
    return super.deleteObject(key);
  }
}

let client: MockClient;
let storage: StorageService;

function storageObjectCount(): number {
  const row = one<{ count: number }>('SELECT COUNT(*) AS count FROM storage_objects');
  return Number(row?.count ?? 0);
}

function reservationCount(): number {
  const row = one<{ count: number }>('SELECT COUNT(*) AS count FROM storage_reservations');
  return Number(row?.count ?? 0);
}

function galleryUsage() {
  return storage.getStorageUsage('gallery');
}

function assetUsage() {
  return storage.getStorageUsage('asset');
}

function noisyRgb(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(width * height * 3);
  let seed = 0x12345678;

  for (let index = 0; index < buffer.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buffer[index] = seed >>> 24;
  }

  return buffer;
}

async function pngFixture(width = 320, height = 240): Promise<Buffer> {
  return sharp(noisyRgb(width, height), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
}

async function jpegFixture(width = 480, height = 320): Promise<Buffer> {
  return sharp(noisyRgb(width, height), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

async function transparentLogo(): Promise<Buffer> {
  const width = 64;
  const height = 64;
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      rgba[index] = 200;
      rgba[index + 1] = 30;
      rgba[index + 2] = 40;
      rgba[index + 3] = x < width / 2 ? 0 : 255;
    }
  }

  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function largeGalleryFixture(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3200" height="2000">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7b2d26"/>
        <stop offset="0.5" stop-color="#f2c14e"/>
        <stop offset="1" stop-color="#2d5d4a"/>
      </linearGradient>
    </defs>
    <rect width="3200" height="2000" fill="url(#g)"/>
    <circle cx="800" cy="700" r="420" fill="#d94f70" opacity="0.7"/>
    <circle cx="2200" cy="1200" r="520" fill="#2d6f9e" opacity="0.65"/>
    <rect x="1200" y="400" width="900" height="600" rx="40" fill="#f7efe0" opacity="0.8"/>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function contextFor(auth: AuthState, form: FormData | null, method = 'POST'): PageContext {
  const cookies: CookieJar = {
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  };

  return {
    request: new Request('http://localhost/admin/gallery', { method }),
    url: new URL('http://localhost/admin/gallery'),
    params: {},
    form,
    auth,
    csrf: 'test-csrf',
    cookies,
  };
}

beforeEach(() => {
  getDb().exec(`
    DELETE FROM storage_reservations;
    DELETE FROM storage_objects;
    DELETE FROM gallery_items;
    DELETE FROM gallery_categories;
  `);

  delete process.env.GALLERY_STORAGE_LIMIT_BYTES;
  delete process.env.ASSET_STORAGE_LIMIT_BYTES;

  resetFilebaseClient();
  client = new MockFilebaseClient();
  storage = new ImageStorageService({ client });
});

after(() => {
  closeDb();
  rmSync(tempRoot, { recursive: true, force: true });
});

test('1. uploads a valid gallery image', async () => {
  const source = await pngFixture();
  const stored = await storage.uploadImage(source, {
    entityType: 'gallery_item',
    entityId: 101,
    filename: 'wedding.png',
  });

  assert.equal(stored.category, 'gallery');
  assert.equal(stored.entityType, 'gallery');
  assert.equal(stored.entityId, '101');
  assert.equal(stored.status, 'active');
  assert.match(stored.key, /^gallery\/101\/[0-9a-f-]+\.webp$/);
  assert.equal(stored.publicUrl, `https://cdn.event-point.test/${stored.key}`);
  assert.equal(stored.mimeType, 'image/webp');
  assert.equal(stored.format, 'webp');
  assert.equal(stored.originalFilename, 'wedding.png');
  assert.equal(stored.width, 320);
  assert.equal(stored.height, 240);
  assert.ok(stored.sizeBytes > 0);

  const object = await client.headObject(stored.key);
  assert.ok(object);
  assert.equal(object.size, stored.sizeBytes);

  const row = one<{ status: string; size_bytes: number; object_key: string }>(
    'SELECT status, size_bytes, object_key FROM storage_objects WHERE object_id = ?',
    [stored.objectId],
  );
  assert.equal(row?.status, 'active');
  assert.equal(Number(row?.size_bytes), stored.sizeBytes);
  assert.equal(row?.object_key, stored.key);
  assert.equal(galleryUsage().usedBytes, stored.sizeBytes);
  assert.equal(galleryUsage().reservedBytes, 0);
  assert.equal(galleryUsage().objectCount, 1);
});

test('2. uploads a valid mandap image', async () => {
  const source = await jpegFixture();
  const stored = await storage.uploadImage(source, {
    entityType: 'mandap',
    entityId: 'royal-mandap',
    slot: 'hero',
    filename: 'mandap.jpg',
  });

  assert.equal(stored.category, 'asset');
  assert.equal(stored.entityType, 'mandap');
  assert.equal(stored.entityId, 'royal-mandap');
  assert.equal(stored.slot, 'hero');
  assert.match(stored.key, /^assets\/mandaps\/royal-mandap\/[0-9a-f-]+\.webp$/);
  assert.equal(stored.mimeType, 'image/webp');
  assert.equal(stored.format, 'webp');
  assert.equal(stored.status, 'active');

  const object = await client.headObject(stored.key);
  assert.ok(object);
  assert.equal(object.size, stored.sizeBytes);
  assert.equal(object.contentType, 'image/webp');
  assert.equal(assetUsage().usedBytes, stored.sizeBytes);
  assert.equal(assetUsage().objectCount, 1);
  assert.equal(galleryUsage().usedBytes, 0);
});

test('3. replaces an existing mandap image', async () => {
  const original = await storage.uploadImage(await pngFixture(), {
    entityType: 'mandap',
    entityId: 'royal-mandap',
  });
  const replacementBytes = await jpegFixture(640, 480);

  const result = await storage.replaceImage(
    { entityType: 'mandap', entityId: 'royal-mandap' },
    replacementBytes,
    { filename: 'new-mandap.jpg' },
  );

  assert.equal(result.replacementSucceeded, true);
  assert.equal(result.cleanupSucceeded, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(result.previousObject.objectId, original.objectId);
  assert.equal(result.object.objectId !== original.objectId, true);
  assert.equal(result.object.entityType, 'mandap');
  assert.equal(result.object.entityId, 'royal-mandap');
  assert.equal(result.object.status, 'active');
  assert.equal(result.object.mimeType, 'image/webp');

  const originalRow = one<{ status: string }>(
    'SELECT status FROM storage_objects WHERE object_id = ?',
    [original.objectId],
  );
  assert.equal(originalRow?.status, 'deleted');

  const replacementRow = one<{ status: string }>(
    'SELECT status FROM storage_objects WHERE object_id = ?',
    [result.object.objectId],
  );
  assert.equal(replacementRow?.status, 'active');

  assert.equal(await client.headObject(original.key), null);
  assert.ok(await client.headObject(result.object.key));
  assert.equal(assetUsage().usedBytes, result.object.sizeBytes);
  assert.equal(assetUsage().objectCount, 1);
});

test('4. keeps the old image active when the new upload fails', async () => {
  const original = await storage.uploadImage(await pngFixture(), {
    entityType: 'mandap',
    entityId: 'royal-mandap',
  });

  client.simulateFailure('putObject', {
    error: new Error('simulated upload outage'),
  });

  await assert.rejects(
    storage.replaceImage(original.objectId, await jpegFixture()),
    /simulated upload outage/,
  );

  const row = one<{ status: string; object_key: string; size_bytes: number }>(
    'SELECT status, object_key, size_bytes FROM storage_objects WHERE object_id = ?',
    [original.objectId],
  );
  assert.equal(row?.status, 'active');
  assert.equal(row?.object_key, original.key);
  assert.equal(Number(row?.size_bytes), original.sizeBytes);

  const stillStored = await client.headObject(original.key);
  assert.ok(stillStored);
  assert.equal(stillStored.size, original.sizeBytes);

  const listed = await client.listObjects({ prefix: 'assets/' });
  assert.equal(listed.objects.length, 1);
  assert.equal(storageObjectCount(), 1);
  assert.equal(reservationCount(), 0);
  assert.equal(assetUsage().usedBytes, original.sizeBytes);
  assert.equal(assetUsage().reservedBytes, 0);
});

test('5. deletes the old object only after the new database reference is committed', async () => {
  const tracking = new TrackingFilebaseClient();
  const trackingStorage = new ImageStorageService({ client: tracking });
  const original = await trackingStorage.uploadImage(await pngFixture(), {
    entityType: 'mandap',
    entityId: 'royal-mandap',
  });

  tracking.events.length = 0;

  const result = await trackingStorage.replaceImage(
    { entityType: 'mandap', entityId: 'royal-mandap' },
    await jpegFixture(),
  );

  const deleteIndex = tracking.events.findIndex((event) => event.startsWith('delete:'));
  const putIndex = tracking.events.findIndex((event) => event.startsWith('put:'));
  const headIndex = tracking.events.findIndex((event) => event.startsWith('head:'));

  assert.ok(putIndex >= 0);
  assert.ok(headIndex > putIndex);
  assert.ok(deleteIndex > headIndex);
  assert.equal(tracking.events[deleteIndex], `delete:${original.key}`);

  assert.equal(tracking.snapshotsAtDelete.length, 1);
  const snapshot = tracking.snapshotsAtDelete[0];
  const activeRows = snapshot.filter((row) => row.status === 'active');
  const pendingRows = snapshot.filter((row) => row.status === 'pending_deletion');

  assert.equal(activeRows.length, 1);
  assert.equal(activeRows[0].object_id, result.object.objectId);
  assert.equal(activeRows[0].object_key, result.object.key);
  assert.equal(pendingRows.length, 1);
  assert.equal(pendingRows[0].object_id, original.objectId);
});

test('6. leaves a pending-cleanup record when deletion fails', async () => {
  const stored = await storage.uploadImage(await pngFixture(), {
    entityType: 'gallery_item',
    entityId: 601,
  });

  client.simulateFailure('deleteObject', {
    error: new Error('simulated delete outage'),
  });

  const result = await storage.deleteImage(stored.objectId);

  assert.equal(result.status, 'pending_deletion');
  assert.equal(result.alreadyDeleted, false);
  assert.match(result.error ?? '', /simulated delete outage/);

  const row = one<{
    status: string;
    deletion_attempts: number;
    last_deletion_error: string | null;
  }>(
    'SELECT status, deletion_attempts, last_deletion_error FROM storage_objects WHERE object_id = ?',
    [stored.objectId],
  );
  assert.equal(row?.status, 'pending_deletion');
  assert.equal(Number(row?.deletion_attempts), 1);
  assert.match(row?.last_deletion_error ?? '', /simulated delete outage/);

  assert.ok(await client.headObject(stored.key));
  assert.equal(galleryUsage().usedBytes, stored.sizeBytes);
  assert.equal(storage.getStorageUsage().pendingDeletionCount, 1);
});

test('7. gallery replacement does not delete unrelated gallery images', async () => {
  const first = await storage.uploadImage(await pngFixture(), {
    entityType: 'gallery_item',
    entityId: 701,
  });
  const second = await storage.uploadImage(await pngFixture(280, 200), {
    entityType: 'gallery_item',
    entityId: 702,
  });

  const result = await storage.replaceImage(first.objectId, await jpegFixture());

  assert.equal(result.cleanupSucceeded, true);

  const untouchedRow = one<{ status: string; object_key: string }>(
    'SELECT status, object_key FROM storage_objects WHERE object_id = ?',
    [second.objectId],
  );
  assert.equal(untouchedRow?.status, 'active');
  assert.equal(untouchedRow?.object_key, second.key);

  const untouchedObject = await client.headObject(second.key);
  assert.ok(untouchedObject);
  assert.equal(untouchedObject.size, second.sizeBytes);

  assert.equal(await client.headObject(first.key), null);
  assert.equal(galleryUsage().usedBytes, result.object.sizeBytes + second.sizeBytes);
  assert.equal(galleryUsage().objectCount, 2);
});

test('8. non-gallery replacement does not affect the gallery quota', async () => {
  const galleryImage = await storage.uploadImage(await pngFixture(), {
    entityType: 'gallery_item',
    entityId: 801,
  });
  const originalMandap = await storage.uploadImage(await pngFixture(400, 300), {
    entityType: 'mandap',
    entityId: 'royal-mandap',
  });

  const galleryBefore = galleryUsage();
  const result = await storage.replaceImage(
    originalMandap.objectId,
    await jpegFixture(),
  );

  const galleryAfter = galleryUsage();
  assert.equal(galleryAfter.usedBytes, galleryBefore.usedBytes);
  assert.equal(galleryAfter.reservedBytes, 0);
  assert.equal(galleryAfter.usedBytes, galleryImage.sizeBytes);
  assert.equal(galleryAfter.objectCount, 1);
  assert.equal(assetUsage().usedBytes, result.object.sizeBytes);
  assert.ok(await client.headObject(galleryImage.key));
});

test('9. gallery storage cannot exceed 3 GiB', async () => {
  assert.equal(DEFAULT_GALLERY_LIMIT_BYTES, 3 * 1024 * 1024 * 1024);

  quota.commitObjectAndReleaseReservation({
    objectId: 'gallery-filler',
    category: 'gallery',
    entityType: 'gallery',
    entityId: 'filler',
    objectKey: 'gallery/filler/00000000-0000-0000-0000-000000000001.webp',
    publicUrl: 'https://cdn.event-point.test/gallery/filler/filler.webp',
    mimeType: 'image/webp',
    sizeBytes: DEFAULT_GALLERY_LIMIT_BYTES - 1,
    format: 'webp',
  });

  assert.equal(galleryUsage().usedBytes, DEFAULT_GALLERY_LIMIT_BYTES - 1);
  assert.equal(galleryUsage().availableBytes, 1);
  assert.equal(galleryUsage().level, 'critical');

  await assert.rejects(
    storage.uploadImage(await tinyPng(), {
      entityType: 'gallery_item',
      entityId: 901,
    }),
    (error: unknown) =>
      error instanceof QuotaExceededError &&
      error.category === 'gallery' &&
      error.limitBytes === DEFAULT_GALLERY_LIMIT_BYTES,
  );

  assert.equal(galleryUsage().usedBytes, DEFAULT_GALLERY_LIMIT_BYTES - 1);
  assert.equal(galleryUsage().reservedBytes, 0);
  assert.equal(storageObjectCount(), 1);
  assert.equal(reservationCount(), 0);
  const listed = await client.listObjects({ prefix: 'gallery/' });
  assert.equal(listed.objects.length, 0);
});

test('10. non-gallery storage cannot exceed 1 GiB', async () => {
  assert.equal(DEFAULT_ASSET_LIMIT_BYTES, 1 * 1024 * 1024 * 1024);

  quota.commitObjectAndReleaseReservation({
    objectId: 'asset-filler',
    category: 'asset',
    entityType: 'mandap',
    entityId: 'filler',
    objectKey: 'assets/mandaps/filler/00000000-0000-0000-0000-000000000002.webp',
    publicUrl: 'https://cdn.event-point.test/assets/mandaps/filler/filler.webp',
    mimeType: 'image/webp',
    sizeBytes: DEFAULT_ASSET_LIMIT_BYTES - 1,
    format: 'webp',
  });

  assert.equal(assetUsage().usedBytes, DEFAULT_ASSET_LIMIT_BYTES - 1);
  assert.equal(assetUsage().availableBytes, 1);
  assert.equal(assetUsage().level, 'critical');

  await assert.rejects(
    storage.uploadImage(await tinyPng(), {
      entityType: 'mandap',
      entityId: 'royal-mandap',
    }),
    (error: unknown) =>
      error instanceof QuotaExceededError &&
      error.category === 'asset' &&
      error.limitBytes === DEFAULT_ASSET_LIMIT_BYTES,
  );

  assert.equal(assetUsage().usedBytes, DEFAULT_ASSET_LIMIT_BYTES - 1);
  assert.equal(assetUsage().reservedBytes, 0);
  assert.equal(galleryUsage().usedBytes, 0);
  assert.equal(storageObjectCount(), 1);
});

test('11. concurrent uploads cannot overbook available quota', async () => {
  const source = await pngFixture(500, 400);
  const sample = await optimizeImage(source, { kind: 'gallery' });
  const limit = sample.size * 2 + 1;
  process.env.GALLERY_STORAGE_LIMIT_BYTES = String(limit);

  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      storage.uploadImage(source, {
        entityType: 'gallery_item',
        entityId: 1000 + index,
      }),
    ),
  );

  let fulfilled = 0;
  const rejections: unknown[] = [];

  for (const attempt of attempts) {
    if (attempt.status === 'fulfilled') {
      fulfilled += 1;
    } else {
      rejections.push(attempt.reason);
    }
  }

  assert.equal(fulfilled, 2);
  assert.equal(rejections.length, 4);

  for (const reason of rejections) {
    assert.ok(reason instanceof QuotaExceededError);
    assert.equal(reason.category, 'gallery');
  }

  const usage = galleryUsage();
  assert.ok(usage.usedBytes <= limit);
  assert.equal(usage.usedBytes, sample.size * 2);
  assert.equal(usage.reservedBytes, 0);
  assert.equal(usage.objectCount, 2);
  assert.equal(reservationCount(), 0);
  assert.equal(storageObjectCount(), 2);
  assert.equal((await client.listObjects({ prefix: 'gallery/' })).objects.length, 2);
});

test('12. releases reservations after failed uploads', async () => {
  const source = await pngFixture();

  client.simulateFailure('putObject', {
    error: new Error('simulated put failure'),
  });
  await assert.rejects(
    storage.uploadImage(source, { entityType: 'gallery_item', entityId: 1201 }),
    /simulated put failure/,
  );
  assert.equal(galleryUsage().usedBytes, 0);
  assert.equal(galleryUsage().reservedBytes, 0);
  assert.equal(reservationCount(), 0);
  assert.equal(storageObjectCount(), 0);

  client.clearFailures();
  client.simulateFailure('headObject', {
    error: new Error('simulated verification failure'),
  });
  await assert.rejects(
    storage.uploadImage(source, { entityType: 'gallery_item', entityId: 1202 }),
    /simulated verification failure/,
  );

  assert.equal(galleryUsage().usedBytes, 0);
  assert.equal(galleryUsage().reservedBytes, 0);
  assert.equal(reservationCount(), 0);
  assert.equal(storageObjectCount(), 0);
  assert.equal((await client.listObjects({ prefix: 'gallery/' })).objects.length, 0);

  client.clearFailures();
  const stored = await storage.uploadImage(source, {
    entityType: 'gallery_item',
    entityId: 1203,
  });
  assert.equal(galleryUsage().usedBytes, stored.sizeBytes);
  assert.equal(galleryUsage().reservedBytes, 0);
  assert.equal(reservationCount(), 0);
});

test('13. reduces unnecessarily large files without unacceptable quality loss', async () => {
  const source = await largeGalleryFixture();
  const optimized = await optimizeImage(source, { kind: 'gallery' });

  assert.equal(optimized.contentType, 'image/webp');
  assert.equal(optimized.extension, 'webp');
  assert.ok(optimized.size < source.length / 2);
  assert.ok(optimized.width <= 2400);
  assert.ok(optimized.height <= 2400);
  assert.equal(optimized.width, 2400);
  assert.equal(optimized.height, 1500);
  assert.ok(Math.abs(optimized.width / optimized.height - 1.6) < 0.01);

  const reference = await sharp(source)
    .resize(optimized.width, optimized.height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const actual = await sharp(optimized.buffer).removeAlpha().raw().toBuffer();

  assert.equal(actual.length, reference.length);

  let difference = 0;
  for (let index = 0; index < reference.length; index += 1) {
    difference += Math.abs(reference[index] - actual[index]);
  }

  const meanAbsoluteError = difference / reference.length;
  assert.ok(
    meanAbsoluteError < 6,
    `expected mean absolute error below 6, received ${meanAbsoluteError.toFixed(2)}`,
  );
});

test('14. rejects invalid formats and oversized images', async () => {
  await assert.rejects(
    optimizeImage(Buffer.alloc(0), { kind: 'gallery' }),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === 'empty_input',
  );

  await assert.rejects(
    optimizeImage(Buffer.from('definitely not an image'), { kind: 'gallery' }),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === 'invalid_image',
  );

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#000"/></svg>',
  );
  await assert.rejects(
    optimizeImage(svg, { kind: 'gallery' }),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === 'unsupported_format',
  );

  await assert.rejects(
    optimizeImage(Buffer.alloc(MAX_INPUT_BYTES + 1), { kind: 'gallery' }),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === 'input_too_large',
  );

  const oversizedDimensions = await sharp({
    create: {
      width: MAX_DECODED_DIMENSION + 1,
      height: 4,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  await assert.rejects(
    optimizeImage(oversizedDimensions, { kind: 'gallery' }),
    (error: unknown) =>
      error instanceof ImageValidationError && error.code === 'invalid_dimensions',
  );

  await assert.rejects(
    storage.uploadImage(Buffer.from('still not an image'), {
      entityType: 'gallery_item',
      entityId: 1401,
    }),
    ImageValidationError,
  );

  assert.equal(storageObjectCount(), 0);
  assert.equal(reservationCount(), 0);
  assert.equal((await client.listObjects({ prefix: 'gallery/' })).objects.length, 0);
});

test('15. logos with transparency remain usable', async () => {
  const source = await transparentLogo();
  const tracking = new TrackingFilebaseClient();
  const trackingStorage = new ImageStorageService({ client: tracking });

  const stored = await trackingStorage.uploadImage(source, {
    entityType: 'branding',
    filename: 'logo.png',
  });

  assert.equal(stored.mimeType, 'image/png');
  assert.equal(stored.format, 'png');
  assert.match(stored.key, /^assets\/branding\/[0-9a-f-]+\.png$/);
  assert.equal(stored.width, 64);
  assert.equal(stored.height, 64);

  const put = tracking.puts.find((entry) => entry.key === stored.key);
  assert.ok(put);
  assert.equal(put.contentType, 'image/png');

  const metadata = await sharp(put.body).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.channels, 4);

  const raw = await sharp(put.body).ensureAlpha().raw().toBuffer();
  let transparentPixels = 0;
  let opaquePixels = 0;
  for (let index = 3; index < raw.length; index += 4) {
    if (raw[index] === 0) transparentPixels += 1;
    if (raw[index] === 255) opaquePixels += 1;
  }

  assert.ok(transparentPixels > 0);
  assert.ok(opaquePixels > 0);
  assert.equal(transparentPixels + opaquePixels, 64 * 64);
});

test('16. calculates quota usage from actual stored object sizes', async () => {
  const first = await storage.uploadImage(await pngFixture(300, 220), {
    entityType: 'gallery_item',
    entityId: 1601,
  });
  const second = await storage.uploadImage(await jpegFixture(360, 260), {
    entityType: 'gallery_item',
    entityId: 1602,
  });
  const mandap = await storage.uploadImage(await pngFixture(400, 320), {
    entityType: 'mandap',
    entityId: 'royal-mandap',
  });

  const rows = all<{ object_key: string; size_bytes: number; storage_category: string }>(
    "SELECT object_key, size_bytes, storage_category FROM storage_objects WHERE status <> 'deleted'",
  );

  assert.equal(rows.length, 3);

  let galleryTotal = 0;
  let assetTotal = 0;

  for (const row of rows) {
    const head = await client.headObject(row.object_key);
    assert.ok(head);
    assert.equal(head.size, Number(row.size_bytes));

    if (row.storage_category === 'gallery') {
      galleryTotal += head.size;
    } else {
      assetTotal += head.size;
    }
  }

  assert.equal(galleryTotal, first.sizeBytes + second.sizeBytes);
  assert.equal(assetTotal, mandap.sizeBytes);
  assert.equal(galleryUsage().usedBytes, galleryTotal);
  assert.equal(assetUsage().usedBytes, assetTotal);

  const listed = await client.listObjects();
  const listedTotal = listed.objects.reduce((total, object) => total + object.size, 0);
  assert.equal(listedTotal, galleryTotal + assetTotal);
});

test('17. retries do not double-count objects or reservations', async () => {
  const source = await pngFixture();

  client.simulateFailure('putObject', {
    times: 1,
    error: new Error('transient put failure'),
  });
  await assert.rejects(
    storage.uploadImage(source, { entityType: 'gallery_item', entityId: 1701 }),
    /transient put failure/,
  );

  assert.equal(storageObjectCount(), 0);
  assert.equal(reservationCount(), 0);
  assert.equal(galleryUsage().usedBytes, 0);
  assert.equal(galleryUsage().reservedBytes, 0);

  const stored = await storage.uploadImage(source, {
    entityType: 'gallery_item',
    entityId: 1701,
  });
  assert.equal(storageObjectCount(), 1);
  assert.equal(reservationCount(), 0);
  assert.equal(galleryUsage().usedBytes, stored.sizeBytes);
  assert.equal(galleryUsage().objectCount, 1);

  client.simulateFailure('deleteObject', {
    times: 1,
    error: new Error('transient delete failure'),
  });
  const pending = await storage.deleteImage(stored.objectId);
  assert.equal(pending.status, 'pending_deletion');
  assert.equal(galleryUsage().objectCount, 1);

  const firstRetry = await storage.retryPendingDeletions();
  assert.equal(firstRetry.attempted, 1);
  assert.equal(firstRetry.deleted, 1);
  assert.equal(firstRetry.failed, 0);

  const secondRetry = await storage.retryPendingDeletions();
  assert.equal(secondRetry.attempted, 0);
  assert.equal(secondRetry.deleted, 0);
  assert.equal(secondRetry.failed, 0);

  assert.equal(storageObjectCount(), 1);
  assert.equal(galleryUsage().usedBytes, 0);
  assert.equal(galleryUsage().objectCount, 0);
  assert.equal(galleryUsage().reservedBytes, 0);
  assert.equal(reservationCount(), 0);
  assert.equal((await client.listObjects({ prefix: 'gallery/' })).objects.length, 0);

  const repeatedDelete = await storage.deleteImage(stored.objectId);
  assert.equal(repeatedDelete.status, 'deleted');
  assert.equal(repeatedDelete.alreadyDeleted, true);
  assert.equal(storageObjectCount(), 1);
});

test('18. reconciliation identifies missing and orphaned objects safely', async () => {
  const gallery = await storage.uploadImage(await pngFixture(200, 150), {
    entityType: 'gallery_item',
    entityId: 1801,
  });
  const mandap = await storage.uploadImage(await pngFixture(220, 160), {
    entityType: 'mandap',
    entityId: 'royal-mandap',
  });

  await client.deleteObject(gallery.key);

  const orphanGalleryKey = 'gallery/orphan/00000000-0000-0000-0000-000000000011.webp';
  const orphanAssetKey =
    'assets/mandaps/orphan/00000000-0000-0000-0000-000000000012.webp';
  const unknownKey = 'assets/mandaps/orphan/notes.txt';
  const orphanBytes = await pngFixture(16, 16);

  await client.putObject({ key: orphanGalleryKey, body: orphanBytes, contentType: 'image/webp' });
  await client.putObject({ key: orphanAssetKey, body: orphanBytes, contentType: 'image/webp' });
  await client.putObject({ key: unknownKey, body: 'notes' });

  const dryRun = await storage.reconcileStorage({
    dryRun: true,
    orphanGraceMs: 60_000,
  });

  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.missingObjects.length, 1);
  assert.equal(dryRun.missingObjects[0].objectId, gallery.objectId);
  assert.equal(dryRun.missingObjects[0].status, 'active');
  assert.equal(dryRun.orphanObjectsFound, 2);
  assert.equal(dryRun.orphanObjectsRetained, 2);
  assert.equal(dryRun.orphanObjectsDeleted, 0);
  assert.equal(dryRun.unknownObjectsSkipped, 1);
  assert.equal(dryRun.knownObjects, 1);
  assert.ok(await client.headObject(orphanGalleryKey));
  assert.ok(await client.headObject(orphanAssetKey));

  const report = await storage.reconcileStorage({ orphanGraceMs: 0 });

  assert.equal(report.missingObjects.length, 1);
  assert.equal(report.missingObjects[0].objectKey, gallery.key);
  assert.equal(report.orphanObjectsFound, 2);
  assert.equal(report.orphanObjectsDeleted, 2);
  assert.equal(report.unknownObjectsSkipped, 1);
  assert.equal(report.errors.length, 0);
  assert.equal(report.pendingDeletionsRemaining, 0);

  assert.equal(await client.headObject(orphanGalleryKey), null);
  assert.equal(await client.headObject(orphanAssetKey), null);
  assert.ok(await client.headObject(unknownKey));
  assert.ok(await client.headObject(mandap.key));

  const missingRow = one<{ status: string }>(
    'SELECT status FROM storage_objects WHERE object_id = ?',
    [gallery.objectId],
  );
  assert.equal(missingRow?.status, 'active');

  const purged = await storage.uploadImage(await pngFixture(24, 24), {
    entityType: 'gallery_item',
    entityId: 1802,
  });
  quota.markObjectDeleted(purged.objectId);

  const purgeReport = await storage.reconcileStorage({ orphanGraceMs: 0 });
  assert.equal(purgeReport.deletedRecordObjectsPurged, 1);
  assert.equal(await client.headObject(purged.key), null);
});

test('19. unauthorised users cannot upload or delete images', async () => {
  const bytes = await pngFixture(24, 24);
  const uploadForm = new FormData();
  uploadForm.append('action', 'add_item');
  uploadForm.append('category_id', '1');
  uploadForm.append(
    'images',
    new File([new Uint8Array(bytes)], 'unauthorised.png', { type: 'image/png' }),
  );

  const anonymousUpload = await galleryAdmin(contextFor(emptyAuth, uploadForm));
  assert.ok(anonymousUpload instanceof Response);
  assert.equal(anonymousUpload.status, 303);
  assert.equal(
    anonymousUpload.headers.get('location'),
    '/admin/login?next=%2Fadmin%2Fgallery',
  );

  const customerAuth = authStateFor({
    id: 2,
    username: 'customer',
    email: 'customer@example.com',
    firstName: 'Customer',
    role: 'customer',
    isActive: true,
  });
  const customerUpload = await galleryAdmin(contextFor(customerAuth, uploadForm));
  assert.ok(customerUpload instanceof Response);
  assert.equal(customerUpload.status, 303);
  assert.equal(customerUpload.headers.get('location'), '/admin/login?next=%2Fadmin%2Fgallery');

  assert.equal(storageObjectCount(), 0);
  assert.equal(reservationCount(), 0);
  assert.equal((await getFilebaseClient().listObjects({ prefix: 'gallery/' })).objects.length, 0);

  const categoryRes = await getD1Client().query(
    "INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES ('Test', 'test', 1, 1)",
  );
  const categoryId = Number(categoryRes.meta.last_row_id ?? 0);
  const itemRes = await getD1Client().query(
    'INSERT INTO gallery_items (category_id, caption, image_url, sort_order, is_visible) VALUES (?, ?, ?, 1, 1)',
    [categoryId, 'Protected image', '/images/placeholder.jpg'],
  );
  const itemId = Number(itemRes.meta.last_row_id ?? 0);

  const deleteForm = new FormData();
  deleteForm.append('action', 'delete_item');
  deleteForm.append('item_id', String(itemId));

  const anonymousDelete = await galleryAdmin(contextFor(emptyAuth, deleteForm));
  assert.ok(anonymousDelete instanceof Response);
  assert.equal(anonymousDelete.status, 303);
  assert.ok(await findD1GalleryItem(itemId));

  const adminAuth = authStateFor({
    id: 1,
    username: 'admin',
    email: 'admin@example.com',
    firstName: 'Admin',
    role: 'admin',
    isActive: true,
  });
  const adminDelete = await galleryAdmin(contextFor(adminAuth, deleteForm));
  assert.ok(adminDelete instanceof Response);
  assert.equal(adminDelete.status, 303);
  assert.equal(await findD1GalleryItem(itemId), null);
});

test('20. the existing public website still renders the correct images', async () => {
  const d1 = getD1Client();

  const categoryRes = await d1.query(
    "INSERT INTO gallery_categories (name, slug, sort_order, is_visible) VALUES ('Weddings', 'weddings', 1, 1)",
  );
  const categoryId = Number(categoryRes.meta.last_row_id ?? 0);
  const original = await storage.uploadImage(await pngFixture(300, 220), {
    entityType: 'gallery_item',
    entityId: 2001,
  });
  const inactive = await storage.uploadImage(await pngFixture(260, 180), {
    entityType: 'gallery_item',
    entityId: 2002,
  });

  await d1.query(
    'INSERT INTO gallery_items (category_id, caption, image_url, sort_order, is_visible) VALUES (?, ?, ?, 1, 1)',
    [categoryId, 'Reception', original.publicUrl],
  );
  await d1.query(
    'INSERT INTO gallery_items (category_id, caption, image_url, sort_order, is_visible) VALUES (?, ?, ?, 2, 0)',
    [categoryId, 'Hidden', inactive.publicUrl],
  );

  const before = await loadGalleryPage();
  assert.equal(before.items.length, 1);
  assert.equal(before.items[0].image, original.publicUrl);
  assert.equal(before.items[0].title, 'Reception');
  assert.equal(imageUrl(before.items[0].image), original.publicUrl);
  assert.equal(
    before.categories.find((category) => category.id === categoryId)?.count,
    1,
  );

  const replacement = await storage.replaceImage(original.objectId, await jpegFixture());
  await d1.query('UPDATE gallery_items SET image_url = ? WHERE image_url = ?', [
    replacement.object.publicUrl,
    original.publicUrl,
  ]);

  const after = await loadGalleryPage();
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].image, replacement.object.publicUrl);
  assert.equal(imageUrl(after.items[0].image), replacement.object.publicUrl);
  assert.notEqual(after.items[0].image, original.publicUrl);
  assert.equal(imageUrl('/images/archive/alev-takil-lw3Lqe2K7xc-unsplash.jpg'), '/images/archive/alev-takil-lw3Lqe2K7xc-unsplash.jpg');
  assert.equal(imageUrl('images/placeholder.jpg'), '/images/placeholder.jpg');
});

test('21. the production build succeeds', () => {
  execFileSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      DATA_DIR: join(tempRoot, 'build-data'),
      STORAGE_DRIVER: 'mock',
    },
  });

  assert.equal(existsSync(join(repoRoot, 'dist', 'server', 'entry.mjs')), true);
});

test('22. all existing relevant tests continue to pass', () => {
  const testsDir = join(repoRoot, 'tests');
  const entries = readdirSync(testsDir, { recursive: true, encoding: 'utf8' });
  const otherTests = entries
    .filter((entry) => /\.(?:test|spec)\.(?:ts|mts|js|mjs)$/.test(entry))
    .filter((entry) => entry !== 'storage.test.ts')
    .map((entry) => join(testsDir, entry));

  if (otherTests.length > 0) {
    execFileSync(
      process.execPath,
      ['--import', 'tsx', '--test', ...otherTests],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
      },
    );
  }

  assert.equal(existsSync(join(testsDir, 'storage.test.ts')), true);
  assert.match(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    /tests\/\*\*\/\*\.test\.ts/,
  );
});
