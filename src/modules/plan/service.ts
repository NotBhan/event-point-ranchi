import { randomBytes } from 'node:crypto';
import { isEmail } from '../../core/http';
import {
  getCateringPackages,
  getFurnitureCategories,
  getFurnitureItems,
  getMandaps,
  getStages,
} from '../../core/content/service';
import type { CateringPackage } from '../../core/content/types';
import { insertEventEnquiry } from '../../core/operational/service';
import { PricingError, priceEnquirySelection, type PricingCatalogue } from '../bookings/pricing';

export interface PlanMandap {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  category: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  material_specs: string;
  price_starting_paise: number;
}

export interface PlanStage {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  style_category: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  decoration_notes: string;
  price_starting_paise: number;
}

export interface PlanEquipmentItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  unit: string;
  specifications: string;
  min_quantity: number;
  default_quantity: number;
  price_paise: number;
  pricing_unit: string;
  dimensions: string;
}

export interface PlanEquipmentCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  items: PlanEquipmentItem[];
}

export interface PlanCateringPackage extends Omit<CateringPackage, 'image_url'> {
  image: string;
}

export interface PlanCatalogue {
  mandaps: PlanMandap[];
  stages: PlanStage[];
  equipment: PlanEquipmentCategory[];
  catering: PlanCateringPackage[];
  pricing: PricingCatalogue;
}

export async function loadPlanCatalogue(): Promise<PlanCatalogue> {
  const [mandaps, stages, categories, furniture, catering] = await Promise.all([
    getMandaps(),
    getStages(),
    getFurnitureCategories(),
    getFurnitureItems(),
    getCateringPackages(),
  ]);

  const planMandaps: PlanMandap[] = mandaps.map((entry) => ({
    id: Number(entry.id),
    name: entry.name,
    slug: entry.slug,
    description: entry.description,
    image: entry.image_url || null,
    category: entry.category,
    length_ft: Number(entry.length_ft),
    width_ft: Number(entry.width_ft),
    height_ft: Number(entry.height_ft),
    dimension_unit: entry.dimension_unit,
    material_specs: entry.material_specs,
    price_starting_paise: Number(entry.price_starting_paise ?? 0),
  }));

  const planStages: PlanStage[] = stages.map((entry) => ({
    id: Number(entry.id),
    name: entry.name,
    slug: entry.slug,
    description: entry.description,
    image: entry.image_url || null,
    style_category: entry.style_category,
    length_ft: Number(entry.length_ft),
    width_ft: Number(entry.width_ft),
    height_ft: Number(entry.height_ft),
    dimension_unit: entry.dimension_unit,
    decoration_notes: entry.decoration_notes,
    price_starting_paise: Number(entry.price_starting_paise ?? 0),
  }));

  const equipment: PlanEquipmentCategory[] = categories.map((category) => ({
    id: Number(category.id),
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    items: furniture
      .filter((item) => Number(item.category_id) === Number(category.id))
      .map((item) => ({
        id: Number(item.id),
        name: item.name,
        slug: item.slug,
        description: item.description,
        image: item.image_url || null,
        unit: item.pricing_unit,
        specifications: item.specifications,
        min_quantity: Number(item.min_quantity ?? 1),
        default_quantity: Number(item.default_quantity ?? 1),
        price_paise: Number(item.price_paise ?? 0),
        pricing_unit: item.pricing_unit,
        dimensions: item.dimensions,
      })),
  }));

  const planCatering: PlanCateringPackage[] = catering.map((entry) => ({
    ...entry,
    image: entry.image_url || '',
  }));

  return {
    mandaps: planMandaps,
    stages: planStages,
    equipment,
    catering: planCatering,
    pricing: {
      mandaps: planMandaps,
      stages: planStages,
      furniture,
      catering,
    },
  };
}

export class EnquiryError extends Error {}

export interface EnquirySelectionPayload {
  id?: unknown;
  name?: unknown;
  requested?: {
    length?: unknown;
    width?: unknown;
    height?: unknown;
    unit?: unknown;
  } | null;
  note?: unknown;
}

export interface EnquiryEquipmentPayload {
  id?: unknown;
  quantity?: unknown;
  notes?: unknown;
}

