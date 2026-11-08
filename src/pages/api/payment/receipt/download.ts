import type { APIRoute } from 'astro';
import { paymentsEnabled } from '../../../../core/features';

export const GET: APIRoute = async ({ url, locals }) => {
  if (!paymentsEnabled()) return notFound();
  const { getReceiptService } = await import('../../../../core/payment/receipt-service');
  const token = url.searchParams.get('token')?.trim();
  const receiptNumber = url.searchParams.get('receiptNumber')?.trim();
  const paymentIdParam = url.searchParams.get('paymentId')?.trim();
  const isAdmin = Boolean(locals.adminAuth?.isAdmin);

  // Require a cryptographic token for public access; looking up by sequential
  // paymentId or receiptNumber without a token is restricted to administrators.
  if (!token && !isAdmin) {
    return new Response(
      JSON.stringify({ error: 'A secure document token or administrator credentials are required.' }),
      { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  const receiptService = getReceiptService(url.origin);
  let receiptPayload = null;

  try {
    if (token) {
      receiptPayload = await receiptService.getReceiptByToken(token, url.origin);
    } else if (isAdmin && receiptNumber) {
      receiptPayload = await receiptService.getReceiptByNumber(receiptNumber, url.origin);
    } else if (isAdmin && paymentIdParam) {
      const pId = Number(paymentIdParam);
      if (!isNaN(pId) && pId > 0) {
        receiptPayload = await receiptService.getOrCreateReceipt(pId, url.origin);
      }
    }

    if (!receiptPayload) {
      return new Response(
        JSON.stringify({ error: 'Receipt not found or invalid token.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const pdfBytes = await receiptService.generatePdfBuffer(receiptPayload);
    const filename = `${receiptPayload.receipt.receipt_number}.pdf`;

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('[Receipt PDF Download Error]:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate receipt PDF.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Not found.' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
