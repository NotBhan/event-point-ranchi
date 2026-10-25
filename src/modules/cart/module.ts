import { defineModule } from '../../core/define-module';
import { redirect } from '../../core/http';
import CartPage from './pages/CartPage.astro';

export default defineModule({
  id: 'cart',
  label: 'Cart',
  order: 95,
  routes: [
    {
      path: '/cart',
      component: CartPage,
      handle: () => redirect('/plan'),
    },
  ],
});
