import { getStages, getStageBySlug } from '../../core/content/service';

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

export async function loadStageCategories(): Promise<string[]> {
  const stages = await getStages();
  const cats = new Set<string>();
  for (const s of stages) {
    if (s.style_category) cats.add(s.style_category);
  }
  return Array.from(cats).sort();
}

export async function loadStagesPage(options: { category?: string; query?: string } = {}): Promise<StagesPageData> {
  const category = (options.category ?? '').trim();
  const query = (options.query ?? '').trim().toLowerCase();
  const allStages = await getStages();

  const filtered = allStages.filter((s) => {
    if (category && s.style_category !== category) return false;
    if (query) {
      const match =
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        (s.decoration_notes || '').toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  const stages: StageRow[] = filtered.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    image: s.image_url || null,
    style_category: s.style_category,
    length_ft: s.length_ft,
    width_ft: s.width_ft,
    height_ft: s.height_ft,
    dimension_unit: s.dimension_unit,
    decoration_notes: s.decoration_notes,
    sort: s.sort_order,
  }));

  const categories = await loadStageCategories();
  return { stages, categories, category, query: options.query ?? '' };
}

export async function loadStageDetail(slug: string): Promise<(StageRow & { gallery: string[] }) | null> {
  const s = await getStageBySlug(slug);
  if (!s) return null;

  const stage: StageRow = {
    id: s.id,
    name: s.name,
    slug: s.slug,
    description: s.description,
    image: s.image_url || null,
    style_category: s.style_category,
    length_ft: s.length_ft,
    width_ft: s.width_ft,
    height_ft: s.height_ft,
    dimension_unit: s.dimension_unit,
    decoration_notes: s.decoration_notes,
    sort: s.sort_order,
  };

  const gallery = (s.gallery || []).map((g) => g.image_url);
  return { ...stage, gallery };
}
