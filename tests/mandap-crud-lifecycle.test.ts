import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'event-point-mandap-lifecycle-'));
process.env.DATA_DIR = join(tempRoot, 'data');
process.env.OPERATIONAL_DB_LOCAL_PATH = join(tempRoot, 'operational.db');
process.env.D1_LOCAL = '1';
process.env.CONTENT_SOURCE = 'd1';
process.env.STORAGE_DRIVER = 'mock';
process.env.APP_SECRET = 'mandap-lifecycle-test-secret';
process.env.TEST_MODE = '1';

const { getD1Client } = await import('../src/core/content/d1-client');
const { migrateCatalogueAdmin } = await import('../scripts/migrate-catalogue-admin-d1');
const { catalogueForm } = await import('../src/modules/admin/handlers/catalogue');
const { saveCatalogueEditor } = await import('../src/modules/admin/catalogue-service');
const { loadCatalogueAdmin } = await import('../src/core/content/catalogue-admin-store');
const { getMandaps } = await import('../src/core/content/service');

after(() => rmSync(tempRoot, { recursive: true, force: true }));

// Setup tables
await migrateCatalogueAdmin(getD1Client());

function makeForm(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

function makeContext(options: {
  method?: string;
  form?: FormData;
  accept?: string;
  id?: string;
} = {}) {
  const { method = 'POST', form = new FormData(), accept = 'application/json', id = 'new' } = options;
  const headers = new Headers();
  if (accept) headers.set('accept', accept);

  const cookieStore = new Map<string, any>();
  const cookies = {
    get: (key: string) => cookieStore.get(key),
    set: (key: string, value: any) => cookieStore.set(key, value),
    delete: (key: string) => cookieStore.delete(key),
  };

  return {
    ctx: {
      auth: { user: null, isAuthenticated: false, isAdmin: false, isEditor: false, isSuperadmin: false, isDeveloper: false },
      adminAuth: { user: { id: 1, role: 'admin' }, isAuthenticated: true, isAdmin: true, isEditor: true, isSuperadmin: false, isDeveloper: false },
      url: new URL(`http://localhost/admin/mandaps/${id}`),
      request: new Request(`http://localhost/admin/mandaps/${id}`, {
        method,
        headers,
      }),
      params: { id },
      form,
      cookies,
      csrf: 'test-csrf-token',
    } as any,
    cookieStore,
  };
}

// -----------------------------------------------------------------------------
// Scenario 1: Prompt return on successful Mandap creation (< 3000ms)
// -----------------------------------------------------------------------------
test('Scenario 1: Prompt return on successful Mandap creation (< 3000ms)', async () => {
  const form = makeForm({
    action: 'save',
    name: 'Royal Heritage Glass Mandap',
    slug: 'royal-heritage-glass-mandap',
    category: 'Contemporary Glass',
    status: 'active',
    price: '350000',
    description: 'Stunning glass mandap with crystal pillars.',
    full_description: 'Full details of the contemporary glass mandap.',
    length_ft: '24',
    width_ft: '24',
    height_ft: '16',
    capacity: '150',
    sort_order: '1',
  });

  const { ctx, cookieStore } = makeContext({ form, accept: 'application/json' });
  const start = performance.now();
  const response = (await catalogueForm(ctx, 'mandaps')) as Response;
  const duration = performance.now() - start;

  assert.ok(duration < 3000, `Expected response under 3000ms, took ${duration.toFixed(1)}ms`);
  assert.equal(response.status, 200);

  const json = await response.json();
  assert.equal(json.status, 'ok');
  assert.ok(json.data?.id > 0);
  assert.equal(json.data.redirect, `/admin/mandaps/${json.data.id}`);
  assert.ok(json.message.includes('created successfully'));

  // Verify flash cookie was set
  assert.ok(cookieStore.has('rp_flash'));

  // Verify item exists in database
  const loaded = await loadCatalogueAdmin('mandaps', json.data.id);
  assert.ok(loaded);
  assert.equal(loaded?.item.name, 'Royal Heritage Glass Mandap');
  assert.equal(loaded?.item.slug, 'royal-heritage-glass-mandap');
  assert.equal(loaded?.item.is_visible, 1);
});

// -----------------------------------------------------------------------------
// Scenario 2: Database insert failure returns clear error (not hang)
// -----------------------------------------------------------------------------
test('Scenario 2: Database insert failure returns clear error (not hang)', async () => {
  const form = makeForm({
    action: 'save',
    name: 'Faulty Mandap',
    slug: 'faulty-mandap',
  });

  const d1 = getD1Client();
  const originalQuery = d1.query.bind(d1);
  d1.query = async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO mandaps')) {
      throw new Error('D1_SQLITE_ERROR: disk I/O error or constraint failure');
    }
    return originalQuery(sql, params);
  };

  try {
    const { ctx } = makeContext({ form, accept: 'application/json' });
    const response = (await catalogueForm(ctx, 'mandaps')) as Response;
    assert.equal(response.status, 400);

    const json = await response.json();
    assert.equal(json.status, 'error');
    assert.ok(json.message.includes('D1_SQLITE_ERROR'));
  } finally {
    d1.query = originalQuery;
  }
});

