import { getMandaps, getMandapBySlug } from '../../core/content/service';

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
  location_name?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string;
  directions_url?: string;
  show_location?: boolean;
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

export async function loadMandapCategories(): Promise<string[]> {
  const mandaps = await getMandaps();
  const cats = new Set<string>();
  for (const m of mandaps) {
    if (m.category) cats.add(m.category);
  }
  return Array.from(cats).sort();
}

export async function loadMandapsPage(options: { category?: string; query?: string } = {}): Promise<MandapsPageData> {
  const category = (options.category ?? '').trim();
  const query = (options.query ?? '').trim().toLowerCase();
  const allMandaps = await getMandaps();

  const filtered = allMandaps.filter((m) => {
    if (category && m.category !== category) return false;
    if (query) {
      const match =
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        (m.material_specs || '').toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  const mandaps: MandapRow[] = filtered.map((m) => ({
    id: m.id,
    name: m.name,
    slug: m.slug,
    description: m.description,
    image: m.image_url || null,
    category: m.category,
    length_ft: m.length_ft,
    width_ft: m.width_ft,
    height_ft: m.height_ft,
    dimension_unit: m.dimension_unit,
    material_specs: m.material_specs,
    sort: m.sort_order,
    location_name: m.location_name,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    google_maps_url: m.google_maps_url,
    directions_url: m.directions_url,
    show_location: m.show_location,
  }));

  const categories = await loadMandapCategories();
  return { mandaps, categories, category, query: options.query ?? '' };
}

export async function loadMandapDetail(slug: string): Promise<(MandapRow & { gallery: string[] }) | null> {
  const m = await getMandapBySlug(slug);
  if (!m) return null;

  const mandap: MandapRow = {
    id: m.id,
    name: m.name,
    slug: m.slug,
    description: m.description,
    image: m.image_url || null,
    category: m.category,
    length_ft: m.length_ft,
    width_ft: m.width_ft,
    height_ft: m.height_ft,
    dimension_unit: m.dimension_unit,
    material_specs: m.material_specs,
    sort: m.sort_order,
    location_name: m.location_name,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    google_maps_url: m.google_maps_url,
    directions_url: m.directions_url,
    show_location: m.show_location,
  };

  const gallery = (m.gallery || []).map((g) => g.image_url);
  return { ...mandap, gallery };
}
