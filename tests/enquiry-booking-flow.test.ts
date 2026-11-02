import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import {
  cleanupIsolatedDatabases,
  useIsolatedContentDb,
  useIsolatedOperationalDb,
} from './helpers/isolated-db';

useIsolatedOperationalDb('enquiry-booking-flow');
useIsolatedContentDb();
after(cleanupIsolatedDatabases);

const { getNeonClient, NeonOperationalClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const {
  findOrCreateCustomer,
  getBookingForEnquiry,
  getEnquiryLineItemsForIds,
  getEventEnquiryWithItems,
  insertEventEnquiry,
  listBookingsPage,
  listEventEnquiriesPage,
} = await import('../src/core/operational/service');
const { registerCustomer } = await import('../src/modules/accounts/service');
const {
  EnquiryLifecycleError,
  acceptEnquiry,
  rejectEnquiry,
  setEnquiryWorkflowStatus,
} = await import('../src/modules/admin/enquiry-lifecycle');
const { listNewEnquiries, loadNewEnquiry, updateBookingStatus } = await import('../src/modules/admin/service');
const { loadBookingForViewer } = await import('../src/modules/bookings/service');
const { newEnquiriesList, legacyEnquiriesRedirect, legacyEnquiryDetailRedirect } = await import(
  '../src/modules/admin/handlers/operations'
);

let adminUserId = 0;
let referenceCounter = 0;

const enquiryBase = {
  eventType: 'Wedding',
  eventDate: new Date(Date.now() + 86400000 * 60).toISOString().slice(0, 10),
  endDate: null,
  eventTime: '18:00',
  venueLocation: 'Harmu Ground, Ranchi',
  guestCount: 300,
  budgetRange: '₹1–2 lakh',
  requiresRooms: false,
  roomCount: 0,
  accommodationNotes: '',
  decorationNotes: 'Warm lighting and maroon floral palette.',
  preferredContact: 'Phone',
};

function nextReference(): string {
  referenceCounter += 1;
  return `EP-TEST-${String(referenceCounter).padStart(4, '0')}`;
}

async function seedEnquiry(phone = '9876501234') {
  return insertEventEnquiry(
    {
      ...enquiryBase,
      customerName: 'Privacy Test Guest',
      customerPhone: phone,
      customerEmail: 'privacy-test@example.com',
    },
    [
      {
        itemType: 'mandap',
        catalogueItemId: 1,
        name: 'Royal Rajputana Mandap',
        quantity: 1,
        dimensions: '16 × 16 × 12 ft',
        requestedLength: null,
        requestedWidth: null,
        requestedHeight: null,
        specifications: 'Carved pillars',
        notes: '',
      },
      {
        itemType: 'stage',
        catalogueItemId: 2,
        name: 'Majestic Reception Stage',
        quantity: 1,
        dimensions: '24 × 16 × 14 ft',
        requestedLength: null,
        requestedWidth: null,
        requestedHeight: null,
        specifications: 'Royal backdrop',
        notes: '',
      },
      {
        itemType: 'equipment',
        catalogueItemId: 3,
        name: 'Banquet Chair',
        quantity: 50,
        dimensions: '',
        requestedLength: null,
        requestedWidth: null,
        requestedHeight: null,
        specifications: 'Gold frame',
        notes: 'Match ivory cushions',
      },
    ],
    nextReference,
  );
}

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  const neon = getNeonClient();
  await neon.query('DELETE FROM booking_items');
  await neon.query('DELETE FROM bookings');
  await neon.query('DELETE FROM enquiry_line_items');
  await neon.query('DELETE FROM event_enquiries');
  await neon.query('DELETE FROM customers');
  await neon.query('DELETE FROM users');

  const admin = await registerCustomer({
    name: 'Admin Handler',
    username: 'admin_handler',
    email: 'admin.handler@example.test',
    phone: '9000000001',
    password: 'AdminPass1',
    confirmPassword: 'AdminPass1',
  });
  assert.equal(admin.ok, true);
  if (!admin.ok) throw new Error('admin seed failed');
  adminUserId = admin.userId;
  await neon.query(`UPDATE users SET role = 'admin', first_name = 'Admin Handler' WHERE id = $1`, [adminUserId]);
});

