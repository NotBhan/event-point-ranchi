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
  image: string | null;
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

export async function loadEquipmentPage(options: { category?: string } = {}): Promise<EquipmentPageData> {
  const category = (options.category ?? '').trim();

  const rawCategories = await getFurnitureCategories();
  const rawItems = await getFurnitureItems();

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
      image: i.image_url || null,
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
