import { defineModule } from '../../core/define-module';
import HomePage from './pages/HomePage.astro';
import { loadHomePage } from './service';

export default defineModule({
  id: 'home',
  label: 'Home',
  order: 10,
  nav: [{ label: 'Home', href: '/', order: 10 }],
  routes: [
    {
      path: '/',
      component: HomePage,
      handle: () => ({ props: { data: loadHomePage() } }),
    },
  ],
});
