import { defineModule } from '../../core/define-module';
import GalleryPage from './pages/GalleryPage.astro';
import { loadGalleryPage } from './service';

export default defineModule({
  id: 'gallery',
  label: 'Gallery',
  order: 50,
  nav: [{ label: 'Gallery', href: '/gallery', order: 50 }],
  routes: [
    {
      path: '/gallery',
      component: GalleryPage,
      handle: async ({ url }) => ({
        props: {
          data: await loadGalleryPage({
            category: url.searchParams.get('category') ?? '',
            page: Number(url.searchParams.get('page') ?? '1'),
            perPage: Number(url.searchParams.get('per') ?? ''),
          }),
        },
      }),
    },
  ],
});
