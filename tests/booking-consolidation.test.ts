import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  cleanupIsolatedDatabases,
  useIsolatedContentDb,
  useIsolatedOperationalDb,
} from './helpers/isolated-db';

// Bookings, customers and payments are operational data; the catalogue is
// content. Both live in explicitly configured isolated stores here.
useIsolatedContentDb();
useIsolatedOperationalDb('bookings');
after(cleanupIsolatedDatabases);

const { getD1Client } = await import('../src/core/content/d1-client');
const content = await import('../src/core/content/service');
const { createBooking, loadBookingForViewer } = await import('../src/modules/bookings/service');
const { getNeonClient } = await import('../src/core/operational/neon-client');
const { getDb } = await import('../src/core/db');
const { updateBookingDepositConfig, calculateAdvanceRequired } = await import('../src/core/operational/service');
const { formatCataloguePrice } = await import('../src/modules/bookings/pricing');

const MANDAP_PRICE = 4500000; // ₹45,000
const STAGE_PRICE = 3000000; // ₹30,000
const CHAIR_PRICE = 15000; // ₹150 per chair
const PLATE_PRICE = 85000; // ₹850 per plate

const guestAuth = { user: null, isAdmin: false, isDeveloper: false, isEditor: false } as never;

let seeded = false;

async function seedCatalogue(): Promise<void> {
  if (seeded) return;
  const d1 = getD1Client();

  await d1.query(
    `INSERT INTO mandaps (name, slug, description, price_starting_paise, is_visible, sort_order)
     VALUES (?, ?, ?, ?, 1, 1)`,
    ['Test Royal Mandap', 'test-royal-mandap', 'Catalogue fixture', MANDAP_PRICE],
  );
  await d1.query(
    `INSERT INTO stages (name, slug, description, price_starting_paise, is_visible, sort_order)
     VALUES (?, ?, ?, ?, 1, 1)`,
    ['Test Reception Stage', 'test-reception-stage', 'Catalogue fixture', STAGE_PRICE],
  );
  await d1.query(
    `INSERT INTO furniture_categories (name, slug, icon, sort_order, is_visible) VALUES (?, ?, 'chair', 1, 1)`,
    ['Seating', 'seating'],
  );
  const category = await d1.query<{ id: number }>('SELECT id FROM furniture_categories WHERE slug = ?', ['seating']);
  await d1.query(
    `INSERT INTO furniture_items
       (category_id, name, slug, description, price_paise, pricing_unit, min_quantity, default_quantity, is_visible, sort_order)
     VALUES (?, ?, ?, '', ?, 'piece', 10, 50, 1, 1)`,
    [Number(category.results[0].id), 'Test Banquet Chair', 'test-banquet-chair', CHAIR_PRICE],
  );
  await d1.query(
    `INSERT INTO catering_packages (name, slug, description, price_per_plate_paise, guest_pricing_json, is_visible, sort_order)
     VALUES (?, ?, '', ?, ?, 1, 1)`,
    [
      'Test Royal Menu',
      'test-royal-menu',
      PLATE_PRICE,
      JSON.stringify([{ guest_count: 120, price_per_plate_paise: PLATE_PRICE }]),
    ],
  );

  content.invalidateContentCache();
  seeded = true;
}

async function catalogueIds() {
  const mandap = (await content.getMandaps())[0];
  const stage = (await content.getStages())[0];
  const chair = (await content.getFurnitureItems())[0];
  const pkg = (await content.getCateringPackages())[0];
  return { mandap, stage, chair, pkg };
}

function bookingPayload(ids: Awaited<ReturnType<typeof catalogueIds>>, overrides: Record<string, unknown> = {}) {
  return {
    mandap: { id: ids.mandap.id },
    stage: { id: ids.stage.id },
    furniture: [{ id: ids.chair.id, quantity: 50 }],
    catering: { id: ids.pkg.id, guestCount: 120, selectedItems: [{ section: 'Main', item: 'Paneer' }] },
    customer: {
      name: 'Consolidation Test',
      phone: '9876500111',
      email: 'consolidation@example.test',
      event_date: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
      event_type: 'Wedding',
      guests: 120,
      special_request: 'Integration fixture',
    },
    ...overrides,
  };
}

before(async () => {
  await seedCatalogue();
});

