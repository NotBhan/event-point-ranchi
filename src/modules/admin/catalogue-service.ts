import { buildPagination, getBoolean, getInt, getString, parseMoneyToPaise } from '../../core/http';
import { saveUploadedImage } from '../../core/uploads';
import { invalidateContentCache } from '../../core/content/service';
import {
  addCatalogueImage,
  catalogueSlugTaken,
  duplicateCatalogueItem,
  listCatalogueAdmin,
  listCatalogueCategories,
  loadCatalogueAdmin,
  moveCatalogueImage,
  removeCatalogueImage,
  saveCatalogueRow,
  setCatalogueStatus,
  updateCatalogueImage,
  type CatalogueKind,
  type CatalogueStatusFilter,
} from '../../core/content/catalogue-admin-store';

export const CATALOGUE_KINDS: CatalogueKind[] = ['mandaps', 'stages', 'equipment'];

export const CATALOGUE_LABELS: Record<CatalogueKind, string> = {
  mandaps: 'Mandaps',
  stages: 'Stages',
  equipment: 'Equipment',
};

const KIND_FOLDERS: Record<CatalogueKind, string> = {
  mandaps: 'mandaps',
  stages: 'stages',
  equipment: 'equipment',
};

const KIND_ENTITY_TYPES: Record<CatalogueKind, 'mandap' | 'stage' | 'equipment'> = {
  mandaps: 'mandap',
  stages: 'stage',
  equipment: 'equipment',
};

export function isCatalogueKind(value: string): value is CatalogueKind {
  return (CATALOGUE_KINDS as string[]).includes(value);
}

export function catalogueBasePath(kind: CatalogueKind): string {
  return `/admin/${kind}`;
}

export function cataloguePreviewPath(kind: CatalogueKind, slug: string): string {
  if (kind === 'mandaps') return `/mandaps/${slug}`;
  if (kind === 'stages') return `/stages/${slug}`;
  return `/equipment?item=${encodeURIComponent(slug)}`;
}

export async function loadCatalogueList(
  kind: CatalogueKind,
  url: URL,
): Promise<{
  kind: CatalogueKind;
  items: Awaited<ReturnType<typeof listCatalogueAdmin>>['items'];
  pagination: ReturnType<typeof buildPagination>;
  categories: Awaited<ReturnType<typeof listCatalogueCategories>>;
  filters: { q: string; status: CatalogueStatusFilter; category: string; sort: string };
}> {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const status = (url.searchParams.get('status') ?? 'all') as CatalogueStatusFilter;
  const category = url.searchParams.get('category')?.trim() ?? '';
  const sort = url.searchParams.get('sort') ?? 'order';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const perPage = 20;
  const result = await listCatalogueAdmin(kind, { q, status, category, sort, page, perPage });
  const [categories] = await Promise.all([listCatalogueCategories(kind)]);

  return {
    kind,
    items: result.items,
    pagination: buildPagination(result.page, perPage, result.totalCount, result.items.length),
    categories,
    filters: {
      q,
      status: ['all', 'active', 'draft', 'archived'].includes(status) ? status : 'all',
      category,
      sort,
    },
  };
}

export async function loadCatalogueEditor(kind: CatalogueKind, id: number) {
  const [data, categories] = await Promise.all([loadCatalogueAdmin(kind, id), listCatalogueCategories(kind)]);
  if (!data) return null;
  return {
    kind,
    item: data.item,
    images: data.images,
    categories,
  };
}

