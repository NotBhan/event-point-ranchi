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
    const result = await paymentService.handleWebhook('razorpay', headers, rawBody);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Razorpay Webhook Error]:', error.message);
    // Returning 400 when signature fails so Razorpay records the invalid signature attempt
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error.message || 'Webhook processing failed.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
