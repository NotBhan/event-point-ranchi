import { all } from '../../core/db';
import { loadPageSettings } from '../halls/service';

export function loadGalleryPage() {
  const settings = loadPageSettings('gallery', {
    hero_title: 'Moments At Event Point Ranchi',
    hero_subtitle: 'Mandap details, stage settings and celebrations styled by our Ranchi team.',
    hero_badge: 'The collection',
    hero_image: null,
  });

  const categories = all<{ id: number; name: string; slug: string; count: number }>(
    `SELECT gc.id, gc.name, gc.slug, COUNT(gi.id) AS count
     FROM gallery_categories gc
     LEFT JOIN gallery_items gi ON gi.category_id = gc.id AND gi.is_active = 1
     WHERE gc.is_active = 1
     GROUP BY gc.id
     ORDER BY gc.sort, gc.name`,
  );

  const items = all<{ id: number; title: string; image: string; category_id: number; category_name: string; category_slug: string }>(
    `SELECT gi.id, gi.title, gi.image, gi.category_id, gc.name AS category_name, gc.slug AS category_slug
     FROM gallery_items gi
     JOIN gallery_categories gc ON gc.id = gi.category_id
     WHERE gi.is_active = 1 AND gc.is_active = 1
     ORDER BY gi.created_at DESC, gi.id DESC`,
  );

  return { settings, categories, items };
}
