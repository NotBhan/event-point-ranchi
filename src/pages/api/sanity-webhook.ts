import type { APIRoute } from 'astro';
import { clearSanityCache } from '../../core/sanity/client';
import { getSanityConfig } from '../../core/sanity/config';

export const POST: APIRoute = async ({ request }) => {
  const config = getSanityConfig();

  // If a webhook secret is configured, verify the signature or bearer token
  if (config.webhookSecret) {
    const authHeader = request.headers.get('authorization') || '';
    const secretHeader = request.headers.get('sanity-webhook-secret') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (token !== config.webhookSecret && secretHeader !== config.webhookSecret) {
      return new Response(JSON.stringify({ status: 'error', message: 'Unauthorized webhook secret' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // Purge the in-memory cache so subsequent requests fetch freshly published content immediately
  clearSanityCache();

  return new Response(
    JSON.stringify({
      status: 'ok',
      revalidated: true,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
};

export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ status: 'error', message: 'Method Not Allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json', Allow: 'POST' },
  });
};
