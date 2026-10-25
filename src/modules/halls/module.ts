import { defineModule } from '../../core/define-module';
import { redirect } from '../../core/http';
import HallDetailPage from './pages/HallDetailPage.astro';
import HallsPage from './pages/HallsPage.astro';

export default defineModule({
  id: 'halls',
  label: 'Halls',
  order: 80,
  routes: [
    {
      path: '/halls',
      component: HallsPage,
      handle: () => redirect('/mandaps'),
    },
    {
      path: '/halls/:slug',
      component: HallDetailPage,
      handle: () => redirect('/mandaps'),
    },
  ],
});
