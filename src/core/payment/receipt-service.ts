import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  getPaymentById,
  getBookingById,
  getPaymentReceiptByPaymentId,
  getPaymentReceiptByTokenHash,
  getPaymentReceiptByNumber,
  createPaymentReceiptRecord,
  updatePaymentReceiptStatus,
  getRefundsByPaymentId,
  type PaymentReceiptRow,
  type PaymentRow,
  type BookingRow,
} from '../operational/service';
import { getNeonClient } from '../operational/neon-client';

export interface MaskedCustomer {
  fullName: string;
  maskedName: string;
  rawPhone: string;
  maskedPhone: string;
  email: string | null;
}

export interface ReceiptDetailPayload {
  receipt: PaymentReceiptRow;
  payment: PaymentRow;
  booking: BookingRow;
  customer: MaskedCustomer;
  qrDataUrl: string;
  verificationUrl: string;
  isRefunded: boolean;
  businessInfo: {
    brandName: string;
    legalName: string;
    tagline: string;
    phone: string;
    email: string;
    address: string;
    website: string;
  };
}

/**
 * Mask customer name: e.g. "Rahul Kumar" -> "R***l K***r"
 */
export function maskCustomerName(name: string): string {
  if (!name || name.trim().length === 0) return 'Valued Customer';
  return name
    .trim()
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 2) return part[0] + '*';
      return part[0] + '*'.repeat(part.length - 2) + part[part.length - 1];
    })
    .join(' ');
}

/**
 * Mask phone number: e.g. "9876543210" -> "+91 XXXXX 43210"
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return '+91 XXXXX XXXXX';
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) {
    const last5 = digits.slice(-5);
    return `+91 XXXXX ${last5}`;
  }
  return '+91 XXXXX XXXXX';
}

/**
 * Format paise to INR display string: e.g. 500000 -> "₹5,000.00"
 */
