export type RequirementKind = 'mandap' | 'stage' | 'equipment';

export interface DimensionSet {
  length: number;
  width: number;
  height: number;
  unit: string;
}

export interface MandapRequirement {
  id: string;
  slug: string;
  name: string;
  category: string;
  image: string;
  standard: DimensionSet;
  requested: DimensionSet | null;
  note: string;
}

export interface StageRequirement {
  id: string;
  slug: string;
  name: string;
  category: string;
  image: string;
  standard: DimensionSet;
  requested: DimensionSet | null;
  note: string;
}

export interface EquipmentRequirement {
  id: string;
  slug: string;
  name: string;
  category: string;
  categorySlug: string;
  unit: string;
  specifications: string;
  image: string;
  quantity: number;
  minQuantity: number;
  notes: string;
}

export interface RequirementsState {
  mandap: MandapRequirement | null;
  stage: StageRequirement | null;
  equipment: EquipmentRequirement[];
}

export const REQUIREMENTS_EVENT = 'requirements:change';
export const REQUIREMENTS_STORAGE_KEY = 'eventPointRequirements:session:v1';
export const LEGACY_REQUIREMENTS_STORAGE_KEY = 'eventPointRequirements:v1';
const HANDOFF_TTL_MS = 30 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let memoryState: RequirementsState | null = null;

function sessionStore(): StorageLike | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function clone(state: RequirementsState): RequirementsState {
  return JSON.parse(JSON.stringify(state)) as RequirementsState;
}

function planPageIsOpen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.getElementById('planForm'));
}

function readHandoff(): RequirementsState {
  const store = sessionStore();
  if (!store) return emptyRequirements();

  try {
    const envelope = JSON.parse(store.getItem(REQUIREMENTS_STORAGE_KEY) ?? 'null') as
      | { state?: unknown; savedAt?: unknown }
      | null;
    if (!envelope || typeof envelope !== 'object') return emptyRequirements();

    const savedAt = Number(envelope.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > HANDOFF_TTL_MS) {
      store.removeItem(REQUIREMENTS_STORAGE_KEY);
      return emptyRequirements();
    }

    return normalizeRequirements(envelope.state);
  } catch {
    store.removeItem(REQUIREMENTS_STORAGE_KEY);
    return emptyRequirements();
  }
}

// Older builds wrote package selections into localStorage. Purge them as soon
// as this module loads; they are not a safe place for enquiry data.
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.removeItem(LEGACY_REQUIREMENTS_STORAGE_KEY);
  } catch {}
}

export function emptyRequirements(): RequirementsState {
  return { mandap: null, stage: null, equipment: [] };
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value: unknown, fallback: number): number {
  const parsed = toNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function normalizeDimensions(value: unknown): DimensionSet {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    length: positive(raw.length, 0),
    width: positive(raw.width, 0),
    height: positive(raw.height, 0),
    unit: String(raw.unit ?? 'ft'),
  };
}

function normalizeSelection(value: unknown, fallbackCategory: string): MandapRequirement | StageRequirement | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!raw.id || !raw.name) return null;
  const requested = raw.requested ? normalizeDimensions(raw.requested) : null;
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? ''),
    name: String(raw.name),
    category: String(raw.category ?? fallbackCategory),
    image: String(raw.image ?? ''),
    standard: normalizeDimensions(raw.standard),
    requested,
    note: String(raw.note ?? ''),
  };
}

function normalizeEquipment(value: unknown): EquipmentRequirement | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!raw.id || !raw.name) return null;
  const minQuantity = Math.max(1, toNumber(raw.minQuantity, 1));
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? ''),
    name: String(raw.name),
    category: String(raw.category ?? 'Equipment'),
    categorySlug: String(raw.categorySlug ?? ''),
    unit: String(raw.unit ?? 'piece'),
    specifications: String(raw.specifications ?? ''),
    image: String(raw.image ?? ''),
    quantity: Math.max(minQuantity, toNumber(raw.quantity, minQuantity)),
    minQuantity,
    notes: String(raw.notes ?? ''),
  };
}

export function normalizeRequirements(raw: unknown): RequirementsState {
  if (!raw || typeof raw !== 'object') return emptyRequirements();
  const value = raw as Record<string, unknown>;
  const equipment = Array.isArray(value.equipment)
    ? value.equipment
        .map(normalizeEquipment)
        .filter((item): item is EquipmentRequirement => Boolean(item))
    : [];

  return {
    mandap: normalizeSelection(value.mandap, 'Mandap') as MandapRequirement | null,
    stage: normalizeSelection(value.stage, 'Stage') as StageRequirement | null,
    equipment,
  };
}

export function readRequirements(): RequirementsState {
  if (memoryState) return clone(memoryState);
  memoryState = readHandoff();
  return clone(memoryState);
}

/**
 * The Plan page keeps package selections in memory for the lifetime of that
 * page. Any catalogue handoff is consumed once and removed, so a reload or a
 * later visit in the same tab starts blank.
 */
export function consumeRequirementsForPlan(): RequirementsState {
  const state = readRequirements();
  sessionStore()?.removeItem(REQUIREMENTS_STORAGE_KEY);
  return clone(state);
}

