import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  buildBookingDocument,
  buildEnquiryDocument,
  buildFinancials,
  buildQuotationDocument,
} = await import('../src/core/documents/canonical');
const { resolveReceiptLookup } = await import('../src/core/documents/receipt-access');

const business = {
  name: 'Event Point Ranchi',
  phone: '+91 90000 00000',
  email: 'hello@eventpoint.test',
  address: 'Main Road, Ranchi',
  website: 'https://eventpointranchi.com',
};

function booking(overrides: Record<string, any> = {}) {
  return {
    booking: {
      id: 42,
      created_at: '2026-11-01T10:00:00.000Z',
      event_date: '2026-12-12',
      event_time: '18:00',
      event_type: 'Wedding',
      total_guest: 250,
      special_request: 'Vegetarian kitchen',
      status: 'pending',
      total_amount: 1_000_000,
      advance_amount: 250_000,
      amount_paid: 0,
      outstanding_balance: 1_000_000,
      payment_status: 'unpaid',
      deposit_type: 'percentage',
      deposit_value: 25,
      source_enquiry_id: 7,
      source_quotation_id: 3,
      source_quotation_version: 2,
      venue_location: 'Ranchi',
      ...overrides,
    },
    customer: { name: 'Asha Kumar', phone: '9876543210', email: 'asha@example.test', address: 'Lalpur' },
    lines: [
      {
        label: 'Mandap design',
        detail: 'Royal Mandap',
        amount: 800_000,
        categoryKey: 'mandap',
        quantity: 1,
        unitPricePaise: 800_000,
      },
      {
        label: 'Manual quotation line',
        detail: 'Special lighting arrangement',
        amount: 200_000,
        categoryKey: 'manual',
        quantity: 1,
        unitPricePaise: 200_000,
      },
      {
        label: 'Catering package',
        detail: 'Price on request item',
        amount: 0,
        categoryKey: 'catering',
        quantity: 100,
        unitPricePaise: 0,
        onRequest: true,
      },
    ],
    sourceEnquiry: { reference: 'EP-261101-ABCD' },
    isLegacy: false,
  } as any;
}

test('booking document is deterministic across customer and admin contexts', () => {
  const customer = buildBookingDocument(booking(), business);
  const admin = buildBookingDocument(booking(), business);
  assert.deepEqual(customer, admin);
  assert.equal(customer.reference, 'EP-261101-ABCD');
  assert.equal(customer.quotationVersion, 2);
  assert.equal(customer.lines.length, 3);
  assert.equal(customer.lines[2].onRequest, true);
  assert.equal(customer.lines[2].amountPaise, null);
  assert.equal(customer.business.name, business.name);
});

test('required deposit is not treated as received money', () => {
  const financials = buildFinancials(booking().booking);
  assert.equal(financials.totalPaise, 1_000_000);
  assert.equal(financials.requiredDepositPaise, 250_000);
  assert.equal(financials.amountPaidPaise, 0);
  assert.equal(financials.outstandingBalancePaise, 1_000_000);
  assert.equal(financials.amountDueNowPaise, 250_000);
  assert.equal(financials.paymentStatus, 'unpaid');
});

test('part-payment reduces outstanding balance but preserves deposit arithmetic', () => {
  const financials = buildFinancials(booking({ amount_paid: 300_000, outstanding_balance: 700_000, payment_status: 'partially_paid' }).booking);
  assert.equal(financials.requiredDepositPaise, 250_000);
  assert.equal(financials.amountPaidPaise, 300_000);
  assert.equal(financials.outstandingBalancePaise, 700_000);
  assert.equal(financials.amountDueNowPaise, 700_000);
  assert.equal(financials.paymentStatus, 'partially_paid');
});

test('prepared quotation preserves manual lines and the 25% deposit requirement', () => {
  const document = buildQuotationDocument(
    {
      enquiry: {
        reference_code: 'EP-261101-ABCD',
        customer_name: 'Asha Kumar',
        customer_phone: '9876543210',
        customer_email: 'asha@example.test',
        event_type: 'Wedding',
        event_date: '2026-12-12',
        event_time: '18:00',
        venue_location: 'Ranchi',
        guest_count: 250,
        created_at: '2026-11-01T10:00:00.000Z',
      },
      quotation: {
        version: 2,
        status: 'prepared',
        total_paise: 1_000_000,
        notes: 'Final agreed quote',
        prepared_at: '2026-11-02T10:00:00.000Z',
      },
      lines: [
        {
          line_type: 'manual',
          description: 'Special lighting arrangement',
          quantity: 1,
          quoted_unit_price_paise: 200_000,
          quoted_subtotal_paise: 200_000,
          notes: 'Included by request',
        },
      ],
    },
    business,
  );
  assert.equal(document.documentNumber, 'EP-261101-ABCD-Q2');
  assert.equal(document.lines[0].category, 'Manual quotation line');
  assert.equal(document.lines[0].note, 'Included by request');
  assert.equal(document.financials?.requiredDepositPaise, 250_000);
  assert.equal(document.financials?.amountPaidPaise, 0);
  assert.equal(document.financials?.outstandingBalancePaise, 1_000_000);
  assert.equal(document.financials?.paymentStatus, 'not booked');
});

test('enquiry acknowledgement shares the canonical model without inventing prices', () => {
  const document = buildEnquiryDocument({
    enquiry: {
      id: 7,
      referenceCode: 'EP-261101-ABCD',
      customerName: 'Asha Kumar',
      customerPhone: '9876543210',
      customerEmail: 'asha@example.test',
      eventType: 'Wedding',
      eventDate: '2026-12-12',
      endDate: null,
      eventTime: '18:00',
      venueLocation: 'Ranchi',
      guestCount: 250,
      budgetRange: '',
      requiresRooms: false,
      roomCount: 0,
      accommodationNotes: '',
      decorationNotes: 'Ivory florals',
      preferredContact: 'Phone',
      status: 'new',
      createdAt: '2026-11-01T10:00:00.000Z',
      items: [{ itemType: 'Mandap', name: 'Royal Mandap', quantity: 1, dimensions: '16 x 16 ft' }],
    },
    token: 'secret-token',
    qrDataUrl: 'data:image/png;base64,qr',
    verificationUrl: 'https://eventpointranchi.com/receipts/enquiry/EP-261101-ABCD?token=secret-token',
    businessInfo: {
      brandName: business.name,
      legalName: business.name,
      tagline: '',
      phone: business.phone,
      email: business.email,
      address: business.address,
      website: business.website,
    },
  });
  assert.equal(document.documentType, 'Enquiry acknowledgement');
  assert.equal(document.financials, null);
  assert.equal(document.lines[0].onRequest, true);
  assert.equal(document.lines[0].amountPaise, null);
  assert.equal(document.notes, 'Ivory florals');
});

test('receipt access requires a token for the public and allows an admin reference lookup', () => {
  assert.deepEqual(resolveReceiptLookup('EP-261101-ABCD', '', false), { key: '', allowed: false });
  assert.deepEqual(resolveReceiptLookup('EP-261101-ABCD', 'token', false), { key: 'token', allowed: true });
  assert.deepEqual(resolveReceiptLookup('EP-261101-ABCD', '', true), { key: 'EP-261101-ABCD', allowed: true });
  assert.deepEqual(resolveReceiptLookup('', '', true), { key: '', allowed: false });
});
