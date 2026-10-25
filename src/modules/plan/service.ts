import { randomBytes } from 'node:crypto';
import { all, one, run, tx } from '../../core/db';
import { isEmail } from '../../core/http';

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
}

export interface PlanEquipmentCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  items: PlanEquipmentItem[];
}

export interface PlanCatalogue {
  mandaps: PlanMandap[];
  stages: PlanStage[];
  equipment: PlanEquipmentCategory[];
}

export function loadPlanCatalogue(): PlanCatalogue {
  const mandaps = all<PlanMandap>(
    `SELECT id, name, slug, description, image, category, length_ft, width_ft, height_ft,
            dimension_unit, material_specs
     FROM mandaps WHERE is_active = 1 ORDER BY sort, id`,
  );

  const stages = all<PlanStage>(
    `SELECT id, name, slug, description, image, style_category, length_ft, width_ft, height_ft,
            dimension_unit, decoration_notes
     FROM stages WHERE is_active = 1 ORDER BY sort, id`,
  );

  const categories = all<{ id: number; name: string; slug: string; icon: string }>(
    'SELECT id, name, slug, icon FROM equipment_categories WHERE is_active = 1 ORDER BY sort, id',
  );

  const items = all<PlanEquipmentItem & { category_id: number }>(
    `SELECT id, category_id, name, slug, description, image, unit, specifications,
            min_quantity, default_quantity
     FROM equipment_items WHERE is_active = 1 ORDER BY sort, id`,
  );

  const equipment = categories.map((category) => ({
    ...category,
    items: items.filter((item) => item.category_id === category.id),
  }));

  return { mandaps, stages, equipment };
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
  equipment?: EnquiryEquipmentPayload[];
  equipmentNotes?: unknown;
  accommodation?: { required?: unknown; roomCount?: unknown; notes?: unknown };
  styling?: { lighting?: unknown; floralPalette?: unknown; specialInstructions?: unknown };
  contact?: {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    budgetRange?: unknown;
    preferredContact?: unknown;
  };
}

interface LineInput {
  itemType: 'mandap' | 'stage' | 'equipment';
  catalogueItemId: number;
  name: string;
  quantity: number;
  dimensions: string;
  requestedLength: number | null;
  requestedWidth: number | null;
  requestedHeight: number | null;
  specifications: string;
  notes: string;
}

interface MandapRow {
  id: number;
  name: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  material_specs: string;
}

interface StageRow {
  id: number;
  name: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  dimension_unit: string;
  decoration_notes: string;
}

