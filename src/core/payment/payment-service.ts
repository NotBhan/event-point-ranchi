import { createHash, randomBytes } from 'node:crypto';
import type {
  PaymentGatewayProvider,
  PaymentProvider,
  CreateOrderResult,
  RefundResult,
  WebhookEventResult,
} from './types';
import { RazorpayProvider } from './providers/razorpay';
import { PhonePeProvider } from './providers/phonepe';
import {
  getBookingById,
  updateBookingFinancials,
  createPaymentRecord,
  getPaymentById,
  getPaymentByInternalRef,
  getPaymentByProviderOrder,
  updatePaymentVerification,
  recordWebhookEvent,
  findWebhookEvent,
  updateWebhookEventStatus,
  createRefundRecord,
  getRefundsByPaymentId,
  updateRefundStatus,
  createInvoiceRecord,
  getInvoiceByPaymentId,
  logAuditEvent,
  type PaymentRow,
  type BookingRow,
} from '../operational/service';
import { getNeonClient } from '../operational/neon-client';

export class PaymentService {
  private razorpay: RazorpayProvider;
  private phonepe: PhonePeProvider;

  constructor() {
    this.razorpay = new RazorpayProvider();
    this.phonepe = new PhonePeProvider();
  }

  public getProvider(name: PaymentGatewayProvider): PaymentProvider {
    if (name === 'razorpay') return this.razorpay;
    if (name === 'phonepe') return this.phonepe;
    throw new Error(`Unsupported payment provider: ${name}`);
  }

  public getDefaultProvider(): PaymentGatewayProvider {
    const configured = (
      process.env.PAYMENT_DEFAULT_PROVIDER ||
      (typeof import.meta !== 'undefined' && import.meta.env?.PAYMENT_DEFAULT_PROVIDER) ||
      'razorpay'
    ).toLowerCase();

    if (configured === 'phonepe' && this.phonepe.isConfigured()) return 'phonepe';
    if (this.razorpay.isConfigured()) return 'razorpay';
    if (this.phonepe.isConfigured()) return 'phonepe';
    return 'razorpay';
  }

  public getAvailableProviders(): Array<{ id: PaymentGatewayProvider; label: string; isConfigured: boolean }> {
    return [
      {
        id: 'razorpay',
        label: 'Razorpay (Cards, UPI, Netbanking, Wallets)',
        isConfigured: this.razorpay.isConfigured(),
      },
      {
        id: 'phonepe',
        label: 'PhonePe (UPI, QR, Cards, Netbanking)',
        isConfigured: this.phonepe.isConfigured(),
      },
    ];
  }

