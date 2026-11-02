import { randomBytes } from 'node:crypto';
import { isEmail } from '../../core/http';
import { getNeonClient } from '../../core/operational/neon-client';
import {
  assertBookingDepositColumns,
  findOrCreateCustomer,
  getBookingItems,
  getCustomerBookingsForUser,
  type BookingItemRow,
} from '../../core/operational/service';
import type { AuthState } from '../../core/types';
import type { CartPayload } from './types';
import { PricingError, priceBookingSelection } from './pricing';

export class BookingError extends Error {}

export interface CreatedBooking {
  bookingId: number;
  accessToken: string;
  quotationUrl: string;
  total: number;
}

/** Default deposit policy applied to a new booking, as a percentage of total. */
export const DEFAULT_DEPOSIT_PERCENT = 25;

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

/**
 * Creates a booking in the operational database.
 *
 * Everything happens in one transaction: the customer, the booking and its line
 * items. A confirmation is only returned after the commit succeeds, and every
 * amount is priced server-side from the published catalogue.
 */
export async function createBooking(auth: AuthState, payload: CartPayload): Promise<CreatedBooking> {
  const customer = requireCustomerDetails(payload);

  let priced;
  try {
    priced = await priceBookingSelection(payload);
  } catch (error) {
    if (error instanceof PricingError) fail(error.message);
    throw error;
  }

  if (priced.totalPaise <= 0) {
    fail('Your selection is empty — choose a mandap, stage, equipment or catering package before booking.');
  }

  const neon = getNeonClient();
  await assertBookingDepositColumns();
  const accessToken = randomBytes(18).toString('base64url');
  const advanceAmount = Math.round((priced.totalPaise * DEFAULT_DEPOSIT_PERCENT) / 100);

  const bookingId = await neon.tx(async (client) => {
    const customerId = await findOrCreateCustomer({
      userId: auth.user?.id ?? null,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      client,
    });

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO bookings (
         customer_id, access_token, event_date, event_time, event_type, total_guest,
         special_request, status, total_amount, advance_amount, amount_paid,
         outstanding_balance, payment_status, deposit_type, deposit_value
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, 0, $8, 'unpaid', 'percentage', $10)
       RETURNING id`,
      [
        customerId,
        accessToken,
        customer.eventDate,
        customer.eventTime,
        customer.eventType,
        customer.guests,
        customer.specialRequest,
        priced.totalPaise,
        advanceAmount,
        DEFAULT_DEPOSIT_PERCENT,
      ],
    );

    const id = Number(inserted.rows[0]?.id ?? 0);
    if (!id) throw new Error('The booking was written but its id could not be read back.');

    for (const item of priced.items) {
      await client.query(
        `INSERT INTO booking_items
           (booking_id, category, item_id, item_name, quantity, unit_price, subtotal, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          item.category,
          item.itemId,
          item.name,
          item.quantity,
          item.unitPricePaise,
          item.subtotalPaise,
          JSON.stringify(item.metadata ?? {}),
        ],
      );
    }

    return id;
  });

  return {
    bookingId,
    accessToken,
    total: priced.totalPaise,
    quotationUrl: `/booking/${bookingId}/quotation?token=${encodeURIComponent(accessToken)}`,
  };
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
    source_enquiry_id?: number | null;
    venue_location?: string | null;
  };
  customer: { name: string; phone: string; email: string; address: string };
  lines: BookingLine[];
  /** Original enquiry selections for a booking created by accepting an enquiry. */
  sourceEnquiry?: {
    id: number;
    reference: string;
    status: string;
    venue: string;
    acceptedAt: string | null;
    acceptedBy: string | null;
    lines: Array<{
      itemType: string;
      catalogueItemId: number | null;
      name: string;
      quantity: number;
      dimensions: string;
      specifications: string;
      notes: string;
    }>;
  } | null;
  /**
   * True for bookings created before line items were stored in the operational
   * database. Their itemised breakdown is unrecoverable, so the page must say so
   * rather than present an empty table as if nothing had been ordered.
   */
  isLegacy: boolean;
  legacyReason?: string;
}

const LINE_LABELS: Record<string, string> = {
  hall: 'Hall venue',
  mandap: 'Mandap design',
  stage: 'Stage decoration',
  furniture: 'Furniture & seating',
  service: 'Additional service',
  catering: 'Catering package',
  quotation: 'Accepted quotation',
};

