import { all, one } from '../../core/db';

export interface StageRow {
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
  sort: number;
}

export interface StagesPageData {
  stages: StageRow[];
  categories: string[];
  category: string;
  query: string;
}

export function loadStageCategories(): string[] {
  return all<{ style_category: string }>(
    'SELECT DISTINCT style_category FROM stages WHERE is_active = 1 ORDER BY style_category',
  ).map((row) => row.style_category);
}

export function loadStagesPage(options: { category?: string; query?: string } = {}): StagesPageData {
  const category = (options.category ?? '').trim();
  const query = (options.query ?? '').trim();
  const clauses = ['is_active = 1'];
  const params: unknown[] = [];

  if (category) {
    clauses.push('style_category = ?');
    params.push(category);
  }

  if (query) {
    const like = `%${query}%`;
    clauses.push('(name LIKE ? OR description LIKE ? OR decoration_notes LIKE ?)');
    params.push(like, like, like);
  }

  const stages = all<StageRow>(
    `SELECT id, name, slug, description, image, style_category, length_ft, width_ft, height_ft,
            dimension_unit, decoration_notes, sort
     FROM stages
     WHERE ${clauses.join(' AND ')}
     ORDER BY sort, id`,
    params,
  );

  return { stages, categories: loadStageCategories(), category, query };
}

export function loadStageDetail(slug: string): (StageRow & { gallery: string[] }) | null {
  const stage = one<StageRow>(
    `SELECT id, name, slug, description, image, style_category, length_ft, width_ft, height_ft,
            dimension_unit, decoration_notes, sort
     FROM stages WHERE slug = ? AND is_active = 1`,
    [slug],
  );

  if (!stage) return null;

  const gallery = all<{ image: string }>(
    'SELECT image FROM stage_gallery WHERE stage_id = ? ORDER BY sort, id',
    [stage.id],
  ).map((row) => row.image);

  return { ...stage, gallery };
}
