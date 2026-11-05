import {
  REQUIREMENTS_EVENT,
  addEquipment,
  addMandap,
  addStage,
  consumeRequirementsForPlan,
  formatDimensions,
  prepareRequirementsHandoff,
  readRequirements,
  removeLineItem,
  setSelectionDimensions,
  updateQuantity,
  type DimensionSet,
  type EquipmentRequirement,
  type MandapRequirement,
  type StageRequirement,
} from './requirements';
import { clearEnquiryBrowserState } from './enquiry-state';
import {
  groupCateringItems,
  readCateringHandoff,
  summariseCateringItems,
  type CateringHandoff,
} from './catering-handoff';
import {
  defaultPlanMenuItems,
  normalisePlanMenuSections,
  planMenuItemsPreview,
} from './plan-catering';
import type { CartMenuItem } from './cart';
import {
  calculateSelectionPricing,
  formatCataloguePrice,
  formatPricingStatus,
  PricingError,
  type PricingCatalogue,
  type SelectionPricing,
} from '../modules/bookings/pricing-core';

interface CatalogueMandap {
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

interface CatalogueStage {
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

interface CatalogueEquipmentItem {
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

interface CatalogueEquipmentCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  items: CatalogueEquipmentItem[];
}

interface CatalogueCateringPackage {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string;
  price_per_plate_paise: number;
  features: string[];
  guest_pricing: Array<{ guest_count: number; price_per_plate_paise: number }>;
  menu_sections: any[];
}

interface PlanCatalogue {
  mandaps: CatalogueMandap[];
  stages: CatalogueStage[];
  equipment: CatalogueEquipmentCategory[];
  catering: CatalogueCateringPackage[];
  pricing: PricingCatalogue;
}

interface PlanDraft {
  step: number;
  eventType: string;
  eventDate: string;
  endDate: string;
  eventTime: string;
  venueLocation: string;
  guestCount: string;
  eventDescription: string;
  mandapId: string;
  mandapLength: string;
  mandapWidth: string;
  mandapHeight: string;
  mandapNotes: string;
  stageId: string;
  stageLength: string;
  stageWidth: string;
  stageHeight: string;
  stageNotes: string;
  lighting: string;
  floralPalette: string;
  specialInstructions: string;
  equipmentNotes: string;
  cateringPackageId: string;
  cateringNotes: string;
  additionalServices: string;
  requiresRooms: string;
  roomCount: string;
  acRoomCount: string;
  nonAcRoomCount: string;
  accommodationNotes: string;
  budgetRange: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  preferredContact: string;
}

type DimensionResult = DimensionSet | null | 'invalid';
type CateringMenuMode = 'default' | 'custom';

const STEP_LABELS = [
  'Event & Venue Essentials',
  'Mandap & Stage Architecture',
  'Seating, Equipment & Hospitality',
  'Contact & Quotation Review',
];

const form = document.getElementById('planForm') as HTMLFormElement | null;
const catalogueNode = document.getElementById('planCatalogue');
const planShell = document.getElementById('planShell');
const receipt = document.querySelector<HTMLElement>('[data-plan-receipt]');
const errorBox = document.querySelector<HTMLElement>('[data-plan-error]');
const progressText = document.querySelector<HTMLElement>('[data-plan-progress-text]');
const progressBar = document.querySelector<HTMLElement>('[data-plan-progress-bar]');
const steps = Array.from(document.querySelectorAll<HTMLElement>('[data-plan-step]'));
const progressButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-plan-step-link]'));
const cateringMenuDialog = document.querySelector<HTMLDialogElement>('[data-catering-menu-dialog]');

const state: {
  catalogue: PlanCatalogue;
  currentStep: number;
  activeEquipmentCategory: string;
} | null = form && catalogueNode
  ? {
      catalogue: JSON.parse(
        catalogueNode.textContent ??
          '{"mandaps":[],"stages":[],"equipment":[],"catering":[],"pricing":{"mandaps":[],"stages":[],"furniture":[],"catering":[]}}',
      ) as PlanCatalogue,
      currentStep: 1,
      activeEquipmentCategory: '',
    }
  : null;

const today = form?.dataset.today ?? new Date().toISOString().slice(0, 10);
const csrf = form?.dataset.csrf ?? '';
let carriedCatering: CateringHandoff | null = null;
let carriedCateringMode: CateringMenuMode = 'default';
let planCatering: CateringHandoff | null = null;
let planCateringMode: CateringMenuMode = 'default';
let cateringMenuPackageId = '';
let cateringMenuMode: CateringMenuMode = 'default';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let planRenderQueued = false;

function schedulePlanRender(): void {
  if (planRenderQueued) return;
  planRenderQueued = true;
  requestAnimationFrame(() => {
    planRenderQueued = false;
    renderLiveSummary();
    if (state?.currentStep === 4) renderReview();
  });
}

function field<T extends HTMLElement = HTMLInputElement>(name: string): T | null {
  const element = form?.elements.namedItem(name);
  return element instanceof HTMLElement ? (element as T) : null;
}

function fieldValue(name: string): string {
  return field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name)?.value.trim() ?? '';
}

function radioValue(name: string): string {
  const checked = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked?.value ?? '';
}

function setFieldError(fieldElement: HTMLElement | null, message: string): void {
  if (!fieldElement) return;
  fieldElement.classList.add('is-invalid');
  const parent = fieldElement.closest('.field') || fieldElement.closest('.field-group') || fieldElement.closest('.plan-consent') || fieldElement.parentElement;
  if (parent) {
    let err = parent.querySelector<HTMLElement>('.field-error-msg');
    if (!err) {
      err = document.createElement('span');
      err.className = 'field-error-msg';
      parent.appendChild(err);
    }
    err.textContent = message;
  }
}

function clearFieldError(fieldElement: HTMLElement | null): void {
  if (!fieldElement) return;
  fieldElement.classList.remove('is-invalid');
  const parent = fieldElement.closest('.field') || fieldElement.closest('.field-group') || fieldElement.closest('.plan-consent') || fieldElement.parentElement;
  if (parent) {
    const err = parent.querySelector('.field-error-msg');
    if (err) err.remove();
  }
}

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
  // Announced through role="alert" and focused for assistive technology. The
  // deliberate scroll target is the offending field (see fail()), so there is
  // exactly one scroll and it always lands on something the visitor can fix.
  errorBox.focus({ preventScroll: true });
}

function clearError(): void {
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }
  document.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  document.querySelectorAll('.field-error-msg').forEach((el) => el.remove());
}

function collectDraft(): PlanDraft {
  return {
    step: state?.currentStep ?? 1,
    eventType: fieldValue('eventType'),
    eventDate: fieldValue('eventDate'),
    endDate: fieldValue('endDate'),
    eventTime: fieldValue('eventTime'),
    venueLocation: fieldValue('venueLocation'),
    guestCount: fieldValue('guestCount'),
    eventDescription: fieldValue('eventDescription'),
    mandapId: fieldValue('mandapId'),
    mandapLength: fieldValue('mandapLength'),
    mandapWidth: fieldValue('mandapWidth'),
    mandapHeight: fieldValue('mandapHeight'),
    mandapNotes: fieldValue('mandapNotes'),
    stageId: fieldValue('stageId'),
    stageLength: fieldValue('stageLength'),
    stageWidth: fieldValue('stageWidth'),
    stageHeight: fieldValue('stageHeight'),
    stageNotes: fieldValue('stageNotes'),
    lighting: fieldValue('lighting') || 'Warm fairy lights',
    floralPalette: fieldValue('floralPalette') || 'Maroon & ivory',
    specialInstructions: fieldValue('specialInstructions'),
    equipmentNotes: fieldValue('equipmentNotes'),
    cateringPackageId: fieldValue('cateringPackageId'),
    cateringNotes: fieldValue('cateringNotes'),
    additionalServices: fieldValue('additionalServices'),
    requiresRooms: radioValue('requiresRooms') || 'no',
    roomCount: fieldValue('roomCount'),
    acRoomCount: fieldValue('acRoomCount'),
    nonAcRoomCount: fieldValue('nonAcRoomCount'),
    accommodationNotes: fieldValue('accommodationNotes'),
    budgetRange: fieldValue('budgetRange'),
    customerName: fieldValue('customerName'),
    customerPhone: fieldValue('customerPhone'),
    customerEmail: fieldValue('customerEmail'),
    preferredContact: fieldValue('preferredContact'),
  };
}

