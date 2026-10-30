import { randomBytes } from 'node:crypto';
import { getNeonClient } from './neon-client';
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
  status: 'new' | 'reviewing' | 'quoted' | 'confirmed' | 'archived';
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
  status: 'draft' | 'pending' | 'confirmed' | 'cancelled';
  total_amount: number;
  advance_amount: number;
  amount_paid: number;
  outstanding_balance: number;
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
}

export type BookingFinancialsRow = BookingRow;

export interface PaymentRow {
  id: number;
  booking_id: number;
  customer_id: number | null;
  provider: 'razorpay' | 'phonepe';
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
    'SELECT * FROM users WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)) AND is_active = true LIMIT 1',
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
  return res.rowCount > 0;
}

export async function updateUserRole(userId: number, role: Role): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query(
    'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
    [role, userId],
  );
  return res.rowCount > 0;
}

export async function listUsers(): Promise<UserRow[]> {
  const neon = getNeonClient();
  const res = await neon.query<UserRow>(
    'SELECT id, username, email, first_name, role, is_active, created_at, updated_at, password_hash FROM users ORDER BY id ASC',
  );
  return res.rows;
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

export async function updateEventEnquiryStatus(id: number, status: string): Promise<boolean> {
  const neon = getNeonClient();
  const res = await neon.query('UPDATE event_enquiries SET status = $1 WHERE id = $2', [status, id]);
  return res.rowCount > 0;
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
  status?: 'draft' | 'pending' | 'confirmed' | 'cancelled';
  total_amount: number;
  advance_amount?: number;
  amount_paid?: number;
  outstanding_balance?: number;
  payment_status?: 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
}): Promise<BookingRow> {
  const neon = getNeonClient();
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
       amount_paid, outstanding_balance, payment_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
    ]
  );
  return res.rows[0];
}

export async function updateBookingFinancials(
  bookingId: number,
  amountPaid: number,
  outstandingBalance: number,
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'refunded',
  bookingStatus?: 'draft' | 'pending' | 'confirmed' | 'cancelled'
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

/* ============================ Payments (Neon) ============================ */

export async function createPaymentRecord(data: {
  bookingId: number;
  customerId?: number | null;
  provider: 'razorpay' | 'phonepe';
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
    razorpay: { count: number; totalPaise: number };
    phonepe: { count: number; totalPaise: number };
  };
}

export async function getPaymentMetrics(): Promise<PaymentMetrics> {
  const neon = getNeonClient();
  const paymentsRes = await neon.query<{ status: string; provider: string; amount_paise: string }>(
    'SELECT status, provider, amount_paise FROM payments'
  );
  const bookingsRes = await neon.query<{ outstanding_balance: string }>(
    'SELECT outstanding_balance FROM bookings'
  );
  const refundsRes = await neon.query<{ status: string; amount_paise: string }>(
    'SELECT status, amount_paise FROM refunds'
  );

  let totalCollectedPaise = 0;
  let successfulCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let refundedCount = 0;
  const providerStats = {
    razorpay: { count: 0, totalPaise: 0 },
    phonepe: { count: 0, totalPaise: 0 },
  };

  for (const p of paymentsRes.rows) {
    const amount = Number(p.amount_paise) || 0;
    if (p.status === 'captured') {
      totalCollectedPaise += amount;
      successfulCount++;
      if (p.provider === 'razorpay') {
        providerStats.razorpay.count++;
        providerStats.razorpay.totalPaise += amount;
      } else if (p.provider === 'phonepe') {
        providerStats.phonepe.count++;
        providerStats.phonepe.totalPaise += amount;
      }
    } else if (p.status === 'pending' || p.status === 'created' || p.status === 'authorized') {
      pendingCount++;
    } else if (p.status === 'failed') {
      failedCount++;
    } else if (p.status === 'refunded' || p.status === 'partially_refunded') {
      refundedCount++;
    }
  }

  let totalRefundedPaise = 0;
  for (const r of refundsRes.rows) {
    if (r.status === 'processed') {
      totalRefundedPaise += Number(r.amount_paise) || 0;
    }
  }

  let outstandingBalancePaise = 0;
  for (const b of bookingsRes.rows) {
    outstandingBalancePaise += Number(b.outstanding_balance) || 0;
  }

  return {
    totalCollectedPaise,
    successfulCount,
    pendingCount,
    failedCount,
    refundedCount,
    totalRefundedPaise,
    outstandingBalancePaise,
    providerStats,
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
  const countRes = await neon.query<{ cnt: string }>(countQuery, params);
  const total = Number(countRes.rows[0]?.cnt || 0);

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
  const listRes = await neon.query<PaymentRow & { customer_name?: string; customer_phone?: string; event_type?: string }>(
    listQuery,
    listParams
  );

  return { payments: listRes.rows, total };
}
