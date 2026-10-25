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
export const REQUIREMENTS_STORAGE_KEY = 'eventPointRequirements:v1';

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
  try {
    return normalizeRequirements(JSON.parse(localStorage.getItem(REQUIREMENTS_STORAGE_KEY) ?? 'null'));
  } catch {
    return emptyRequirements();
  }
}

function commit(state: RequirementsState): RequirementsState {
  localStorage.setItem(REQUIREMENTS_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(REQUIREMENTS_EVENT, { detail: state }));
  return state;
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
  localStorage.removeItem(REQUIREMENTS_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(REQUIREMENTS_EVENT, { detail: emptyRequirements() }));
}

export function formatDimensions(dimensions: DimensionSet | null | undefined): string {
  if (!dimensions) return '';
  return `${dimensions.length} × ${dimensions.width} × ${dimensions.height} ${dimensions.unit || 'ft'}`;
}
