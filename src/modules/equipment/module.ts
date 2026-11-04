import { defineModule } from '../../core/define-module';
import EquipmentPage from './pages/EquipmentPage.astro';
import EquipmentDetailPage from './pages/EquipmentDetailPage.astro';
import { loadEquipmentDetail, loadEquipmentPage } from './service';

export default defineModule({
  id: 'equipment',
  label: 'Furniture & Equipment',
  order: 40,
  nav: [{ label: 'Equipment', href: '/equipment', order: 40 }],
  routes: [
    {
      path: '/equipment',
      component: EquipmentPage,
      handle: async ({ url }) => ({
        props: {
          data: await loadEquipmentPage({ category: url.searchParams.get('category') ?? '' }),
        },
      }),
    },
    {
      path: '/equipment/:slug',
      component: EquipmentDetailPage,
      handle: async ({ params }) => {
        const data = await loadEquipmentDetail(params.slug ?? '');
        return data ? { props: { data } } : { props: { notFound: true }, status: 404 };
      },
    },
  ],
});
