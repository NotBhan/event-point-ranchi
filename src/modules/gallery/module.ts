import { defineModule } from '../../core/define-module';
import GalleryPage from './pages/GalleryPage.astro';
import { loadGalleryPage } from './service';

export default defineModule({
  id: 'gallery',
  label: 'Gallery',
  order: 60,
  nav: [{ label: 'Gallery', href: '/gallery', order: 60 }],
  routes: [
    {
      path: '/gallery',
      component: GalleryPage,
      handle: () => ({ props: { data: loadGalleryPage() } }),
    },
  ],
});
