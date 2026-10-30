import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider,
  PaymentGatewayProvider,
  CreateOrderParams,
  CreateOrderResult,
  VerifyPaymentParams,
  VerifyPaymentResult,
  RefundParams,
  RefundResult,
  WebhookVerificationParams,
  WebhookEventResult,
} from '../types';

export class RazorpayProvider implements PaymentProvider {
  public readonly name: PaymentGatewayProvider = 'razorpay';
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private baseUrl = 'https://api.razorpay.com/v1';

  constructor(config?: { keyId?: string; keySecret?: string; webhookSecret?: string }) {
    this.keyId =
      config?.keyId ||
      process.env.RAZORPAY_KEY_ID ||
      (typeof import.meta !== 'undefined' && import.meta.env?.RAZORPAY_KEY_ID) ||
      '';
    this.keySecret =
      config?.keySecret ||
      process.env.RAZORPAY_KEY_SECRET ||
      (typeof import.meta !== 'undefined' && import.meta.env?.RAZORPAY_KEY_SECRET) ||
      '';
    this.webhookSecret =
      config?.webhookSecret ||
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      (typeof import.meta !== 'undefined' && import.meta.env?.RAZORPAY_WEBHOOK_SECRET) ||
      '';
  }

  public isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  private getAuthHeader(): string {
    const creds = `${this.keyId}:${this.keySecret}`;
    return `Basic ${Buffer.from(creds).toString('base64')}`;
  }

  /**
   * Create Razorpay Order on server
   */
  public async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (!this.isConfigured()) {
      throw new Error('[Razorpay] Gateway credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) are not configured.');
    }

    const payload = {
      amount: Math.round(params.amountPaise),
      currency: params.currency || 'INR',
      receipt: params.internalTransactionReference.slice(0, 40),
      notes: {
        bookingId: String(params.bookingId),
        customerPhone: params.customer.phone,
        customerName: params.customer.name,
        internalRef: params.internalTransactionReference,
      },
    };

