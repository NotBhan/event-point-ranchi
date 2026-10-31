import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../db';

export interface RenderedImage {
  data: Buffer;
  contentType: string;
  etag: string;
}

interface CacheEntry extends RenderedImage {
  size: number;
}

interface ImageCacheState {
  entries: Map<string, CacheEntry>;
  bytes: number;
  writes: number;
}

interface ImageCacheScope {
  __eventPointImageCache?: ImageCacheState;
}

const scope = globalThis as typeof globalThis & ImageCacheScope;

const MAX_BYTES = (() => {
  const configured = Number(process.env.IMAGE_CACHE_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 64 * 1024 * 1024;
})();

const MAX_ENTRY_BYTES = Math.max(1024 * 1024, Math.floor(MAX_BYTES / 4));

const DISK_CACHE_BYTES = (() => {
  const configured = Number(process.env.IMAGE_DISK_CACHE_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 256 * 1024 * 1024;
})();
const DISK_SWEEP_EVERY = 50;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
};

function state(): ImageCacheState {
  if (!scope.__eventPointImageCache) {
    scope.__eventPointImageCache = { entries: new Map(), bytes: 0, writes: 0 };
  }
  return scope.__eventPointImageCache;
}

function diskDir(): string {
  return join(dataDir(), 'cache', 'images');
}

function diskPath(key: string): string {
  return join(diskDir(), `${hashCacheKey(key)}`);
}

export function hashCacheKey(key: string): string {
  return createHash('md5').update(key).digest('hex').slice(0, 20);
}

function readDiskEntry(key: string): { data: Buffer; contentType: string } | null {
  for (const extension of ['webp', 'avif', 'jpg']) {
    const file = `${diskPath(key)}.${extension}`;
    if (!existsSync(file)) continue;
    try {
      const data = readFileSync(file);
      const contentType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
      return { data, contentType };
    } catch {
      return null;
    }
  }
  return null;
}

function sweepDiskCache(): void {
  const dir = diskDir();
  if (!existsSync(dir)) return;

  try {
    const files = readdirSync(dir)
      .map((name) => {
        const path = join(dir, name);
        const stats = statSync(path);
        return { path, size: stats.size, mtimeMs: stats.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (total <= DISK_CACHE_BYTES) break;
      try {
        unlinkSync(file.path);
        total -= file.size;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort sweep */
  }
}

function writeDiskEntry(key: string, data: Buffer, contentType: string): void {
  try {
    mkdirSync(diskDir(), { recursive: true });
    const extension = EXTENSION_BY_TYPE[contentType] ?? 'bin';
    writeFileSync(`${diskPath(key)}.${extension}`, data);

    const cacheState = state();
    cacheState.writes += 1;
    if (cacheState.writes % DISK_SWEEP_EVERY === 0) sweepDiskCache();
  } catch {
    /* disk cache is optional */
  }
}

export function getRenderedImage(key: string): RenderedImage | undefined {
  const cache = state();
  const entry = cache.entries.get(key);

  if (entry) {
    // Refresh LRU position.
    cache.entries.delete(key);
    cache.entries.set(key, entry);
    return { data: entry.data, contentType: entry.contentType, etag: entry.etag };
  }

  // Fall back to the on-disk cache (survives dev/preview restarts and makes
  // repeated localhost media loads effectively free).
  const diskEntry = readDiskEntry(key);
  if (!diskEntry) return undefined;

  const hydrated = storeRenderedImage(key, diskEntry, { persist: false });
  return hydrated;
}

export function storeRenderedImage(
  key: string,
  image: { data: Buffer; contentType: string },
  options: { persist?: boolean } = {},
): RenderedImage {
  const cache = state();
  const etag = `W/"img-${hashCacheKey(key)}"`;
  const size = image.data.byteLength;

  if (size <= MAX_ENTRY_BYTES) {
    const existing = cache.entries.get(key);
    if (existing) {
      cache.bytes -= existing.size;
      cache.entries.delete(key);
    }
    cache.entries.set(key, { data: image.data, contentType: image.contentType, etag, size });
    cache.bytes += size;

    while (cache.bytes > MAX_BYTES) {
      const oldestKey = cache.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = cache.entries.get(oldestKey);
      if (!oldest) break;
      cache.bytes -= oldest.size;
      cache.entries.delete(oldestKey);
    }
  }

  if (options.persist !== false) {
    writeDiskEntry(key, image.data, image.contentType);
  }

  return { data: image.data, contentType: image.contentType, etag };
}

export function imageCacheStats(): { entries: number; bytes: number; maxBytes: number; diskCacheBytes: number } {
  const cache = state();
  return {
    entries: cache.entries.size,
    bytes: cache.bytes,
    maxBytes: MAX_BYTES,
    diskCacheBytes: DISK_CACHE_BYTES,
  };
}
