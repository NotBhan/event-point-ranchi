import { randomBytes } from 'node:crypto';
import { getNeonClient, type NeonOperationalClient } from './neon-client';
import { verifyPassword, hashPassword } from '../password';
import type { Role } from '../types';

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  first_name: string;
  role: Role;
  is_active: boolean | number;
  password_hash: string;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerRow {
  id: number;
  user_id: number | null;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  created_at?: string;
}

export interface EventEnquiryRow {
  id: number;
  reference_code: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  event_type: string;
  event_date: string;
  end_date?: string | null;
  event_time?: string | null;
  venue_location: string;
  guest_count: number;
  budget_range: string;
  requires_rooms: boolean;
  room_count: number;
  accommodation_notes: string;
  decoration_notes: string;
  preferred_contact: string;
  status:
    | 'new'
    | 'reviewing'
    | 'contacted'
    | 'quoted'
    | 'accepted'
    | 'rejected'
    | 'confirmed'
    | 'archived';
  accepted_by?: number | null;
  accepted_at?: string | null;
  rejection_reason?: string | null;
  pricing_status?: 'fully_priced' | 'partially_priced' | 'quotation_required';
  priced_subtotal_paise?: number;
  pricing_breakdown_json?: string;
  additional_services?: string;
  accepted_quotation_id?: number | null;
  created_at: string;
}

export interface ContactInquiryRow {
  id: number;
  name: string;
  phone: string;
  email: string;
  event_type: string;
  event_date: string | null;
  guest_count: number | null;
  message: string;
  status: 'new' | 'contacted' | 'closed';
  created_at: string;
}

export interface BookingRow {
  id: number;
  customer_id: number;
  access_token: string;
  created_at: string;
  event_date: string | null;
  event_time: string | null;
  event_type: string;
  total_guest: number;
  special_request: string;
  status: 'draft' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'closed';
  total_amount: number;
  advance_amount: number;
  amount_paid: number;
  outstanding_balance: number;
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
  source_enquiry_id?: number | null;
  source_quotation_id?: number | null;
  venue_location?: string | null;
  /** Snapshot of the deposit policy that produced `advance_amount`. */
  deposit_type?: DepositType;
  deposit_value?: number;
}

export type BookingFinancialsRow = BookingRow;

export interface PaymentRow {
  id: number;
  booking_id: number;
  customer_id: number | null;
  provider: 'phonepe';
  provider_order_id: string | null;
  provider_payment_id: string | null;
  internal_transaction_reference: string;
  payment_type: 'advance' | 'partial' | 'balance' | 'full';
  amount_paise: number;
  currency: string;
  status: 'created' | 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  payment_method: string | null;
  failure_code: string | null;
  failure_description: string | null;
  metadata_json: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentWebhookEventRow {
  id: number;
  provider: string;
  provider_event_id: string | null;
  event_type: string;
  payload_hash: string;
  processing_status: 'pending' | 'processed' | 'ignored' | 'failed';
  error_message: string | null;
  raw_payload: string | null;
  received_at: string;
  processed_at: string | null;
}

export interface RefundRow {
  id: number;
  payment_id: number;
  booking_id: number;
  provider_refund_id: string | null;
  amount_paise: number;
  reason: string;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  failure_reason: string | null;
  initiated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentReconciliationRow {
  id: number;
  provider: string;
  provider_transaction_id: string;
  internal_payment_id: number | null;
  provider_amount_paise: number;
  internal_amount_paise: number;
  reconciliation_status: 'matched' | 'mismatched' | 'orphaned_provider' | 'missing_provider';
  notes: string | null;
  reconciled_at: string;
}

export interface InvoiceRow {
  id: number;
  booking_id: number;
  payment_id: number | null;
  invoice_number: string;
  invoice_type: 'receipt' | 'tax_invoice';
  taxable_amount_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_amount_paise: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_address: string | null;
  created_at: string;
}

export interface StorageObjectRow {
  id: number;
  object_id: string;
  storage_category: 'gallery' | 'asset';
  entity_type: string;
  entity_id: string;
  slot: string;
  object_key: string;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  format: string;
  original_filename: string;
  status: 'active' | 'pending_replacement' | 'pending_deletion' | 'deleted';
  deletion_attempts: number;
  last_deletion_error: string | null;
  created_at: string;
  updated_at: string;
}

/* ============================ Users & Auth (Neon) ============================ */

export async function findUserByLogin(login: string): Promise<UserRow | undefined> {
  const neon = getNeonClient();
  const res = await neon.query<UserRow>(
    `SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_active = true
     UNION ALL
     SELECT * FROM users WHERE LOWER(email) = LOWER($2) AND is_active = true
     LIMIT 1`,
    [login, login],
  );
  return res.rows[0];
}

export async function findUserById(id: number): Promise<UserRow | undefined> {
  const neon = getNeonClient();
  const res = await neon.query<UserRow>(
    'SELECT * FROM users WHERE id = $1 AND is_active = true LIMIT 1',
    [id],
  );
  return res.rows[0];
}

// Short-lived per-process cache for session user lookups. Without it, every
// request carrying a session cookie (including every image request) pays a
// remote database round trip. Bounded FIFO eviction; invalidated on password
// and role changes.
interface CachedUserRow {
  row: UserRow | null;
  expiresAt: number;
}

interface AuthCacheScope {
  __eventPointUserCache?: Map<number, CachedUserRow>;
}

const authCacheScope = globalThis as typeof globalThis & AuthCacheScope;
const userCache: Map<number, CachedUserRow> = (authCacheScope.__eventPointUserCache ??= new Map());

const AUTH_CACHE_TTL_MS = (() => {
  const configured = Number(process.env.AUTH_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 30_000;
})();
const AUTH_CACHE_MAX = 500;

export function invalidateAuthUser(id?: number): void {
  if (id === undefined) {
    userCache.clear();
  } else {
    userCache.delete(id);
  }
}

export async function findUserByIdCached(id: number): Promise<UserRow | undefined> {
  const now = Date.now();
  const cached = userCache.get(id);
  if (cached && cached.expiresAt > now) {
    return cached.row ?? undefined;
  }

  const row = await findUserById(id);

  if (userCache.size >= AUTH_CACHE_MAX) {
    const oldest = userCache.keys().next().value;
    if (oldest !== undefined) userCache.delete(oldest);
  }
  userCache.set(id, { row: row ?? null, expiresAt: now + AUTH_CACHE_TTL_MS });
  return row;
}

export async function authenticate(login: string, password: string): Promise<UserRow | null> {
  const user = await findUserByLogin(login);
  if (!user) return null;
  return verifyPassword(password, user.password_hash) ? user : null;
}

export async function createUser(data: {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  role?: Role;
}): Promise<UserRow> {
  const neon = getNeonClient();
  const hash = hashPassword(data.password);
  const role = data.role || 'customer';
  const firstName = data.firstName || data.username;

  const res = await neon.query<UserRow>(
    `INSERT INTO users (username, email, password_hash, first_name, role, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING *`,
    [data.username, data.email, hash, firstName, role],
  );
  return res.rows[0];
}

export async function updateUserPassword(userId: number, passwordHash: string): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, userId],
  );
  if (res.rowCount > 0) invalidateAuthUser(userId);
  return res.rowCount > 0;
}

export async function updateUserRole(userId: number, role: Role): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
    [role, userId],
  );
  if (res.rowCount > 0) invalidateAuthUser(userId);
  return res.rowCount > 0;
}

export async function listUsers(): Promise<UserRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<UserRow>(
    'SELECT id, username, email, first_name, role, is_active, created_at, updated_at, password_hash FROM users ORDER BY id ASC',
  );
  return res.rows;
}

/* ============================ Customer registration (Neon) ============================ */

export interface CustomerRegistrationInput {
  username: string;
  email: string;
  passwordHash: string;
  firstName: string;
  name: string;
  phone: string;
  /** Links an existing, still-unclaimed customer row with this phone. */
  linkByPhone?: boolean;
}

export type CustomerRegistrationResult =
  | { ok: true; userId: number; customerId: number }
  | { ok: false; error: 'username_taken' | 'email_taken' };

/**
 * Creates the login account and its customer record in one Neon transaction.
 *
 * Registration used to write to the per-instance SQLite copy while login read
 * Neon, so a new account could never sign in. Uniqueness is enforced by the
 * database constraints, not by a prior SELECT, and the email is normalised to
 * lower case before the insert.
 *
 * An existing customer row is linked **only** when it has no user yet and its
 * phone matches exactly. Accounts are never merged by name.
 */
