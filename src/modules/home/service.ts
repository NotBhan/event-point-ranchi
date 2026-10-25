import { all, one } from '../../core/db';
import { site } from '../../core/config';

export interface HomeMandap {
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
}

export interface HomeStage {
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
}

export interface HomeEquipmentItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  unit: string;
  specifications: string;
  min_quantity: number;
  default_quantity: number;
  category: string;
  category_slug: string;
  category_icon: string;
}

export interface HomeEquipmentCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  items: HomeEquipmentItem[];
  itemCount: number;
}

export interface HomeGalleryItem {
  id: number;
  title: string;
  image: string;
  category: string;
  categorySlug: string;
}

export interface HomeData {
  heroImage: string | null;
  mandaps: HomeMandap[];
  stages: HomeStage[];
  equipment: HomeEquipmentCategory[];
  galleryCategories: Array<{ id: number; name: string; slug: string }>;
  galleryItems: HomeGalleryItem[];
  stats: { mandaps: number; stages: number; equipment: number; gallery: number };
  contact: { address: string; phone: string; email: string };
}

export function loadHomePage(): HomeData {
  const mandaps = all<HomeMandap>(
    `SELECT id, name, slug, description, image, category, length_ft, width_ft, height_ft,
            dimension_unit, material_specs
     FROM mandaps WHERE is_active = 1 ORDER BY sort, id LIMIT 3`,
  );

  const stages = all<HomeStage>(
    `SELECT id, name, slug, description, image, style_category, length_ft, width_ft, height_ft,
            dimension_unit, decoration_notes
     FROM stages WHERE is_active = 1 ORDER BY sort, id LIMIT 3`,
  );

  const categoryRows = all<{ id: number; name: string; slug: string; icon: string }>(
    'SELECT id, name, slug, icon FROM equipment_categories WHERE is_active = 1 ORDER BY sort, id',
  );

  const itemRows = all<HomeEquipmentItem & { category_id: number }>(
    `SELECT ei.id, ei.category_id, ei.name, ei.slug, ei.description, ei.image, ei.unit,
            ei.specifications, ei.min_quantity, ei.default_quantity,
            ec.name AS category, ec.slug AS category_slug, ec.icon AS category_icon
     FROM equipment_items ei
     JOIN equipment_categories ec ON ec.id = ei.category_id
     WHERE ei.is_active = 1 AND ec.is_active = 1
     ORDER BY ec.sort, ec.id, ei.sort, ei.id`,
  );

  const equipment = categoryRows.map((category) => {
    const items = itemRows.filter((item) => item.category_id === category.id);
    return {
      ...category,
      items: items.slice(0, 3),
      itemCount: items.length,
    };
  });

  const galleryCategories = all<{ id: number; name: string; slug: string }>(
    'SELECT id, name, slug FROM gallery_categories WHERE is_active = 1 ORDER BY sort, id',
  );

  const galleryItems = all<HomeGalleryItem>(
    `SELECT gi.id, gi.title, gi.image, gc.name AS category, gc.slug AS categorySlug
     FROM gallery_items gi
     JOIN gallery_categories gc ON gc.id = gi.category_id
     WHERE gi.is_active = 1 AND gc.is_active = 1
     ORDER BY gi.id LIMIT 8`,
  );

  const counts =
    one<{ mandaps: number; stages: number; equipment: number; gallery: number }>(
      `SELECT
         (SELECT COUNT(*) FROM mandaps WHERE is_active = 1) AS mandaps,
         (SELECT COUNT(*) FROM stages WHERE is_active = 1) AS stages,
         (SELECT COUNT(*) FROM equipment_items WHERE is_active = 1) AS equipment,
         (SELECT COUNT(*) FROM gallery_items WHERE is_active = 1) AS gallery`,
    ) ?? { mandaps: 0, stages: 0, equipment: 0, gallery: 0 };

  const contact = one<{ address: string; phone: string; email: string }>(
    'SELECT address, phone, email FROM contact_info WHERE id = 1',
  );

  return {
    heroImage: mandaps[0]?.image ?? '/images/archive/frames-for-your-heart-zSG-kd-L6vw-unsplash.jpg',
    mandaps,
    stages,
    equipment,
    galleryCategories,
    galleryItems,
    stats: {
      mandaps: Number(counts.mandaps),
      stages: Number(counts.stages),
      equipment: Number(counts.equipment),
      gallery: Number(counts.gallery),
    },
    contact: contact ?? { address: site.address, phone: site.phone, email: site.email },
  };
}
