import type { EnquiryLineItemRecord } from '../../core/operational/service';

export type EnquiryStatus =
  | 'new'
  | 'reviewing'
  | 'contacted'
  | 'quoted'
  | 'accepted'
  | 'rejected'
  | 'confirmed'
  | 'archived';

export type BookingStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'closed';

export const enquiryFilterTabs = [
  ['active', 'Active'],
  ['new', 'New'],
  ['reviewing', 'Under review'],
  ['contacted', 'Contacted'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
] as const;

export const bookingFilterTabs = [
  ['all', 'All'],
  ['confirmed', 'Confirmed'],
  ['pending_payment', 'Pending payment'],
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['closed', 'Closed'],
] as const;

const ENQUIRY_LABELS: Record<EnquiryStatus, string> = {
  new: 'New / pending',
  reviewing: 'Under review',
  contacted: 'Contacted',
  quoted: 'Quoted (legacy)',
  accepted: 'Accepted',
  rejected: 'Rejected',
  confirmed: 'Confirmed (legacy)',
  archived: 'Archived (legacy)',
};

const ENQUIRY_CLASSES: Record<EnquiryStatus, string> = {
  new: 'badge-warning',
  reviewing: 'badge-info',
  contacted: 'badge-info',
  quoted: 'badge-gold',
  accepted: 'badge-success',
  rejected: 'badge-danger',
  confirmed: 'badge-success',
  archived: 'badge-muted',
};

const BOOKING_LABELS: Record<BookingStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

const BOOKING_CLASSES: Record<BookingStatus, string> = {
  draft: 'badge-muted',
  pending: 'badge-warning',
  confirmed: 'badge-success',
  completed: 'badge-info',
  cancelled: 'badge-danger',
  closed: 'badge-muted',
};

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Pending payment',
  partially_paid: 'Part-paid',
  paid: 'Paid',
  refunded: 'Refunded',
};

const PAYMENT_CLASSES: Record<string, string> = {
  unpaid: 'badge-warning',
  partially_paid: 'badge-info',
  paid: 'badge-success',
  refunded: 'badge-muted',
};

export function enquiryStatusLabel(status: string): string {
  return ENQUIRY_LABELS[status as EnquiryStatus] ?? status;
}

export function enquiryStatusClass(status: string): string {
  return ENQUIRY_CLASSES[status as EnquiryStatus] ?? 'badge-muted';
}

export function bookingStatusLabel(status: string): string {
  return BOOKING_LABELS[status as BookingStatus] ?? status;
}

export function bookingStatusClass(status: string): string {
  return BOOKING_CLASSES[status as BookingStatus] ?? 'badge-muted';
}

export function paymentStatusLabel(status: string | null | undefined): string {
  const value = status || 'unpaid';
  return PAYMENT_LABELS[value] ?? value;
}

export function paymentStatusClass(status: string | null | undefined): string {
  return PAYMENT_CLASSES[status || 'unpaid'] ?? 'badge-muted';
}

export interface EnquirySelectionSummary {
  mandap: string[];
  stage: string[];
  furniture: string[];
  catering: string[];
  hasSelections: boolean;
}

type EnquiryLine = Pick<
  EnquiryLineItemRecord,
  'item_type' | 'item_name_snapshot' | 'quantity'
>;

function withQuantity(line: EnquiryLine): string {
  return Number(line.quantity) > 1
    ? `${line.item_name_snapshot} × ${Number(line.quantity)}`
    : line.item_name_snapshot;
}

export function summariseEnquiryLines(lines: EnquiryLine[]): EnquirySelectionSummary {
  const mandap = lines.filter((line) => line.item_type === 'mandap').map(withQuantity);
  const stage = lines.filter((line) => line.item_type === 'stage').map(withQuantity);
  const furniture = lines.filter((line) => line.item_type === 'equipment').map(withQuantity);
  const catering = lines.filter((line) => line.item_type === 'catering').map(withQuantity);

  return {
    mandap,
    stage,
    furniture,
    catering,
    hasSelections: mandap.length + stage.length + furniture.length + catering.length > 0,
  };
}