function metadataFor(item: BookingItemRow): Record<string, any> {
  try {
    const parsed = JSON.parse(item.metadata_json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function describeBookingLine(item: BookingItemRow): BookingLine {
  const meta = metadataFor(item);
  const label = LINE_LABELS[item.category] ?? item.category;
  const unitInr = (Number(item.unit_price) / 100).toLocaleString('en-IN');

  if (item.category === 'quotation') {
    const reference = typeof meta.sourceEnquiryReference === 'string' ? meta.sourceEnquiryReference : '';
    const sourceItems = Array.isArray(meta.sourceItems) ? meta.sourceItems : [];
    const summary = sourceItems
      .map((entry: any) => {
        const name = String(entry?.name ?? '').trim();
        const quantity = Math.max(1, Number(entry?.quantity ?? 1));
        return name ? `${name}${quantity > 1 ? ` × ${quantity}` : ''}` : '';
      })
      .filter(Boolean)
      .join(' · ');
    return {
      label,
      detail: `${reference ? `Quotation for ${reference}` : 'Quotation accepted by the admin'}${summary ? ` — ${summary}` : ''}`,
      amount: Number(item.subtotal),
    };
  }

  if (item.category === 'furniture') {
    return { label, detail: `${item.item_name} × ${item.quantity}`, amount: Number(item.subtotal) };
  }

  if (item.category === 'catering') {
    const guestCount = Number(meta.guestCount ?? item.quantity);
    const menuItems = Array.isArray(meta.menuItems) ? meta.menuItems : [];
    const grouped = new Map<string, string[]>();
    for (const entry of menuItems) {
      const section = String(entry?.section ?? 'Menu');
      const list = grouped.get(section) ?? [];
      list.push(String(entry?.item ?? ''));
      grouped.set(section, list);
    }
    const menu = Array.from(grouped.entries())
      .map(([section, entries]) => `${section}: ${entries.join(', ')}`)
      .join(' · ');

    return {
      label,
      detail: `${item.item_name} · ${guestCount} plates × ₹${unitInr}${menu ? ` — ${menu}` : ''}`,
      amount: Number(item.subtotal),
    };
  }

  const dimensions = typeof meta.dimensions === 'string' && meta.dimensions ? ` · ${meta.dimensions}` : '';
  return { label, detail: `${item.item_name}${dimensions}`, amount: Number(item.subtotal) };
}

/**
 * Loads a quotation for a customer, an administrator, or a holder of the
 * booking access token.
 */
export async function loadBookingForViewer(
  bookingId: number,
  auth: AuthState,
  token: string | null,
): Promise<QuotationData | 'not-found' | 'forbidden'> {
  const neon = getNeonClient();
  const bookingRes = await neon.query<{
    id: number;
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
    access_token: string;
    customer_id: number;
    user_id: number | null;
    source_enquiry_id?: number | null;
    venue_location?: string | null;
  }>(
    `SELECT b.*, c.user_id AS user_id
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
      WHERE b.id = $1 LIMIT 1`,
    [bookingId],
  );

  const booking = bookingRes.rows[0];
  if (!booking) return 'not-found';

  const isOwner = Boolean(auth.user && Number(booking.user_id) === auth.user.id);
  const tokenMatches = Boolean(token && token === booking.access_token);
  if (!auth.isAdmin && !isOwner && !tokenMatches) return 'forbidden';

  const customerRes = await neon.query<{ name: string; phone: string; email: string | null; address: string | null }>(
    'SELECT name, phone, email, address FROM customers WHERE id = $1 LIMIT 1',
    [booking.customer_id],
  );
  const customerRow = customerRes.rows[0];

  const items = await getBookingItems(bookingId);
  const lines = items.map(describeBookingLine);
  const isLegacy = lines.length === 0 && Number(booking.total_amount) > 0;

  let sourceEnquiry: QuotationData['sourceEnquiry'] = null;
  if (booking.source_enquiry_id) {
    const enquiryRes = await neon.query<{
      id: number;
      reference_code: string;
      status: string;
      venue_location: string;
      accepted_at: string | null;
      accepted_by_name: string | null;
    }>(
      `SELECT e.id, e.reference_code, e.status, e.venue_location, e.accepted_at,
              COALESCE(NULLIF(u.first_name, ''), u.username) AS accepted_by_name
         FROM event_enquiries e
         LEFT JOIN users u ON u.id = e.accepted_by
        WHERE e.id = $1
        LIMIT 1`,
      [booking.source_enquiry_id],
    );
    const enquiry = enquiryRes.rows[0];
    if (enquiry) {
      const sourceLines = await neon.query<{
        item_type: string;
        catalogue_item_id: number | null;
        item_name_snapshot: string;
        quantity: number;
        standard_dimensions_snapshot: string;
        specifications: string;
        notes: string;
      }>(
        `SELECT item_type, catalogue_item_id, item_name_snapshot, quantity,
                standard_dimensions_snapshot, specifications, notes
           FROM enquiry_line_items
          WHERE enquiry_id = $1
          ORDER BY id ASC`,
        [enquiry.id],
      );

      sourceEnquiry = {
        id: Number(enquiry.id),
        reference: enquiry.reference_code,
        status: enquiry.status,
        venue: enquiry.venue_location,
        acceptedAt: enquiry.accepted_at,
        acceptedBy: enquiry.accepted_by_name,
        lines: sourceLines.rows.map((line) => ({
          itemType: line.item_type,
          catalogueItemId: line.catalogue_item_id === null ? null : Number(line.catalogue_item_id),
          name: line.item_name_snapshot,
          quantity: Number(line.quantity ?? 0),
          dimensions: line.standard_dimensions_snapshot || '',
          specifications: line.specifications || '',
          notes: line.notes || '',
        })),
      };
    }
  }

  return {
    booking: {
      ...booking,
      total_guest: Number(booking.total_guest ?? 0),
      total_amount: Number(booking.total_amount ?? 0),
      advance_amount: Number(booking.advance_amount ?? 0),
      amount_paid: Number(booking.amount_paid ?? 0),
      outstanding_balance: Number(booking.outstanding_balance ?? 0),
    },
    customer: {
      name: customerRow?.name ?? 'Valued customer',
      phone: customerRow?.phone ?? '',
      email: customerRow?.email ?? '',
      address: customerRow?.address ?? '',
    },
    lines,
    sourceEnquiry,
    isLegacy,
    legacyReason: isLegacy
      ? 'This booking was recorded before itemised line items were stored. The total is correct; the original breakdown is no longer available.'
      : undefined,
  };
}

export async function loadCustomerBookings(userId: number) {
  return getCustomerBookingsForUser(userId);
}