export async function registerCustomerAccount(
  input: CustomerRegistrationInput,
): Promise<CustomerRegistrationResult> {
  const neon = getNeonClient();
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim();

  try {
    return await neon.tx(async (client) => {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO users (username, email, password_hash, first_name, role, is_active)
         VALUES ($1, $2, $3, $4, 'customer', true)
         RETURNING id`,
        [username, email, input.passwordHash, input.firstName],
      );
      const userId = Number(inserted.rows[0]?.id ?? 0);
      if (!userId) throw new Error('The account was created but its id could not be read back.');

      let customerId = 0;
      if (input.linkByPhone) {
        const claimable = await client.query<{ id: number }>(
          'SELECT id FROM customers WHERE phone = $1 AND user_id IS NULL ORDER BY id ASC LIMIT 1',
          [input.phone],
        );
        if (claimable.rows[0]) {
          customerId = Number(claimable.rows[0].id);
          await client.query('UPDATE customers SET user_id = $1, name = $2, email = $3 WHERE id = $4', [
            userId,
            input.name,
            email,
            customerId,
          ]);
        }
      }

      if (!customerId) {
        const customer = await client.query<{ id: number }>(
          `INSERT INTO customers (user_id, name, phone, email) VALUES ($1, $2, $3, $4) RETURNING id`,
          [userId, input.name, input.phone || `pending-${userId}`, email],
        );
        customerId = Number(customer.rows[0]?.id ?? 0);
        if (!customerId) throw new Error('The customer record could not be created.');
      }

      return { ok: true as const, userId, customerId };
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    // The constraint tells us which column collided.
    const message = error instanceof Error ? error.message : '';
    if (/username/i.test(message)) return { ok: false, error: 'username_taken' };
    if (/email/i.test(message)) return { ok: false, error: 'email_taken' };
    return { ok: false, error: 'email_taken' };
  }
}

/** Updates a customer record only when it belongs to the given user. */
export async function updateCustomerProfile(
  userId: number,
  data: { name: string; email: string; phone: string; address: string },
): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    `UPDATE customers
        SET name = $1, email = $2, phone = $3, address = $4
      WHERE user_id = $5`,
    [data.name, data.email, data.phone, data.address, userId],
  );
  return res.rowCount > 0;
}

/* ============================ Customers (Neon) ============================ */

export async function ensureCustomerForUser(userId: number, defaults: Partial<CustomerRow> = {}): Promise<CustomerRow> {
  const neon = getNeonClient();
  const existing = await neon.query<CustomerRow>('SELECT * FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
  if (existing.rows[0]) return existing.rows[0];

  const res = await neon.query<CustomerRow>(
    `INSERT INTO customers (user_id, name, phone, email, address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      userId,
      defaults.name ?? 'Guest',
      defaults.phone ?? `pending-${userId}`,
      defaults.email ?? '',
      defaults.address ?? '',
    ],
  );
  return res.rows[0];
}

/* ============================ Event Enquiries (Neon) ============================ */

export async function getEventEnquiries(): Promise<EventEnquiryRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<EventEnquiryRow>('SELECT * FROM event_enquiries ORDER BY id DESC');
  return res.rows;
}

export async function getEventEnquiryById(id: number): Promise<{ enquiry: EventEnquiryRow; lineItems: any[] } | null> {
  const neon = getNeonClient();
  const enqRes = await neon.query<EventEnquiryRow>('SELECT * FROM event_enquiries WHERE id = $1 LIMIT 1', [id]);
  const enquiry = enqRes.rows[0];
  if (!enquiry) return null;

  const liRes = await neon.query('SELECT * FROM enquiry_line_items WHERE enquiry_id = $1 ORDER BY id ASC', [id]);
  return { enquiry, lineItems: liRes.rows };
}

export interface NewEventEnquiryInput {
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  eventType: string;
  eventDate: string;
  endDate: string | null;
  eventTime: string | null;
  venueLocation: string;
  guestCount: number;
  budgetRange: string;
  requiresRooms: boolean;
  roomCount: number;
  accommodationNotes: string;
  decorationNotes: string;
  preferredContact: string;
  pricingStatus?: 'fully_priced' | 'partially_priced' | 'quotation_required';
  pricedSubtotalPaise?: number;
  pricingBreakdownJson?: string;
  additionalServices?: string;
}

export interface NewEnquiryLineItemInput {
  itemType: string;
  catalogueItemId: number | null;
  name: string;
  quantity: number;
  dimensions: string;
  requestedLength: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  specifications: string;
  notes: string;
  catalogueUnitPricePaise?: number | null;
  catalogueSubtotalPaise?: number | null;
  pricingStatus?: 'priced' | 'on_request';
  metadata?: Record<string, unknown>;
}

export interface EnquiryLineItemRecord {
  id: number;
  enquiry_id: number;
  item_type: string;
  catalogue_item_id: number | null;
  item_name_snapshot: string;
  quantity: number;
  standard_dimensions_snapshot: string;
  requested_length_ft: number | null;
  requested_width_ft: number | null;
  requested_height_ft: number | null;
  specifications: string;
  notes: string;
  catalogue_unit_price_paise?: number | null;
  catalogue_subtotal_paise?: number | null;
  pricing_status?: 'priced' | 'on_request';
  metadata_json?: string;
}

/** Postgres raises 23505 on a unique violation; the SQLite fallback has its own message. */
export function isUniqueConstraintError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  if (candidate?.code === '23505') return true;
  return typeof candidate?.message === 'string' && /UNIQUE constraint failed|duplicate key value/i.test(candidate.message);
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Persists an enquiry and its line items in one transaction.
 *
 * The reference code is generated per attempt so a collision (two submissions
 * racing on the same random code) is retried instead of surfacing as a failed
 * submission. `event_enquiries.reference_code` is UNIQUE, so the database — not
 * a prior SELECT — is what guarantees uniqueness.
 */
export async function insertEventEnquiry(
  enquiry: NewEventEnquiryInput,
  lines: NewEnquiryLineItemInput[],
  referenceFactory: (attempt: number) => string,
  maxAttempts = 12,
): Promise<{ id: number; referenceCode: string }> {
  const neon = getNeonClient();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const referenceCode = referenceFactory(attempt);
    try {
      return await neon.tx(async (client) => {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO event_enquiries
             (reference_code, customer_name, customer_phone, customer_email, event_type, event_date,
              end_date, event_time, venue_location, guest_count, budget_range, requires_rooms,
              room_count, accommodation_notes, decoration_notes, preferred_contact, status,
              pricing_status, priced_subtotal_paise, pricing_breakdown_json, additional_services)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'new',
                   $17, $18, $19, $20)
           RETURNING id`,
          [
            referenceCode,
            enquiry.customerName,
            enquiry.customerPhone,
            enquiry.customerEmail,
            enquiry.eventType,
            enquiry.eventDate,
            enquiry.endDate,
            enquiry.eventTime,
            enquiry.venueLocation,
            enquiry.guestCount,
            enquiry.budgetRange,
            enquiry.requiresRooms,
            enquiry.roomCount,
            enquiry.accommodationNotes,
            enquiry.decorationNotes,
            enquiry.preferredContact,
            enquiry.pricingStatus ?? 'quotation_required',
            Math.max(0, Math.round(Number(enquiry.pricedSubtotalPaise ?? 0))),
            enquiry.pricingBreakdownJson ?? '{}',
            enquiry.additionalServices ?? '',
          ],
        );

        let id = Number(inserted.rows[0]?.id ?? 0);
        if (!id) {
          // The SQLite fallback runs INSERT ... RETURNING through `run()`, which
          // discards returned rows, so read the row back by its unique reference.
          const lookup = await client.query<{ id: number }>(
            'SELECT id FROM event_enquiries WHERE reference_code = $1 LIMIT 1',
            [referenceCode],
          );
          id = Number(lookup.rows[0]?.id ?? 0);
        }
        if (!id) throw new Error('The enquiry was written but its id could not be read back.');

        for (const line of lines) {
          await client.query(
            `INSERT INTO enquiry_line_items
               (enquiry_id, item_type, catalogue_item_id, item_name_snapshot, quantity,
                standard_dimensions_snapshot, requested_length_ft, requested_width_ft, requested_height_ft,
                specifications, notes, catalogue_unit_price_paise, catalogue_subtotal_paise,
                pricing_status, metadata_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              id,
              line.itemType,
              line.catalogueItemId,
              line.name,
              line.quantity,
              line.dimensions,
              line.requestedLength,
              line.requestedWidth,
              line.requestedHeight,
              line.specifications,
              line.notes,
              line.catalogueUnitPricePaise ?? null,
              line.catalogueSubtotalPaise ?? null,
              line.pricingStatus ?? 'on_request',
              JSON.stringify(line.metadata ?? {}),
            ],
          );
        }

        return { id, referenceCode };
      });
    } catch (error) {
      lastError = error;
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  throw new Error(
    `Could not persist the enquiry with a unique reference after ${maxAttempts} attempts: ${
      lastError instanceof Error ? lastError.message : 'unknown error'
    }`,
  );
}

export async function listEventEnquiriesPage(
  filters: { status?: string; query?: string } = {},
  paging: { limit?: number; offset?: number } = {},
): Promise<{ items: EventEnquiryRow[]; totalCount: number }> {
  const neon = getNeonClient();
  const { where, params } = buildEnquiryFilter(filters);
  const limit = Math.max(1, Math.min(100, paging.limit ?? 25));
  const offset = Math.max(0, paging.offset ?? 0);

  const totalRes = await neon.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM event_enquiries ${where}`,
    params,
  );
  const totalCount = Number(totalRes.rows[0]?.count ?? 0);

  const rows = await neon.query<EventEnquiryRow>(
    `SELECT * FROM event_enquiries ${where} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return { items: rows.rows.map(normaliseEnquiryRow), totalCount };
}