  /**
   * Initiate a booking payment (Advance, Partial, or Balance)
   */
  public async initiateBookingPayment(params: {
    bookingId: number;
    paymentType: 'advance' | 'partial' | 'balance';
    customAmountPaise?: number;
    provider?: PaymentGatewayProvider;
    originUrl: string;
  }): Promise<{
    order: CreateOrderResult;
    payment: PaymentRow;
    booking: BookingRow;
  }> {
    const booking = await getBookingById(params.bookingId);
    if (!booking) {
      throw new Error(`Booking #${params.bookingId} not found.`);
    }

    if (booking.status === 'cancelled') {
      throw new Error(`Booking #${params.bookingId} has been cancelled and cannot accept payments.`);
    }

    // Decimal-safe integer calculations (paise)
    const totalAmount = Number(booking.total_amount);
    const amountPaid = Number(booking.amount_paid);
    const advanceRequired = Number(booking.advance_amount) || Math.round(totalAmount * 0.25);
    const outstanding = Number(booking.outstanding_balance);

    let payableAmountPaise = 0;

    if (params.paymentType === 'advance') {
      if (amountPaid >= advanceRequired) {
        throw new Error('Booking advance has already been fulfilled. Please pay the remaining balance instead.');
      }
      payableAmountPaise = advanceRequired - amountPaid;
    } else if (params.paymentType === 'balance') {
      if (outstanding <= 0) {
        throw new Error('This booking is already fully paid.');
      }
      payableAmountPaise = outstanding;
    } else if (params.paymentType === 'partial') {
      const requested = Math.round(Number(params.customAmountPaise) || 0);
      if (requested <= 0) {
        throw new Error('Please enter a valid payment amount greater than ₹0.');
      }
      if (requested > outstanding) {
        throw new Error(`Payment amount (₹${(requested / 100).toLocaleString('en-IN')}) cannot exceed the outstanding balance of ₹${(outstanding / 100).toLocaleString('en-IN')}.`);
      }
      payableAmountPaise = requested;
    }

    if (payableAmountPaise <= 0) {
      throw new Error('Calculated payable amount is zero.');
    }

    const providerName = params.provider || this.getDefaultProvider();
    const provider = this.getProvider(providerName);

    // Fetch customer contact details from database
    const neon = getNeonClient();
    const custRes = await neon.query<{ name: string; phone: string; email: string }>(
      'SELECT name, phone, email FROM customers WHERE id = $1 LIMIT 1',
      [booking.customer_id]
    );
    const customer = custRes.rows[0] || {
      name: 'Valued Guest',
      phone: '9876543210',
      email: '',
    };

    // Generate tamper-proof internal transaction reference
    const uniqueNonce = randomBytes(4).toString('hex').toUpperCase();
    const internalRef = `EP_${booking.id}_${Date.now()}_${uniqueNonce}`;

    const origin = params.originUrl.replace(/\/+$/, '');
    const redirectUrl = `${origin}/payment/status?bookingId=${booking.id}&ref=${internalRef}`;
    const callbackUrl = `${origin}/api/payment/webhook/${providerName}`;

    // Create order with gateway
    const orderResult = await provider.createOrder({
      bookingId: booking.id,
      amountPaise: payableAmountPaise,
      currency: 'INR',
      customer,
      description: `${params.paymentType.toUpperCase()} Payment for Booking #${booking.id} (${booking.event_type})`,
      internalTransactionReference: internalRef,
      redirectUrl,
      callbackUrl,
    });

    // Record created payment in Neon database
    const paymentRecord = await createPaymentRecord({
      bookingId: booking.id,
      customerId: booking.customer_id,
      provider: providerName,
      providerOrderId: orderResult.orderId,
      internalTransactionReference: internalRef,
      paymentType: params.paymentType,
      amountPaise: payableAmountPaise,
      currency: 'INR',
      status: 'created',
      metadataJson: JSON.stringify({
        bookingId: booking.id,
        paymentType: params.paymentType,
        checkoutPayload: orderResult.instrumentPayload,
      }),
    });

    await logAuditEvent('payment_initiated', 'payment', String(paymentRecord.id), {
      bookingId: booking.id,
      provider: providerName,
      amountPaise: payableAmountPaise,
      reference: internalRef,
    });

    return {
      order: orderResult,
      payment: paymentRecord,
      booking,
    };
  }

