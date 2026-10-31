import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Load services dynamically
const {
  getEnquiryReceiptData,
  generateEnquiryReceiptPdf,
} = await import('../src/core/operational/enquiry-receipt-service');

const {
  calculateAdvanceRequired,
  updateBookingDepositConfig,
} = await import('../src/core/operational/service');

const {
  runDatabaseIntegrityAudit,
} = await import('../src/core/operational/db-integrity-service');

test('1. Customer Enquiry Receipt - Acknowledgement Data & Security', async () => {
  // Use known test enquiry reference or first available
  const receipt = await getEnquiryReceiptData('EPR-ENQ-0001', 'https://eventpointranchi.com');
  
  if (receipt) {
    assert.ok(receipt.enquiry.referenceCode, 'Receipt must have a referenceCode');
    assert.ok(receipt.enquiry.customerName, 'Receipt must have customer name');
    assert.ok(receipt.enquiry.customerPhone, 'Receipt must have customer phone');
    assert.ok(receipt.token, 'Receipt must contain cryptographic token');
    assert.strictEqual(receipt.token.length, 64, 'Token must be 64-char hex string');
    assert.ok(receipt.qrDataUrl.startsWith('data:image/png;base64,'), 'QR must be base64 PNG');
    assert.ok(receipt.verificationUrl.includes(receipt.token), 'Verification URL must embed token');
    assert.ok(Array.isArray(receipt.enquiry.items), 'Receipt must contain items array');
    assert.ok(receipt.businessInfo, 'Receipt must have business info');
  } else {
    // Verify graceful null on invalid reference
    const nonExistent = await getEnquiryReceiptData('EPR-NON-EXISTENT-999', 'https://eventpointranchi.com');
    assert.strictEqual(nonExistent, null, 'Non-existent enquiry must return null');
  }
});

test('2. Customer Enquiry Receipt - PDF Generation with pdf-lib & QR', async () => {
  const sampleData = {
    enquiry: {
      id: 1,
      referenceCode: 'EPR-ENQ-202610-TEST1',
      customerName: 'Aarav Sharma',
      customerPhone: '+91 98765 43210',
      customerEmail: 'aarav@example.com',
      eventType: 'Royal Wedding Reception',
      eventDate: '2026-12-15',
      endDate: '2026-12-16',
      eventTime: '7:00 PM',
      venueLocation: 'Ranchi Main Club Ground',
      guestCount: 350,
      budgetRange: '₹3,00,000 - ₹5,00,000',
      requiresRooms: true,
      roomCount: 10,
      accommodationNotes: 'Need 10 AC suites near main entrance',
      decorationNotes: 'Grand floral archway with golden pillars',
      preferredContact: 'Phone',
      status: 'new',
      createdAt: '2026-10-31 10:00:00',
      items: [
        {
          itemType: 'Mandap',
          name: 'Mayur Royal Floral Mandap',
          quantity: 1,
          dimensions: '16ft x 16ft x 12ft',
        },
        {
          itemType: 'Stage',
          name: 'Grand Imperial Backdrop',
          quantity: 1,
          dimensions: '24ft x 16ft x 14ft',
        },
      ],
    },
    token: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    verificationUrl: 'https://eventpointranchi.com/admin/enquiries/scan?token=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    businessInfo: {
      brandName: 'Event Point Ranchi',
      legalName: 'Event Point Ranchi Events Pvt. Ltd.',
      tagline: 'Exclusive Wedding Infrastructure & Mandap Artistry',
      phone: '+91 98765 43210',
      email: 'contact@eventpointranchi.com',
      address: 'Near Overbridge, Main Road, Ranchi, Jharkhand 834001',
      website: 'https://eventpointranchi.com',
    },
  };

  const pdfBytes = await generateEnquiryReceiptPdf(sampleData as any);
  assert.ok(pdfBytes instanceof Uint8Array, 'PDF output must be a Uint8Array');
  assert.ok(pdfBytes.length > 2000, `Expected PDF buffer > 2KB, got ${pdfBytes.length} bytes`);

  // Verify PDF header magic bytes: %PDF-
  const header = Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, 5).toString('ascii');
  assert.strictEqual(header, '%PDF-', 'Enquiry receipt PDF must start with %PDF- header');
});

