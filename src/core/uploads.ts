import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { uploadsDir } from './db';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
};

const MAX_BYTES = 8 * 1024 * 1024;

export class UploadError extends Error {}

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

export async function saveUploadedImage(
  form: FormData | null,
  field: string,
  folder: string,
): Promise<string | null> {
  const value = form?.get(field);
  if (!value || typeof value === 'string') return null;

  const file = value as File;
  if (!file.size) return null;

  const extension = MIME_EXTENSIONS[file.type];
  if (!extension) {
    throw new UploadError('Only JPG, PNG, WEBP, AVIF, GIF or SVG images are allowed.');
  }
  if (file.size > MAX_BYTES) {
    throw new UploadError('Images must be smaller than 8 MB.');
  }

  if (extension === '.svg') {
    const text = await file.text();
    if (/<script|onload=|onerror=/i.test(text)) {
      throw new UploadError('SVG uploads containing scripts are not allowed.');
    }
  }

  const folderPath = join(uploadsDir(), folder);
  mkdirSync(folderPath, { recursive: true });

  const fileName = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${extname(file.name).toLowerCase() || extension}`;
  writeFileSync(join(folderPath, fileName), Buffer.from(await file.arrayBuffer()));

  return `/uploads/${folder}/${fileName}`;
}
