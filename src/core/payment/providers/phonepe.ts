import { createHash, timingSafeEqual } from 'node:crypto';
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

export class PhonePeProvider implements PaymentProvider {
  public readonly name: PaymentGatewayProvider = 'phonepe';
  private merchantId: string;
  private saltKey: string;
  private saltIndex: string;
  private environment: 'sandbox' | 'production';
  private baseUrl: string;

  constructor(config?: {
    merchantId?: string;
    saltKey?: string;
    saltIndex?: string;
    environment?: 'sandbox' | 'production';
  }) {
    this.merchantId =
      config?.merchantId ||
      process.env.PHONEPE_MERCHANT_ID ||
      (typeof import.meta !== 'undefined' && import.meta.env?.PHONEPE_MERCHANT_ID) ||
      '';
    this.saltKey =
      config?.saltKey ||
      process.env.PHONEPE_SALT_KEY ||
      (typeof import.meta !== 'undefined' && import.meta.env?.PHONEPE_SALT_KEY) ||
      '';
    this.saltIndex =
      config?.saltIndex ||
      process.env.PHONEPE_SALT_INDEX ||
      (typeof import.meta !== 'undefined' && import.meta.env?.PHONEPE_SALT_INDEX) ||
      '1';

    const env =
      config?.environment ||
      process.env.PHONEPE_ENV ||
      (typeof import.meta !== 'undefined' && import.meta.env?.PHONEPE_ENV) ||
      'sandbox';

    this.environment = env === 'production' ? 'production' : 'sandbox';
    this.baseUrl =
      this.environment === 'production'
        ? 'https://api.phonepe.com/apis/hermes'
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  }

  public isConfigured(): boolean {
    return Boolean(this.merchantId && this.saltKey && this.saltIndex);
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Create PhonePe payment request and hosted checkout redirect URL
   */
  public async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (!this.isConfigured()) {
      throw new Error('[PhonePe] Gateway credentials (PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY, PHONEPE_SALT_INDEX) are not configured.');
    }

    // PhonePe transaction ID must be alphanumeric and max 35 chars
    const merchantTransactionId = params.internalTransactionReference.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 35);
    const merchantUserId = `CUST_${params.customer.phone.replace(/\D/g, '') || params.bookingId}`;

    const requestPayload = {
      merchantId: this.merchantId,
      merchantTransactionId,
      merchantUserId,
      amount: Math.round(params.amountPaise),
      redirectUrl: params.redirectUrl,
      redirectMode: 'POST',
      callbackUrl: params.callbackUrl,
      mobileNumber: params.customer.phone.replace(/\D/g, '').slice(-10),
      paymentInstrument: {
        type: 'PAY_PAGE',
      },
    };

    const base64Payload = Buffer.from(JSON.stringify(requestPayload)).toString('base64');
    const apiEndpoint = '/pg/v1/pay';
    const checksum = `${this.sha256(base64Payload + apiEndpoint + this.saltKey)}###${this.saltIndex}`;