interface EquipmentRow {
  id: number;
  name: string;
  unit: string;
  specifications: string;
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

function selectedMandapLine(value: unknown): LineInput | null {
  if (!value) return null;
  const selection = record(value);
  const id = integer(selection.id, 0);
  if (id <= 0) throw new EnquiryError('Select a valid mandap or skip this step.');

  const row = one<MandapRow>(
    `SELECT id, name, length_ft, width_ft, height_ft, dimension_unit, material_specs
     FROM mandaps WHERE id = ? AND is_active = 1`,
    [id],
  );
  if (!row) throw new EnquiryError('The selected mandap is no longer available. Please choose another.');

  const requested = record(selection.requested);
  const length = optionalPositive(requested.length);
  const width = optionalPositive(requested.width);
  const height = optionalPositive(requested.height);
  const hasRequested = Boolean(length || width || height);

  return {
    itemType: 'mandap',
    catalogueItemId: row.id,
    name: row.name,
    quantity: 1,
    dimensions: `${row.length_ft} × ${row.width_ft} × ${row.height_ft} ${row.dimension_unit}`,
    requestedLength: hasRequested ? length : null,
    requestedWidth: hasRequested ? width : null,
    requestedHeight: hasRequested ? height : null,
    specifications: row.material_specs,
    notes: text(selection.note, 1000),
  };
}

function selectedStageLine(value: unknown): LineInput | null {
  if (!value) return null;
  const selection = record(value);
  const id = integer(selection.id, 0);
  if (id <= 0) throw new EnquiryError('Select a valid stage design or skip this step.');

  const row = one<StageRow>(
    `SELECT id, name, length_ft, width_ft, height_ft, dimension_unit, decoration_notes
     FROM stages WHERE id = ? AND is_active = 1`,
    [id],
  );
  if (!row) throw new EnquiryError('The selected stage is no longer available. Please choose another.');

  const requested = record(selection.requested);
  const length = optionalPositive(requested.length);
  const width = optionalPositive(requested.width);
  const height = optionalPositive(requested.height);
  const hasRequested = Boolean(length || width || height);

  return {
    itemType: 'stage',
    catalogueItemId: row.id,
    name: row.name,
    quantity: 1,
    dimensions: `${row.length_ft} × ${row.width_ft} × ${row.height_ft} ${row.dimension_unit}`,
    requestedLength: hasRequested ? length : null,
    requestedWidth: hasRequested ? width : null,
    requestedHeight: hasRequested ? height : null,
    specifications: row.decoration_notes,
    notes: text(selection.note, 1000),
  };
}

function selectedEquipmentLines(value: unknown): LineInput[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  if (value.length > 100) {
    throw new EnquiryError('Please reduce the equipment list to 100 lines or fewer.');
  }

  return value.map((entry) => {
    const selection = record(entry);
    const id = integer(selection.id, 0);
    if (id <= 0) throw new EnquiryError('One of the selected equipment items is invalid.');

    const row = one<EquipmentRow>(
      'SELECT id, name, unit, specifications FROM equipment_items WHERE id = ? AND is_active = 1',
      [id],
    );
    if (!row) {
      throw new EnquiryError('One of the selected equipment items is no longer available. Please refresh your list.');
    }

    const quantity = integer(selection.quantity, 1);
    if (quantity < 1 || quantity > 100000) {
      throw new EnquiryError(`Enter a valid quantity for ${row.name}.`);
    }

    return {
      itemType: 'equipment',
      catalogueItemId: row.id,
      name: row.name,
      quantity,
      dimensions: '',
      requestedLength: null,
      requestedWidth: null,
      requestedHeight: null,
      specifications: row.specifications,
      notes: text(selection.notes, 500),
    };
  });
}

function makeReferenceCode(): string {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const reference = `EP-${stamp}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const existing = one<{ id: number }>('SELECT id FROM event_enquiries WHERE reference_code = ?', [reference]);
    if (!existing) return reference;
  }

  throw new Error('Could not generate a unique enquiry reference.');
}

export function createEnquiry(payload: EnquiryPayload): { reference: string; id: number } {
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
  if (!budgetRange) throw new EnquiryError('Select an approximate budget range.');

  const preferredContact = text(contact.preferredContact, 20);
  if (!['Phone', 'WhatsApp', 'Email'].includes(preferredContact)) {
    throw new EnquiryError('Select a preferred contact method.');
  }

  const requiresRooms = Boolean(accommodation.required);
  const roomCount = requiresRooms ? integer(accommodation.roomCount, 0) : 0;
  if (requiresRooms && (roomCount < 1 || roomCount > 500)) {
    throw new EnquiryError('Enter the number of rooms required (between 1 and 500), or select No.');
  }

  const mandapLine = selectedMandapLine(payload.mandap);
  const stageLine = selectedStageLine(payload.stage);
  const equipmentLines = selectedEquipmentLines(payload.equipment);
  const lines = [mandapLine, stageLine, ...equipmentLines].filter((line): line is LineInput => Boolean(line));

  const decorationParts = [
    text(event.description, 2000) ? `Event description: ${text(event.description, 2000)}` : '',
    text(styling.lighting, 500) ? `Lighting: ${text(styling.lighting, 500)}` : '',
    text(styling.floralPalette, 500) ? `Floral palette: ${text(styling.floralPalette, 500)}` : '',
    text(styling.specialInstructions, 2000)
      ? `Special instructions: ${text(styling.specialInstructions, 2000)}`
      : '',
    text(payload.equipmentNotes, 2000) ? `Equipment notes: ${text(payload.equipmentNotes, 2000)}` : '',
  ].filter(Boolean);

  const reference = makeReferenceCode();

  const result = tx(() => {
    const enquiry = run(
      `INSERT INTO event_enquiries
         (reference_code, customer_name, customer_phone, customer_email, event_type, event_date, end_date,
          event_time, venue_location, guest_count, budget_range, requires_rooms, room_count,
          accommodation_notes, decoration_notes, preferred_contact, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      [
        reference,
        customerName,
        customerPhone,
        customerEmail || null,
        eventType,
        eventDate,
        endDate,
        text(event.time, 20) || null,
        venueLocation,
        guestCount,
        budgetRange,
        requiresRooms ? 1 : 0,
        roomCount,
        text(accommodation.notes, 2000),
        decorationParts.join('\n'),
        preferredContact,
      ],
    );

    for (const line of lines) {
      run(
        `INSERT INTO enquiry_line_items
           (enquiry_id, item_type, catalogue_item_id, item_name_snapshot, quantity,
            standard_dimensions_snapshot, requested_length_ft, requested_width_ft, requested_height_ft,
            specifications, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          enquiry.lastId,
          line.itemType,
          line.catalogueItemId,
          line.name,
          line.quantity,
          line.dimensions,
          line.requestedLength,
          line.requestedWidth,
          line.requestedHeight,
          line.specifications,
          line.notes,
        ],
      );
    }

    return { reference, id: enquiry.lastId };
  });

  return result;
}
