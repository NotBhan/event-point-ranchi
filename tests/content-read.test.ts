import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';
import { makeDocuments, makePageDocument } from './helpers/content-fixtures';

useIsolatedContentDb();
useIsolatedOperationalDb('content-read');
process.env.STORAGE_DRIVER = 'mock';
process.env.CONTENT_PREFIX = 'site-content-test/';
process.env.CONTENT_POINTER_TTL_MS = '80';
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { MockFilebaseClient } = await import('../src/core/storage/filebase');
const { createContentStore } = await import('../src/core/content-storage/store');
const { publishContent, getActivePointer } = await import('../src/core/content-storage/publication');
const {
  getPublishedPageDocument,
  getPublishedSiteDocument,
  getPublishedPageByPath,
  getPublishedSiteVersion,
  getPublishedManifest,
  resetContentReadCache,
  contentStoreEnabled,
  ContentReadError,
} = await import('../src/core/content-storage/read');

let mock: InstanceType<typeof MockFilebaseClient>;
let store: ReturnType<typeof createContentStore>;

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  mock = new MockFilebaseClient();
  store = createContentStore(mock);
  resetContentReadCache();

  // Each test starts from "nothing published" against the same isolated database.
  const neon = getNeonClient();
  await neon.query('DELETE FROM content_releases');
  await neon.query(
    "UPDATE content_pointers SET site_version = '', manifest_key = '', manifest_sha256 = '', publication_id = '', updated_by = NULL WHERE id = 'active'",
  );
});

test('the read flag is off unless explicitly enabled', () => {
  const previous = process.env.CONTENT_STORE;
  delete process.env.CONTENT_STORE;
  assert.equal(contentStoreEnabled(), false);
  process.env.CONTENT_STORE = 'filebase';
  assert.equal(contentStoreEnabled(), true);
  process.env.CONTENT_STORE = previous;
});

test('reads resolve the active version through the pointer and manifest', async () => {
  const published = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  assert.equal(await getPublishedSiteVersion(), published.siteVersion);
  const document = await getPublishedPageDocument('home', { store });
  assert.equal(document.pageId, 'home');
  assert.equal(document.contentVersion, 1);
  assert.equal(document.title, 'home title');

  const site = await getPublishedSiteDocument({ store });
  assert.equal(site.settings.name, 'Event Point Ranchi');

  const byPath = await getPublishedPageByPath('/mandaps', { store });
  assert.equal(byPath?.pageId, 'mandaps');
  assert.equal(await getPublishedPageByPath('/not-a-page', { store }), null);
});

test('an immutable page is cached per site version', async () => {
  await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  let reads = 0;
  const counting = {
    ...store,
    readObject: async (key: string) => {
      reads += 1;
      return store.readObject(key);
    },
  };

  await getPublishedPageDocument('home', { store: counting });
  const afterFirst = reads;
  await getPublishedPageDocument('home', { store: counting });
  assert.equal(reads, afterFirst, 'a cached page must not hit storage again');
});

test('the pointer cache expires so a new publication becomes visible', async () => {
  const first = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  assert.equal(await getPublishedSiteVersion(), first.siteVersion);

  const second = await publishContent({
    documents: makeDocuments(2),
    expectedVersion: first.siteVersion,
    actor: { id: null, name: 'B' },
    store,
  });

  // Within the TTL the old version is still reported (bounded staleness).
  assert.equal(await getPublishedSiteVersion(), first.siteVersion);

  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(await getPublishedSiteVersion(), second.siteVersion);

  const document = await getPublishedPageDocument('home', { store });
  assert.equal(document.contentVersion, 2);
});

test('an unpublished store reports "unpublished" rather than serving nothing silently', async () => {
  await assert.rejects(
    () => getPublishedPageDocument('home', { store, allowFallback: false }),
    (error: unknown) => error instanceof ContentReadError && error.code === 'unpublished',
  );
  assert.equal(await getPublishedManifest(store), null);
});

test('a corrupted page object raises an integrity error', async () => {
  const published = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  const key = published.pages.home.object;
  await mock.putObject({ key, body: JSON.stringify({ ...makePageDocument('home'), title: 'Tampered' }), contentType: 'application/json' });

  await assert.rejects(
    () => getPublishedPageDocument('home', { store, allowFallback: false }),
    (error: unknown) => error instanceof ContentReadError && error.code === 'integrity',
  );

  // The legacy active version is still reported correctly.
  assert.equal(await getPublishedSiteVersion(), published.siteVersion);
});

test('a missing manifest is reported as an integrity failure', async () => {
  const published = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  await mock.deleteObject(published.manifestKey);

  await assert.rejects(
    () => getPublishedManifest(store),
    (error: unknown) => error instanceof ContentReadError && error.code === 'integrity',
  );
});

test('an invalid page schema is rejected before it can be rendered', async () => {
  const published = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  const key = published.pages.gallery.object;
  const invalid = { ...makePageDocument('gallery'), title: '<iframe src="x"></iframe>' };
  await mock.putObject({ key, body: JSON.stringify(invalid), contentType: 'application/json' });

  await assert.rejects(
    () => getPublishedPageDocument('gallery', { store, allowFallback: false }),
    /angle brackets|integrity|checksum/i,
  );
});

test('a broken active version falls back to the last known good published version', async () => {
  const first = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  const second = await publishContent({
    documents: makeDocuments(2),
    expectedVersion: first.siteVersion,
    actor: { id: null, name: 'B' },
    store,
  });

  await mock.deleteObject(second.pages.home.object);

  const document = await getPublishedPageDocument('home', { store });
  assert.equal(document.contentVersion, 1, 'the intact older version is served');
  assert.equal(await getPublishedSiteVersion(), second.siteVersion, 'the pointer is not misreported');
});

test('the pointer is reused when Neon briefly fails', async () => {
  const published = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  assert.equal(await getPublishedSiteVersion(), published.siteVersion);

  // Force the cached pointer to expire, then break the database handle.
  await new Promise((resolve) => setTimeout(resolve, 120));

  const neon = getNeonClient();
  const originalQuery = neon.query.bind(neon);
  (neon as unknown as { query: typeof originalQuery }).query = async () => {
    throw new Error('neon unavailable');
  };

  try {
    assert.equal(await getPublishedSiteVersion(), published.siteVersion, 'last known pointer is reused');
  } finally {
    (neon as unknown as { query: typeof originalQuery }).query = originalQuery;
  }

  assert.equal((await getActivePointer()).siteVersion, published.siteVersion);
});