export async function countEventEnquiries(
  filters: { status?: string; query?: string } = {},
): Promise<number> {
  const neon = getNeonClient();
  const { where, params } = buildEnquiryFilter(filters);
  const res = await neon.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM event_enquiries ${where}`,
    params,
  );
  return Number(res.rows[0]?.count ?? 0);
}

/** Enquiries still requiring an admin decision. */
export const ACTIVE_ENQUIRY_STATUSES = ['new', 'reviewing', 'contacted', 'quoted'] as const;

const ENQUIRY_STATUS_GROUPS: Record<string, readonly string[]> = {
  active: ACTIVE_ENQUIRY_STATUSES,
  history: ['accepted', 'confirmed', 'rejected', 'archived'],
  accepted: ['accepted', 'confirmed'],
  rejected: ['rejected', 'archived'],
};

function buildEnquiryFilter(filters: { status?: string; query?: string }): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    const group = ENQUIRY_STATUS_GROUPS[filters.status];
    const statuses = group ?? [filters.status];
    const placeholders = statuses.map((status) => {
      params.push(status);
      return `$${params.length}`;
    });
    clauses.push(`status IN (${placeholders.join(', ')})`);
  }

  if (filters.query) {
    const like = `%${filters.query.toLowerCase()}%`;
    const columns = [
      'reference_code',
      'customer_name',
      'customer_phone',
      'customer_email',
      'event_type',
      'venue_location',
    ];
    const placeholders = columns.map((column) => {
      params.push(like);
      return `LOWER(${column}) LIKE $${params.length}`;
    });
    clauses.push(`(${placeholders.join(' OR ')})`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function getEventEnquiryWithItems(
  id: number,
): Promise<{ enquiry: EventEnquiryRow; lines: EnquiryLineItemRecord[] } | null> {
  const neon = getNeonClient();
  const enquiryRes = await neon.query<EventEnquiryRow>('SELECT * FROM event_enquiries WHERE id = $1 LIMIT 1', [id]);
  const enquiry = enquiryRes.rows[0];
  if (!enquiry) return null;

  const itemsRes = await neon.query<EnquiryLineItemRecord>(
    'SELECT * FROM enquiry_line_items WHERE enquiry_id = $1 ORDER BY id ASC',
    [id],
  );

  return {
    enquiry: normaliseEnquiryRow(enquiry),
    lines: itemsRes.rows.map((line) => ({
      ...line,
      requested_length_ft: optionalNumber(line.requested_length_ft),
      requested_width_ft: optionalNumber(line.requested_width_ft),
      requested_height_ft: optionalNumber(line.requested_height_ft),
      quantity: Number(line.quantity ?? 0),
      catalogue_item_id: line.catalogue_item_id === null ? null : Number(line.catalogue_item_id),
      catalogue_unit_price_paise: optionalNumber(line.catalogue_unit_price_paise),
      catalogue_subtotal_paise: optionalNumber(line.catalogue_subtotal_paise),
      pricing_status: line.pricing_status ?? 'on_request',
      metadata_json: line.metadata_json ?? '{}',
    })),
  };
}

export async function getEnquiryLineItemsForIds(ids: number[]): Promise<EnquiryLineItemRecord[]> {
  const cleanIds = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (cleanIds.length === 0) return [];

  const neon = getNeonClient();
  const placeholders = cleanIds.map((_, index) => `$${index + 1}`).join(', ');
  const res = await neon.query<EnquiryLineItemRecord>(
    `SELECT * FROM enquiry_line_items
      WHERE enquiry_id IN (${placeholders})
      ORDER BY enquiry_id ASC, id ASC`,
    cleanIds,
  );

  return res.rows.map((line) => ({
    ...line,
    requested_length_ft: optionalNumber(line.requested_length_ft),
    requested_width_ft: optionalNumber(line.requested_width_ft),
    requested_height_ft: optionalNumber(line.requested_height_ft),
    quantity: Number(line.quantity ?? 0),
    catalogue_item_id: line.catalogue_item_id === null ? null : Number(line.catalogue_item_id),
    catalogue_unit_price_paise: optionalNumber(line.catalogue_unit_price_paise),
    catalogue_subtotal_paise: optionalNumber(line.catalogue_subtotal_paise),
    pricing_status: line.pricing_status ?? 'on_request',
    metadata_json: line.metadata_json ?? '{}',
  }));
}

export interface EnquiryQuotationRow {
  id: number;
  enquiry_id: number;
  version: number;
  status: 'prepared' | 'accepted' | 'superseded';
  priced_subtotal_paise: number;
  quoted_subtotal_paise: number;
  total_paise: number;
  notes: string;
  prepared_by: number | null;
  prepared_at: string | null;
  accepted_by: number | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnquiryQuotationLineRow {
  id: number;
  quotation_id: number;
  enquiry_line_item_id: number | null;
  line_type: 'catalogue' | 'manual';
  catalogue_item_id: number | null;
  description: string;
  quantity: number;
  catalogue_unit_price_paise: number | null;
  quoted_unit_price_paise: number;
  quoted_subtotal_paise: number;
  notes: string;
  created_at: string;
}

export interface EnquiryQuotationWithLines {
  quotation: EnquiryQuotationRow;
  lines: EnquiryQuotationLineRow[];
}

function normaliseQuotation(row: EnquiryQuotationRow): EnquiryQuotationRow {
  return {
    ...row,
    version: Number(row.version ?? 1),
    priced_subtotal_paise: Number(row.priced_subtotal_paise ?? 0),
    quoted_subtotal_paise: Number(row.quoted_subtotal_paise ?? 0),
    total_paise: Number(row.total_paise ?? 0),
  };
}

function normaliseQuotationLine(row: EnquiryQuotationLineRow): EnquiryQuotationLineRow {
  return {
    ...row,
    enquiry_line_item_id: row.enquiry_line_item_id === null ? null : Number(row.enquiry_line_item_id),
    catalogue_item_id: row.catalogue_item_id === null ? null : Number(row.catalogue_item_id),
    quantity: Number(row.quantity ?? 0),
    catalogue_unit_price_paise:
      row.catalogue_unit_price_paise === null ? null : Number(row.catalogue_unit_price_paise),
    quoted_unit_price_paise: Number(row.quoted_unit_price_paise ?? 0),
    quoted_subtotal_paise: Number(row.quoted_subtotal_paise ?? 0),
  };
}

export async function getEnquiryQuotationWithLines(
  quotationId: number,
): Promise<EnquiryQuotationWithLines | null> {
  const neon = getNeonClient();
  const quotationRes = await neon.query<EnquiryQuotationRow>(
    'SELECT * FROM enquiry_quotations WHERE id = $1 LIMIT 1',
    [quotationId],
  );
  const quotation = quotationRes.rows[0];
  if (!quotation) return null;

  const lineRes = await neon.query<EnquiryQuotationLineRow>(
    'SELECT * FROM enquiry_quotation_lines WHERE quotation_id = $1 ORDER BY id ASC',
    [quotationId],
  );

  return {
    quotation: normaliseQuotation(quotation),
    lines: lineRes.rows.map(normaliseQuotationLine),
  };
}

export async function listEnquiryQuotations(enquiryId: number): Promise<EnquiryQuotationWithLines[]> {
  const neon = getNeonClient();
  const quotes = await neon.query<EnquiryQuotationRow>(
    'SELECT * FROM enquiry_quotations WHERE enquiry_id = $1 ORDER BY version DESC',
    [enquiryId],
  );
  if (quotes.rows.length === 0) return [];

  const ids = quotes.rows.map((quote) => Number(quote.id));
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const lines = await neon.query<EnquiryQuotationLineRow>(
    `SELECT * FROM enquiry_quotation_lines
      WHERE quotation_id IN (${placeholders})
      ORDER BY quotation_id ASC, id ASC`,
    ids,
  );
  const byQuote = new Map<number, EnquiryQuotationLineRow[]>();
  for (const line of lines.rows) {
    const list = byQuote.get(Number(line.quotation_id)) ?? [];
    list.push(normaliseQuotationLine(line));
    byQuote.set(Number(line.quotation_id), list);
  }

  return quotes.rows.map((quote) => ({
    quotation: normaliseQuotation(quote),
    lines: byQuote.get(Number(quote.id)) ?? [],
  }));
}

export async function getLatestPreparedEnquiryQuotation(
  enquiryId: number,
): Promise<EnquiryQuotationWithLines | null> {
  const neon = getNeonClient();
  const quoteRes = await neon.query<EnquiryQuotationRow>(
    `SELECT * FROM enquiry_quotations
      WHERE enquiry_id = $1 AND status = 'prepared'
      ORDER BY version DESC LIMIT 1`,
    [enquiryId],
  );
  const quote = quoteRes.rows[0];
  if (!quote) return null;
  return getEnquiryQuotationWithLines(Number(quote.id));
}

export interface EnquiryBookingSummary {
  id: number;
  status: string;
  total_amount: number;
  payment_status: string;
  created_at: string;
  source_quotation_id?: number | null;
}

export async function getBookingForEnquiry(enquiryId: number): Promise<EnquiryBookingSummary | null> {
  const neon = getNeonClient();
  const res = await neon.query<EnquiryBookingSummary>(
    `SELECT id, status, total_amount, payment_status, created_at
       FROM bookings
      WHERE source_enquiry_id = $1
      LIMIT 1`,
    [enquiryId],
  );
  const row = res.rows[0];
  return row ? { ...row, total_amount: Number(row.total_amount ?? 0) } : null;
}

export async function getBookingsForEnquiryIds(
  enquiryIds: number[],
): Promise<Map<number, EnquiryBookingSummary>> {
  const cleanIds = [...new Set(enquiryIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, EnquiryBookingSummary>();
  if (cleanIds.length === 0) return result;

  const neon = getNeonClient();
  const placeholders = cleanIds.map((_, index) => `$${index + 1}`).join(', ');
  const res = await neon.query<EnquiryBookingSummary & { source_enquiry_id: number }>(
    `SELECT source_enquiry_id, id, status, total_amount, payment_status, created_at
       FROM bookings
      WHERE source_enquiry_id IN (${placeholders})`,
    cleanIds,
  );

  for (const row of res.rows) {
    result.set(Number(row.source_enquiry_id), {
      id: Number(row.id),
      status: row.status,
      total_amount: Number(row.total_amount ?? 0),
      payment_status: row.payment_status,
      created_at: row.created_at,
    });
  }
  return result;
}

/** `requires_rooms` is BOOLEAN in Postgres and INTEGER in the SQLite fallback. */
function normaliseEnquiryRow(row: EventEnquiryRow): EventEnquiryRow {
  return {
    ...row,
    requires_rooms: Boolean(row.requires_rooms),
    room_count: Number(row.room_count ?? 0),
    guest_count: Number(row.guest_count ?? 0),
    priced_subtotal_paise: Number(row.priced_subtotal_paise ?? 0),
  };
}

/* ============================ Contact Inquiries (Neon) ============================ */

export async function getContactInquiries(): Promise<ContactInquiryRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<ContactInquiryRow>('SELECT * FROM contact_inquiries ORDER BY id DESC');
  return res.rows;
}

export async function updateContactInquiryStatus(id: number, status: string): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query('UPDATE contact_inquiries SET status = $1 WHERE id = $2', [status, id]);
  return res.rowCount > 0;
}

export interface NewContactInquiryInput {
  name: string;
  phone: string;
  email: string;
  eventType: string;
  eventDate: string | null;
  guestCount: number | null;
  message: string;
}

/**
 * Persists a contact-form inquiry. Returns only after the insert commits, so a
 * visitor is never thanked for a submission that was not stored.
 */
export async function createContactInquiry(input: NewContactInquiryInput): Promise<{ id: number }> {
  const neon = getNeonClient();
  const res = await neon.query<{ id: number }>(
    `INSERT INTO contact_inquiries
       (name, phone, email, event_type, event_date, guest_count, message, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'new')
     RETURNING id`,
    [
      input.name,
      input.phone,
      input.email,
      input.eventType,
      input.eventDate,
      input.guestCount,
      input.message,
    ],
  );

  const id = Number(res.rows[0]?.id ?? 0);
  if (!id) throw new Error('The inquiry was written but its id could not be read back.');
  return { id };
}

function contactInquiryFilter(status?: string): { where: string; params: unknown[] } {
  if (!status || status === 'all') return { where: '', params: [] };
  return { where: 'WHERE status = $1', params: [status] };
}

export async function countContactInquiries(status?: string): Promise<number> {
  const neon = getNeonClient();
  const { where, params } = contactInquiryFilter(status);
  const res = await neon.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM contact_inquiries ${where}`,
    params,
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function listContactInquiriesPage(
  status: string | undefined,
  paging: { limit?: number; offset?: number } = {},
): Promise<ContactInquiryRow[]> {
  const neon = getNeonClient();
  const { where, params } = contactInquiryFilter(status);
  const limit = Math.max(1, Math.min(100, paging.limit ?? 25));
  const offset = Math.max(0, paging.offset ?? 0);

  const res = await neon.query<ContactInquiryRow>(
    `SELECT * FROM contact_inquiries ${where} ORDER BY id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return res.rows.map((row) => ({
    ...row,
    guest_count: row.guest_count === null || row.guest_count === undefined ? null : Number(row.guest_count),
  }));
}

export async function deleteContactInquiry(id: number): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query('DELETE FROM contact_inquiries WHERE id = $1', [id]);
  return res.rowCount > 0;
}

/* ============================ Bookings (Neon) ============================ */

export async function getBookings(): Promise<BookingRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<BookingRow>('SELECT * FROM bookings ORDER BY id DESC');
  return res.rows;
}

export async function updateBookingStatus(id: number, status: string): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, id]);
  return res.rowCount > 0;
}

/* ============================ Storage Ledger (Neon) ============================ */

export async function getStorageLedgerUsage(category: 'gallery' | 'asset'): Promise<number> {
  const neon = getNeonClient();
  const res = await neon.query<{ total: string }>(
    `SELECT COALESCE(SUM(size_bytes), 0) as total
     FROM storage_objects
     WHERE storage_category = $1 AND status IN ('active', 'pending_replacement')`,
    [category],
  );
  return Number(res.rows[0]?.total || 0);
}

export async function getStorageLedgerObjects(category?: 'gallery' | 'asset'): Promise<StorageObjectRow[]> {
  const neon = getNeonClient();
  const sql = category
    ? 'SELECT * FROM storage_objects WHERE storage_category = $1 ORDER BY id DESC'
    : 'SELECT * FROM storage_objects ORDER BY id DESC';
  const params = category ? [category] : [];
  const res = await neon.query<StorageObjectRow>(sql, params);
  return res.rows;
}

/* ============================ Traffic Events (Neon) ============================ */

export async function recordTrafficEvent(event: {
  sessionId: string;
  path: string;
  referrer?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  city?: string;
  durationSeconds?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}): Promise<void> {
  try {
    const neon = getNeonClient();
    await neon.query(
      `INSERT INTO traffic_events (session_id, path, referrer, device_type, browser, os, city, duration_seconds, utm_source, utm_medium, utm_campaign)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.sessionId,
        event.path,
        event.referrer || 'direct',
        event.deviceType || 'desktop',
        event.browser || 'Other',
        event.os || 'Other',
        event.city || 'Ranchi',
        event.durationSeconds || 0,
        event.utmSource || '',
        event.utmMedium || '',
        event.utmCampaign || '',
      ],
    );
  } catch (err) {
    console.warn('[Neon] Failed to record traffic event:', (err as Error).message);
  }
}

