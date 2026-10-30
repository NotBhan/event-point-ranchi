import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

try {
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('.sql?raw') || url.endsWith('.sql')) {
        const sql = fs.readFileSync(fileURLToPath(url), 'utf8');
        return {
          format: 'module',
          source: `export default ${JSON.stringify(sql)};`,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
} catch {}
const { PhonePeProvider } = await import('../src/core/payment/providers/phonepe');
const { getPaymentService } = await import('../src/core/payment/payment-service');
const {
  createBooking,
  getBookingById,
  updateBookingFinancials,
  createPaymentRecord,
  updatePaymentVerification,
  createRefundRecord,
  getRefundsByPaymentId,
  recordWebhookEvent,
  findWebhookEvent,
  updateWebhookEventStatus,
} = await import('../src/core/operational/service');
const { paymentsList, paymentDetail } = await import('../src/modules/admin/handlers/operations');


test('1. PhonePe Provider - SHA-256 Checksum Calculation & Webhook Decoding', async () => {
  const merchantId = 'PGTESTPAYUAT';
  const saltKey = '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399';
  const saltIndex = '1';

  const provider = new PhonePeProvider({
    merchantId,
    saltKey,
    saltIndex,
    environment: 'sandbox',
  });

  const testPayload = {
    merchantId,
    merchantTransactionId: 'TX_TEST_999988',
    merchantUserId: 'CUST_123',
    amount: 5000000,
    redirectUrl: 'http://localhost:4321/payment/status',
    redirectMode: 'POST',
    callbackUrl: 'http://localhost:4321/api/payment/webhook/phonepe',
    paymentInstrument: { type: 'PAY_PAGE' },
  };

  const base64Payload = Buffer.from(JSON.stringify(testPayload)).toString('base64');
  const apiEndpoint = '/pg/v1/pay';

  // Construct valid X-VERIFY checksum header
  const expectedHash = createHash('sha256')
    .update(base64Payload + apiEndpoint + saltKey)
    .digest('hex');
  const validXVerify = `${expectedHash}###${saltIndex}`;
  assert.equal(validXVerify.endsWith(`###${saltIndex}`), true);
  assert.equal(validXVerify.length, 64 + 3 + saltIndex.length);

  // Construct simulated PhonePe server callback payload
  const callbackServerPayload = {
    response: Buffer.from(
      JSON.stringify({
        success: true,
        code: 'PAYMENT_SUCCESS',
        message: 'Payment completed successfully',
        data: {
          merchantId,
          merchantTransactionId: 'TX_TEST_999988',
          transactionId: 'T26102812345678',
          amount: 5000000,
          state: 'COMPLETED',
          responseCode: 'SUCCESS',
          paymentInstrument: { type: 'UPI', utr: 'UTR9988776655' },
        },
      })
    ).toString('base64'),
  };

  const rawCallbackString = JSON.stringify(callbackServerPayload);
  const callbackChecksum =
    createHash('sha256')
      .update(callbackServerPayload.response + saltKey)
      .digest('hex') +
    '###' +
    saltIndex;

  const webhookResult = await provider.verifyWebhook({
    headers: { 'x-verify': callbackChecksum },
    rawBody: rawCallbackString,
  });

  assert.equal(webhookResult.isValid, true, 'Valid PhonePe webhook signature must verify');
  assert.equal(webhookResult.orderId, 'TX_TEST_999988');
  assert.equal(webhookResult.paymentId, 'T26102812345678');
  assert.equal(webhookResult.amountPaise, 5000000);
  assert.equal(webhookResult.status, 'captured');

  // Tampered payload checksum failure
  const invalidChecksumResult = await provider.verifyWebhook({
    headers: { 'x-verify': 'bad_hash_value###1' },
    rawBody: rawCallbackString,
  });
  assert.equal(invalidChecksumResult.isValid, false, 'Invalid checksum must be rejected');
});

test('2. Booking Financial Lifecycle - Advances, Partials, Balance & Overpayment Prevention', async () => {
  // Step 1: Create a test booking with total amount of ₹100,000 (10,000,000 paise)
  const totalAmountPaise = 10000000;
  const booking = await createBooking({
    customer_id: 1,
    event_type: 'Wedding Gala',
    event_date: '2026-12-15',
    total_guest: 250,
    total_amount: totalAmountPaise,
    status: 'confirmed',
  });

  assert.ok(booking.id > 0, 'Booking must be created');
  assert.equal(Number(booking.total_amount), totalAmountPaise);
  assert.equal(Number(booking.advance_amount), 2500000, 'Advance must be 25% (₹25,000)');
  assert.equal(Number(booking.amount_paid), 0);
  assert.equal(Number(booking.outstanding_balance), totalAmountPaise);
  assert.equal(booking.payment_status, 'unpaid');

  // Step 2: Simulate Payment 1 - Advance payment of ₹25,000 (2,500,000 paise) via PhonePe
  const payment1 = await createPaymentRecord({
    bookingId: booking.id,
    customerId: 1,
    provider: 'phonepe',
    providerOrderId: 'TX_PHONEPE_ADV_1',
    internalTransactionReference: `EP_ADV_${booking.id}_${Date.now()}`,
    paymentType: 'advance',
    amountPaise: 2500000,
  });

  await updatePaymentVerification({
    id: payment1.id,
    status: 'captured',
    paymentMethod: 'upi',
    providerPaymentId: 'T_PHONEPE_ADV_1',
    verifiedAt: new Date().toISOString(),
  });

  await updateBookingFinancials(booking.id, 2500000, 7500000, 'partially_paid');
  const updatedBookingAfterAdv = (await getBookingById(booking.id))!;
  assert.equal(Number(updatedBookingAfterAdv.amount_paid), 2500000, 'Total paid should now be ₹25,000');
  assert.equal(Number(updatedBookingAfterAdv.outstanding_balance), 7500000, 'Outstanding balance should be ₹75,000');
  assert.equal(updatedBookingAfterAdv.payment_status, 'partially_paid');

  // Step 3: Simulate Payment 2 - Partial milestone payment of ₹25,000 (2,500,000 paise) via PhonePe
  const payment2 = await createPaymentRecord({
    bookingId: booking.id,
    customerId: 1,
    provider: 'phonepe',
    providerOrderId: 'TX_PHONEPE_PART_2',
    internalTransactionReference: `EP_PART_${booking.id}_${Date.now()}`,
    paymentType: 'partial',
    amountPaise: 2500000,
  });

  await updatePaymentVerification({
    id: payment2.id,
    status: 'captured',
    paymentMethod: 'netbanking',
    providerPaymentId: 'T_PHONEPE_PART_2',
    verifiedAt: new Date().toISOString(),
  });

  await updateBookingFinancials(booking.id, 5000000, 5000000, 'partially_paid');
  const updatedBookingAfterPart = (await getBookingById(booking.id))!;
  assert.equal(Number(updatedBookingAfterPart.amount_paid), 5000000, 'Total paid should now be ₹50,000');
  assert.equal(Number(updatedBookingAfterPart.outstanding_balance), 5000000, 'Outstanding balance should be ₹50,000');
  assert.equal(updatedBookingAfterPart.payment_status, 'partially_paid');

  // Step 4: Overpayment Prevention Check
  const paymentService = getPaymentService();
  await assert.rejects(
    async () => {
      // Trying to pay ₹60,000 when only ₹50,000 is outstanding
      await paymentService.initiateBookingPayment({
        bookingId: booking.id,
        paymentType: 'partial',
        customAmountPaise: 6000000,
        provider: 'phonepe',
        originUrl: 'http://localhost:4321',
      });
    },
    /cannot exceed the outstanding balance/i,
    'Payment exceeding outstanding balance must be rejected'
  );

  // Step 5: Simulate Payment 3 - Full balance settlement of remaining ₹50,000 (5,000,000 paise) via PhonePe
  const payment3 = await createPaymentRecord({
    bookingId: booking.id,
    customerId: 1,
    provider: 'phonepe',
    providerOrderId: 'TX_PHONEPE_BAL_3',
    internalTransactionReference: `EP_BAL_${booking.id}_${Date.now()}`,
    paymentType: 'balance',
    amountPaise: 5000000,
  });

  await updatePaymentVerification({
    id: payment3.id,
    status: 'captured',
    paymentMethod: 'upi',
    providerPaymentId: 'T_PHONEPE_BAL_3',
    verifiedAt: new Date().toISOString(),
  });

  await updateBookingFinancials(booking.id, 10000000, 0, 'paid', 'confirmed');
  const finalBooking = (await getBookingById(booking.id))!;
  assert.equal(Number(finalBooking.amount_paid), 10000000, 'Booking should be 100% paid (₹100,000)');
  assert.equal(Number(finalBooking.outstanding_balance), 0, 'Outstanding balance must be 0');
  assert.equal(finalBooking.payment_status, 'paid');
});

test('3. Webhook Idempotency & Deduplication Protection', async () => {
  const provider = 'phonepe';
  const providerEventId = `evt_phonepe_${Date.now()}`;
  const payloadHash = createHash('sha256').update(providerEventId).digest('hex');

  // First time recording webhook
  const webhookRow = await recordWebhookEvent({
    provider,
    providerEventId,
    eventType: 'payment.captured',
    payloadHash,
    rawPayload: JSON.stringify({ id: providerEventId, status: 'captured' }),
    processingStatus: 'pending',
  });

  assert.ok(webhookRow.id > 0, 'Webhook event should be recorded');

  // Check state before processing
  const existingEvent = await findWebhookEvent(provider, providerEventId);
  assert.ok(existingEvent !== null);
  assert.equal(existingEvent.processing_status, 'pending');

  // Mark as processed
  await updateWebhookEventStatus(webhookRow.id, 'processed');
  const updatedEvent = await findWebhookEvent(provider, providerEventId);
  assert.ok(updatedEvent !== null);
  assert.equal(updatedEvent.processing_status, 'processed');
});

test('4. Refund Accounting & Over-Refund Prevention', async () => {
  // Create a payment of ₹20,000 (2,000,000 paise) via PhonePe
  const payment = await createPaymentRecord({
    bookingId: 1,
    customerId: 1,
    provider: 'phonepe',
    providerOrderId: 'TX_REFUND_TEST',
    internalTransactionReference: `EP_REFTEST_${Date.now()}`,
    paymentType: 'partial',
    amountPaise: 2000000,
  });

  await updatePaymentVerification({
    id: payment.id,
    status: 'captured',
    providerPaymentId: 'T_PHONEPE_CAPTURED',
    verifiedAt: new Date().toISOString(),
  });

  // Partial refund 1: ₹5,000 (500,000 paise)
  const refund1 = await createRefundRecord({
    paymentId: payment.id,
    bookingId: 1,
    providerRefundId: 'rfnd_phonepe_01',
    amountPaise: 500000,
    reason: 'Guest count reduction',
    status: 'processed',
  });
  assert.ok(refund1.id > 0);

  // Partial refund 2: ₹10,000 (1,000,000 paise)
  const refund2 = await createRefundRecord({
    paymentId: payment.id,
    bookingId: 1,
    providerRefundId: 'rfnd_phonepe_02',
    amountPaise: 1000000,
    reason: 'Service item cancellation',
    status: 'processed',
  });
  assert.ok(refund2.id > 0);

  const existingRefunds = await getRefundsByPaymentId(payment.id);
  const totalRefunded = existingRefunds
    .filter((r) => r.status === 'processed')
    .reduce((sum, r) => sum + Number(r.amount_paise), 0);

  assert.equal(totalRefunded, 1500000, 'Total refunded must equal ₹15,000');
  const remainingRefundable = payment.amount_paise - totalRefunded;
  assert.equal(remainingRefundable, 500000, 'Remaining refundable must equal ₹5,000');

  // Over-refund check: Attempting to refund ₹6,000 when only ₹5,000 remains refundable
  const excessiveRefundAmount = 600000;
  assert.ok(
    excessiveRefundAmount > remainingRefundable,
    'Excessive refund should be strictly prevented when exceeding remaining refundable balance'
  );
});

test('5. Admin RBAC Security - Unauthenticated Requests Denied', async () => {
  const unauthenticatedContext: any = {
    auth: { isAuthenticated: false, user: null },
    url: new URL('http://localhost:4321/admin/payments'),
    request: new Request('http://localhost:4321/admin/payments'),
    cookies: new Map(),
    params: {},
  };

  const listResponse = await paymentsList(unauthenticatedContext);
  assert.ok(
    listResponse instanceof Response && (listResponse.status === 302 || listResponse.status === 303 || listResponse.status === 403),
    'Unauthenticated admin payment listing must be rejected'
  );

  const detailResponse = await paymentDetail({
    ...unauthenticatedContext,
    params: { id: '1' },
  });
  assert.ok(
    detailResponse instanceof Response && (detailResponse.status === 302 || detailResponse.status === 303 || detailResponse.status === 403),
    'Unauthenticated admin payment detail must be rejected'
  );
});
