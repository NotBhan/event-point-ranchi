import { randomUUID } from 'node:crypto';
import { getDb, one, run } from '../db';
import { formatBytes, getStorageConfig } from './config';

export type StorageCategory = 'gallery' | 'asset';
export type StorageObjectStatus = 'active' | 'pending_replacement' | 'pending_deletion' | 'deleted';
export type QuotaWarningLevel = 'ok' | 'warning' | 'critical' | 'blocked';

export const RESERVATION_TTL_MS = 15 * 60 * 1000;

const RESERVATION_TTL_SECONDS = Math.ceil(RESERVATION_TTL_MS / 1000);
const BUSY_TIMEOUT_MS = 5_000;

export interface StorageObjectRecord {
  objectId: string;
  category: StorageCategory;
  entityType: string;
  entityId?: string;
  slot?: string;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  format: string;
  originalFilename?: string;
}

export interface StorageObjectRow {
  id: number;
  object_id: string;
  storage_category: StorageCategory;
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
  status: StorageObjectStatus;
  deletion_attempts: number;
  last_deletion_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotaReservation {
  id: string;
  category: StorageCategory;
  bytes: number;
  entityType: string;
  entityId: string;
  expiresAt: string;
  createdAt: string;
}

export interface QuotaUsage {
  category: StorageCategory;
  limitBytes: number;
  usedBytes: number;
  reservedBytes: number;
  totalBytes: number;
  availableBytes: number;
  usagePercent: number;
  level: QuotaWarningLevel;
  objectCount: number;
  reservationCount: number;
}

export type AllQuotaUsage = Record<StorageCategory, QuotaUsage>;

export interface QuotaExceededDetails {
  category: StorageCategory;
  requestedBytes: number;
  usedBytes: number;
  reservedBytes: number;
  limitBytes: number;
}

export class QuotaExceededError extends Error {
  readonly code = 'quota_exceeded';
  readonly category: StorageCategory;
  readonly requestedBytes: number;
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly limitBytes: number;
  readonly availableBytes: number;

  constructor(details: QuotaExceededDetails) {
    const accountedBytes = details.usedBytes + details.reservedBytes;
    const availableBytes = Math.max(0, details.limitBytes - accountedBytes);

    super(
      `${details.category} storage quota exceeded: ${formatBytes(details.requestedBytes)} requested, ` +
        `${formatBytes(availableBytes)} available (${formatBytes(accountedBytes)} of ` +
        `${formatBytes(details.limitBytes)} accounted).`,
    );

    this.name = 'QuotaExceededError';
    this.category = details.category;
    this.requestedBytes = details.requestedBytes;
    this.usedBytes = details.usedBytes;
    this.reservedBytes = details.reservedBytes;
    this.limitBytes = details.limitBytes;
    this.availableBytes = availableBytes;
  }
}

interface ReservationRow {
  id: string;
  storage_category: StorageCategory;
  reserved_bytes: number;
  entity_type: string;
  entity_id: string;
  expires_at: string;
  created_at: string;
}

interface NormalizedRecord {
  objectId: string;
  category: StorageCategory;
  entityType: string;
  entityId: string;
  slot: string;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  format: string;
  originalFilename: string;
}

function withTransaction<T>(fn: () => T): T {
  const db = getDb();

  if (db.isTransaction) {
    return fn();
  }

  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec('BEGIN IMMEDIATE');

  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  }
}

function isStorageCategory(value: unknown): value is StorageCategory {
  return value === 'gallery' || value === 'asset';
}

function assertCategory(category: StorageCategory): StorageCategory {
  if (!isStorageCategory(category)) {
    throw new TypeError(`Unknown storage category: ${String(category)}`);
  }
  return category;
}

function assertReservationBytes(bytes: number): number {
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new RangeError('Reservation size must be a positive integer number of bytes.');
  }
  return bytes;
}