/* ============================ Audit Logs (Neon) ============================ */

export async function logAuditEvent(action: string, entityType: string, entityId = '', details = {}, userId?: number): Promise<void> {
  try {
    const neon = getNeonClient();
    await neon.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, entityType, entityId, JSON.stringify(details)],
    );
  } catch (err) {
    console.warn('[Neon] Failed to log audit event:', (err as Error).message);
  }
}

/* ============================ Bookings & Financials (Neon) ============================ */

export async function getBookingById(id: number): Promise<BookingRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<BookingRow>('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [id]);
  return res.rows[0] || null;
}

export async function getBookingByAccessToken(token: string): Promise<BookingRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<BookingRow>('SELECT * FROM bookings WHERE access_token = $1 LIMIT 1', [token]);
  return res.rows[0] || null;
}

export async function createBooking(data: {
  customer_id: number;
  event_type: string;
  event_date?: string | null;
  event_time?: string | null;
  total_guest?: number;
  special_request?: string;
  status?: 'draft' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'closed';
  total_amount: number;
  advance_amount?: number;
  amount_paid?: number;
  outstanding_balance?: number;
  payment_status?: 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
  deposit_type?: DepositType;
  deposit_value?: number;
}): Promise<BookingRow> {
  const neon = getNeonClient();
  await assertBookingDepositColumns();
  const token = randomBytes(24).toString('hex');
  const totalAmount = data.total_amount;
  const advanceAmount = data.advance_amount ?? Math.round((totalAmount * 25) / 100);
  const amountPaid = data.amount_paid ?? 0;
  const outstandingBalance = data.outstanding_balance ?? totalAmount - amountPaid;
  const paymentStatus =
    data.payment_status ?? (amountPaid >= totalAmount ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid');
  const res = await neon.query<BookingRow>(
    `INSERT INTO bookings (
       customer_id, access_token, event_type, event_date, event_time,
       total_guest, special_request, status, total_amount, advance_amount,
       amount_paid, outstanding_balance, payment_status, deposit_type, deposit_value
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      data.customer_id,
      token,
      data.event_type,
      data.event_date ?? '2026-12-01',
      data.event_time ?? 'Evening',
      data.total_guest ?? 100,
      data.special_request ?? '',
      data.status ?? 'pending',
      totalAmount,
      advanceAmount,
      amountPaid,
      outstandingBalance,
      paymentStatus,
      data.deposit_type ?? 'percentage',
      data.deposit_value ?? (totalAmount > 0 ? Math.round((advanceAmount / totalAmount) * 100) : 25),
    ]
  );
  return res.rows[0];
}

export async function updateBookingFinancials(
  bookingId: number,
  amountPaid: number,
  outstandingBalance: number,
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'refunded',
  bookingStatus?: 'draft' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'closed'
): Promise<boolean> {
  const neon = getNeonClient();
  if (bookingStatus) {
    const res = await neon.query(
      `UPDATE bookings 
       SET amount_paid = $1, outstanding_balance = $2, payment_status = $3, status = $4 
       WHERE id = $5`,
      [amountPaid, outstandingBalance, paymentStatus, bookingStatus, bookingId]
    );
    return res.rowCount > 0;
  }
  const res = await neon.query(
    `UPDATE bookings 
     SET amount_paid = $1, outstanding_balance = $2, payment_status = $3 
     WHERE id = $4`,
    [amountPaid, outstandingBalance, paymentStatus, bookingId]
  );
  return res.rowCount > 0;
}

/* ============================ Booking items & customers (Neon) ============================ */

export interface BookingItemRow {
  id: number;
  booking_id: number;
  category: string;
  item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  metadata_json: string;
}

export interface BookingItemInput {
  category: string;
  itemId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  subtotalPaise: number;
  metadata?: Record<string, unknown>;
}

export async function getBookingItems(bookingId: number): Promise<BookingItemRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<BookingItemRow>(
    'SELECT * FROM booking_items WHERE booking_id = $1 ORDER BY id ASC',
    [bookingId],
  );
  return res.rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    subtotal: Number(row.subtotal ?? 0),
  }));
}

/**
 * Resolves (or creates) the customer row that owns a booking.
 *
 * Registered users are matched on `user_id` (unique), guests on phone. The
 * lookup and the write happen through the same client so a caller inside a
 * transaction keeps its connection.
 */
export async function findOrCreateCustomer(params: {
  userId?: number | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  client?: Pick<NeonOperationalClient, 'query'>;
}): Promise<number> {
  const neon = params.client ?? getNeonClient();

  if (params.userId) {
    const res = await neon.query<{ id: number }>(
      `INSERT INTO customers (user_id, name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         address = EXCLUDED.address
       RETURNING id`,
      [params.userId, params.name, params.phone, params.email, params.address],
    );
    const id = Number(res.rows[0]?.id ?? 0);
    if (!id) throw new Error('The customer record could not be saved.');
    return id;
  }

  const existing = await neon.query<{ id: number }>(
    'SELECT id FROM customers WHERE phone = $1 ORDER BY id ASC LIMIT 1',
    [params.phone],
  );
  if (existing.rows[0]) {
    const id = Number(existing.rows[0].id);
    await neon.query('UPDATE customers SET name = $1, email = $2, address = $3 WHERE id = $4', [
      params.name,
      params.email,
      params.address,
      id,
    ]);
    return id;
  }

  const inserted = await neon.query<{ id: number }>(
    `INSERT INTO customers (name, phone, email, address) VALUES ($1, $2, $3, $4) RETURNING id`,
    [params.name, params.phone, params.email, params.address],
  );
  const id = Number(inserted.rows[0]?.id ?? 0);
  if (!id) throw new Error('The customer record could not be saved.');
  return id;
}

export interface BookingListFilters {
  status?: string;
  query?: string;
}

function buildBookingFilter(filters: BookingListFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const status = filters.status;
  if (status && status !== 'all') {
    if (status === 'pending_payment') {
      clauses.push(`b.status IN ('pending', 'confirmed')`);
      clauses.push(`b.payment_status IN ('unpaid', 'partially_paid')`);
    } else if (status === 'in_progress') {
      clauses.push(`b.status IN ('pending', 'confirmed')`);
    } else {
      params.push(status);
      clauses.push(`b.status = $${params.length}`);
    }
  }

  if (filters.query) {
    const like = `%${filters.query.toLowerCase()}%`;
    const expressions = [
      'c.name',
      'c.phone',
      'CAST(b.id AS TEXT)',
      'b.event_type',
      'b.venue_location',
      'e.reference_code',
    ];
    const orGroup = expressions.map((expression) => {
      params.push(like);
      return `LOWER(${expression}) LIKE $${params.length}`;
    });
    clauses.push(`(${orGroup.join(' OR ')})`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const BOOKING_JOINS = `
  FROM bookings b
  JOIN customers c ON c.id = b.customer_id
  LEFT JOIN event_enquiries e ON e.id = b.source_enquiry_id
  LEFT JOIN users u ON u.id = e.accepted_by`;

export async function countBookings(filters: BookingListFilters = {}): Promise<number> {
  const neon = getNeonClient();
  const { where, params } = buildBookingFilter(filters);
  const res = await neon.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count ${BOOKING_JOINS} ${where}`,
    params,
  );
  return Number(res.rows[0]?.count ?? 0);
}

export interface BookingListRow {
  id: number;
  customer: string;
  phone: string;
  event_date: string | null;
  event_type: string;
  total_guest: number;
  total_amount: number;
  status: string;
  payment_status: string;
  created_at: string;
  source_enquiry_id: number | null;
  source_reference: string | null;
  venue_location: string | null;
  accepted_by_name: string | null;
  accepted_at: string | null;
  item_count: number;
}

export async function listBookingsPage(
  filters: BookingListFilters = {},
  paging: { limit?: number; offset?: number } = {},
): Promise<BookingListRow[]> {
  const neon = getNeonClient();
  const { where, params } = buildBookingFilter(filters);
  const limit = Math.max(1, Math.min(100, paging.limit ?? 25));
  const offset = Math.max(0, paging.offset ?? 0);

  const res = await neon.query<BookingListRow>(
    `SELECT b.id, c.name AS customer, c.phone AS phone, b.event_date, b.event_type,
            b.total_guest, b.total_amount, b.status, b.payment_status, b.created_at,
            b.source_enquiry_id, b.venue_location,
            e.reference_code AS source_reference, e.accepted_at,
            COALESCE(NULLIF(u.first_name, ''), u.username) AS accepted_by_name,
            (SELECT COUNT(*) FROM booking_items bi WHERE bi.booking_id = b.id) AS item_count
       ${BOOKING_JOINS}
       ${where}
      ORDER BY b.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return res.rows.map((row) => ({
    ...row,
    total_guest: Number(row.total_guest ?? 0),
    total_amount: Number(row.total_amount ?? 0),
    source_enquiry_id: row.source_enquiry_id === null ? null : Number(row.source_enquiry_id),
    item_count: Number(row.item_count ?? 0),
  }));
}

export async function getBookingStats(): Promise<{
  bookings: number;
  pending: number;
  confirmed: number;
  revenue: number;
}> {
  const neon = getNeonClient();
  const res = await neon.query<{ bookings: number | string; pending: number | string; confirmed: number | string; revenue: number | string }>(
    `SELECT
       COUNT(*) AS bookings,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
       COALESCE(SUM(CASE WHEN status IN ('pending','confirmed') THEN total_amount ELSE 0 END), 0) AS revenue
     FROM bookings`,
  );
  const row = res.rows[0];
  return {
    bookings: Number(row?.bookings ?? 0),
    pending: Number(row?.pending ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    revenue: Number(row?.revenue ?? 0),
  };
}

export async function getRecentBookings(limit = 8): Promise<Array<{
  id: number;
  customer: string;
  event_date: string | null;
  event_type: string;
  total_amount: number;
  status: string;
  created_at: string;
}>> {
  const neon = getNeonClient();
  const res = await neon.query<{
    id: number;
    customer: string;
    event_date: string | null;
    event_type: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    `SELECT b.id, c.name AS customer, b.event_date, b.event_type, b.total_amount, b.status, b.created_at
       FROM bookings b JOIN customers c ON c.id = b.customer_id
      ORDER BY b.id DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map((row) => ({ ...row, total_amount: Number(row.total_amount ?? 0) }));
}

export async function getUpcomingBookings(limit = 6): Promise<Array<{
  id: number;
  customer: string;
  event_date: string;
  event_type: string;
  total_guest: number;
  status: string;
}>> {
  const neon = getNeonClient();
  const today = new Date().toISOString().slice(0, 10);
  const res = await neon.query<{
    id: number;
    customer: string;
    event_date: string;
    event_type: string;
    total_guest: number;
    status: string;
  }>(
    `SELECT b.id, c.name AS customer, b.event_date, b.event_type, b.total_guest, b.status
       FROM bookings b JOIN customers c ON c.id = b.customer_id
      WHERE b.event_date >= $1 AND b.status IN ('pending','confirmed')
      ORDER BY b.event_date ASC LIMIT $2`,
    [today, limit],
  );
  return res.rows.map((row) => ({ ...row, total_guest: Number(row.total_guest ?? 0) }));
}

/** Hall usage derived from the booking items, newest bookings first. */
export async function getHallBookingActivity(): Promise<Array<{ hallId: number; bookings: number; revenue: number }>> {
  const neon = getNeonClient();
  const res = await neon.query<{ hall_id: string; bookings: number | string; revenue: number | string }>(
    `SELECT bi.item_id AS hall_id,
            COUNT(*) AS bookings,
            COALESCE(SUM(b.total_amount), 0) AS revenue
       FROM booking_items bi
       JOIN bookings b ON b.id = bi.booking_id
      WHERE bi.category = 'hall' AND b.status IN ('pending','confirmed')
      GROUP BY bi.item_id`,
  );
  return res.rows.map((row) => ({
    hallId: Number(row.hall_id),
    bookings: Number(row.bookings ?? 0),
    revenue: Number(row.revenue ?? 0),
  }));
}

export async function setBookingStatus(id: number, status: string): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, id]);
  return res.rowCount > 0;
}

