import { randomBytes } from 'node:crypto';
import {
  findOrCreateCustomer,
  type EnquiryLineItemRecord,
  type EventEnquiryRow,
} from '../../core/operational/service';
import { getNeonClient, type NeonOperationalClient } from '../../core/operational/neon-client';

export class EnquiryLifecycleError extends Error {}

export interface AcceptEnquiryInput {
  enquiryId: number;
  adminUserId: number;
  /** The quotation amount agreed by the admin, in paise. */
  finalAmountPaise: number;
}

export interface AcceptedEnquiryBooking {
  bookingId: number;
  accessToken: string;
  totalAmount: number;
}

export interface RejectEnquiryInput {
  enquiryId: number;
  adminUserId: number;
  reason?: string;
}

const ACTIVE_WORKFLOW_STATUSES = new Set(['new', 'reviewing', 'contacted', 'quoted']);
const DEPOSIT_PERCENT = 25;
const MAX_AMOUNT_PAISE = 1_000_000_000_000;

function requireEnquiryId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new EnquiryLifecycleError('Invalid enquiry.');
  return value;
}

function requireAdminId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new EnquiryLifecycleError('An admin user is required.');
  return value;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    message.includes('unique constraint') ||
    message.includes('duplicate key') ||
    message.includes('idx_bookings_source_enquiry')
  );
}

async function loadLines(
  client: Pick<NeonOperationalClient, 'query'>,
  enquiryId: number,
): Promise<EnquiryLineItemRecord[]> {
  const res = await client.query<EnquiryLineItemRecord>(
    'SELECT * FROM enquiry_line_items WHERE enquiry_id = $1 ORDER BY id ASC',
    [enquiryId],
  );
  return res.rows.map((line) => ({
    ...line,
    quantity: Number(line.quantity ?? 0),
    catalogue_item_id: line.catalogue_item_id === null ? null : Number(line.catalogue_item_id),
    requested_length_ft: line.requested_length_ft === null ? null : Number(line.requested_length_ft),
    requested_width_ft: line.requested_width_ft === null ? null : Number(line.requested_width_ft),
    requested_height_ft: line.requested_height_ft === null ? null : Number(line.requested_height_ft),
  }));
}

/**
 * Converts an active enquiry into exactly one managed booking.
 *
 * The status update, customer association, booking, quotation snapshot and
 * source-enquiry link are one transaction. The conditional status update and
 * the unique `bookings.source_enquiry_id` index together prevent duplicate
 * acceptance by concurrent admins.
 */
