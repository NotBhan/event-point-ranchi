import { defineModule } from '../../core/define-module';
import CateringPage from './pages/CateringPage.astro';
import PackageDetailPage from './pages/PackageDetailPage.astro';
import { loadCateringPage, loadPackageDetail } from './service';

export default defineModule({
  id: 'catering',
  label: 'Catering',
  order: 45,
  nav: [{ label: 'Catering', href: '/catering', order: 45 }],
  routes: [
    {
      path: '/catering',
      component: CateringPage,
      handle: async () => ({ props: { data: await loadCateringPage() } }),
    },
    {
      path: '/catering/:slug',
      component: PackageDetailPage,
      handle: async ({ params }) => {
        const data = await loadPackageDetail(params.slug);
        if (!data) return { props: { notFound: true }, status: 404 };
        return { props: { data } };
      },
    },
  ],
});
