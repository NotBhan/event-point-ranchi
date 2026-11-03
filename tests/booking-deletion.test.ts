import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedOperationalDb } from './helpers/isolated-db';

useIsolatedOperationalDb('booking-deletion');
after(cleanupIsolatedDatabases);

const { applyMigrations } = await import('../src/core/operational/migrations');
const { getNeonClient } = await import('../src/core/operational/neon-client');
const admin = await import('../src/modules/admin/service');
const operational = await import('../src/core/operational/service');

before(async () => {
  await applyMigrations(getNeonClient());
});

test('booking hard deletion is not exposed and payment records are preserved on cancellation', async () => {
  assert.equal('deleteBooking' in admin, false, 'admin hard-delete service must not be exposed');
  assert.equal('deleteBookingRecord' in operational, false, 'operational hard-delete primitive must not be exposed');

  const neon = getNeonClient();
  const customer = await neon.query<{ id: number }>(
    `INSERT INTO customers (name, phone, email) VALUES ('Cancellation Test', '9876508888', 'cancel@example.test') RETURNING id`,
  );
  const customerId = Number(customer.rows[0].id);
  const booking = await neon.query<{ id: number }>(
    `INSERT INTO bookings
       (customer_id, access_token, event_date, event_type, total_guest, status,
        total_amount, advance_amount, amount_paid, outstanding_balance, payment_status,
        deposit_type, deposit_value, venue_location)
     VALUES ($1, $2, '2027-03-01', 'Wedding', 100, 'pending',
             1000000, 250000, 0, 1000000, 'unpaid', 'percentage', 25, 'Preview Ground')
     RETURNING id`,
    [customerId, 'cancel-test-token'],
  );
  const bookingId = Number(booking.rows[0].id);
  await neon.query(
    `INSERT INTO payments
       (booking_id, customer_id, provider, internal_transaction_reference, amount_paise, status)
     VALUES ($1, $2, 'preview-provider', 'CANCEL-TEST-TXN', 100000, 'created')`,
    [bookingId, customerId],
  );

  await admin.updateBookingStatus(bookingId, 'cancelled');
  const row = await neon.query<{ status: string; payment_status: string; amount_paid: number }>(
    'SELECT status, payment_status, amount_paid FROM bookings WHERE id = $1',
    [bookingId],
  );
  assert.equal(row.rows[0]?.status, 'cancelled');
  assert.equal(row.rows[0]?.payment_status, 'unpaid');
  assert.equal(Number(row.rows[0]?.amount_paid), 0);
  const payments = await neon.query<{ n: number }>('SELECT COUNT(*) AS n FROM payments WHERE booking_id = $1', [bookingId]);
  assert.equal(Number(payments.rows[0]?.n), 1, 'cancelling must preserve linked payment records');
});

test('booking screens contain no permanent-delete action', async () => {
  const detail = await readFile(new URL('../src/modules/admin/pages/BookingDetailPage.astro', import.meta.url), 'utf8');
  const list = await readFile(new URL('../src/modules/admin/pages/BookingsPage.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(detail, /Delete booking|permanently\?/i);
  assert.doesNotMatch(list, /Delete booking|value="delete"/i);
});
