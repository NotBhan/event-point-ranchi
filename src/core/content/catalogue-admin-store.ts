import { getD1Client } from './d1-client';

export type CatalogueKind = 'mandaps' | 'stages' | 'equipment';

export type CatalogueStatusFilter = 'all' | 'active' | 'draft' | 'archived';

export interface CatalogueListQuery {
  q?: string;
  status?: CatalogueStatusFilter;
  category?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

export interface CatalogueListItem {
  id: number;
  name: string;
  slug: string;
  image_url: string;
  category: string;
  price_paise: number;
  is_visible: number;
  is_archived: number;
  is_featured: number;
  sort_order: number;
  updated_at: string;
}

export interface CatalogueImageRow {
  id: number;
  image_url: string;
  alt_text: string;
  sort_order: number;
}

export interface CatalogueCategory {
  value: string;
  label: string;
}

interface CatalogueConfig {
  table: 'mandaps' | 'stages' | 'furniture_items';
  galleryTable: 'mandap_gallery' | 'stage_gallery' | 'furniture_item_images';
  galleryForeignKey: 'mandap_id' | 'stage_id' | 'item_id';
  categoryColumn: 'category' | 'style_category' | 'category_id';
  categoryIsId: boolean;
  priceColumn: 'price_starting_paise' | 'price_paise';
  nameColumn: 'name';
  columns: Set<string>;
}

const COMMON_COLUMNS = [
  'name',
  'slug',
  'description',
  'full_description',
  'image_url',
  'image_alt',
  'is_featured',
  'is_visible',
  'is_archived',
  'archived_at',
  'sort_order',
];

const CONFIG: Record<CatalogueKind, CatalogueConfig> = {
  mandaps: {
    table: 'mandaps',
    galleryTable: 'mandap_gallery',
    galleryForeignKey: 'mandap_id',
    categoryColumn: 'category',
    categoryIsId: false,
    priceColumn: 'price_starting_paise',
    nameColumn: 'name',
    columns: new Set([
      ...COMMON_COLUMNS,
      'category',
      'length_ft',
      'width_ft',
      'height_ft',
      'dimension_unit',
      'material_specs',
      'price_starting_paise',
      'capacity',
      'features_json',
      'location_name',
      'address',
      'latitude',
      'longitude',
      'google_maps_url',
      'directions_url',
      'show_location',
    ]),
  },
  stages: {
    table: 'stages',
    galleryTable: 'stage_gallery',
    galleryForeignKey: 'stage_id',
    categoryColumn: 'style_category',
    categoryIsId: false,
    priceColumn: 'price_starting_paise',
    nameColumn: 'name',
    columns: new Set([
      ...COMMON_COLUMNS,
      'style_category',
      'length_ft',
      'width_ft',
      'height_ft',
      'dimension_unit',
      'decoration_notes',
      'price_starting_paise',
    ]),
  },
  equipment: {
    table: 'furniture_items',
    galleryTable: 'furniture_item_images',
    galleryForeignKey: 'item_id',
    categoryColumn: 'category_id',
    categoryIsId: true,
    priceColumn: 'price_paise',
    nameColumn: 'name',
    columns: new Set([
      ...COMMON_COLUMNS,
      'category_id',
      'description',
      'full_description',
      'image_url',
      'image_alt',
      'price_paise',
      'pricing_unit',
      'dimensions',
      'specifications',
      'min_quantity',
      'default_quantity',
    ]),
  },
};

function configFor(kind: CatalogueKind): CatalogueConfig {
  return CONFIG[kind];
}

function statusSql(status: CatalogueStatusFilter = 'all'): string {
  if (status === 'active') return 'is_visible = 1 AND is_archived = 0';
  if (status === 'draft') return 'is_visible = 0 AND is_archived = 0';
  if (status === 'archived') return 'is_archived = 1';
  return '1 = 1';
}

function orderSql(kind: CatalogueKind, sort = 'order'): string {
  const config = configFor(kind);
  if (sort === 'name') return 'name COLLATE NOCASE ASC, id ASC';
  if (sort === 'price') return `${config.priceColumn} ASC, sort_order ASC, id ASC`;
  if (sort === 'updated') return 'updated_at DESC, id DESC';
  return 'sort_order ASC, id ASC';
}

export async function listCatalogueAdmin(
  kind: CatalogueKind,
  query: CatalogueListQuery = {},
): Promise<{ items: CatalogueListItem[]; totalCount: number; page: number; perPage: number; totalPages: number }> {
  const config = configFor(kind);
  const perPage = Math.max(1, Math.min(100, query.perPage ?? 20));
  const requestedPage = Math.max(1, query.page ?? 1);
  const where: string[] = [statusSql(query.status)];
  const params: unknown[] = [];

  if (query.q?.trim()) {
    where.push('(name LIKE ? OR slug LIKE ?)');
    const q = `%${query.q.trim()}%`;
    params.push(q, q);
  }

  if (query.category?.trim()) {
    where.push(`${config.categoryColumn} = ?`);
    params.push(config.categoryIsId ? Number(query.category) : query.category.trim());
  }

  const whereSql = where.join(' AND ');
  const d1 = getD1Client();
  const count = await d1.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${config.table} WHERE ${whereSql}`,
    params,
  );
  const totalCount = Number(count.results?.[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;
  const categorySelect = config.categoryIsId
    ? 'category_id AS category'
    : `${config.categoryColumn} AS category`;

  const rows = await d1.query<any>(
    `SELECT id, name, slug, image_url, ${categorySelect}, ${config.priceColumn} AS price_paise,
            is_visible, is_archived, is_featured, sort_order, updated_at
       FROM ${config.table}
      WHERE ${whereSql}
      ORDER BY ${orderSql(kind, query.sort)}
      LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return {
    items: (rows.results ?? []).map((row) => ({
      ...row,
      id: Number(row.id),
      price_paise: Number(row.price_paise ?? 0),
      is_visible: Number(row.is_visible ?? 0),
      is_archived: Number(row.is_archived ?? 0),
      is_featured: Number(row.is_featured ?? 0),
      sort_order: Number(row.sort_order ?? 0),
    })),
    totalCount,
    page,
    perPage,
    totalPages,
  };
}

export async function loadCatalogueAdmin(kind: CatalogueKind, id: number): Promise<{
  item: Record<string, unknown>;
  images: CatalogueImageRow[];
} | null> {
  const config = configFor(kind);
  const d1 = getD1Client();
  const result = await d1.query<any>(`SELECT * FROM ${config.table} WHERE id = ? LIMIT 1`, [id]);
  const item = result.results?.[0];
  if (!item) return null;

  const images = await d1.query<any>(
    `SELECT id, image_url, alt_text, sort_order
       FROM ${config.galleryTable}
      WHERE ${config.galleryForeignKey} = ?
      ORDER BY sort_order ASC, id ASC`,
    [id],
  );

  return {
    item,
    images: (images.results ?? []).map((row) => ({
      id: Number(row.id),
      image_url: String(row.image_url ?? ''),
      alt_text: String(row.alt_text ?? ''),
      sort_order: Number(row.sort_order ?? 0),
    })),
  };
}

export async function listCatalogueCategories(kind: CatalogueKind): Promise<CatalogueCategory[]> {
  const config = configFor(kind);
  const d1 = getD1Client();
  if (kind === 'equipment') {
    const result = await d1.query<{ id: number; name: string }>(
      'SELECT id, name FROM furniture_categories WHERE is_visible = 1 ORDER BY sort_order ASC, id ASC',
    );
    return (result.results ?? []).map((row) => ({ value: String(row.id), label: row.name }));
  }

  const result = await d1.query<{ category: string }>(
    `SELECT DISTINCT ${config.categoryColumn} AS category
       FROM ${config.table}
      WHERE ${config.categoryColumn} <> ''
      ORDER BY category COLLATE NOCASE ASC`,
  );
  return (result.results ?? []).map((row) => ({ value: row.category, label: row.category }));
}

export async function catalogueSlugTaken(kind: CatalogueKind, slug: string, excludeId = 0): Promise<boolean> {
  const config = configFor(kind);
  const result = await getD1Client().query<{ id: number }>(
    `SELECT id FROM ${config.table} WHERE slug = ? AND id <> ? LIMIT 1`,
    [slug, excludeId],
  );
  return Boolean(result.results?.[0]);
}

export async function saveCatalogueRow(
  kind: CatalogueKind,
  values: Record<string, unknown>,
  id?: number,
): Promise<number> {
  const config = configFor(kind);
  const entries = Object.entries(values).filter(([column]) => config.columns.has(column));
  if (entries.length === 0) throw new Error('No catalogue fields were supplied.');

  const d1 = getD1Client();
  if (id) {
    const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
    await d1.query(
      `UPDATE ${config.table} SET ${assignments}, updated_at = datetime('now') WHERE id = ?`,
      [...entries.map(([, value]) => value), id],
    );
    return id;
  }

  const columns = entries.map(([column]) => column);
  const placeholders = columns.map(() => '?').join(', ');
  const result = await d1.query(
    `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`,
    entries.map(([, value]) => value),
  );
  return Number(result.meta.last_row_id ?? 0);
}

export async function setCatalogueStatus(
  kind: CatalogueKind,
  id: number,
  status: 'active' | 'draft' | 'archived',
): Promise<void> {
  const config = configFor(kind);
  const d1 = getD1Client();
  if (status === 'archived') {
    await d1.query(
      `UPDATE ${config.table}
          SET is_visible = 0, is_archived = 1, archived_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      [id],
    );
    return;
  }
  await d1.query(
    `UPDATE ${config.table}
        SET is_visible = ?, is_archived = 0, archived_at = NULL, updated_at = datetime('now')
      WHERE id = ?`,
    [status === 'active' ? 1 : 0, id],
  );
}

export async function duplicateCatalogueItem(kind: CatalogueKind, id: number, slug: string): Promise<number> {
  const config = configFor(kind);
  const d1 = getD1Client();
  const result = await d1.query<any>(`SELECT * FROM ${config.table} WHERE id = ? LIMIT 1`, [id]);
  const source = result.results?.[0];
  if (!source) throw new Error('Catalogue item not found.');

  const copy: Record<string, unknown> = {};
  for (const column of config.columns) {
    if (column === 'slug' || column === 'is_visible' || column === 'is_archived' || column === 'archived_at') continue;
    if (column in source) copy[column] = source[column];
  }
  copy.name = `${source.name} (copy)`;
  copy.slug = slug;
  copy.is_visible = 0;
  copy.is_archived = 0;
  const newId = await saveCatalogueRow(kind, copy);

  const images = await d1.query<any>(
    `SELECT image_url, alt_text, sort_order FROM ${config.galleryTable} WHERE ${config.galleryForeignKey} = ? ORDER BY sort_order ASC, id ASC`,
    [id],
  );
  if (images.results?.length) {
    await d1.batch(
      images.results.map((image: any) => ({
        sql: `INSERT INTO ${config.galleryTable} (${config.galleryForeignKey}, image_url, alt_text, sort_order) VALUES (?, ?, ?, ?)`,
        params: [newId, image.image_url, image.alt_text || '', image.sort_order || 0],
      })),
    );
  }
  return newId;
}

export async function addCatalogueImage(
  kind: CatalogueKind,
  itemId: number,
  imageUrl: string,
  altText = '',
): Promise<number> {
  const config = configFor(kind);
  const d1 = getD1Client();
  const next = await d1.query<{ next: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ${config.galleryTable} WHERE ${config.galleryForeignKey} = ?`,
    [itemId],
  );
  const result = await d1.query(
    `INSERT INTO ${config.galleryTable} (${config.galleryForeignKey}, image_url, alt_text, sort_order)
     VALUES (?, ?, ?, ?)`,
    [itemId, imageUrl, altText, Number(next.results?.[0]?.next ?? 1)],
  );
  return Number(result.meta.last_row_id ?? 0);
}

export async function updateCatalogueImage(
  kind: CatalogueKind,
  imageId: number,
  altText: string,
): Promise<void> {
  const config = configFor(kind);
  await getD1Client().query(`UPDATE ${config.galleryTable} SET alt_text = ? WHERE id = ?`, [altText, imageId]);
}

export async function removeCatalogueImage(kind: CatalogueKind, imageId: number): Promise<void> {
  const config = configFor(kind);
  await getD1Client().query(`DELETE FROM ${config.galleryTable} WHERE id = ?`, [imageId]);
}

export async function moveCatalogueImage(
  kind: CatalogueKind,
  imageId: number,
  direction: 'up' | 'down',
): Promise<void> {
  const config = configFor(kind);
  const d1 = getD1Client();
  const current = await d1.query<any>(
    `SELECT id, ${config.galleryForeignKey} AS foreign_id, sort_order FROM ${config.galleryTable} WHERE id = ? LIMIT 1`,
    [imageId],
  );
  const row = current.results?.[0];
  if (!row) return;
  const comparison = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const neighbour = await d1.query<any>(
    `SELECT id, sort_order FROM ${config.galleryTable}
      WHERE ${config.galleryForeignKey} = ? AND sort_order ${comparison} ?
      ORDER BY sort_order ${order}, id ${order} LIMIT 1`,
    [row.foreign_id, row.sort_order],
  );
  const other = neighbour.results?.[0];
  if (!other) return;
  await d1.batch([
    { sql: `UPDATE ${config.galleryTable} SET sort_order = ? WHERE id = ?`, params: [other.sort_order, row.id] },
    { sql: `UPDATE ${config.galleryTable} SET sort_order = ? WHERE id = ?`, params: [row.sort_order, other.id] },
  ]);
}
