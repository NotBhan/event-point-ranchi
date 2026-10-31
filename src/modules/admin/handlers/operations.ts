import { requireAdmin } from '../../../core/auth';
import { endSession, startSession } from '../../../core/auth';
import { setSuccess } from '../../../core/flash';
import { getInt, getString, parsePageParams, redirect, safeNext } from '../../../core/http';
import type { PageContext } from '../../../core/types';
import { authenticate } from '../../accounts/service';
import { loadBookingForViewer } from '../../bookings/service';
import {
  deleteBooking,
  deleteInquiry,
  listBookings,
  listCustomers,
  listEventEnquiries,
  listInquiries,
  loadCustomerAdmin,
  loadDashboard,
  loadEventEnquiry,
  loadStorageDashboard,
  reconcileStorageAdmin,
  retryCleanupAdmin,
  updateBookingStatus,
  updateEventEnquiryStatus,
  updateInquiryStatus,
  loadPaymentsAdmin,
  loadPaymentDetailAdmin,
  processRefundAdmin,
} from '../service';
import { updateBookingDepositConfig, type DepositType } from '../../../core/operational/service';
import { runFormAction } from './shared';

export async function adminLogin(ctx: PageContext) {
  const defaultRedirect = ctx.auth.user?.role === 'editor' ? '/admin/content' : '/admin';
  const next = safeNext(ctx.url.searchParams.get('next'), defaultRedirect);

  if (ctx.auth.isAdmin) return redirect(next);
  if (ctx.auth.user?.role === 'editor') return redirect('/admin/content');

  if (ctx.request.method === 'POST') {
    const user = await authenticate(getString(ctx.form, 'username'), getString(ctx.form, 'password'));

    if (!user || user.role === 'customer') {
      return { props: { error: 'Invalid credentials or insufficient privileges.', next } };
    }

    startSession(ctx.cookies, user.id, user.password_hash);
    setSuccess(ctx.cookies, `Welcome back, ${user.first_name || user.username}.`);
    const destination = user.role === 'editor' ? '/admin/content' : safeNext(getString(ctx.form, 'next') || next, '/admin');
    return redirect(destination);
  }

  return { props: { error: null, next } };
}

export async function adminLogout(ctx: PageContext) {
  endSession(ctx.cookies);
  setSuccess(ctx.cookies, 'You have been signed out of the admin console.');
  return redirect('/admin/login');
}

export function dashboard(ctx: PageContext) {
  if (ctx.auth.user?.role === 'editor') {
    return redirect('/admin/content');
  }
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  if (ctx.request.method === 'POST') {
    return runFormAction(
      ctx,
      {
        reconcile_storage: () => reconcileStorageAdmin(),
        retry_cleanup: () => retryCleanupAdmin(),
      },
      { redirectTo: '/admin', successMessage: 'Storage maintenance finished.' },
    );
  }

  return { props: { ...loadDashboard(), storage: loadStorageDashboard() } };
}

export function bookingsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') ?? 'all';
  const query = ctx.url.searchParams.get('q') ?? '';
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });

  return {
    props: {
      ...listBookings({ status, query }, { page, perPage }),
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
        update_deposit: async () => {
          const depositType = (getString(ctx.form, 'deposit_type') || 'percentage') as DepositType;
          const depositValue = Number(getString(ctx.form, 'deposit_value') || 0);
          await updateBookingDepositConfig({
            bookingId: id,
            depositType,
            depositValue,
            adminUserId: ctx.auth.user?.id,
          });
        },
        delete: () => deleteBooking(id),
      },
      { redirectTo: backTo, successMessage: 'Booking details updated successfully.' },
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
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });
  return { props: { ...listCustomers(query, { page, perPage }), query } };
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

  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });
  return { props: { ...listInquiries(status, { page, perPage }), status } };
}

export function eventEnquiriesList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') ?? 'all';
  const query = ctx.url.searchParams.get('q') ?? '';
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });

  return {
    props: {
      ...listEventEnquiries({ status, query }, { page, perPage }),
      status,
      query,
    },
  };
}

export function eventEnquiryDetail(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return { props: { notFound: true }, status: 404 };

  if (ctx.request.method === 'POST') {
    return runFormAction(
      ctx,
      {
        update_status: () => updateEventEnquiryStatus(id, getString(ctx.form, 'status')),
      },
      { redirectTo: `/admin/enquiries/${id}`, successMessage: 'Enquiry status updated.' },
    );
  }

  const data = loadEventEnquiry(id);
  if (!data) return { props: { notFound: true }, status: 404 };

  return { props: { data } };
}

export async function paymentsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') || undefined;
  const provider = ctx.url.searchParams.get('provider') || undefined;
  const search = ctx.url.searchParams.get('q') || undefined;
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 50, maxPerPage: 100 });

  const data = await loadPaymentsAdmin({
    status: status === 'all' ? undefined : status,
    provider: provider === 'all' ? undefined : provider,
    search,
    limit: perPage,
    offset: (page - 1) * perPage,
  });

  return {
    props: {
      metrics: data.metrics,
      payments: data.payments,
      total: data.total,
      page,
      perPage,
      status: status || 'all',
      provider: provider || 'all',
      search: search || '',
    },
  };
}

export async function paymentDetail(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return { props: { notFound: true }, status: 404 };

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, '_action');
    if (action === 'initiate_refund') {
      const refundAmount = Number(getString(ctx.form, 'refund_amount')) || 0;
      const reason = getString(ctx.form, 'refund_reason') || 'Customer requested cancellation';
      try {
        await processRefundAdmin(id, Math.round(refundAmount * 100), reason, ctx.auth.user?.id);
        setSuccess(ctx.cookies, `Refund of ₹${refundAmount.toLocaleString('en-IN')} successfully initiated.`);
      } catch (err: any) {
        return {
          props: {
            error: err.message || 'Refund processing failed.',
            ...(await loadPaymentDetailAdmin(id)),
          },
        };
      }
      return redirect(`/admin/payments/${id}`);
    }
  }

  const data = await loadPaymentDetailAdmin(id);
  if (!data) return { props: { notFound: true }, status: 404 };

  return { props: data };
}

export function scanEnquiry(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const initialToken = ctx.url.searchParams.get('token') || ctx.url.searchParams.get('ref') || '';
  return { props: { initialToken } };
}


