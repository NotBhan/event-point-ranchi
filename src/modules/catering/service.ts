import { getCateringCatalog } from '../../core/content/service';

export interface PackageCard {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  price_paise: number;
  description: string;
  badge: string;
  features: string[];
  bannerFeatures: string[];
}

export interface MenuSectionData {
  id: number;
  title: string;
  maxSelection: number;
  categories: Array<{
    id: number;
    title: string;
    items: Array<{ id: number; name: string }>;
  }>;
}

export interface PackageDetail {
  package: PackageCard;
  guestPricing: Array<{ guest_count: number; price_per_plate_paise: number }>;
  sections: MenuSectionData[];
}

const DEFAULT_SETTINGS = {
  hero_title: 'Catering Packages',
  hero_subtitle: 'Select the perfect menu for your event, prepared fresh by our kitchen.',
  hero_badge: 'Curated menus',
  hero_image: null as string | null,
};

export async function loadCateringPage() {
  const catalog = await getCateringCatalog();

  const packages = catalog.packages
    .filter((pkg) => pkg.is_visible)
    .sort((a, b) => b.price_per_plate_paise - a.price_per_plate_paise)
    .map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      slug: pkg.slug,
      image: pkg.image_url || null,
      price_paise: pkg.price_per_plate_paise,
      description: pkg.description,
      badge: pkg.badge,
      features: catalog.features.filter((feature) => feature.package_id === pkg.id).map((feature) => feature.name),
      bannerFeatures: catalog.bannerFeatures
        .filter((feature) => feature.package_id === pkg.id)
        .map((feature) => feature.name),
    }));

  return { settings: DEFAULT_SETTINGS, packages };
}

export async function loadPackageDetail(slug: string): Promise<PackageDetail | null> {
  const catalog = await getCateringCatalog();
  const pkg = catalog.packages.find((entry) => entry.slug === slug && entry.is_visible);
  if (!pkg) return null;

  const guestPricing = catalog.guestPricing
    .filter((tier) => tier.package_id === pkg.id)
    .sort((a, b) => a.sort - b.sort || a.guest_count - b.guest_count)
    .map((tier) => ({
      guest_count: tier.guest_count,
      price_per_plate_paise: tier.price_per_plate_paise,
    }));

  const sections = catalog.sections
    .filter((section) => section.package_id === pkg.id)
    .sort((a, b) => a.sort - b.sort || a.id - b.id);

  const sectionIds = new Set(sections.map((section) => section.id));
  const categories = catalog.categories
    .filter((category) => sectionIds.has(category.section_id))
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
  const categoryIds = new Set(categories.map((category) => category.id));
  const items = catalog.items.filter((item) => item.is_available && categoryIds.has(item.category_id));

  return {
    package: {
      id: pkg.id,
      name: pkg.name,
      slug: pkg.slug,
      image: pkg.image_url || null,
      price_paise: pkg.price_per_plate_paise,
      description: pkg.description,
      badge: pkg.badge,
      features: catalog.features.filter((feature) => feature.package_id === pkg.id).map((feature) => feature.name),
      bannerFeatures: catalog.bannerFeatures
        .filter((feature) => feature.package_id === pkg.id)
        .map((feature) => feature.name),
    },
    guestPricing,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      maxSelection: section.max_selection,
      categories: categories
        .filter((category) => category.section_id === section.id)
        .map((category) => ({
          id: category.id,
          title: category.title,
          items: items
            .filter((item) => item.category_id === category.id)
            .map((item) => ({ id: item.id, name: item.name })),
        })),
    })),
  };
}
