import { randomUUID } from 'node:crypto';
import { all, one } from '../db';
import { formatBytes, getStorageConfig } from './config';
import {
  getFilebaseClient,
  type FilebaseClient,
  type StorageDriver,
  type StoredObject,
} from './filebase';
import { optimizeImage, type ImageInput, type ImageKind } from './optimizer';
import {
  commitObjectAndReleaseReservation,
  getAllQuotaUsage,
  getQuotaUsage,
  markObjectDeleted,
  markObjectPendingDeletion,
  recordDeletionFailure,
  releaseReservation,
  reserveQuota,
  type QuotaUsage,
  type QuotaWarningLevel,
  type StorageCategory,
  type StorageObjectRecord,
  type StorageObjectRow,
  type StorageObjectStatus,
} from './quota';

export { ImageValidationError } from './optimizer';
export { QuotaExceededError } from './quota';

export const DEFAULT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SLOT = 'primary';
const ENTITY_ID_MAX_LENGTH = 96;
const SLOT_MAX_LENGTH = 64;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MANAGED_PREFIXES = ['gallery/', 'assets/'] as const;
const OBJECT_FILE_EXTENSIONS = new Set(['webp', 'png', 'svg']);

const ASSET_FOLDERS = {
  mandap: 'mandaps',
  stage: 'stages',
  catering: 'catering',
  furniture: 'furniture',
  equipment: 'equipment',
  hall: 'halls',
  room: 'rooms',
  branding: 'branding',
  banner: 'banners',
} as const;

const ASSET_FOLDER_NAMES = new Set<string>(Object.values(ASSET_FOLDERS));

export type GalleryEntityType = 'gallery' | 'gallery_item';
export type AssetEntityType = keyof typeof ASSET_FOLDERS;
export type ImageEntityType = GalleryEntityType | AssetEntityType;
export type StorageImageInput = ImageInput | Blob;

export interface ImageEntityRef {
  entityType: ImageEntityType;
  entityId?: string | number;
  slot?: string;
}

export interface UploadImageOptions extends ImageEntityRef {
  filename?: string;
}

export interface ReplaceImageOptions {
  filename?: string;
}

export type ReplaceImageTarget = string | ImageEntityRef;

export interface ImageStorageServiceOptions {
  client?: FilebaseClient;
}

export interface StoredImage {
  objectId: string;
  category: StorageCategory;
  entityType: string;
  entityId: string;
  slot: string;
  key: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  format: string;
  originalFilename: string;
  status: StorageObjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ImageCleanupResult {
  succeeded: boolean;
  pendingDeletion: boolean;
  error?: string;
}

export interface ReplaceImageResult {
  replacementSucceeded: true;
  cleanupSucceeded: boolean;
  cleanupPending: boolean;
  object: StoredImage;
  previousObject: StoredImage;
  cleanup: ImageCleanupResult;
}

export type DeleteImageStatus = 'deleted' | 'pending_deletion' | 'not_found';

export interface DeleteImageResult {
  objectId: string;
  objectKey: string;
  status: DeleteImageStatus;
  alreadyDeleted: boolean;
  error?: string;
}

export interface StorageUsageSummary {
  gallery: QuotaUsage;
  asset: QuotaUsage;
  totalLimitBytes: number;
  totalUsedBytes: number;
  totalReservedBytes: number;
  totalAvailableBytes: number;
  usagePercent: number;
  level: QuotaWarningLevel;
  objectCount: number;
  pendingDeletionCount: number;
  formattedUsedBytes: string;
  formattedLimitBytes: string;
  driver: StorageDriver;
  isConfigured: boolean;
}

export interface RetryPendingDeletionsOptions {
  limit?: number;
}

export interface PendingDeletionError {
  objectId: string;
  objectKey: string;
  error: string;
}

export interface RetryPendingDeletionsReport {
  attempted: number;
  deleted: number;
  failed: number;
  errors: PendingDeletionError[];
}

export interface ReconcileStorageOptions {
  orphanGraceMs?: number;
  dryRun?: boolean;
  now?: Date;
}

export interface ReconcileStorageError {
  objectKey: string;
  error: string;
}

export interface ReconcileStorageReport {
  dryRun: boolean;
  orphanGraceMs: number;
  scannedObjects: number;
  knownObjects: number;
  unknownObjectsSkipped: number;
  orphanObjectsFound: number;
  orphanObjectsRetained: number;
  orphanObjectsDeleted: number;
  orphanObjectsFailed: number;
  deletedRecordObjectsPurged: number;
  missingObjects: Array<{
    objectId: string;
    objectKey: string;
    status: StorageObjectStatus;
  }>;
  pendingDeletions: RetryPendingDeletionsReport;
  pendingDeletionsRemaining: number;
  errors: ReconcileStorageError[];
}

export type ImageStorageErrorCode =
  | 'invalid_entity_type'
  | 'entity_id_required'
  | 'active_image_exists'
  | 'object_not_found'
  | 'active_image_not_found'
  | 'invalid_replace_target'
  | 'upload_verification_failed';

export interface ImageStorageErrorDetails {
  objectId?: string;
  objectKey?: string;
  cause?: unknown;
}

export class ImageStorageError extends Error {
  readonly code: ImageStorageErrorCode;
  readonly objectId?: string;
  readonly objectKey?: string;

