import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { one, uploadsDir } from './db';
import type { QuotaUsage, StorageCategory } from './storage/quota';
import {
  imageStorage,
  type ImageEntityType,
  type StorageUsageSummary,
} from './storage/service';

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);

const FOLDER_ENTITY_TYPES: Record<string, ImageEntityType> = {
  gallery: 'gallery_item',
  gallery_item: 'gallery_item',
  gallery_items: 'gallery_item',
  mandap: 'mandap',
  mandaps: 'mandap',
  stage: 'stage',
  stages: 'stage',
  catering: 'catering',
  furniture: 'furniture',
  equipment: 'equipment',
  branding: 'branding',
  banner: 'banner',
  banners: 'banner',
  halls: 'banner',
  rooms: 'banner',
  content: 'banner',
};

export interface SaveUploadedImageOptions {
  entityType?: ImageEntityType;
  entityId?: string | number;
  slot?: string;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export function safeUploadPath(relativePath: string): string | null {
  const cleaned = relativePath
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

  if (!cleaned) return null;
  if (!/\.(jpe?g|png|webp|gif|avif|svg)$/i.test(cleaned)) return null;
  return cleaned;
}

export function uploadPathFor(relativePath: string): string {
  return join(uploadsDir(), relativePath);
}

function resolveEntityType(folder: string): ImageEntityType {
  const normalized = folder.trim().toLowerCase();
  return FOLDER_ENTITY_TYPES[normalized] ?? 'branding';
}

function resolveEntityId(
  form: FormData | null,
  field: string,
  entityType: ImageEntityType,
  options: SaveUploadedImageOptions,
): string | number | undefined {
  if (options.entityId !== undefined && String(options.entityId).trim() !== '') {
    return options.entityId;
  }

  const candidates = [`${field}_id`, 'item_id', 'entity_id', 'id', 'slug', 'key'];

  for (const candidate of candidates) {
    const value = form?.get(candidate);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  if (entityType === 'branding' || entityType === 'banner') return undefined;

  return `upload-${randomUUID()}`;
}

function existingPathForField(form: FormData | null, field: string): string {
  const hidden = form?.get(`${field}_path`);
  if (typeof hidden === 'string' && hidden.trim()) return hidden.trim();

  const value = form?.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function findStoredObjectId(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  const key = trimmed.replace(/^\/+/, '');
  const row = one<{ object_id: string }>(
    `SELECT object_id
       FROM storage_objects
      WHERE status <> 'deleted'
        AND (public_url = ? OR object_key = ?)
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [trimmed, key],
  );

  return row?.object_id ?? null;
}

function imageFileFrom(form: FormData | null, field: string): File | null {
  const value = form?.get(field);
  if (!value || typeof value === 'string') return null;
  if (typeof Blob === 'undefined' || !(value instanceof Blob)) return null;
  if (!value.size) return null;

  return value as File;
}

function assertSupportedImage(file: File): void {
  if (file.size > MAX_BYTES) {
    throw new UploadError('Images must be smaller than 8 MB.');
  }

  if (!ALLOWED_MIME_TYPES.has(file.type) && !(file.type === '' && /\.(jpe?g|png|webp|svg)$/i.test(file.name))) {
    throw new UploadError('Only JPG, PNG, WebP or SVG images are allowed.');
  }
}

export async function saveUploadedImage(
  form: FormData | null,
  field: string,
  folder: string,
  options: SaveUploadedImageOptions = {},
): Promise<string | null> {
  const file = imageFileFrom(form, field);
  if (!file) return null;

  assertSupportedImage(file);

  const filename = file.name || field;
  const existingObjectId = findStoredObjectId(existingPathForField(form, field));

  if (existingObjectId) {
    const result = await imageStorage.replaceImage(existingObjectId, file, { filename });
    return result.object.publicUrl;
  }

  const entityType = options.entityType ?? resolveEntityType(folder);
  const entityId = resolveEntityId(form, field, entityType, options);
  const stored = await imageStorage.uploadImage(file, {
    entityType,
    entityId,
    slot: options.slot ?? field,
    filename,
  });

  return stored.publicUrl;
}

export function getStorageUsage(): StorageUsageSummary;
export function getStorageUsage(category: StorageCategory): QuotaUsage;
export function getStorageUsage(
  category?: StorageCategory,
): StorageUsageSummary | QuotaUsage {
  return category === undefined
    ? imageStorage.getStorageUsage()
    : imageStorage.getStorageUsage(category);
}
