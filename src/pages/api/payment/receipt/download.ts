import type { APIRoute } from 'astro';
import { getReceiptService } from '../../../../core/payment/receipt-service';

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  const receiptNumber = url.searchParams.get('receiptNumber');
  const paymentIdParam = url.searchParams.get('paymentId');

  const receiptService = getReceiptService(url.origin);
  let receiptPayload = null;

  try {
    if (token) {
      receiptPayload = await receiptService.getReceiptByToken(token, url.origin);
    } else if (receiptNumber) {
      receiptPayload = await receiptService.getReceiptByNumber(receiptNumber, url.origin);
    } else if (paymentIdParam) {
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