  constructor(
    code: ImageStorageErrorCode,
    message: string,
    details: ImageStorageErrorDetails = {},
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = 'ImageStorageError';
    this.code = code;
    this.objectId = details.objectId;
    this.objectKey = details.objectKey;
  }
}

interface EntityDescriptor {
  entityType: string;
  entityId: string;
  category: StorageCategory;
  folder: string;
  slot: string;
  kind: ImageKind;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}

function normalizePathSegment(
  value: string | number | null | undefined,
  maxLength: number,
): string {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  return raw
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
    .slice(0, maxLength);
}

function normalizeSlot(value?: string): string {
  return normalizePathSegment(value, SLOT_MAX_LENGTH) || DEFAULT_SLOT;
}

function isAssetEntityType(value: string): value is AssetEntityType {
  return Object.prototype.hasOwnProperty.call(ASSET_FOLDERS, value);
}

function resolveEntityDescriptor(
  entityType: ImageEntityType,
  entityIdInput: string | number | null | undefined,
  slotInput?: string,
): EntityDescriptor {
  const entityId = normalizePathSegment(entityIdInput, ENTITY_ID_MAX_LENGTH);
  const slot = normalizeSlot(slotInput);

  if (entityType === 'gallery' || entityType === 'gallery_item') {
    if (!entityId) {
      throw new ImageStorageError(
        'entity_id_required',
        'A gallery item id is required to store a gallery image.',
      );
    }

    return {
      entityType: 'gallery',
      entityId,
      category: 'gallery',
      folder: 'gallery',
      slot,
      kind: 'gallery',
    };
  }

  if (!isAssetEntityType(entityType)) {
    throw new ImageStorageError(
      'invalid_entity_type',
      `Unknown storage entity type: ${String(entityType)}.`,
    );
  }

  if (!entityId && entityType !== 'branding' && entityType !== 'banner') {
    throw new ImageStorageError(
      'entity_id_required',
      `An entity id is required to store a ${entityType} image.`,
    );
  }

  return {
    entityType,
    entityId,
    category: 'asset',
    folder: ASSET_FOLDERS[entityType],
    slot,
    kind: entityType === 'branding' ? 'logo' : 'asset',
  };
}

function descriptorForRow(row: StorageObjectRow): EntityDescriptor {
  return resolveEntityDescriptor(
    row.entity_type as ImageEntityType,
    row.entity_id,
    row.slot,
  );
}

function buildObjectKey(
  descriptor: EntityDescriptor,
  objectId: string,
  extension: string,
): string {
  const filename = `${objectId}.${extension}`;

  if (descriptor.category === 'gallery') {
    return `gallery/${descriptor.entityId}/${filename}`;
  }

  const base = `assets/${descriptor.folder}`;
  return descriptor.entityId
    ? `${base}/${descriptor.entityId}/${filename}`
    : `${base}/${filename}`;
}

function publicUrlFor(key: string): string {
  const base = getStorageConfig().publicBaseUrl.replace(/\/+$/, '');
  return base ? `${base}/${key}` : `/${key}`;
}

function toStoredImage(row: StorageObjectRow): StoredImage {
  return {
    objectId: row.object_id,
    category: row.storage_category,
    entityType: row.entity_type,
    entityId: row.entity_id,
    slot: row.slot,
    key: row.object_key,
    publicUrl: row.public_url,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    format: row.format,
    originalFilename: row.original_filename,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function prepareImageInput(
  input: StorageImageInput,
  explicitFilename?: string,
): Promise<{ data: ImageInput; filename: string }> {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const data = new Uint8Array(await input.arrayBuffer());
    const filename =
      explicitFilename?.trim() ||
      (typeof File !== 'undefined' && input instanceof File ? input.name : '');

    return { data, filename };
  }

  return { data: input as ImageInput, filename: explicitFilename?.trim() ?? '' };
}

function isObjectFileName(fileName: string): boolean {
  const separator = fileName.lastIndexOf('.');
  if (separator <= 0) return false;

  const extension = fileName.slice(separator + 1).toLowerCase();
  return OBJECT_FILE_EXTENSIONS.has(extension);
}

function isManagedObjectKey(key: string): boolean {
  const segments = key.split('/');

  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return false;
  }

  if (segments[0] === 'gallery') {
    return segments.length === 3 && isObjectFileName(segments[2]);
  }

  if (segments[0] === 'assets') {
    if (segments.length !== 3 && segments.length !== 4) return false;
    if (!ASSET_FOLDER_NAMES.has(segments[1])) return false;

    return isObjectFileName(segments[segments.length - 1]);
  }

  return false;
}

function countPendingDeletionRows(): number {
  const row = one<{ count: number | null }>(
    "SELECT COUNT(*) AS count FROM storage_objects WHERE status = 'pending_deletion'",
  );

  return Number(row?.count ?? 0);
}

function summaryWarningLevel(
  totalBytes: number,
  limitBytes: number,
): QuotaWarningLevel {
  if (limitBytes <= 0) return 'blocked';
  if (totalBytes >= limitBytes) return 'blocked';
  if (totalBytes * 100 >= limitBytes * 95) return 'critical';
  if (totalBytes * 100 >= limitBytes * 80) return 'warning';
  return 'ok';
}

function summaryUsagePercent(totalBytes: number, limitBytes: number): number {
  if (limitBytes <= 0) return totalBytes > 0 ? 100 : 0;
  return Math.round((totalBytes / limitBytes) * 10_000) / 100;
}

export class ImageStorageService {
  private readonly clientOverride: FilebaseClient | undefined;

