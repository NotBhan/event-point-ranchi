import type { CateringPackage, FurnitureItem } from '../../core/content/types';

export class PricingError extends Error {}

export type LinePricingStatus = 'priced' | 'on_request';
export type SelectionPricingStatus = 'fully_priced' | 'partially_priced' | 'quotation_required';

export interface PricingMandap {
  id: number;
  name: string;
  slug: string;
  category: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  price_starting_paise: number;
}

export interface PricingStage {
  id: number;
  name: string;
  slug: string;
  style_category: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  price_starting_paise: number;
}

export interface PricingCatalogue {
  mandaps: PricingMandap[];
  stages: PricingStage[];
  furniture: FurnitureItem[];
  catering: CateringPackage[];
}

export interface PricingSelection {
  mandap?: { id: string | number } | null;
  stage?: { id: string | number } | null;
  furniture?: Array<{ id: string | number; quantity: number }> | null;
  catering?: {
    id: string | number;
    guestCount: number;
    selectedItems?: Array<{ section: string; item: string }>;
  } | null;
}

export interface PricedSelectionLine {
  category: 'mandap' | 'stage' | 'furniture' | 'catering';
  itemId: string;
  name: string;
  quantity: number;
  unitPricePaise: number | null;
  subtotalPaise: number | null;
  pricingStatus: LinePricingStatus;
  metadata: Record<string, unknown>;
}

export interface SelectionPricing {
  items: PricedSelectionLine[];
  pricedSubtotalPaise: number;
  pricingStatus: SelectionPricingStatus;
  unpricedItemCount: number;
}

function toId(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PricingError('One of the selected catalogue items is invalid. Please refresh and try again.');
  }
  return parsed;
}

function toPositiveInteger(value: unknown, label: string): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100000) {
    throw new PricingError(`Enter a valid ${label}.`);
  }
  return parsed;
}

function line(
  category: PricedSelectionLine['category'],
  itemId: number | string,
  name: string,
  quantity: number,
  catalogueUnitPricePaise: number,
  metadata: Record<string, unknown>,
): PricedSelectionLine {
  const price = Number(catalogueUnitPricePaise);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      category,
      itemId: String(itemId),
      name,
      quantity,
      unitPricePaise: null,
      subtotalPaise: null,
      pricingStatus: 'on_request',
      metadata,
    };
  }

  return {
    category,
    itemId: String(itemId),
    name,
    quantity,
    unitPricePaise: price,
    subtotalPaise: price * quantity,
    pricingStatus: 'priced',
    metadata,
  };
}

/**
 * The single pricing calculation shared by the public enquiry estimate, the
 * server-side enquiry validation and direct booking checkout.
 *
 * A zero catalogue price is "on request", never free. Unpriced lines are
 * excluded from the priced subtotal and reported explicitly so the UI can show
 * a partial/quote-required state rather than a false final total.
 */
export function calculateSelectionPricing(
  catalogue: PricingCatalogue,
  selection: PricingSelection,
): SelectionPricing {
  const items: PricedSelectionLine[] = [];

  if (selection.mandap?.id) {
    const id = toId(selection.mandap.id);
    const mandap = catalogue.mandaps.find((entry) => Number(entry.id) === id);
    if (!mandap) throw new PricingError('The selected mandap is no longer available. Please choose another.');
    items.push(
      line('mandap', mandap.id, mandap.name, 1, mandap.price_starting_paise, {
        slug: mandap.slug,
        category: mandap.category,
        dimensions: `${mandap.length_ft} × ${mandap.width_ft} × ${mandap.height_ft} ${mandap.dimension_unit}`,
      }),
    );
  }

  if (selection.stage?.id) {
    const id = toId(selection.stage.id);
    const stage = catalogue.stages.find((entry) => Number(entry.id) === id);
    if (!stage) throw new PricingError('The selected stage design is no longer available. Please choose another.');
    items.push(
      line('stage', stage.id, stage.name, 1, stage.price_starting_paise, {
        slug: stage.slug,
        category: stage.style_category,
        dimensions: `${stage.length_ft} × ${stage.width_ft} × ${stage.height_ft} ${stage.dimension_unit}`,
      }),
    );
  }

  if (selection.furniture && selection.furniture.length > 0) {
    const quantities = new Map<number, number>();
    for (const entry of selection.furniture) {
      const id = toId(entry.id);
      const quantity = Math.floor(Number(entry.quantity) || 0);
      if (quantity <= 0) continue;
      quantities.set(id, (quantities.get(id) ?? 0) + quantity);
    }

    for (const [id, quantity] of quantities) {
      const item = catalogue.furniture.find((candidate) => Number(candidate.id) === id);
      if (!item) {
        throw new PricingError('One of the selected furniture items is no longer available. Please refresh your list.');
      }

      const minimum = Math.max(1, Number(item.min_quantity) || 1);
      if (quantity < minimum) {
        throw new PricingError(`${item.name} requires a minimum quantity of ${minimum}.`);
      }

      items.push(
        line('furniture', item.id, item.name, quantity, item.price_paise, {
          slug: item.slug,
          unit: item.pricing_unit,
          dimensions: item.dimensions,
          specifications: item.specifications,
          minQuantity: minimum,
        }),
      );
    }
  }

  if (selection.catering?.id) {
    const id = toId(selection.catering.id);
    const pkg = catalogue.catering.find((entry) => Number(entry.id) === id);
    if (!pkg) throw new PricingError('The selected catering package is no longer available.');

    const guestCount = toPositiveInteger(selection.catering.guestCount, 'catering guest count');
    const tiers = Array.isArray(pkg.guest_pricing) ? pkg.guest_pricing : [];
    const tier = tiers.find((entry: any) => Number(entry?.guest_count) === guestCount);
    const unitPrice = Number(tier?.price_per_plate_paise ?? pkg.price_per_plate_paise);
    const selectedItems = (selection.catering.selectedItems ?? []).map((entry) => ({
      section: String(entry.section ?? 'Menu'),
      item: String(entry.item ?? ''),
    }));

    items.push(
      line('catering', pkg.id, pkg.name, guestCount, unitPrice, {
        slug: pkg.slug,
        guestCount,
        tierGuestCount: tier ? Number(tier.guest_count) : null,
        pricePerPlatePaise: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null,
        menuSections: pkg.menu_sections ?? [],
        features: pkg.features ?? [],
        menuItems: selectedItems,
      }),
    );
  }

  const pricedSubtotalPaise = items.reduce(
    (sum, entry) => sum + (entry.pricingStatus === 'priced' ? entry.subtotalPaise ?? 0 : 0),
    0,
  );
  const unpricedItemCount = items.filter((entry) => entry.pricingStatus === 'on_request').length;
  const pricingStatus: SelectionPricingStatus =
    items.length === 0 || unpricedItemCount === items.length
      ? 'quotation_required'
      : unpricedItemCount > 0
        ? 'partially_priced'
        : 'fully_priced';

  return { items, pricedSubtotalPaise, pricingStatus, unpricedItemCount };
}

export function formatCataloguePrice(paise: number | null | undefined): string {
  const amount = Number(paise ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'Price on request';
  return `₹${(amount / 100).toLocaleString('en-IN')}`;
}

export function formatPricingStatus(status: SelectionPricingStatus): string {
  if (status === 'fully_priced') return 'Fully priced';
  if (status === 'partially_priced') return 'Partially priced — final quotation required';
  return 'Quotation required';
}
