import type { APIRoute } from 'astro';
import { getPaymentService } from '../../../core/payment/payment-service';

export const POST: APIRoute = async ({ request }) => {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON request.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { provider, orderId, paymentId, signature, merchantTransactionId } = body;

    if (!provider || (!orderId && !merchantTransactionId && !paymentId)) {
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Provider and Order/Transaction identifier are required.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const paymentService = getPaymentService();
    const result = await paymentService.verifyAndFulfillPayment({
      provider,
      orderId: orderId || merchantTransactionId,
      paymentId,
      signature,
      merchantTransactionId,
    });

    if (!result.success) {
      return new Response(
        JSON.stringify({
          status: 'failed',
          message: result.message,
          payment: result.payment,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 'success',
        message: result.message,
        receiptNumber: result.receiptNumber,
        booking: {
          id: result.booking.id,
          status: result.booking.status,
          amountPaid: result.booking.amount_paid,
          outstandingBalance: result.booking.outstanding_balance,
          paymentStatus: result.booking.payment_status,
        },
        payment: {
          id: result.payment.id,
          amountPaise: result.payment.amount_paise,
          provider: result.payment.provider,
          status: result.payment.status,
          internalReference: result.payment.internal_transaction_reference,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[API /api/payment/verify error]:', error.message);
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error.message || 'Payment verification failed.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
