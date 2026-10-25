import { all, one } from '../../core/db';

export interface MandapRow {
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
  sort: number;
}

export interface MandapGalleryImage {
  id: number;
  image: string;
}

export interface MandapsPageData {
  mandaps: MandapRow[];
  categories: string[];
  category: string;
  query: string;
}

export function loadMandapCategories(): string[] {
  return all<{ category: string }>(
    'SELECT DISTINCT category FROM mandaps WHERE is_active = 1 ORDER BY category',
  ).map((row) => row.category);
}

export function loadMandapsPage(options: { category?: string; query?: string } = {}): MandapsPageData {
  const category = (options.category ?? '').trim();
  const query = (options.query ?? '').trim();
  const clauses = ['is_active = 1'];
  const params: unknown[] = [];

  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  if (query) {
    const like = `%${query}%`;
    clauses.push('(name LIKE ? OR description LIKE ? OR material_specs LIKE ?)');
    params.push(like, like, like);
  }

  const mandaps = all<MandapRow>(
    `SELECT id, name, slug, description, image, category, length_ft, width_ft, height_ft,
            dimension_unit, material_specs, sort
     FROM mandaps
     WHERE ${clauses.join(' AND ')}
     ORDER BY sort, id`,
    params,
  );

  return { mandaps, categories: loadMandapCategories(), category, query };
}

export function loadMandapDetail(slug: string): (MandapRow & { gallery: string[] }) | null {
  const mandap = one<MandapRow>(
    `SELECT id, name, slug, description, image, category, length_ft, width_ft, height_ft,
            dimension_unit, material_specs, sort
     FROM mandaps WHERE slug = ? AND is_active = 1`,
    [slug],
  );

  if (!mandap) return null;

  const gallery = all<MandapGalleryImage>(
    'SELECT id, image FROM mandap_gallery WHERE mandap_id = ? ORDER BY sort, id',
    [mandap.id],
  ).map((row) => row.image);

  return { ...mandap, gallery };
}
