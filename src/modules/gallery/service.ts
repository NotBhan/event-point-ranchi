import { all } from '../../core/db';
import { loadPageSettings } from '../halls/service';

export function loadGalleryPage() {
  const settings = loadPageSettings('gallery', {
    hero_title: 'Moments From Royal Palace',
    hero_subtitle: 'A look inside the celebrations we have hosted.',
    hero_badge: 'The collection',
    hero_image: null,
  });

  const categories = all<{ id: number; name: string }>(
    'SELECT id, name FROM gallery_categories WHERE is_active = 1 ORDER BY sort, name',
  );

  const items = all<{ id: number; title: string; image: string; category_id: number }>(
    `SELECT gi.id, gi.title, gi.image, gi.category_id
     FROM gallery_items gi
     JOIN gallery_categories gc ON gc.id = gi.category_id
     WHERE gi.is_active = 1 AND gc.is_active = 1
     ORDER BY gi.created_at DESC, gi.id DESC`,
  );

  return { settings, categories, items };
}