test('a booking is priced from the published catalogue and committed to the operational store', async () => {
  const ids = await catalogueIds();
  const expectedTotal = MANDAP_PRICE + STAGE_PRICE + CHAIR_PRICE * 50 + PLATE_PRICE * 120;

  const created = await createBooking(guestAuth, bookingPayload(ids) as never);
  assert.equal(created.total, expectedTotal, 'total must come from the catalogue, line by line');
  assert.ok(created.bookingId > 0);
  assert.ok(created.accessToken.length > 20);

  const neon = getNeonClient();
  const stored = await neon.query<{
    total_amount: number | string;
    advance_amount: number | string;
    deposit_type: string;
    deposit_value: number | string;
    status: string;
    amount_paid: number | string;
    outstanding_balance: number | string;
  }>('SELECT * FROM bookings WHERE id = $1', [created.bookingId]);

  const row = stored.rows[0];
  assert.ok(row, 'booking must exist in the operational database');
  assert.equal(Number(row.total_amount), expectedTotal);
  assert.equal(Number(row.advance_amount), Math.round(expectedTotal * 0.25), 'default 25% deposit');
  assert.equal(row.deposit_type, 'percentage', 'the applied policy is snapshotted');
  assert.equal(Number(row.deposit_value), 25);
  assert.equal(row.status, 'pending');
  assert.equal(Number(row.amount_paid), 0);
  assert.equal(Number(row.outstanding_balance), expectedTotal);

  const items = await neon.query<{ category: string; item_name: string; quantity: number; unit_price: number; subtotal: number }>(
    'SELECT category, item_name, quantity, unit_price, subtotal FROM booking_items WHERE booking_id = $1 ORDER BY id',
    [created.bookingId],
  );
  assert.equal(items.rows.length, 4, 'mandap, stage, furniture and catering lines are stored');
  assert.deepEqual(
    items.rows.map((item) => item.category),
    ['mandap', 'stage', 'furniture', 'catering'],
  );
});

test('the booking is written to the operational store and not to SQLite', async () => {
  const ids = await catalogueIds();
  const sqlite = getDb();
  const countRows = () => Number((sqlite.prepare('SELECT COUNT(*) AS count FROM bookings').get() as { count: number }).count);

  const before = countRows();
  const created = await createBooking(guestAuth, bookingPayload(ids) as never);
  const after = countRows();

  assert.equal(after, before, 'creating a booking must not add a row to the local SQLite copy');
  const mirrored = sqlite
    .prepare('SELECT id FROM bookings WHERE access_token = ?')
    .get(created.accessToken);
  assert.equal(mirrored, undefined, 'the booking access token must not exist in SQLite');
});

test('client-supplied prices are ignored', async () => {
  const ids = await catalogueIds();
  const expectedTotal = MANDAP_PRICE + STAGE_PRICE + CHAIR_PRICE * 50 + PLATE_PRICE * 120;

  const tampered = bookingPayload(ids, {
    mandap: { id: ids.mandap.id, price: 1, price_starting_paise: 1 },
    furniture: [{ id: ids.chair.id, quantity: 50, price: 1, unit_price: 1 }],
    catering: { id: ids.pkg.id, guestCount: 120, total: 1 },
    total: 1,
    total_amount: 1,
  });

  const created = await createBooking(guestAuth, tampered as never);
  assert.equal(created.total, expectedTotal, 'the server must recompute every amount');
});

test('pricing and the public catalogue share one source', async () => {
  const ids = await catalogueIds();
  const created = await createBooking(guestAuth, bookingPayload(ids) as never);

  const neon = getNeonClient();
  const mandapLine = await neon.query<{ unit_price: number }>(
    `SELECT unit_price FROM booking_items WHERE booking_id = $1 AND category = 'mandap'`,
    [created.bookingId],
  );

  const catalogueMandap = (await content.getMandaps()).find((entry) => entry.id === ids.mandap.id);
  assert.ok(catalogueMandap);
  assert.equal(Number(mandapLine.rows[0].unit_price), catalogueMandap.price_starting_paise);
});

test('a catalogue item with no configured price is not booked at zero', async () => {
  const d1 = getD1Client();
  await d1.query(
    `INSERT INTO mandaps (name, slug, description, price_starting_paise, is_visible, sort_order)
     VALUES (?, ?, '', 0, 1, 2)`,
    ['Unpriced Mandap', 'unpriced-mandap'],
  );
  content.invalidateContentCache();

  const unpriced = (await content.getMandaps()).find((entry) => entry.slug === 'unpriced-mandap');
  assert.ok(unpriced, 'fixture mandap should be published');

  await assert.rejects(
    () =>
      createBooking(guestAuth, {
        mandap: { id: unpriced!.id },
        customer: {
          name: 'Unpriced Test',
          phone: '9876500333',
          email: 'unpriced@example.test',
          event_date: new Date(Date.now() + 86400000 * 20).toISOString().slice(0, 10),
          event_type: 'Wedding',
          guests: 100,
        },
      } as never),
    /priced on request/i,
  );
});

test('a minimum equipment quantity is enforced server-side', async () => {
  const ids = await catalogueIds();
  await assert.rejects(
    () => createBooking(guestAuth, bookingPayload(ids, { furniture: [{ id: ids.chair.id, quantity: 2 }] }) as never),
    /minimum quantity/i,
  );
});


test('a quotation is rebuilt from the operational store', async () => {
  const ids = await catalogueIds();
  const created = await createBooking(guestAuth, bookingPayload(ids) as never);

  const viewer = await loadBookingForViewer(created.bookingId, guestAuth, created.accessToken);
  assert.notEqual(viewer, 'not-found');
  assert.notEqual(viewer, 'forbidden');
  if (viewer === 'not-found' || viewer === 'forbidden') return;

  assert.equal(viewer.booking.total_amount, created.total);
  assert.equal(viewer.lines.length, 4);
  assert.ok(viewer.lines.some((line) => line.label === 'Mandap design'));
  assert.ok(viewer.lines.some((line) => line.detail.includes('120 plates')));
});

