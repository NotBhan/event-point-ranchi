import { all, one } from '../../core/db';

export interface HomeFeature {
  icon: string;
  title: string;
  description: string;
}

export interface HomeHall {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  price_paise: number;
  capacity: number;
  location: string;
  parking_capacity: number;
  is_ac: number;
  is_wifi: number;
  show_badge: number;
}

export interface HomeRoom {
  id: number;
  name: string;
  price_paise: number;
  capacity: number;
  image: string | null;
  description: string;
  features: string[];
}

export interface HomePackage {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  price_paise: number;
  description: string;
  badge: string;
  features: string[];
}

export interface HomeData {
  hero: { title: string; description: string; image: string | null };
  features: HomeFeature[];
  halls: HomeHall[];
  rooms: HomeRoom[];
  packages: HomePackage[];
  contact: { address: string; phone: string; email: string };
  stats: { halls: number; rooms: number; packages: number; events: number };
}

export function loadHomePage(): HomeData {
  const hero = one<{ hero_title: string; hero_description: string; hero_image: string | null }>(
    'SELECT hero_title, hero_description, hero_image FROM homepage WHERE id = 1',
  );

  const features = all<HomeFeature>(
    'SELECT icon, title, description FROM homepage_features ORDER BY sort, id',
  );

  const halls = all<HomeHall>(
    'SELECT id, name, slug, description, image, price_paise, capacity, location, parking_capacity, is_ac, is_wifi, show_badge FROM halls WHERE is_active = 1 ORDER BY is_featured DESC, price_paise DESC LIMIT 3',
  );

  const rooms = all<Omit<HomeRoom, 'features'>>(
    'SELECT id, name, price_paise, capacity, image, description FROM rooms WHERE is_active = 1 ORDER BY price_paise DESC LIMIT 3',
  );
  const roomFeatureRows = all<{ room_id: number; name: string }>(
    'SELECT room_id, name FROM room_features ORDER BY id',
  );

  const packages = all<Omit<HomePackage, 'features'>>(
    'SELECT id, name, slug, image, price_paise, description, badge FROM catering_packages WHERE is_active = 1 AND show_on_home = 1 ORDER BY id LIMIT 3',
  );
  const packageFeatureRows = all<{ package_id: number; name: string }>(
    'SELECT package_id, name FROM catering_features ORDER BY id',
  );

  const contact = one<{ address: string; phone: string; email: string }>(
    'SELECT address, phone, email FROM contact_info WHERE id = 1',
  );

  const counts = one<{ halls: number; rooms: number; packages: number; events: number }>(
    `SELECT
       (SELECT COUNT(*) FROM halls WHERE is_active = 1) AS halls,
       (SELECT COUNT(*) FROM rooms WHERE is_active = 1) AS rooms,
       (SELECT COUNT(*) FROM catering_packages WHERE is_active = 1) AS packages,
       (SELECT COUNT(*) FROM bookings WHERE status IN ('pending', 'confirmed')) AS events`,
  );

  return {
    hero: {
      title: hero?.hero_title ?? 'Luxury celebrations, effortlessly planned',
      description: hero?.hero_description ?? '',
      image: hero?.hero_image ?? null,
    },
    features,
    halls,
    rooms: rooms.map((room) => ({
      ...room,
      features: roomFeatureRows.filter((row) => row.room_id === room.id).map((row) => row.name),
    })),
    packages: packages.map((pkg) => ({
      ...pkg,
      features: packageFeatureRows.filter((row) => row.package_id === pkg.id).map((row) => row.name),
    })),
    contact: contact ?? { address: 'Ranchi, Jharkhand', phone: '+91 98765 43210', email: 'info@royalpalace.com' },
    stats: {
      halls: Number(counts?.halls ?? 0),
      rooms: Number(counts?.rooms ?? 0),
      packages: Number(counts?.packages ?? 0),
      events: Number(counts?.events ?? 0),
    },
  };
}
