import type { EnquiryReceiptData } from '../operational/enquiry-receipt-service';
import type { QuotationData } from '../../modules/bookings/service';

export interface CanonicalBusinessInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
  website: string;
}

export interface CanonicalDocumentLine {
  category: string;
  description: string;
  quantity: number;
  unitPricePaise: number | null;
  amountPaise: number | null;
  onRequest: boolean;
  note?: string;
}

export interface CanonicalFinancials {
  totalPaise: number;
  requiredDepositPaise: number;
  amountPaidPaise: number;
  outstandingBalancePaise: number;
  amountDueNowPaise: number;
  paymentStatus: string;
  depositType: string;
  depositValue: number | null;
}

export interface CanonicalDocumentData {
  documentType: string;
  reference: string;
  documentNumber: string;
  preparedAt: string;
  status: string;
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
  };
  event: {
    date: string;
    time: string;
    type: string;
    guests: number;
    venue: string;
  };
  lines: CanonicalDocumentLine[];
  financials: CanonicalFinancials | null;
  notes: string;
  terms: string[];
  quotationVersion?: number | null;
  isLegacy?: boolean;
  business: CanonicalBusinessInfo;
}

const DEFAULT_TERMS = [
  'The server-side quotation and booking record is authoritative.',
  'The required deposit is not a payment; only amounts actually received reduce the outstanding balance.',
  'Catalogue prices are fixed for this booking. Historical quotation versions are retained and never rewritten.',
];

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function calculateRequiredDeposit(
  totalPaise: number,
  depositType: string | null | undefined,
  depositValue: number | null | undefined,
): number {
  const total = amount(totalPaise);
  if (total <= 0) return 0;
  const type = depositType || 'percentage';
  const value = Number(depositValue ?? 25);
  if (type === 'full') return total;
  if (type === 'percentage') {
    const percentage = Number.isFinite(value) ? Math.min(100, Math.max(1, value)) : 25;
    return Math.min(total, Math.round((total * percentage) / 100));
  }
  if (type === 'fixed' || type === 'custom') {
    const fixed = Number.isFinite(value) ? value * 100 : 0;
    return Math.min(total, Math.max(0, Math.round(fixed)));
  }
  return Math.min(total, Math.round((total * 25) / 100));
}

export function buildFinancials(booking: QuotationData['booking']): CanonicalFinancials {
  const totalPaise = amount(booking.total_amount);
  const requiredDepositPaise = amount(booking.advance_amount) > 0
    ? amount(booking.advance_amount)
    : calculateRequiredDeposit(totalPaise, booking.deposit_type, booking.deposit_value);
  const amountPaidPaise = amount(booking.amount_paid);
  const outstandingBalancePaise = booking.outstanding_balance === undefined || booking.outstanding_balance === null
    ? Math.max(0, totalPaise - amountPaidPaise)
    : amount(booking.outstanding_balance);
  return {
    totalPaise,
    requiredDepositPaise,
    amountPaidPaise,
    outstandingBalancePaise,
    amountDueNowPaise: amountPaidPaise < requiredDepositPaise
      ? Math.max(0, requiredDepositPaise - amountPaidPaise)
      : outstandingBalancePaise,
    paymentStatus: booking.payment_status || 'unpaid',
    depositType: booking.deposit_type || 'percentage',
    depositValue: booking.deposit_value === undefined || booking.deposit_value === null
      ? null
      : Number(booking.deposit_value),
  };
}

export function buildBookingDocument(data: QuotationData, business: CanonicalBusinessInfo): CanonicalDocumentData {
  const bookingNumber = `EP-${String(data.booking.id).padStart(5, '0')}`;
  return {
    documentType: 'Booking quotation & receipt',
    reference: data.sourceEnquiry?.reference || bookingNumber,
    documentNumber: bookingNumber,
    preparedAt: data.booking.created_at,
    status: data.booking.status,
    customer: {
      name: data.customer.name,
      phone: data.customer.phone,
      email: data.customer.email,
      address: data.customer.address,
    },
    event: {
      date: data.booking.event_date || '',
      time: data.booking.event_time || '',
      type: data.booking.event_type,
      guests: Number(data.booking.total_guest ?? 0),
      venue: data.booking.venue_location || data.sourceEnquiry?.venue || '',
    },
    lines: data.lines.map((line) => ({
      category: line.label,
      description: line.detail,
      quantity: line.quantity ?? 1,
      unitPricePaise: line.unitPricePaise ?? null,
      amountPaise: line.onRequest ? null : amount(line.amount),
      onRequest: Boolean(line.onRequest),
    })),
    financials: buildFinancials(data.booking),
    notes: data.booking.special_request || '',
    terms: DEFAULT_TERMS,
    quotationVersion: data.booking.source_quotation_version ?? null,
    isLegacy: data.isLegacy,
    business,
  };
}