  constructor(options: ImageStorageServiceOptions = {}) {
    this.clientOverride = options.client;
  }

  private get client(): FilebaseClient {
    return this.clientOverride ?? getFilebaseClient();
  }

  async uploadImage(
    input: StorageImageInput,
    options: UploadImageOptions,
  ): Promise<StoredImage> {
    const descriptor = resolveEntityDescriptor(
      options.entityType,
      options.entityId,
      options.slot,
    );

    this.assertSlotAvailable(descriptor);

    const prepared = await prepareImageInput(input, options.filename);
    const optimized = await optimizeImage(prepared.data, { kind: descriptor.kind });
    const objectId = randomUUID();
    const key = buildObjectKey(descriptor, objectId, optimized.extension);

    return this.storeOptimizedImage(
      descriptor,
      objectId,
      key,
      optimized,
      prepared.filename,
    );
  }

  async replaceImage(
    target: ReplaceImageTarget,
    input: StorageImageInput,
    options: ReplaceImageOptions = {},
  ): Promise<ReplaceImageResult> {
    const previousRow = this.resolveReplacementTarget(target);
    const descriptor = descriptorForRow(previousRow);
    const prepared = await prepareImageInput(input, options.filename);
    const optimized = await optimizeImage(prepared.data, { kind: descriptor.kind });
    const objectId = randomUUID();
    const key = buildObjectKey(descriptor, objectId, optimized.extension);

    const stored = await this.storeOptimizedImage(
      descriptor,
      objectId,
      key,
      optimized,
      prepared.filename,
    );
    const cleanup = await this.cleanupRow(previousRow);

    return {
      replacementSucceeded: true,
      cleanupSucceeded: cleanup.succeeded,
      cleanupPending: cleanup.pendingDeletion,
      object: stored,
      previousObject: toStoredImage(previousRow),
      cleanup,
    };
  }