export async function getCustomerBookingsForUser(userId: number): Promise<Array<{
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
}>> {
  const neon = getNeonClient();
  const res = await neon.query<{
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
            b.advance_amount, b.amount_paid, b.outstanding_balance, b.payment_status,
            b.status, b.created_at
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
      WHERE c.user_id = $1
      ORDER BY b.id DESC`,
    [userId],
  );
  return res.rows.map((row) => ({
    ...row,
    total_guest: Number(row.total_guest ?? 0),
    total_amount: Number(row.total_amount ?? 0),
    advance_amount: Number(row.advance_amount ?? 0),
    amount_paid: Number(row.amount_paid ?? 0),
    outstanding_balance: Number(row.outstanding_balance ?? 0),
  }));
}

export async function getBookingsForCustomer(customerId: number): Promise<Array<{
  id: number;
  event_date: string | null;
  event_type: string;
  total_amount: number;
  status: string;
  created_at: string;
}>> {
  const neon = getNeonClient();
  const res = await neon.query<{
    id: number;
    event_date: string | null;
    event_type: string;
    total_amount: number;
    status: string;
    created_at: string;
  }>(
    'SELECT id, event_date, event_type, total_amount, status, created_at FROM bookings WHERE customer_id = $1 ORDER BY id DESC',
    [customerId],
  );
  return res.rows.map((row) => ({ ...row, total_amount: Number(row.total_amount ?? 0) }));
}

function customerSearchClause(query?: string): { where: string; params: unknown[] } {
  if (!query) return { where: '', params: [] };
  const like = `%${query.toLowerCase()}%`;
  const params: unknown[] = [];
  const clauses = ['c.name', 'c.phone', 'c.email'].map((column) => {
    params.push(like);
    return `LOWER(${column}) LIKE $${params.length}`;
  });
  return { where: `WHERE (${clauses.join(' OR ')})`, params };
}

export async function countCustomers(query?: string): Promise<number> {
  const neon = getNeonClient();
  const { where, params } = customerSearchClause(query);
  const res = await neon.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM customers c ${where}`,
    params,
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function listCustomersPage(
  query: string | undefined,
  paging: { limit?: number; offset?: number } = {},
): Promise<Array<{
  id: number;
  name: string;
  phone: string;
  email: string | null;
  created_at: string;
  booking_count: number;
  total_spend: number;
}>> {
  const neon = getNeonClient();
  const { where, params } = customerSearchClause(query);
  const limit = Math.max(1, Math.min(100, paging.limit ?? 25));
  const offset = Math.max(0, paging.offset ?? 0);

  const res = await neon.query<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    created_at: string;
    booking_count: number | string;
    total_spend: number | string;
  }>(
    `SELECT c.id, c.name, c.phone, c.email, c.created_at,
            COALESCE(b.booking_count, 0) AS booking_count,
            COALESCE(b.total_spend, 0) AS total_spend
       FROM customers c
       LEFT JOIN (
         SELECT customer_id,
                COUNT(*) AS booking_count,
                COALESCE(SUM(CASE WHEN status IN ('pending','confirmed') THEN total_amount ELSE 0 END), 0) AS total_spend
           FROM bookings
          GROUP BY customer_id
       ) b ON b.customer_id = c.id
       ${where}
      ORDER BY c.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return res.rows.map((row) => ({
    ...row,
    booking_count: Number(row.booking_count ?? 0),
    total_spend: Number(row.total_spend ?? 0),
  }));
}

export async function getCustomerWithUsername(id: number): Promise<{
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  created_at: string;
  username: string | null;
} | null> {
  const neon = getNeonClient();
  const res = await neon.query<{
    id: number;
    name: string;
    phone: string;
    email: string | null;
    address: string | null;
    created_at: string;
    username: string | null;
  }>(
    `SELECT c.*, u.username AS username
       FROM customers c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = $1 LIMIT 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

/** Upcoming booked dates per hall, derived from Neon booking items. */
export async function getUpcomingHallBookings(): Promise<Array<{ hallId: number; eventDate: string }>> {
  const neon = getNeonClient();
  const today = new Date().toISOString().slice(0, 10);
  const res = await neon.query<{ hall_id: string; event_date: string }>(
    `SELECT bi.item_id AS hall_id, b.event_date AS event_date
       FROM booking_items bi
       JOIN bookings b ON b.id = bi.booking_id
      WHERE bi.category = 'hall'
        AND b.status IN ('pending', 'confirmed')
        AND b.event_date IS NOT NULL
        AND b.event_date >= $1
      ORDER BY b.event_date`,
    [today],
  );
  return res.rows.map((row) => ({ hallId: Number(row.hall_id), eventDate: row.event_date }));
}

export type DepositType = 'full' | 'percentage' | 'fixed' | 'custom';

export function calculateAdvanceRequired(
  totalAmountPaise: number,
  depositType: DepositType,
  depositValue?: number
): number {
  const total = Math.max(0, Math.round(Number(totalAmountPaise) || 0));
  if (depositType === 'full') {
    return total;
  }
  if (depositType === 'percentage') {
    const pct = Math.max(1, Math.min(100, Number(depositValue) || 25));
    return Math.round((total * pct) / 100);
  }
  if (depositType === 'fixed' || depositType === 'custom') {
    // depositValue is in INR rupees, convert to paise
    const valPaise = Math.round((Number(depositValue) || 0) * 100);
    return Math.min(total, Math.max(0, valPaise));
  }
  return Math.round((total * 25) / 100);
}

/**
 * Applies the deposit policy to one booking.
 *
 * The booking row is the single owner of its deposit: `deposit_type` and
 * `deposit_value` record the policy that produced `advance_amount`, so a later
 * policy change can never rewrite a booking that was already quoted or paid.
 * There is no second database and no swallowed failure — if the UPDATE does not
 * touch a row, the caller sees an error.
 */
export async function updateBookingDepositConfig(params: {
  bookingId: number;
  depositType: DepositType;
  depositValue?: number;
  adminUserId?: number;
}): Promise<{ advanceAmount: number; totalAmount: number; depositType: DepositType; depositValue: number }> {
  const neon = getNeonClient();
  await assertBookingDepositColumns();

  const current = await neon.query<BookingRow>(
    'SELECT * FROM bookings WHERE id = $1 LIMIT 1',
    [params.bookingId],
  );
  const booking = current.rows[0];
  if (!booking) {
    throw new Error(`Booking #${params.bookingId} was not found.`);
  }

  const total = Number(booking.total_amount);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`Booking #${params.bookingId} has no total amount to apply a deposit to.`);
  }

  const amountPaid = Number(booking.amount_paid ?? 0);
  const newAdvance = calculateAdvanceRequired(total, params.depositType, params.depositValue);

  // A deposit requirement cannot be reduced below money already received; that
  // would silently misstate what the customer still owes.
  if (amountPaid > 0 && newAdvance < amountPaid) {
    throw new Error(
      `Booking #${params.bookingId} already has ₹${(amountPaid / 100).toLocaleString('en-IN')} recorded. ` +
        `The deposit cannot be set below the amount already paid.`,
    );
  }

  const normalisedValue =
    params.depositType === 'percentage'
      ? Math.max(1, Math.min(100, Number(params.depositValue) || 25))
      : params.depositType === 'fixed' || params.depositType === 'custom'
        ? Math.round(calculateAdvanceRequired(total, params.depositType, params.depositValue))
        : newAdvance > 0
          ? newAdvance
          : total;

  const updated = await neon.query(
    `UPDATE bookings
        SET advance_amount = $1, deposit_type = $2, deposit_value = $3
      WHERE id = $4`,
    [newAdvance, params.depositType, normalisedValue, params.bookingId],
  );

  if (updated.rowCount < 1) {
    throw new Error(`Booking #${params.bookingId} could not be updated.`);
  }

  // Audit is secondary: a failing audit write must not roll back a committed
  // configuration change, but it must be visible rather than swallowed.
  try {
    await logAuditEvent(
      'BOOKING_DEPOSIT_CONFIGURED',
      'booking',
      String(params.bookingId),
      {
        depositType: params.depositType,
        depositValue: normalisedValue,
        previousAdvance: Number(booking.advance_amount ?? 0),
        newAdvance,
        totalAmount: total,
      },
      params.adminUserId,
    );
  } catch (error) {
    console.error('[booking] deposit change committed but the audit entry failed:', error);
  }

  return {
    advanceAmount: newAdvance,
    totalAmount: total,
    depositType: params.depositType,
    depositValue: normalisedValue,
  };
}

const bookingSchemaVerified = new WeakSet<object>();

/**
 * Verifies — with a read-only query — that the deposit snapshot columns exist.
 *
 * The columns are added by `npm run db:migrate:schema` (migration
 * 001_booking_deposit_snapshot). A request must never perform DDL, so if the
 * migration has not run the request fails with an actionable message instead of
 * a raw "column does not exist".
 */
export async function assertBookingDepositColumns(): Promise<void> {
  const neon = getNeonClient();
  if (bookingSchemaVerified.has(neon)) return;

  try {
    await neon.query('SELECT deposit_type, deposit_value FROM bookings LIMIT 0');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      'The operational database schema is out of date: bookings.deposit_type / bookings.deposit_value are missing. ' +
        `Run \`npm run db:migrate:schema\` before serving traffic. (${detail})`,
    );
  }

  bookingSchemaVerified.add(neon);
}

