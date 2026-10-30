import { randomBytes } from 'node:crypto';
import { all, one, run, tx } from '../../core/db';
import { isEmail } from '../../core/http';
import type { AuthState } from '../../core/types';
import type { CartPayload } from './types';

export class BookingError extends Error {}

export interface CreatedBooking {
  bookingId: number;
  accessToken: string;
  quotationUrl: string;
  total: number;
}

function fail(message: string): never {
  throw new BookingError(message);
}

function requireCustomerDetails(payload: CartPayload) {
  const customer = payload.customer ?? {};
  const name = (customer.name ?? '').trim();
  const phone = (customer.phone ?? '').trim();
  const email = (customer.email ?? '').trim();
  const eventDate = (customer.event_date ?? '').trim();
  const eventType = (customer.event_type ?? '').trim();

  if (!name) fail('Please provide the customer name.');
  if (!/^[0-9]{10}$/.test(phone.replace(/\D/g, ''))) fail('Please provide a valid 10-digit phone number.');
  if (!email || !isEmail(email)) fail('Please provide a valid email address.');
  if (!eventDate) fail('Please choose an event date.');
  if (!eventType) fail('Please choose an event type.');

  return {
    name,
    phone: phone.replace(/\D/g, ''),
    email,
    address: (customer.address ?? '').trim(),
    eventDate,
    eventTime: (customer.event_time ?? '').trim(),
    eventType,
    guests: Math.max(1, Number(customer.guests) || 100),
    specialRequest: (customer.special_request ?? '').trim(),
  };
}

