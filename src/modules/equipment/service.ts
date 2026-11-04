import { getFurnitureCategories, getFurnitureItems } from '../../core/content/service';

export interface EquipmentCategoryRow {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sort: number;
}

export interface EquipmentItemRow {
  id: number;
  category_id: number;
  category: string;
  category_slug: string;
  category_icon: string;
  name: string;
  slug: string;
  description: string;
  full_description?: string;
  image: string | null;
  image_alt?: string;
  price_paise?: number;
  gallery?: Array<{ id: number; image_url: string; alt_text: string; sort_order: number }>;
  unit: string;
  specifications: string;
  min_quantity: number;
  default_quantity: number;
  sort: number;
}

export interface EquipmentGroup {
  category: EquipmentCategoryRow;
  items: EquipmentItemRow[];
}

export interface EquipmentPageData {
  categories: EquipmentCategoryRow[];
  groups: EquipmentGroup[];
  category: string;
  totalItems: number;
}

export type EquipmentDetail = Omit<EquipmentItemRow, 'gallery' | 'price_paise'> & {
  full_description: string;
  image_alt: string;
  gallery: string[];
  price_paise: number;
};

export async function loadEquipmentDetail(slug: string): Promise<EquipmentDetail | null> {
  const [rawCategories, rawItems] = await Promise.all([getFurnitureCategories(), getFurnitureItems()]);
  const item = rawItems.find((entry) => entry.slug === slug);
  if (!item) return null;
  const category = rawCategories.find((entry) => entry.id === item.category_id);
  return {
    id: item.id,
    category_id: item.category_id,
    category: category?.name || 'Equipment',
    category_slug: category?.slug || '',
    category_icon: category?.icon || 'chair',
    name: item.name,
    slug: item.slug,
    description: item.description,
    full_description: item.full_description || '',
    image: item.image_url || null,
    image_alt: item.image_alt || '',
    price_paise: item.price_paise,
    unit: item.pricing_unit,
    specifications: item.specifications,
    min_quantity: item.min_quantity,
    default_quantity: item.default_quantity,
    sort: item.sort_order,
    gallery: (item.gallery ?? []).map((entry) => entry.image_url),
  };
}

export async function loadEquipmentPage(options: { category?: string } = {}): Promise<EquipmentPageData> {
  const category = (options.category ?? '').trim();

  const [rawCategories, rawItems] = await Promise.all([getFurnitureCategories(), getFurnitureItems()]);

  const categories: EquipmentCategoryRow[] = rawCategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    sort: c.sort_order,
  }));

  const catMap = new Map(categories.map((c) => [c.id, c]));

  const items: EquipmentItemRow[] = rawItems.map((i) => {
    const parent = catMap.get(i.category_id);
    return {
      id: i.id,
      category_id: i.category_id,
      category: parent?.name || 'Equipment',
      category_slug: parent?.slug || '',
      category_icon: parent?.icon || 'chair',
      name: i.name,
      slug: i.slug,
      description: i.description,
      full_description: i.full_description,
      image: i.image_url || null,
      image_alt: i.image_alt,
      price_paise: i.price_paise,
      gallery: i.gallery,
      unit: i.pricing_unit,
      specifications: i.specifications,
      min_quantity: i.min_quantity,
      default_quantity: i.default_quantity,
      sort: i.sort_order,
    };
  });

  const groups = categories
    .filter((entry) => !category || entry.slug === category)
    .map((entry) => ({
      category: entry,
      items: items.filter((item) => item.category_id === entry.id),
    }))
    .filter((group) => group.items.length > 0);

  return {
    categories,
    groups,
    category,
    totalItems: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}