/* ============================ Payments (Neon) ============================ */

export async function createPaymentRecord(data: {
  bookingId: number;
  customerId?: number | null;
  provider: 'phonepe';
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  internalTransactionReference: string;
  paymentType?: 'advance' | 'partial' | 'balance' | 'full';
  amountPaise: number;
  currency?: string;
  status?: string;
  metadataJson?: string;
}): Promise<PaymentRow> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentRow>(
    `INSERT INTO payments (
       booking_id, customer_id, provider, provider_order_id, provider_payment_id,
       internal_transaction_reference, payment_type, amount_paise, currency, status, metadata_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.bookingId,
      data.customerId ?? null,
      data.provider,
      data.providerOrderId ?? null,
      data.providerPaymentId ?? null,
      data.internalTransactionReference,
      data.paymentType ?? 'advance',
      data.amountPaise,
      data.currency ?? 'INR',
      data.status ?? 'created',
      data.metadataJson ?? '{}',
    ]
  );
  return res.rows[0];
}

export async function getPaymentById(id: number): Promise<PaymentRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 LIMIT 1', [id]);
  return res.rows[0] || null;
}

export async function getPaymentByInternalRef(ref: string): Promise<PaymentRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentRow>(
    'SELECT * FROM payments WHERE internal_transaction_reference = $1 LIMIT 1',
    [ref]
  );
  return res.rows[0] || null;
}

export async function getPaymentByProviderOrder(orderId: string): Promise<PaymentRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentRow>(
    'SELECT * FROM payments WHERE provider_order_id = $1 LIMIT 1',
    [orderId]
  );
  return res.rows[0] || null;
}

export async function getPaymentsByBookingId(bookingId: number): Promise<PaymentRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentRow>(
    'SELECT * FROM payments WHERE booking_id = $1 ORDER BY id DESC',
    [bookingId]
  );
  return res.rows;
}

export async function updatePaymentVerification(data: {
  id: number;
  providerPaymentId?: string;
  status: 'created' | 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  paymentMethod?: string;
  failureCode?: string;
  failureDescription?: string;
  verifiedAt?: string;
}): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    `UPDATE payments 
     SET provider_payment_id = COALESCE($1, provider_payment_id),
         status = $2,
         payment_method = COALESCE($3, payment_method),
         failure_code = $4,
         failure_description = $5,
         verified_at = CASE WHEN $6 = true THEN NOW() ELSE verified_at END,
         updated_at = NOW()
     WHERE id = $7`,
    [
      data.providerPaymentId ?? null,
      data.status,
      data.paymentMethod ?? null,
      data.failureCode ?? null,
      data.failureDescription ?? null,
      Boolean(data.verifiedAt || data.status === 'captured'),
      data.id,
    ]
  );
  return res.rowCount > 0;
}

/* ============================ Webhook Events (Neon) ============================ */

export async function recordWebhookEvent(data: {
  provider: string;
  providerEventId?: string | null;
  eventType: string;
  payloadHash: string;
  rawPayload?: string;
  processingStatus?: 'pending' | 'processed' | 'ignored' | 'failed';
  errorMessage?: string;
}): Promise<PaymentWebhookEventRow> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentWebhookEventRow>(
    `INSERT INTO payment_webhook_events (
       provider, provider_event_id, event_type, payload_hash, raw_payload, processing_status, error_message
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.provider,
      data.providerEventId ?? null,
      data.eventType,
      data.payloadHash,
      data.rawPayload ?? null,
      data.processingStatus ?? 'pending',
      data.errorMessage ?? null,
    ]
  );
  return res.rows[0];
}