// -----------------------------------------------------------------------------
// Scenario 3: Explicit slug conflict handling (reject with helpful error)
// -----------------------------------------------------------------------------
test('Scenario 3: Explicit slug conflict handling rejects duplicates cleanly', async () => {
  const form1 = makeForm({
    action: 'save',
    name: 'First Sunset Mandap',
    slug: 'sunset-royal-mandap',
    status: 'active',
    price: '200000',
  });
  const { ctx: ctx1 } = makeContext({ form: form1 });
  const res1 = (await catalogueForm(ctx1, 'mandaps')) as Response;
  assert.equal(res1.status, 200);

  const form2 = makeForm({
    action: 'save',
    name: 'Second Sunset Mandap',
    slug: 'sunset-royal-mandap',
    status: 'active',
    price: '220000',
  });
  const { ctx: ctx2 } = makeContext({ form: form2 });
  const res2 = (await catalogueForm(ctx2, 'mandaps')) as Response;
  assert.equal(res2.status, 400);

  const json2 = await res2.json();
  assert.equal(json2.status, 'error');
  assert.ok(
    json2.message.includes('already in use'),
    `Expected slug conflict error message, got: ${json2.message}`,
  );
});

// -----------------------------------------------------------------------------
// Scenario 4: Invalid form data returns validation errors
// -----------------------------------------------------------------------------
test('Scenario 4: Invalid form data returns validation errors', async () => {
  // 4a: Missing name
  const emptyNameForm = makeForm({
    action: 'save',
    name: '   ',
    status: 'active',
  });
  const { ctx: ctxEmpty } = makeContext({ form: emptyNameForm });
  const resEmpty = (await catalogueForm(ctxEmpty, 'mandaps')) as Response;
  assert.equal(resEmpty.status, 400);
  const jsonEmpty = await resEmpty.json();
  assert.equal(jsonEmpty.message, 'Name is required.');

  // 4b: Negative price
  const negPriceForm = makeForm({
    action: 'save',
    name: 'Negative Price Mandap',
    price: '-500',
    pricing_mode: 'fixed',
  });
  const { ctx: ctxNeg } = makeContext({ form: negPriceForm });
  const resNeg = (await catalogueForm(ctxNeg, 'mandaps')) as Response;
  assert.equal(resNeg.status, 400);
  const jsonNeg = await resNeg.json();
  assert.equal(jsonNeg.message, 'Price cannot be negative.');

  // 4c: Invalid publication status
  const badStatusForm = makeForm({
    action: 'save',
    name: 'Bad Status Mandap',
    status: 'published_secret',
  });
  const { ctx: ctxStatus } = makeContext({ form: badStatusForm });
  const resStatus = (await catalogueForm(ctxStatus, 'mandaps')) as Response;
  assert.equal(resStatus.status, 400);
  const jsonStatus = await resStatus.json();
  assert.equal(jsonStatus.message, 'Invalid publication status.');

  // 4d: Negative dimensions
  const negDimForm = makeForm({
    action: 'save',
    name: 'Negative Dimension Mandap',
    length_ft: '-10',
  });
  const { ctx: ctxDim } = makeContext({ form: negDimForm });
  const resDim = (await catalogueForm(ctxDim, 'mandaps')) as Response;
  assert.equal(resDim.status, 400);
  const jsonDim = await resDim.json();
  assert.equal(jsonDim.message, 'Dimensions cannot be negative.');
});

// -----------------------------------------------------------------------------
// Scenario 5: D1 timeout / connection failure does not hang indefinitely
// -----------------------------------------------------------------------------
test('Scenario 5: D1 timeout / connection failure returns cleanly within bounded time', async () => {
  const form = makeForm({
    action: 'save',
    name: 'Timeout Test Mandap',
    slug: 'timeout-test-mandap',
  });

  const d1 = getD1Client();
  const originalQuery = d1.query.bind(d1);
  d1.query = async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO mandaps')) {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }
    return originalQuery(sql, params);
  };

  try {
    const { ctx } = makeContext({ form, accept: 'application/json' });
    const start = performance.now();
    const response = (await catalogueForm(ctx, 'mandaps')) as Response;
    const duration = performance.now() - start;

    assert.ok(duration < 1000, `Expected prompt failure handling under 1000ms, took ${duration.toFixed(1)}ms`);
    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(json.status, 'error');
    assert.ok(json.message.includes('timeout'));
  } finally {
    d1.query = originalQuery;
  }
});

// -----------------------------------------------------------------------------
// Scenario 6: Cache invalidation does not block response
// -----------------------------------------------------------------------------
test('Scenario 6: Cache invalidation runs synchronously and does not block response', async () => {
  const form = makeForm({
    action: 'save',
    name: 'Cache Invalidation Mandap',
    slug: 'cache-invalidation-mandap',
    status: 'active',
    price: '150000',
  });

  const start = performance.now();
  const id = await saveCatalogueEditor('mandaps', form);
  const duration = performance.now() - start;

  assert.ok(duration < 500, `Creation with cache invalidation took ${duration.toFixed(1)}ms`);
  assert.ok(id > 0);

  const mandaps = await getMandaps();
  assert.ok(mandaps.some((m) => m.id === id));
});

