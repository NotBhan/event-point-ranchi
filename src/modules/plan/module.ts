import { defineModule } from '../../core/define-module';
import { badRequest, json } from '../../core/http';
import type { PageContext } from '../../core/types';
import { budgetRanges, eventTypes, preferredContactMethods } from '../../core/config';
import PlanPage from './pages/PlanPage.astro';
import PolicyPage from './pages/PolicyPage.astro';
import {
  EnquiryError,
  createEnquiry,
  loadPlanCatalogue,
  type EnquiryPayload,
} from './service';

async function createEnquiryApi(ctx: PageContext): Promise<Response> {
  let payload: EnquiryPayload;

  try {
    payload = (await ctx.request.json()) as EnquiryPayload;
  } catch {
    return badRequest('We could not read the enquiry details. Please refresh and try again.');
  }

  try {
    const result = createEnquiry(payload);
    let qrDataUrl = '';
    let scanUrl = '';
    try {
      const { getEnquiryQrService } = await import('../../core/operational/enquiry-qr-service');
      const qrService = getEnquiryQrService(ctx.url.origin);
      const qr = await qrService.getOrCreateEnquiryQr(result.id, result.reference, ctx.url.origin);
      qrDataUrl = qr.qrDataUrl;
      scanUrl = qr.scanUrl;
    } catch (e: any) {
      console.warn('[Plan Enquiry QR generation warning]:', e?.message);
    }

    return json({ status: 'success', reference: result.reference, qrDataUrl, scanUrl }, 201);
  } catch (error) {
    if (error instanceof EnquiryError) return badRequest(error.message);
    throw error;
  }
}

export default defineModule({
  id: 'plan',
  label: 'Plan Your Event',
  order: 25,
  routes: [
    {
      path: '/plan',
      component: PlanPage,
      handle: (ctx) => ({
        props: {
          catalogue: loadPlanCatalogue(),
          csrf: ctx.csrf,
          eventTypes,
          budgetRanges,
          preferredContactMethods,
          today: new Date().toISOString().slice(0, 10),
        },
      }),
    },
    {
      path: '/policies',
      component: PolicyPage,
      handle: () => ({ props: {} }),
    },
  ],
  api: [
    {
      path: '/api/enquiries',
      method: 'POST',
      handle: createEnquiryApi,
    },
  ],
});
