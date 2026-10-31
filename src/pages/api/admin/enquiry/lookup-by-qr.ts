import type { APIRoute } from 'astro';
import { getEnquiryQrService } from '../../../../core/operational/enquiry-qr-service';
import { logAuditEvent } from '../../../../core/operational/service';

export const POST: APIRoute = async ({ request, locals, url }) => {
  // 1. RBAC Authentication Check
  if (!locals.auth?.isAdmin) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized. Admin credentials required to scan enquiries.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: { input?: string } = {};
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON request payload.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawInput = body.input?.trim();
  if (!rawInput) {
    return new Response(
      JSON.stringify({ success: false, error: 'Empty QR code or reference input provided.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const qrService = getEnquiryQrService(url.origin);
    const result = await qrService.lookupEnquiry(rawInput);

    if (!result.found || !result.enquiry) {
      return new Response(
        JSON.stringify({
          success: false,
          error: result.error || `No customer enquiry found matching "${rawInput.slice(0, 40)}".`,
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Audit Trail
    try {
      await logAuditEvent(
        'ENQUIRY_QR_SCAN',
        'enquiry',
        String(result.enquiry.id),
        {
          referenceCode: result.enquiry.referenceCode,
          customerName: result.enquiry.customerName,
          inputLength: rawInput.length,
          hasToken: Boolean(result.qrToken),
          scannerUserId: locals.auth?.user?.id,
        },
        locals.auth?.user?.id
      );
    } catch (auditErr) {
      console.warn('[QR Scan Audit Warning]:', auditErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        enquiry: result.enquiry,
        token: result.qrToken,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[Admin QR Lookup Exception]:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred during QR verification.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
