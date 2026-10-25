import { defineModule } from '../../core/define-module';
import { redirect } from '../../core/http';
import RoomsPage from './pages/RoomsPage.astro';

export default defineModule({
  id: 'rooms',
  label: 'Rooms',
  order: 85,
  routes: [
    {
      path: '/rooms',
      component: RoomsPage,
      handle: () => redirect('/plan'),
    },
    {
      path: '/room',
      component: RoomsPage,
      handle: () => redirect('/plan'),
    },
  ],
});
