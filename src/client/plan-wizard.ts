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
  mandapNotes: string;
  stageNotes: string;
  equipmentNotes: string;
  requiresRooms: string;
  roomCount: string;
  accommodationNotes: string;
  lighting: string;
  floralPalette: string;
  specialInstructions: string;
  budgetRange: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  preferredContact: string;
}

type DimensionResult = DimensionSet | null | 'invalid';

const DRAFT_KEY = 'eventPointPlanDraft:v1';
const STEP_LABELS = [
  'Event details',
  'Mandap',
  'Stage',
  'Equipment',
  'Accommodation',
  'Styling',
  'Budget & contact',
  'Review',
];

const form = document.getElementById('planForm') as HTMLFormElement | null;
const catalogueNode = document.getElementById('planCatalogue');
const planShell = document.getElementById('planShell');
const receipt = document.querySelector<HTMLElement>('[data-plan-receipt]');
const errorBox = document.querySelector<HTMLElement>('[data-plan-error]');
const progressText = document.querySelector<HTMLElement>('[data-plan-progress-text]');
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
    mandapNotes: '',
    stageNotes: '',
    equipmentNotes: '',
    requiresRooms: '',
    roomCount: '',
    accommodationNotes: '',
    lighting: 'Warm fairy lights',
    floralPalette: 'Maroon & ivory',
    specialInstructions: '',
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

function imageUrl(path: string | null | undefined): string {
  if (!path) return '/images/placeholder.jpg';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) return path;
  return `/${path.replace(/^\.?\//, '')}`;
}

function readDraft(): PlanDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<PlanDraft> | null;
    return { ...defaultDraft(), ...(raw ?? {}) };
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

function showError(message: string): void {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.focus({ preventScroll: false });
}

function clearError(): void {
  if (!errorBox) return;
  errorBox.hidden = true;
  errorBox.textContent = '';
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
    mandapNotes: fieldValue('mandapNotes'),
    stageNotes: fieldValue('stageNotes'),
    equipmentNotes: fieldValue('equipmentNotes'),
    requiresRooms: radioValue('requiresRooms'),
    roomCount: fieldValue('roomCount'),
    accommodationNotes: fieldValue('accommodationNotes'),
    lighting: fieldValue('lighting'),
    floralPalette: fieldValue('floralPalette'),
    specialInstructions: fieldValue('specialInstructions'),
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

  setRadio('requiresRooms', draft.requiresRooms);
  const endDate = field<HTMLInputElement>('endDate');
  const eventDate = field<HTMLInputElement>('eventDate');
  if (endDate && eventDate?.value) endDate.min = eventDate.value;
  syncRoomField();
}

