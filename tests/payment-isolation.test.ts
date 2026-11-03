import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { paymentsEnabled } from '../src/core/features';
import { isPaymentServiceInitialized } from '../src/core/payment/payment-service';

const API_BASE = 'http://localhost:4321';

function request(path: string, body = '{}'): Request {
  return new Request(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('paymentsEnabled is server-side, opt-in and exact', () => {
  const previous = process.env.PAYMENTS_ENABLED;
  try {
    delete process.env.PAYMENTS_ENABLED;
    assert.equal(paymentsEnabled(), false);
    for (const value of ['', '1', 'TRUE', 'True', 'true ', 'yes']) {
      process.env.PAYMENTS_ENABLED = value;
      assert.equal(paymentsEnabled(), false, `${JSON.stringify(value)} must not enable payments`);
    }
    process.env.PAYMENTS_ENABLED = 'true';
    assert.equal(paymentsEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = previous;
  }
});

test('payment APIs are blocked before provider initialization or request parsing', async () => {
  const previous = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'false';
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network request attempted while payments are disabled');
  }) as typeof fetch;

  try {
    const { POST: createOrder } = await import('../src/pages/api/payment/create-order');
    const { POST: verify } = await import('../src/pages/api/payment/verify');
    const { POST: webhook } = await import('../src/pages/api/payment/webhook/phonepe');
    const { GET: download } = await import('../src/pages/api/payment/receipt/download');

    const createRes = await createOrder({ request: request('/api/payment/create-order'), url: new URL(`${API_BASE}/api/payment/create-order`) } as never);
    const verifyRes = await verify({ request: request('/api/payment/verify') } as never);
    const webhookRes = await webhook({ request: request('/api/payment/webhook/phonepe') } as never);
    const downloadRes = await download({ url: new URL(`${API_BASE}/api/payment/receipt/download?token=x`) } as never);

    assert.equal(createRes.status, 404);
    assert.equal(verifyRes.status, 404);
    assert.equal(webhookRes.status, 404);
    assert.equal(downloadRes.status, 404);
    assert.equal(fetchCalls, 0, 'payment APIs must not make provider network requests');
    assert.equal(isPaymentServiceInitialized(), false, 'payment provider service must not be initialized');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = previous;
  }
});

test('admin payment handlers and refund path are blocked before payment queries or provider startup', async () => {
  const previous = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'false';
  try {
    const { paymentsList, paymentDetail } = await import('../src/modules/admin/handlers/operations');
    const { processRefundAdmin } = await import('../src/modules/admin/service');
    const ctx = { url: new URL(`${API_BASE}/admin/payments`), request: new Request(`${API_BASE}/admin/payments`), form: new FormData(), cookies: {} } as never;

    const listRes = await paymentsList(ctx);
    const detailRes = await paymentDetail(ctx);
    assert.ok(listRes instanceof Response);
    assert.ok(detailRes instanceof Response);
    assert.equal(listRes.status, 404);
    assert.equal(detailRes.status, 404);
    await assert.rejects(() => processRefundAdmin(1, 100, 'test'), /Payments are not available/i);
    assert.equal(isPaymentServiceInitialized(), false);
  } finally {
    if (previous === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = previous;
  }
});

test('quotation page has no online-payment CTA and admin module does not statically expose payments', async () => {
  const quotation = await readFile(new URL('../src/modules/bookings/pages/QuotationPage.astro', import.meta.url), 'utf8');
  const adminModule = await readFile(new URL('../src/modules/admin/module.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(quotation, /payment\/checkout/i);
  assert.doesNotMatch(quotation, /Pay advance online/i);
  assert.match(adminModule, /paymentsEnabled\(\)/);
  assert.match(adminModule, /label: 'Payments'/);
});

test('features module is not imported by the Plan client bundle', async () => {
  const client = await readFile(new URL('../src/client/plan-wizard.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /core\/features/);
});
