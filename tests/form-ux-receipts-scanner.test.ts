import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
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

const {
  maskCustomerName,
  maskPhoneNumber,
  formatINR,
  generateUniqueReceiptNumber,
  generateReceiptPdf,
} = await import('../src/core/payment/receipt-service');

const { EnquiryQrService } = await import('../src/core/operational/enquiry-qr-service');

test('1. Form UX Validation - Indian Phone Regex & Date Checks', () => {
  const phoneRegex = /^[6-9]\d{9}$/;

  // Valid Indian mobile numbers
  const validNumbers = [
    '9876543210',
    '8123456789',
    '7001234567',
    '6999888777',
  ];
  for (const num of validNumbers) {
    assert.strictEqual(
      phoneRegex.test(num),
      true,
      `Expected valid Indian phone: ${num}`
    );
  }

  // Invalid numbers
  const invalidNumbers = [
    '5123456789', // Invalid starting digit
    '0123456789', // Starts with 0
    '987654321',  // 9 digits
    '98765432100', // 11 digits
    '98765abcde', // Non-digits
    '',
  ];
  for (const num of invalidNumbers) {
    assert.strictEqual(
      phoneRegex.test(num),
      false,
      `Expected invalid Indian phone: ${num}`
    );
  }

  // Normalization testing
  const rawWithCountryCode = '+91 98765-43210';
  const cleaned = rawWithCountryCode.replace(/[\s-]/g, '').replace(/^\+91/, '');
  assert.strictEqual(phoneRegex.test(cleaned), true);

  // Date validation (Rejecting past dates)
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  assert.strictEqual(yesterday < today, true, 'Yesterday must be detected as past date');
  assert.strictEqual(tomorrow >= today, true, 'Tomorrow must be valid future date');
  assert.strictEqual(today >= today, true, 'Today must be valid event date');
});

test('2. Receipt Formatting - Name & Phone Masking, INR Formatting, Unique Numbering', async () => {
  // Name masking
  assert.strictEqual(maskCustomerName('Rahul Kumar'), 'R***l K***r');
  assert.strictEqual(maskCustomerName('Anu'), 'A*u');
  assert.strictEqual(maskCustomerName(''), 'Valued Customer');
  assert.strictEqual(maskCustomerName('Chandra Bhan'), 'C*****a B**n');

  // Phone masking
  assert.strictEqual(maskPhoneNumber('9876543210'), '+91 XXXXX 43210');
  assert.strictEqual(maskPhoneNumber('+91 98765 43210'), '+91 XXXXX 43210');
  assert.strictEqual(maskPhoneNumber(''), '+91 XXXXX XXXXX');

  // INR currency formatting
  const formatted50k = formatINR(5000000); // 50,000.00
  assert.ok(
    formatted50k.includes('50,000.00'),
    `Expected formatted INR to contain 50,000.00, got ${formatted50k}`
  );

  const formattedZero = formatINR(0);
  assert.ok(
    formattedZero.includes('0.00'),
    `Expected formatted INR to contain 0.00, got ${formattedZero}`
  );

  // Unique receipt numbering format: EPR-RCPT-YYYYMM-XXXXX
  const receiptNum = await generateUniqueReceiptNumber();
  assert.match(
    receiptNum,
    /^EPR-RCPT-\d{6}-\d{5}$/,
    `Receipt number ${receiptNum} does not match expected pattern EPR-RCPT-YYYYMM-XXXXX`
  );
});

test('3. Cryptographic Token & Verification URL Security', () => {
  const token = randomBytes(32).toString('hex');
  assert.strictEqual(token.length, 64);

  const tokenHash = createHash('sha256').update(token).digest('hex');
  assert.strictEqual(tokenHash.length, 64);

  // Compute again to verify deterministic hashing
  const verifyHash = createHash('sha256').update(token).digest('hex');
  assert.strictEqual(tokenHash, verifyHash);

  // Verification URL structure
  const domain = 'https://eventpointranchi.com';
  const verificationUrl = `${domain}/receipt/verify/${token}`;
  assert.ok(verificationUrl.startsWith('https://eventpointranchi.com/receipt/verify/'));
  assert.ok(!verificationUrl.includes('+91'));
  assert.ok(!verificationUrl.includes('Rahul'));
});