function syncRoomField(): void {
  const wantsRooms = radioValue('requiresRooms') === 'yes';
  const container = document.querySelector<HTMLElement>('[data-room-count-field]');
  const roomInput = document.querySelector<HTMLInputElement>('[data-room-count-input]');
  if (container) container.hidden = !wantsRooms;
  if (roomInput) {
    roomInput.required = wantsRooms;
    if (!wantsRooms) roomInput.value = '';
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

  if (step === 1) {
    if (!fieldValue('eventType')) return fail('Select an event type to continue.');
    if (!isValidDate(fieldValue('eventDate'))) return fail('Enter a valid event date.');
    if (fieldValue('eventDate') < today) return fail('The event date cannot be in the past.');

    const endDate = fieldValue('endDate');
    if (endDate) {
      if (!isValidDate(endDate)) return fail('Enter a valid end date, or leave it blank.');
      if (endDate < fieldValue('eventDate')) return fail('The end date cannot be before the event date.');
    }

    if (fieldValue('venueLocation').length < 2) return fail('Enter the venue or location in Ranchi.');
    const guests = Number(fieldValue('guestCount'));
    if (!Number.isInteger(guests) || guests < 1 || guests > 100000) {
      return fail('Enter a guest count between 1 and 1,00,000.');
    }
  }

  if (step === 2 || step === 3) {
    const kind = step === 2 ? 'mandap' : 'stage';
    const select = field<HTMLSelectElement>(kind === 'mandap' ? 'mandapId' : 'stageId');
    const dimensions = customDimensions(kind);
    if (dimensions === 'invalid') {
      return fail(`Enter all three custom ${kind} dimensions in feet, or leave them all blank.`);
    }
    if (!select?.value && dimensions) {
      return fail(`Select a ${kind} before entering custom dimensions.`);
    }
  }

  if (step === 5) {
    const requiresRooms = radioValue('requiresRooms');
    if (!requiresRooms) return fail('Tell us whether you require rooms.');
    if (requiresRooms === 'yes') {
      const rooms = Number(fieldValue('roomCount'));
      if (!Number.isInteger(rooms) || rooms < 1 || rooms > 500) {
        return fail('Enter the number of rooms required, between 1 and 500.');
      }
    }
  }

  if (step === 7) {
    if (!fieldValue('budgetRange')) return fail('Select an approximate budget range.');
    if (fieldValue('customerName').length < 2) return fail('Enter your full name.');
    const digits = fieldValue('customerPhone').replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return fail('Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.');
    }
    const email = fieldValue('customerEmail');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail('Enter a valid email address, or leave it blank.');
    }
    if (!fieldValue('preferredContact')) return fail('Select a preferred contact method.');
  }

  if (step === 8) {
    const consent = field<HTMLInputElement>('consent');
    if (!consent?.checked) {
      return fail('Please confirm that you understand this is a quotation enquiry, not a booking.');
    }
  }

  return true;
}

function fail(message: string): false {
  showError(message);
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
    button.classList.toggle('is-active', value === target);
    button.classList.toggle('is-complete', value < target);
    if (value === target) {
      button.setAttribute('aria-current', 'step');
    } else {
      button.removeAttribute('aria-current');
    }
  });

  const prev = document.querySelector<HTMLButtonElement>('[data-plan-prev]');
  const next = document.querySelector<HTMLButtonElement>('[data-plan-next]');
  if (prev) prev.hidden = target === 1;
  if (next) next.hidden = target === steps.length;
  if (progressText) {
    progressText.textContent = `Step ${target} of ${steps.length} — ${STEP_LABELS[target - 1] ?? ''}`;
  }

  if (target === 8) renderReview();

  if (focus) {
    const active = steps[target - 1];
    const heading = active?.querySelector<HTMLElement>('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return `Requested ${formatDimensions(requested)} · Standard ${formatDimensions(selection.standard)}`;
  }
  return `Standard ${formatDimensions(selection.standard)}`;
}

