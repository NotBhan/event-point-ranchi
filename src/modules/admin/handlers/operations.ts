import { requireAdmin } from '../../../core/auth';
import { endSession, startSession } from '../../../core/auth';
import { setSuccess } from '../../../core/flash';
import { getInt, getString, redirect, safeNext } from '../../../core/http';
import type { PageContext } from '../../../core/types';
import { authenticate } from '../../accounts/service';
import { loadBookingForViewer } from '../../bookings/service';
import {
  deleteBooking,
  deleteInquiry,
  listBookings,
  listCustomers,
  listInquiries,
  loadCustomerAdmin,
  loadDashboard,
  updateBookingStatus,
  updateInquiryStatus,
} from '../service';
import { runFormAction } from './shared';

export async function adminLogin(ctx: PageContext) {
  const next = safeNext(ctx.url.searchParams.get('next'), '/admin');

  if (ctx.auth.isAdmin) return redirect(next);

  if (ctx.request.method === 'POST') {
    const user = authenticate(getString(ctx.form, 'username'), getString(ctx.form, 'password'));

    if (!user || user.role === 'customer') {
      return { props: { error: 'Invalid credentials or insufficient privileges.', next } };
    }

    startSession(ctx.cookies, user.id, user.password_hash);
    setSuccess(ctx.cookies, `Welcome back, ${user.first_name || user.username}.`);
    return redirect(safeNext(getString(ctx.form, 'next') || next, '/admin'));
  }

  return { props: { error: null, next } };
}

export async function adminLogout(ctx: PageContext) {
  endSession(ctx.cookies);
  setSuccess(ctx.cookies, 'You have been signed out of the admin console.');
  return redirect('/admin/login');
}

export function dashboard(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  return { props: loadDashboard() };
}

export function bookingsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') ?? 'all';
  const query = ctx.url.searchParams.get('q') ?? '';

  return {
    props: {
      bookings: listBookings({ status, query }),
      status,
      query,
    },
  };
}

export function bookingDetail(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const id = Number(ctx.params.id);
  const backTo = `/admin/bookings/${id}`;

  if (ctx.request.method === 'POST') {
    return runFormAction(
      ctx,
      {
        update_status: () => updateBookingStatus(id, getString(ctx.form, 'status')),
        delete: () => deleteBooking(id),
      },
      { redirectTo: backTo },
    );
  }

  const data = loadBookingForViewer(id, ctx.auth, null);
  if (data === 'not-found' || data === 'forbidden') return { props: { notFound: true }, status: 404 };
  return { props: { data } };
}

export function customersList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const query = ctx.url.searchParams.get('q') ?? '';
  return { props: { customers: listCustomers(query), query } };
}

export function customerDetail(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const data = loadCustomerAdmin(Number(ctx.params.id));
  if (!data) return { props: { notFound: true }, status: 404 };
  return { props: { data } };
}

export function inquiriesList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') ?? 'all';

  if (ctx.request.method === 'POST') {
    return runFormAction(
      ctx,
      {
        update_status: () => updateInquiryStatus(getInt(ctx.form, 'id'), getString(ctx.form, 'status')),
        delete: () => deleteInquiry(getInt(ctx.form, 'id')),
      },
      { redirectTo: `/admin/inquiries?status=${status}` },
    );
  }

  return { props: { inquiries: listInquiries(status), status } };
}
