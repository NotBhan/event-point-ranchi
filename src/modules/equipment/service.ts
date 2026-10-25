import { all } from '../../core/db';

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

export function loadEquipmentPage(options: { category?: string } = {}): EquipmentPageData {
  const category = (options.category ?? '').trim();

  const categories = all<EquipmentCategoryRow>(
    'SELECT id, name, slug, icon, sort FROM equipment_categories WHERE is_active = 1 ORDER BY sort, id',
  );

  const clauses = ['ei.is_active = 1', 'ec.is_active = 1'];
  const params: unknown[] = [];

  if (category) {
    clauses.push('ec.slug = ?');
    params.push(category);
  }

  const items = all<EquipmentItemRow>(
    `SELECT ei.id, ei.category_id, ec.name AS category, ec.slug AS category_slug, ec.icon AS category_icon,
            ei.name, ei.slug, ei.description, ei.image, ei.unit, ei.specifications,
            ei.min_quantity, ei.default_quantity, ei.sort
     FROM equipment_items ei
     JOIN equipment_categories ec ON ec.id = ei.category_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY ec.sort, ec.id, ei.sort, ei.id`,
    params,
  );

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
