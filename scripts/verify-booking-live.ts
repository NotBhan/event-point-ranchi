/**
 * Live verification of the booking path: published catalogue → server pricing →
 * Neon PostgreSQL → quotation.
 *
 * This is an opt-in command (`npm run verify:booking`) because it writes one
 * real booking and customer to the configured operational database. It removes
 * exactly the records it created before exiting unless `--keep` is passed.
 *
 * Usage:
 *   npm run build && npm start &
 *   node --import tsx scripts/verify-booking-live.ts --base-url http://127.0.0.1:4321
 */
import { Pool } from '@neondatabase/serverless';
import { getCateringPackages, getMandaps } from '../src/core/content/service';

interface Options {
  baseUrl: string;
  keep: boolean;
}

function parseArgs(argv: string[]): Options {
  const baseUrlIndex = argv.indexOf('--base-url');
  return {
    baseUrl: baseUrlIndex >= 0 ? argv[baseUrlIndex + 1].replace(/\/+$/, '') : 'http://localhost:4321',
    keep: argv.includes('--keep'),
  };
}

const results: Array<{ name: string; passed: boolean; detail: string }> = [];

function check(name: string, passed: boolean, detail = ''): void {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function rememberCookies(jar: Record<string, string>, response: Response): void {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const pool = new Pool({ connectionString: databaseUrl });
  const jar: Record<string, string> = {};

  console.log(`Verifying the booking path against ${options.baseUrl}\n`);

  // 1. Authoritative catalogue prices, exactly as the public pages read them.
  const [mandaps, packages] = await Promise.all([getMandaps(), getCateringPackages()]);
  const pkg = packages.find((entry) => entry.price_per_plate_paise > 0);
  if (!pkg) throw new Error('No priced catering package in the published catalogue; cannot verify.');

  const guestCount = 120;
  const expectedTotal = pkg.price_per_plate_paise * guestCount;
  const unpricedMandap = mandaps.find((entry) => entry.price_starting_paise <= 0);

  // 2. Submit through the real HTTP route.
  const plan = await fetch(`${options.baseUrl}/plan`);
  rememberCookies(jar, plan);
  const csrf = jar.rp_csrf;

  const runTag = Math.random().toString(36).slice(2, 8);
  const phone = '9876500222';

  // An item the catalogue does not price must not be booked at ₹0.
  if (unpricedMandap) {
    const rejected = await fetch(`${options.baseUrl}/api/bookings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf ?? '',
        cookie: cookieHeader(jar),
      },
      body: JSON.stringify({
        mandap: { id: unpricedMandap.id },
        customer: {
          name: `Booking Verification ${runTag}`,
          phone,
          email: `booking-${runTag}@example.test`,
          event_date: new Date(Date.now() + 86400000 * 45).toISOString().slice(0, 10),
          event_type: 'Wedding',
          guests: 150,
        },
      }),
    });
    const rejectedBody = (await rejected.json().catch(() => ({}))) as { message?: string };
    check(
      'An unpriced catalogue item cannot be booked at zero',
      rejected.status === 400 && /priced on request/i.test(rejectedBody.message ?? ''),
      `status ${rejected.status}${rejectedBody.message ? ` · ${rejectedBody.message}` : ''}`,
    );
  }

  const response = await fetch(`${options.baseUrl}/api/bookings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf ?? '',
      cookie: cookieHeader(jar),
    },
    body: JSON.stringify({
      mandap: null,
      stage: null,
      furniture: [],
      catering: {
        id: pkg.id,
        guestCount,
        selectedItems: [{ section: 'Main', item: 'Paneer' }],
      },
      customer: {
        name: `Booking Verification ${runTag}`,
        phone,
        email: `booking-${runTag}@example.test`,
        event_date: new Date(Date.now() + 86400000 * 45).toISOString().slice(0, 10),
        event_type: 'Wedding',
        guests: guestCount,
        special_request: 'Automated booking verification.',
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    status?: string;
    bookingId?: number;
    accessToken?: string;
    total?: number;
    quotationUrl?: string;
    message?: string;
  };

  check(
    'POST /api/bookings creates a booking',
    response.status === 201 && body.status === 'success' && Boolean(body.bookingId),
    `status ${response.status}${body.message ? ` · ${body.message}` : ''}`,
  );

  if (!body.bookingId) throw new Error('No booking id returned.');

  check(
    'Server total matches the published catalogue',
    body.total === expectedTotal,
    `server ${body.total} · expected ${expectedTotal}`,
  );

  // 3. The row and its line items must exist in Neon.
  const stored = await pool.query(
    'SELECT id, total_amount, advance_amount, deposit_type, deposit_value, status FROM bookings WHERE id = $1',
    [body.bookingId],
  );
  const row = stored.rows[0];
  check('Booking is persisted in Neon PostgreSQL', Boolean(row), row ? `#${row.id}` : 'missing');
  if (row) {
    check('Deposit snapshot stored with the booking', Number(row.advance_amount) === Math.round(Number(row.total_amount) * 0.25) && row.deposit_type === 'percentage');
  }

  const lines = await pool.query(
    'SELECT category, item_name, quantity, unit_price, subtotal FROM booking_items WHERE booking_id = $1 ORDER BY id',
    [body.bookingId],
  );
  check('Line items are persisted', lines.rows.length >= 1, `${lines.rows.length} lines`);

  const cateringLine = lines.rows.find((entry) => entry.category === 'catering');
  check(
    'Booking unit price equals the catalogue price',
    Boolean(cateringLine) && Number(cateringLine!.unit_price) === pkg.price_per_plate_paise,
    cateringLine ? `${cateringLine.unit_price} vs ${pkg.price_per_plate_paise}` : 'no catering line',
  );
  check(
    'Catering quantity equals the requested guest count',
    Boolean(cateringLine) && Number(cateringLine!.quantity) === guestCount,
    cateringLine ? `${cateringLine!.quantity} plates` : 'no catering line',
  );

  // 4. The quotation is readable through the access token.
  const quotation = await fetch(`${options.baseUrl}${body.quotationUrl}`);
  const html = await quotation.text();
  check('Quotation page renders for the access token', quotation.status === 200 && html.includes(String(body.bookingId)), `status ${quotation.status}`);

  const sqliteBooking = await fetch(`${options.baseUrl}/booking/${body.bookingId}/quotation`);
  check('Quotation is refused without the token', sqliteBooking.status === 403, `status ${sqliteBooking.status}`);

  // 5. Cleanup: only the records created above.
  if (!options.keep) {
    await pool.query('DELETE FROM booking_items WHERE booking_id = $1', [body.bookingId]);
    await pool.query('DELETE FROM bookings WHERE id = $1', [body.bookingId]);
    await pool.query('DELETE FROM customers WHERE phone = $1 AND name = $2', [phone, `Booking Verification ${runTag}`]);
    const remaining = await pool.query('SELECT id FROM bookings WHERE id = $1', [body.bookingId]);
    check('Verification booking removed afterwards', remaining.rows.length === 0);
  } else {
    console.log(`\n--keep passed: booking #${body.bookingId} left in place.`);
  }

  await pool.end();

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nBooking verification failed:', error);
  process.exitCode = 1;
});
