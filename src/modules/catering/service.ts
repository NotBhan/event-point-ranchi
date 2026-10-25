import { all, one } from '../../core/db';
import { loadPageSettings } from '../halls/service';

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

export function loadCateringPage() {
  const settings = loadPageSettings('catering', {
    hero_title: 'Catering Packages',
    hero_subtitle: 'Select the perfect menu for your event, prepared fresh by our kitchen.',
    hero_badge: 'Curated menus',
    hero_image: null,
  });

  const packages = all<Omit<PackageCard, 'features' | 'bannerFeatures'>>(
    `SELECT id, name, slug, image, price_paise, description, badge
     FROM catering_packages WHERE is_active = 1 ORDER BY price_paise DESC`,
  );

  const features = all<{ package_id: number; name: string }>(
    'SELECT package_id, name FROM catering_features ORDER BY id',
  );
  const bannerFeatures = all<{ package_id: number; name: string }>(
    'SELECT package_id, name FROM banner_features ORDER BY id',
  );

  return {
    settings,
    packages: packages.map((pkg) => ({
      ...pkg,
      features: features.filter((feature) => feature.package_id === pkg.id).map((feature) => feature.name),
      bannerFeatures: bannerFeatures
        .filter((feature) => feature.package_id === pkg.id)
        .map((feature) => feature.name),
    })),
  };
}

export interface PackageDetail {
  package: PackageCard;
  guestPricing: Array<{ guest_count: number; price_per_plate_paise: number }>;
  sections: MenuSectionData[];
}

export function loadPackageDetail(slug: string): PackageDetail | null {
  const pkg = one<Omit<PackageCard, 'features' | 'bannerFeatures'>>(
    `SELECT id, name, slug, image, price_paise, description, badge
     FROM catering_packages WHERE slug = ? AND is_active = 1`,
    [slug],
  );

  if (!pkg) return null;

  const features = all<{ name: string }>(
    'SELECT name FROM catering_features WHERE package_id = ? ORDER BY id',
    [pkg.id],
  );
  const bannerFeatures = all<{ name: string }>(
    'SELECT name FROM banner_features WHERE package_id = ? ORDER BY id',
    [pkg.id],
  );
  const guestPricing = all<{ guest_count: number; price_per_plate_paise: number }>(
    'SELECT guest_count, price_per_plate_paise FROM guest_pricing WHERE package_id = ? ORDER BY sort, guest_count',
    [pkg.id],
  );

  const sections = all<{ id: number; title: string; max_selection: number }>(
    'SELECT id, title, max_selection FROM menu_sections WHERE package_id = ? ORDER BY sort, id',
    [pkg.id],
  );
  const categories = all<{ id: number; section_id: number; title: string }>(
    `SELECT mc.id, mc.section_id, mc.title
     FROM menu_categories mc
     JOIN menu_sections ms ON ms.id = mc.section_id
     WHERE ms.package_id = ?
     ORDER BY mc.sort, mc.id`,
    [pkg.id],
  );
  const items = all<{ id: number; category_id: number; name: string }>(
    `SELECT mi.id, mi.category_id, mi.name
     FROM menu_items mi
     JOIN menu_categories mc ON mc.id = mi.category_id
     JOIN menu_sections ms ON ms.id = mc.section_id
     WHERE ms.package_id = ? AND mi.is_available = 1
     ORDER BY mi.id`,
    [pkg.id],
  );

  return {
    package: {
      ...pkg,
      features: features.map((feature) => feature.name),
      bannerFeatures: bannerFeatures.map((feature) => feature.name),
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
          items: items.filter((item) => item.category_id === category.id),
        })),
    })),
  };
}
