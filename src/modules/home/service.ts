import {
  getCateringPackages,
  getFurnitureCategories,
  getFurnitureItems,
  getGalleryCatalog,
  getMandaps,
  getSiteSettings,
  getStages,
} from '../../core/content/service';

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

export interface HomeCatering {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  price_per_plate_paise: number;
  category: string;
}

export interface HomeData {
  heroImage: string | null;
  mandaps: HomeMandap[];
  stages: HomeStage[];
  equipment: HomeEquipmentCategory[];
  catering: HomeCatering[];
  galleryCategories: Array<{ id: number; name: string; slug: string }>;
  galleryItems: HomeGalleryItem[];
  stats: { mandaps: number; stages: number; equipment: number; gallery: number };
  contact: { address: string; phone: string; email: string };
}

const FALLBACK_HERO = '/storage/assets/banners/homepage/banner-hero.webp';

/**
 * Homepage data comes entirely from the published snapshot (D1-backed), so the
 * public homepage no longer reads the local SQLite catalog.
 */
export async function loadHomePage(): Promise<HomeData> {
  const [mandaps, stages, furnitureCategories, furnitureItems, gallery, settings, cateringPackages] = await Promise.all([
    getMandaps(),
    getStages(),
    getFurnitureCategories(),
    getFurnitureItems(),
    getGalleryCatalog(),
    getSiteSettings(),
    getCateringPackages(),
  ]);

  const selectedMandaps = mandaps.filter((mandap) => mandap.is_featured);
  const selectedStages = stages.filter((stage) => stage.is_featured);
  const featuredFurniture = furnitureItems.filter((item) => item.is_featured);
  const selectedFurniture = featuredFurniture.length > 0 ? featuredFurniture : furnitureItems;
  const selectedCatering = cateringPackages.filter((pkg) => pkg.show_on_home && !pkg.is_archived);

  const homeMandaps: HomeMandap[] = (selectedMandaps.length ? selectedMandaps : mandaps).slice(0, 3).map((mandap) => ({
    id: mandap.id,
    name: mandap.name,
    slug: mandap.slug,
    description: mandap.description,
    image: mandap.image_url || null,
    category: mandap.category,
    length_ft: mandap.length_ft,
    width_ft: mandap.width_ft,
    height_ft: mandap.height_ft,
    dimension_unit: mandap.dimension_unit,
    material_specs: mandap.material_specs,
  }));

  const homeStages: HomeStage[] = (selectedStages.length ? selectedStages : stages).slice(0, 3).map((stage) => ({
    id: stage.id,
    name: stage.name,
    slug: stage.slug,
    description: stage.description,
    image: stage.image_url || null,
    style_category: stage.style_category,
    length_ft: stage.length_ft,
    width_ft: stage.width_ft,
    height_ft: stage.height_ft,
    dimension_unit: stage.dimension_unit,
    decoration_notes: stage.decoration_notes,
  }));

  const equipment: HomeEquipmentCategory[] = furnitureCategories.map((category) => {
    const items = selectedFurniture.filter((item) => item.category_id === category.id);
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      icon: category.icon,
      items: items.slice(0, 3).map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        image: item.image_url || null,
        unit: item.pricing_unit || 'per item',
        specifications: item.specifications,
        min_quantity: item.min_quantity,
        default_quantity: item.default_quantity,
        category: category.name,
        category_slug: category.slug,
        category_icon: category.icon,
      })),
      itemCount: items.length,
    };
  });

  const galleryItems: HomeGalleryItem[] = gallery.items.slice(0, 8).map((item) => ({
    id: item.id,
    title: item.caption,
    image: item.image_url,
    category: item.category_name,
    categorySlug: item.category_slug,
  }));

  return {
    heroImage: homeMandaps[0]?.image ?? FALLBACK_HERO,
    mandaps: homeMandaps,
    stages: homeStages,
    equipment,
    catering: selectedCatering.slice(0, 3).map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      image: pkg.image_url || null,
      price_per_plate_paise: pkg.price_per_plate_paise,
      category: pkg.category || 'Signature',
    })),
    galleryCategories: gallery.categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
    })),
    galleryItems,
    stats: {
      mandaps: mandaps.length,
      stages: stages.length,
      equipment: furnitureItems.length,
      gallery: gallery.items.length,
    },
    contact: {
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
    },
  };
}