export interface EnquiryPayload {
  event?: {
    type?: unknown;
    date?: unknown;
    endDate?: unknown;
    time?: unknown;
    venue?: unknown;
    guestCount?: unknown;
    description?: unknown;
  };
  mandap?: EnquirySelectionPayload | null;
  stage?: EnquirySelectionPayload | null;
  furniture?: EnquiryEquipmentPayload[];
  equipment?: EnquiryEquipmentPayload[];
  equipmentNotes?: unknown;
  catering?: {
    id?: unknown;
    guestCount?: unknown;
    notes?: unknown;
    selectedItems?: Array<{ section?: unknown; item?: unknown }>;
  } | null;
  cateringNotes?: unknown;
  additionalServices?: unknown;
  accommodation?: {
    required?: unknown;
    roomCount?: unknown;
    acRoomCount?: unknown;
    nonAcRoomCount?: unknown;
    notes?: unknown;
  };
  styling?: { lighting?: unknown; floralPalette?: unknown; specialInstructions?: unknown };
  contact?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    budgetRange?: unknown;
    preferredContact?: unknown;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, maxLength = 500): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalPositive(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 10) / 10;
}

function normalizePhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  const national =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;

  if (!/^[6-9]\d{9}$/.test(national)) {
    throw new EnquiryError('Enter a valid 10-digit Indian mobile number.');
  }
  return national;
}

