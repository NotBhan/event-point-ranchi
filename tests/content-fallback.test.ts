import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';
import { makeDocuments } from './helpers/content-fixtures';

useIsolatedContentDb();
useIsolatedOperationalDb('content-fallback');
process.env.STORAGE_DRIVER = 'mock';
process.env.CONTENT_PREFIX = 'site-content-test/';
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { MockFilebaseClient, getFilebaseClient, resetFilebaseClient } = await import('../src/core/storage/filebase');
const { getContentStore, resetContentStore } = await import('../src/core/content-storage/store');
const { publishContent } = await import('../src/core/content-storage/publication');
const { resetContentReadCache, getContentFallbackCounters } = await import('../src/core/content-storage/read');
const { contentFallbackMode } = await import('../src/core/content-storage/observability');
const { getPageContent, invalidateContentCache } = await import('../src/core/content/service');

let mock: InstanceType<typeof MockFilebaseClient>;
let store: ReturnType<typeof getContentStore>;
let logs: string[];

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  // The content service reads through the process-wide store, so the test must
  // use the same singleton the publisher writes to.
  resetFilebaseClient();
  resetContentStore();
  mock = getFilebaseClient() as InstanceType<typeof MockFilebaseClient>;
  store = getContentStore();
  resetContentReadCache();
  getContentFallbackCounters().reset();
  invalidateContentCache();
  logs = [];

  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    logs.push(args.map((value) => String(value)).join(' '));
    void originalWarn;
  };

  const neon = getNeonClient();
  await neon.query('DELETE FROM content_releases');
  await neon.query(
    "UPDATE content_pointers SET site_version = '', manifest_key = '', manifest_sha256 = '', publication_id = '' WHERE id = 'active'",
  );

  process.env.CONTENT_STORE = 'filebase';
  process.env.CONTENT_FALLBACK = 'd1';
});

after(() => {
  delete process.env.CONTENT_STORE;
  delete process.env.CONTENT_FALLBACK;
});

function fallbackLogs(): Array<Record<string, unknown>> {
  return logs
    .filter((line) => line.includes('"event":"content_fallback"'))
    .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>);
}

test('an unpublished store falls back to D1 with a structured log and a counter', async () => {
  const page = await getPageContent('home');

  // The D1/snapshot path still produces a page, so the site keeps rendering.
  assert.ok(page.title.length > 0);

  const entries = fallbackLogs();
  assert.equal(entries.length, 1, 'exactly one fallback is logged for one read');
  const entry = entries[0];
  assert.equal(entry.event, 'content_fallback');
  assert.equal(entry.pageId, 'home');
  assert.equal(entry.reason, 'unpublished');
  assert.equal(entry.fallback, 'd1');
  assert.equal(entry.mode, 'd1');
  assert.equal(typeof entry.siteVersion, 'string');
  assert.ok(String(entry.message).length > 0, 'the error message is recorded');

  const counters = getContentFallbackCounters().snapshot();
  assert.equal(counters.total, 1);
  assert.equal(counters['reason.unpublished'], 1);
  assert.equal(counters['page.home'], 1);
});

test('strict mode fails the request instead of serving D1', async () => {
  process.env.CONTENT_FALLBACK = 'strict';
  await assert.rejects(() => getPageContent('home'), /No content version has been published/i);

  const entries = fallbackLogs();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].mode, 'strict');
  assert.equal(getContentFallbackCounters().snapshot().total, 1);
});

test('a broken published version is logged as an integrity fallback', async () => {
  const published = await publishContent({
    documents: makeDocuments(),
    expectedVersion: '',
    actor: { id: null, name: 'test' },
    store,
  });
  resetContentReadCache();
  invalidateContentCache();

  // Corrupt one immutable object so the checksum no longer matches the manifest.
  await mock.putObject({ key: published.pages.home.object, body: '{"tampered":true}', contentType: 'application/json' });

  const page = await getPageContent('home');
  assert.ok(page.title.length > 0, 'D1 content is served instead');

  const entries = fallbackLogs();
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].reason, 'integrity');
  assert.equal(entries[0].siteVersion, published.siteVersion);
  assert.ok(getContentFallbackCounters().snapshot()['reason.integrity'] >= 1);
});

test('a healthy published version produces no fallback at all', async () => {
  await publishContent({ documents: makeDocuments(), expectedVersion: '', actor: { id: null, name: 'test' }, store });
  resetContentReadCache();
  invalidateContentCache();

  const page = await getPageContent('home');
  assert.equal(page.title, 'home title');
  assert.equal(fallbackLogs().length, 0);
  assert.equal(getContentFallbackCounters().snapshot().total, undefined);
});

test('the fallback mode is explicit and defaults to d1', () => {
  delete process.env.CONTENT_FALLBACK;
  assert.equal(contentFallbackMode(), 'd1');
  process.env.CONTENT_FALLBACK = 'strict';
  assert.equal(contentFallbackMode(), 'strict');
  process.env.CONTENT_FALLBACK = 'nonsense';
  assert.equal(contentFallbackMode(), 'd1', 'unknown values fall back to the safe default');
});