test('the migration adds the enquiry/booking link and lifecycle columns', async () => {
  const neon = getNeonClient();
  const bookingColumns = await neon.query<{ name: string }>('PRAGMA table_info(bookings)');
  const bookingNames = bookingColumns.rows.map((row) => row.name);
  assert.ok(bookingNames.includes('source_enquiry_id'));
  assert.ok(bookingNames.includes('venue_location'));

  const enquiryColumns = await neon.query<{ name: string }>('PRAGMA table_info(event_enquiries)');
  const enquiryNames = enquiryColumns.rows.map((row) => row.name);
  assert.ok(enquiryNames.includes('accepted_by'));
  assert.ok(enquiryNames.includes('accepted_at'));
  assert.ok(enquiryNames.includes('rejection_reason'));

  const indexes = await neon.query<{ name: string }>('PRAGMA index_list(bookings)');
  assert.ok(indexes.rows.some((row) => row.name === 'idx_bookings_source_enquiry'));
});

test('acceptance creates one linked booking and preserves the enquiry selections', async () => {
  const neon = getNeonClient();
  const seeded = await seedEnquiry();
  const result = await acceptEnquiry({
    enquiryId: seeded.id,
    adminUserId,
    finalAmountPaise: 7500000,
  });

  const booking = await neon.query<{
    id: number;
    source_enquiry_id: number;
    venue_location: string;
    status: string;
    total_amount: number;
    advance_amount: number;
    payment_status: string;
  }>('SELECT * FROM bookings WHERE id = $1', [result.bookingId]);
  const row = booking.rows[0]!;
  assert.equal(Number(row.source_enquiry_id), seeded.id);
  assert.equal(row.venue_location, 'Harmu Ground, Ranchi');
  assert.equal(row.status, 'pending');
  assert.equal(Number(row.total_amount), 7500000);
  assert.equal(Number(row.advance_amount), 1875000);
  assert.equal(row.payment_status, 'unpaid');

  const enquiry = await neon.query<{
    status: string;
    accepted_by: number;
    accepted_at: string;
    rejection_reason: string;
  }>('SELECT status, accepted_by, accepted_at, rejection_reason FROM event_enquiries WHERE id = $1', [
    seeded.id,
  ]);
  assert.equal(enquiry.rows[0]?.status, 'accepted');
  assert.equal(Number(enquiry.rows[0]?.accepted_by), adminUserId);
  assert.ok(enquiry.rows[0]?.accepted_at);
  assert.equal(enquiry.rows[0]?.rejection_reason, '');

  const item = await neon.query<{ category: string; item_name: string; metadata_json: string }>(
    'SELECT category, item_name, metadata_json FROM booking_items WHERE booking_id = $1',
    [result.bookingId],
  );
  assert.equal(item.rows[0]?.category, 'quotation');
  assert.match(item.rows[0]?.item_name ?? '', new RegExp(seeded.referenceCode));
  const metadata = JSON.parse(item.rows[0]?.metadata_json ?? '{}');
  assert.equal(metadata.sourceEnquiryId, seeded.id);
  assert.equal(metadata.sourceEnquiryReference, seeded.referenceCode);
  assert.equal(metadata.sourceItems.length, 3);
  assert.equal(metadata.sourceItems[0].name, 'Royal Rajputana Mandap');

  assert.equal((await getBookingForEnquiry(seeded.id))?.id, result.bookingId);
  const lines = await getEnquiryLineItemsForIds([seeded.id]);
  assert.equal(lines.length, 3);

  const adminData = await loadNewEnquiry(seeded.id);
  assert.equal(adminData?.booking?.id, result.bookingId);
  assert.equal(adminData?.acceptedBy, 'Admin Handler');
  assert.equal(adminData?.lines.length, 3);

  const viewer = await loadBookingForViewer(result.bookingId, {
    user: null,
    isAuthenticated: false,
    isAdmin: true,
    isEditor: true,
    isSuperadmin: true,
    isDeveloper: false,
  }, null);
  assert.notEqual(viewer, 'not-found');
  assert.notEqual(viewer, 'forbidden');
  if (viewer !== 'not-found' && viewer !== 'forbidden') {
    assert.equal(viewer.sourceEnquiry?.reference, seeded.referenceCode);
    assert.equal(viewer.sourceEnquiry?.acceptedBy, 'Admin Handler');
    assert.equal(viewer.sourceEnquiry?.lines.length, 3);
    assert.match(viewer.lines[0]?.detail ?? '', /Royal Rajputana Mandap/);
  }
});

test('active New Enquiries excludes accepted rows; history includes them and the linked booking', async () => {
  const seeded = await seedEnquiry();
  await acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 5000000 });

  const active = await listEventEnquiriesPage({ status: 'active' }, { limit: 50, offset: 0 });
  assert.equal(active.items.some((row) => row.id === seeded.id), false);

  const accepted = await listEventEnquiriesPage({ status: 'accepted' }, { limit: 50, offset: 0 });
  assert.equal(accepted.items.some((row) => row.id === seeded.id), true);

  const adminList = await listNewEnquiries({ status: 'accepted' }, { page: 1, perPage: 50 });
  const item = adminList.items.find((row) => row.id === seeded.id);
  assert.ok(item);
  assert.equal(item?.lines.length, 3);
  assert.equal(item?.booking?.status, 'pending');
});

