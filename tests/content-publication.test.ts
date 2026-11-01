import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';
import { makeDocuments, makePageDocument, makeSiteDocument } from './helpers/content-fixtures';

useIsolatedContentDb();
useIsolatedOperationalDb('content-publication');
process.env.STORAGE_DRIVER = 'mock';
process.env.CONTENT_PREFIX = 'site-content-test/';
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { MockFilebaseClient } = await import('../src/core/storage/filebase');
const { createContentStore } = await import('../src/core/content-storage/store');
const {
  publishContent,
  stageContent,
  activateRelease,
  getActivePointer,
  getReleaseById,
  listReleases,
  rollbackContent,
  reconcileReleases,
  PublicationError,
} = await import('../src/core/content-storage/publication');
const { resetContentReadCache, getPublishedPageDocument } = await import('../src/core/content-storage/read');

let mock: InstanceType<typeof MockFilebaseClient>;
let store: ReturnType<typeof createContentStore>;

function wrapStore(overrides: Partial<ReturnType<typeof createContentStore>>) {
  return {
    putPage: overrides.putPage ?? store.putPage.bind(store),
    putManifest: overrides.putManifest ?? store.putManifest.bind(store),
    readObject: overrides.readObject ?? store.readObject.bind(store),
    headObject: overrides.headObject ?? store.headObject.bind(store),
    verifyObject: overrides.verifyObject ?? store.verifyObject.bind(store),
  };
}

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

test('publishing uploads, verifies and moves the pointer', async () => {
  const pointerBefore = await getActivePointer();
  assert.equal(pointerBefore.siteVersion, '');

  const result = await publishContent({
    documents: makeDocuments(),
    expectedVersion: '',
    actor: { id: 7, name: 'Admin' },
    store,
  });

  const pointerAfter = await getActivePointer();
  assert.equal(pointerAfter.siteVersion, result.siteVersion);
  assert.equal(pointerAfter.manifestKey, result.manifestKey);
  assert.equal(pointerAfter.manifestSha256, result.manifestSha256);

  const release = await getReleaseById(result.publicationId);
  assert.equal(release?.status, 'published');
  assert.equal(release?.publishedByName, 'Admin');
  assert.ok(release?.completedAt);

  // The manifest names exactly the seven objects that were uploaded.
  assert.equal(Object.keys(result.pages).length, 7);
  const document = await getPublishedPageDocument('home', { store });
  assert.equal(document.pageId, 'home');
});

test('staging uploads without changing the active pointer', async () => {
  const staged = await stageContent({
    documents: makeDocuments(),
    expectedVersion: '',
    actor: { id: null, name: 'Migration' },
    store,
  });

  assert.equal((await getActivePointer()).siteVersion, '', 'staging must not activate');
  const release = await getReleaseById(staged.publicationId);
  assert.equal(release?.status, 'verified');

  const activated = await activateRelease({
    publicationId: staged.publicationId,
    expectedVersion: '',
    actor: { id: null, name: 'Migration' },
  });
  assert.equal((await getActivePointer()).siteVersion, activated.siteVersion);
});

test('a failed upload leaves the previous version active and marks the release failed', async () => {
  const first = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  const failing = wrapStore({
    putPage: async (document, siteVersion) => {
      if (document.pageId === 'stages') throw new Error('simulated upload failure');
      return store.putPage(document, siteVersion);
    },
  });

  await assert.rejects(
    () =>
      publishContent({
        documents: makeDocuments(2),
        expectedVersion: first.siteVersion,
        actor: { id: null, name: 'B' },
        store: failing,
      }),
    /simulated upload failure/,
  );

  assert.equal((await getActivePointer()).siteVersion, first.siteVersion, 'pointer must not move');
  const failed = (await listReleases(10)).find((release) => release.status === 'failed');
  assert.ok(failed, 'the failed release is recorded');
  assert.match(failed!.error, /simulated upload failure/);
});

test('a manifest verification failure leaves the pointer untouched', async () => {
  const failing = wrapStore({
    verifyObject: async (key, sha) => {
      if (key.includes('/manifests/')) return { ok: false, actualSha256: 'deadbeef', size: 0 };
      return store.verifyObject(key, sha);
    },
  });

  await assert.rejects(
    () => publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store: failing }),
    /Manifest verification failed/,
  );
  assert.equal((await getActivePointer()).siteVersion, '');
});

