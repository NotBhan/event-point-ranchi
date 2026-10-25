import { defineModule } from '../../core/define-module';
import AboutPage from './pages/AboutPage.astro';

export default defineModule({
  id: 'about',
  label: 'About',
  order: 20,
  nav: [{ label: 'About', href: '/about', order: 20 }],
  routes: [
    {
      path: '/about',
      component: AboutPage,
      handle: () => ({ props: {} }),
    },
  ],
});
