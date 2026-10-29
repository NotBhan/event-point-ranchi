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
