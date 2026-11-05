import type { APIRoute } from 'astro';
import { resolveReceiptLookup } from '../../../../../core/documents/receipt-access';
import { getEnquiryReceiptService } from '../../../../../core/operational/enquiry-receipt-service';

/**
 * Dedicated one-page A4 download. The HTML receipt remains the canonical
 * on-screen document; this endpoint produces a file without opening another page.
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

  const service = getEnquiryReceiptService(url.origin);
  const receipt = await service.getEnquiryReceiptData(lookup.key, url.origin);
  if (!receipt) {
    return new Response(JSON.stringify({ error: 'Receipt not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const pdf = await service.generateEnquiryReceiptPdf(receipt);
  const filename = `Event-Point-${receipt.enquiry.referenceCode.replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`;
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