function assertObjectBytes(bytes: number): number {
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError('Object size must be a non-negative integer number of bytes.');
  }
  return bytes;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} is required.`);
  }
  return value;
}

function optionalDimension(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }

  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function quotaLimitBytes(category: StorageCategory): number {
  const config = getStorageConfig();
  return category === 'gallery' ? config.galleryLimitBytes : config.assetLimitBytes;
}

function warningLevel(totalBytes: number, limitBytes: number): QuotaWarningLevel {
  if (limitBytes <= 0) return 'blocked';
  if (totalBytes >= limitBytes) return 'blocked';
  if (totalBytes * 100 >= limitBytes * 95) return 'critical';
  if (totalBytes * 100 >= limitBytes * 80) return 'warning';
  return 'ok';
}

function usagePercent(totalBytes: number, limitBytes: number): number {
  if (limitBytes <= 0) return totalBytes > 0 ? 100 : 0;
  return Math.round((totalBytes / limitBytes) * 10_000) / 100;
}

function purgeExpiredReservationsUnsafe(): number {
  return run("DELETE FROM storage_reservations WHERE expires_at <= datetime('now')").changes;
}

function computeUsage(category: StorageCategory): QuotaUsage {
  const objectStats = one<{ used_bytes: number | null; object_count: number | null }>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS used_bytes,
            COUNT(*) AS object_count
       FROM storage_objects
      WHERE storage_category = ?
        AND status <> 'deleted'`,
    [category],
  );

  const reservationStats = one<{ reserved_bytes: number | null; reservation_count: number | null }>(
    `SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes,
            COUNT(*) AS reservation_count
       FROM storage_reservations
      WHERE storage_category = ?
        AND expires_at > datetime('now')`,
    [category],
  );

  const limitBytes = quotaLimitBytes(category);
  const usedBytes = Number(objectStats?.used_bytes ?? 0);
  const reservedBytes = Number(reservationStats?.reserved_bytes ?? 0);
  const totalBytes = usedBytes + reservedBytes;

  return {
    category,
    limitBytes,
    usedBytes,
    reservedBytes,
    totalBytes,
    availableBytes: Math.max(0, limitBytes - totalBytes),
    usagePercent: usagePercent(totalBytes, limitBytes),
    level: warningLevel(totalBytes, limitBytes),
    objectCount: Number(objectStats?.object_count ?? 0),
    reservationCount: Number(reservationStats?.reservation_count ?? 0),
  };
}