function validDate(value: unknown, label: string): string {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new EnquiryError(`${label} is required and must use the YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new EnquiryError(`${label} is not a valid calendar date.`);
  }
  return date;
}

interface EnquiryLineInput {
  itemType: 'mandap' | 'stage' | 'furniture' | 'equipment' | 'catering';
  catalogueItemId: number;
  name: string;
  quantity: number;
  dimensions: string;
  requestedLength: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  specifications: string;
  notes: string;
  catalogueUnitPricePaise: number | null;
  catalogueSubtotalPaise: number | null;
  pricingStatus: 'priced' | 'on_request';
  metadata: Record<string, unknown>;
}

/**
 * Reference codes are unique by database constraint; this only proposes a
 * candidate. `insertEventEnquiry` retries with another candidate when the
 * constraint rejects one, so no pre-flight SELECT is needed.
 */
function makeReferenceCode(): string {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `EP-${stamp}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

function pricedLine(
  pricing: Awaited<ReturnType<typeof priceEnquirySelection>>,
  category: 'mandap' | 'stage' | 'furniture' | 'catering',
) {
  return pricing.items.find((line) => line.category === category) ?? null;
}

function requestedDimensions(value: EnquirySelectionPayload | null | undefined): {
  length: number | null;
  width: number | null;
  height: number | null;
} {
  const requested = record(value?.requested);
  const length = optionalPositive(requested.length);
  const width = optionalPositive(requested.width);
  const height = optionalPositive(requested.height);
  const hasRequested = Boolean(length || width || height);
  return {
    length: hasRequested ? length : null,
    width: hasRequested ? width : null,
    height: hasRequested ? height : null,
  };
}

export async function createEnquiry(
  payload: EnquiryPayload,
): Promise<{
  reference: string;
  id: number;
  pricing: Awaited<ReturnType<typeof priceEnquirySelection>>;
}> {
  if (!payload || typeof payload !== 'object') {
    throw new EnquiryError('We could not read the enquiry details. Please refresh and try again.');
  }

  const event = record(payload.event);
  const contact = record(payload.contact);
  const accommodation = record(payload.accommodation);
  const styling = record(payload.styling);

  const customerName = text(contact.name, 120);
  if (customerName.length < 2) throw new EnquiryError('Please enter your full name.');

  const customerPhone = normalizePhone(contact.phone);
  const customerEmail = text(contact.email, 160);
  if (customerEmail && !isEmail(customerEmail)) {
    throw new EnquiryError('Enter a valid email address, or leave it blank.');
  }

  const eventType = text(event.type, 80);
  if (!eventType) throw new EnquiryError('Select an event type.');

  const eventDate = validDate(event.date, 'Event date');
  const today = new Date().toISOString().slice(0, 10);
  if (eventDate < today) throw new EnquiryError('The event date cannot be in the past.');

  const endDateRaw = text(event.endDate, 10);
  const endDate = endDateRaw ? validDate(endDateRaw, 'End date') : null;
  if (endDate && endDate < eventDate) {
    throw new EnquiryError('The end date cannot be before the event start date.');
  }

  const venueLocation = text(event.venue, 240);
  if (venueLocation.length < 2) throw new EnquiryError('Enter the event venue or location in Ranchi.');

  const guestCount = integer(event.guestCount, 0);
  if (guestCount < 1 || guestCount > 100000) {
    throw new EnquiryError('Enter a guest count between 1 and 1,00,000.');
  }

  const budgetRange = text(contact.budgetRange, 120);

  const preferredContact = text(contact.preferredContact, 20);
  if (!['Phone', 'WhatsApp', 'Email'].includes(preferredContact)) {
    throw new EnquiryError('Select a preferred contact method.');
  }

  const requiresRooms = Boolean(accommodation.required);
  const acRoomCount = requiresRooms ? integer(accommodation.acRoomCount, 0) : 0;
  const nonAcRoomCount = requiresRooms ? integer(accommodation.nonAcRoomCount, 0) : 0;
  let roomCount = requiresRooms ? integer(accommodation.roomCount, 0) : 0;
  if (requiresRooms) {
    if (acRoomCount + nonAcRoomCount > 0) {
      roomCount = acRoomCount + nonAcRoomCount;
    }
    if (roomCount < 1 || roomCount > 500) {
      throw new EnquiryError('Enter the number of rooms required (between 1 and 500 across AC and Non-AC), or select No.');
    }
  }

  const furniturePayload = Array.isArray(payload.furniture)
    ? payload.furniture
    : Array.isArray(payload.equipment)
      ? payload.equipment
      : [];
  const furnitureItemType: 'furniture' | 'equipment' = Array.isArray(payload.furniture)
    ? 'furniture'
    : 'equipment';
  const cateringId = payload.catering?.id ? integer(payload.catering.id, 0) : 0;
  const cateringSelectedItems = Array.isArray(payload.catering?.selectedItems)
    ? payload.catering.selectedItems
        .map((entry) => {
          const raw = record(entry);
          return {
            section: text(raw.section, 120) || 'Menu',
            item: text(raw.item, 160),
          };
        })
        .filter((entry) => entry.item)
    : [];
  const hasCatalogueSelection =
    Boolean(payload.mandap?.id) ||
    Boolean(payload.stage?.id) ||
    furniturePayload.some((entry) => integer(entry.id, 0) > 0) ||
    cateringId > 0;

  let pricing: Awaited<ReturnType<typeof priceEnquirySelection>> = {
    items: [],
    pricedSubtotalPaise: 0,
    pricingStatus: 'quotation_required',
    unpricedItemCount: 0,
  };
  let planCatalogue: PlanCatalogue | null = null;

  if (hasCatalogueSelection) {
    try {
      planCatalogue = await loadPlanCatalogue();
      pricing = await priceEnquirySelection(
        {
          mandap: payload.mandap?.id ? { id: payload.mandap.id as string | number } : null,
          stage: payload.stage?.id ? { id: payload.stage.id as string | number } : null,
          furniture: furniturePayload
            .map((entry) => ({ id: entry.id as string | number, quantity: integer(entry.quantity, 0) }))
            .filter((entry) => entry.quantity > 0),
          catering: cateringId > 0
            ? { id: cateringId, guestCount, selectedItems: cateringSelectedItems }
            : null,
        },
        planCatalogue.pricing,
      );
    } catch (error) {
      if (error instanceof PricingError) throw new EnquiryError(error.message);
      throw error;
    }
  }

  const lines: EnquiryLineInput[] = [];

  if (payload.mandap?.id) {
    const id = integer(payload.mandap.id, 0);
    const item = planCatalogue?.mandaps.find((entry) => entry.id === id);
    const priced = pricedLine(pricing, 'mandap');
    if (!item || !priced) throw new EnquiryError('The selected mandap is no longer available. Please choose another.');
    const requested = requestedDimensions(payload.mandap);
    lines.push({
      itemType: 'mandap',
      catalogueItemId: id,
      name: item.name,
      quantity: 1,
      dimensions: `${item.length_ft} × ${item.width_ft} × ${item.height_ft} ${item.dimension_unit}`,
      requestedLength: requested.length,
      requestedWidth: requested.width,
      requestedHeight: requested.height,
      specifications: item.material_specs,
      notes: text(payload.mandap.note, 1000),
      catalogueUnitPricePaise: priced.unitPricePaise,
      catalogueSubtotalPaise: priced.subtotalPaise,
      pricingStatus: priced.pricingStatus,
      metadata: priced.metadata,
    });
  }

  if (payload.stage?.id) {
    const id = integer(payload.stage.id, 0);
    const item = planCatalogue?.stages.find((entry) => entry.id === id);
    const priced = pricedLine(pricing, 'stage');
    if (!item || !priced) throw new EnquiryError('The selected stage design is no longer available. Please choose another.');
    const requested = requestedDimensions(payload.stage);
    lines.push({
      itemType: 'stage',
      catalogueItemId: id,
      name: item.name,
      quantity: 1,
      dimensions: `${item.length_ft} × ${item.width_ft} × ${item.height_ft} ${item.dimension_unit}`,
      requestedLength: requested.length,
      requestedWidth: requested.width,
      requestedHeight: requested.height,
      specifications: item.decoration_notes,
      notes: text(payload.stage.note, 1000),
      catalogueUnitPricePaise: priced.unitPricePaise,
      catalogueSubtotalPaise: priced.subtotalPaise,
      pricingStatus: priced.pricingStatus,
      metadata: priced.metadata,
    });
  }

  for (const priced of pricing.items.filter((line) => line.category === 'furniture')) {
    const catalogueId = Number(priced.itemId);
    const source = furniturePayload.find((entry) => integer(entry.id, 0) === catalogueId);
    const item = planCatalogue?.pricing.furniture.find((entry) => Number(entry.id) === catalogueId);
    lines.push({
      itemType: furnitureItemType,
      catalogueItemId: catalogueId,
      name: priced.name,
      quantity: priced.quantity,
      dimensions: String(priced.metadata.dimensions ?? item?.dimensions ?? ''),
      requestedLength: null,
      requestedWidth: null,
      requestedHeight: null,
      specifications: item?.specifications ?? '',
      notes: text(source?.notes, 500),
      catalogueUnitPricePaise: priced.unitPricePaise,
      catalogueSubtotalPaise: priced.subtotalPaise,
      pricingStatus: priced.pricingStatus,
      metadata: priced.metadata,
    });
  }

  if (cateringId > 0) {
    const priced = pricedLine(pricing, 'catering');
    const pkg = planCatalogue?.catering.find((entry) => entry.id === cateringId);
    if (!priced || !pkg) throw new EnquiryError('The selected catering package is no longer available.');
    lines.push({
      itemType: 'catering',
      catalogueItemId: cateringId,
      name: pkg.name,
      quantity: guestCount,
      dimensions: '',
      requestedLength: null,
      requestedWidth: null,
      requestedHeight: null,
      specifications: (pkg.features ?? []).join(', '),
      notes: text(payload.catering?.notes ?? payload.cateringNotes, 1000),
      catalogueUnitPricePaise: priced.unitPricePaise,
      catalogueSubtotalPaise: priced.subtotalPaise,
      pricingStatus: priced.pricingStatus,
      metadata: priced.metadata,
    });
  }

  const decorationParts = [
    text(event.description, 2000) ? `Event description: ${text(event.description, 2000)}` : '',
    text(styling.lighting, 500) ? `Lighting: ${text(styling.lighting, 500)}` : '',
    text(styling.floralPalette, 500) ? `Floral palette: ${text(styling.floralPalette, 500)}` : '',
    text(styling.specialInstructions, 2000)
      ? `Special instructions: ${text(styling.specialInstructions, 2000)}`
      : '',
    text(payload.equipmentNotes, 2000) ? `Equipment notes: ${text(payload.equipmentNotes, 2000)}` : '',
    text(payload.cateringNotes, 2000) ? `Catering notes: ${text(payload.cateringNotes, 2000)}` : '',
  ].filter(Boolean);

  const accommodationBreakdown = requiresRooms && (acRoomCount > 0 || nonAcRoomCount > 0)
    ? `Rooms requested: ${acRoomCount} AC, ${nonAcRoomCount} Non-AC (${roomCount} total)`
    : '';
  const accommodationNotes = [accommodationBreakdown, text(accommodation.notes, 2000)].filter(Boolean).join('\n');
  const additionalServices = text(payload.additionalServices, 2000);
  const reference = makeReferenceCode();

  const saved = await insertEventEnquiry(
    {
      customerName,
      customerPhone,
      customerEmail: customerEmail || null,
      eventType,
      eventDate,
      endDate,
      eventTime: text(event.time, 20) || null,
      venueLocation,
      guestCount,
      budgetRange,
      requiresRooms,
      roomCount,
      accommodationNotes,
      decorationNotes: decorationParts.join('\n'),
      preferredContact,
      pricingStatus: pricing.pricingStatus,
      pricedSubtotalPaise: pricing.pricedSubtotalPaise,
      pricingBreakdownJson: JSON.stringify(pricing),
      additionalServices,
    },
    lines.map((line) => ({
      itemType: line.itemType,
      catalogueItemId: line.catalogueItemId,
      name: line.name,
      quantity: line.quantity,
      dimensions: line.dimensions,
      requestedLength: line.requestedLength,
      requestedWidth: line.requestedWidth,
      requestedHeight: line.requestedHeight,
      specifications: line.specifications,
      notes: line.notes,
      catalogueUnitPricePaise: line.catalogueUnitPricePaise,
      catalogueSubtotalPaise: line.catalogueSubtotalPaise,
      pricingStatus: line.pricingStatus,
      metadata: line.metadata,
    })),
    (attempt) => (attempt === 0 ? reference : makeReferenceCode()),
  );

  return { reference: saved.referenceCode, id: saved.id, pricing };
}
