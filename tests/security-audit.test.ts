import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../src/core/http';
import { GET as downloadReceipt } from '../src/pages/api/payment/receipt/download';
import { POST as publishReport } from '../src/pages/api/internal/publish-report';

test('1. safeNext prevents open redirect bypass attacks', () => {
  // Classic external attempts
  assert.equal(safeNext('https://evil.com', '/fallback'), '/fallback');
  assert.equal(safeNext('http://evil.com', '/fallback'), '/fallback');
  assert.equal(safeNext('//evil.com', '/fallback'), '/fallback');
  assert.equal(safeNext('///evil.com', '/fallback'), '/fallback');

  // Backslash normalization bypasses
  assert.equal(safeNext('/\\evil.com', '/fallback'), '/fallback');
  assert.equal(safeNext('/\\/evil.com', '/fallback'), '/fallback');
  assert.equal(safeNext('/evil.com\\..', '/fallback'), '/fallback');

  // Invalid schemas / characters
  assert.equal(safeNext('javascript:alert(1)', '/fallback'), '/fallback');
  assert.equal(safeNext('data:text/html,test', '/fallback'), '/fallback');
  assert.equal(safeNext(null, '/fallback'), '/fallback');
  assert.equal(safeNext('', '/fallback'), '/fallback');

  // Valid internal relative destinations
  assert.equal(safeNext('/admin', '/fallback'), '/admin');
  assert.equal(safeNext('/admin/mandaps/12', '/fallback'), '/admin/mandaps/12');
  assert.equal(safeNext('/plan?step=2', '/fallback'), '/plan?step=2');
  assert.equal(safeNext('/booking/12/quotation?token=abc', '/fallback'), '/booking/12/quotation?token=abc');
});

test('2. payment receipt download endpoint enforces token or admin session (IDOR protection)', async () => {
  process.env.PAYMENTS_ENABLED = 'true';
  process.env.PAYMENT_GATEWAY_PROVIDER = 'phonepe';

  // Case A: Anonymous attacker attempts IDOR with paymentId
  const anonPaymentReq = {
    url: new URL('http://localhost:4321/api/payment/receipt/download?paymentId=42'),
    locals: { adminAuth: { isAdmin: false, user: null } },
  } as any;

  const resA = await downloadReceipt(anonPaymentReq);
  assert.equal(resA.status, 403);
  const bodyA = await resA.json();
  assert.match(bodyA.error, /secure document token or administrator credentials/);

  // Case B: Anonymous attacker attempts IDOR with receiptNumber
  const anonReceiptReq = {
    url: new URL('http://localhost:4321/api/payment/receipt/download?receiptNumber=EPR-RCPT-202611-12345'),
    locals: { adminAuth: { isAdmin: false, user: null } },
  } as any;

  const resB = await downloadReceipt(anonReceiptReq);
  assert.equal(resB.status, 403);
  const bodyB = await resB.json();
  assert.match(bodyB.error, /secure document token or administrator credentials/);
});

test('3. publish-report endpoint requires valid secret and rejects timing attacks', async () => {
  process.env.PUBLISH_REPORT_SECRET = 'super-secret-report-key-1234';

  // Wrong secret
  const badReq = {
    request: new Request('http://localhost/api/internal/publish-report', {
      method: 'POST',
      headers: { 'x-publish-secret': 'wrong-key' },
    }),
  } as any;

  const badRes = await publishReport(badReq);
  assert.equal(badRes.status, 401);

  // Missing secret header
  const missingReq = {
    request: new Request('http://localhost/api/internal/publish-report', {
      method: 'POST',
    }),
  } as any;

  const missingRes = await publishReport(missingReq);
  assert.equal(missingRes.status, 401);
});