function toReservation(row: ReservationRow): QuotaReservation {
  return {
    id: row.id,
    category: row.storage_category,
    bytes: Number(row.reserved_bytes),
    entityType: row.entity_type,
    entityId: row.entity_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function normalizeRecord(record: StorageObjectRecord): NormalizedRecord {
  if (!record || typeof record !== 'object') {
    throw new TypeError('Storage object record is required.');
  }

  return {
    objectId: requiredString(record.objectId, 'objectId'),
    category: assertCategory(record.category),
    entityType: requiredString(record.entityType, 'entityType'),
    entityId: typeof record.entityId === 'string' ? record.entityId : '',
    slot: typeof record.slot === 'string' && record.slot.trim() !== '' ? record.slot : 'primary',
    objectKey: requiredString(record.objectKey, 'objectKey'),
    publicUrl: requiredString(record.publicUrl, 'publicUrl'),
    mimeType: requiredString(record.mimeType, 'mimeType'),
    sizeBytes: assertObjectBytes(record.sizeBytes),
    width: optionalDimension(record.width, 'width'),
    height: optionalDimension(record.height, 'height'),
    format: requiredString(record.format, 'format'),
    originalFilename:
      typeof record.originalFilename === 'string' ? record.originalFilename : '',
  };
}

export function purgeExpiredReservations(): number {
  return withTransaction(() => purgeExpiredReservationsUnsafe());
}

export function getQuotaUsage(category: StorageCategory): QuotaUsage {
  assertCategory(category);

  return withTransaction(() => {
    purgeExpiredReservationsUnsafe();
    return computeUsage(category);
  });
}

export function getAllQuotaUsage(): AllQuotaUsage {
  return withTransaction(() => {
    purgeExpiredReservationsUnsafe();

    return {
      gallery: computeUsage('gallery'),
      asset: computeUsage('asset'),
    };
  });
}

export function reserveQuota(
  category: StorageCategory,
  bytes: number,
  entityType: string,
  entityId: string,
): QuotaReservation {
  assertCategory(category);
  assertReservationBytes(bytes);

  const reservationEntityType = requiredString(entityType, 'entityType');
  const reservationEntityId = typeof entityId === 'string' ? entityId : '';

  return withTransaction(() => {
    purgeExpiredReservationsUnsafe();

    const usage = computeUsage(category);

    if (bytes > usage.availableBytes) {
      throw new QuotaExceededError({
        category,
        requestedBytes: bytes,
        usedBytes: usage.usedBytes,
        reservedBytes: usage.reservedBytes,
        limitBytes: usage.limitBytes,
      });
    }

    const id = randomUUID();

    run(
      `INSERT INTO storage_reservations
         (id, storage_category, reserved_bytes, entity_type, entity_id, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
      [id, category, bytes, reservationEntityType, reservationEntityId, `+${RESERVATION_TTL_SECONDS} seconds`],
    );

    const row = one<ReservationRow>('SELECT * FROM storage_reservations WHERE id = ?', [id]);

    if (!row) {
      throw new Error('Failed to create storage reservation.');
    }

    return toReservation(row);
  });
}

export function releaseReservation(reservationId: string): boolean {
  if (typeof reservationId !== 'string' || reservationId.trim() === '') return false;

  return withTransaction(
    () => run('DELETE FROM storage_reservations WHERE id = ?', [reservationId]).changes > 0,
  );
}

export function commitObjectAndReleaseReservation(
  record: StorageObjectRecord,
  reservationId?: string,
): StorageObjectRow {
  const normalized = normalizeRecord(record);

  return withTransaction(() => {
    purgeExpiredReservationsUnsafe();

    const existing = one<{ size_bytes: number; status: StorageObjectStatus }>(
      'SELECT size_bytes, status FROM storage_objects WHERE object_id = ?',
      [normalized.objectId],
    );

    const existingBytes =
      existing && existing.status !== 'deleted' ? Number(existing.size_bytes) : 0;

    let reservation: ReservationRow | undefined;

    if (typeof reservationId === 'string' && reservationId.trim() !== '') {
      reservation = one<ReservationRow>('SELECT * FROM storage_reservations WHERE id = ?', [
        reservationId,
      ]);

      if (reservation && reservation.storage_category !== normalized.category) {
        throw new Error(
          `Reservation ${reservationId} belongs to ${reservation.storage_category}, not ${normalized.category}.`,
        );
      }
    }

    const reservedByThis = reservation ? Number(reservation.reserved_bytes) : 0;
    const usage = computeUsage(normalized.category);
    const usedBytes = usage.usedBytes - existingBytes;
    const reservedBytes = Math.max(0, usage.reservedBytes - reservedByThis);
    const projectedBytes = usedBytes + reservedBytes + normalized.sizeBytes;

    if (projectedBytes > usage.limitBytes) {
      throw new QuotaExceededError({
        category: normalized.category,
        requestedBytes: normalized.sizeBytes,
        usedBytes,
        reservedBytes,
        limitBytes: usage.limitBytes,
      });
    }

    run(
      `INSERT INTO storage_objects
         (object_id, storage_category, entity_type, entity_id, slot, object_key, public_url,
          mime_type, size_bytes, width, height, format, original_filename, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT(object_id) DO UPDATE SET
         storage_category = excluded.storage_category,
         entity_type = excluded.entity_type,
         entity_id = excluded.entity_id,
         slot = excluded.slot,
         object_key = excluded.object_key,
         public_url = excluded.public_url,
         mime_type = excluded.mime_type,
         size_bytes = excluded.size_bytes,
         width = excluded.width,
         height = excluded.height,
         format = excluded.format,
         original_filename = excluded.original_filename,
         status = 'active',
         deletion_attempts = 0,
         last_deletion_error = NULL,
         updated_at = datetime('now')`,
      [
        normalized.objectId,
        normalized.category,
        normalized.entityType,
        normalized.entityId,
        normalized.slot,
        normalized.objectKey,
        normalized.publicUrl,
        normalized.mimeType,
        normalized.sizeBytes,
        normalized.width,
        normalized.height,
        normalized.format,
        normalized.originalFilename,
      ],
    );

    if (reservation) {
      run('DELETE FROM storage_reservations WHERE id = ?', [reservation.id]);
    }

    const row = one<StorageObjectRow>('SELECT * FROM storage_objects WHERE object_id = ?', [
      normalized.objectId,
    ]);

    if (!row) {
      throw new Error('Failed to persist storage object.');
    }

    return row;
  });
}

export function markObjectPendingDeletion(objectId: string): boolean {
  const id = requiredString(objectId, 'objectId');

  return withTransaction(
    () =>
      run(
        `UPDATE storage_objects
            SET status = 'pending_deletion',
                updated_at = datetime('now')
          WHERE object_id = ?
            AND status <> 'deleted'`,
        [id],
      ).changes > 0,
  );
}

export function markObjectDeleted(objectId: string): boolean {
  const id = requiredString(objectId, 'objectId');

  return withTransaction(
    () =>
      run(
        `UPDATE storage_objects
            SET status = 'deleted',
                last_deletion_error = NULL,
                updated_at = datetime('now')
          WHERE object_id = ?`,
        [id],
      ).changes > 0,
  );
}

export function recordDeletionFailure(objectId: string, error: unknown): boolean {
  const id = requiredString(objectId, 'objectId');
  const message = errorMessage(error);

  return withTransaction(
    () =>
      run(
        `UPDATE storage_objects
            SET status = 'pending_deletion',
                deletion_attempts = deletion_attempts + 1,
                last_deletion_error = ?,
                updated_at = datetime('now')
          WHERE object_id = ?
            AND status <> 'deleted'`,
        [message, id],
      ).changes > 0,
  );
}