export async function findWebhookEvent(provider: string, providerEventId: string): Promise<PaymentWebhookEventRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentWebhookEventRow>(
    'SELECT * FROM payment_webhook_events WHERE provider = $1 AND provider_event_id = $2 LIMIT 1',
    [provider, providerEventId]
  );
  return res.rows[0] || null;
}

export async function updateWebhookEventStatus(
  id: number,
  status: 'pending' | 'processed' | 'ignored' | 'failed',
  errorMessage?: string
): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    'UPDATE payment_webhook_events SET processing_status = $1, error_message = $2, processed_at = NOW() WHERE id = $3',
    [status, errorMessage ?? null, id]
  );
  return res.rowCount > 0;
}

/* ============================ Refunds (Neon) ============================ */

export async function createRefundRecord(data: {
  paymentId: number;
  bookingId: number;
  providerRefundId?: string | null;
  amountPaise: number;
  reason: string;
  status?: 'pending' | 'processing' | 'processed' | 'failed';
  initiatedBy?: number | null;
}): Promise<RefundRow> {
  const neon = getNeonClient();
  const res = await neon.query<RefundRow>(
    `INSERT INTO refunds (
       payment_id, booking_id, provider_refund_id, amount_paise, reason, status, initiated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.paymentId,
      data.bookingId,
      data.providerRefundId ?? null,
      data.amountPaise,
      data.reason,
      data.status ?? 'pending',
      data.initiatedBy ?? null,
    ]
  );
  return res.rows[0];
}

export async function getRefundsByPaymentId(paymentId: number): Promise<RefundRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<RefundRow>(
    'SELECT * FROM refunds WHERE payment_id = $1 ORDER BY id DESC',
    [paymentId]
  );
  return res.rows;
}

export async function getAllRefunds(): Promise<RefundRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<RefundRow>('SELECT * FROM refunds ORDER BY id DESC');
  return res.rows;
}

export async function updateRefundStatus(
  id: number,
  status: 'pending' | 'processing' | 'processed' | 'failed',
  providerRefundId?: string,
  failureReason?: string
): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    `UPDATE refunds 
     SET status = $1, 
         provider_refund_id = COALESCE($2, provider_refund_id),
         failure_reason = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [status, providerRefundId ?? null, failureReason ?? null, id]
  );
  return res.rowCount > 0;
}

/* ============================ Invoices & Receipts (Neon) ============================ */

