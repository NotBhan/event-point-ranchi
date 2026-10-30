import type { APIRoute } from 'astro';
import { getPaymentService } from '../../../core/payment/payment-service';
import type { PaymentGatewayProvider } from '../../../core/payment/types';

export const POST: APIRoute = async ({ request, url }) => {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON request body.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bookingId = Number(body.bookingId);
    if (!bookingId || isNaN(bookingId)) {
      return new Response(JSON.stringify({ status: 'error', message: 'Valid bookingId is required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const paymentType = body.paymentType || 'advance';
    if (!['advance', 'partial', 'balance'].includes(paymentType)) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'paymentType must be "advance", "partial", or "balance".' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const customAmountPaise = body.customAmountPaise ? Number(body.customAmountPaise) : undefined;
    const provider: PaymentGatewayProvider = 'phonepe';

    const originUrl = url.origin || `${url.protocol}//${url.host}`;

    const paymentService = getPaymentService();
    const result = await paymentService.initiateBookingPayment({
      bookingId,
      paymentType,
      customAmountPaise,
      provider,
      originUrl,
    });

    return new Response(
      JSON.stringify({
        status: 'success',
        order: result.order,
        paymentId: result.payment.id,
        internalReference: result.payment.internal_transaction_reference,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[API /api/payment/create-order error]:', error.message);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error.message || 'Failed to initiate payment.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
