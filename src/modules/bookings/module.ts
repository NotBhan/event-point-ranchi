import { badRequest, json, redirect } from '../../core/http';
import { BookingError, createBooking, loadBookingForViewer } from './service';
import { defineModule } from '../../core/define-module';
import BookingOverviewPage from './pages/BookingOverviewPage.astro';
import QuotationPage from './pages/QuotationPage.astro';
import type { PageContext } from '../../core/types';
import type { CartPayload } from './types';

async function createBookingApi(ctx: PageContext): Promise<Response> {
  let payload: CartPayload;
  try {
    payload = (await ctx.request.json()) as CartPayload;
  } catch {
    return badRequest('We could not read the booking details. Please refresh and try again.');
  }

  try {
    const result = createBooking(ctx.auth, payload);
    return json({ status: 'success', ...result }, 201);
  } catch (error) {
    if (error instanceof BookingError) return badRequest(error.message);
    throw error;
  }
}

export default defineModule({
  id: 'bookings',
  label: 'Bookings',
  order: 55,
  routes: [
    {
      path: '/booking/overview',
      component: BookingOverviewPage,
      handle: () => redirect('/plan'),
    },
    {
      path: '/booking/:id/quotation',
      component: QuotationPage,
      handle: (ctx) => {
        const bookingId = Number(ctx.params.id);
        if (!Number.isInteger(bookingId) || bookingId <= 0) {
          return { props: { state: 'not-found' }, status: 404 };
        }

        const result = loadBookingForViewer(bookingId, ctx.auth, ctx.url.searchParams.get('token'));
        if (result === 'not-found') return { props: { state: 'not-found' }, status: 404 };
        if (result === 'forbidden') return { props: { state: 'forbidden' }, status: 403 };
        return { props: { data: result } };
      },
    },
  ],
  api: [
    {
      path: '/api/bookings',
      method: 'POST',
      handle: createBookingApi,
    },
  ],
});