export async function acceptEnquiry(
  input: AcceptEnquiryInput,
  client: NeonOperationalClient = getNeonClient(),
): Promise<AcceptedEnquiryBooking> {
  const enquiryId = requireEnquiryId(input.enquiryId);
  const adminUserId = requireAdminId(input.adminUserId);
  const totalAmount = Math.round(Number(input.finalAmountPaise));

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new EnquiryLifecycleError('Enter the final booking amount before accepting the enquiry.');
  }
  if (totalAmount > MAX_AMOUNT_PAISE) {
    throw new EnquiryLifecycleError('The final booking amount is too large.');
  }

  try {
    return await client.tx(async (tx) => {
      const enquiryRes = await tx.query<EventEnquiryRow>(
        'SELECT * FROM event_enquiries WHERE id = $1 LIMIT 1',
        [enquiryId],
      );
      const enquiry = enquiryRes.rows[0];
      if (!enquiry) throw new EnquiryLifecycleError('Enquiry not found.');

      if (enquiry.status === 'rejected' || enquiry.status === 'archived') {
        throw new EnquiryLifecycleError('A rejected or archived enquiry cannot be accepted.');
      }

      const existingBooking = await tx.query<{ id: number }>(
        'SELECT id FROM bookings WHERE source_enquiry_id = $1 LIMIT 1',
        [enquiryId],
      );
      if (existingBooking.rows[0]) {
        throw new EnquiryLifecycleError('This enquiry has already been accepted and has a booking.');
      }

      // `accepted` is allowed here only to repair a previously interrupted
      // acceptance that left no booking. The unique index remains the final
      // guard if two admins race.
      const updated = await tx.query(
        `UPDATE event_enquiries
            SET status = 'accepted',
                accepted_by = $2,
                accepted_at = NOW(),
                rejection_reason = ''
          WHERE id = $1
            AND status NOT IN ('rejected', 'archived')
        RETURNING id`,
        [enquiryId, adminUserId],
      );
      if (updated.rowCount === 0) {
        throw new EnquiryLifecycleError('This enquiry is no longer in the new-enquiry workflow.');
      }

      const lines = await loadLines(tx, enquiryId);

      // Preserve any address already attached to the customer; the public
      // enquiry does not carry one.
      const existingCustomer = await tx.query<{ address: string | null }>(
        'SELECT address FROM customers WHERE phone = $1 ORDER BY id ASC LIMIT 1',
        [enquiry.customer_phone],
      );
      const address = existingCustomer.rows[0]?.address ?? '';

      const customerId = await findOrCreateCustomer({
        userId: null,
        name: enquiry.customer_name,
        phone: enquiry.customer_phone,
        email: enquiry.customer_email ?? '',
        address,
        client: tx,
      });

      const accessToken = randomBytes(18).toString('base64url');
      const advanceAmount = Math.round((totalAmount * DEPOSIT_PERCENT) / 100);
      const specialRequest = [enquiry.decoration_notes, enquiry.accommodation_notes]
        .filter(Boolean)
        .join('\n');
      const acceptedAt = new Date().toISOString();

      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO bookings (
           customer_id, access_token, event_date, event_time, event_type, total_guest,
           special_request, status, total_amount, advance_amount, amount_paid,
           outstanding_balance, payment_status, deposit_type, deposit_value,
           source_enquiry_id, venue_location
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, 0, $8, 'unpaid',
           'percentage', $10, $11, $12
         )
         RETURNING id`,
        [
          customerId,
          accessToken,
          enquiry.event_date,
          enquiry.event_time ?? null,
          enquiry.event_type,
          Number(enquiry.guest_count ?? 100),
          specialRequest,
          totalAmount,
          advanceAmount,
          DEPOSIT_PERCENT,
          enquiryId,
          enquiry.venue_location,
        ],
      );

      const bookingId = Number(inserted.rows[0]?.id ?? 0);
      if (!bookingId) throw new Error('The booking was written but its id could not be read back.');

      const sourceItems = lines.map((line) => ({
        itemType: line.item_type,
        catalogueItemId: line.catalogue_item_id,
        name: line.item_name_snapshot,
        quantity: line.quantity,
        dimensions: line.standard_dimensions_snapshot,
        requestedLength: line.requested_length_ft,
        requestedWidth: line.requested_width_ft,
        requestedHeight: line.requested_height_ft,
        specifications: line.specifications,
        notes: line.notes,
      }));

      await tx.query(
        `INSERT INTO booking_items
           (booking_id, category, item_id, item_name, quantity, unit_price, subtotal, metadata_json)
         VALUES ($1, 'quotation', $2, $3, 1, $4, $4, $5)`,
        [
          bookingId,
          String(enquiryId),
          `Accepted quotation — ${enquiry.reference_code}`,
          totalAmount,
          JSON.stringify({
            sourceEnquiryId: enquiryId,
            sourceEnquiryReference: enquiry.reference_code,
            pricingStatus: 'quotation',
            sourceItems,
            acceptedBy: adminUserId,
            acceptedAt,
          }),
        ],
      );

      return { bookingId, accessToken, totalAmount };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new EnquiryLifecycleError('This enquiry has already been accepted and has a booking.');
    }
    throw error;
  }
}

export async function rejectEnquiry(
  input: RejectEnquiryInput,
  client: NeonOperationalClient = getNeonClient(),
): Promise<void> {
  const enquiryId = requireEnquiryId(input.enquiryId);
  const adminUserId = requireAdminId(input.adminUserId);
  const reason = String(input.reason ?? '').trim().slice(0, 1000);

  await client.tx(async (tx) => {
    const existingBooking = await tx.query<{ id: number }>(
      'SELECT id FROM bookings WHERE source_enquiry_id = $1 LIMIT 1',
      [enquiryId],
    );
    if (existingBooking.rows[0]) {
      throw new EnquiryLifecycleError('This enquiry already has a booking and cannot be rejected.');
    }

    const updated = await tx.query(
      `UPDATE event_enquiries
          SET status = 'rejected',
              rejection_reason = $2,
              accepted_by = NULL,
              accepted_at = NULL
        WHERE id = $1
          AND status IN ('new', 'reviewing', 'contacted', 'quoted', 'confirmed')
      RETURNING id`,
      [enquiryId, reason],
    );
    if (updated.rowCount === 0) {
      throw new EnquiryLifecycleError('This enquiry is already rejected, accepted or archived.');
    }

    // Keep the admin identity for the audit trail; the reason is on the enquiry.
    void adminUserId;
  });
}

export async function setEnquiryWorkflowStatus(
  input: { enquiryId: number; adminUserId: number; status: 'reviewing' | 'contacted' },
  client: NeonOperationalClient = getNeonClient(),
): Promise<void> {
  const enquiryId = requireEnquiryId(input.enquiryId);
  const adminUserId = requireAdminId(input.adminUserId);
  if (!ACTIVE_WORKFLOW_STATUSES.has(input.status)) {
    throw new EnquiryLifecycleError('That status cannot be set from the new-enquiry workflow.');
  }

  const updated = await client.query(
    `UPDATE event_enquiries
        SET status = $2
      WHERE id = $1
        AND status IN ('new', 'reviewing', 'contacted', 'quoted')`,
    [enquiryId, input.status],
  );
  if (updated.rowCount === 0) {
    throw new EnquiryLifecycleError('This enquiry is no longer in the active workflow.');
  }

  void adminUserId;
}
