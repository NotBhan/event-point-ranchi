/**
 * Authoritative booking pricing.
 *
 * The published catalogue is the only source of truth for what a customer sees
 * *and* what the server charges. Both come from the same content service that
 * renders /mandaps, /stages, /equipment and /catering — never from a
 * browser-supplied amount and never from the legacy SQLite catalogue copy.
 *
 * When public content moves from Cloudflare D1 to versioned object storage this
 * module keeps working unchanged: it depends on `core/content/service`, not on
 * the D1 client.
 */
import {
  getCateringPackages,
  getFurnitureItems,
  getMandaps,
  getStages,
} from '../../core/content/service';
import type { BookingItemInput } from '../../core/operational/service';

export class PricingError extends Error {}

export interface BookingSelection {
  mandap?: { id: string | number } | null;
  stage?: { id: string | number } | null;
  furniture?: Array<{ id: string | number; quantity: number }> | null;
  catering?: {
    id: string | number;
    guestCount: number;
    selectedItems?: Array<{ section: string; item: string }>;
  } | null;
  /** Retired categories are rejected instead of priced from a second source. */
  hall?: { id: string | number } | null;
  services?: Array<{ id: string | number }> | null;
}

export interface PricedBooking {
  items: BookingItemInput[];
  totalPaise: number;
}

function toId(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PricingError('One of the selected catalogue items is invalid. Please refresh and try again.');
  }
  return parsed;
}

/**
 * Refuses to persist a ₹0 line. An item without a configured catalogue price is
 * "price on request" — charging zero for it would silently understate the
 * booking, so it has to go through the enquiry/quotation flow instead.
 */
function requireConfiguredPrice(name: string, unitPricePaise: number): number {
  const price = Number(unitPricePaise ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new PricingError(
      `${name} is priced on request. Send an enquiry and our team will confirm the amount before booking.`,
    );
  }
  return price;
}

/**
 * Prices a booking selection against the published catalogue.
 *
 * Every amount is resolved server-side; the request only says *what* was
 * selected, never *how much it costs*.
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

  const items: BookingItemInput[] = [];

  if (selection.mandap?.id) {
    const id = toId(selection.mandap.id);
    const mandap = (await getMandaps()).find((entry) => entry.id === id);
    if (!mandap) throw new PricingError('The selected mandap is no longer available. Please choose another.');
    const mandapPrice = requireConfiguredPrice(mandap.name, mandap.price_starting_paise);

    items.push({
      category: 'mandap',
      itemId: String(mandap.id),
      name: mandap.name,
      quantity: 1,
      unitPricePaise: mandapPrice,
      subtotalPaise: mandapPrice,
      metadata: { slug: mandap.slug, dimensions: `${mandap.length_ft} × ${mandap.width_ft} × ${mandap.height_ft} ${mandap.dimension_unit}` },
    });
  }

  if (selection.stage?.id) {
    const id = toId(selection.stage.id);
    const stage = (await getStages()).find((entry) => entry.id === id);
    if (!stage) throw new PricingError('The selected stage design is no longer available. Please choose another.');
    const stagePrice = requireConfiguredPrice(stage.name, stage.price_starting_paise);

    items.push({
      category: 'stage',
      itemId: String(stage.id),
      name: stage.name,
      quantity: 1,
      unitPricePaise: stagePrice,
      subtotalPaise: stagePrice,
      metadata: { slug: stage.slug, dimensions: `${stage.length_ft} × ${stage.width_ft} × ${stage.height_ft} ${stage.dimension_unit}` },
    });
  }

  if (selection.furniture && selection.furniture.length > 0) {
    const catalogue = await getFurnitureItems();

    for (const entry of selection.furniture) {
      const quantity = Math.floor(Number(entry.quantity) || 0);
      if (quantity <= 0) continue;

      const id = toId(entry.id);
      const item = catalogue.find((candidate) => candidate.id === id);
      if (!item) throw new PricingError('One of the selected equipment items is no longer available. Please refresh your list.');

      const minimum = Math.max(1, Number(item.min_quantity) || 1);
      if (quantity < minimum) {
        throw new PricingError(`${item.name} requires a minimum quantity of ${minimum}.`);
      }

      const unitPrice = requireConfiguredPrice(item.name, item.price_paise);

      items.push({
        category: 'furniture',
        itemId: String(item.id),
        name: item.name,
        quantity,
        unitPricePaise: unitPrice,
        subtotalPaise: unitPrice * quantity,
        metadata: { slug: item.slug, unit: item.pricing_unit },
      });
    }
  }

  if (selection.catering?.id) {
    const id = toId(selection.catering.id);
    const packages = await getCateringPackages();
    const pkg = packages.find((entry) => entry.id === id);
    if (!pkg) throw new PricingError('The selected catering package is no longer available.');

    const guestCount = Math.floor(Number(selection.catering.guestCount) || 0);
    if (guestCount < 1 || guestCount > 100000) {
      throw new PricingError('Enter a guest count between 1 and 1,00,000 for the catering package.');
    }

    // Tier pricing is part of the published package; fall back to the base rate.
    const tier = (pkg.guest_pricing ?? []).find(
      (entry: { guest_count?: number }) => Number(entry.guest_count) === guestCount,
    );
    const pricePerPlate = requireConfiguredPrice(
      pkg.name,
      Number(tier?.price_per_plate_paise ?? pkg.price_per_plate_paise),
    );

    items.push({
      category: 'catering',
      itemId: String(pkg.id),
      name: pkg.name,
      quantity: guestCount,
      unitPricePaise: pricePerPlate,
      subtotalPaise: pricePerPlate * guestCount,
      metadata: {
        slug: pkg.slug,
        guestCount,
        pricePerPlatePaise: pricePerPlate,
        menuItems: (selection.catering.selectedItems ?? []).map((entry) => ({
          section: String(entry.section ?? 'Menu'),
          item: String(entry.item ?? ''),
        })),
      },
    });
  }

  const totalPaise = items.reduce((sum, item) => sum + item.subtotalPaise, 0);
  return { items, totalPaise };
}

/**
 * Formats a catalogue amount for display, including the "price on request"
 * case where no price has been configured yet.
 */
export function formatCataloguePrice(paise: number | null | undefined): string {
  const amount = Number(paise ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'Price on request';
  return `₹${(amount / 100).toLocaleString('en-IN')}`;
}
