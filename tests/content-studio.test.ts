import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';
import { makeDocuments, makePageDocument } from './helpers/content-fixtures';

useIsolatedContentDb();
useIsolatedOperationalDb('content-studio');
process.env.STORAGE_DRIVER = 'mock';
process.env.CONTENT_PREFIX = 'site-content-test/';
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { getFilebaseClient, resetFilebaseClient } = await import('../src/core/storage/filebase');
const { getContentStore, resetContentStore } = await import('../src/core/content-storage/store');
const { publishContent, getActivePointer } = await import('../src/core/content-storage/publication');
const { resetContentReadCache, getPublishedPageDocument } = await import('../src/core/content-storage/read');
const {
  saveDraft,
  getDraft,
  getEditableDocument,
  deleteDraft,
  clearPublishedDrafts,
  DraftConflictError,
} = await import('../src/core/content-storage/drafts');
const { PAGE_IDS } = await import('../src/core/content-storage/schema');

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  resetFilebaseClient();
  resetContentStore();
  resetContentReadCache();
  const neon = getNeonClient();
  await neon.query('DELETE FROM content_drafts');
  await neon.query('DELETE FROM content_releases');
  await neon.query(
    "UPDATE content_pointers SET site_version = '', manifest_key = '', manifest_sha256 = '', publication_id = '' WHERE id = 'active'",
  );
});

test('a draft is saved, versioned and read back', async () => {
  const document = makePageDocument('home', { title: 'Edited home title' });
  const first = await saveDraft({ pageId: 'home', document, expectedRevision: 0, actor: 'editor-one' });
  assert.equal(first.revision, 1);

  const draft = await getDraft('home');
  assert.equal(draft?.revision, 1);
  assert.equal(draft?.updatedBy, 'editor-one');
  assert.equal((draft?.document as any).title, 'Edited home title');

  const second = await saveDraft({ pageId: 'home', document: { ...document, title: 'Second edit' }, expectedRevision: 1, actor: 'editor-one' });
  assert.equal(second.revision, 2);
});

test('concurrent editors conflict instead of overwriting', async () => {
  const document = makePageDocument('home');
  await saveDraft({ pageId: 'home', document, expectedRevision: 0, actor: 'editor-one' });

  // Both editors loaded revision 1; the first save wins.
  await saveDraft({ pageId: 'home', document: { ...document, title: 'Editor one wins' }, expectedRevision: 1, actor: 'editor-one' });

  await assert.rejects(
    () => saveDraft({ pageId: 'home', document: { ...document, title: 'Editor two overwrites' }, expectedRevision: 1, actor: 'editor-two' }),
    (error: unknown) => error instanceof DraftConflictError,
  );

  const draft = await getDraft('home');
  assert.equal((draft?.document as any).title, 'Editor one wins', 'the first editor keeps their change');
  assert.equal(draft?.revision, 2);
});

test('the editor starts from the draft, and an unpublished draft is not public', async () => {
  const document = makePageDocument('home', { title: 'Draft only' });
  await saveDraft({ pageId: 'home', document, expectedRevision: 0, actor: 'editor' });

  const editable = await getEditableDocument('home');
  assert.equal((editable as any).title, 'Draft only');

  // Nothing has been published, so the public read path refuses to serve it.
  await assert.rejects(() => getPublishedPageDocument('home', { allowFallback: false }), /No content version has been published/);
});

test('publishing from the studio makes the draft public and clears it', async () => {
  const store = getContentStore();
  const published = await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'admin' }, store });

  await saveDraft({
    pageId: 'home',
    document: makePageDocument('home', { title: 'Published from studio', contentVersion: 2 }),
    expectedRevision: 0,
    actor: 'admin',
  });

  const draft = await getDraft('home');
  assert.ok(draft);

  // The publish action overlays drafts on the exported set.
  const base = makeDocuments(2);
  const merged = base.map((document) => (document.pageId === 'home' ? draft!.document : document));
  const second = await publishContent({
    documents: merged,
    expectedVersion: published.siteVersion,
    actor: { id: null, name: 'admin' },
    store,
  });

  resetContentReadCache();
  const publicDocument = await getPublishedPageDocument('home', { store });
  assert.equal((publicDocument as any).title, 'Published from studio');
  assert.equal(second.siteVersion, (await getActivePointer()).siteVersion);

  await clearPublishedDrafts(['home']);
  assert.equal(await getDraft('home'), null);
  assert.equal(await deleteDraft('home'), false);
});

test('a draft containing the seed tagline is rejected before it can be published', async () => {
  const site = makeDocuments().find((document) => document.pageId === 'site');
  assert.ok(site && site.pageId === 'site');
  if (!site || site.pageId !== 'site') return;

  const tampered = { ...site, settings: { ...site.settings, tagline: 'Premier Test Wedding Decorators - 1793530800710' } };
  await assert.rejects(
    () => saveDraft({ pageId: 'site', document: tampered, expectedRevision: 0, actor: 'editor' }),
    /seed placeholder/,
  );
  assert.equal(await getDraft('site'), null);
});

test('catalogue pages are not part of the content documents', () => {
  // Catalogue editing stays in D1; only chrome + page copy live in object storage.
  assert.deepEqual([...PAGE_IDS].sort(), ['catering', 'equipment', 'gallery', 'home', 'mandaps', 'site', 'stages']);
  // The booking pricing authority still reads the D1 catalogue through the
  // content service (verified separately by tests/booking-consolidation.test.ts).
  assert.ok(!PAGE_IDS.includes('mandap' as never));
});
