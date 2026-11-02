import { randomBytes } from 'node:crypto';
import {
  findOrCreateCustomer,
  type EnquiryLineItemRecord,
  type EnquiryQuotationLineRow,
  type EnquiryQuotationRow,
  type EventEnquiryRow,
} from '../../core/operational/service';
import { getNeonClient, type NeonOperationalClient } from '../../core/operational/neon-client';

export class EnquiryLifecycleError extends Error {}

export interface QuotationLineInput {
  enquiryLineItemId: number;
  quantity: number;
  quotedUnitPricePaise: number;
  notes?: string;
}

export interface ManualQuotationLineInput {
  description: string;
  quantity: number;
  quotedUnitPricePaise: number;
  notes?: string;
}

export interface PrepareQuotationInput {
  enquiryId: number;
  adminUserId: number;
  lines: QuotationLineInput[];
  manualLines?: ManualQuotationLineInput[];
  notes?: string;
}

export interface PreparedQuotation {
  quotationId: number;
  version: number;
  totalPaise: number;
}

export interface AcceptEnquiryInput {
  enquiryId: number;
  adminUserId: number;
  quotationId: number;
  confirm: boolean;
}

export interface AcceptedEnquiryBooking {
  bookingId: number;
  accessToken: string;
  totalAmount: number;
  quotationId: number;
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

function requireQuoteId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new EnquiryLifecycleError('Prepare a quotation before accepting.');
  return value;
}

function requireMoney(value: number): number {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new EnquiryLifecycleError('Every quotation line must have an agreed amount greater than zero.');
  }
  if (amount > MAX_AMOUNT_PAISE) throw new EnquiryLifecycleError('A quotation amount is too large.');
  return amount;
}

function requireQuantity(value: number): number {
  const quantity = Math.floor(Number(value));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000) {
    throw new EnquiryLifecycleError('Every quotation line must have a quantity of at least 1.');
  }
  return quantity;
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
    catalogue_unit_price_paise:
      line.catalogue_unit_price_paise === null ? null : Number(line.catalogue_unit_price_paise),
    catalogue_subtotal_paise:
      line.catalogue_subtotal_paise === null ? null : Number(line.catalogue_subtotal_paise),
    pricing_status: line.pricing_status ?? 'on_request',
    metadata_json: line.metadata_json ?? '{}',
  }));
}

/**
 * Creates a server-calculated, versioned quotation for an enquiry. Catalogue
 * prices stay on the enquiry line snapshot; the agreed prices live only on
 * quotation lines.
 */
