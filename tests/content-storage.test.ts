import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';
import { makePageDocument, makeSiteDocument, makeDocuments } from './helpers/content-fixtures';

// No Neon and no Filebase: the operational client uses a temp SQLite file and
// the storage client is the in-memory mock.
useIsolatedContentDb();
useIsolatedOperationalDb('content-storage');
process.env.STORAGE_DRIVER = 'mock';
process.env.CONTENT_PREFIX = 'site-content-test/';
after(cleanupIsolatedDatabases);

const { MockFilebaseClient, resetFilebaseClient } = await import('../src/core/storage/filebase');
const {
  createContentStore,
  pageObjectKey,
  manifestObjectKey,
  assertContentKey,
  contentPrefix,
  sha256Hex,
  ContentStorageError,
} = await import('../src/core/content-storage/store');
const { validateContentDocument, validatePublicationDocuments, ContentValidationError } = await import(
  '../src/core/content-storage/schema'
);
const { buildManifest, validateManifest, ManifestValidationError } = await import('../src/core/content-storage/manifest');

let mock: InstanceType<typeof MockFilebaseClient>;
let store: ReturnType<typeof createContentStore>;

beforeEach(() => {
  resetFilebaseClient();
  mock = new MockFilebaseClient();
  store = createContentStore(mock);
});

test('valid documents pass validation and round-trip through the store', async () => {
  const document = makePageDocument('home');
  const staged = await store.putPage(document, '2026-11-01T00-00-00-000Z-abc123');

  assert.equal(staged.key, 'site-content-test/pages/home/v000001.json');
  assert.equal(staged.sha256.length, 64);

  const read = await store.readObject(staged.key);
  assert.ok(read);
  assert.equal(read!.sha256, staged.sha256);
  assert.deepEqual(JSON.parse(read!.body), document);

  const verification = await store.verifyObject(staged.key, staged.sha256);
  assert.equal(verification.ok, true);
});

test('the same object can be re-uploaded idempotently, but different bytes are refused', async () => {
  const document = makePageDocument('home');
  const first = await store.putPage(document, 'v-a');
  const second = await store.putPage(document, 'v-b');
  assert.equal(second.sha256, first.sha256);

  const changed = makePageDocument('home', { title: 'Changed after publication' });
  await assert.rejects(() => store.putPage(changed, 'v-c'), /Refusing to overwrite/);
});

test('a missing object reads as null and fails verification', async () => {
  const key = pageObjectKey('home', 99);
  assert.equal(await store.readObject(key), null);
  assert.equal(await store.headObject(key), null);
  await assert.rejects(() => store.verifyObject(key, 'a'.repeat(64)), /missing/);
});

test('a checksum mismatch is detected', async () => {
  const staged = await store.putPage(makePageDocument('gallery'), 'v-a');
  const verification = await store.verifyObject(staged.key, 'b'.repeat(64));
  assert.equal(verification.ok, false);
  assert.equal(verification.actualSha256, staged.sha256);
});

test('object keys outside the content namespace are rejected', async () => {
  assert.throws(() => assertContentKey('assets/mandaps/1/primary.webp'), /outside the content namespace/);
  assert.throws(() => assertContentKey('site-content-test/../secret.json'), /outside the content namespace/);
  assert.throws(() => pageObjectKey('home' as never, 0), ContentStorageError);
  assert.throws(() => manifestObjectKey('../escape'), ContentStorageError);
  await assert.rejects(() => store.readObject('gallery/1.webp'), /outside the content namespace/);
});

test('an unsafe CONTENT_PREFIX is rejected', () => {
  const previous = process.env.CONTENT_PREFIX;
  process.env.CONTENT_PREFIX = '../evil/';
  try {
    assert.throws(() => contentPrefix(), /not a safe object prefix/);
  } finally {
    process.env.CONTENT_PREFIX = previous;
  }
});

test('invalid JSON in storage is rejected by the readers', async () => {
  const key = pageObjectKey('home', 5);
  await mock.putObject({ key, body: '{not json', contentType: 'application/json' });
  const read = await store.readObject(key);
  assert.ok(read);
  assert.throws(() => JSON.parse(read!.body), SyntaxError);
});

test('schema validation rejects unknown pages, bad paths, markup and unsupported versions', () => {
  assert.throws(() => validateContentDocument({ ...makePageDocument('home'), pageId: 'pricing' }), /pageId must be one of/);

  assert.throws(
    () => validateContentDocument({ ...makePageDocument('home'), path: '/elsewhere' }),
    /path must be "\/" for page "home"/,
  );

  assert.throws(
    () => validateContentDocument({ ...makePageDocument('home'), title: '<script>alert(1)</script>' }),
    /angle brackets/,
  );

  assert.throws(
    () => validateContentDocument({ ...makePageDocument('home'), schemaVersion: 2 }),
    /schemaVersion must be 1/,
  );

  const badRobots = makePageDocument('home');
  badRobots.seo.robots = 'noindex, archive';
  assert.throws(() => validateContentDocument(badRobots), /seo.robots/);

  const badCanonical = makePageDocument('mandaps');
  badCanonical.seo.canonicalUrl = '/stages';
  assert.throws(() => validateContentDocument(badCanonical), /must resolve to the page path/);
});

test('publication validation rejects duplicate paths and incomplete sets', () => {
  const documents = makeDocuments();
  const duplicate = [...documents, makePageDocument('stages')];
  assert.throws(() => validatePublicationDocuments(duplicate), /is used by both|duplicated/i);

  assert.throws(() => validatePublicationDocuments([makeSiteDocument()]), /incomplete/);
  assert.throws(() => validatePublicationDocuments([]), ContentValidationError);
});

test('site documents validate and expose their structured fields', () => {
  const document = validateContentDocument(makeSiteDocument());
  assert.equal(document.pageId, 'site');
  if (document.pageId !== 'site') return;
  assert.equal(document.settings.name, 'Event Point Ranchi');
  assert.equal(document.homepageSections.length, 1);
  assert.equal(document.services[0].slug, 'mandaps');
});

test('manifests are validated against the exact expected object keys', () => {
  const manifest = buildManifest({
    siteVersion: '2026-11-01T00-00-00-000Z-abc123',
    publicationId: 'pub-1',
    pages: makeDocuments().map((document) => ({
      pageId: document.pageId,
      version: document.contentVersion,
      sha256: sha256Hex(JSON.stringify(document)),
    })),
  });

  const validated = validateManifest(manifest, manifest.siteVersion);
  assert.equal(Object.keys(validated.pages).length, 7);

  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.pages.home.object = 'site-content/other/home.json';
  assert.throws(() => validateManifest(tampered), ManifestValidationError);

  assert.throws(() => validateManifest(manifest, 'different-version'), /does not match the expected/);
  assert.throws(() => validateManifest({ ...manifest, schemaVersion: 9 }), /schemaVersion must be 1/);
});

test('store timeouts and provider errors surface as storage errors', async () => {
  mock.simulateFailure('putObject', { error: new Error('provider exploded') });
  await assert.rejects(() => store.putPage(makePageDocument('home'), 'v-a'), /provider exploded/);
});
