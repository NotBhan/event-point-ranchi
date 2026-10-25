import { all } from '../../core/db';
import { loadPageSettings } from '../halls/service';

export interface RoomCardData {
  id: number;
  name: string;
  price_paise: number;
  capacity: number;
  total_rooms: number;
  image: string | null;
  description: string;
  features: string[];
}

export function loadRoomsPage() {
  const settings = loadPageSettings('rooms', {
    hero_title: 'Rooms & Bridal Suites',
    hero_subtitle: 'Comfortable, premium stays for your family and guests.',
    hero_badge: 'Luxury stay',
    hero_image: null,
  });

  const rooms = all<Omit<RoomCardData, 'features'>>(
    `SELECT id, name, price_paise, capacity, total_rooms, image, description
     FROM rooms WHERE is_active = 1 ORDER BY price_paise DESC`,
  );

  const features = all<{ room_id: number; name: string }>(
    'SELECT room_id, name FROM room_features ORDER BY id',
  );

  return {
    settings,
    rooms: rooms.map((room) => ({
      ...room,
      features: features.filter((feature) => feature.room_id === room.id).map((feature) => feature.name),
    })),
  };
}