export async function prepareEnquiryQuotation(
  input: PrepareQuotationInput,
  client: NeonOperationalClient = getNeonClient(),
): Promise<PreparedQuotation> {
  const enquiryId = requireEnquiryId(input.enquiryId);
  const adminUserId = requireAdminId(input.adminUserId);
  const notes = String(input.notes ?? '').trim().slice(0, 2000);

  return client.tx(async (tx) => {
    const enquiryRes = await tx.query<EventEnquiryRow>(
      'SELECT * FROM event_enquiries WHERE id = $1 LIMIT 1',
      [enquiryId],
    );
    const enquiry = enquiryRes.rows[0];
    if (!enquiry) throw new EnquiryLifecycleError('Enquiry not found.');
    if (enquiry.status === 'rejected' || enquiry.status === 'archived') {
      throw new EnquiryLifecycleError('A rejected or archived enquiry cannot be quoted.');
    }

    const existingBooking = await tx.query<{ id: number }>(
      'SELECT id FROM bookings WHERE source_enquiry_id = $1 LIMIT 1',
      [enquiryId],
    );
    if (existingBooking.rows[0]) {
      throw new EnquiryLifecycleError('This enquiry already has a booking.');
    }

    const sourceLines = await loadLines(tx, enquiryId);
    const sourceById = new Map(sourceLines.map((line) => [Number(line.id), line]));
    const seen = new Set<number>();

    const catalogueLines = input.lines.map((line) => {
      const source = sourceById.get(Number(line.enquiryLineItemId));
      if (!source || seen.has(Number(source.id))) {
        throw new EnquiryLifecycleError('The quotation contains an invalid or duplicate enquiry line.');
      }
      seen.add(Number(source.id));
      const quantity = requireQuantity(line.quantity);
      const quotedUnit = requireMoney(line.quotedUnitPricePaise);
      return {
        source,
        quantity,
        quotedUnit,
        notes: String(line.notes ?? '').trim().slice(0, 1000),
      };
    });

    if (seen.size !== sourceLines.length) {
      throw new EnquiryLifecycleError('The quotation must include every original customer selection.');
    }

    const manualLines = (input.manualLines ?? [])
      .filter(
        (line) =>
          String(line.description ?? '').trim().length > 0 ||
          Number(line.quotedUnitPricePaise) > 0,
      )
      .map((line) => {
        const description = String(line.description ?? '').trim().slice(0, 255);
        if (!description) {
          throw new EnquiryLifecycleError('Every manual quotation line needs a description.');
        }
        return {
          description,
          quantity: requireQuantity(line.quantity),
          quotedUnit: requireMoney(line.quotedUnitPricePaise),
          notes: String(line.notes ?? '').trim().slice(0, 1000),
        };
      });

    if (catalogueLines.length === 0 && manualLines.length === 0) {
      throw new EnquiryLifecycleError('Add at least one quotation line before saving.');
    }

    const quotedSubtotal = [...catalogueLines, ...manualLines].reduce(
      (sum, line) => sum + line.quantity * line.quotedUnit,
      0,
    );
    if (quotedSubtotal <= 0) throw new EnquiryLifecycleError('The quotation total must be greater than zero.');

    const versionRes = await tx.query<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM enquiry_quotations WHERE enquiry_id = $1',
      [enquiryId],
    );
    const version = Number(versionRes.rows[0]?.version ?? 0) + 1;

    await tx.query(
      `UPDATE enquiry_quotations
          SET status = 'superseded', updated_at = NOW()
        WHERE enquiry_id = $1 AND status = 'prepared'`,
      [enquiryId],
    );

    const inserted = await tx.query<{ id: number }>(
      `INSERT INTO enquiry_quotations
         (enquiry_id, version, status, priced_subtotal_paise, quoted_subtotal_paise,
          total_paise, notes, prepared_by, prepared_at)
       VALUES ($1, $2, 'prepared', $3, $4, $4, $5, $6, NOW())
       RETURNING id`,
      [
        enquiryId,
        version,
        Math.max(0, Math.round(Number(enquiry.priced_subtotal_paise ?? 0))),
        quotedSubtotal,
        notes,
        adminUserId,
      ],
    );

    let quotationId = Number(inserted.rows[0]?.id ?? 0);
    if (!quotationId) {
      const lookup = await tx.query<{ id: number }>(
        'SELECT id FROM enquiry_quotations WHERE enquiry_id = $1 AND version = $2 LIMIT 1',
        [enquiryId, version],
      );
      quotationId = Number(lookup.rows[0]?.id ?? 0);
    }
    if (!quotationId) throw new Error('The quotation was written but its id could not be read back.');

    for (const line of catalogueLines) {
      await tx.query(
        `INSERT INTO enquiry_quotation_lines
           (quotation_id, enquiry_line_item_id, line_type, catalogue_item_id, description,
            quantity, catalogue_unit_price_paise, quoted_unit_price_paise, quoted_subtotal_paise, notes)
         VALUES ($1, $2, 'catalogue', $3, $4, $5, $6, $7, $8, $9)`,
        [
          quotationId,
          line.source.id,
          line.source.catalogue_item_id,
          line.source.item_name_snapshot,
          line.quantity,
          line.source.catalogue_unit_price_paise ?? null,
          line.quotedUnit,
          line.quantity * line.quotedUnit,
          line.notes,
        ],
      );
    }

    for (const line of manualLines) {
      await tx.query(
        `INSERT INTO enquiry_quotation_lines
           (quotation_id, enquiry_line_item_id, line_type, catalogue_item_id, description,
            quantity, catalogue_unit_price_paise, quoted_unit_price_paise, quoted_subtotal_paise, notes)
         VALUES ($1, NULL, 'manual', NULL, $2, $3, NULL, $4, $5, $6)`,
        [quotationId, line.description, line.quantity, line.quotedUnit, line.quantity * line.quotedUnit, line.notes],
      );
    }

    await tx.query(
      `UPDATE event_enquiries
          SET status = 'quoted'
        WHERE id = $1 AND status IN ('new', 'reviewing', 'contacted')`,
      [enquiryId],
    );

    return { quotationId, version, totalPaise: quotedSubtotal };
  });
}

/**
 * Converts an enquiry plus its latest prepared quotation into exactly one
 * managed booking in a single transaction.
 */
