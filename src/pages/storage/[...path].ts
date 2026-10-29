import type { APIRoute } from 'astro';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getFilebaseClient } from '../../core/storage/filebase';
import { INITIAL_STORAGE_OBJECTS } from '../../core/storage/initial-storage-objects';

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

  const client = getFilebaseClient();
  const ifNoneMatch = request.headers.get('if-none-match');

  try {
    let body: Uint8Array | null = null;
    let contentType = 'image/webp';
    let etagHeader = '';
    let size = 0;

    const obj = await client.getObject(normalized);
    if (obj) {
      body = obj.body;
      contentType = obj.contentType || 'image/webp';
      etagHeader = `"${obj.etag.replace(/"/g, '')}"`;
      size = obj.size;
    } else {
      // Local fallback for pre-migrated objects or offline development
      const entry = INITIAL_STORAGE_OBJECTS.find((o) => o.object_key === normalized);
      let localPath = '';
      if (entry && entry.original_filename) {
        const candidatePaths = [
          join(process.cwd(), 'public/images/archive', entry.original_filename),
          join(process.cwd(), 'public/images', entry.original_filename),
          join(process.cwd(), 'data/uploads/gallery', entry.original_filename),
          join(process.cwd(), 'data/uploads', entry.original_filename),
        ];
        for (const p of candidatePaths) {
          if (existsSync(p)) {
            localPath = p;
            break;
          }
        }
      }
      if (!localPath) {
        const directCandidate = join(process.cwd(), 'data/uploads', normalized);
        if (existsSync(directCandidate)) {
          localPath = directCandidate;
        }
      }

      if (!localPath) {
        return new Response('Not Found', { status: 404 });
      }

      const buffer = readFileSync(localPath);
      body = buffer;
      size = buffer.byteLength;
      etagHeader = `"${createHash('md5').update(buffer).digest('hex')}"`;
      contentType = localPath.endsWith('.png')
        ? 'image/png'
        : localPath.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
    }

    if (ifNoneMatch && ifNoneMatch === etagHeader) {
      return new Response(null, {
        status: 304,
        headers: {
          'etag': etagHeader,
          'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        },
      });
    }

    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-length': String(size),
        'etag': etagHeader,
        'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      },
    });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
};