test('viewing, review and contacted actions never create a booking', async () => {
  const neon = getNeonClient();
  const seeded = await seedEnquiry();

  await getEventEnquiryWithItems(seeded.id);
  assert.equal(Number((await neon.query<{ count: number }>('SELECT COUNT(*) AS count FROM bookings')).rows[0]?.count), 0);

  await setEnquiryWorkflowStatus({ enquiryId: seeded.id, adminUserId, status: 'reviewing' });
  let status = await neon.query<{ status: string }>('SELECT status FROM event_enquiries WHERE id = $1', [seeded.id]);
  assert.equal(status.rows[0]?.status, 'reviewing');
  assert.equal(Number((await neon.query<{ count: number }>('SELECT COUNT(*) AS count FROM bookings')).rows[0]?.count), 0);

  await setEnquiryWorkflowStatus({ enquiryId: seeded.id, adminUserId, status: 'contacted' });
  status = await neon.query<{ status: string }>('SELECT status FROM event_enquiries WHERE id = $1', [seeded.id]);
  assert.equal(status.rows[0]?.status, 'contacted');
  assert.equal(Number((await neon.query<{ count: number }>('SELECT COUNT(*) AS count FROM bookings')).rows[0]?.count), 0);
});

test('rejected enquiries create no booking and remain in rejected history', async () => {
  const neon = getNeonClient();
  const seeded = await seedEnquiry();

  await rejectEnquiry({
    enquiryId: seeded.id,
    adminUserId,
    reason: 'Date is already fully booked.',
  });

  const row = await neon.query<{ status: string; rejection_reason: string }>(
    'SELECT status, rejection_reason FROM event_enquiries WHERE id = $1',
    [seeded.id],
  );
  assert.equal(row.rows[0]?.status, 'rejected');
  assert.equal(row.rows[0]?.rejection_reason, 'Date is already fully booked.');
  assert.equal((await getBookingForEnquiry(seeded.id)), null);

  const active = await listEventEnquiriesPage({ status: 'active' }, { limit: 50, offset: 0 });
  assert.equal(active.items.some((entry) => entry.id === seeded.id), false);
  const rejected = await listEventEnquiriesPage({ status: 'rejected' }, { limit: 50, offset: 0 });
  assert.equal(rejected.items.some((entry) => entry.id === seeded.id), true);

  await assert.rejects(
    () => acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 100000 }),
    EnquiryLifecycleError,
  );
  assert.equal(await getBookingForEnquiry(seeded.id), null);
});

test('duplicate acceptance is rejected and cannot create a second booking', async () => {
  const neon = getNeonClient();
  const seeded = await seedEnquiry();
  const first = await acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 5000000 });
  assert.ok(first.bookingId);

  await assert.rejects(
    () => acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 5000000 }),
    EnquiryLifecycleError,
  );

  const count = await neon.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM bookings WHERE source_enquiry_id = $1',
    [seeded.id],
  );
  assert.equal(Number(count.rows[0]?.count), 1);

  // The unique index is the database-level guard for two admins racing past
  // the application check.
  const customer = await neon.query<{ id: number }>('SELECT id FROM customers LIMIT 1');
  await assert.rejects(
    () =>
      neon.query(
        `INSERT INTO bookings
           (customer_id, access_token, event_type, status, total_amount, advance_amount, amount_paid,
            outstanding_balance, payment_status, source_enquiry_id)
         VALUES ($1, $2, 'Wedding', 'pending', 100, 25, 0, 100, 'unpaid', $3)`,
        [customer.rows[0]?.id, 'duplicate-source-token', seeded.id],
      ),
    /unique|constraint/i,
  );
});

test('concurrent acceptance attempts leave exactly one linked booking', async () => {
  const path = process.env.OPERATIONAL_DB_LOCAL_PATH!;
  const seeded = await seedEnquiry();
  const clientA = new NeonOperationalClient({ localDbPath: path });
  const clientB = new NeonOperationalClient({ localDbPath: path });

  const results = await Promise.allSettled([
    acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 5000000 }, clientA),
    acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 5000000 }, clientB),
  ]);

  await clientA.close();
  await clientB.close();

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const count = await getNeonClient().query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM bookings WHERE source_enquiry_id = $1',
    [seeded.id],
  );
  assert.equal(Number(count.rows[0]?.count), 1);
});