export function createBooking(auth: AuthState, payload: CartPayload): CreatedBooking {
  const customer = requireCustomerDetails(payload);

  return tx(() => {
    let hallId: number | null = null;
    let hallPrice = 0;

    if (payload.hall?.id) {
      const hall = one<{ id: number; name: string; price_paise: number }>(
        'SELECT id, name, price_paise FROM halls WHERE id = ? AND is_active = 1',
        [Number(payload.hall.id)],
      );
      if (!hall) fail('The selected hall is no longer available.');

      const clash = one<{ id: number }>(
        `SELECT b.id FROM bookings b
         JOIN booking_halls bh ON bh.booking_id = b.id
         WHERE bh.hall_id = ? AND b.event_date = ? AND b.status IN ('pending', 'confirmed')`,
        [hall.id, customer.eventDate],
      );
      if (clash) fail('This hall is already reserved on the selected date. Please choose another date or venue.');

      hallId = hall.id;
      hallPrice = Number(hall.price_paise);
    }

    const furniture: Array<{ id: number; price: number; quantity: number; subtotal: number }> = [];
    for (const item of payload.furniture ?? []) {
      const row = one<{ id: number; price_paise: number; max_quantity: number; hall_id: number }>(
        `SELECT fi.id, fi.price_paise, fi.max_quantity, fc.hall_id
         FROM furniture_items fi
         JOIN furniture_categories fc ON fc.id = fi.category_id
         WHERE fi.id = ?`,
        [Number(item.id)],
      );
      if (!row) fail('One of the selected furniture items is no longer available.');
      if (hallId && Number(row.hall_id) !== hallId) fail('Selected furniture does not belong to the chosen hall.');

      const quantity = Math.floor(Number(item.quantity) || 0);
      if (quantity <= 0) continue;
      if (quantity > Number(row.max_quantity)) {
        fail(`Furniture quantity exceeds the available stock (${row.max_quantity}).`);
      }

      furniture.push({
        id: row.id,
        price: Number(row.price_paise),
        quantity,
        subtotal: Number(row.price_paise) * quantity,
      });
    }

    let stageId: number | null = null;
    let stagePrice = 0;
    if (payload.stage?.id) {
      const stage = one<{ id: number; price_paise: number; hall_id: number }>(
        `SELECT sd.id, sd.price_paise, sc.hall_id
         FROM stage_designs sd
         JOIN stage_categories sc ON sc.id = sd.category_id
         WHERE sd.id = ?`,
        [Number(payload.stage.id)],
      );
      if (!stage) fail('The selected stage design is no longer available.');
      if (hallId && Number(stage.hall_id) !== hallId) fail('Selected stage does not belong to the chosen hall.');
      stageId = stage.id;
      stagePrice = Number(stage.price_paise);
    }

    const services: Array<{ id: number; price: number }> = [];
    const seenServices = new Set<number>();
    for (const item of payload.services ?? []) {
      const service = one<{ id: number; price_paise: number; hall_id: number }>(
        `SELECT s.id, s.price_paise, sc.hall_id
         FROM services s
         JOIN service_categories sc ON sc.id = s.category_id
         WHERE s.id = ?`,
        [Number(item.id)],
      );
      if (!service || seenServices.has(service.id)) continue;
      if (hallId && Number(service.hall_id) !== hallId) fail('Selected service does not belong to the chosen hall.');
      seenServices.add(service.id);
      services.push({ id: service.id, price: Number(service.price_paise) });
    }

    let catering: { id: number; guestCount: number; pricePerPlate: number; total: number } | null = null;
    let menuItems: Array<{ section: string; item: string }> = [];

    if (payload.catering?.id) {
      const packageRow = one<{ id: number; name: string; price_paise: number; is_active: number }>(
        'SELECT id, name, price_paise, is_active FROM catering_packages WHERE id = ?',
        [Number(payload.catering.id)],
      );
      if (!packageRow || !packageRow.is_active) fail('The selected catering package is no longer available.');

      const guestCount = Math.max(1, Math.floor(Number(payload.catering.guestCount) || 0));
      const tier = one<{ price_per_plate_paise: number }>(
        'SELECT price_per_plate_paise FROM guest_pricing WHERE package_id = ? AND guest_count = ?',
        [packageRow.id, guestCount],
      );
      const pricePerPlate = Number(tier?.price_per_plate_paise ?? packageRow.price_paise);

      const allowedSections = all<{ title: string; max_selection: number }>(
        'SELECT title, max_selection FROM menu_sections WHERE package_id = ?',
        [packageRow.id],
      );
      const allowedItems = new Set(
        all<{ name: string }>(
          `SELECT mi.name FROM menu_items mi
           JOIN menu_categories mc ON mc.id = mi.category_id
           JOIN menu_sections ms ON ms.id = mc.section_id
           WHERE ms.package_id = ? AND mi.is_available = 1`,
          [packageRow.id],
        ).map((item) => item.name),
      );

      const counts = new Map<string, number>();
      for (const selection of payload.catering.selectedItems ?? []) {
        const section = String(selection.section ?? 'Menu');
        const item = String(selection.item ?? '');
        if (!item || !allowedItems.has(item)) continue;
        const count = (counts.get(section) ?? 0) + 1;
        counts.set(section, count);
        menuItems.push({ section, item });
      }

      for (const section of allowedSections) {
        const max = Number(section.max_selection) || 0;
        if (max > 0 && (counts.get(section.title) ?? 0) > max) {
          fail(`You selected more than ${max} items from "${section.title}".`);
        }
      }

      catering = {
        id: packageRow.id,
        guestCount,
        pricePerPlate,
        total: guestCount * pricePerPlate,
      };
    }

    const total =
      hallPrice +
      furniture.reduce((sum, item) => sum + item.subtotal, 0) +
      stagePrice +
      services.reduce((sum, service) => sum + service.price, 0) +
      (catering?.total ?? 0);

    if (total <= 0) fail('Your cart is empty — add a hall, catering package or service before booking.');

    // ---------- Customer ----------
    let customerId: number;
    if (auth.user) {
      const existing = one<{ id: number }>('SELECT id FROM customers WHERE user_id = ?', [auth.user.id]);
      if (existing) {
        customerId = existing.id;
        run('UPDATE customers SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?', [
          customer.name,
          customer.phone,
          customer.email,
          customer.address,
          customerId,
        ]);
      } else {
        customerId = run(
          'INSERT INTO customers (user_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)',
          [auth.user.id, customer.name, customer.phone, customer.email, customer.address],
        ).lastId;
      }
    } else {
      const existing = one<{ id: number }>('SELECT id FROM customers WHERE phone = ?', [customer.phone]);
      if (existing) {
        customerId = existing.id;
        run('UPDATE customers SET name = ?, email = ?, address = ? WHERE id = ?', [
          customer.name,
          customer.email,
          customer.address,
          customerId,
        ]);
      } else {
        customerId = run(
          'INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)',
          [customer.name, customer.phone, customer.email, customer.address],
        ).lastId;
      }
    }

    // ---------- Booking ----------
    const accessToken = randomBytes(18).toString('base64url');
    const advanceAmount = Math.round(total * 0.25);

    const bookingId = run(
      `INSERT INTO bookings (customer_id, access_token, event_date, event_time, event_type, total_guest, special_request, status, total_amount, advance_amount, amount_paid, outstanding_balance, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, 'unpaid')`,
      [
        customerId,
        accessToken,
        customer.eventDate,
        customer.eventTime,
        customer.eventType,
        customer.guests,
        customer.specialRequest,
        total,
        advanceAmount,
        total,
      ],
    ).lastId;

    if (hallId) {
      run('INSERT INTO booking_halls (booking_id, hall_id, price) VALUES (?, ?, ?)', [
        bookingId,
        hallId,
        hallPrice,
      ]);
    }

    for (const item of furniture) {
      run(
        'INSERT INTO booking_furniture (booking_id, furniture_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [bookingId, item.id, item.quantity, item.price, item.subtotal],
      );
    }

    if (stageId) {
      run('INSERT INTO booking_stages (booking_id, stage_id, price) VALUES (?, ?, ?)', [
        bookingId,
        stageId,
        stagePrice,
      ]);
    }

    for (const service of services) {
      run('INSERT INTO booking_services (booking_id, service_id, price) VALUES (?, ?, ?)', [
        bookingId,
        service.id,
        service.price,
      ]);
    }

    if (catering) {
      const bookingCateringId = run(
        `INSERT INTO booking_catering (booking_id, package_id, guest_count, price_per_plate, total_price)
         VALUES (?, ?, ?, ?, ?)`,
        [bookingId, catering.id, catering.guestCount, catering.pricePerPlate, catering.total],
      ).lastId;

      for (const item of menuItems) {
        run(
          'INSERT INTO booking_menu_items (booking_catering_id, section, item_name) VALUES (?, ?, ?)',
          [bookingCateringId, item.section, item.item],
        );
      }
    }

    return {
      bookingId,
      accessToken,
      total,
      quotationUrl: `/booking/${bookingId}/quotation?token=${encodeURIComponent(accessToken)}`,
    };
  });
}