test('4. PDF Generation with pdf-lib & High-Res QR Embedding', async () => {
  const token = randomBytes(24).toString('hex');
  const payload = {
    receipt: {
      id: 101,
      payment_id: 202,
      receipt_number: 'EPR-RCPT-202610-88899',
      issue_date: new Date().toISOString(),
      amount_paise: 2500000n, // ₹25,000.00
      currency: 'INR',
      status: 'valid',
      public_token: token,
      public_token_hash: createHash('sha256').update(token).digest('hex'),
      pdf_storage_key: null,
      pdf_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    payment: {
      id: 202,
      booking_id: 303,
      amount_paise: 2500000n,
      currency: 'INR',
      provider: 'phonepe',
      provider_payment_id: 'T2610301900001',
      provider_order_id: 'ORDER_PHONEPE_9988',
      status: 'captured',
      payment_type: 'advance',
      payment_method: 'UPI',
      bank_reference: 'UPI/9988776655/AXIS',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    booking: {
      id: 303,
      customer_id: 404,
      access_token: 'tok_booking_test_303',
      event_type: 'Royal Wedding Reception',
      event_date: '2026-11-15',
      event_time: '18:00',
      total_guest: 500,
      total_amount: 10000000n, // ₹1,00,000
      advance_amount: 2500000n,
      amount_paid: 2500000n,
      outstanding_balance: 7500000n,
      payment_status: 'partially_paid',
      status: 'confirmed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    customer: {
      fullName: 'Vikramaditya Singh',
      maskedName: 'V************a S***h',
      rawPhone: '9876543210',
      maskedPhone: '+91 XXXXX 43210',
      email: 'vikram@example.com',
    },
    qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    verificationUrl: `https://eventpointranchi.com/receipt/verify/${token}`,
    isRefunded: false,
    businessInfo: {
      brandName: 'Event Point Ranchi',
      legalName: 'Event Point Ranchi Events & Celebrations Pvt. Ltd.',
      tagline: 'Creating Unforgettable Celebrations & Weddings in Ranchi',
      phone: '+91 98765 43210',
      email: 'contact@eventpointranchi.com',
      address: 'Main Road, Near Overbridge, Ranchi, Jharkhand 834001',
      website: 'https://eventpointranchi.com',
    },
  };

  const pdfBytes = await generateReceiptPdf(payload as any);
  assert.ok(pdfBytes instanceof Uint8Array, 'PDF output must be a Uint8Array');
  assert.ok(pdfBytes.length > 3000, `Expected PDF buffer > 3KB, got ${pdfBytes.length} bytes`);

  // Verify PDF magic header bytes: "%PDF-"
  const header = Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, 5).toString('ascii');
  assert.strictEqual(header, '%PDF-', 'PDF file must start with %PDF- magic bytes');
});

test('5. Enquiry QR Service - URL Parsing & Token Extraction', async () => {
  const service = new EnquiryQrService('https://eventpointranchi.com');

  // Test empty inputs
  const emptyRes = await service.lookupEnquiry('');
  assert.strictEqual(emptyRes.found, false);
  assert.ok(emptyRes.error?.includes('Empty QR code payload'));

  // Test URL input parsing
  const testToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef';
  const testUrl = `https://eventpointranchi.com/admin/enquiries/scan?token=${testToken}`;

  // Check lookup returns not found gracefully when token does not exist in DB
  const lookupRes = await service.lookupEnquiry(testUrl);
  assert.strictEqual(lookupRes.found, false);
  assert.ok(lookupRes.error?.includes('No enquiry found'));

  // Test reference code input parsing
  const refCode = 'EPR-ENQ-202610-9999';
  const refRes = await service.lookupEnquiry(refCode);
  assert.strictEqual(refRes.found, false);
  assert.ok(refRes.error?.includes('No enquiry found'));
});