    const response = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.description || data?.error?.message || response.statusText;
      throw new Error(`[Razorpay Order Error] ${errorMsg}`);
    }

    return {
      provider: 'razorpay',
      orderId: data.id,
      amountPaise: Number(data.amount),
      currency: data.currency,
      keyId: this.keyId,
      internalReference: params.internalTransactionReference,
      instrumentPayload: {
        orderId: data.id,
        amount: data.amount,
        currency: data.currency,
        name: 'Event Point Ranchi',
        description: params.description,
        prefill: {
          name: params.customer.name,
          email: params.customer.email || '',
          contact: params.customer.phone,
        },
        notes: data.notes,
      },
    };
  }

  /**
   * Verify signature and confirm capture
   */
  public async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    if (!this.isConfigured()) {
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId: params.paymentId || '',
        amountPaise: 0,
        failureCode: 'GATEWAY_NOT_CONFIGURED',
        failureDescription: 'Razorpay credentials not configured.',
      };
    }

    const { orderId, paymentId, signature } = params;

    if (!orderId || !paymentId || !signature) {
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId: paymentId || '',
        amountPaise: 0,
        failureCode: 'MISSING_VERIFICATION_FIELDS',
        failureDescription: 'Order ID, Payment ID, and Signature are required for Razorpay verification.',
      };
    }

    // 1. Verify HMAC-SHA256 signature
    const text = `${orderId}|${paymentId}`;
    const expectedSignature = createHmac('sha256', this.keySecret).update(text).digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId: paymentId,
        amountPaise: 0,
        failureCode: 'INVALID_SIGNATURE',
        failureDescription: 'Cryptographic signature mismatch. Possible tampering or forgery detected.',
      };
    }

    // 2. Query Razorpay API to confirm capture status and details
    return this.getPaymentStatus(paymentId, orderId);
  }

  /**
   * Query payment status directly from Razorpay
   */
  public async getPaymentStatus(providerPaymentId: string, providerOrderId?: string): Promise<VerifyPaymentResult> {
    if (!this.isConfigured()) {
      throw new Error('[Razorpay] Gateway not configured.');
    }

    const response = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(providerPaymentId)}`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
      },
    });

    const payment = await response.json();

    if (!response.ok) {
      const errorMsg = payment?.error?.description || payment?.error?.message || response.statusText;
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId,
        amountPaise: 0,
        failureCode: payment?.error?.code || 'FETCH_ERROR',
        failureDescription: errorMsg,
      };
    }

    if (providerOrderId && payment.order_id && payment.order_id !== providerOrderId) {
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId,
        amountPaise: Number(payment.amount) || 0,
        failureCode: 'ORDER_MISMATCH',
        failureDescription: `Payment belongs to order ${payment.order_id}, expected ${providerOrderId}.`,
      };
    }

    // If payment is authorized but not captured, capture it
    if (payment.status === 'authorized') {
      try {
        const captureRes = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(providerPaymentId)}/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.getAuthHeader(),
          },
          body: JSON.stringify({
            amount: payment.amount,
            currency: payment.currency || 'INR',
          }),
        });
        const capturedData = await captureRes.json();
        if (captureRes.ok) {
          return {
            isValid: true,
            status: 'captured',
            providerPaymentId: capturedData.id,
            amountPaise: Number(capturedData.amount),
            paymentMethod: capturedData.method,
            rawResponse: capturedData,
          };
        }
      } catch (err) {
        console.warn('[Razorpay] Auto-capture failed:', (err as Error).message);
      }
    }

    const isCaptured = payment.status === 'captured';

    return {
      isValid: isCaptured,
      status: isCaptured ? 'captured' : payment.status === 'refunded' ? 'refunded' : 'pending',
      providerPaymentId: payment.id,
      amountPaise: Number(payment.amount) || 0,
      paymentMethod: payment.method || undefined,
      failureCode: payment.error_code || undefined,
      failureDescription: payment.error_description || undefined,
      rawResponse: payment,
    };
  }

  /**
   * Process refund via Razorpay API
   */
  public async processRefund(params: RefundParams): Promise<RefundResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerRefundId: '',
        amountPaise: params.amountPaise,
        status: 'failed',
        failureReason: 'Razorpay credentials not configured.',
      };
    }

    const payload = {
      amount: Math.round(params.amountPaise),
      notes: {
        reason: params.reason,
        refundRef: params.internalRefundReference,
      },
    };

    const response = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(params.providerPaymentId)}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.error?.description || data?.error?.message || response.statusText;
      return {
        success: false,
        providerRefundId: '',
        amountPaise: params.amountPaise,
        status: 'failed',
        failureReason: errorMsg,
        rawResponse: data,
      };
    }

    return {
      success: true,
      providerRefundId: data.id,
      amountPaise: Number(data.amount) || params.amountPaise,
      status: data.status === 'processed' ? 'processed' : 'processing',
      rawResponse: data,
    };
  }

  /**
   * Verify Webhook payload and HMAC signature
   */
  public async verifyWebhook(params: WebhookVerificationParams): Promise<WebhookEventResult> {
    const signature =
      params.headers['x-razorpay-signature'] ||
      params.headers['X-Razorpay-Signature'];

    if (!signature || typeof signature !== 'string') {
      return {
        isValid: false,
        provider: 'razorpay',
        eventId: '',
        eventType: 'unknown',
        rawPayload: {},
        errorMessage: 'Missing X-Razorpay-Signature header in webhook delivery.',
      };
    }

    if (!this.webhookSecret) {
      return {
        isValid: false,
        provider: 'razorpay',
        eventId: '',
        eventType: 'unknown',
        rawPayload: {},
        errorMessage: 'RAZORPAY_WEBHOOK_SECRET is not configured on server.',
      };
    }

    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(params.rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return {
        isValid: false,
        provider: 'razorpay',
        eventId: '',
        eventType: 'unknown',
        rawPayload: {},
        errorMessage: 'Invalid webhook signature.',
      };
    }

    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(params.rawBody);
    } catch {
      return {
        isValid: false,
        provider: 'razorpay',
        eventId: '',
        eventType: 'unknown',
        rawPayload: {},
        errorMessage: 'Failed to parse JSON webhook body.',
      };
    }

    const eventType = payload.event || 'unknown';
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;
    const refundEntity = payload.payload?.refund?.entity;

    const eventId = payload.account_id ? `${payload.event}_${paymentEntity?.id || refundEntity?.id || Date.now()}` : `rzp_evt_${Date.now()}`;

    let status: any = 'pending';
    if (eventType === 'payment.captured') status = 'captured';
    else if (eventType === 'payment.failed') status = 'failed';
    else if (eventType === 'refund.processed') status = 'refunded';

    return {
      isValid: true,
      provider: 'razorpay',
      eventId,
      eventType,
      orderId: paymentEntity?.order_id || orderEntity?.id,
      paymentId: paymentEntity?.id || refundEntity?.payment_id,
      amountPaise: paymentEntity?.amount || refundEntity?.amount,
      status,
      rawPayload: payload,
    };
  }
}