  /**
   * Cryptographically verify gateway payment signature & fulfill booking
   */
  public async verifyAndFulfillPayment(params: {
    provider: PaymentGatewayProvider;
    orderId: string;
    paymentId?: string;
    signature?: string;
    rawBody?: string;
    checksum?: string;
    merchantTransactionId?: string;
  }): Promise<{
    success: boolean;
    payment: PaymentRow;
    booking: BookingRow;
    receiptNumber?: string;
    message: string;
  }> {
    const provider = this.getProvider(params.provider);

    // 1. Verify with Gateway
    const verification = await provider.verifyPayment(params);

    // 2. Locate internal payment record
    const internalRef = params.merchantTransactionId || params.orderId;
    let payment =
      (await getPaymentByProviderOrder(params.orderId)) ||
      (await getPaymentByInternalRef(internalRef));

    if (!payment && params.paymentId) {
      const neon = getNeonClient();
      const res = await neon.query<PaymentRow>(
        'SELECT * FROM payments WHERE provider_payment_id = $1 LIMIT 1',
        [params.paymentId]
      );
      payment = res.rows[0];
    }

    if (!payment) {
      throw new Error(`Payment record not found for Order ID: ${params.orderId}`);
    }

    const booking = await getBookingById(payment.booking_id);
    if (!booking) {
      throw new Error(`Booking #${payment.booking_id} not found.`);
    }

    // If verification failed
    if (!verification.isValid || verification.status === 'failed') {
      await updatePaymentVerification({
        id: payment.id,
        providerPaymentId: verification.providerPaymentId || params.paymentId,
        status: 'failed',
        failureCode: verification.failureCode || 'VERIFICATION_FAILED',
        failureDescription: verification.failureDescription || 'Payment signature or status invalid.',
      });

      await logAuditEvent('payment_failed', 'payment', String(payment.id), {
        reason: verification.failureDescription,
        code: verification.failureCode,
      });

      const updatedPayment = (await getPaymentById(payment.id)) || payment;
      return {
        success: false,
        payment: updatedPayment,
        booking,
        message: verification.failureDescription || 'Payment verification failed.',
      };
    }

    // 3. Prevent duplicate credit / double fulfillment
    if (payment.status === 'captured') {
      const invoice = await getInvoiceByPaymentId(payment.id);
      return {
        success: true,
        payment,
        booking,
        receiptNumber: invoice?.invoice_number,
        message: 'Payment has already been verified and processed.',
      };
    }

    // 4. Update payment status to captured
    await updatePaymentVerification({
      id: payment.id,
      providerPaymentId: verification.providerPaymentId,
      status: 'captured',
      paymentMethod: verification.paymentMethod,
      verifiedAt: new Date().toISOString(),
    });

    // 5. Update booking financials safely in Neon
    const totalAmount = Number(booking.total_amount);
    const prevAmountPaid = Number(booking.amount_paid);
    const newAmountPaid = prevAmountPaid + Number(payment.amount_paise);
    const newOutstanding = Math.max(0, totalAmount - newAmountPaid);

    let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'partially_paid';
    if (newOutstanding === 0) {
      paymentStatus = 'paid';
    } else if (newAmountPaid > 0) {
      paymentStatus = 'partially_paid';
    }

    // Advance payment unlocks confirmed state
    const bookingStatus =
      booking.status === 'draft' || booking.status === 'pending'
        ? 'confirmed'
        : booking.status;

    await updateBookingFinancials(
      booking.id,
      newAmountPaid,
      newOutstanding,
      paymentStatus,
      bookingStatus
    );

    // 6. Generate digital payment receipt
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const receiptNumber = `EPR-REC-${dateStr}-${booking.id}-${payment.id}`;

    const neon = getNeonClient();
    const custRes = await neon.query<{ name: string; phone: string; email: string; address: string }>(
      'SELECT name, phone, email, address FROM customers WHERE id = $1 LIMIT 1',
      [booking.customer_id]
    );
    const customer = custRes.rows[0] || {
      name: 'Customer',
      phone: '',
      email: '',
      address: '',
    };

    await createInvoiceRecord({
      bookingId: booking.id,
      paymentId: payment.id,
      invoiceNumber: receiptNumber,
      invoiceType: 'receipt',
      taxableAmountPaise: payment.amount_paise,
      totalAmountPaise: payment.amount_paise,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      customerAddress: customer.address,
    });

    await logAuditEvent('payment_captured', 'payment', String(payment.id), {
      bookingId: booking.id,
      amountPaise: payment.amount_paise,
      receiptNumber,
      newOutstanding,
    });

    const refreshedPayment = (await getPaymentById(payment.id)) || payment;
    const refreshedBooking = (await getBookingById(booking.id)) || booking;

    return {
      success: true,
      payment: refreshedPayment,
      booking: refreshedBooking,
      receiptNumber,
      message: 'Payment verified and booking successfully confirmed!',
    };
  }

  /**
   * Idempotent webhook event processing
   */
  public async handleWebhook(
    providerName: PaymentGatewayProvider,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): Promise<{ status: string; eventId?: string; message: string }> {
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    // 1. Verify webhook signature via provider
    const provider = this.getProvider(providerName);
    const eventResult: WebhookEventResult = await provider.verifyWebhook({ headers, rawBody });

    if (!eventResult.isValid) {
      await recordWebhookEvent({
        provider: providerName,
        eventType: 'verification_failed',
        payloadHash,
        rawPayload: rawBody.slice(0, 1000),
        processingStatus: 'failed',
        errorMessage: eventResult.errorMessage,
      });

      throw new Error(`Webhook validation failed: ${eventResult.errorMessage}`);
    }

    // 2. Check for duplicate event (idempotency check)
    if (eventResult.eventId) {
      const existing = await findWebhookEvent(providerName, eventResult.eventId);
      if (existing && existing.processing_status === 'processed') {
        return {
          status: 'success',
          eventId: eventResult.eventId,
          message: 'Webhook event already processed previously (idempotent duplicate).',
        };
      }
    }

    // 3. Record webhook event in DB
    const webhookRow = await recordWebhookEvent({
      provider: providerName,
      providerEventId: eventResult.eventId,
      eventType: eventResult.eventType,
      payloadHash,
      rawPayload: rawBody,
      processingStatus: 'pending',
    });

    try {
      // 4. Handle event types
      if (eventResult.status === 'captured') {
        if (eventResult.orderId || eventResult.paymentId) {
          await this.verifyAndFulfillPayment({
            provider: providerName,
            orderId: eventResult.orderId || '',
            paymentId: eventResult.paymentId,
          });
        }
      } else if (eventResult.status === 'refunded') {
        // Mark refund processed if provider confirms
        if (eventResult.paymentId) {
          const refunds = await getRefundsByPaymentId(Number(eventResult.paymentId));
          for (const r of refunds) {
            if (r.status === 'processing' || r.status === 'pending') {
              await updateRefundStatus(r.id, 'processed');
            }
          }
        }
      }

      await updateWebhookEventStatus(webhookRow.id, 'processed');

      return {
        status: 'success',
        eventId: eventResult.eventId,
        message: 'Webhook processed successfully.',
      };
    } catch (err) {
      await updateWebhookEventStatus(webhookRow.id, 'failed', (err as Error).message);
      throw err;
    }
  }