function renderSelectionPreview(kind: 'mandap' | 'stage'): void {
  const target = document.querySelector<HTMLElement>(kind === 'mandap' ? '[data-mandap-preview]' : '[data-stage-preview]');
  if (!target) return;

  const selection = selectionFor(kind);
  if (!selection) {
    target.innerHTML = `<p class="empty-inline">No ${kind} selected. This step will be skipped and does not affect the rest of your enquiry.</p>`;
    return;
  }

  target.innerHTML = `
    <div class="selection-preview-card">
      <img src="${esc(imageUrl(selection.image))}" alt="" />
      <div class="selection-preview-copy">
        <strong>${esc(selection.name)}</strong>
        <span>${esc(selection.category)}</span>
        <small>${esc(dimensionsSummary(selection))}</small>
      </div>
      <button type="button" class="icon-btn" data-plan-clear-selection="${kind}" aria-label="Remove selected ${kind}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
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

function applySelection(kind: 'mandap' | 'stage', id: string): void {
  if (!state) return;

  if (!id) {
    removeLineItem(kind);
    syncSelectionInputs(kind);
    renderSelectionPreview(kind);
    saveDraft();
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
  }

  syncSelectionInputs(kind);
  renderSelectionPreview(kind);
  saveDraft();
}

function syncDimensionsFromInputs(kind: 'mandap' | 'stage'): void {
  const dimensions = customDimensions(kind);
  if (dimensions === 'invalid') return;
  const selection = selectionFor(kind);
  if (!selection) return;

  const noteField = field<HTMLTextAreaElement>(kind === 'mandap' ? 'mandapNotes' : 'stageNotes');
  setSelectionDimensions(kind, dimensions, noteField?.value ?? selection.note);
  renderSelectionPreview(kind);
}

function renderEquipmentList(focusId?: string): void {
  const container = document.querySelector<HTMLElement>('[data-equipment-selected-list]');
  const status = document.querySelector<HTMLElement>('[data-plan-equipment-status]');
  if (!container) return;

  const equipment = readRequirements().equipment;

  if (status) {
    status.textContent =
      equipment.length === 0
        ? 'No equipment selected yet.'
        : `${equipment.length} line item${equipment.length === 1 ? '' : 's'}, ${equipment.reduce((sum, item) => sum + item.quantity, 0)} total units.`;
  }

  if (equipment.length === 0) {
    container.innerHTML =
      '<p class="empty-inline">No equipment selected. Use “Add items” to browse chairs, tables, seating, lighting and essentials.</p>';
    return;
  }

  container.innerHTML = equipment
    .map(
      (item) => `
        <div class="plan-equipment-item" data-plan-equipment-row="${esc(item.id)}">
          <div class="plan-equipment-copy">
            <strong>${esc(item.name)}</strong>
            <span>${esc(item.category)} · per ${esc(item.unit)}</span>
          </div>
          <div class="qty" aria-label="Quantity for ${esc(item.name)}">
            <button type="button" data-plan-qty-step="-1" data-plan-equipment-id="${esc(item.id)}" aria-label="Reduce quantity">−</button>
            <input
              type="number"
              min="${item.minQuantity}"
              step="1"
              value="${item.quantity}"
              inputmode="numeric"
              data-plan-qty-input
              data-plan-equipment-id="${esc(item.id)}"
              aria-label="${esc(item.name)} quantity"
            />
            <button type="button" data-plan-qty-step="1" data-plan-equipment-id="${esc(item.id)}" aria-label="Increase quantity">+</button>
          </div>
          <span class="plan-equipment-unit">${esc(item.unit)}${item.quantity === 1 ? '' : 's'}</span>
          <button type="button" class="icon-btn danger" data-plan-remove-equipment="${esc(item.id)}" aria-label="Remove ${esc(item.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>`,
    )
    .join('');

  if (focusId) {
    window.requestAnimationFrame(() => {
      container
        .querySelector<HTMLInputElement>(`[data-plan-equipment-id="${focusId}"][data-plan-qty-input]`)
        ?.focus();
    });
  }
}

function renderEquipmentTabs(): void {
  if (!state) return;
  const container = document.querySelector<HTMLElement>('[data-equipment-tabs]');
  if (!container) return;

  if (!state.activeEquipmentCategory) {
    state.activeEquipmentCategory = state.catalogue.equipment[0]?.slug ?? '';
  }

  container.innerHTML = state.catalogue.equipment
    .map(
      (category) => `
        <button
          type="button"
          role="tab"
          data-equipment-tab="${esc(category.slug)}"
          aria-selected="${category.slug === state?.activeEquipmentCategory}"
        >${esc(category.name)}</button>`,
    )
    .join('');
}

function renderEquipmentDrawerList(): void {
  if (!state) return;
  const container = document.querySelector<HTMLElement>('[data-equipment-drawer-list]');
  if (!container) return;

  const category = state.catalogue.equipment.find((entry) => entry.slug === state?.activeEquipmentCategory);
  if (!category || category.items.length === 0) {
    container.innerHTML = '<p class="empty-inline">No items in this category.</p>';
    return;
  }

  const selected = new Set(readRequirements().equipment.map((item) => item.id));
  container.innerHTML = category.items
    .map(
      (item) => `
        <div class="drawer-item">
          <div class="drawer-item-copy">
            <strong>${esc(item.name)}</strong>
            <span>${esc(item.description)}</span>
            <small>Default ${item.default_quantity} ${esc(item.unit)}${item.default_quantity === 1 ? '' : 's'} · minimum ${item.min_quantity}</small>
          </div>
          <button
            type="button"
            class="btn ${selected.has(String(item.id)) ? 'btn-secondary' : 'btn-primary'} btn-sm"
            data-wizard-add-equipment="${item.id}"
          >
            ${selected.has(String(item.id)) ? 'Add more' : 'Add item'}
          </button>
        </div>`,
    )
    .join('');
}