// -----------------------------------------------------------------------------
// Scenario 7: Mandap creation does NOT invoke Build D1 synchronization
// -----------------------------------------------------------------------------
test('Scenario 7: Mandap creation does NOT invoke Build D1 synchronization', async () => {
  const d1 = getD1Client();
  const queriedTables: string[] = [];
  const originalQuery = d1.query.bind(d1);
  d1.query = async (sql: string, params: any[] = []) => {
    queriedTables.push(sql);
    if (sql.includes('_content_sync_state') || sql.includes('publications')) {
      throw new Error(`Build D1 sync/publication query executed unexpectedly: ${sql}`);
    }
    return originalQuery(sql, params);
  };

  try {
    const form = makeForm({
      action: 'save',
      name: 'Decoupled Sync Mandap',
      slug: 'decoupled-sync-mandap',
      status: 'active',
      price: '100000',
    });
    const { ctx } = makeContext({ form });
    const res = (await catalogueForm(ctx, 'mandaps')) as Response;
    assert.equal(res.status, 200);

    // Verify none of the executed queries touched publication sync tables
    assert.ok(queriedTables.length > 0);
    assert.equal(
      queriedTables.some((q) => q.includes('_content_sync_state') || q.includes('publications')),
      false,
      'Mandap CRUD must never access _content_sync_state or publications tables',
    );
  } finally {
    d1.query = originalQuery;
  }
});

// -----------------------------------------------------------------------------
// Scenario 8: Mandap creation does NOT invoke Vercel deploy hook
// -----------------------------------------------------------------------------
test('Scenario 8: Mandap creation does NOT invoke Vercel deploy hook', async () => {
  const originalFetch = globalThis.fetch;
  let deployHookCalled = false;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? '');
    if (url.includes('api.vercel.com') || url.includes('deploy-hook')) {
      deployHookCalled = true;
      throw new Error('Vercel API or deploy hook must NEVER be called by Mandap CRUD!');
    }
    return originalFetch(input, init);
  };

  try {
    const form = makeForm({
      action: 'save',
      name: 'No Deploy Hook Mandap',
      slug: 'no-deploy-hook-mandap',
      status: 'active',
      price: '120000',
    });
    const { ctx } = makeContext({ form });
    const res = (await catalogueForm(ctx, 'mandaps')) as Response;
    assert.equal(res.status, 200);
    assert.equal(deployHookCalled, false, 'Vercel deploy hook was unexpectedly called!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -----------------------------------------------------------------------------
// Scenario 9: Repeated submission does not create duplicate records
// -----------------------------------------------------------------------------
test('Scenario 9: Repeated submission with explicit slug does not create duplicate records', async () => {
  const explicitSlug = 'repeat-submission-mandap';
  const form1 = makeForm({
    action: 'save',
    name: 'Repeat Submission Mandap',
    slug: explicitSlug,
    status: 'active',
  });
  const { ctx: ctx1 } = makeContext({ form: form1 });
  const res1 = (await catalogueForm(ctx1, 'mandaps')) as Response;
  assert.equal(res1.status, 200);

  const form2 = makeForm({
    action: 'save',
    name: 'Repeat Submission Mandap',
    slug: explicitSlug,
    status: 'active',
  });
  const { ctx: ctx2 } = makeContext({ form: form2 });
  const res2 = (await catalogueForm(ctx2, 'mandaps')) as Response;
  assert.equal(res2.status, 400);

  const d1 = getD1Client();
  const rows = await d1.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM mandaps WHERE slug = ?',
    [explicitSlug],
  );
  assert.equal(Number(rows.results[0]?.count), 1);
});

// -----------------------------------------------------------------------------
// Scenario 10: Loading state lifecycle (simulation of client submit lifecycle)
// -----------------------------------------------------------------------------
test('Scenario 10: Client lifecycle resets loading states on both success and failure', async () => {
  const okForm = makeForm({
    action: 'save',
    name: 'Lifecycle OK Mandap',
    slug: 'lifecycle-ok-mandap',
  });
  const { ctx: okCtx } = makeContext({ form: okForm });
  const okRes = (await catalogueForm(okCtx, 'mandaps')) as Response;
  assert.equal(okRes.status, 200);
  const okData = await okRes.json();
  assert.equal(okData.status, 'ok');
  assert.ok(okData.data?.redirect);

  const failForm = makeForm({
    action: 'save',
    name: '',
  });
  const { ctx: failCtx } = makeContext({ form: failForm });
  const failRes = (await catalogueForm(failCtx, 'mandaps')) as Response;
  assert.equal(failRes.status, 400);
  const failData = await failRes.json();
  assert.equal(failData.status, 'error');
  assert.ok(failData.message);
});