    const response = await fetch(`${this.baseUrl}${apiEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data?.message || response.statusText;
      throw new Error(`[PhonePe Order Error] ${errorMsg}`);
    }

    const redirectUrl =
      data.data?.instrumentResponse?.redirectInfo?.url ||
      data.data?.redirectInfo?.url;

    return {
      provider: 'phonepe',
      orderId: merchantTransactionId,
      amountPaise: Math.round(params.amountPaise),
      currency: params.currency || 'INR',
      checkoutUrl: redirectUrl,
      internalReference: params.internalTransactionReference,
      instrumentPayload: {
        merchantTransactionId,
        redirectUrl,
        raw: data,
      },
    };
  }

  /**
   * Verify PhonePe payment status
   */
  public async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const merchantTransactionId = params.merchantTransactionId || params.orderId;
    return this.getPaymentStatus(params.paymentId || '', merchantTransactionId);
  }

  /**
   * Check status with PhonePe API (/pg/v1/status/{merchantId}/{merchantTransactionId})
   */
  public async getPaymentStatus(providerPaymentId: string, providerOrderId?: string): Promise<VerifyPaymentResult> {
    if (!this.isConfigured()) {
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId,
        amountPaise: 0,
        failureCode: 'GATEWAY_NOT_CONFIGURED',
        failureDescription: 'PhonePe credentials not configured.',
      };
    }

    const merchantTransactionId = providerOrderId || providerPaymentId;
    if (!merchantTransactionId) {
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId,
        amountPaise: 0,
        failureCode: 'MISSING_TRANSACTION_ID',
        failureDescription: 'Transaction ID is required for PhonePe status check.',
      };
    }

    const apiEndpoint = `/pg/v1/status/${encodeURIComponent(this.merchantId)}/${encodeURIComponent(merchantTransactionId)}`;
    const checksum = `${this.sha256(apiEndpoint + this.saltKey)}###${this.saltIndex}`;

    const response = await fetch(`${this.baseUrl}${apiEndpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'X-MERCHANT-ID': this.merchantId,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data?.message || response.statusText;
      return {
        isValid: false,
        status: 'failed',
        providerPaymentId,
        amountPaise: 0,
        failureCode: data?.code || 'STATUS_FETCH_FAILED',
        failureDescription: errorMsg,
        rawResponse: data,
      };
    }

    const isSuccess = data.success === true && (data.code === 'PAYMENT_SUCCESS' || data.data?.responseCode === 'SUCCESS');
    const paymentState = data.data?.state;
    const isCaptured = isSuccess && (paymentState === 'COMPLETED' || data.code === 'PAYMENT_SUCCESS');
    const isPending = data.code === 'PAYMENT_PENDING' || paymentState === 'PENDING';

    const gatewayPaymentId = data.data?.transactionId || providerPaymentId || merchantTransactionId;
    const amountPaise = Number(data.data?.amount) || 0;
    const paymentMethod = data.data?.paymentInstrument?.type || undefined;

    return {
      isValid: isCaptured,
      status: isCaptured ? 'captured' : isPending ? 'pending' : 'failed',
      providerPaymentId: gatewayPaymentId,
      amountPaise,
      paymentMethod,
      failureCode: !isCaptured && !isPending ? (data.code || 'PAYMENT_FAILED') : undefined,
      failureDescription: !isCaptured && !isPending ? (data.message || 'Payment not completed') : undefined,
      rawResponse: data,
    };
  }

  /**
   * Process refund through PhonePe (/pg/v1/refund)
   */
  public async processRefund(params: RefundParams): Promise<RefundResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerRefundId: '',
        amountPaise: params.amountPaise,
        status: 'failed',
        failureReason: 'PhonePe credentials not configured.',
      };
    }

    const refundTransactionId = params.internalRefundReference.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 35);

    const payload = {
      merchantId: this.merchantId,
      merchantUserId: 'EP_ADMIN',
      originalTransactionId: params.providerPaymentId,
      merchantTransactionId: refundTransactionId,
      amount: Math.round(params.amountPaise),
      callbackUrl: `${process.env.PUBLIC_URL || 'https://eventpointranchi.com'}/api/payment/webhook/phonepe`,
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const apiEndpoint = '/pg/v1/refund';
    const checksum = `${this.sha256(base64Payload + apiEndpoint + this.saltKey)}###${this.saltIndex}`;

    const response = await fetch(`${this.baseUrl}${apiEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data?.message || response.statusText;
      return {
        success: false,
        providerRefundId: refundTransactionId,
        amountPaise: params.amountPaise,
        status: 'failed',
        failureReason: errorMsg,
        rawResponse: data,
      };
    }

    const isCompleted = data.data?.state === 'COMPLETED' || data.code === 'PAYMENT_SUCCESS';

    return {
      success: true,
      providerRefundId: data.data?.transactionId || refundTransactionId,
      amountPaise: Number(data.data?.amount) || params.amountPaise,
      status: isCompleted ? 'processed' : 'processing',
      rawResponse: data,
    };
  }

  /**
   * Verify PhonePe Webhook callback (X-VERIFY checksum + decoded base64 payload)
   */
  public async verifyWebhook(params: WebhookVerificationParams): Promise<WebhookEventResult> {
    const xVerify =
      params.headers['x-verify'] ||
      params.headers['X-VERIFY'] ||
      params.headers['X-Verify'];

    if (!xVerify || typeof xVerify !== 'string') {
      return {
        isValid: false,
        provider: 'phonepe',
        eventId: '',
        eventType: 'unknown',
        rawPayload: {},
        errorMessage: 'Missing X-VERIFY header in PhonePe webhook.',
      };
    }

    let parsedBody: Record<string, any> = {};
    try {
      parsedBody = JSON.parse(params.rawBody);
    } catch {
      return {
        isValid: false,
        provider: 'phonepe',
        eventId: '',
        eventType: 'unknown',
        rawPayload: {},
        errorMessage: 'Invalid JSON webhook payload.',
      };
    }

    const base64Response = parsedBody.response;
    if (!base64Response || typeof base64Response !== 'string') {
      return {
        isValid: false,
        provider: 'phonepe',
        eventId: '',
        eventType: 'unknown',
        rawPayload: parsedBody,
        errorMessage: 'Missing response string in PhonePe callback.',
      };
    }

    // Verify Checksum: SHA256(base64Response + saltKey) + "###" + saltIndex
    const expectedChecksum = `${this.sha256(base64Response + this.saltKey)}###${this.saltIndex}`;

    const givenBuffer = Buffer.from(xVerify, 'utf8');
    const expectedBuffer = Buffer.from(expectedChecksum, 'utf8');

    if (givenBuffer.length !== expectedBuffer.length || !timingSafeEqual(givenBuffer, expectedBuffer)) {
      return {
        isValid: false,
        provider: 'phonepe',
        eventId: '',
        eventType: 'unknown',
        rawPayload: parsedBody,
        errorMessage: 'Invalid PhonePe webhook checksum signature.',
      };
    }

    let decodedData: Record<string, any> = {};
    try {
      const jsonStr = Buffer.from(base64Response, 'base64').toString('utf8');
      decodedData = JSON.parse(jsonStr);
    } catch {
      return {
        isValid: false,
        provider: 'phonepe',
        eventId: '',
        eventType: 'unknown',
        rawPayload: parsedBody,
        errorMessage: 'Failed to decode base64 response in PhonePe callback.',
      };
    }

    const eventId = decodedData.data?.transactionId || decodedData.data?.merchantTransactionId || `phn_evt_${Date.now()}`;
    const code = decodedData.code;
    const isSuccess = decodedData.success === true && code === 'PAYMENT_SUCCESS';
    const isPending = code === 'PAYMENT_PENDING';

    return {
      isValid: true,
      provider: 'phonepe',
      eventId,
      eventType: code || 'PAYMENT_STATUS_UPDATE',
      orderId: decodedData.data?.merchantTransactionId,
      paymentId: decodedData.data?.transactionId,
      amountPaise: Number(decodedData.data?.amount) || 0,
      status: isSuccess ? 'captured' : isPending ? 'pending' : 'failed',
      rawPayload: decodedData,
    };
  }
}