function textLinesToJson(value: string): string {
  return JSON.stringify(
    value
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function formValue(form: FormData | null, name: string, fallback = ''): string {
  return getString(form, name) || fallback;
}

function formNumber(form: FormData | null, name: string, fallback = 0): number {
  const value = Number(formValue(form, name));
  return Number.isFinite(value) ? value : fallback;
}

export async function saveCatalogueEditor(
  kind: CatalogueKind,
  form: FormData | null,
  id?: number,
): Promise<number> {
  const name = formValue(form, 'name').trim();
  if (!name) throw new Error('Name is required.');
  const slugInput = formValue(form, 'slug').trim() || name;
  const slug = await uniqueSlug(slugInput, id ?? 0, kind);
  const status = formValue(form, 'status', 'draft');
  if (!['active', 'draft', 'archived'].includes(status)) throw new Error('Invalid publication status.');
  const pricingMode = formValue(form, 'pricing_mode', 'fixed');
  const price = pricingMode === 'on_request' ? 0 : parseMoneyToPaise(formValue(form, 'price'));
  if (price < 0) throw new Error('Price cannot be negative.');

  const current = id ? await loadCatalogueAdmin(kind, id) : null;
  const image = await saveUploadedImage(form, 'image', KIND_FOLDERS[kind], {
    entityType: KIND_ENTITY_TYPES[kind],
    entityId: id ?? slug,
    slot: 'primary',
  });

  const common: Record<string, unknown> = {
    name,
    slug,
    description: formValue(form, 'description'),
    full_description: formValue(form, 'full_description'),
    image_url: (image ?? formValue(form, 'image_path')) || current?.item.image_url || '',
    image_alt: formValue(form, 'image_alt'),
    is_featured: getBoolean(form, 'is_featured') ? 1 : 0,
    is_visible: status === 'active' ? 1 : 0,
    is_archived: status === 'archived' ? 1 : 0,
    archived_at: status === 'archived' ? new Date().toISOString() : null,
    sort_order: getInt(form, 'sort_order', 0),
  };

  let values: Record<string, unknown>;
  if (kind === 'mandaps') {
    values = {
      ...common,
      category: formValue(form, 'category', 'Traditional Royal'),
      length_ft: formNumber(form, 'length_ft', 16),
      width_ft: formNumber(form, 'width_ft', 16),
      height_ft: formNumber(form, 'height_ft', 12),
      dimension_unit: formValue(form, 'dimension_unit', 'ft'),
      material_specs: formValue(form, 'material_specs'),
      capacity: getInt(form, 'capacity', 0),
      features_json: textLinesToJson(formValue(form, 'features')),
      price_starting_paise: price,
    };
  } else if (kind === 'stages') {
    values = {
      ...common,
      style_category: formValue(form, 'style_category', 'Royal Reception'),
      length_ft: formNumber(form, 'length_ft', 24),
      width_ft: formNumber(form, 'width_ft', 16),
      height_ft: formNumber(form, 'height_ft', 14),
      dimension_unit: formValue(form, 'dimension_unit', 'ft'),
      decoration_notes: formValue(form, 'decoration_notes'),
      price_starting_paise: price,
    };
  } else {
    const categoryId = getInt(form, 'category_id', 0);
    if (!categoryId) throw new Error('Select an equipment category.');
    values = {
      ...common,
      category_id: categoryId,
      price_paise: price,
      pricing_unit: formValue(form, 'pricing_unit', 'per item'),
      dimensions: formValue(form, 'dimensions'),
      specifications: formValue(form, 'specifications'),
      min_quantity: Math.max(1, getInt(form, 'min_quantity', 1)),
      default_quantity: Math.max(1, getInt(form, 'default_quantity', 10)),
    };
  }

  const savedId = await saveCatalogueRow(kind, values, id);
  invalidateContentCache();
  return savedId;
}

async function uniqueSlug(input: string, id: number, kind: CatalogueKind): Promise<string> {
  const base =
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  let candidate = base;
  let suffix = 2;
  while (await catalogueSlugTaken(kind, candidate, id)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function archiveCatalogue(kind: CatalogueKind, id: number): Promise<void> {
  await setCatalogueStatus(kind, id, 'archived');
  invalidateContentCache();
}

export async function activateCatalogue(kind: CatalogueKind, id: number): Promise<void> {
  await setCatalogueStatus(kind, id, 'active');
  invalidateContentCache();
}

export async function draftCatalogue(kind: CatalogueKind, id: number): Promise<void> {
  await setCatalogueStatus(kind, id, 'draft');
  invalidateContentCache();
}

export async function duplicateCatalogue(kind: CatalogueKind, id: number): Promise<number> {
  const data = await loadCatalogueAdmin(kind, id);
  if (!data) throw new Error('Catalogue item not found.');
  const slug = await uniqueSlug(String(data.item.slug ?? 'item'), 0, kind);
  const newId = await duplicateCatalogueItem(kind, id, slug);
  invalidateContentCache();
  return newId;
}

export async function addCatalogueGalleryImage(
  kind: CatalogueKind,
  id: number,
  form: FormData | null,
): Promise<void> {
  const image = await saveUploadedImage(form, 'image', KIND_FOLDERS[kind], {
    entityType: KIND_ENTITY_TYPES[kind],
    entityId: `${id}-${Date.now()}`,
    slot: 'gallery',
  });
  if (!image) throw new Error('Choose an image to upload.');
  await addCatalogueImage(kind, id, image, formValue(form, 'alt_text'));
  invalidateContentCache();
}

export async function editCatalogueImage(kind: CatalogueKind, form: FormData | null): Promise<void> {
  await updateCatalogueImage(kind, getInt(form, 'image_id', 0), formValue(form, 'alt_text'));
  invalidateContentCache();
}

export async function deleteCatalogueImage(kind: CatalogueKind, id: number): Promise<void> {
  await removeCatalogueImage(kind, id);
  invalidateContentCache();
}

export async function reorderCatalogueImage(
  kind: CatalogueKind,
  form: FormData | null,
): Promise<void> {
  await moveCatalogueImage(kind, getInt(form, 'image_id', 0), formValue(form, 'direction') === 'up' ? 'up' : 'down');
  invalidateContentCache();
}
