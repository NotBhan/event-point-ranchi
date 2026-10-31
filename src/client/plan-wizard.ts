import {
  REQUIREMENTS_EVENT,
  REQUIREMENTS_STORAGE_KEY,
  addEquipment,
  addMandap,
  addStage,
  clearRequirements,
  formatDimensions,
  readRequirements,
  removeLineItem,
  setSelectionDimensions,
  updateQuantity,
  type DimensionSet,
  type EquipmentRequirement,
  type MandapRequirement,
  type StageRequirement,
} from './requirements';

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
}

interface CatalogueEquipmentCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  items: CatalogueEquipmentItem[];
}

interface PlanCatalogue {
  mandaps: CatalogueMandap[];
  stages: CatalogueStage[];
  equipment: CatalogueEquipmentCategory[];
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

const DRAFT_KEY = 'eventPointPlanDraft:v1';
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

const state: {
  catalogue: PlanCatalogue;
  currentStep: number;
  activeEquipmentCategory: string;
  draft: PlanDraft;
} | null = form && catalogueNode
  ? {
      catalogue: JSON.parse(catalogueNode.textContent ?? '{"mandaps":[],"stages":[],"equipment":[]}') as PlanCatalogue,
      currentStep: 1,
      activeEquipmentCategory: '',
      draft: defaultDraft(),
    }
  : null;

const today = form?.dataset.today ?? new Date().toISOString().slice(0, 10);
const csrf = form?.dataset.csrf ?? '';

function defaultDraft(): PlanDraft {
  return {
    step: 1,
    eventType: '',
    eventDate: '',
    endDate: '',
    eventTime: '',
    venueLocation: '',
    guestCount: '',
    eventDescription: '',
    mandapId: '',
    mandapLength: '',
    mandapWidth: '',
    mandapHeight: '',
    mandapNotes: '',
    stageId: '',
    stageLength: '',
    stageWidth: '',
    stageHeight: '',
    stageNotes: '',
    lighting: 'Warm fairy lights',
    floralPalette: 'Maroon & ivory',
    specialInstructions: '',
    equipmentNotes: '',
    requiresRooms: 'no',
    roomCount: '',
    acRoomCount: '',
    nonAcRoomCount: '',
    accommodationNotes: '',
    budgetRange: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    preferredContact: '',
  };
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function readDraft(): PlanDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<PlanDraft> | null;
    const initial = { ...defaultDraft(), ...(raw ?? {}) };
    // Map legacy 8-step counter to modern 4-phase counter if needed
    if (initial.step > 4) {
      initial.step = initial.step <= 1 ? 1 : initial.step <= 3 ? 2 : initial.step <= 5 ? 3 : 4;
    }
    return initial;
  } catch {
    return defaultDraft();
  }
}

function saveDraft(): void {
  if (!form || !state) return;
  state.draft = collectDraft();
  state.draft.step = state.currentStep;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(state.draft));
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

function setRadio(name: string, value: string): void {
  document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
  });
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