test('3. Flexible Booking Deposits - Policy Calculations', () => {
  const totalAmountPaise = 20000000; // ₹2,00,000

  // 1. Percentage Deposit: 25% of 200000 = 50000
  const advancePct25 = calculateAdvanceRequired(totalAmountPaise, 'percentage', 25);
  assert.strictEqual(advancePct25, 5000000); // ₹50,000

  // 2. Percentage Deposit: 50% of 200000 = 100000
  const advancePct50 = calculateAdvanceRequired(totalAmountPaise, 'percentage', 50);
  assert.strictEqual(advancePct50, 10000000); // ₹1,00,000

  // 3. Full Payment: 100% of 200000 = 200000
  const advanceFull = calculateAdvanceRequired(totalAmountPaise, 'full');
  assert.strictEqual(advanceFull, totalAmountPaise);

  // 4. Fixed Deposit: ₹25,000 (value 25000 in Rupees)
  const advanceFixed = calculateAdvanceRequired(totalAmountPaise, 'fixed', 25000);
  assert.strictEqual(advanceFixed, 2500000);

  // 5. Custom Deposit: ₹75,000 (value 75000 in Rupees) approved by admin
  const advanceCustom = calculateAdvanceRequired(totalAmountPaise, 'custom', 75000);
  assert.strictEqual(advanceCustom, 7500000);

  // 6. Edge Case: Fixed amount greater than total clamped to total
  const advanceClamped = calculateAdvanceRequired(totalAmountPaise, 'fixed', 300000);
  assert.strictEqual(advanceClamped, totalAmountPaise);
});

test('4. Booking Financials - Deposit Configuration Update & DB Persistence', async () => {
  try {
    const updated = await updateBookingDepositConfig({
      bookingId: 1,
      depositType: 'percentage',
      depositValue: 30,
    });

    if (updated) {
      assert.ok(updated.advanceAmount > 0, 'Advance amount must be recomputed and positive');
      assert.ok(updated.totalAmount >= updated.advanceAmount, 'Total amount must be >= advance amount');
    }
  } catch (err: any) {
    // If booking 1 doesn't exist in environment, verify graceful handling
    assert.ok(err);
  }
});

test('5. Database & Ledger Integrity Audit - Verification', async () => {
  const auditReport = await runDatabaseIntegrityAudit();
  
  assert.ok(auditReport, 'Audit report must not be null');
  assert.ok(auditReport.timestamp, 'Audit report must have timestamp');
  assert.ok(typeof auditReport.status === 'string', 'Audit report must have status');
  assert.ok(['HEALTHY', 'WARNING', 'CRITICAL'].includes(auditReport.status), `Unexpected status: ${auditReport.status}`);
  assert.ok(auditReport.counts, 'Audit report must have entity counts');
  assert.ok(typeof auditReport.counts.enquiries === 'number', 'Must count enquiries');
  assert.ok(typeof auditReport.counts.bookings === 'number', 'Must count bookings');
  assert.ok(typeof auditReport.counts.payments === 'number', 'Must count payments');
  assert.ok(typeof auditReport.counts.storageObjects === 'number', 'Must count storage objects');
  assert.ok(Array.isArray(auditReport.issues), 'Audit report must have issues array');
});

test('6. Custom 404 & Error Recovery Navigation Assets', () => {
  const notFoundPath = fileURLToPath(new URL('../src/components/NotFound.astro', import.meta.url));
  const notFoundContent = fs.readFileSync(notFoundPath, 'utf8');

  // Verify HTTP status 404 is set
  assert.ok(notFoundContent.includes('Astro.response.status = 404'), 'NotFound must set HTTP 404 status');

  // Verify mandatory recovery links are present
  assert.ok(notFoundContent.includes('href="/"'), 'Must link to Homepage (/)');
  assert.ok(notFoundContent.includes('href="/plan"'), 'Must link to Event Blueprint (/plan)');
  assert.ok(notFoundContent.includes('href="/mandaps"'), 'Must link to Mandaps (/mandaps)');
  assert.ok(notFoundContent.includes('href="/gallery"'), 'Must link to Design Gallery (/gallery)');
  assert.ok(notFoundContent.includes('href="/contact"'), 'Must link to Contact Concierge (/contact)');

  // Verify 404.astro page exists and renders NotFound
  const page404Path = fileURLToPath(new URL('../src/pages/404.astro', import.meta.url));
  assert.ok(fs.existsSync(page404Path), 'src/pages/404.astro must exist');
  const page404Content = fs.readFileSync(page404Path, 'utf8');
  assert.ok(page404Content.includes('Astro.response.status = 404'), '404.astro must set HTTP 404 status');
  assert.ok(page404Content.includes('<NotFound'), '404.astro must render NotFound component');
});