function syncRoomField(): void {
  const wantsRooms = radioValue('requiresRooms') === 'yes';
  const container = document.querySelector<HTMLElement>('[data-room-count-field]');
  const roomInput = document.querySelector<HTMLInputElement>('[data-room-count-input]');
  const acInput = document.querySelector<HTMLInputElement>('[data-ac-room-input]');
  const nonAcInput = document.querySelector<HTMLInputElement>('[data-non-ac-room-input]');
  if (container) container.hidden = !wantsRooms;
  if (acInput && nonAcInput && roomInput) {
    if (!wantsRooms) {
      acInput.value = '';
      nonAcInput.value = '';
      roomInput.value = '';
    } else {
      const ac = Number(acInput.value) || 0;
      const nonAc = Number(nonAcInput.value) || 0;
      const total = ac + nonAc;
      roomInput.value = total > 0 ? String(total) : '';
    }
  }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function customDimensions(kind: 'mandap' | 'stage'): DimensionResult {
  const length = field<HTMLInputElement>(`${kind}Length`)?.value.trim() ?? '';
  const width = field<HTMLInputElement>(`${kind}Width`)?.value.trim() ?? '';
  const height = field<HTMLInputElement>(`${kind}Height`)?.value.trim() ?? '';
  const values = [length, width, height];
  const filled = values.filter((value) => value !== '').length;

  if (filled === 0) return null;
  const numbers = values.map((value) => Number(value));
  if (filled < 3 || numbers.some((value) => !Number.isFinite(value) || value <= 0)) return 'invalid';

  return { length: numbers[0], width: numbers[1], height: numbers[2], unit: 'ft' };
}

function validateStep(step: number): boolean {
  clearError();

  // Phase 1: Event & Venue Essentials
  if (step === 1) {
    if (!fieldValue('eventType')) return fail('Select an event celebration type to continue.', 'eventType');
    if (!isValidDate(fieldValue('eventDate'))) return fail('Enter a valid event date.', 'eventDate');
    if (fieldValue('eventDate') < today) return fail('The event date cannot be in the past.', 'eventDate');

    const endDate = fieldValue('endDate');
    if (endDate) {
      if (!isValidDate(endDate)) return fail('Enter a valid end date, or leave it blank.', 'endDate');
      if (endDate < fieldValue('eventDate')) return fail('The end date cannot be before the event date.', 'endDate');
    }

    if (fieldValue('venueLocation').length < 2) return fail('Enter the venue or location in Ranchi.', 'venueLocation');
    const guests = Number(fieldValue('guestCount'));
    if (!Number.isInteger(guests) || guests < 1 || guests > 100000) {
      return fail('Enter an estimated guest count between 1 and 1,00,000.', 'guestCount');
    }
  }

  // Phase 2: Mandap, Stage & Styling Architecture
  if (step === 2) {
    const mandapDim = customDimensions('mandap');
    if (mandapDim === 'invalid') {
      return fail('Enter all three custom mandap dimensions in feet (Length, Width, Height), or leave them blank.', 'mandapLength');
    }
    if (!fieldValue('mandapId') && mandapDim) {
      return fail('Select a mandap design before configuring custom dimensions.', 'mandapLength');
    }

    const stageDim = customDimensions('stage');
    if (stageDim === 'invalid') {
      return fail('Enter all three custom stage dimensions in feet (Length, Width, Height), or leave them blank.', 'stageLength');
    }
    if (!fieldValue('stageId') && stageDim) {
      return fail('Select a stage design before configuring custom dimensions.', 'stageLength');
    }
  }

  // Phase 3: Seating, Equipment & Hospitality
  if (step === 3) {
    const requiresRooms = radioValue('requiresRooms');
    if (!requiresRooms) return fail('Tell us whether you require hotel room arrangements in Ranchi.', 'requiresRooms');
    if (requiresRooms === 'yes') {
      const ac = Number(fieldValue('acRoomCount')) || 0;
      const nonAc = Number(fieldValue('nonAcRoomCount')) || 0;
      const rooms = ac + nonAc;
      if (!Number.isInteger(rooms) || rooms < 1 || rooms > 500) {
        return fail('Enter the number of AC and/or Non-AC rooms required (at least 1 room in total, up to 500).', 'acRoomCount');
      }
    }
  }

  // Phase 4: Contact & Review
  if (step === 4) {
    if (fieldValue('customerName').length < 2) return fail('Enter your full name.', 'customerName');
    const digits = fieldValue('customerPhone').replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return fail('Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.', 'customerPhone');
    }
    const email = fieldValue('customerEmail');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail('Enter a valid email address, or leave it blank.', 'customerEmail');
    }
    if (!fieldValue('preferredContact')) return fail('Select a preferred contact method.', 'preferredContact');

    const consent = field<HTMLInputElement>('consent');
    if (!consent?.checked) {
      return fail('Please confirm that you understand this is a quotation enquiry, not an instant booking.', 'consent');
    }
  }

  return true;
}

function fail(message: string, fieldName?: string): false {
  showError(message);
  if (fieldName) {
    let targetEl: HTMLElement | null = field(fieldName);
    if (!targetEl) {
      targetEl = document.querySelector<HTMLElement>(`[name="${fieldName}"]`);
    }
    if (targetEl) {
      // A blocked field can live inside a closed <details> accordion (custom
      // mandap/stage dimensions). Without opening it, the error is added to an
      // invisible field and Continue looks unresponsive.
      const details = targetEl.closest('details');
      if (details) details.open = true;

      setFieldError(targetEl, message);
      // 'instant' rather than 'auto': the stylesheet sets scroll-behavior:
      // smooth globally, which would make 'auto' animate and leave a window
      // where a blocked step looks like a button that did nothing.
      targetEl.scrollIntoView({ behavior: 'instant', block: 'center' });
      targetEl.focus({ preventScroll: true });
    }
  }
  return false;
}