export async function createInvoiceRecord(data: {
  bookingId: number;
  paymentId?: number | null;
  invoiceNumber: string;
  invoiceType?: 'receipt' | 'tax_invoice';
  taxableAmountPaise?: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  totalAmountPaise: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  customerAddress?: string | null;
}): Promise<InvoiceRow> {
  const neon = getNeonClient();
  const res = await neon.query<InvoiceRow>(
    `INSERT INTO invoices (
       booking_id, payment_id, invoice_number, invoice_type, taxable_amount_paise,
       cgst_paise, sgst_paise, igst_paise, total_amount_paise, customer_name,
       customer_phone, customer_email, customer_address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.bookingId,
      data.paymentId ?? null,
      data.invoiceNumber,
      data.invoiceType ?? 'receipt',
      data.taxableAmountPaise ?? 0,
      data.cgstPaise ?? 0,
      data.sgstPaise ?? 0,
      data.igstPaise ?? 0,
      data.totalAmountPaise,
      data.customerName,
      data.customerPhone,
      data.customerEmail ?? '',
      data.customerAddress ?? '',
    ]
  );
  return res.rows[0];
}

export async function getInvoiceByPaymentId(paymentId: number): Promise<InvoiceRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<InvoiceRow>(
    'SELECT * FROM invoices WHERE payment_id = $1 LIMIT 1',
    [paymentId]
  );
  return res.rows[0] || null;
}

export async function getInvoicesByBookingId(bookingId: number): Promise<InvoiceRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<InvoiceRow>(
    'SELECT * FROM invoices WHERE booking_id = $1 ORDER BY id DESC',
    [bookingId]
  );
  return res.rows;
}

/* ============================ Admin Payment Metrics & Lists ============================ */

export interface PaymentMetrics {
  totalCollectedPaise: number;
  successfulCount: number;
  pendingCount: number;
  failedCount: number;
  refundedCount: number;
  totalRefundedPaise: number;
  outstandingBalancePaise: number;
  providerStats: {
    phonepe: { count: number; totalPaise: number };
  };
}

/**
 * Single aggregate statement replacing three unbounded SELECTs + JS loops.
 * Portable between Postgres and the SQLite fallback (CASE WHEN, scalar subqueries).
 */
export const PAYMENT_METRICS_SQL = `
  SELECT
    (SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE status = 'captured') AS collected,
    (SELECT COUNT(*) FROM payments WHERE status = 'captured') AS successful_count,
    (SELECT COUNT(*) FROM payments WHERE status IN ('pending', 'created', 'authorized')) AS pending_count,
    (SELECT COUNT(*) FROM payments WHERE status = 'failed') AS failed_count,
    (SELECT COUNT(*) FROM payments WHERE status IN ('refunded', 'partially_refunded')) AS refunded_count,
    (SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE status = 'captured' AND provider = 'phonepe') AS phonepe_total,
    (SELECT COUNT(*) FROM payments WHERE status = 'captured' AND provider = 'phonepe') AS phonepe_count,
    (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds WHERE status = 'processed') AS refunded_total,
    (SELECT COALESCE(SUM(outstanding_balance), 0) FROM bookings) AS outstanding_total
`;

export async function getPaymentMetrics(): Promise<PaymentMetrics> {
  const neon = getNeonClient();
  // Single aggregate statement: previously three unbounded SELECTs transferred
  // every payment/refund/booking row and aggregated them in JavaScript.
  const res = await neon.query<{
    collected: string | number;
    successful_count: string | number;
    pending_count: string | number;
    failed_count: string | number;
    refunded_count: string | number;
    phonepe_total: string | number;
    phonepe_count: string | number;
    refunded_total: string | number;
    outstanding_total: string | number;
  }>(PAYMENT_METRICS_SQL);

  const row = res.rows[0];
  return {
    totalCollectedPaise: Number(row?.collected || 0),
    successfulCount: Number(row?.successful_count || 0),
    pendingCount: Number(row?.pending_count || 0),
    failedCount: Number(row?.failed_count || 0),
    refundedCount: Number(row?.refunded_count || 0),
    totalRefundedPaise: Number(row?.refunded_total || 0),
    outstandingBalancePaise: Number(row?.outstanding_total || 0),
    providerStats: {
      phonepe: {
        count: Number(row?.phonepe_count || 0),
        totalPaise: Number(row?.phonepe_total || 0),
      },
    },
  };
}

export async function listPayments(filters?: {
  search?: string;
  status?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}): Promise<{ payments: Array<PaymentRow & { customer_name?: string; customer_phone?: string; event_type?: string }>; total: number }> {
  const neon = getNeonClient();
  const limit = Math.min(filters?.limit ?? 50, 100);
  const offset = filters?.offset ?? 0;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    params.push(filters.status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (filters?.provider) {
    params.push(filters.provider);
    conditions.push(`p.provider = $${params.length}`);
  }
  if (filters?.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    const idx = params.length;
    conditions.push(`(
      LOWER(p.internal_transaction_reference) LIKE $${idx} OR
      LOWER(COALESCE(p.provider_order_id, '')) LIKE $${idx} OR
      LOWER(COALESCE(p.provider_payment_id, '')) LIKE $${idx} OR
      LOWER(COALESCE(c.name, '')) LIKE $${idx} OR
      LOWER(COALESCE(c.phone, '')) LIKE $${idx} OR
      CAST(p.booking_id AS TEXT) LIKE $${idx}
    )`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `
    SELECT COUNT(*) as cnt 
    FROM payments p 
    LEFT JOIN customers c ON c.id = p.customer_id
    ${whereClause}
  `;

  const listQuery = `
    SELECT p.*, c.name as customer_name, c.phone as customer_phone, b.event_type
    FROM payments p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN bookings b ON b.id = p.booking_id
    ${whereClause}
    ORDER BY p.id DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const listParams = [...params, limit, offset];

  const [countRes, listRes] = await Promise.all([
    neon.query<{ cnt: string }>(countQuery, params),
    neon.query<PaymentRow & { customer_name?: string; customer_phone?: string; event_type?: string }>(
      listQuery,
      listParams
    ),
  ]);

  const total = Number(countRes.rows[0]?.cnt || 0);
  return { payments: listRes.rows, total };
}

export interface PaymentReceiptRow {
  id: number;
  payment_id: number;
  booking_id: number;
  receipt_number: string;
  verification_token: string;
  verification_token_hash: string;
  amount_paise: number;
  status: 'issued' | 'refunded' | 'superseded';
  pdf_storage_key: string | null;
  issued_at: string;
  created_at: string;
}

export interface EnquiryQrTokenRow {
  id: number;
  enquiry_id: number | null;
  contact_inquiry_id: number | null;
  reference_code: string;
  token: string;
  token_hash: string;
  created_at: string;
  revoked_at: string | null;
}

export async function createPaymentReceiptRecord(params: {
  paymentId: number;
  bookingId: number;
  receiptNumber: string;
  verificationToken: string;
  verificationTokenHash: string;
  amountPaise: number;
  status?: 'issued' | 'refunded' | 'superseded';
  pdfStorageKey?: string | null;
}): Promise<PaymentReceiptRow> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentReceiptRow>(
    `INSERT INTO payment_receipts 
       (payment_id, booking_id, receipt_number, verification_token, verification_token_hash, amount_paise, status, pdf_storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.paymentId,
      params.bookingId,
      params.receiptNumber,
      params.verificationToken,
      params.verificationTokenHash,
      params.amountPaise,
      params.status || 'issued',
      params.pdfStorageKey || null,
    ]
  );
  return res.rows[0];
}

export async function getPaymentReceiptByPaymentId(paymentId: number): Promise<PaymentReceiptRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentReceiptRow>(
    'SELECT * FROM payment_receipts WHERE payment_id = $1 ORDER BY id DESC LIMIT 1',
    [paymentId]
  );
  return res.rows[0] || null;
}

export async function getPaymentReceiptByTokenHash(tokenHash: string): Promise<PaymentReceiptRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentReceiptRow>(
    'SELECT * FROM payment_receipts WHERE verification_token_hash = $1 LIMIT 1',
    [tokenHash]
  );
  return res.rows[0] || null;
}

export async function getPaymentReceiptByNumber(receiptNumber: string): Promise<PaymentReceiptRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<PaymentReceiptRow>(
    'SELECT * FROM payment_receipts WHERE receipt_number = $1 LIMIT 1',
    [receiptNumber]
  );
  return res.rows[0] || null;
}

export async function updatePaymentReceiptStatus(id: number, status: 'issued' | 'refunded' | 'superseded'): Promise<void> {
  const neon = getNeonClient();
  await neon.query('UPDATE payment_receipts SET status = $1 WHERE id = $2', [status, id]);
}

export async function createEnquiryQrTokenRecord(params: {
  enquiryId?: number | null;
  contactInquiryId?: number | null;
  referenceCode: string;
  token: string;
  tokenHash: string;
}): Promise<EnquiryQrTokenRow> {
  const neon = getNeonClient();
  const res = await neon.query<EnquiryQrTokenRow>(
    `INSERT INTO enquiry_qr_tokens (enquiry_id, contact_inquiry_id, reference_code, token, token_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.enquiryId || null,
      params.contactInquiryId || null,
      params.referenceCode,
      params.token,
      params.tokenHash,
    ]
  );
  return res.rows[0];
}

export async function getEnquiryQrTokenByHash(tokenHash: string): Promise<EnquiryQrTokenRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<EnquiryQrTokenRow>(
    'SELECT * FROM enquiry_qr_tokens WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1',
    [tokenHash]
  );
  return res.rows[0] || null;
}

export async function getEnquiryQrTokenByReference(referenceCode: string): Promise<EnquiryQrTokenRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<EnquiryQrTokenRow>(
    'SELECT * FROM enquiry_qr_tokens WHERE reference_code = $1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
    [referenceCode]
  );
  return res.rows[0] || null;
}

export async function getEnquiryQrTokenByEnquiryId(enquiryId: number): Promise<EnquiryQrTokenRow | null> {
  const neon = getNeonClient();
  const res = await neon.query<EnquiryQrTokenRow>(
    'SELECT * FROM enquiry_qr_tokens WHERE enquiry_id = $1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
    [enquiryId]
  );
  return res.rows[0] || null;
}


/** Updates the display name / login email of a user. */
export async function updateUserName(userId: number, firstName: string, email: string | null): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    'UPDATE users SET first_name = $1, email = $2, updated_at = NOW() WHERE id = $3',
    [firstName, email, userId],
  );
  return res.rowCount > 0;
}
