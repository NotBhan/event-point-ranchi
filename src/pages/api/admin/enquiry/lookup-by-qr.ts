import type { APIRoute } from 'astro';
import { getEnquiryQrService } from '../../../../core/operational/enquiry-qr-service';

export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.auth?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Admin access required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = url.searchParams.get('token') || url.searchParams.get('ref') || url.searchParams.get('input') || '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token or reference code parameter.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const qrService = getEnquiryQrService(url.origin);
  const result = await qrService.lookupEnquiry(token);

  if (!result.found) {
    return new Response(JSON.stringify({ success: false, error: result.error || 'Enquiry not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, enquiry: result.enquiry }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!locals.auth?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Admin access required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const input = body.token || body.ref || body.input || '';
  if (!input) {
    return new Response(JSON.stringify({ error: 'Missing token or reference code input in body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const qrService = getEnquiryQrService(url.origin);
  const result = await qrService.lookupEnquiry(input);

  if (!result.found) {
    return new Response(JSON.stringify({ success: false, error: result.error || 'Enquiry not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, enquiry: result.enquiry }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
