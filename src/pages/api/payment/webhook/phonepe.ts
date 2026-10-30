import type { APIRoute } from 'astro';
import { getPaymentService } from '../../../../core/payment/payment-service';

export const POST: APIRoute = async ({ request }) => {
  try {
    const rawBody = await request.text();

    const headers: Record<string, string> = {};
    for (const [k, v] of request.headers.entries()) {
      headers[k.toLowerCase()] = v;
    }

    const paymentService = getPaymentService();
    const result = await paymentService.handleWebhook('phonepe', headers, rawBody);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[PhonePe Webhook Error]:', error.message);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error.message || 'PhonePe webhook processing failed.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
