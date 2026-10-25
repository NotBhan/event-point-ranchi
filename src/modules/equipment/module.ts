import { defineModule } from '../../core/define-module';
import EquipmentPage from './pages/EquipmentPage.astro';
import { loadEquipmentPage } from './service';

export default defineModule({
  id: 'equipment',
  label: 'Furniture & Equipment',
  order: 40,
  nav: [{ label: 'Furniture & Equipment', href: '/equipment', order: 40 }],
  routes: [
    {
      path: '/equipment',
      component: EquipmentPage,
      handle: ({ url }) => ({
        props: {
          data: loadEquipmentPage({ category: url.searchParams.get('category') ?? '' }),
        },
      }),
    },
  ],
});
