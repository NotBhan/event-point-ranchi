import { defineModule } from '../../core/define-module';
import HallDetailPage from './pages/HallDetailPage.astro';
import HallsPage from './pages/HallsPage.astro';
import { loadHallDetail, loadHallsPage } from './service';

export default defineModule({
  id: 'halls',
  label: 'Halls',
  order: 30,
  nav: [{ label: 'Halls', href: '/halls', order: 30 }],
  routes: [
    {
      path: '/halls',
      component: HallsPage,
      handle: () => ({ props: { data: loadHallsPage() } }),
    },
    {
      path: '/halls/:slug',
      component: HallDetailPage,
      handle: ({ params }) => {
        const data = loadHallDetail(params.slug);
        if (!data) return { props: { notFound: true }, status: 404 };
        return { props: { data } };
      },
    },
  ],
});