export interface BookingLine {
  label: string;
  detail: string;
  amount: number;
}

export interface QuotationData {
  booking: {
    id: number;
    created_at: string;
    event_date: string | null;
    event_time: string | null;
    event_type: string;
    total_guest: number;
    special_request: string;
    status: string;
    total_amount: number;
    advance_amount?: number;
    amount_paid?: number;
    outstanding_balance?: number;
    payment_status?: string;
    access_token?: string;
  };
  customer: { name: string; phone: string; email: string; address: string };
  lines: BookingLine[];
}

export function loadBookingForViewer(
  bookingId: number,
  auth: AuthState,
  token: string | null,
): QuotationData | 'not-found' | 'forbidden' {
  const booking = one<{
    id: number;
    created_at: string;
    event_date: string | null;
    event_time: string | null;
    event_type: string;
    total_guest: number;
    special_request: string;
    status: string;
    total_amount: number;
    access_token: string;
    customer_id: number;
    user_id: number | null;
  }>(
    `SELECT b.*, c.user_id AS user_id
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     WHERE b.id = ?`,
    [bookingId],
  );

  if (!booking) return 'not-found';

  const isOwner = Boolean(auth.user && booking.user_id === auth.user.id);
  const tokenMatches = Boolean(token && token === booking.access_token);
  if (!auth.isAdmin && !isOwner && !tokenMatches) return 'forbidden';

  const customer = one<{ name: string; phone: string; email: string; address: string }>(
    'SELECT name, phone, email, address FROM customers WHERE id = ?',
    [booking.customer_id],
  );

  const lines: BookingLine[] = [];

  const hall = one<{ name: string; price: number; capacity: number }>(
    `SELECT h.name AS name, bh.price AS price, h.capacity AS capacity
     FROM booking_halls bh JOIN halls h ON h.id = bh.hall_id
     WHERE bh.booking_id = ?`,
    [bookingId],
  );
  if (hall) {
    lines.push({ label: 'Hall venue', detail: `${hall.name} · up to ${hall.capacity} guests`, amount: Number(hall.price) });
  }

  for (const item of all<{ name: string; quantity: number; subtotal: number }>(
    `SELECT fi.name AS name, bf.quantity AS quantity, bf.subtotal AS subtotal
     FROM booking_furniture bf JOIN furniture_items fi ON fi.id = bf.furniture_id
     WHERE bf.booking_id = ?`,
    [bookingId],
  )) {
    lines.push({ label: 'Furniture & seating', detail: `${item.name} × ${item.quantity}`, amount: Number(item.subtotal) });
  }

  const stage = one<{ name: string; price: number }>(
    `SELECT sd.name AS name, bs.price AS price
     FROM booking_stages bs JOIN stage_designs sd ON sd.id = bs.stage_id
     WHERE bs.booking_id = ?`,
    [bookingId],
  );
  if (stage) lines.push({ label: 'Stage decoration', detail: stage.name, amount: Number(stage.price) });

  for (const service of all<{ name: string; price: number }>(
    `SELECT s.name AS name, bsrv.price AS price
     FROM booking_services bsrv JOIN services s ON s.id = bsrv.service_id
     WHERE bsrv.booking_id = ?`,
    [bookingId],
  )) {
    lines.push({ label: 'Additional service', detail: service.name, amount: Number(service.price) });
  }

  const catering = one<{
    id: number;
    name: string;
    guest_count: number;
    price_per_plate: number;
    total_price: number;
  }>(
    `SELECT bc.id AS id, cp.name AS name, bc.guest_count AS guest_count,
            bc.price_per_plate AS price_per_plate, bc.total_price AS total_price
     FROM booking_catering bc JOIN catering_packages cp ON cp.id = bc.package_id
     WHERE bc.booking_id = ?`,
    [bookingId],
  );

  if (catering) {
    const items = all<{ section: string; item_name: string }>(
      'SELECT section, item_name FROM booking_menu_items WHERE booking_catering_id = ? ORDER BY id',
      [catering.id],
    );
    const grouped = new Map<string, string[]>();
    for (const item of items) {
      const list = grouped.get(item.section) ?? [];
      list.push(item.item_name);
      grouped.set(item.section, list);
    }
    const menu = Array.from(grouped.entries())
      .map(([section, entries]) => `${section}: ${entries.join(', ')}`)
      .join(' · ');

    lines.push({
      label: 'Catering package',
      detail: `${catering.name} · ${catering.guest_count} plates × ₹${(Number(catering.price_per_plate) / 100).toLocaleString('en-IN')}${menu ? ` — ${menu}` : ''}`,
      amount: Number(catering.total_price),
    });
  }

  return {
    booking,
    customer: customer ?? { name: 'Valued customer', phone: '', email: '', address: '' },
    lines,
  };
}

export function loadCustomerBookings(userId: number) {
  return all<{
    id: number;
    event_date: string | null;
    event_type: string;
    total_guest: number;
    total_amount: number;
    advance_amount: number;
    amount_paid: number;
    outstanding_balance: number;
    payment_status: string;
    status: string;
    created_at: string;
  }>(
    `SELECT b.id, b.event_date, b.event_type, b.total_guest, b.total_amount,
            COALESCE(b.advance_amount, 0) as advance_amount,
            COALESCE(b.amount_paid, 0) as amount_paid,
            COALESCE(b.outstanding_balance, b.total_amount) as outstanding_balance,
            COALESCE(b.payment_status, 'unpaid') as payment_status,
            b.status, b.created_at
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     WHERE c.user_id = ?
     ORDER BY b.id DESC`,
    [userId],
  );
}