test('managed booking list exposes the source enquiry, venue, payment, and admin handling', async () => {
  const seeded = await seedEnquiry();
  const accepted = await acceptEnquiry({ enquiryId: seeded.id, adminUserId, finalAmountPaise: 5000000 });

  const all = await listBookingsPage({ status: 'all' }, { limit: 50, offset: 0 });
  const booking = all.find((row) => row.id === accepted.bookingId);
  assert.ok(booking);
  assert.equal(booking?.source_enquiry_id, seeded.id);
  assert.equal(booking?.source_reference, seeded.referenceCode);
  assert.equal(booking?.venue_location, 'Harmu Ground, Ranchi');
  assert.equal(booking?.payment_status, 'unpaid');
  assert.equal(booking?.accepted_by_name, 'Admin Handler');
  assert.equal(booking?.item_count, 1);

  const pendingPayment = await listBookingsPage({ status: 'pending_payment' }, { limit: 50, offset: 0 });
  assert.equal(pendingPayment.some((row) => row.id === accepted.bookingId), true);

  const confirmed = await listBookingsPage({ status: 'confirmed' }, { limit: 50, offset: 0 });
  assert.equal(confirmed.some((row) => row.id === accepted.bookingId), false);

  await updateBookingStatus(accepted.bookingId, 'confirmed');
  const confirmedAfter = await listBookingsPage({ status: 'confirmed' }, { limit: 50, offset: 0 });
  assert.equal(confirmedAfter.some((row) => row.id === accepted.bookingId), true);
});

test('legacy direct bookings remain visible and are not mixed into new enquiries', async () => {
  const neon = getNeonClient();
  const customerId = await findOrCreateCustomer({
    name: 'Legacy Customer',
    phone: '9111111111',
    email: 'legacy@example.test',
    address: '',
  });
  await neon.query(
    `INSERT INTO bookings
       (customer_id, access_token, event_type, event_date, total_guest, status, total_amount,
        advance_amount, amount_paid, outstanding_balance, payment_status, deposit_type, deposit_value,
        venue_location)
     VALUES ($1, 'legacy-direct-token', 'Wedding', $2, 150, 'completed', 1000000, 250000, 1000000, 0, 'paid', 'percentage', 25, '')`,
    [customerId, enquiryBase.eventDate],
  );

  const all = await listBookingsPage({ status: 'all' }, { limit: 50, offset: 0 });
  const legacy = all.find((row) => row.source_reference === null);
  assert.ok(legacy);
  assert.equal(legacy?.venue_location, '');
  assert.equal(legacy?.accepted_by_name, null);

  const completed = await listBookingsPage({ status: 'completed' }, { limit: 50, offset: 0 });
  assert.equal(completed.some((row) => row.id === legacy?.id), true);
});

test('admin authorization is required for the New Enquiries handler', async () => {
  const cookies = {
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  };
  const response = await newEnquiriesList({
    request: new Request('http://localhost/admin/new-enquiries'),
    url: new URL('http://localhost/admin/new-enquiries'),
    params: {},
    form: null,
    auth: {
      user: null,
      isAuthenticated: false,
      isAdmin: false,
      isEditor: false,
      isSuperadmin: false,
      isDeveloper: false,
    },
    csrf: '',
    cookies,
  } as any);

  assert.ok(response instanceof Response);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location') ?? '', /\/admin\/login\?next=/);
});

test('old event-enquiry routes redirect to New Enquiries', async () => {
  const listResponse = await legacyEnquiriesRedirect({
    url: new URL('http://localhost/admin/enquiries?status=new&q=asha'),
  } as any);
  assert.equal(listResponse.status, 301);
  assert.equal(listResponse.headers.get('location'), '/admin/new-enquiries?status=new&q=asha');

  const confirmedResponse = await legacyEnquiriesRedirect({
    url: new URL('http://localhost/admin/enquiries?status=confirmed&q=asha'),
  } as any);
  assert.equal(confirmedResponse.headers.get('location'), '/admin/new-enquiries?status=accepted&q=asha');

  const archivedResponse = await legacyEnquiriesRedirect({
    url: new URL('http://localhost/admin/enquiries?status=archived'),
  } as any);
  assert.equal(archivedResponse.headers.get('location'), '/admin/new-enquiries?status=rejected');

  const getResponse = await legacyEnquiryDetailRedirect({
    request: new Request('http://localhost/admin/enquiries/7'),
    params: { id: '7' },
  } as any);
  assert.equal(getResponse.status, 301);
  assert.equal(getResponse.headers.get('location'), '/admin/new-enquiries/7');

  const postResponse = await legacyEnquiryDetailRedirect({
    request: new Request('http://localhost/admin/enquiries/7', { method: 'POST' }),
    params: { id: '7' },
  } as any);
  assert.equal(postResponse.status, 308);
  assert.equal(postResponse.headers.get('location'), '/admin/new-enquiries/7');
});