test('a quotation is refused without the access token', async () => {
  const ids = await catalogueIds();
  const created = await createBooking(guestAuth, bookingPayload(ids) as never);

  const viewer = await loadBookingForViewer(created.bookingId, guestAuth, 'not-the-token');
  assert.equal(viewer, 'forbidden');
});

test('deposit policies are applied per booking and never leak to another booking', async () => {
  const ids = await catalogueIds();
  const first = await createBooking(guestAuth, bookingPayload(ids) as never);
  const second = await createBooking(guestAuth, bookingPayload(ids) as never);

  const percentage = await updateBookingDepositConfig({
    bookingId: first.bookingId,
    depositType: 'percentage',
    depositValue: 40,
  });
  assert.equal(percentage.advanceAmount, Math.round(first.total * 0.4));
  assert.equal(percentage.depositType, 'percentage');
  assert.equal(percentage.depositValue, 40);

  const fixed = await updateBookingDepositConfig({
    bookingId: second.bookingId,
    depositType: 'fixed',
    depositValue: 5000, // ₹5,000 in rupees on the admin form
  });
  assert.equal(fixed.advanceAmount, 500000, 'fixed deposits are stored in paise');

  const full = await updateBookingDepositConfig({
    bookingId: second.bookingId,
    depositType: 'full',
  });
  assert.equal(full.advanceAmount, second.total);

  const neon = getNeonClient();
  const rows = await neon.query<{ id: number; advance_amount: number | string; deposit_type: string }>(
    'SELECT id, advance_amount, deposit_type FROM bookings WHERE id IN ($1, $2) ORDER BY id',
    [first.bookingId, second.bookingId],
  );
  assert.equal(Number(rows.rows[0].advance_amount), Math.round(first.total * 0.4), 'first booking keeps its policy');
  assert.equal(rows.rows[1].deposit_type, 'full');
});

test('a deposit cannot be set below money already received', async () => {
  const ids = await catalogueIds();
  const created = await createBooking(guestAuth, bookingPayload(ids) as never);

  const neon = getNeonClient();
  await neon.query('UPDATE bookings SET amount_paid = $1 WHERE id = $2', [1000000, created.bookingId]);

  await assert.rejects(
    () =>
      updateBookingDepositConfig({
        bookingId: created.bookingId,
        depositType: 'fixed',
        depositValue: 1000, // ₹1,000 — below the ₹10,000 already paid
      }),
    /cannot be set below the amount already paid/i,
  );
});

test('configuring an unknown booking fails instead of reporting success', async () => {
  await assert.rejects(
    () => updateBookingDepositConfig({ bookingId: 999999, depositType: 'percentage', depositValue: 30 }),
    /was not found/i,
  );
});

test('a booking without line items is presented as a legacy record, not an invented breakdown', async () => {
  const { createBooking: createBookingRow } = await import('../src/core/operational/service');
  const customerId = await (async () => {
    const neon = getNeonClient();
    const res = await neon.query<{ id: number }>(
      `INSERT INTO customers (name, phone, email) VALUES ($1, $2, $3) RETURNING id`,
      ['Legacy Fixture', '9876500456', 'legacy@example.test'],
    );
    return Number(res.rows[0].id);
  })();

  // Mirrors a pre-consolidation row: a total but no booking_items.
  const legacy = await createBookingRow({
    customer_id: customerId,
    event_type: 'Wedding',
    event_date: '2026-10-26',
    total_amount: 138025000,
    status: 'confirmed',
  });

  const viewer = await loadBookingForViewer(legacy.id, guestAuth, legacy.access_token);
  assert.notEqual(viewer, 'not-found');
  if (viewer === 'not-found' || viewer === 'forbidden') return;

  assert.equal(viewer.lines.length, 0);
  assert.equal(viewer.isLegacy, true, 'an empty breakdown must be flagged as legacy');
  assert.match(viewer.legacyReason ?? '', /no longer available/i);
  assert.equal(viewer.booking.total_amount, 138025000, 'the original total is preserved');
});

test('deposit maths matches the shared calculator', () => {
  assert.equal(calculateAdvanceRequired(1000000, 'full'), 1000000);
  assert.equal(calculateAdvanceRequired(1000000, 'percentage', 30), 300000);
  assert.equal(calculateAdvanceRequired(1000000, 'fixed', 2500), 250000);
  assert.equal(calculateAdvanceRequired(1000000, 'fixed', 999999), 1000000, 'a fixed deposit is capped at the total');
});

test('an unconfigured price is presented as price on request', () => {
  assert.equal(formatCataloguePrice(0), 'Price on request');
  assert.equal(formatCataloguePrice(null), 'Price on request');
  assert.equal(formatCataloguePrice(4500000), '₹45,000');
});