function goToStep(step: number, focus = true): void {
  if (!state) return;
  const target = Math.min(Math.max(step, 1), steps.length);
  state.currentStep = target;

  steps.forEach((section) => {
    section.hidden = Number(section.dataset.planStep) !== target;
  });

  progressButtons.forEach((button) => {
    const value = Number(button.dataset.planStepLink);
    const isActive = value === target;
    const isComplete = value < target;
    button.classList.toggle('is-active', isActive);
    button.classList.toggle('is-complete', isComplete);
    if (isActive) {
      button.setAttribute('aria-current', 'step');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  if (progressBar) {
    const percent = Math.round((target / steps.length) * 100);
    progressBar.style.width = `${percent}%`;
  }

  const prev = document.querySelector<HTMLButtonElement>('[data-plan-prev]');
  const next = document.querySelector<HTMLButtonElement>('[data-plan-next]');
  if (prev) prev.hidden = target === 1;
  if (next) next.hidden = target === steps.length;

  if (progressText) {
    progressText.textContent = `Phase ${target} of ${steps.length} — ${STEP_LABELS[target - 1] ?? ''}`;
  }

  if (target === 4) {
    renderReview();
  }

  if (focus) {
    const active = steps[target - 1];
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const heading = active.querySelector<HTMLElement>('h2');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    }
  }
}

function selectionFor(kind: 'mandap' | 'stage'): MandapRequirement | StageRequirement | null {
  const requirements = readRequirements();
  return kind === 'mandap' ? requirements.mandap : requirements.stage;
}

function dimensionsSummary(selection: MandapRequirement | StageRequirement | null): string {
  if (!selection) return '';
  const requested = selection.requested;
  if (requested && requested.length > 0 && requested.width > 0 && requested.height > 0) {
    return `Custom ${formatDimensions(requested)} · Standard ${formatDimensions(selection.standard)}`;
  }
  return `Standard ${formatDimensions(selection.standard)}`;
}

// Visual Card Selection Sync
function syncMandapCardSelection(): void {
  const selection = selectionFor('mandap');
  const selectedId = selection?.id ?? '';
  const select = field<HTMLSelectElement>('mandapId');
  if (select) select.value = selectedId;

  document.querySelectorAll<HTMLElement>('[data-plan-mandap-card]').forEach((card) => {
    const cardId = card.dataset.planMandapCard ?? '';
    const isSelected = cardId === selectedId;
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-checked', String(isSelected));

    const btn = card.querySelector<HTMLButtonElement>('.card-select-btn');
    if (btn) {
      btn.textContent = isSelected ? '✓ Selected' : 'Select Mandap';
      btn.classList.toggle('btn-primary', isSelected);
      btn.classList.toggle('btn-secondary', !isSelected);
    }
  });

  const accordion = document.querySelector<HTMLDetailsElement>('[data-mandap-dimension-accordion]');
  if (accordion) {
    if (selection?.requested) accordion.open = true;
  }
}

function syncStageCardSelection(): void {
  const selection = selectionFor('stage');
  const selectedId = selection?.id ?? '';
  const select = field<HTMLSelectElement>('stageId');
  if (select) select.value = selectedId;

  document.querySelectorAll<HTMLElement>('[data-plan-stage-card]').forEach((card) => {
    const cardId = card.dataset.planStageCard ?? '';
    const isSelected = cardId === selectedId;
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-checked', String(isSelected));

    const btn = card.querySelector<HTMLButtonElement>('.card-select-btn');
    if (btn) {
      btn.textContent = isSelected ? '✓ Selected' : 'Select Stage';
      btn.classList.toggle('btn-primary', isSelected);
      btn.classList.toggle('btn-secondary', !isSelected);
    }
  });

  const accordion = document.querySelector<HTMLDetailsElement>('[data-stage-dimension-accordion]');
  if (accordion) {
    if (selection?.requested) accordion.open = true;
  }
}

function syncStylingSwatches(): void {
  const lightingVal = fieldValue('lighting') || 'Warm fairy lights';
  const floralVal = fieldValue('floralPalette') || 'Maroon & ivory';

  document.querySelectorAll<HTMLElement>('[data-plan-lighting-swatch]').forEach((el) => {
    const isSelected = el.dataset.planLightingSwatch === lightingVal;
    el.classList.toggle('is-selected', isSelected);
    el.setAttribute('aria-checked', String(isSelected));
  });

  document.querySelectorAll<HTMLElement>('[data-plan-floral-swatch]').forEach((el) => {
    const isSelected = el.dataset.planFloralSwatch === floralVal;
    el.classList.toggle('is-selected', isSelected);
    el.setAttribute('aria-checked', String(isSelected));
  });
}

function applySelection(kind: 'mandap' | 'stage', id: string): void {
  if (!state) return;

  if (!id) {
    removeLineItem(kind);
    syncSelectionInputs(kind);
    if (kind === 'mandap') syncMandapCardSelection();
    else syncStageCardSelection();
    renderLiveSummary();
    return;
  }

  if (kind === 'mandap') {
    const item = state.catalogue.mandaps.find((entry) => String(entry.id) === id);
    if (!item) return;
    const existing = readRequirements().mandap;
    addMandap({
      id: String(item.id),
      slug: item.slug,
      name: item.name,
      category: item.category,
      image: item.image ?? '',
      standard: {
        length: item.length_ft,
        width: item.width_ft,
        height: item.height_ft,
        unit: item.dimension_unit,
      },
      requested: existing?.id === String(item.id) ? existing.requested : null,
      note: existing?.id === String(item.id) ? existing.note : '',
    });
    syncMandapCardSelection();
  } else {
    const item = state.catalogue.stages.find((entry) => String(entry.id) === id);
    if (!item) return;
    const existing = readRequirements().stage;
    addStage({
      id: String(item.id),
      slug: item.slug,
      name: item.name,
      category: item.style_category,
      image: item.image ?? '',
      standard: {
        length: item.length_ft,
        width: item.width_ft,
        height: item.height_ft,
        unit: item.dimension_unit,
      },
      requested: existing?.id === String(item.id) ? existing.requested : null,
      note: existing?.id === String(item.id) ? existing.note : '',
    });
    syncStageCardSelection();
  }

  syncSelectionInputs(kind);
  renderLiveSummary();
}

function syncSelectionInputs(kind: 'mandap' | 'stage'): void {
  const selection = selectionFor(kind);
  const select = field<HTMLSelectElement>(kind === 'mandap' ? 'mandapId' : 'stageId');
  if (select) select.value = selection?.id ?? '';

  const requested = selection?.requested;
  const values: Array<[string, number | null | undefined]> = [
    [`${kind}Length`, requested?.length],
    [`${kind}Width`, requested?.width],
    [`${kind}Height`, requested?.height],
  ];
  values.forEach(([name, value]) => {
    const input = field<HTMLInputElement>(name);
    if (input) input.value = value ? String(value) : '';
  });

  const note = field<HTMLTextAreaElement>(kind === 'mandap' ? 'mandapNotes' : 'stageNotes');
  if (note) note.value = selection?.note ?? '';
}

function syncDimensionsFromInputs(kind: 'mandap' | 'stage'): void {
  const dimensions = customDimensions(kind);
  if (dimensions === 'invalid') return;
  const selection = selectionFor(kind);
  if (!selection) return;

  const noteField = field<HTMLTextAreaElement>(kind === 'mandap' ? 'mandapNotes' : 'stageNotes');
  setSelectionDimensions(kind, dimensions, noteField?.value ?? selection.note);
  renderLiveSummary();
}

function cateringPackageFor(id: string): PlanCatalogue['catering'][number] | null {
  return (state?.catalogue.catering ?? []).find((entry) => String(entry.id) === id) ?? null;
}

function createPlanCatering(id: string, selectedItems?: CartMenuItem[]): CateringHandoff | null {
  const pkg = cateringPackageFor(id);
  if (!pkg) return null;
  return {
    id: String(pkg.id),
    name: pkg.name,
    guestCount: Math.max(1, Number(fieldValue('guestCount')) || 1),
    pricePerPlate: Math.max(0, Number(pkg.price_per_plate_paise) || 0),
    selectedItems: selectedItems ?? defaultPlanMenuItems(normalisePlanMenuSections(pkg.menu_sections)),
  };
}

function selectedCateringHandoff(): CateringHandoff | null {
  const selectedId = fieldValue('cateringPackageId');
  if (carriedCatering && String(carriedCatering.id) === selectedId) return carriedCatering;
  if (planCatering && String(planCatering.id) === selectedId) return planCatering;
  return null;
}

function selectedCateringMode(): CateringMenuMode {
  const selectedId = fieldValue('cateringPackageId');
  if (carriedCatering && String(carriedCatering.id) === selectedId) return carriedCateringMode;
  if (planCatering && String(planCatering.id) === selectedId) return planCateringMode;
  return 'default';
}

function syncCateringSelection(): void {
  const selected = fieldValue('cateringPackageId');
  document.querySelectorAll<HTMLElement>('[data-plan-catering-card]').forEach((card) => {
    const id = card.getAttribute('data-plan-catering-card') ?? '';
    const isSelected = id === selected;
    card.classList.toggle('is-selected', isSelected);
    card.setAttribute('aria-checked', String(isSelected));
  });

  document.querySelectorAll<HTMLElement>('[data-catering-card-summary]').forEach((summary) => {
    const card = summary.closest<HTMLElement>('[data-plan-catering-card]');
    const id = card?.getAttribute('data-plan-catering-card') ?? '';
    const choice = id === selected ? selectedCateringHandoff() : null;
    const items = summary.querySelector<HTMLElement>('[data-catering-card-selected-items]');
    if (!choice) {
      summary.hidden = true;
      if (items) items.textContent = '';
      return;
    }
    summary.hidden = false;
    if (items) {
      items.textContent = selectedCateringMode() === 'custom' ? 'Custom menu' : 'Default menu';
    }
  });

  renderCarriedCatering();
}

function renderCarriedCatering(): void {
  const panel = document.querySelector<HTMLElement>('[data-plan-carried-catering]');
  if (!panel) return;

  const selectedId = fieldValue('cateringPackageId');
  const pkg = cateringPackageFor(selectedId);
  if (!carriedCatering || !pkg || String(carriedCatering.id) !== selectedId) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const name = panel.querySelector<HTMLElement>('[data-plan-carried-name]');
  if (name) name.textContent = pkg.name;
  const meta = panel.querySelector<HTMLElement>('[data-plan-carried-meta]');
  if (meta) {
    meta.textContent = `${carriedCatering.guestCount} guests · built from the catering package page`;
  }

  const items = panel.querySelector<HTMLElement>('[data-plan-carried-items]');
  if (!items) return;
  items.replaceChildren();
  const groups = groupCateringItems(carriedCatering.selectedItems);
  if (groups.length === 0) {
    const note = document.createElement('span');
    note.className = 'text-xs text-muted';
    note.textContent = 'No individual menu items were selected.';
    items.appendChild(note);
    return;
  }
  for (const group of groups) {
    const row = document.createElement('div');
    row.className = 'plan-carried-item';
    const label = document.createElement('strong');
    label.textContent = group.section;
    const value = document.createElement('span');
    value.textContent = group.items.join(', ');
    row.append(label, value);
    items.appendChild(row);
  }
}

function applyCateringSelection(id: string): void {
  const select = field<HTMLSelectElement>('cateringPackageId');
  if (select) select.value = id;
  if (!id) {
    carriedCatering = null;
    carriedCateringMode = 'default';
    planCatering = null;
    planCateringMode = 'default';
  } else if (carriedCatering && String(carriedCatering.id) !== id) {
    carriedCatering = null;
    carriedCateringMode = 'default';
  } else if (planCatering && String(planCatering.id) !== id) {
    planCatering = null;
    planCateringMode = 'default';
  }
  if (id && !selectedCateringHandoff()) {
    planCatering = createPlanCatering(id);
    planCateringMode = 'default';
  }
  syncCateringSelection();
  schedulePlanRender();
}

function updateCateringMenuCounts(): void {
  if (!cateringMenuDialog) return;
  cateringMenuDialog.querySelectorAll<HTMLElement>('[data-catering-menu-section]').forEach((section) => {
    const boxes = Array.from(section.querySelectorAll<HTMLInputElement>('[data-catering-menu-item]'));
    const checked = boxes.filter((box) => box.checked).length;
    const max = Number(section.dataset.menuMax ?? 0);
    const count = section.querySelector<HTMLElement>('[data-catering-menu-count]');
    if (count) {
      count.textContent = max > 0 ? `${checked} / ${max} selected` : `${checked} selected`;
    }
    section.classList.toggle('limit-reached', max > 0 && checked >= max);
  });
}

function setCateringMenuMessage(message = ''): void {
  const node = cateringMenuDialog?.querySelector<HTMLElement>('[data-catering-menu-message]');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function setCateringMenuMode(mode: CateringMenuMode, resetSelections = false): void {
  cateringMenuMode = mode;
  if (!cateringMenuDialog) return;
  cateringMenuDialog.dataset.menuMode = mode;
  setCateringMenuMessage();

  cateringMenuDialog.querySelectorAll<HTMLButtonElement>('[data-catering-menu-mode]').forEach((button) => {
    const active = button.dataset.cateringMenuMode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  const locked = mode === 'default';
  cateringMenuDialog.querySelectorAll<HTMLInputElement>('[data-catering-menu-item]').forEach((box) => {
    box.disabled = locked;
    box.closest('.catering-menu-option')?.classList.toggle('is-locked', locked);
  });

  const help = cateringMenuDialog.querySelector<HTMLElement>('[data-catering-menu-mode-help]');
  if (help) {
    help.textContent = locked
      ? "The package's curated default selection is included. Switch to Customize menu to change items."
      : 'Choose up to the section limits. Your custom selection will be saved with this package.';
  }

  if (locked && resetSelections) {
    const pkg = cateringPackageFor(cateringMenuPackageId);
    if (pkg) setCateringMenuSelection(defaultPlanMenuItems(normalisePlanMenuSections(pkg.menu_sections)));
  }
}

function setCateringMenuSelection(items: CartMenuItem[]): void {
  if (!cateringMenuDialog) return;
  const selected = new Set(items.map((item) => `${item.section}|${item.item}`));
  cateringMenuDialog.querySelectorAll<HTMLInputElement>('[data-catering-menu-item]').forEach((box) => {
    box.checked = selected.has(`${box.dataset.menuSection ?? ''}|${box.value}`);
  });
  updateCateringMenuCounts();
}

function renderCateringMenu(pkg: PlanCatalogue['catering'][number], selectedItems: CartMenuItem[]): void {
  if (!cateringMenuDialog) return;
  const sections = normalisePlanMenuSections(pkg.menu_sections);
  const title = cateringMenuDialog.querySelector<HTMLElement>('[data-catering-menu-title]');
  const meta = cateringMenuDialog.querySelector<HTMLElement>('[data-catering-menu-meta]');
  const body = cateringMenuDialog.querySelector<HTMLElement>('[data-catering-menu-body]');
  if (title) title.textContent = `Build your menu — ${pkg.name}`;
  if (meta) {
    const guests = fieldValue('guestCount');
    meta.textContent = `${formatCataloguePrice(pkg.price_per_plate_paise)} / plate${guests ? ` · ${guests} guests` : ''}`;
  }
  setCateringMenuMessage();

  if (!body) return;
  if (sections.length === 0) {
    body.innerHTML = '<p class="catering-menu-empty">This package has no individual menu items configured yet. The package price still applies.</p>';
    return;
  }

  const selected = new Set(selectedItems.map((item) => `${item.section}|${item.item}`));
  body.innerHTML = sections
    .map(
      (section) => `
        <section class="catering-menu-section" data-catering-menu-section data-menu-max="${section.maxSelection}">
          <div class="catering-menu-section-head">
            <h3>${esc(section.title)}</h3>
            <span data-catering-menu-count>0 selected</span>
          </div>
          <div class="catering-menu-options">
            ${section.items
              .map(
                (item) => `
                  <label class="catering-menu-option">
                    <input
                      type="checkbox"
                      data-catering-menu-item
                      data-menu-section="${esc(section.title)}"
                      value="${esc(item.name)}"
                      ${selected.has(`${section.title}|${item.name}`) ? 'checked' : ''}
                    />
                    <span>${esc(item.name)}</span>
                  </label>`,
              )
              .join('')}
          </div>
        </section>`,
    )
    .join('');

  updateCateringMenuCounts();
}

function openCateringMenu(id: string): void {
  const pkg = cateringPackageFor(id);
  if (!pkg || !cateringMenuDialog) {
    applyCateringSelection(id);
    return;
  }
  cateringMenuPackageId = String(pkg.id);
  const mode = selectedCateringMode();
  const current = selectedCateringHandoff();
  const initialItems = mode === 'custom' && current && String(current.id) === cateringMenuPackageId && current.selectedItems.length > 0
    ? current.selectedItems
    : defaultPlanMenuItems(normalisePlanMenuSections(pkg.menu_sections));
  renderCateringMenu(pkg, initialItems);
  setCateringMenuMode(mode, mode === 'default');
  if (!cateringMenuDialog.open) cateringMenuDialog.showModal();
  cateringMenuDialog.querySelector<HTMLElement>('[data-catering-menu-apply]')?.focus({ preventScroll: true });
}

function closeCateringMenu(): void {
  cateringMenuPackageId = '';
  if (cateringMenuDialog?.open) cateringMenuDialog.close();
}

function applyCateringMenu(): void {
  if (!cateringMenuDialog) return;
  const pkg = cateringPackageFor(cateringMenuPackageId);
  if (!pkg) {
    closeCateringMenu();
    return;
  }

  const items = cateringMenuMode === 'default'
    ? defaultPlanMenuItems(normalisePlanMenuSections(pkg.menu_sections))
    : Array.from(
        cateringMenuDialog.querySelectorAll<HTMLInputElement>('[data-catering-menu-item]:checked'),
      ).map((input) => ({
        section: input.dataset.menuSection ?? '',
        item: input.value,
      }));

  const sameAsCarried =
    carriedCatering &&
    String(carriedCatering.id) === String(pkg.id) &&
    carriedCateringMode === cateringMenuMode &&
    carriedCatering.selectedItems.length === items.length &&
    carriedCatering.selectedItems.every(
      (item, index) => item.section === items[index]?.section && item.item === items[index]?.item,
    );

  if (sameAsCarried) {
    planCatering = null;
  } else {
    carriedCatering = null;
    carriedCateringMode = 'default';
    planCatering = createPlanCatering(String(pkg.id), items);
    planCateringMode = cateringMenuMode;
  }

  const select = field<HTMLSelectElement>('cateringPackageId');
  if (select) select.value = String(pkg.id);
  closeCateringMenu();
  syncCateringSelection();
  schedulePlanRender();
}

// Interactive Equipment List & Tabs
function equipmentUnitLabel(unit: string): string {
  return unit.replace(/^per\s+/i, '').trim() || 'item';
}

function equipmentAmount(item: CatalogueEquipmentItem, quantity: number): string {
  if (quantity <= 0) return '—';
  if (Number(item.price_paise) <= 0) return 'On request';
  return formatSubtotalPaise(Number(item.price_paise) * quantity);
}

function equipmentLineMeta(item: CatalogueEquipmentItem, quantity: number): string {
  if (quantity <= 0) return 'Not selected';
  return `${quantity} ${equipmentUnitLabel(item.unit)}${quantity === 1 ? '' : 's'} × ${formatCataloguePrice(item.price_paise)}`;
}

function updateEquipmentStatus(): void {
  const status = document.querySelector<HTMLElement>('[data-plan-equipment-status]');
  if (!status || !state) return;
  const equipment = readRequirements().equipment;
  const totalUnits = equipment.reduce((sum, item) => sum + item.quantity, 0);
  const pricedTotal = equipment.reduce((sum, requirement) => {
    const item = state.catalogue.equipment
      .flatMap((category) => category.items)
      .find((candidate) => String(candidate.id) === String(requirement.id));
    return item && item.price_paise > 0 ? sum + item.price_paise * requirement.quantity : sum;
  }, 0);
  status.textContent =
    equipment.length === 0
      ? '0 items selected'
      : `${equipment.length} line items · ${totalUnits} units${pricedTotal > 0 ? ` · ${formatSubtotalPaise(pricedTotal)}` : ''}`;
}

function renderEquipmentGrid(): void {
  if (!state) return;
  const grid = document.querySelector<HTMLElement>('[data-equipment-grid]');
  if (!grid) return;

  if (!state.activeEquipmentCategory) {
    state.activeEquipmentCategory = state.catalogue.equipment[0]?.slug ?? '';
  }

  const category = state.catalogue.equipment.find((entry) => entry.slug === state?.activeEquipmentCategory);
  const equipment = readRequirements().equipment;
  const equipmentMap = new Map(equipment.map((item) => [item.id, item.quantity]));

  updateEquipmentStatus();

  if (!category || category.items.length === 0) {
    grid.innerHTML = '<p class="empty-inline">No inventory items available in this category.</p>';
    return;
  }

  grid.setAttribute('role', 'list');
  grid.innerHTML = category.items
    .map((item) => {
      const currentQty = equipmentMap.get(String(item.id)) || 0;
      const isSelected = currentQty > 0;
      const unit = equipmentUnitLabel(item.unit);
      return `
        <div class="equipment-list-row ${isSelected ? 'is-selected' : ''}" data-equipment-id="${item.id}" role="listitem">
          <div class="equipment-list-copy">
            <div class="equipment-list-title-line">
              <strong class="equipment-list-title">${esc(item.name)}</strong>
              <span class="equipment-list-min">Min ${item.min_quantity}</span>
            </div>
            <span class="equipment-list-specs">${esc(item.specifications || item.description)}</span>
            <small class="equipment-list-unit">Per ${esc(unit)}${item.dimensions ? ` · ${esc(item.dimensions)}` : ''}</small>
          </div>
          <div class="equipment-list-qty">
            <span class="equipment-list-qty-label">Quantity</span>
            <div class="equipment-mini-stepper">
              <button
                type="button"
                class="stepper-btn minus"
                data-plan-qty-step="-1"
                data-plan-equipment-id="${item.id}"
                aria-label="Decrease ${esc(item.name)} quantity"
              >−</button>
              <input
                type="number"
                class="stepper-input"
                min="0"
                max="10000"
                step="1"
                value="${currentQty}"
                inputmode="numeric"
                data-plan-qty-input
                data-plan-equipment-id="${item.id}"
                aria-label="${esc(item.name)} quantity"
              />
              <button
                type="button"
                class="stepper-btn plus"
                data-plan-qty-step="1"
                data-plan-equipment-id="${item.id}"
                aria-label="Increase ${esc(item.name)} quantity"
              >+</button>
            </div>
          </div>
          <div class="equipment-list-amount">
            <strong data-equipment-line-total>${isSelected ? equipmentAmount(item, currentQty) : '—'}</strong>
            <small data-equipment-line-meta>${equipmentLineMeta(item, currentQty)}</small>
          </div>
        </div>`;
    })
    .join('');
}

function renderEquipmentTabs(): void {
  if (!state) return;
  const tabs = document.querySelectorAll<HTMLButtonElement>('[data-equipment-tab]');
  tabs.forEach((tab) => {
    const slug = tab.dataset.equipmentTab ?? '';
    const isActive = slug === state?.activeEquipmentCategory;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

function updateEquipmentQuantity(id: string, nextQty: number): void {
  if (!state) return;
  const numId = Number(id);
  const item = state.catalogue.equipment.flatMap((cat) => cat.items).find((candidate) => candidate.id === numId);
  const category = state.catalogue.equipment.find((cat) => cat.items.some((candidate) => candidate.id === numId));
  if (!item || !category) return;

  const existing = readRequirements().equipment.find((entry) => entry.id === id);

  if (nextQty <= 0) {
    if (existing) {
      removeLineItem('equipment', id);
    }
  } else {
    const validQty = Math.max(item.min_quantity, nextQty);
    if (!existing) {
      addEquipment({
        id: String(item.id),
        slug: item.slug,
        name: item.name,
        category: category.name,
        categorySlug: category.slug,
        unit: item.unit,
        specifications: item.specifications,
        image: item.image ?? '',
        minQuantity: item.min_quantity,
        quantity: validQty,
      });
    } else {
      updateQuantity(id, validQty);
    }
  }

  updateEquipmentCard(id, nextQty <= 0 ? 0 : Math.max(item.min_quantity, nextQty));
  schedulePlanRender();
}

/** Updates only the affected equipment row instead of rebuilding the list. */
function updateEquipmentCard(id: string, quantity: number): void {
  if (!state) return;
  const row = document.querySelector<HTMLElement>(`.equipment-list-row[data-equipment-id="${CSS.escape(id)}"]`);
  if (row) {
    const input = row.querySelector<HTMLInputElement>('[data-plan-qty-input]');
    if (input && Number(input.value) !== quantity) {
      input.value = String(quantity);
    }
    row.classList.toggle('is-selected', quantity > 0);

    const item = state.catalogue.equipment
      .flatMap((category) => category.items)
      .find((candidate) => String(candidate.id) === id);
    if (item) {
      const total = row.querySelector<HTMLElement>('[data-equipment-line-total]');
      if (total) total.textContent = equipmentAmount(item, quantity);
      const meta = row.querySelector<HTMLElement>('[data-equipment-line-meta]');
      if (meta) meta.textContent = equipmentLineMeta(item, quantity);
    }
  }

  updateEquipmentStatus();
}

function pricingSelection(): {
  mandap: { id: string | number } | null;
  stage: { id: string | number } | null;
  furniture: Array<{ id: string | number; quantity: number }>;
  catering: {
    id: string | number;
    guestCount: number;
    selectedItems: Array<{ section: string; item: string }>;
  } | null;
} {
  const requirements = readRequirements();
  const cateringId = fieldValue('cateringPackageId');
  const guestCount = Number(fieldValue('guestCount'));

  return {
    mandap: requirements.mandap ? { id: requirements.mandap.id } : null,
    stage: requirements.stage ? { id: requirements.stage.id } : null,
    furniture: requirements.equipment.map((item) => ({ id: item.id, quantity: item.quantity })),
    catering: cateringId && guestCount > 0
      ? {
          id: cateringId,
          guestCount,
          selectedItems: selectedCateringHandoff()?.selectedItems ?? [],
        }
      : null,
  };
}

function currentPricing(): SelectionPricing | null {
  if (!state?.catalogue.pricing) return null;
  try {
    return calculateSelectionPricing(state.catalogue.pricing, pricingSelection());
  } catch (error) {
    if (error instanceof PricingError) return null;
    throw error;
  }
}

function formatSubtotalPaise(paise: number): string {
  return `₹${(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
}

function compactPricingStatus(status: SelectionPricing['pricingStatus']): string {
  if (status === 'fully_priced') return 'Fully priced';
  if (status === 'partially_priced') return 'Partial estimate';
  return 'Quote required';
}

function pricingLinesHtml(pricing: SelectionPricing): string {
  if (pricing.items.length === 0) {
    return '<p class="text-xs text-muted plan-pricing-empty">No catalogue selections yet.</p>';
  }

  return `
    <div class="plan-pricing-lines">
      ${pricing.items
        .map((item) => {
          const unitLabel =
            item.category === 'catering'
              ? `${formatCataloguePrice(item.unitPricePaise)} / plate × ${item.quantity} guests`
              : `${item.quantity} × ${formatCataloguePrice(item.unitPricePaise)}`;
          const subtotal = item.pricingStatus === 'priced'
            ? formatSubtotalPaise(item.subtotalPaise ?? 0)
            : 'On request';
          return `<div class="plan-pricing-line ${item.pricingStatus === 'on_request' ? 'is-on-request' : ''}">
            <div class="plan-pricing-line-main">
              <strong>${esc(item.name)}</strong>
              <small>${esc(unitLabel)}</small>
            </div>
            <strong class="plan-pricing-line-amount">${esc(subtotal)}</strong>
          </div>`;
        })
        .join('')}
    </div>
    <div class="plan-pricing-total">
      <span>Priced subtotal</span>
      <strong>${formatSubtotalPaise(pricing.pricedSubtotalPaise)}</strong>
    </div>
    <div class="plan-pricing-status status-${pricing.pricingStatus}">
      <span>${esc(formatPricingStatus(pricing.pricingStatus))}</span>
      ${pricing.unpricedItemCount > 0 ? `<small>${pricing.unpricedItemCount} item${pricing.unpricedItemCount === 1 ? '' : 's'} quoted separately</small>` : ''}
    </div>
  `;
}

// Live Blueprint Sidebar + compact mobile bar
function renderLiveSummary(): void {
  const target = document.querySelector<HTMLElement>('[data-plan-live-summary]');
  const mobileTarget = document.querySelector<HTMLElement>('[data-plan-live-summary-mobile]');
  if (!target && !mobileTarget) return;

  const requirements = readRequirements();
  const totalUnits = requirements.equipment.reduce((sum, item) => sum + item.quantity, 0);
  const pricing = currentPricing();

  const eventType = fieldValue('eventType') || 'Celebration';
  const eventDate = fieldValue('eventDate');
  const venue = fieldValue('venueLocation');
  const guests = fieldValue('guestCount');
  const requiresRooms = radioValue('requiresRooms') === 'yes';
  const acRooms = Number(fieldValue('acRoomCount')) || 0;
  const nonAcRooms = Number(fieldValue('nonAcRoomCount')) || 0;
  const cateringId = fieldValue('cateringPackageId');
  const catering = (state?.catalogue.catering ?? []).find((entry) => String(entry.id) === cateringId);
  const cateringHandoff = selectedCateringHandoff();
  const cateringSelectionSummary = cateringHandoff
    ? planMenuItemsPreview(cateringHandoff.selectedItems, 4)
    : '';
  const dateFormatted = eventDate ? new Date(`${eventDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date pending';

  const summaryHtml = `
    <div class="blueprint-event-summary">
      <span class="blueprint-event-kicker">${esc(eventType)}</span>
      <strong>${esc(dateFormatted)}</strong>
      <span>${esc(venue || 'Ranchi location pending')}${guests ? ` · ${esc(guests)} guests` : ''}</span>
    </div>

    <div class="blueprint-group">
      <span class="blueprint-group-label">Decor &amp; stage</span>
      <div class="blueprint-row">
        <span class="blueprint-label">Mandap</span>
        <strong class="blueprint-value">${requirements.mandap ? esc(requirements.mandap.name) : '— No mandap'}</strong>
      </div>
      <div class="blueprint-row">
        <span class="blueprint-label">Stage</span>
        <strong class="blueprint-value">${requirements.stage ? esc(requirements.stage.name) : '— No stage'}</strong>
      </div>
    </div>

    <div class="blueprint-group">
      <span class="blueprint-group-label">Seating &amp; hospitality</span>
      <div class="blueprint-row">
        <span class="blueprint-label">Furniture &amp; equipment</span>
        <strong class="blueprint-value">${requirements.equipment.length > 0 ? `${requirements.equipment.length} items (${totalUnits} units)` : '— None selected'}</strong>
      </div>
      <div class="blueprint-row">
        <span class="blueprint-label">Catering</span>
        <strong class="blueprint-value">${catering ? `${esc(catering.name)}${guests ? ` · ${esc(guests)} guests` : ''}` : '— Not selected'}${cateringSelectionSummary ? `<small class="blueprint-subvalue">${esc(cateringSelectionSummary)}</small>` : ''}</strong>
      </div>
      <div class="blueprint-row">
        <span class="blueprint-label">Rooms</span>
        <strong class="blueprint-value">${requiresRooms ? `${acRooms} AC, ${nonAcRooms} Non-AC` : 'Self-arranged'}</strong>
      </div>
    </div>

    <div class="blueprint-pricing-panel">
      <div class="blueprint-pricing-head">
        <div>
          <span class="blueprint-pricing-kicker">Live estimate</span>
          <strong>${pricing ? formatSubtotalPaise(pricing.pricedSubtotalPaise) : 'Quotation required'}</strong>
        </div>
        <span class="blueprint-pricing-status">${pricing ? esc(compactPricingStatus(pricing.pricingStatus)) : 'Pricing on quotation'}</span>
      </div>
      ${pricing ? pricingLinesHtml(pricing) : '<p class="text-xs text-muted plan-pricing-empty">Select valid items and a guest count to see the estimate.</p>'}
    </div>
  `;

  if (target) target.innerHTML = summaryHtml;
  if (mobileTarget) mobileTarget.innerHTML = summaryHtml;

  const selectionCount =
    (requirements.mandap ? 1 : 0) +
    (requirements.stage ? 1 : 0) +
    requirements.equipment.length +
    (catering ? 1 : 0) +
    (requiresRooms ? 1 : 0);

  const countNode = document.querySelector<HTMLElement>('[data-plan-mobile-count]');
  if (countNode) {
    countNode.textContent =
      selectionCount === 0
        ? 'No selections yet'
        : `${selectionCount} selection${selectionCount === 1 ? '' : 's'} in blueprint`;
  }

  const statusNode = document.querySelector<HTMLElement>('[data-plan-mobile-status]');
  if (statusNode) {
    statusNode.textContent = pricing
      ? compactPricingStatus(pricing.pricingStatus)
      : 'Pricing on quotation';
  }
}

function setMobileSummary(open: boolean): void {
  const toggle = document.querySelector<HTMLElement>('[data-plan-mobile-toggle]');
  const sheet = document.querySelector<HTMLElement>('[data-plan-mobile-sheet]');
  toggle?.setAttribute('aria-expanded', String(open));
  if (sheet) sheet.hidden = !open;
}

// Review Section Rendering (Phase 4)
function renderReview(): void {
  if (!state) return;
  const target = document.querySelector<HTMLElement>('[data-plan-review]');
  if (!target) return;

  const requirements = readRequirements();
  const draft = collectDraft();

  const equipment = requirements.equipment;
  const equipmentHtml =
    equipment.length === 0
      ? '<p class="review-empty">No furniture or equipment selected.</p>'
      : `<ul class="review-line-list">${equipment
          .map(
            (item) =>
              `<li><strong>${item.quantity} ${esc(item.unit)}${item.quantity === 1 ? '' : 's'}</strong> × ${esc(item.name)} <span class="review-cat">(${esc(item.category)})</span></li>`,
          )
          .join('')}</ul>`;

  const mandapText = requirements.mandap
    ? `<strong>${esc(requirements.mandap.name)}</strong> · ${esc(dimensionsSummary(requirements.mandap))}${draft.mandapNotes ? `<br><small>Note: ${esc(draft.mandapNotes)}</small>` : ''}`
    : 'No mandap selected (Venue structure)';

  const stageText = requirements.stage
    ? `<strong>${esc(requirements.stage.name)}</strong> · ${esc(dimensionsSummary(requirements.stage))}${draft.stageNotes ? `<br><small>Note: ${esc(draft.stageNotes)}</small>` : ''}`
    : 'No reception stage selected';

  const roomsText =
    draft.requiresRooms === 'yes'
      ? `${Number(draft.acRoomCount) || 0} AC rooms + ${Number(draft.nonAcRoomCount) || 0} Non-AC rooms (${(Number(draft.acRoomCount) || 0) + (Number(draft.nonAcRoomCount) || 0)} rooms total)${draft.accommodationNotes ? `<br><small>${esc(draft.accommodationNotes)}</small>` : ''}`
      : 'No hotel room blocks required';

  const catering = state.catalogue.catering.find((entry) => String(entry.id) === draft.cateringPackageId);
  const cateringHandoff = selectedCateringHandoff();
  const cateringMenuText = cateringHandoff && String(cateringHandoff.id) === draft.cateringPackageId
    ? planMenuItemsPreview(cateringHandoff.selectedItems, 6)
    : '';
  const cateringText = catering
    ? `<strong>${esc(catering.name)}</strong>${draft.guestCount ? ` · ${esc(draft.guestCount)} guests` : ''}${cateringMenuText ? `<br><small>Menu: ${esc(cateringMenuText)}</small>` : ''}${draft.cateringNotes ? `<br><small>${esc(draft.cateringNotes)}</small>` : ''}`
    : 'No catering package selected';
  const pricing = currentPricing();
  const pricingHtml = pricing
    ? pricingLinesHtml(pricing)
    : '<p class="review-empty">Select valid items and a guest count to see the estimate.</p>';

  target.innerHTML = `
    <div class="review-card">
      <div class="review-card-head">
        <h4>1. Event &amp; Venue Essentials</h4>
        <button type="button" class="btn btn-secondary btn-sm" data-plan-edit="1">Edit</button>
      </div>
      <dl class="review-dl">
        <div><dt>Event Type</dt><dd>${esc(draft.eventType || '—')}</dd></div>
        <div><dt>Date &amp; Time</dt><dd>${esc(draft.eventDate)}${draft.endDate ? ` to ${esc(draft.endDate)}` : ''}${draft.eventTime ? ` at ${esc(draft.eventTime)}` : ''}</dd></div>
        <div><dt>Venue</dt><dd>${esc(draft.venueLocation || '—')}</dd></div>
        <div><dt>Guest Attendance</dt><dd>${draft.guestCount ? `${esc(draft.guestCount)} guests` : '—'}</dd></div>
        ${draft.eventDescription ? `<div><dt>Vision Notes</dt><dd>${esc(draft.eventDescription)}</dd></div>` : ''}
      </dl>
    </div>

    <div class="review-card">
      <div class="review-card-head">
        <h4>2. Mandap, Stage &amp; Styling</h4>
        <button type="button" class="btn btn-secondary btn-sm" data-plan-edit="2">Edit</button>
      </div>
      <dl class="review-dl">
        <div><dt>Mandap Design</dt><dd>${mandapText}</dd></div>
        <div><dt>Stage Design</dt><dd>${stageText}</dd></div>
        <div><dt>Lighting Style</dt><dd>${esc(draft.lighting || '—')}</dd></div>
        <div><dt>Floral Palette</dt><dd>${esc(draft.floralPalette || '—')}</dd></div>
        ${draft.specialInstructions ? `<div><dt>Aesthetics Note</dt><dd>${esc(draft.specialInstructions)}</dd></div>` : ''}
      </dl>
    </div>

    <div class="review-card">
      <div class="review-card-head">
        <h4>3. Seating, Inventory &amp; Accommodation</h4>
        <button type="button" class="btn btn-secondary btn-sm" data-plan-edit="3">Edit</button>
      </div>
      <dl class="review-dl">
        <div><dt>Furniture &amp; Equipment</dt><dd>${equipmentHtml}</dd></div>
        ${draft.equipmentNotes ? `<div><dt>Setup Notes</dt><dd>${esc(draft.equipmentNotes)}</dd></div>` : ''}
        <div><dt>Catering Package</dt><dd>${cateringText}</dd></div>
        ${draft.additionalServices ? `<div><dt>Additional Services</dt><dd>${esc(draft.additionalServices)}</dd></div>` : ''}
        <div><dt>Accommodation</dt><dd>${roomsText}</dd></div>
      </dl>
    </div>

    <div class="review-card">
      <div class="review-card-head">
        <h4>4. Pricing Estimate</h4>
        <button type="button" class="btn btn-secondary btn-sm" data-plan-edit="3">Review selections</button>
      </div>
      <div class="review-pricing">${pricingHtml}</div>
    </div>

    <div class="review-card">
      <div class="review-card-head">
        <h4>5. Contact &amp; Budget Information</h4>
        <button type="button" class="btn btn-secondary btn-sm" data-plan-edit="4">Edit</button>
      </div>
      <dl class="review-dl">
        <div><dt>Budget Bracket</dt><dd>${esc(draft.budgetRange || '—')}</dd></div>
        <div><dt>Client Name</dt><dd>${esc(draft.customerName || '—')}</dd></div>
        <div><dt>Mobile Contact</dt><dd>+91 ${esc(draft.customerPhone || '—')}</dd></div>
        <div><dt>Email Address</dt><dd>${esc(draft.customerEmail || 'None provided')}</dd></div>
        <div><dt>Preferred Contact</dt><dd>${esc(draft.preferredContact || '—')}</dd></div>
      </dl>
    </div>
  `;
}

// Payload construction matching /api/enquiries schema
function buildPayload() {
  const requirements = readRequirements();
  const selected = (req: MandapRequirement | StageRequirement | null) => {
    if (!req) return null;
    return {
      id: Number(req.id),
      name: req.name,
      requested: req.requested
        ? {
            length: req.requested.length,
            width: req.requested.width,
            height: req.requested.height,
            unit: req.requested.unit,
          }
        : null,
      note: req.note,
    };
  };

  const acRooms = Number(fieldValue('acRoomCount')) || 0;
  const nonAcRooms = Number(fieldValue('nonAcRoomCount')) || 0;
  const totalRooms = acRooms + nonAcRooms;

  return {
    event: {
      type: fieldValue('eventType'),
      date: fieldValue('eventDate'),
      endDate: fieldValue('endDate'),
      time: fieldValue('eventTime'),
      venue: fieldValue('venueLocation'),
      guestCount: Number(fieldValue('guestCount')),
      description: fieldValue('eventDescription'),
    },
    mandap: selected(requirements.mandap),
    stage: selected(requirements.stage),
    furniture: requirements.equipment.map((item: EquipmentRequirement) => ({
      id: Number(item.id),
      quantity: item.quantity,
      notes: item.notes,
    })),
    equipmentNotes: fieldValue('equipmentNotes'),
    catering: fieldValue('cateringPackageId') && Number(fieldValue('guestCount')) > 0
      ? {
          id: Number(fieldValue('cateringPackageId')),
          guestCount: Number(fieldValue('guestCount')),
          notes: fieldValue('cateringNotes'),
          selectedItems: selectedCateringHandoff()?.selectedItems ?? [],
        }
      : null,
    cateringNotes: fieldValue('cateringNotes'),
    additionalServices: fieldValue('additionalServices'),
    accommodation: {
      required: radioValue('requiresRooms') === 'yes',
      roomCount: totalRooms,
      acRoomCount: acRooms,
      nonAcRoomCount: nonAcRooms,
      notes: fieldValue('accommodationNotes'),
    },
    styling: {
      lighting: fieldValue('lighting'),
      floralPalette: fieldValue('floralPalette'),
      specialInstructions: fieldValue('specialInstructions'),
    },
    contact: {
      name: fieldValue('customerName'),
      phone: fieldValue('customerPhone'),
      email: fieldValue('customerEmail'),
      budgetRange: fieldValue('budgetRange'),
      preferredContact: fieldValue('preferredContact'),
    },
  };
}

function validateAll(): boolean {
  for (let step = 1; step <= steps.length; step += 1) {
    if (!validateStep(step)) {
      goToStep(step);
      return false;
    }
  }
  return true;
}

async function submitEnquiry(): Promise<void> {
  if (!validateAll()) return;

  const button = document.querySelector<HTMLButtonElement>('[data-plan-submit]');
  const original = button?.innerHTML ?? '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Transmitting celebration blueprint…';
  }

  try {
    const response = await fetch('/api/enquiries', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(buildPayload()),
    });

    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      reference?: string;
      qrDataUrl?: string;
      token?: string;
      receiptUrl?: string;
      pricing?: SelectionPricing;
      pricingStatus?: SelectionPricing['pricingStatus'];
      pricedSubtotalPaise?: number;
      message?: string;
    };

    if (!response.ok || data.status !== 'success' || !data.reference) {
      throw new Error(data.message || 'We could not submit the enquiry. Please try again.');
    }

    const receiptUrl = data.receiptUrl || `/receipts/enquiry/${data.reference}${data.token ? `?token=${data.token}` : ''}`;

    showReceipt(data.reference, data.qrDataUrl, receiptUrl, data.pricing);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'We could not submit the enquiry. Please try again.');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

function receiptSummaryHtml(pricing: SelectionPricing | null): string {
  const requirements = readRequirements();
  const cateringId = fieldValue('cateringPackageId');
  const catering = (state?.catalogue.catering ?? []).find((entry) => String(entry.id) === cateringId);
  const carriedItems = selectedCateringHandoff();
  const carriedSummary = carriedItems ? summariseCateringItems(carriedItems.selectedItems) : '';
  const eventType = fieldValue('eventType') || 'Celebration';
  const eventDate = fieldValue('eventDate');
  const venue = fieldValue('venueLocation');
  const guests = fieldValue('guestCount');
  return `
    <div style="font-weight:700;margin-bottom:8px;">Submitted enquiry summary</div>
    <div class="text-sm" style="display:grid;gap:4px;margin-bottom:12px;">
      <div><span class="text-muted">Event:</span> ${esc(eventType)}${eventDate ? ` · ${esc(eventDate)}` : ''}${guests ? ` · ${esc(guests)} guests` : ''}</div>
      <div><span class="text-muted">Venue:</span> ${esc(venue || 'To be confirmed')}</div>
      <div><span class="text-muted">Mandap:</span> ${requirements.mandap ? esc(requirements.mandap.name) : 'Not selected'}</div>
      <div><span class="text-muted">Stage:</span> ${requirements.stage ? esc(requirements.stage.name) : 'Not selected'}</div>
      <div><span class="text-muted">Furniture &amp; equipment:</span> ${requirements.equipment.length ? `${requirements.equipment.length} selected line(s)` : 'Not selected'}</div>
      <div><span class="text-muted">Catering:</span> ${catering ? esc(catering.name) : 'Not selected'}${carriedSummary ? `<br><span class="text-xs text-muted">${esc(carriedSummary)}</span>` : ''}</div>
    </div>
    ${pricing ? pricingLinesHtml(pricing) : '<p class="text-sm text-muted">Pricing on quotation.</p>'}
    <p class="text-xs text-muted" style="margin-top:10px;">This is an enquiry acknowledgement, not a confirmed booking. Our team will review the requirements and prepare the quotation.</p>
  `;
}

function showReceipt(
  reference: string,
  qrDataUrl?: string,
  receiptUrl?: string,
  serverPricing?: SelectionPricing,
): void {
  if (planShell) planShell.hidden = true;
  setMobileSummary(false);
  const mobileSummary = document.querySelector<HTMLElement>('[data-plan-mobile-summary]');
  if (mobileSummary) mobileSummary.hidden = true;
  if (receipt) {
    receipt.hidden = false;
    const referenceNode = receipt.querySelector<HTMLElement>('[data-receipt-reference]');
    if (referenceNode) referenceNode.textContent = reference;

    const summaryNode = receipt.querySelector<HTMLElement>('[data-receipt-summary]');
    if (summaryNode) {
      summaryNode.innerHTML = receiptSummaryHtml(serverPricing ?? currentPricing());
    }

    if (qrDataUrl) {
      const qrContainer = receipt.querySelector<HTMLElement>('[data-receipt-qr-container]');
      const qrImg = receipt.querySelector<HTMLImageElement>('[data-receipt-qr]');
      if (qrImg) qrImg.src = qrDataUrl;
      if (qrContainer) qrContainer.hidden = false;
    }

    if (receiptUrl) {
      const viewLink = receipt.querySelector<HTMLAnchorElement>('[data-receipt-view-link]');
      if (viewLink) viewLink.href = receiptUrl;
      const primaryLink = receipt.querySelector<HTMLAnchorElement>('[data-receipt-primary-link]');
      if (primaryLink) primaryLink.href = receiptUrl;

      const pdfLink = receipt.querySelector<HTMLAnchorElement>('[data-receipt-pdf-link]');
      if (pdfLink) {
        const parsed = new URL(receiptUrl, window.location.origin);
        const token = parsed.searchParams.get('token');
        pdfLink.href = `/api/enquiries/receipt/${encodeURIComponent(reference)}/pdf${
          token ? `?token=${encodeURIComponent(token)}` : ''
        }`;
      }
    }

    const heading = receipt.querySelector<HTMLElement>('h2');
    heading?.setAttribute('tabindex', '-1');
    receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    heading?.focus({ preventScroll: true });
  }

  form?.reset();
  clearEnquiryBrowserState();
}

// Initialization and Event Listeners
if (state && form) {
  state.activeEquipmentCategory = state.catalogue.equipment[0]?.slug ?? '';

  // The listeners below must always be attached. A failure while restoring or
  // painting package selections must never leave the wizard inert.
  try {
    const handoff = readCateringHandoff();
    if (handoff && state.catalogue.catering.some((entry) => String(entry.id) === handoff.id)) {
      carriedCatering = handoff;
      carriedCateringMode = handoff.selectedItems.length > 0 ? 'custom' : 'default';
      const cateringSelect = field<HTMLSelectElement>('cateringPackageId');
      if (cateringSelect) cateringSelect.value = handoff.id;
      const guestField = field<HTMLInputElement>('guestCount');
      if (guestField) guestField.value = String(handoff.guestCount);
    }

    consumeRequirementsForPlan();
    syncSelectionInputs('mandap');
    syncSelectionInputs('stage');
    syncMandapCardSelection();
    syncStageCardSelection();
    syncStylingSwatches();

    if (!fieldValue('mandapNotes')) {
      const note = field<HTMLTextAreaElement>('mandapNotes');
      if (note && selectionFor('mandap')?.note) note.value = selectionFor('mandap')?.note ?? '';
    }
    if (!fieldValue('stageNotes')) {
      const note = field<HTMLTextAreaElement>('stageNotes');
      if (note && selectionFor('stage')?.note) note.value = selectionFor('stage')?.note ?? '';
    }

    renderEquipmentTabs();
    renderEquipmentGrid();
    syncCateringSelection();
    renderLiveSummary();
    goToStep(1, false);
  } catch (error) {
    console.error('[plan-wizard] initial selections could not be rendered; navigation stays active.', error);
    goToStep(1, false);
  }

  cateringMenuDialog?.addEventListener('click', (event) => {
    if (event.target === cateringMenuDialog) closeCateringMenu();
  });
  cateringMenuDialog?.addEventListener('close', () => {
    cateringMenuPackageId = '';
  });

  form.addEventListener('input', (event) => {
    if (event.target instanceof HTMLElement) clearFieldError(event.target);
    schedulePlanRender();
  });

  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLElement) clearFieldError(event.target);
    schedulePlanRender();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitEnquiry();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMobileSummary(false);

    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-plan-mandap-card], [data-plan-stage-card], [data-plan-catering-card]',
    );
    if (!card) return;
    event.preventDefault();
    card.click();
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('[data-receipt-print]')) {
      window.print();
      return;
    }

    // Compact mobile summary sheet
    const mobileToggle = target.closest<HTMLElement>('[data-plan-mobile-toggle]');
    if (mobileToggle) {
      setMobileSummary(mobileToggle.getAttribute('aria-expanded') !== 'true');
      return;
    }

    if (target.closest('[data-plan-mobile-close]')) {
      setMobileSummary(false);
      document.querySelector<HTMLElement>('[data-plan-mobile-toggle]')?.focus({ preventScroll: true });
      return;
    }

    // Navigation buttons
    const next = target.closest<HTMLElement>('[data-plan-next]');
    if (next) {
      if (validateStep(state.currentStep)) goToStep(state.currentStep + 1);
      return;
    }

    const prev = target.closest<HTMLElement>('[data-plan-prev]');
    if (prev) {
      goToStep(state.currentStep - 1);
      return;
    }

    const stepLink = target.closest<HTMLElement>('[data-plan-step-link]');
    if (stepLink) {
      const targetStep = Number(stepLink.dataset.planStepLink);
      // Validate up to targetStep if advancing
      if (targetStep > state.currentStep) {
        if (validateStep(state.currentStep)) goToStep(targetStep);
      } else {
        goToStep(targetStep);
      }
      return;
    }

    const edit = target.closest<HTMLElement>('[data-plan-edit]');
    if (edit) {
      goToStep(Number(edit.dataset.planEdit));
      return;
    }

    // Catering package selection opens the menu builder. Applying the builder
    // is what records the package and its item selection.
    const cateringCard = target.closest<HTMLElement>('[data-plan-catering-card]');
    if (cateringCard) {
      const id = cateringCard.getAttribute('data-plan-catering-card') ?? '';
      if (id) openCateringMenu(id);
      else applyCateringSelection('');
      return;
    }

    const cateringMenuApply = target.closest<HTMLElement>('[data-catering-menu-apply]');
    if (cateringMenuApply) {
      applyCateringMenu();
      return;
    }

    if (target.closest('[data-catering-menu-cancel]')) {
      closeCateringMenu();
      return;
    }

    const cateringMenuDefault = target.closest<HTMLElement>('[data-catering-menu-default]');
    if (cateringMenuDefault) {
      setCateringMenuMode('default', true);
      return;
    }

    const cateringMenuModeButton = target.closest<HTMLElement>('[data-catering-menu-mode]');
    if (cateringMenuModeButton) {
      const mode = cateringMenuModeButton.dataset.cateringMenuMode === 'custom' ? 'custom' : 'default';
      setCateringMenuMode(mode, mode === 'default');
      return;
    }

    // Mandap card selection
    const mandapCard = target.closest<HTMLElement>('[data-plan-mandap-card]');
    if (mandapCard) {
      const id = mandapCard.dataset.planMandapCard ?? '';
      applySelection('mandap', id);
      return;
    }

    // Stage card selection
    const stageCard = target.closest<HTMLElement>('[data-plan-stage-card]');
    if (stageCard) {
      const id = stageCard.dataset.planStageCard ?? '';
      applySelection('stage', id);
      return;
    }

    // Lighting swatch selection
    const lightingSwatch = target.closest<HTMLElement>('[data-plan-lighting-swatch]');
    if (lightingSwatch) {
      const val = lightingSwatch.dataset.planLightingSwatch ?? '';
      const select = field<HTMLSelectElement>('lighting');
      if (select) select.value = val;
      syncStylingSwatches();
      if (state.currentStep === 4) renderReview();
      return;
    }

    // Floral swatch selection
    const floralSwatch = target.closest<HTMLElement>('[data-plan-floral-swatch]');
    if (floralSwatch) {
      const val = floralSwatch.dataset.planFloralSwatch ?? '';
      const select = field<HTMLSelectElement>('floralPalette');
      if (select) select.value = val;
      syncStylingSwatches();
      if (state.currentStep === 4) renderReview();
      return;
    }

    // Equipment tabs
    const equipmentTab = target.closest<HTMLElement>('[data-equipment-tab]');
    if (equipmentTab) {
      state.activeEquipmentCategory = equipmentTab.dataset.equipmentTab ?? '';
      renderEquipmentTabs();
      renderEquipmentGrid();
      return;
    }

    // Equipment quantity stepper (+ / -)
    const qtyStep = target.closest<HTMLElement>('[data-plan-qty-step]');
    if (qtyStep) {
      const id = qtyStep.dataset.planEquipmentId ?? '';
      const step = Number(qtyStep.dataset.planQtyStep ?? 0);
      const existing = readRequirements().equipment.find((entry) => entry.id === id);
      const current = existing ? existing.quantity : 0;
      updateEquipmentQuantity(id, current + step);
      return;
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;

    if (target.matches('[data-catering-menu-item]')) {
      const input = target as HTMLInputElement;
      const section = input.closest<HTMLElement>('[data-catering-menu-section]');
      const max = Number(section?.dataset.menuMax ?? 0);
      if (input.checked && max > 0) {
        const checked = section
          ? Array.from(section.querySelectorAll<HTMLInputElement>('[data-catering-menu-item]')).filter((box) => box.checked).length
          : 0;
        if (checked > max) {
          input.checked = false;
          setCateringMenuMessage(`Choose up to ${max} item${max === 1 ? '' : 's'} from this section.`);
        } else {
          setCateringMenuMessage();
        }
      } else {
        setCateringMenuMessage();
      }
      updateCateringMenuCounts();
      return;
    }

    if (target.matches('[data-plan-qty-input]')) {
      const input = target as HTMLInputElement;
      updateEquipmentQuantity(input.dataset.planEquipmentId ?? '', Number(input.value));
      return;
    }

    if (target.matches('[data-custom-dim]')) {
      syncDimensionsFromInputs((target as HTMLElement).dataset.customDim === 'stage' ? 'stage' : 'mandap');
      return;
    }

    if (target.matches('[name="mandapNotes"], [name="stageNotes"]')) {
      const kind = (target as HTMLElement).getAttribute('name') === 'stageNotes' ? 'stage' : 'mandap';
      const selection = selectionFor(kind);
      if (selection) {
        setSelectionDimensions(kind, selection.requested, (target as HTMLTextAreaElement).value);
      }
      return;
    }

    if (target.matches('[name="requiresRooms"], [name="acRoomCount"], [name="nonAcRoomCount"]')) {
      syncRoomField();
      schedulePlanRender();
      return;
    }

    if (target.matches('[name="eventDate"]')) {
      const eventDate = field<HTMLInputElement>('eventDate')?.value ?? '';
      const endDate = field<HTMLInputElement>('endDate');
      if (endDate) {
        endDate.min = eventDate || today;
        if (endDate.value && eventDate && endDate.value < eventDate) endDate.value = '';
      }
      schedulePlanRender();
    }
  });

  window.addEventListener(REQUIREMENTS_EVENT, () => {
    syncMandapCardSelection();
    syncStageCardSelection();
    renderEquipmentGrid();
    schedulePlanRender();
  });

  // Package selections are memory-only on the Plan page. An explicit
  // same-tab navigation to another page may carry a one-shot handoff so the
  // visitor can add a catalogue item and return; a reload never writes one.
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.hasAttribute('download') || link.target === '_blank') return;
      try {
        if (new URL(link.href, window.location.href).origin === window.location.origin) {
          prepareRequirementsHandoff();
        }
      } catch {
        // Ignore malformed hrefs.
      }
    },
    true,
  );

  // Some browsers restore a form from the back/forward cache with the previous
  // visitor's values still in the DOM. Reload to a blank, server-rendered form.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });

  const nextButton = document.querySelector<HTMLButtonElement>('[data-plan-next]');
  if (nextButton) {
    nextButton.disabled = false;
    nextButton.removeAttribute('aria-disabled');
  }
}