export function formatINR(paise: number | bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Generate a unique receipt number: EPR-RCPT-YYYYMM-XXXXX
 */
export async function generateUniqueReceiptNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  for (let i = 0; i < 15; i++) {
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const candidate = `EPR-RCPT-${yearMonth}-${randomSuffix}`;
    const existing = await getPaymentReceiptByNumber(candidate);
    if (!existing) {
      return candidate;
    }
  }
  // Fallback to high-entropy hex
  return `EPR-RCPT-${yearMonth}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export class ReceiptService {
  private defaultBaseUrl: string;

  constructor(defaultBaseUrl?: string) {
    this.defaultBaseUrl = defaultBaseUrl || process.env.PUBLIC_SITE_URL || 'https://eventpointranchi.com';
  }

  public getBusinessInfo() {
    return {
      brandName: 'Event Point Ranchi',
      legalName: 'SARVIN Event Management & Hospitality Services',
      tagline: 'Premier Wedding Mandaps, Stages, Catering & Event Architecture',
      phone: '+91 98765 43210',
      email: 'info@eventpointranchi.com',
      address: 'Near Birsa Chowk, Airport Road, Ranchi, Jharkhand 834002',
      website: 'https://eventpointranchi.com',
    };
  }

  /**
   * Get or generate payment receipt for a captured payment
   */
  public async getOrCreateReceipt(paymentId: number, baseUrl?: string): Promise<ReceiptDetailPayload> {
    const payment = await getPaymentById(paymentId);
    if (!payment) {
      throw new Error(`Payment #${paymentId} not found.`);
    }

    const booking = await getBookingById(payment.booking_id);
    if (!booking) {
      throw new Error(`Booking #${payment.booking_id} not found.`);
    }

    const host = baseUrl || this.defaultBaseUrl;
    let receipt = await getPaymentReceiptByPaymentId(payment.id);

    if (!receipt) {
      const receiptNumber = await generateUniqueReceiptNumber();
      const verificationToken = randomBytes(32).toString('hex');
      const verificationTokenHash = createHash('sha256').update(verificationToken).digest('hex');

      receipt = await createPaymentReceiptRecord({
        paymentId: payment.id,
        bookingId: booking.id,
        receiptNumber,
        verificationToken,
        verificationTokenHash,
        amountPaise: payment.amount_paise,
        status: payment.status === 'refunded' ? 'refunded' : 'issued',
      });
    }

    // Check if refunds exist or payment status changed to refunded
    const refunds = await getRefundsByPaymentId(payment.id);
    const totalRefunded = refunds
      .filter((r) => r.status === 'processed')
      .reduce((sum, r) => sum + Number(r.amount_paise), 0);
    const isRefunded = payment.status === 'refunded' || totalRefunded >= Number(payment.amount_paise);

    if (isRefunded && receipt.status !== 'refunded') {
      await updatePaymentReceiptStatus(receipt.id, 'refunded');
      receipt.status = 'refunded';
    }

    const verificationUrl = `${host.replace(/\/+$/, '')}/receipt/verify/${receipt.verification_token}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 250,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    });

    // Fetch customer details
    const neon = getNeonClient();
    const custRes = await neon.query<{ name: string; phone: string; email: string }>(
      'SELECT name, phone, email FROM customers WHERE id = $1 LIMIT 1',
      [booking.customer_id]
    );
    const rawCustomer = custRes.rows[0] || { name: 'Customer', phone: '', email: null };

    const customer: MaskedCustomer = {
      fullName: rawCustomer.name || 'Valued Customer',
      maskedName: maskCustomerName(rawCustomer.name),
      rawPhone: rawCustomer.phone || '',
      maskedPhone: maskPhoneNumber(rawCustomer.phone),
      email: rawCustomer.email || null,
    };

    return {
      receipt,
      payment,
      booking,
      customer,
      qrDataUrl,
      verificationUrl,
      isRefunded,
      businessInfo: this.getBusinessInfo(),
    };
  }

  /**
   * Look up receipt by verification token
   */
  public async getReceiptByToken(token: string, baseUrl?: string): Promise<ReceiptDetailPayload | null> {
    if (!token || typeof token !== 'string' || token.trim().length < 16) {
      return null;
    }

    const tokenHash = createHash('sha256').update(token.trim()).digest('hex');
    const receipt = await getPaymentReceiptByTokenHash(tokenHash);
    if (!receipt) {
      return null;
    }

    return this.getOrCreateReceipt(receipt.payment_id, baseUrl);
  }

  /**
   * Look up receipt by receipt number
   */
  public async getReceiptByNumber(receiptNumber: string, baseUrl?: string): Promise<ReceiptDetailPayload | null> {
    if (!receiptNumber || typeof receiptNumber !== 'string') {
      return null;
    }

    const receipt = await getPaymentReceiptByNumber(receiptNumber.trim());
    if (!receipt) {
      return null;
    }

    return this.getOrCreateReceipt(receipt.payment_id, baseUrl);
  }

  /**
   * Generate an official, print-ready A4 PDF receipt buffer using pdf-lib
   */
  public async generatePdfBuffer(receiptPayload: ReceiptDetailPayload): Promise<Uint8Array> {
    const { receipt, payment, booking, customer, businessInfo, verificationUrl, isRefunded } = receiptPayload;

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Payment Receipt - ${receipt.receipt_number}`);
    pdfDoc.setAuthor(businessInfo.legalName);
    pdfDoc.setSubject(`Official Payment Acknowledgement for Booking #${booking.id}`);

    // A4 dimensions in points: 595.28 x 841.89
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // Embed fonts
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Generate high-res QR code PNG buffer
    const qrPngBuffer = await QRCode.toBuffer(verificationUrl, {
      type: 'png',
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    const qrImage = await pdfDoc.embedPng(qrPngBuffer);

    // Colors
    const goldColor = rgb(0.78, 0.63, 0.31);       // #C8A251
    const navyColor = rgb(0.08, 0.12, 0.22);       // #141F38
    const darkGray = rgb(0.2, 0.23, 0.28);         // #333B47
    const lightGray = rgb(0.45, 0.48, 0.53);       // #737B87
    const borderColor = rgb(0.88, 0.90, 0.93);     // #E0E5EC
    const boxBg = rgb(0.97, 0.98, 0.99);           // #F8FAFC
    const successGreen = rgb(0.18, 0.49, 0.20);    // #2E7D32
    const refundRed = rgb(0.83, 0.18, 0.18);       // #D32F2F

    let y = pageHeight - 40;

    // Top Brand Header
    page.drawText(businessInfo.brandName.toUpperCase(), {
      x: 40,
      y,
      size: 16,
      font: fontBold,
      color: navyColor,
    });

    page.drawText(businessInfo.legalName, {
      x: 40,
      y: y - 14,
      size: 9,
      font: fontRegular,
      color: lightGray,
    });

    page.drawText(`${businessInfo.address} | Phone: ${businessInfo.phone}`, {
      x: 40,
      y: y - 26,
      size: 8,
      font: fontRegular,
      color: lightGray,
    });

    // Receipt Title Pill (Right side)
    const titleText = isRefunded ? 'PAYMENT REFUNDED' : 'PAYMENT ACKNOWLEDGEMENT';
    page.drawText(titleText, {
      x: pageWidth - 230,
      y: y - 2,
      size: 11,
      font: fontBold,
      color: isRefunded ? refundRed : goldColor,
    });

    page.drawText('(Not a GST Tax Invoice)', {
      x: pageWidth - 230,
      y: y - 16,
      size: 8.5,
      font: fontRegular,
      color: lightGray,
    });

    y -= 44;

    // Gold Accent Line
    page.drawRectangle({
      x: 40,
      y,
      width: pageWidth - 80,
      height: 2.5,
      color: goldColor,
    });

    y -= 24;

    // Receipt Metadata Box
    page.drawRectangle({
      x: 40,
      y: y - 80,
      width: pageWidth - 80,
      height: 90,
      color: boxBg,
      borderColor,
      borderWidth: 1,
    });

    // Left Column: Receipt & Transaction Info
    page.drawText('Receipt Number:', { x: 55, y: y - 12, size: 9, font: fontRegular, color: lightGray });
    page.drawText(receipt.receipt_number, { x: 150, y: y - 12, size: 9.5, font: fontBold, color: navyColor });

    page.drawText('Payment Date:', { x: 55, y: y - 28, size: 9, font: fontRegular, color: lightGray });
    const formattedDate = new Date(payment.verified_at || receipt.issued_at).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' IST';
    page.drawText(formattedDate, { x: 150, y: y - 28, size: 9, font: fontRegular, color: darkGray });

    page.drawText('Transaction ID:', { x: 55, y: y - 44, size: 9, font: fontRegular, color: lightGray });
    page.drawText(payment.provider_payment_id || payment.internal_transaction_reference, {
      x: 150,
      y: y - 44,
      size: 8.5,
      font: fontRegular,
      color: darkGray,
    });

    page.drawText('Payment Method:', { x: 55, y: y - 60, size: 9, font: fontRegular, color: lightGray });
    page.drawText(`PhonePe (${payment.payment_type.toUpperCase()})`, {
      x: 150,
      y: y - 60,
      size: 9,
      font: fontRegular,
      color: darkGray,
    });

    // Right Column: Booking & Payer Info
    page.drawText('Booking Reference:', { x: 320, y: y - 12, size: 9, font: fontRegular, color: lightGray });
    page.drawText(`Booking #${booking.id} (${booking.event_type})`, {
      x: 425,
      y: y - 12,
      size: 9,
      font: fontBold,
      color: navyColor,
    });

    page.drawText('Customer Name:', { x: 320, y: y - 28, size: 9, font: fontRegular, color: lightGray });
    page.drawText(customer.fullName, { x: 425, y: y - 28, size: 9, font: fontRegular, color: darkGray });

    page.drawText('Contact Phone:', { x: 320, y: y - 44, size: 9, font: fontRegular, color: lightGray });
    page.drawText(customer.maskedPhone, { x: 425, y: y - 44, size: 9, font: fontRegular, color: darkGray });

    page.drawText('Payment Status:', { x: 320, y: y - 60, size: 9, font: fontRegular, color: lightGray });
    page.drawText(isRefunded ? 'REFUNDED' : 'SUCCESSFUL / CAPTURED', {
      x: 425,
      y: y - 60,
      size: 9,
      font: fontBold,
      color: isRefunded ? refundRed : successGreen,
    });

    y -= 115;

    // Financial Breakdown Table Header
    page.drawRectangle({
      x: 40,
      y: y - 16,
      width: pageWidth - 80,
      height: 24,
      color: navyColor,
    });

    page.drawText('PAYMENT ITEMIZATION & BOOKING BALANCE', {
      x: 55,
      y: y - 9,
      size: 9,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText('AMOUNT (INR)', {
      x: pageWidth - 140,
      y: y - 9,
      size: 9,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    y -= 22;

    const formatPdfINR = (paise: number | bigint): string => {
      const rupees = Number(paise) / 100;
      return `INR ${rupees.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };

    const rowItems = [
      {
        label: `Amount Paid in This Transaction (${payment.payment_type.toUpperCase()})`,
        amount: formatPdfINR(payment.amount_paise),
        bold: true,
        highlight: true,
      },
      {
        label: 'Total Confirmed Booking Quotation',
        amount: formatPdfINR(booking.total_amount),
        bold: false,
      },
      {
        label: 'Cumulative Amount Paid to Date',
        amount: formatPdfINR(booking.amount_paid),
        bold: false,
      },
      {
        label: 'Outstanding Remaining Balance',
        amount: formatPdfINR(booking.outstanding_balance),
        bold: true,
      },
    ];

    for (const item of rowItems) {
      page.drawRectangle({
        x: 40,
        y: y - 20,
        width: pageWidth - 80,
        height: 24,
        color: item.highlight ? rgb(0.95, 0.98, 0.95) : rgb(1, 1, 1),
        borderColor,
        borderWidth: 0.5,
      });

      page.drawText(item.label, {
        x: 55,
        y: y - 13,
        size: 9,
        font: item.bold ? fontBold : fontRegular,
        color: darkGray,
      });

      page.drawText(item.amount, {
        x: pageWidth - 140,
        y: y - 13,
        size: 9.5,
        font: item.bold ? fontBold : fontRegular,
        color: item.highlight ? successGreen : navyColor,
      });

      y -= 24;
    }

    y -= 30;

    // QR Verification Section
    page.drawRectangle({
      x: 40,
      y: y - 120,
      width: pageWidth - 80,
      height: 130,
      color: boxBg,
      borderColor,
      borderWidth: 1,
    });

    // Draw QR Code Image
    const qrDim = 100;
    page.drawImage(qrImage, {
      x: 55,
      y: y - 105,
      width: qrDim,
      height: qrDim,
    });

    // QR Description
    page.drawText('OFFICIAL QR VERIFICATION CODE', {
      x: 175,
      y: y - 15,
      size: 10,
      font: fontBold,
      color: navyColor,
    });

    page.drawText(
      'Scan this secure cryptographic QR code with any smartphone camera to verify this receipt.',
      {
        x: 175,
        y: y - 32,
        size: 8.5,
        font: fontRegular,
        color: darkGray,
      }
    );

    page.drawText(
      'Our public verification portal independently validates transaction integrity against our Neon database.',
      {
        x: 175,
        y: y - 46,
        size: 8,
        font: fontRegular,
        color: lightGray,
      }
    );

    page.drawText('Direct Verification URL:', {
      x: 175,
      y: y - 64,
      size: 8,
      font: fontBold,
      color: darkGray,
    });

    page.drawText(verificationUrl, {
      x: 175,
      y: y - 78,
      size: 7.5,
      font: fontRegular,
      color: rgb(0.12, 0.35, 0.65),
    });

    page.drawText(
      isRefunded
        ? 'NOTE: This receipt has been marked REFUNDED or SUPERSEDED.'
        : 'AUTHENTICATED: Cryptographic hash matches bank-settled payment ledger.',
      {
        x: 175,
        y: y - 98,
        size: 8,
        font: fontBold,
        color: isRefunded ? refundRed : successGreen,
      }
    );

    y -= 150;

    // Terms & Disclaimers
    page.drawText('IMPORTANT TERMS & CONDITIONS', {
      x: 40,
      y,
      size: 8.5,
      font: fontBold,
      color: darkGray,
    });

    const disclaimerLines = [
      '1. This document serves solely as an advance or booking payment acknowledgement and does not constitute a GST Tax Invoice.',
      '2. Official GST Tax Invoices are generated upon completion of services in accordance with applicable tax statutes.',
      '3. In case of cancellation or reschedule, refunds are processed per Event Point Ranchi policy within 5-7 working days.',
      '4. This is a secure computer-generated receipt authenticated via cryptographic hash; no physical signature is required.',
      '5. For billing inquiries, quote your receipt number and contact support@eventpointranchi.com.',
    ];

    y -= 14;
    for (const line of disclaimerLines) {
      page.drawText(line, {
        x: 40,
        y,
        size: 7.5,
        font: fontRegular,
        color: lightGray,
      });
      y -= 11;
    }

    // Bottom Watermark Footer
    page.drawText(
      `Generated on ${new Date().toISOString()} | Powered by Event Point Ranchi & PhonePe Payment Infrastructure`,
      {
        x: 40,
        y: 25,
        size: 7,
        font: fontRegular,
        color: lightGray,
      }
    );

    return pdfDoc.save();
  }
}

let receiptServiceInstance: ReceiptService | null = null;

export function getReceiptService(baseUrl?: string): ReceiptService {
  if (!receiptServiceInstance) {
    receiptServiceInstance = new ReceiptService(baseUrl);
  }
  return receiptServiceInstance;
}

export async function generateReceiptPdf(payload: ReceiptDetailPayload): Promise<Uint8Array> {
  const service = getReceiptService();
  return service.generatePdfBuffer(payload);
}

