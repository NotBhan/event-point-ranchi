import type { APIRoute } from 'astro';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getFilebaseClient } from '../../core/storage/filebase';
import { INITIAL_STORAGE_OBJECTS } from '../../core/storage/initial-storage-objects';
import { parseTransformParams, renderTransformedImage, transformCacheKey } from '../../core/image/transform';
import { getRenderedImage, storeRenderedImage } from '../../core/image/cache';

const IMMUTABLE_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable';

// Index once instead of a linear scan per request.
const localObjectIndex = new Map(INITIAL_STORAGE_OBJECTS.map((object) => [object.object_key, object]));

function localCandidates(normalized: string): string[] {
  const entry = localObjectIndex.get(normalized);
  const candidates: string[] = [];
  if (entry?.original_filename) {
    candidates.push(
      join(process.cwd(), 'data/archive', entry.original_filename),
      join(process.cwd(), 'data/uploads/gallery', entry.original_filename),
      join(process.cwd(), 'data/uploads', entry.original_filename),
      join(process.cwd(), 'public/images/archive', entry.original_filename),
      join(process.cwd(), 'public/images', entry.original_filename),
    );
  }
  candidates.push(join(process.cwd(), 'data/uploads', normalized));
  return candidates;
}

function findLocalFile(normalized: string): string | null {
  for (const candidate of localCandidates(normalized)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function localEtag(path: string): string {
  const stat = statSync(path);
  return `"local-${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.avif')) return 'image/avif';
  return 'image/jpeg';
}

function serveNotModified(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: { etag, 'cache-control': IMMUTABLE_CACHE },
  });
}

function serveImage(
  body: BodyInit,
  contentType: string,
  etag: string,
  ifNoneMatch: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  if (ifNoneMatch && ifNoneMatch === etag) return serveNotModified(etag);

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      etag,
      'cache-control': IMMUTABLE_CACHE,
      ...(body instanceof Uint8Array ? { 'content-length': String(body.byteLength) } : {}),
      ...extraHeaders,
    },
  });
}

async function loadOriginal(normalized: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const client = getFilebaseClient();
  const object = await client.getObject(normalized);
  if (object) {
    return { buffer: Buffer.from(object.body), contentType: object.contentType || 'image/webp' };
  }

  const localPath = findLocalFile(normalized);
  if (!localPath) return null;
  return { buffer: readFileSync(localPath), contentType: contentTypeFor(localPath) };
}

export const GET: APIRoute = async ({ params, request }) => {
  const key = params.path;
  if (!key) {
    return new Response('Not Found', { status: 404 });
  }

  // Guard against path traversal
  const normalized = key.replace(/^\/+/, '');
  if (normalized.includes('..')) {
    return new Response('Forbidden', { status: 403 });
  }

  const ifNoneMatch = request.headers.get('if-none-match');
  const transform = parseTransformParams(new URL(request.url).searchParams);
  const client = getFilebaseClient();

  try {
    // 1. On-demand resized/encoded variants (cached in-process, immutable URLs).
    if (transform) {
      const cacheKey = transformCacheKey(normalized, transform);
      const cached = getRenderedImage(cacheKey);
      if (cached) {
        return serveImage(cached.data as unknown as BodyInit, cached.contentType, cached.etag, ifNoneMatch, {
          'x-image-cache': 'hit',
        });
      }

      const original = await loadOriginal(normalized);
      if (!original) return new Response('Not Found', { status: 404 });

      try {
        const rendered = await renderTransformedImage(original.buffer, transform);
        const stored = storeRenderedImage(cacheKey, rendered);
        return serveImage(stored.data as unknown as BodyInit, stored.contentType, stored.etag, ifNoneMatch, {
          'x-image-cache': 'miss',
        });
      } catch {
        // Unsupported input for sharp → serve the original untouched.
        return serveImage(
          original.buffer as unknown as BodyInit,
          original.contentType,
          `"orig-${normalized.length}"`,
          ifNoneMatch,
          { 'x-image-cache': 'fallback' },
        );
      }
    }

    // 2. Originals: stream from Filebase and honour If-None-Match at the source.
    const streamed = await client.getObjectStream(normalized, { ifNoneMatch: ifNoneMatch ?? undefined });
    if (streamed) {
      if (streamed.notModified) return serveNotModified(streamed.etag);
      const headers: Record<string, string> = {
        'content-type': streamed.contentType || 'image/webp',
        etag: streamed.etag,
        'cache-control': IMMUTABLE_CACHE,
        'x-image-cache': 'stream',
      };
      if (typeof streamed.size === 'number') headers['content-length'] = String(streamed.size);
      return new Response(streamed.stream as unknown as BodyInit, { status: 200, headers });
    }

    // 3. Local fallback for pre-migrated objects or offline development.
    const localPath = findLocalFile(normalized);
    if (!localPath) {
      return new Response('Not Found', { status: 404 });
    }

    const etag = localEtag(localPath);
    if (ifNoneMatch && ifNoneMatch === etag) return serveNotModified(etag);

    const buffer = readFileSync(localPath);
    return serveImage(buffer as unknown as BodyInit, contentTypeFor(localPath), etag, ifNoneMatch, {
      'x-image-cache': 'local',
    });
  } catch (error) {
    console.warn('[storage] failed to serve object', normalized, error instanceof Error ? error.message : error);
    return new Response('Internal Server Error', { status: 500 });
  }
};
