import type { APIRoute } from 'astro';
import { getEnquiryReceiptService } from '../../../../../core/operational/enquiry-receipt-service';

export const GET: APIRoute = async ({ params, url }) => {
  const ref = params.ref || url.searchParams.get('ref') || '';
  const token = url.searchParams.get('token') || '';

  const lookupKey = token || ref;
  if (!lookupKey) {
    return new Response(
      JSON.stringify({ error: 'Missing enquiry reference or token.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const receiptService = getEnquiryReceiptService(url.origin);
  try {
    const receiptData = await receiptService.getEnquiryReceiptData(lookupKey, url.origin);
    if (!receiptData) {
      return new Response(
        JSON.stringify({ error: `Enquiry receipt "${lookupKey}" not found.` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const pdfBytes = await receiptService.generateEnquiryReceiptPdf(receiptData);
    const filename = `EventPoint-Enquiry-${receiptData.enquiry.referenceCode}.pdf`;

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('[Enquiry Receipt PDF Error]:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to generate enquiry PDF.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
