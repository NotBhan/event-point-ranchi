import { defineModule } from '../../core/define-module';
import RoomsPage from './pages/RoomsPage.astro';
import { loadRoomsPage } from './service';

export default defineModule({
  id: 'rooms',
  label: 'Rooms',
  order: 40,
  nav: [{ label: 'Rooms', href: '/rooms', order: 40 }],
  routes: [
    {
      path: '/rooms',
      component: RoomsPage,
      handle: () => ({ props: { data: loadRoomsPage() } }),
    },
    {
      path: '/room',
      component: RoomsPage,
      handle: () => ({ props: { data: loadRoomsPage() } }),
    },
  ],
});
