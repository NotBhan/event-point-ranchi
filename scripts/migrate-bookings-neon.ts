/**
 * Imports legacy bookings from the local SQLite copy into Neon PostgreSQL.
 *
 * Booking creation used to write to SQLite, which is per-instance and ephemeral
 * on Vercel. Neon already holds the durable history, so this script is
 * deliberately conservative:
 *
 *   - dry run unless `--apply` is passed;
 *   - never overwrites a Neon row;
 *   - skips a SQLite booking whose access token already exists in Neon;
 *   - reports an id collision instead of merging two different bookings;
 *   - `--remap-ids` imports a colliding booking under a fresh id, keeping its
 *     access token (the public quotation reference) intact.
 *
 * Line items are mapped from the legacy per-type tables into `booking_items`.
 *
 * Usage:
 *   node --import tsx scripts/migrate-bookings-neon.ts
 *   node --import tsx scripts/migrate-bookings-neon.ts --apply
 *   node --import tsx scripts/migrate-bookings-neon.ts --apply --remap-ids
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getNeonClient } from '../src/core/operational/neon-client';
import { assertBookingDepositColumns, type BookingItemInput } from '../src/core/operational/service';

interface LegacyBooking {
  id: number;
  customer_id: number;
  access_token: string;
  created_at: string;
  event_date: string | null;
  event_time: string | null;
  event_type: string;
  total_guest: number;
  special_request: string;
  status: string;
  total_amount: number;
  advance_amount: number;
  amount_paid: number;
  outstanding_balance: number;
  payment_status: string;
}

interface LegacyCustomer {
  id: number;
  user_id: number | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
}

interface SourceData {
  bookings: LegacyBooking[];
  items: Map<number, BookingItemInput[]>;
  customers: Map<number, LegacyCustomer>;
  usernames: Map<number, string>;
}

function parseArgs(argv: string[]): { apply: boolean; remapIds: boolean; source: string } {
  const sourceIndex = argv.indexOf('--source');
  const dataDir = process.env.DATA_DIR || './data';
  return {
    apply: argv.includes('--apply'),
    remapIds: argv.includes('--remap-ids'),
    source: sourceIndex >= 0 ? argv[sourceIndex + 1] : join(resolve(process.cwd(), dataDir), 'event-point.db'),
  };
}

/** Reads the legacy SQLite database without ever writing to it. */
function readLegacyBookings(path: string): SourceData {
  if (!existsSync(path)) {
    throw new Error(`Legacy database not found at ${path}. Pass --source <path> or set DATA_DIR.`);
  }

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const bookings = db.prepare('SELECT * FROM bookings ORDER BY id').all() as unknown as LegacyBooking[];
    const items = new Map<number, BookingItemInput[]>();
    const customers = new Map<number, LegacyCustomer>(
      (db.prepare('SELECT id, user_id, name, phone, email, address FROM customers').all() as unknown as LegacyCustomer[]).map(
        (row) => [Number(row.id), row],
      ),
    );
    const usernames = new Map<number, string>(
      (db.prepare('SELECT id, username FROM users').all() as unknown as Array<{ id: number; username: string }>).map(
        (row) => [Number(row.id), row.username],
      ),
    );

    const push = (bookingId: number, item: BookingItemInput) => {
      const list = items.get(bookingId) ?? [];
      list.push(item);
      items.set(bookingId, list);
    };

    for (const row of db.prepare('SELECT bh.*, h.name AS hall_name FROM booking_halls bh LEFT JOIN halls h ON h.id = bh.hall_id').all() as any[]) {
      push(Number(row.booking_id), {
        category: 'hall',
        itemId: String(row.hall_id),
        name: row.hall_name || `Hall #${row.hall_id}`,
        quantity: 1,
        unitPricePaise: Number(row.price ?? 0),
        subtotalPaise: Number(row.price ?? 0),
        metadata: { legacyTable: 'booking_halls' },
      });
    }

    for (const row of db.prepare('SELECT bf.*, fi.name AS item_name FROM booking_furniture bf LEFT JOIN furniture_items fi ON fi.id = bf.furniture_id').all() as any[]) {
      push(Number(row.booking_id), {
        category: 'furniture',
        itemId: String(row.furniture_id),
        name: row.item_name || `Furniture #${row.furniture_id}`,
        quantity: Number(row.quantity ?? 0),
        unitPricePaise: Number(row.price ?? 0),
        subtotalPaise: Number(row.subtotal ?? 0),
        metadata: { legacyTable: 'booking_furniture' },
      });
    }

    for (const row of db.prepare('SELECT bs.*, sd.name AS stage_name FROM booking_stages bs LEFT JOIN stage_designs sd ON sd.id = bs.stage_id').all() as any[]) {
      push(Number(row.booking_id), {
        category: 'stage',
        itemId: String(row.stage_id),
        name: row.stage_name || `Stage #${row.stage_id}`,
        quantity: 1,
        unitPricePaise: Number(row.price ?? 0),
        subtotalPaise: Number(row.price ?? 0),
        metadata: { legacyTable: 'booking_stages' },
      });
    }

    for (const row of db.prepare('SELECT bs.*, s.name AS service_name FROM booking_services bs LEFT JOIN services s ON s.id = bs.service_id').all() as any[]) {
      push(Number(row.booking_id), {
        category: 'service',
        itemId: String(row.service_id),
        name: row.service_name || `Service #${row.service_id}`,
        quantity: 1,
        unitPricePaise: Number(row.price ?? 0),
        subtotalPaise: Number(row.price ?? 0),
        metadata: { legacyTable: 'booking_services' },
      });
    }

    for (const row of db.prepare('SELECT bc.*, cp.name AS package_name FROM booking_catering bc LEFT JOIN catering_packages cp ON cp.id = bc.package_id').all() as any[]) {
      const menuRows = db
        .prepare('SELECT section, item_name FROM booking_menu_items WHERE booking_catering_id = ? ORDER BY id')
        .all(Number(row.id)) as Array<{ section: string; item_name: string }>;

      push(Number(row.booking_id), {
        category: 'catering',
        itemId: String(row.package_id),
        name: row.package_name || `Catering package #${row.package_id}`,
        quantity: Number(row.guest_count ?? 0),
        unitPricePaise: Number(row.price_per_plate ?? 0),
        subtotalPaise: Number(row.total_price ?? 0),
        metadata: {
          legacyTable: 'booking_catering',
          guestCount: Number(row.guest_count ?? 0),
          pricePerPlatePaise: Number(row.price_per_plate ?? 0),
          menuItems: menuRows.map((entry) => ({ section: entry.section, item: entry.item_name })),
        },
      });
    }

    return { bookings, items, customers, usernames };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const source = readLegacyBookings(options.source);
  const neon = getNeonClient();

  console.log(`Source        : ${options.source}`);
  console.log(`Target        : ${neon.isUsingRemote() ? 'Neon PostgreSQL' : 'local SQLite fallback'}`);
  console.log(`Mode          : ${options.apply ? (options.remapIds ? 'apply (remap ids)' : 'apply') : 'dry run'}`);
  console.log(`Legacy rows   : ${source.bookings.length} bookings\n`);

  if (!options.apply) {
    console.log('No changes written. Re-run with --apply to import.');
    return;
  }

  if (!neon.isUsingRemote() && process.env.ALLOW_LOCAL_MIGRATION !== '1') {
    throw new Error(
      'Refusing to migrate into the local fallback database. Set DATABASE_URL to the target, ' +
        'or ALLOW_LOCAL_MIGRATION=1 for a rehearsal.',
    );
  }

  await assertBookingDepositColumns();

  // Bookings reference customers, so customers are resolved first. Matching is
  // by Neon user, then phone, then a fresh row — never by SQLite id, which has
  // no relationship to the ids already in Neon.
  const customerIdMap = new Map<number, number>();

  for (const legacy of source.customers.values()) {
    const username = legacy.user_id ? source.usernames.get(Number(legacy.user_id)) ?? null : null;
    let neonUserId: number | null = null;

    if (username) {
      const user = await neon.query<{ id: number }>(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [username],
      );
      neonUserId = user.rows[0] ? Number(user.rows[0].id) : null;
    }

    if (neonUserId) {
      const existing = await neon.query<{ id: number }>('SELECT id FROM customers WHERE user_id = $1 LIMIT 1', [neonUserId]);
      if (existing.rows[0]) {
        customerIdMap.set(legacy.id, Number(existing.rows[0].id));
        continue;
      }
    }

    const byPhone = await neon.query<{ id: number }>(
      'SELECT id FROM customers WHERE phone = $1 ORDER BY id ASC LIMIT 1',
      [legacy.phone],
    );
    if (byPhone.rows[0]) {
      customerIdMap.set(legacy.id, Number(byPhone.rows[0].id));
      continue;
    }

    const inserted = await neon.query<{ id: number }>(
      `INSERT INTO customers (user_id, name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [neonUserId, legacy.name, legacy.phone, legacy.email, legacy.address],
    );
    const newCustomerId = Number(inserted.rows[0]?.id ?? 0);
    if (!newCustomerId) throw new Error(`Legacy customer #${legacy.id} could not be created.`);

    customerIdMap.set(legacy.id, newCustomerId);
    console.log(`customer #${legacy.id} -> #${newCustomerId} (${legacy.name})`);
  }

  let imported = 0;
  let skippedExisting = 0;
  let idConflicts = 0;

  for (const booking of source.bookings) {
    const byToken = await neon.query<{ id: number }>(
      'SELECT id FROM bookings WHERE access_token = $1 LIMIT 1',
      [booking.access_token],
    );
    if (byToken.rows[0]) {
      skippedExisting += 1;
      console.log(`skip   #${booking.id} ${booking.access_token} — already present in Neon as #${byToken.rows[0].id}`);
      continue;
    }

    const byId = await neon.query<{ id: number; access_token: string }>(
      'SELECT id, access_token FROM bookings WHERE id = $1 LIMIT 1',
      [booking.id],
    );

    const idTaken = Boolean(byId.rows[0]);
    if (idTaken && !options.remapIds) {
      idConflicts += 1;
      console.log(
        `conflict #${booking.id} ${booking.access_token} — Neon already has booking #${booking.id} ` +
          `(${byId.rows[0].access_token}); use --remap-ids to import under a new id`,
      );
      continue;
    }

    const neonCustomerId = customerIdMap.get(Number(booking.customer_id));
    if (!neonCustomerId) {
      console.log(`skip   #${booking.id} ${booking.access_token} — legacy customer #${booking.customer_id} could not be resolved`);
      continue;
    }

    const items = source.items.get(booking.id) ?? [];

    await neon.tx(async (client) => {
      const columns = idTaken
        ? `(customer_id, access_token, created_at, event_date, event_time, event_type, total_guest,
            special_request, status, total_amount, advance_amount, amount_paid, outstanding_balance, payment_status)`
        : `(id, customer_id, access_token, created_at, event_date, event_time, event_type, total_guest,
            special_request, status, total_amount, advance_amount, amount_paid, outstanding_balance, payment_status)`;

      const values = idTaken
        ? [neonCustomerId, booking.access_token, booking.created_at, booking.event_date, booking.event_time,
           booking.event_type, booking.total_guest, booking.special_request, booking.status, booking.total_amount,
           booking.advance_amount, booking.amount_paid, booking.outstanding_balance, booking.payment_status]
        : [booking.id, neonCustomerId, booking.access_token, booking.created_at, booking.event_date,
           booking.event_time, booking.event_type, booking.total_guest, booking.special_request, booking.status,
           booking.total_amount, booking.advance_amount, booking.amount_paid, booking.outstanding_balance,
           booking.payment_status];

      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO bookings ${columns} VALUES (${placeholders}) RETURNING id`,
        values,
      );
      const newId = Number(inserted.rows[0]?.id ?? 0);
      if (!newId) throw new Error(`Booking ${booking.access_token} could not be inserted.`);

      for (const item of items) {
        await client.query(
          `INSERT INTO booking_items
             (booking_id, category, item_id, item_name, quantity, unit_price, subtotal, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newId, item.category, item.itemId, item.name, item.quantity, item.unitPricePaise, item.subtotalPaise,
           JSON.stringify(item.metadata ?? {})],
        );
      }

      console.log(`import #${booking.id} -> #${newId} ${booking.access_token} (${items.length} line items)`);
    });

    imported += 1;
  }

  // Keep the sequence ahead of any explicitly inserted ids.
  if (neon.isUsingRemote()) {
    await neon.query(
      `SELECT setval(pg_get_serial_sequence('bookings','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM bookings), 1))`,
    );
  }

  console.log(`\nImported ${imported}, already present ${skippedExisting}, id conflicts ${idConflicts}.`);
  if (idConflicts > 0) {
    console.log('Conflicting rows were left untouched; nothing was overwritten.');
  }
}

main().catch((error) => {
  console.error('\nMigration failed:', error);
  process.exitCode = 1;
});
