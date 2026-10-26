import { defineModule } from '../../core/define-module';
import StageDetailPage from './pages/StageDetailPage.astro';
import StagesPage from './pages/StagesPage.astro';
import { loadStageDetail, loadStagesPage } from './service';

export default defineModule({
  id: 'stages',
  label: 'Stage Designs',
  order: 30,
  nav: [{ label: 'Stages', href: '/stages', order: 30 }],
  routes: [
    {
      path: '/stages',
      component: StagesPage,
      handle: ({ url }) => {
        const data = loadStagesPage({
          category: url.searchParams.get('style') ?? '',
          query: url.searchParams.get('q') ?? '',
        });
        return { props: { data } };
      },
    },
    {
      path: '/stages/:slug',
      component: StageDetailPage,
      handle: ({ params }) => {
        const data = loadStageDetail(params.slug);
        if (!data) return { props: { notFound: true }, status: 404 };
        return { props: { data } };
      },
    },
  ],
});