test('a concurrent publisher conflicts instead of overwriting the newer version', async () => {
  const base = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  // Two publishers both read `base` as the expected version and both stage.
  const first = await stageContent({ documents: makeDocuments(2), expectedVersion: base.siteVersion, actor: { id: null, name: 'B' }, store });
  const second = await stageContent({ documents: makeDocuments(3), expectedVersion: base.siteVersion, actor: { id: null, name: 'C' }, store });

  const winner = await activateRelease({ publicationId: first.publicationId, expectedVersion: base.siteVersion, actor: { id: null, name: 'B' } });
  assert.equal((await getActivePointer()).siteVersion, winner.siteVersion);

  await assert.rejects(
    () => activateRelease({ publicationId: second.publicationId, expectedVersion: base.siteVersion, actor: { id: null, name: 'C' } }),
    (error: unknown) => error instanceof PublicationError && error.code === 'conflict',
  );

  assert.equal((await getActivePointer()).siteVersion, winner.siteVersion, 'the newer version must survive');
  assert.equal((await getReleaseById(second.publicationId))?.status, 'conflicted');

  // Publishing with a stale expected version is rejected before any upload.
  await assert.rejects(
    () => publishContent({ documents: makeDocuments(4), expectedVersion: base.siteVersion, actor: { id: null, name: 'D' }, store }),
    /Content changed since you loaded it/,
  );
});

test('rollback moves the pointer back without rewriting objects', async () => {
  const first = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  const firstManifest = await store.readObject(first.manifestKey);

  const second = await publishContent({
    documents: makeDocuments(2),
    expectedVersion: first.siteVersion,
    actor: { id: null, name: 'B' },
    store,
  });

  const result = await rollbackContent({
    targetSiteVersion: first.siteVersion,
    expectedVersion: second.siteVersion,
    actor: { id: 1, name: 'Admin', isAdmin: true },
    store,
  });

  assert.equal(result.siteVersion, first.siteVersion);
  assert.equal((await getActivePointer()).siteVersion, first.siteVersion);

  // The original manifest is byte-identical after the rollback.
  const afterManifest = await store.readObject(first.manifestKey);
  assert.equal(afterManifest?.sha256, firstManifest?.sha256);

  const history = await listReleases(10);
  assert.ok(history.some((release) => release.status === 'rolled_back' && release.rolledBackTo === first.siteVersion));
});

test('rollback refuses when a referenced object is missing', async () => {
  const first = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  const second = await publishContent({ documents: makeDocuments(2), expectedVersion: first.siteVersion, actor: { id: null, name: 'B' }, store });

  // Remove one immutable object belonging to the target version.
  await mock.deleteObject(first.pages.stages.object);

  await assert.rejects(
    () =>
      rollbackContent({
        targetSiteVersion: first.siteVersion,
        expectedVersion: second.siteVersion,
        actor: { id: 1, name: 'Admin', isAdmin: true },
        store,
      }),
    /does not match its recorded checksum|is missing/,
  );

  assert.equal((await getActivePointer()).siteVersion, second.siteVersion, 'failed rollback keeps the active version');
});

test('rollback requires admin rights and a current expected version', async () => {
  const first = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });

  await assert.rejects(
    () =>
      rollbackContent({
        targetSiteVersion: first.siteVersion,
        expectedVersion: first.siteVersion,
        actor: { id: 2, name: 'Editor', isAdmin: false },
        store,
      }),
    /Only administrators/,
  );

  await assert.rejects(
    () =>
      rollbackContent({
        targetSiteVersion: first.siteVersion,
        expectedVersion: 'stale-version',
        actor: { id: 1, name: 'Admin', isAdmin: true },
        store,
      }),
    /Content changed since you loaded it/,
  );
});

test('reconciliation repairs a release whose final status write was lost', async () => {
  const staged = await stageContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'A' }, store });
  await activateRelease({ publicationId: staged.publicationId, expectedVersion: '', actor: { id: null, name: 'A' } });

  // Simulate the lost final write: the pointer is live but the release still
  // says "verified".
  const neon = getNeonClient();
  await neon.query("UPDATE content_releases SET status = 'verified', completed_at = NULL WHERE id = $1", [staged.publicationId]);

  const { repaired } = await reconcileReleases();
  assert.ok(repaired.some((entry) => entry.id === staged.publicationId && entry.status === 'published'));
  assert.equal((await getReleaseById(staged.publicationId))?.status, 'published');
});

test('an incomplete publication set is rejected before anything is uploaded', async () => {
  await assert.rejects(
    () => publishContent({ documents: [makeSiteDocument(), makePageDocument('home')], expectedVersion: '', actor: { id: null, name: 'A' }, store }),
    /incomplete/,
  );
  assert.equal((await getActivePointer()).siteVersion, '');
});