function applyDraft(draft: PlanDraft): void {
  Object.entries(draft).forEach(([key, value]) => {
    if (key === 'step') return;
    const element = field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(key);
    if (element) element.value = String(value ?? '');
  });

  setRadio('requiresRooms', draft.requiresRooms || 'no');
  const endDate = field<HTMLInputElement>('endDate');
  const eventDate = field<HTMLInputElement>('eventDate');
  if (endDate && eventDate?.value) endDate.min = eventDate.value;
  syncRoomField();
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
    if (!fieldValue('budgetRange')) return fail('Select an approximate budget range.', 'budgetRange');
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
      setFieldError(targetEl, message);
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  saveDraft();
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
    saveDraft();
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
  saveDraft();
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

// Interactive Equipment Grid & Tabs
function renderEquipmentGrid(): void {
  if (!state) return;
  const grid = document.querySelector<HTMLElement>('[data-equipment-grid]');
  const status = document.querySelector<HTMLElement>('[data-plan-equipment-status]');
  if (!grid) return;

  if (!state.activeEquipmentCategory) {
    state.activeEquipmentCategory = state.catalogue.equipment[0]?.slug ?? '';
  }

  const category = state.catalogue.equipment.find((entry) => entry.slug === state?.activeEquipmentCategory);
  const equipment = readRequirements().equipment;
  const equipmentMap = new Map(equipment.map((item) => [item.id, item.quantity]));

  if (status) {
    const totalUnits = equipment.reduce((sum, item) => sum + item.quantity, 0);
    status.textContent =
      equipment.length === 0
        ? '0 items selected'
        : `${equipment.length} line items · ${totalUnits} units`;
  }

  if (!category || category.items.length === 0) {
    grid.innerHTML = '<p class="empty-inline">No inventory items available in this category.</p>';
    return;
  }

  grid.innerHTML = category.items
    .map((item) => {
      const currentQty = equipmentMap.get(String(item.id)) || 0;
      const isSelected = currentQty > 0;
      return `
        <div class="equipment-mini-card ${isSelected ? 'is-selected' : ''}" data-equipment-id="${item.id}">
          <div class="equipment-mini-info">
            <strong class="equipment-mini-title">${esc(item.name)}</strong>
            <span class="equipment-mini-specs">${esc(item.specifications || item.description)}</span>
            <small class="equipment-mini-unit">Per ${esc(item.unit)} · Min ${item.min_quantity}</small>
          </div>
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

  renderEquipmentGrid();
  renderLiveSummary();
}

// Live Blueprint Sidebar
function renderLiveSummary(): void {
  const target = document.querySelector<HTMLElement>('[data-plan-live-summary]');
  if (!target) return;

  const requirements = readRequirements();
  const totalUnits = requirements.equipment.reduce((sum, item) => sum + item.quantity, 0);

  const eventType = fieldValue('eventType') || 'Celebration';
  const eventDate = fieldValue('eventDate');
  const venue = fieldValue('venueLocation');
  const guests = fieldValue('guestCount');
  const requiresRooms = radioValue('requiresRooms') === 'yes';
  const acRooms = Number(fieldValue('acRoomCount')) || 0;
  const nonAcRooms = Number(fieldValue('nonAcRoomCount')) || 0;

  const dateFormatted = eventDate ? new Date(`${eventDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date pending';

  target.innerHTML = `
    <div class="blueprint-row">
      <span class="blueprint-label">Celebration</span>
      <strong class="blueprint-value">${esc(eventType)} · ${esc(dateFormatted)}</strong>
    </div>
    <div class="blueprint-row">
      <span class="blueprint-label">Venue</span>
      <strong class="blueprint-value">${esc(venue || 'Ranchi location pending')}</strong>
    </div>
    <div class="blueprint-row">
      <span class="blueprint-label">Attendance</span>
      <strong class="blueprint-value">${guests ? `${esc(guests)} Guests` : 'Guest count pending'}</strong>
    </div>
    <div class="blueprint-row">
      <span class="blueprint-label">Mandap</span>
      <strong class="blueprint-value">${requirements.mandap ? esc(requirements.mandap.name) : '— No mandap'}</strong>
    </div>
    <div class="blueprint-row">
      <span class="blueprint-label">Stage</span>
      <strong class="blueprint-value">${requirements.stage ? esc(requirements.stage.name) : '— No stage'}</strong>
    </div>
    <div class="blueprint-row">
      <span class="blueprint-label">Equipment</span>
      <strong class="blueprint-value">${requirements.equipment.length > 0 ? `${requirements.equipment.length} items (${totalUnits} units)` : '— None selected'}</strong>
    </div>
    <div class="blueprint-row">
      <span class="blueprint-label">Rooms</span>
      <strong class="blueprint-value">${requiresRooms ? `${acRooms} AC, ${nonAcRooms} Non-AC` : 'Self-arranged'}</strong>
    </div>
  `;
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
        <div><dt>Equipment Items</dt><dd>${equipmentHtml}</dd></div>
        ${draft.equipmentNotes ? `<div><dt>Setup Notes</dt><dd>${esc(draft.equipmentNotes)}</dd></div>` : ''}
        <div><dt>Accommodation</dt><dd>${roomsText}</dd></div>
      </dl>
    </div>

    <div class="review-card">
      <div class="review-card-head">
        <h4>4. Contact &amp; Budget Information</h4>
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
    equipment: requirements.equipment.map((item: EquipmentRequirement) => ({
      id: Number(item.id),
      quantity: item.quantity,
      notes: item.notes,
    })),
    equipmentNotes: fieldValue('equipmentNotes'),
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
      pdfUrl?: string;
      message?: string;
    };

    if (!response.ok || data.status !== 'success' || !data.reference) {
      throw new Error(data.message || 'We could not submit the enquiry. Please try again.');
    }

    const receiptUrl = data.receiptUrl || `/receipts/enquiry/${data.reference}${data.token ? `?token=${data.token}` : ''}`;
    const pdfUrl = data.pdfUrl || `/api/enquiries/receipt/${data.reference}/pdf${data.token ? `?token=${data.token}` : ''}`;

    showReceipt(data.reference, data.qrDataUrl, receiptUrl, pdfUrl);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'We could not submit the enquiry. Please try again.');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

function showReceipt(reference: string, qrDataUrl?: string, receiptUrl?: string, pdfUrl?: string): void {
  if (planShell) planShell.hidden = true;
  if (receipt) {
    receipt.hidden = false;
    const referenceNode = receipt.querySelector<HTMLElement>('[data-receipt-reference]');
    if (referenceNode) referenceNode.textContent = reference;

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
    }

    if (pdfUrl) {
      const pdfLink = receipt.querySelector<HTMLAnchorElement>('[data-receipt-pdf-link]');
      if (pdfLink) pdfLink.href = pdfUrl;
    }

    const heading = receipt.querySelector<HTMLElement>('h2');
    heading?.setAttribute('tabindex', '-1');
    receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    heading?.focus({ preventScroll: true });
  }

  clearRequirements();
  localStorage.removeItem(DRAFT_KEY);
}

// Initialization and Event Listeners
if (state && form) {
  state.draft = readDraft();
  state.activeEquipmentCategory = state.catalogue.equipment[0]?.slug ?? '';

  applyDraft(state.draft);
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
  renderLiveSummary();

  const initialStep = Math.min(Math.max(Number(state.draft.step) || 1, 1), 4);
  goToStep(initialStep, false);

  form.addEventListener('input', (event) => {
    if (event.target instanceof HTMLElement) clearFieldError(event.target);
    saveDraft();
    renderLiveSummary();
    if (state.currentStep === 4) renderReview();
  });

  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLElement) clearFieldError(event.target);
    saveDraft();
    renderLiveSummary();
    if (state.currentStep === 4) renderReview();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitEnquiry();
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

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
      saveDraft();
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
      saveDraft();
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
      saveDraft();
      renderLiveSummary();
      return;
    }

    if (target.matches('[name="eventDate"]')) {
      const eventDate = field<HTMLInputElement>('eventDate')?.value ?? '';
      const endDate = field<HTMLInputElement>('endDate');
      if (endDate) {
        endDate.min = eventDate || today;
        if (endDate.value && eventDate && endDate.value < eventDate) endDate.value = '';
      }
      saveDraft();
      renderLiveSummary();
    }
  });

  window.addEventListener(REQUIREMENTS_EVENT, () => {
    syncMandapCardSelection();
    syncStageCardSelection();
    renderEquipmentGrid();
    renderLiveSummary();
    if (state.currentStep === 4) renderReview();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== REQUIREMENTS_STORAGE_KEY) return;
    syncMandapCardSelection();
    syncStageCardSelection();
    renderEquipmentGrid();
    renderLiveSummary();
    if (state.currentStep === 4) renderReview();
  });

  saveDraft();
}