function updateEquipmentDrawerOpen(open: boolean): void {
  const drawer = document.querySelector<HTMLElement>('[data-equipment-drawer]');
  const button = document.querySelector<HTMLButtonElement>('[data-open-equipment-drawer]');
  if (drawer) drawer.hidden = !open;
  if (button) button.setAttribute('aria-expanded', String(open));
  if (open) {
    renderEquipmentTabs();
    renderEquipmentDrawerList();
    document.querySelector<HTMLButtonElement>('[data-equipment-tab]')?.focus();
  }
}

function renderLiveSummary(): void {
  const target = document.querySelector<HTMLElement>('[data-plan-live-summary]');
  if (!target) return;
  const requirements = readRequirements();
  const equipmentUnits = requirements.equipment.reduce((sum, item) => sum + item.quantity, 0);

  target.innerHTML = `
    <div class="live-summary-row"><span>Mandap</span><strong>${esc(requirements.mandap?.name ?? 'Not selected')}</strong></div>
    <div class="live-summary-row"><span>Stage</span><strong>${esc(requirements.stage?.name ?? 'Not selected')}</strong></div>
    <div class="live-summary-row"><span>Equipment</span><strong>${requirements.equipment.length} lines · ${equipmentUnits} units</strong></div>`;
}

function reviewSection(title: string, step: number, rows: Array<[string, string]>): string {
  return `
    <section class="plan-review-section">
      <div class="plan-review-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="btn btn-secondary btn-sm" data-plan-edit="${step}">Edit</button>
      </div>
      <dl>
        ${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value || '—'}</dd></div>`).join('')}
      </dl>
    </section>`;
}

function renderReview(): void {
  if (!state) return;
  const target = document.querySelector<HTMLElement>('[data-plan-review]');
  if (!target) return;

  const requirements = readRequirements();
  const draft = collectDraft();
  const equipment = requirements.equipment;
  const equipmentText =
    equipment.length === 0
      ? 'No equipment selected'
      : `<ul class="review-line-list">${equipment
          .map(
            (item) =>
              `<li><strong>${item.quantity} ${esc(item.unit)}${item.quantity === 1 ? '' : 's'}</strong> × ${esc(item.name)}${item.notes ? `<small>${esc(item.notes)}</small>` : ''}</li>`,
          )
          .join('')}</ul>`;
  const mandapRows: Array<[string, string]> = requirements.mandap
    ? [
        ['Design', esc(requirements.mandap.name)],
        ['Standard dimensions', esc(formatDimensions(requirements.mandap.standard))],
        [
          'Requested dimensions',
          requirements.mandap.requested ? esc(formatDimensions(requirements.mandap.requested)) : 'Use standard size',
        ],
        ['Notes', esc(requirements.mandap.note)],
      ]
    : [['Selection', 'Skipped — no mandap selected']];
  const stageRows: Array<[string, string]> = requirements.stage
    ? [
        ['Design', esc(requirements.stage.name)],
        ['Standard dimensions', esc(formatDimensions(requirements.stage.standard))],
        [
          'Requested dimensions',
          requirements.stage.requested ? esc(formatDimensions(requirements.stage.requested)) : 'Use standard size',
        ],
        ['Notes', esc(requirements.stage.note)],
      ]
    : [['Selection', 'Skipped — no stage selected']];

  target.innerHTML = [
    reviewSection('Event details', 1, [
      ['Event type', esc(draft.eventType)],
      ['Date', esc(draft.eventDate)],
      ['End date', esc(draft.endDate)],
      ['Start time', esc(draft.eventTime)],
      ['Venue', esc(draft.venueLocation)],
      ['Guest count', esc(draft.guestCount)],
      ['Description', esc(draft.eventDescription)],
    ]),
    reviewSection('Mandap', 2, mandapRows),
    reviewSection('Stage', 3, stageRows),
    reviewSection('Furniture & equipment', 4, [
      ['Selected items', equipmentText],
      ['Equipment notes', esc(draft.equipmentNotes)],
    ]),
    reviewSection('Accommodation', 5, [
      ['Rooms required', draft.requiresRooms === 'yes' ? 'Yes' : draft.requiresRooms === 'no' ? 'No' : 'Not answered'],
      ['Room count', draft.requiresRooms === 'yes' ? esc(draft.roomCount) : '—'],
      ['Notes', esc(draft.accommodationNotes)],
    ]),
    reviewSection('Styling', 6, [
      ['Lighting', esc(draft.lighting)],
      ['Floral palette', esc(draft.floralPalette)],
      ['Special instructions', esc(draft.specialInstructions)],
    ]),
    reviewSection('Budget & contact', 7, [
      ['Budget range', esc(draft.budgetRange)],
      ['Name', esc(draft.customerName)],
      ['Mobile', esc(draft.customerPhone)],
      ['Email', esc(draft.customerEmail)],
      ['Preferred contact', esc(draft.preferredContact)],
    ]),
  ].join('');
}

function buildPayload(): Record<string, unknown> {
  const requirements = readRequirements();
  const selected = (selection: MandapRequirement | StageRequirement | null) =>
    selection
      ? {
          id: Number(selection.id),
          requested: selection.requested,
          note: selection.note,
        }
      : null;

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
      roomCount: Number(fieldValue('roomCount')) || 0,
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
    button.textContent = 'Sending enquiry…';
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

    const data = (await response.json().catch(() => ({}))) as { status?: string; reference?: string; message?: string };

    if (!response.ok || data.status !== 'success' || !data.reference) {
      throw new Error(data.message || 'We could not submit the enquiry. Please try again.');
    }

    showReceipt(data.reference);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'We could not submit the enquiry. Please try again.');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

function showReceipt(reference: string): void {
  if (planShell) planShell.hidden = true;
  if (receipt) {
    receipt.hidden = false;
    const referenceNode = receipt.querySelector<HTMLElement>('[data-receipt-reference]');
    if (referenceNode) referenceNode.textContent = reference;
    const heading = receipt.querySelector<HTMLElement>('h2');
    heading?.setAttribute('tabindex', '-1');
    receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
    heading?.focus({ preventScroll: true });
  }

  clearRequirements();
  localStorage.removeItem(DRAFT_KEY);
}

if (state && form) {
  state.draft = readDraft();
  state.activeEquipmentCategory = state.catalogue.equipment[0]?.slug ?? '';

  applyDraft(state.draft);
  syncSelectionInputs('mandap');
  syncSelectionInputs('stage');

  if (!fieldValue('mandapNotes')) {
    const note = field<HTMLTextAreaElement>('mandapNotes');
    if (note && selectionFor('mandap')?.note) note.value = selectionFor('mandap')?.note ?? '';
  }
  if (!fieldValue('stageNotes')) {
    const note = field<HTMLTextAreaElement>('stageNotes');
    if (note && selectionFor('stage')?.note) note.value = selectionFor('stage')?.note ?? '';
  }

  renderSelectionPreview('mandap');
  renderSelectionPreview('stage');
  renderEquipmentList();
  renderLiveSummary();

  const initialStep = Math.min(Math.max(Number(state.draft.step) || 1, 1), 8);
  goToStep(initialStep, false);

  form.addEventListener('input', () => {
    saveDraft();
    if (state.currentStep === 8) renderReview();
    renderLiveSummary();
  });

  form.addEventListener('change', () => {
    saveDraft();
    if (state.currentStep === 8) renderReview();
    renderLiveSummary();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitEnquiry();
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

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
      goToStep(Number(stepLink.dataset.planStepLink));
      return;
    }

    const edit = target.closest<HTMLElement>('[data-plan-edit]');
    if (edit) {
      goToStep(Number(edit.dataset.planEdit));
      return;
    }

    const clearSelection = target.closest<HTMLElement>('[data-plan-clear-selection]');
    if (clearSelection) {
      const kind = clearSelection.dataset.planClearSelection === 'stage' ? 'stage' : 'mandap';
      removeLineItem(kind);
      syncSelectionInputs(kind);
      renderSelectionPreview(kind);
      saveDraft();
      return;
    }

    const openDrawer = target.closest<HTMLElement>('[data-open-equipment-drawer]');
    if (openDrawer) {
      updateEquipmentDrawerOpen(true);
      return;
    }

    const closeDrawer = target.closest<HTMLElement>('[data-close-equipment-drawer]');
    if (closeDrawer) {
      updateEquipmentDrawerOpen(false);
      document.querySelector<HTMLButtonElement>('[data-open-equipment-drawer]')?.focus();
      return;
    }

    const equipmentTab = target.closest<HTMLElement>('[data-equipment-tab]');
    if (equipmentTab) {
      state.activeEquipmentCategory = equipmentTab.dataset.equipmentTab ?? '';
      renderEquipmentTabs();
      renderEquipmentDrawerList();
      return;
    }

    const addItem = target.closest<HTMLElement>('[data-wizard-add-equipment]');
    if (addItem) {
      const id = Number(addItem.dataset.wizardAddEquipment);
      const item = state.catalogue.equipment.flatMap((category) => category.items).find((entry) => entry.id === id);
      const category = state.catalogue.equipment.find((entry) => entry.items.some((candidate) => candidate.id === id));
      if (item && category) {
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
          quantity: item.default_quantity,
        });
        renderEquipmentList();
        renderEquipmentDrawerList();
        renderLiveSummary();
      }
      return;
    }

    const qtyStep = target.closest<HTMLElement>('[data-plan-qty-step]');
    if (qtyStep) {
      const id = qtyStep.dataset.planEquipmentId ?? '';
      const item = readRequirements().equipment.find((entry) => entry.id === id);
      if (item) {
        updateQuantity(id, item.quantity + Number(qtyStep.dataset.planQtyStep ?? 0));
        renderEquipmentList(id);
      }
      return;
    }

    const remove = target.closest<HTMLElement>('[data-plan-remove-equipment]');
    if (remove) {
      removeLineItem('equipment', remove.dataset.planRemoveEquipment ?? '');
      renderEquipmentList();
      renderEquipmentDrawerList();
      return;
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;

    if (target.matches('[data-plan-qty-input]')) {
      const input = target as HTMLInputElement;
      updateQuantity(input.dataset.planEquipmentId ?? '', Number(input.value));
      renderEquipmentList(input.dataset.planEquipmentId);
      return;
    }

    if (target.matches('[name="mandapId"]')) {
      applySelection('mandap', (target as HTMLSelectElement).value);
      return;
    }

    if (target.matches('[name="stageId"]')) {
      applySelection('stage', (target as HTMLSelectElement).value);
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
        renderSelectionPreview(kind);
      }
      return;
    }

    if (target.matches('[name="requiresRooms"]')) {
      syncRoomField();
      saveDraft();
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
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const drawer = document.querySelector<HTMLElement>('[data-equipment-drawer]');
      if (drawer && !drawer.hidden) {
        updateEquipmentDrawerOpen(false);
        document.querySelector<HTMLButtonElement>('[data-open-equipment-drawer]')?.focus();
      }
    }
  });

  window.addEventListener(REQUIREMENTS_EVENT, () => {
    renderSelectionPreview('mandap');
    renderSelectionPreview('stage');
    renderEquipmentList();
    renderLiveSummary();
    if (state.currentStep === 8) renderReview();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== REQUIREMENTS_STORAGE_KEY) return;
    renderSelectionPreview('mandap');
    renderSelectionPreview('stage');
    renderEquipmentList();
    renderLiveSummary();
  });

  saveDraft();
}
