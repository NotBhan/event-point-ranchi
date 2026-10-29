import type { APIRoute } from 'astro';
import { getFilebaseClient } from '../../core/storage/filebase';

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
    const obj = await client.getObject(normalized);
    if (!obj) {
      return new Response('Not Found', { status: 404 });
    }

    const etagHeader = `"${obj.etag.replace(/"/g, '')}"`;
    if (ifNoneMatch && (ifNoneMatch === etagHeader || ifNoneMatch === obj.etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          'etag': etagHeader,
          'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        },
      });
    }

    return new Response(obj.body as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': obj.contentType || 'image/webp',
        'content-length': String(obj.size),
        'etag': etagHeader,
        'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable',
      },
    });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
};