/**
 * Preserve the plan page's in-memory selections only for an explicit
 * same-tab navigation to a catalogue page (for example, to add another item).
 */
export function prepareRequirementsHandoff(): void {
  if (!memoryState) return;
  const store = sessionStore();
  if (!store) return;
  store.setItem(
    REQUIREMENTS_STORAGE_KEY,
    JSON.stringify({ state: memoryState, savedAt: Date.now() }),
  );
}

function commit(state: RequirementsState): RequirementsState {
  memoryState = clone(state);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_REQUIREMENTS_STORAGE_KEY);
    } catch {}
  }

  const store = sessionStore();
  if (store) {
    if (planPageIsOpen()) {
      // The Plan page must never persist its selections. Memory is enough for
      // step navigation; a reload starts blank.
      store.removeItem(REQUIREMENTS_STORAGE_KEY);
    } else {
      store.setItem(
        REQUIREMENTS_STORAGE_KEY,
        JSON.stringify({ state: memoryState, savedAt: Date.now() }),
      );
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REQUIREMENTS_EVENT, { detail: clone(memoryState) }));
  }
  return clone(memoryState);
}

export function getRequirementsCount(state: RequirementsState = readRequirements()): number {
  return (
    (state.mandap ? 1 : 0) +
    (state.stage ? 1 : 0) +
    state.equipment.reduce((sum, item) => sum + item.quantity, 0)
  );
}

export function hasRequirements(state: RequirementsState = readRequirements()): boolean {
  return Boolean(state.mandap || state.stage || state.equipment.length);
}

export function addMandap(input: Omit<MandapRequirement, 'requested' | 'note'> & Partial<Pick<MandapRequirement, 'requested' | 'note'>>): RequirementsState {
  const state = readRequirements();
  state.mandap = {
    ...input,
    standard: normalizeDimensions(input.standard),
    requested: input.requested ? normalizeDimensions(input.requested) : null,
    note: input.note ?? '',
  };
  return commit(state);
}

export function addStage(input: Omit<StageRequirement, 'requested' | 'note'> & Partial<Pick<StageRequirement, 'requested' | 'note'>>): RequirementsState {
  const state = readRequirements();
  state.stage = {
    ...input,
    standard: normalizeDimensions(input.standard),
    requested: input.requested ? normalizeDimensions(input.requested) : null,
    note: input.note ?? '',
  };
  return commit(state);
}

export function addEquipment(
  input: Omit<EquipmentRequirement, 'quantity' | 'notes'> &
    Partial<Pick<EquipmentRequirement, 'quantity' | 'notes'>>,
): RequirementsState {
  const state = readRequirements();
  const quantity = Math.max(input.minQuantity, input.quantity ?? input.minQuantity);
  const existing = state.equipment.find((entry) => entry.id === input.id);

  if (existing) {
    existing.quantity = Math.max(existing.minQuantity, existing.quantity + quantity);
    existing.notes = input.notes ?? existing.notes;
  } else {
    state.equipment.push({
      ...input,
      quantity,
      notes: input.notes ?? '',
      minQuantity: Math.max(1, input.minQuantity),
    });
  }

  return commit(state);
}

export function updateQuantity(itemId: string, quantity: number): RequirementsState {
  const state = readRequirements();
  const item = state.equipment.find((entry) => entry.id === String(itemId));
  if (item) {
    item.quantity = Math.max(item.minQuantity, Math.floor(quantity));
  }
  return commit(state);
}

export function removeLineItem(kind: RequirementKind, itemId = ''): RequirementsState {
  const state = readRequirements();
  if (kind === 'mandap') state.mandap = null;
  if (kind === 'stage') state.stage = null;
  if (kind === 'equipment') {
    state.equipment = state.equipment.filter((entry) => entry.id !== String(itemId));
  }
  return commit(state);
}

export function setSelectionDimensions(
  kind: 'mandap' | 'stage',
  requested: DimensionSet | null,
  note?: string,
): RequirementsState {
  const state = readRequirements();
  const selection = kind === 'mandap' ? state.mandap : state.stage;
  if (selection) {
    selection.requested = requested ? normalizeDimensions(requested) : null;
    if (note !== undefined) selection.note = note;
  }
  return commit(state);
}

export function updateEquipmentNotes(itemId: string, notes: string): RequirementsState {
  const state = readRequirements();
  const item = state.equipment.find((entry) => entry.id === String(itemId));
  if (item) item.notes = notes;
  return commit(state);
}

export function clearRequirements(): void {
  // Return to the cold-start state: the next read checks (now empty) session
  // storage instead of reusing a previous in-memory selection.
  memoryState = null;
  sessionStore()?.removeItem(REQUIREMENTS_STORAGE_KEY);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_REQUIREMENTS_STORAGE_KEY);
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(REQUIREMENTS_EVENT, { detail: emptyRequirements() }));
  }
}

export function formatDimensions(dimensions: DimensionSet | null | undefined): string {
  if (!dimensions) return '';
  return `${dimensions.length} × ${dimensions.width} × ${dimensions.height} ${dimensions.unit || 'ft'}`;
}
