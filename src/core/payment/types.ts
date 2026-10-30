export type PaymentGatewayProvider = 'razorpay' | 'phonepe';

export type PaymentLifecycleStatus =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type PaymentType = 'advance' | 'partial' | 'balance' | 'full';

export interface CreateOrderParams {
  bookingId: number;
  amountPaise: number;
  currency: string;
  customer: {
    name: string;
    email?: string;
    phone: string;
  };
  description: string;
  internalTransactionReference: string;
  redirectUrl: string;
  callbackUrl: string;
}

export interface CreateOrderResult {
  provider: PaymentGatewayProvider;
  orderId: string; // Razorpay order_id or PhonePe merchantTransactionId
  amountPaise: number;
  currency: string;
  checkoutUrl?: string; // Hosted checkout page redirect for PhonePe
  keyId?: string; // Public client key ID for Razorpay Standard Checkout
  internalReference: string;
  instrumentPayload?: Record<string, unknown>;
}

export interface VerifyPaymentParams {
  provider: PaymentGatewayProvider;
  orderId: string;
  paymentId?: string;
  signature?: string;
  rawBody?: string;
  checksum?: string;
  merchantTransactionId?: string;
}

export interface VerifyPaymentResult {
  isValid: boolean;
  status: PaymentLifecycleStatus;
  providerPaymentId: string;
  amountPaise: number;
  paymentMethod?: string;
  failureCode?: string;
  failureDescription?: string;
  rawResponse?: Record<string, unknown>;
}

export interface RefundParams {
  provider: PaymentGatewayProvider;
  providerPaymentId: string;
  amountPaise: number;
  reason: string;
  internalRefundReference: string;
}

export interface RefundResult {
  success: boolean;
  providerRefundId: string;
  amountPaise: number;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  failureReason?: string;
  rawResponse?: Record<string, unknown>;
}

export interface WebhookVerificationParams {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

export interface WebhookEventResult {
  isValid: boolean;
  provider: PaymentGatewayProvider;
  eventId: string;
  eventType: string;
  orderId?: string;
  paymentId?: string;
  amountPaise?: number;
  status?: PaymentLifecycleStatus;
  rawPayload: Record<string, unknown>;
  errorMessage?: string;
}

export interface PaymentProvider {
  readonly name: PaymentGatewayProvider;
  isConfigured(): boolean;
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  getPaymentStatus(providerPaymentId: string, providerOrderId?: string): Promise<VerifyPaymentResult>;
  processRefund(params: RefundParams): Promise<RefundResult>;
  verifyWebhook(params: WebhookVerificationParams): Promise<WebhookEventResult>;
}