export async function acceptEnquiry(
  input: AcceptEnquiryInput,
  client: NeonOperationalClient = getNeonClient(),
): Promise<AcceptedEnquiryBooking> {
  const enquiryId = requireEnquiryId(input.enquiryId);
  const adminUserId = requireAdminId(input.adminUserId);
  const quotationId = requireQuoteId(input.quotationId);
  if (!input.confirm) {
    throw new EnquiryLifecycleError('Confirm the prepared quotation before accepting the enquiry.');
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

      const quoteRes = await tx.query<EnquiryQuotationRow>(
        'SELECT * FROM enquiry_quotations WHERE id = $1 AND enquiry_id = $2 LIMIT 1',
        [quotationId, enquiryId],
      );
      const quotation = quoteRes.rows[0];
      if (!quotation) throw new EnquiryLifecycleError('The prepared quotation could not be found.');
      if (quotation.status !== 'prepared') {
        throw new EnquiryLifecycleError('This quotation is no longer available for acceptance.');
      }
      if (!quotation.prepared_by || !quotation.prepared_at) {
        throw new EnquiryLifecycleError('The quotation was not prepared by an admin.');
      }

      const quoteLinesRes = await tx.query<EnquiryQuotationLineRow>(
        'SELECT * FROM enquiry_quotation_lines WHERE quotation_id = $1 ORDER BY id ASC',
        [quotationId],
      );
      const quoteLines = quoteLinesRes.rows;
      if (quoteLines.length === 0) throw new EnquiryLifecycleError('The quotation has no lines.');

      const sourceLines = await loadLines(tx, enquiryId);
      const sourceById = new Map(sourceLines.map((line) => [Number(line.id), line]));
      const seenSource = new Set<number>();
      let computedTotal = 0;

      for (const line of quoteLines) {
        const quantity = Number(line.quantity);
        const quotedUnit = Number(line.quoted_unit_price_paise);
        if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(quotedUnit) || quotedUnit <= 0) {
          throw new EnquiryLifecycleError('The quotation contains an invalid quantity or agreed price.');
        }
        const subtotal = quantity * quotedUnit;
        if (line.line_type === 'catalogue') {
          const sourceId = Number(line.enquiry_line_item_id);
          if (!sourceById.has(sourceId) || seenSource.has(sourceId)) {
            throw new EnquiryLifecycleError('The quotation contains an invalid or duplicate customer selection.');
          }
          seenSource.add(sourceId);
        } else if (line.line_type === 'manual') {
          if (!line.description.trim()) {
            throw new EnquiryLifecycleError('A manual quotation line is missing its description.');
          }
        } else {
          throw new EnquiryLifecycleError('The quotation contains an unknown line type.');
        }
        computedTotal += subtotal;
      }

      if (seenSource.size !== sourceLines.length) {
        throw new EnquiryLifecycleError('The quotation no longer matches the complete customer enquiry.');
      }
      if (computedTotal <= 0) throw new EnquiryLifecycleError('The quotation total is invalid.');
      if (computedTotal !== Number(quotation.total_paise) || computedTotal !== Number(quotation.quoted_subtotal_paise)) {
        throw new EnquiryLifecycleError('The quotation total changed. Re-save the quotation before accepting.');
      }

      const acceptedQuote = await tx.query(
        `UPDATE enquiry_quotations
            SET status = 'accepted', accepted_by = $2, accepted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'prepared'`,
        [quotationId, adminUserId],
      );
      if (acceptedQuote.rowCount === 0) {
        throw new EnquiryLifecycleError('This quotation has already been accepted or replaced.');
      }

      const updated = await tx.query(
        `UPDATE event_enquiries
            SET status = 'accepted',
                accepted_by = $2,
                accepted_at = NOW(),
                rejection_reason = '',
                accepted_quotation_id = $3
          WHERE id = $1
            AND status NOT IN ('rejected', 'archived')
          RETURNING id`,
        [enquiryId, adminUserId, quotationId],
      );
      if (updated.rowCount === 0) {
        throw new EnquiryLifecycleError('This enquiry is no longer eligible for acceptance.');
      }

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
      const advanceAmount = Math.round((computedTotal * DEPOSIT_PERCENT) / 100);
      const specialRequest = [enquiry.decoration_notes, enquiry.accommodation_notes]
        .filter(Boolean)
        .join('\n');

      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO bookings (
           customer_id, access_token, event_date, event_time, event_type, total_guest,
           special_request, status, total_amount, advance_amount, amount_paid,
           outstanding_balance, payment_status, deposit_type, deposit_value,
           source_enquiry_id, source_quotation_id, venue_location
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, 0, $8, 'unpaid',
           'percentage', $10, $11, $12, $13
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
          computedTotal,
          advanceAmount,
          DEPOSIT_PERCENT,
          enquiryId,
          quotationId,
          enquiry.venue_location,
        ],
      );

      const bookingId = Number(inserted.rows[0]?.id ?? 0);
      if (!bookingId) throw new Error('The booking was written but its id could not be read back.');

      for (const line of quoteLines) {
        const source = line.enquiry_line_item_id ? sourceById.get(Number(line.enquiry_line_item_id)) : null;
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.quoted_unit_price_paise);
        await tx.query(
          `INSERT INTO booking_items
             (booking_id, category, item_id, item_name, quantity, unit_price, subtotal, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            bookingId,
            source?.item_type ?? 'manual',
            line.catalogue_item_id ? String(line.catalogue_item_id) : `quotation-line-${line.id}`,
            line.description,
            quantity,
            unitPrice,
            quantity * unitPrice,
            JSON.stringify({
              sourceEnquiryId: enquiryId,
              sourceEnquiryReference: enquiry.reference_code,
              sourceEnquiryLineId: line.enquiry_line_item_id,
              sourceQuotationId: quotationId,
              sourceQuotationVersion: Number(quotation.version),
              quotationLineId: Number(line.id),
              lineType: line.line_type,
              catalogueUnitPricePaise: line.catalogue_unit_price_paise,
              agreedUnitPricePaise: unitPrice,
            }),
          ],
        );
      }

      return {
        bookingId,
        accessToken,
        totalAmount: computedTotal,
        quotationId,
      };
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
