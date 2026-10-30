import { defineModule } from '../../core/define-module';
import MandapDetailPage from './pages/MandapDetailPage.astro';
import MandapsPage from './pages/MandapsPage.astro';
import { loadMandapDetail, loadMandapsPage } from './service';

export default defineModule({
  id: 'mandaps',
  label: 'Mandaps',
  order: 20,
  nav: [{ label: 'Mandaps', href: '/mandaps', order: 20 }],
  routes: [
    {
      path: '/mandaps',
      component: MandapsPage,
      handle: async ({ url }) => {
        const data = await loadMandapsPage({
          category: url.searchParams.get('category') ?? '',
          query: url.searchParams.get('q') ?? '',
        });
        return { props: { data } };
      },
    },
    {
      path: '/mandaps/:slug',
      component: MandapDetailPage,
      handle: async ({ params }) => {
        const data = await loadMandapDetail(params.slug);
        if (!data) return { props: { notFound: true }, status: 404 };
        return { props: { data } };
      },
    },
  ],
});
