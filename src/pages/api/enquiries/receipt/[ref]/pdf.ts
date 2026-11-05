import type { APIRoute } from 'astro';
import { resolveReceiptLookup } from '../../../../../core/documents/receipt-access';

/**
 * The old enquiry PDF was a second, divergent document format. Keep the path
 * for bookmarks, but send it to the canonical printer-friendly document.
 */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const ref = params.ref || url.searchParams.get('ref') || '';
  const token = url.searchParams.get('token') || '';
  const lookup = resolveReceiptLookup(ref, token, Boolean(locals.adminAuth?.isAdmin));

  if (!lookup.allowed) {
    return new Response(JSON.stringify({ error: 'A secure document token is required.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const target = new URL(`/receipts/enquiry/${encodeURIComponent(ref)}`, url.origin);
  if (token) target.searchParams.set('token', token);
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
  });
};
