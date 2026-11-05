import assert from 'node:assert/strict';
import { test } from 'node:test';

const { assertContentBuildSchema, ContentBuildSchemaError } = await import('../src/core/content/d1-schema-check');
const { resolveSyncConfig } = await import('../scripts/sync-content');

const buildEnv = {
  BUILD_TARGET: 'vercel',
  CONTENT_BUILD_D1_ACCOUNT_ID: 'build-account',
  CONTENT_BUILD_D1_DATABASE_ID: 'build-db',
  CONTENT_BUILD_D1_API_TOKEN: 'build-token',
};

test('Vercel builds require dedicated CONTENT_BUILD_D1 credentials', () => {
  const result = resolveSyncConfig({
    BUILD_TARGET: 'vercel',
    CLOUDFLARE_ACCOUNT_ID: 'production-account',
    CLOUDFLARE_DATABASE_ID: 'production-db',
    CLOUDFLARE_API_TOKEN: 'production-token',
  });
  assert.equal(result.config, null);
  assert.deepEqual(result.missing, [
    'CONTENT_BUILD_D1_ACCOUNT_ID',
    'CONTENT_BUILD_D1_DATABASE_ID',
    'CONTENT_BUILD_D1_API_TOKEN',
  ]);
  assert.match(result.reason ?? '', /dedicated isolated build-time D1/i);
  assert.match(result.reason ?? '', /refused/i);
});

test('Vercel builds use the dedicated build database instead of Production values', () => {
  const result = resolveSyncConfig({
    ...buildEnv,
    CLOUDFLARE_ACCOUNT_ID: 'production-account',
    CLOUDFLARE_DATABASE_ID: 'production-db',
    CLOUDFLARE_API_TOKEN: 'production-token',
  });
  assert.equal(result.missing.length, 0);
  assert.equal(result.config?.accountId, 'build-account');
  assert.equal(result.config?.databaseId, 'build-db');
  assert.equal(result.config?.apiToken, 'build-token');
});

test('local Vercel-shaped verification may explicitly force the local D1', () => {
  const result = resolveSyncConfig({
    BUILD_TARGET: 'vercel',
    D1_LOCAL: '1',
    CLOUDFLARE_ACCOUNT_ID: 'local-account',
    CLOUDFLARE_DATABASE_ID: 'local-db',
    CLOUDFLARE_API_TOKEN: 'local-token',
  });
  assert.equal(result.config?.databaseId, 'local-db');
});

test('schema preflight fails before catalogue reads when menu_items.sort is missing', async () => {
  const client = {
    async query<T>() {
      return { results: [
        { name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null },
        { name: 'category_id', type: 'INTEGER', notnull: 1, dflt_value: null },
      ] as T[] };
    },
  };
  await assert.rejects(
    () => assertContentBuildSchema(client, 'Cloudflare D1 test-db'),
    (error: unknown) => {
      assert.ok(error instanceof ContentBuildSchemaError);
      assert.match(error.message, /test-db/);
      assert.match(error.message, /menu_items\.sort/);
      assert.match(error.message, /db:migrate:catalogue-admin/);
      return true;
    },
  );
});

test('schema preflight rejects a column with the wrong definition', async () => {
  const client = {
    async query<T>() {
      return { results: [
        { name: 'sort', type: 'TEXT', notnull: 0, dflt_value: null },
      ] as T[] };
    },
  };
  await assert.rejects(
    () => assertContentBuildSchema(client, 'Cloudflare D1 test-db'),
    /INTEGER NOT NULL DEFAULT 0/,
  );
});

test('schema preflight accepts the reviewed menu_items.sort definition', async () => {
  const client = {
    async query<T>() {
      return { results: [
        { name: 'sort', type: 'INTEGER', notnull: 1, dflt_value: '0' },
      ] as T[] };
    },
  };
  await assert.doesNotReject(() => assertContentBuildSchema(client, 'Cloudflare D1 test-db'));
});
