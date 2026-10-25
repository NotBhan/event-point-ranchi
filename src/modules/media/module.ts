import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { defineModule } from '../../core/define-module';
import { json } from '../../core/http';
import { safeUploadPath, uploadPathFor } from '../../core/uploads';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

export default defineModule({
  id: 'media',
  label: 'Media',
  order: 95,
  api: [
    {
      path: '/uploads/:path*',
      method: 'GET',
      handle: ({ params }) => {
        const relative = safeUploadPath(params.path ?? '');
        if (!relative) return json({ status: 'error', message: 'Not found' }, 404);

        const filePath = uploadPathFor(relative);

        try {
          const stats = statSync(filePath);
          if (!stats.isFile()) return json({ status: 'error', message: 'Not found' }, 404);

          const body = new Uint8Array(readFileSync(filePath));
          return new Response(body, {
            status: 200,
            headers: {
              'content-type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
              'content-length': String(stats.size),
              'cache-control': 'public, max-age=31536000, immutable',
            },
          });
        } catch {
          return json({ status: 'error', message: 'Not found' }, 404);
        }
      },
    },
  ],
});
