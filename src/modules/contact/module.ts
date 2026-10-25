import { defineModule } from '../../core/define-module';
import ContactPage from './pages/ContactPage.astro';
import { handleContactRequest } from './service';

export default defineModule({
  id: 'contact',
  label: 'Contact',
  order: 70,
  nav: [{ label: 'Contact', href: '/contact', order: 70 }],
  routes: [
    {
      path: '/contact',
      component: ContactPage,
      handle: handleContactRequest,
    },
  ],
});