  async deleteImage(objectId: string): Promise<DeleteImageResult> {
    if (typeof objectId !== 'string' || objectId.trim() === '') {
      throw new TypeError('objectId is required.');
    }

    const id = objectId.trim();
    const row = one<StorageObjectRow>(
      'SELECT * FROM storage_objects WHERE object_id = ?',
      [id],
    );

    if (!row) {
      return {
        objectId: id,
        objectKey: '',
        status: 'not_found',
        alreadyDeleted: false,
      };
    }

    if (row.status === 'deleted') {
      return {
        objectId: row.object_id,
        objectKey: row.object_key,
        status: 'deleted',
        alreadyDeleted: true,
      };
    }

    const cleanup = await this.cleanupRow(row);

    return {
      objectId: row.object_id,
      objectKey: row.object_key,
      status: cleanup.succeeded ? 'deleted' : 'pending_deletion',
      alreadyDeleted: false,
      error: cleanup.error,
    };
  }

  getStorageUsage(): StorageUsageSummary;
  getStorageUsage(category: StorageCategory): QuotaUsage;
  getStorageUsage(category?: StorageCategory): StorageUsageSummary | QuotaUsage {
    if (category !== undefined) {
      return getQuotaUsage(category);
    }

    const usage = getAllQuotaUsage();
    const totalLimitBytes = usage.gallery.limitBytes + usage.asset.limitBytes;
    const totalUsedBytes = usage.gallery.usedBytes + usage.asset.usedBytes;
    const totalReservedBytes =
      usage.gallery.reservedBytes + usage.asset.reservedBytes;
    const totalAccountedBytes = totalUsedBytes + totalReservedBytes;

    return {
      gallery: usage.gallery,
      asset: usage.asset,
      totalLimitBytes,
      totalUsedBytes,
      totalReservedBytes,
      totalAvailableBytes: Math.max(0, totalLimitBytes - totalAccountedBytes),
      usagePercent: summaryUsagePercent(totalAccountedBytes, totalLimitBytes),
      level: summaryWarningLevel(totalAccountedBytes, totalLimitBytes),
      objectCount: usage.gallery.objectCount + usage.asset.objectCount,
      pendingDeletionCount: countPendingDeletionRows(),
      formattedUsedBytes: formatBytes(totalUsedBytes),
      formattedLimitBytes: formatBytes(totalLimitBytes),
      driver: this.client.driver,
      isConfigured: getStorageConfig().isConfigured,
    };
  }

  async retryPendingDeletions(
    options: RetryPendingDeletionsOptions = {},
  ): Promise<RetryPendingDeletionsReport> {
    if (
      options.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) || options.limit <= 0)
    ) {
      throw new RangeError('limit must be a positive integer.');
    }

    const rows = this.pendingDeletionRows(options.limit);
    const report: RetryPendingDeletionsReport = {
      attempted: rows.length,
      deleted: 0,
      failed: 0,
      errors: [],
    };

    for (const row of rows) {
      try {
        await this.client.deleteObject(row.object_key);
        markObjectDeleted(row.object_id);
        report.deleted += 1;
      } catch (error) {
        try {
          recordDeletionFailure(row.object_id, error);
        } catch {
          // The object stays pending_deletion and will be retried later.
        }

        report.failed += 1;
        report.errors.push({
          objectId: row.object_id,
          objectKey: row.object_key,
          error: errorMessage(error),
        });
      }
    }