export function buildEnquiryDocument(data: EnquiryReceiptData): CanonicalDocumentData {
  return {
    documentType: 'Enquiry acknowledgement',
    reference: data.enquiry.referenceCode,
    documentNumber: data.enquiry.referenceCode,
    preparedAt: data.enquiry.createdAt,
    status: data.enquiry.status,
    customer: {
      name: data.enquiry.customerName,
      phone: data.enquiry.customerPhone,
      email: data.enquiry.customerEmail || '',
      address: '',
    },
    event: {
      date: data.enquiry.eventDate,
      time: data.enquiry.eventTime || '',
      type: data.enquiry.eventType,
      guests: data.enquiry.guestCount,
      venue: data.enquiry.venueLocation,
    },
    lines: data.enquiry.items.map((item) => ({
      category: item.itemType,
      description: item.name,
      quantity: item.quantity,
      unitPricePaise: null,
      amountPaise: null,
      onRequest: true,
      note: item.dimensions,
    })),
    financials: null,
    notes: [data.enquiry.accommodationNotes, data.enquiry.decorationNotes].filter(Boolean).join('\n'),
    terms: [
      'This is an enquiry acknowledgement, not a confirmed booking or tax invoice.',
      'No payment has been received for this enquiry.',
      'Your date is reserved only after a written quotation is accepted and the required deposit is received.',
    ],
    quotationVersion: null,
    business: {
      name: data.businessInfo.brandName,
      phone: data.businessInfo.phone,
      email: data.businessInfo.email,
      address: data.businessInfo.address,
      website: data.businessInfo.website,
    },
  };
}

export interface QuotationDocumentInput {
  enquiry: {
    reference_code: string;
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    customer_address?: string | null;
    event_type: string;
    event_date: string;
    event_time: string | null;
    venue_location: string;
    guest_count: number;
    decoration_notes?: string | null;
    accommodation_notes?: string | null;
    created_at: string;
  };
  quotation: {
    version: number;
    status: string;
    total_paise: number;
    notes: string | null;
    prepared_at: string | null;
  };
  lines: Array<{
    line_type: string;
    description: string;
    quantity: number;
    quoted_unit_price_paise: number;
    quoted_subtotal_paise: number;
    notes?: string | null;
  }>;
}

export function buildQuotationDocument(
  input: QuotationDocumentInput,
  business: CanonicalBusinessInfo = {
    name: 'Event Point Ranchi',
    phone: '',
    email: '',
    address: 'Ranchi, Jharkhand',
    website: '',
  },
): CanonicalDocumentData {
  const totalPaise = amount(input.quotation.total_paise);
  const requiredDeposit = calculateRequiredDeposit(totalPaise, 'percentage', 25);
  return {
    documentType: 'Prepared quotation',
    reference: input.enquiry.reference_code,
    documentNumber: `${input.enquiry.reference_code}-Q${input.quotation.version}`,
    preparedAt: input.quotation.prepared_at || input.enquiry.created_at,
    status: input.quotation.status,
    customer: {
      name: input.enquiry.customer_name,
      phone: input.enquiry.customer_phone,
      email: input.enquiry.customer_email || '',
      address: input.enquiry.customer_address || '',
    },
    event: {
      date: input.enquiry.event_date,
      time: input.enquiry.event_time || '',
      type: input.enquiry.event_type,
      guests: Number(input.enquiry.guest_count ?? 0),
      venue: input.enquiry.venue_location,
    },
    lines: input.lines.map((line) => ({
      category: line.line_type === 'manual' ? 'Manual quotation line' : 'Catalogue selection',
      description: line.description,
      quantity: Number(line.quantity ?? 1),
      unitPricePaise: amount(line.quoted_unit_price_paise),
      amountPaise: amount(line.quoted_subtotal_paise),
      onRequest: amount(line.quoted_subtotal_paise) <= 0,
      note: line.notes || '',
    })),
    financials: {
      totalPaise,
      requiredDepositPaise: requiredDeposit,
      amountPaidPaise: 0,
      outstandingBalancePaise: totalPaise,
      amountDueNowPaise: requiredDeposit,
      paymentStatus: 'not booked',
      depositType: 'percentage',
      depositValue: 25,
    },
    notes: input.quotation.notes || [input.enquiry.decoration_notes, input.enquiry.accommodation_notes].filter(Boolean).join('\n'),
    terms: DEFAULT_TERMS,
    quotationVersion: input.quotation.version,
    business,
  };
}
