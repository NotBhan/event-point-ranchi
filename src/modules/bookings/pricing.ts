/**
 * Authoritative booking and enquiry pricing.
 *
 * The published D1 catalogue is the only source of truth. The pure calculation
 * lives in pricing-core.ts so the live plan summary and the server use exactly
 * the same rules; this module adds the D1 fetch and the direct-booking policy
 * that unpriced items cannot be booked at zero.
 */
import {
  getCateringPackages,
  getFurnitureItems,
  getMandaps,
  getStages,
} from '../../core/content/service';
import type { BookingItemInput } from '../../core/operational/service';
import {
  PricingError,
  calculateSelectionPricing,
  formatCataloguePrice,
  type PricingCatalogue,
  type PricingSelection,
  type SelectionPricing,
} from './pricing-core';

export { PricingError, formatCataloguePrice };
export type { PricingCatalogue, PricingSelection, SelectionPricing };

export interface BookingSelection extends PricingSelection {
  /** Retired categories are rejected instead of priced from a second source. */
  hall?: { id: string | number } | null;
  services?: Array<{ id: string | number }> | null;
}

export interface PricedBooking {
  items: BookingItemInput[];
  totalPaise: number;
}

export async function loadPricingCatalogue(): Promise<PricingCatalogue> {
  const [mandaps, stages, furniture, catering] = await Promise.all([
    getMandaps(),
    getStages(),
    getFurnitureItems(),
    getCateringPackages(),
  ]);

  return {
    mandaps: mandaps.map((entry) => ({
      id: Number(entry.id),
      name: entry.name,
      slug: entry.slug,
      category: entry.category,
      length_ft: Number(entry.length_ft),
      width_ft: Number(entry.width_ft),
      height_ft: Number(entry.height_ft),
      dimension_unit: entry.dimension_unit,
      price_starting_paise: Number(entry.price_starting_paise ?? 0),
    })),
    stages: stages.map((entry) => ({
      id: Number(entry.id),
      name: entry.name,
      slug: entry.slug,
      style_category: entry.style_category,
      length_ft: Number(entry.length_ft),
      width_ft: Number(entry.width_ft),
      height_ft: Number(entry.height_ft),
      dimension_unit: entry.dimension_unit,
      price_starting_paise: Number(entry.price_starting_paise ?? 0),
    })),
    furniture,
    catering,
  };
}

/**
 * Prices an enquiry selection without rejecting price-on-request entries.
 * The result explicitly distinguishes fully priced, partially priced and
 * quotation-required selections.
 */
export async function priceEnquirySelection(
  selection: PricingSelection,
  catalogue?: PricingCatalogue,
): Promise<SelectionPricing> {
  const data = catalogue ?? (await loadPricingCatalogue());
  return calculateSelectionPricing(data, selection);
}

/**
 * Direct bookings require every selected line to have a configured price.
 * Zero-priced catalogue entries remain "price on request" and must go through
 * the enquiry/quotation flow.
 */
export async function priceBookingSelection(selection: BookingSelection): Promise<PricedBooking> {
  if (selection.hall?.id) {
    throw new PricingError(
      'Hall reservations are handled by our planning team. Send an enquiry and a coordinator will confirm availability and pricing.',
    );
  }

  if (selection.services && selection.services.length > 0) {
    throw new PricingError(
      'Additional services are quoted individually by our team. Please send an enquiry with your requirements.',
    );
  }

  const pricing = await priceEnquirySelection(selection);
  const unpriced = pricing.items.find((item) => item.pricingStatus === 'on_request');
  if (unpriced) {
    throw new PricingError(
      `${unpriced.name} is priced on request. Send an enquiry and our team will confirm the amount before booking.`,
    );
  }

  return {
    items: pricing.items.map((item) => ({
      category: item.category,
      itemId: item.itemId,
      name: item.name,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise ?? 0,
      subtotalPaise: item.subtotalPaise ?? 0,
      metadata: item.metadata,
    })),
    totalPaise: pricing.pricedSubtotalPaise,
  };
}
