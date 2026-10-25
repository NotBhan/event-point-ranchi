import { all, one } from '../../core/db';
import { formatDate } from '../../core/http';

export interface PageSettings {
  hero_title: string;
  hero_subtitle: string;
  hero_badge: string;
  hero_image: string | null;
}

export interface HallSummary {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  banner_image: string | null;
  price_paise: number;
  capacity: number;
  location: string;
  parking_capacity: number;
  is_ac: number;
  is_wifi: number;
  is_featured: number;
  show_badge: number;
  booked_dates: string;
}

export function loadPageSettings(key: string, fallback: PageSettings): PageSettings {
  const row = one<PageSettings>(
    'SELECT hero_title, hero_subtitle, hero_badge, hero_image FROM page_settings WHERE key = ?',
    [key],
  );
  return row ?? fallback;
}

export function bookedDatesByHall(): Map<number, string> {
  const rows = all<{ hall_id: number; event_date: string }>(
    `SELECT bh.hall_id AS hall_id, b.event_date AS event_date
     FROM booking_halls bh
     JOIN bookings b ON b.id = bh.booking_id
     WHERE b.status IN ('pending', 'confirmed')
       AND b.event_date IS NOT NULL
       AND b.event_date >= date('now')
     ORDER BY b.event_date`,
  );

  const map = new Map<number, string[]>();
  for (const row of rows) {
    const list = map.get(row.hall_id) ?? [];
    list.push(formatDate(row.event_date));
    map.set(row.hall_id, list);
  }

  return new Map(Array.from(map.entries()).map(([hallId, dates]) => [hallId, dates.join(', ')]));
}

export function loadHallsPage() {
  const settings = loadPageSettings('halls', {
    hero_title: 'Our Premium Banquet Halls',
    hero_subtitle: 'Discover the perfect venue for weddings, receptions and corporate celebrations.',
    hero_badge: 'Luxury venues',
    hero_image: null,
  });

  const availability = bookedDatesByHall();
  const halls = all<Omit<HallSummary, 'booked_dates'>>(
    `SELECT id, name, slug, description, image, banner_image, price_paise, capacity, location,
            parking_capacity, is_ac, is_wifi, is_featured, show_badge
     FROM halls WHERE is_active = 1
     ORDER BY is_featured DESC, price_paise DESC`,
  );

  return {
    settings,
    halls: halls.map((hall) => ({ ...hall, booked_dates: availability.get(hall.id) ?? '' })),
  };
}

export interface HallDetail {
  hall: HallSummary;
  features: Array<{ icon: string; title: string; subtitle: string }>;
  gallery: Array<{ image: string; title: string }>;
  furniture: Array<{ category: string; items: FurnitureItem[] }>;
  stages: Array<{ category: string; description: string; designs: StageDesign[] }>;
  services: Array<{ category: string; subtitle: string; items: Array<{ id: number; name: string; price_paise: number }> }>;
  bookedDates: string;
  hasBookedDates: boolean;
  otherHalls: Array<{ name: string; slug: string; price_paise: number; capacity: number }>;
}

export interface FurnitureItem {
  id: number;
  name: string;
  icon: string;
  price_paise: number;
  unit: string;
  default_quantity: number;
  min_quantity: number;
  max_quantity: number;
}

export interface StageDesign {
  id: number;
  name: string;
  badge: string;
  image: string | null;
  price_paise: number;
}

export function loadHallDetail(slug: string): HallDetail | null {
  const hall = one<Omit<HallSummary, 'booked_dates'>>(
    `SELECT id, name, slug, description, image, banner_image, price_paise, capacity, location,
            parking_capacity, is_ac, is_wifi, is_featured, show_badge
     FROM halls WHERE slug = ? AND is_active = 1`,
    [slug],
  );

  if (!hall) return null;

  const availability = bookedDatesByHall();
  const bookedDates = availability.get(hall.id) ?? '';

  const features = all<{ icon: string; title: string; subtitle: string }>(
    'SELECT icon, title, subtitle FROM hall_features WHERE hall_id = ? ORDER BY sort, id',
    [hall.id],
  );

  const gallery = all<{ image: string; title: string }>(
    'SELECT image, title FROM hall_gallery WHERE hall_id = ? ORDER BY sort, id',
    [hall.id],
  );

  const furnitureCategories = all<{ id: number; name: string }>(
    'SELECT id, name FROM furniture_categories WHERE hall_id = ? ORDER BY sort, id',
    [hall.id],
  );
  const furnitureRows = all<FurnitureItem & { category_id: number }>(
    `SELECT fi.id, fi.category_id, fi.name, fi.icon, fi.price_paise, fi.unit,
            fi.default_quantity, fi.min_quantity, fi.max_quantity
     FROM furniture_items fi
     JOIN furniture_categories fc ON fc.id = fi.category_id
     WHERE fc.hall_id = ?
     ORDER BY fi.sort, fi.id`,
    [hall.id],
  );

  const stageCategories = all<{ id: number; name: string; description: string }>(
    'SELECT id, name, description FROM stage_categories WHERE hall_id = ? ORDER BY sort, id',
    [hall.id],
  );
  const stageRows = all<StageDesign & { category_id: number }>(
    `SELECT sd.id, sd.category_id, sd.name, sd.badge, sd.image, sd.price_paise
     FROM stage_designs sd
     JOIN stage_categories sc ON sc.id = sd.category_id
     WHERE sc.hall_id = ?
     ORDER BY sd.sort, sd.id`,
    [hall.id],
  );

  const serviceCategories = all<{ id: number; name: string; subtitle: string }>(
    'SELECT id, name, subtitle FROM service_categories WHERE hall_id = ? ORDER BY sort, id',
    [hall.id],
  );
  const serviceRows = all<{ id: number; category_id: number; name: string; price_paise: number }>(
    `SELECT s.id, s.category_id, s.name, s.price_paise
     FROM services s
     JOIN service_categories sc ON sc.id = s.category_id
     WHERE sc.hall_id = ?
     ORDER BY s.sort, s.id`,
    [hall.id],
  );

  const otherHalls = all<{ name: string; slug: string; price_paise: number; capacity: number }>(
    'SELECT name, slug, price_paise, capacity FROM halls WHERE is_active = 1 AND id != ? ORDER BY is_featured DESC LIMIT 4',
    [hall.id],
  );

  return {
    hall: { ...hall, booked_dates: bookedDates },
    features,
    gallery,
    furniture: furnitureCategories.map((category) => ({
      category: category.name,
      items: furnitureRows.filter((item) => item.category_id === category.id),
    })),
    stages: stageCategories.map((category) => ({
      category: category.name,
      description: category.description,
      designs: stageRows.filter((design) => design.category_id === category.id),
    })),
    services: serviceCategories.map((category) => ({
      category: category.name,
      subtitle: category.subtitle,
      items: serviceRows.filter((service) => service.category_id === category.id),
    })),
    bookedDates,
    hasBookedDates: bookedDates.length > 0,
    otherHalls,
  };
}