    return report;
  }

  async reconcileStorage(
    options: ReconcileStorageOptions = {},
  ): Promise<ReconcileStorageReport> {
    const dryRun = options.dryRun === true;
    const orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;

    if (!Number.isFinite(orphanGraceMs) || orphanGraceMs < 0) {
      throw new RangeError('orphanGraceMs must be a non-negative number.');
    }

    const nowMs = options.now ? options.now.getTime() : Date.now();
    if (!Number.isFinite(nowMs)) {
      throw new RangeError('now must be a valid date.');
    }

    const pendingDeletions = dryRun
      ? { attempted: 0, deleted: 0, failed: 0, errors: [] }
      : await this.retryPendingDeletions();

    const rows = all<StorageObjectRow>('SELECT * FROM storage_objects');
    const rowsByKey = new Map(rows.map((row) => [row.object_key, row]));
    const objects = await this.listManagedObjects();
    const listedKeys = new Set<string>();

    const report: ReconcileStorageReport = {
      dryRun,
      orphanGraceMs,
      scannedObjects: objects.length,
      knownObjects: 0,
      unknownObjectsSkipped: 0,
      orphanObjectsFound: 0,
      orphanObjectsRetained: 0,
      orphanObjectsDeleted: 0,
      orphanObjectsFailed: 0,
      deletedRecordObjectsPurged: 0,
      missingObjects: [],
      pendingDeletions,
      pendingDeletionsRemaining: 0,
      errors: [],
    };

    for (const object of objects) {
      listedKeys.add(object.key);

      if (!isManagedObjectKey(object.key)) {
        report.unknownObjectsSkipped += 1;
        continue;
      }

      const row = rowsByKey.get(object.key);

      if (row) {
        if (row.status === 'pending_deletion') {
          continue;
        }

        if (row.status === 'deleted') {
          if (dryRun) {
            report.deletedRecordObjectsPurged += 1;
            continue;
          }

          try {
            await this.client.deleteObject(object.key);
            report.deletedRecordObjectsPurged += 1;
          } catch (error) {
            report.errors.push({
              objectKey: object.key,
              error: errorMessage(error),
            });
          }

          continue;
        }

        report.knownObjects += 1;
        continue;
      }

      report.orphanObjectsFound += 1;

      const lastModifiedMs =
        object.lastModified instanceof Date
          ? object.lastModified.getTime()
          : Number.NaN;

      if (!Number.isFinite(lastModifiedMs)) {
        report.orphanObjectsRetained += 1;
        continue;
      }

      if (nowMs - lastModifiedMs < orphanGraceMs) {
        report.orphanObjectsRetained += 1;
        continue;
      }

      if (dryRun) {
        report.orphanObjectsDeleted += 1;
        continue;
      }

      try {
        await this.client.deleteObject(object.key);
        report.orphanObjectsDeleted += 1;
      } catch (error) {
        report.orphanObjectsFailed += 1;
        report.errors.push({
          objectKey: object.key,
          error: errorMessage(error),
        });
      }
    }

    for (const row of rows) {
      if (row.status === 'deleted') continue;
      if (listedKeys.has(row.object_key)) continue;

      report.missingObjects.push({
        objectId: row.object_id,
        objectKey: row.object_key,
        status: row.status,
      });
    }

    report.pendingDeletionsRemaining = countPendingDeletionRows();

    return report;
  }

  private assertSlotAvailable(descriptor: EntityDescriptor): void {
    if (!descriptor.entityId) return;

    const existing = one<{ object_id: string; object_key: string }>(
      `SELECT object_id, object_key
         FROM storage_objects
        WHERE entity_type = ?
          AND entity_id = ?
          AND slot = ?
          AND status IN ('active', 'pending_replacement')
        LIMIT 1`,
      [descriptor.entityType, descriptor.entityId, descriptor.slot],
    );

    if (!existing) return;

    throw new ImageStorageError(
      'active_image_exists',
      `An active ${descriptor.entityType} image already exists for this slot. Use replaceImage() to swap it safely.`,
      { objectId: existing.object_id, objectKey: existing.object_key },
    );
  }

  private resolveReplacementTarget(target: ReplaceImageTarget): StorageObjectRow {
    if (typeof target === 'string') {
      const objectId = target.trim();
      if (!objectId) {
        throw new ImageStorageError(
          'invalid_replace_target',
          'A storage object id is required.',
        );
      }

      const row = one<StorageObjectRow>(
        'SELECT * FROM storage_objects WHERE object_id = ?',
        [objectId],
      );

      if (!row || row.status === 'deleted') {
        throw new ImageStorageError(
          'object_not_found',
          `Storage object ${objectId} was not found.`,
          { objectId },
        );
      }

      return row;
    }

    if (!target || typeof target !== 'object') {
      throw new ImageStorageError(
        'invalid_replace_target',
        'Replacement target must be an object id or an entity reference.',
      );
    }

    const descriptor = resolveEntityDescriptor(
      target.entityType,
      target.entityId,
      target.slot,
    );

    if (!descriptor.entityId) {
      throw new ImageStorageError(
        'invalid_replace_target',
        'An object id is required to replace a global image that has no entity id.',
      );
    }

    const row = this.findActiveRow(
      descriptor.entityType,
      descriptor.entityId,
      descriptor.slot,
    );

    if (!row) {
      throw new ImageStorageError(
        'active_image_not_found',
        `No active image exists for ${descriptor.entityType}:${descriptor.entityId} (slot "${descriptor.slot}").`,
      );
    }

    return row;
  }

  private findActiveRow(
    entityType: string,
    entityId: string,
    slot: string,
  ): StorageObjectRow | undefined {
    return one<StorageObjectRow>(
      `SELECT *
         FROM storage_objects
        WHERE entity_type = ?
          AND entity_id = ?
          AND slot = ?
          AND status IN ('active', 'pending_replacement')
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [entityType, entityId, slot],
    );
  }

  private async storeOptimizedImage(
    descriptor: EntityDescriptor,
    objectId: string,
    key: string,
    optimized: Awaited<ReturnType<typeof optimizeImage>>,
    filename: string,
  ): Promise<StoredImage> {
    const record: StorageObjectRecord = {
      objectId,
      category: descriptor.category,
      entityType: descriptor.entityType,
      entityId: descriptor.entityId,
      slot: descriptor.slot,
      objectKey: key,
      publicUrl: publicUrlFor(key),
      mimeType: optimized.contentType,
      sizeBytes: optimized.size,
      width: optimized.width,
      height: optimized.height,
      format: optimized.extension,
      originalFilename: filename,
    };

    const reservation = reserveQuota(
      descriptor.category,
      optimized.size,
      descriptor.entityType,
      descriptor.entityId,
    );

    let uploaded = false;

    try {
      await this.client.putObject({
        key,
        body: optimized.buffer,
        contentType: optimized.contentType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        metadata: {
          'object-id': objectId,
          'storage-category': descriptor.category,
        },
      });
      uploaded = true;

      const stored = await this.client.headObject(key);

      if (!stored) {
        throw new ImageStorageError(
          'upload_verification_failed',
          `Uploaded object ${key} could not be verified.`,
          { objectId, objectKey: key },
        );
      }

      if (stored.size !== optimized.size) {
        throw new ImageStorageError(
          'upload_verification_failed',
          `Uploaded object ${key} has an unexpected size (${stored.size} bytes, expected ${optimized.size}).`,
          { objectId, objectKey: key },
        );
      }

      const row = commitObjectAndReleaseReservation(record, reservation.id);
      return toStoredImage(row);
    } catch (error) {
      if (uploaded) {
        try {
          await this.client.deleteObject(key);
        } catch {
          // Orphaned uploads are reclaimed by reconcileStorage() after the grace period.
        }
      }

      try {
        releaseReservation(reservation.id);
      } catch {
        // Reservation expiry will clean it up.
      }

      throw error;
    }
  }

  private async cleanupRow(row: StorageObjectRow): Promise<ImageCleanupResult> {
    try {
      markObjectPendingDeletion(row.object_id);
    } catch (error) {
      return {
        succeeded: false,
        pendingDeletion: false,
        error: errorMessage(error),
      };
    }

    try {
      await this.client.deleteObject(row.object_key);
      markObjectDeleted(row.object_id);

      return { succeeded: true, pendingDeletion: false };
    } catch (error) {
      try {
        recordDeletionFailure(row.object_id, error);
      } catch {
        // The record keeps its previous state and is retried later.
      }

      return {
        succeeded: false,
        pendingDeletion: true,
        error: errorMessage(error),
      };
    }
  }

  private pendingDeletionRows(limit?: number): StorageObjectRow[] {
    const limitClause = limit === undefined ? '' : ' LIMIT ?';

    return all<StorageObjectRow>(
      `SELECT *
         FROM storage_objects
        WHERE status = 'pending_deletion'
        ORDER BY updated_at ASC, id ASC${limitClause}`,
      limit === undefined ? [] : [limit],
    );
  }

  private async listManagedObjects(): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];

    for (const prefix of MANAGED_PREFIXES) {
      let continuationToken: string | undefined;

      do {
        const page = await this.client.listObjects({
          prefix,
          maxKeys: 1_000,
          continuationToken,
        });

        objects.push(...page.objects);

        if (!page.isTruncated || !page.nextContinuationToken) break;
        continuationToken = page.nextContinuationToken;
      } while (continuationToken);
    }

    return objects;
  }
}

export const imageStorage = new ImageStorageService();
