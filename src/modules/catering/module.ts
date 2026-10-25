import { defineModule } from '../../core/define-module';
import CateringPage from './pages/CateringPage.astro';
import PackageDetailPage from './pages/PackageDetailPage.astro';
import { loadCateringPage, loadPackageDetail } from './service';

export default defineModule({
  id: 'catering',
  label: 'Catering',
  order: 50,
  nav: [{ label: 'Catering', href: '/catering', order: 50 }],
  routes: [
    {
      path: '/catering',
      component: CateringPage,
      handle: () => ({ props: { data: loadCateringPage() } }),
    },
    {
      path: '/catering/:slug',
      component: PackageDetailPage,
      handle: ({ params }) => {
        const data = loadPackageDetail(params.slug);
        if (!data) return { props: { notFound: true }, status: 404 };
        return { props: { data } };
      },
    },
  ],
});
