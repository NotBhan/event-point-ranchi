import { defineModule } from '../../core/define-module';
import CartPage from './pages/CartPage.astro';

export default defineModule({
  id: 'cart',
  label: 'Cart',
  order: 45,
  routes: [
    {
      path: '/cart',
      component: CartPage,
      handle: () => ({ props: {} }),
    },
  ],
});