  /**
   * Initiate full or partial refund
   */
  public async initiateRefund(params: {
    paymentId: number;
    amountPaise: number;
    reason: string;
    initiatedByUserId?: number;
  }): Promise<{
    refund: RefundResult;
    payment: PaymentRow;
    booking: BookingRow;
  }> {
    const payment = await getPaymentById(params.paymentId);
    if (!payment) {
      throw new Error(`Payment #${params.paymentId} not found.`);
    }

    if (payment.status !== 'captured' && payment.status !== 'partially_refunded') {
      throw new Error(`Payment #${params.paymentId} is in "${payment.status}" state and cannot be refunded.`);
    }

    const booking = await getBookingById(payment.booking_id);
    if (!booking) {
      throw new Error(`Associated booking #${payment.booking_id} not found.`);
    }

    const amountToRefund = Math.round(Number(params.amountPaise) || 0);
    if (amountToRefund <= 0) {
      throw new Error('Refund amount must be greater than ₹0.');
    }

    // Check existing refunds to prevent refunding more than captured amount
    const existingRefunds = await getRefundsByPaymentId(payment.id);
    const totalAlreadyRefunded = existingRefunds
      .filter((r) => r.status === 'processed' || r.status === 'processing')
      .reduce((sum, r) => sum + Number(r.amount_paise), 0);

    const maxRefundable = Number(payment.amount_paise) - totalAlreadyRefunded;
    if (amountToRefund > maxRefundable) {
      throw new Error(
        `Refund amount (₹${(amountToRefund / 100).toLocaleString('en-IN')}) exceeds remaining refundable amount (₹${(maxRefundable / 100).toLocaleString('en-IN')}).`
      );
    }

    const provider = this.getProvider(payment.provider);
    const refundRef = `RFND_${payment.id}_${Date.now()}`;

    // Create DB refund record in pending status
    const dbRefund = await createRefundRecord({
      paymentId: payment.id,
      bookingId: booking.id,
      amountPaise: amountToRefund,
      reason: params.reason,
      status: 'processing',
      initiatedBy: params.initiatedByUserId,
    });

    // Execute refund via provider API
    const refundResult = await provider.processRefund({
      provider: payment.provider,
      providerPaymentId: payment.provider_payment_id || payment.internal_transaction_reference,
      amountPaise: amountToRefund,
      reason: params.reason,
      internalRefundReference: refundRef,
    });

    if (!refundResult.success) {
      await updateRefundStatus(dbRefund.id, 'failed', undefined, refundResult.failureReason);
      throw new Error(`Provider refund failed: ${refundResult.failureReason}`);
    }

    await updateRefundStatus(dbRefund.id, refundResult.status, refundResult.providerRefundId);

    // Update payment record status
    const newTotalRefunded = totalAlreadyRefunded + amountToRefund;
    const isFullRefund = newTotalRefunded >= Number(payment.amount_paise);
    const newPaymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';

    const neon = getNeonClient();
    await neon.query('UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2', [
      newPaymentStatus,
      payment.id,
    ]);

    // Recalculate booking financials
    const newBookingAmountPaid = Math.max(0, Number(booking.amount_paid) - amountToRefund);
    const newBookingOutstanding = Number(booking.total_amount) - newBookingAmountPaid;
    const newBookingPaymentStatus =
      newBookingAmountPaid <= 0 ? 'unpaid' : 'partially_paid';

    await updateBookingFinancials(
      booking.id,
      newBookingAmountPaid,
      newBookingOutstanding,
      newBookingPaymentStatus
    );

    await logAuditEvent('refund_processed', 'refund', String(dbRefund.id), {
      paymentId: payment.id,
      bookingId: booking.id,
      amountPaise: amountToRefund,
      reason: params.reason,
    });

    const refreshedPayment = (await getPaymentById(payment.id)) || payment;
    const refreshedBooking = (await getBookingById(booking.id)) || booking;

    return {
      refund: refundResult,
      payment: refreshedPayment,
      booking: refreshedBooking,
    };
  }
}

let paymentServiceInstance: PaymentService | null = null;

export function getPaymentService(): PaymentService {
  if (!paymentServiceInstance) {
    paymentServiceInstance = new PaymentService();
  }
  return paymentServiceInstance;
}
