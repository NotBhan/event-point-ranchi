import { endAdminSession, requireAdmin, startAdminSession } from '../../../core/auth';
import { paymentsEnabled } from '../../../core/features';
import { setError, setSuccess } from '../../../core/flash';
import { getInt, getString, parseMoneyToPaise, parsePageParams, redirect, safeNext } from '../../../core/http';
import type { PageContext } from '../../../core/types';
import { authenticate } from '../../accounts/service';
import { loadBookingForViewer } from '../../bookings/service';
import {
  acceptEnquiry,
  prepareEnquiryQuotation,
  rejectEnquiry,
  setEnquiryWorkflowStatus,
} from '../enquiry-lifecycle';
import {
  deleteInquiry,
  listBookings,
  listCustomers,
  listNewEnquiries,
  listInquiries,
  loadCustomerAdmin,
  loadDashboard,
  loadNewEnquiry,
  loadStorageDashboard,
  reconcileStorageAdmin,
  retryCleanupAdmin,
  updateBookingStatus,
  updateInquiryStatus,
  loadPaymentsAdmin,
  loadPaymentDetailAdmin,
  processRefundAdmin,
} from '../service';
import { updateBookingDepositConfig, type DepositType } from '../../../core/operational/service';
import { runFormAction } from './shared';

export async function adminLogin(ctx: PageContext) {
  const defaultRedirect = ctx.adminAuth.user?.role === 'editor' ? '/admin/content' : '/admin';
  const next = safeNext(ctx.url.searchParams.get('next'), defaultRedirect);

  if (ctx.adminAuth.isAdmin) return redirect(next);
  if (ctx.adminAuth.user?.role === 'editor') return redirect('/admin/content');

  if (ctx.request.method === 'POST') {
    const user = await authenticate(getString(ctx.form, 'username'), getString(ctx.form, 'password'));

    if (!user || user.role === 'customer') {
      return { props: { error: 'Invalid credentials or insufficient privileges.', next } };
    }

    startAdminSession(ctx.cookies, user.id, user.password_hash);
    setSuccess(ctx.cookies, `Welcome back, ${user.first_name || user.username}.`);
    const destination = user.role === 'editor' ? '/admin/content' : safeNext(getString(ctx.form, 'next') || next, '/admin');
    return redirect(destination);
  }

  return { props: { error: null, next } };
}

export async function adminLogout(ctx: PageContext) {
  endAdminSession(ctx.cookies);
  setSuccess(ctx.cookies, 'You have been signed out of the admin console.');
  return redirect('/admin/login');
}

export async function dashboard(ctx: PageContext) {
  if (ctx.adminAuth.user?.role === 'editor') {
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

  return { props: { ...(await loadDashboard()), storage: loadStorageDashboard() } };
}

export async function bookingsList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const status = ctx.url.searchParams.get('status') ?? 'all';
  const query = ctx.url.searchParams.get('q') ?? '';
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });

  return {
    props: {
      ...(await listBookings({ status, query }, { page, perPage })),
      status,
      query,
    },
  };
}

export async function bookingDetail(ctx: PageContext) {
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
            adminUserId: ctx.adminAuth.user?.id,
          });
        },
      },
      { redirectTo: backTo, successMessage: 'Booking details updated successfully.' },
    );
  }

  const data = await loadBookingForViewer(id, ctx.adminAuth, null);
  if (data === 'not-found' || data === 'forbidden') return { props: { notFound: true }, status: 404 };
  return { props: { data } };
}

export async function customersList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const query = ctx.url.searchParams.get('q') ?? '';
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });
  return { props: { ...(await listCustomers(query, { page, perPage })), query } };
}

export async function customerDetail(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const data = await loadCustomerAdmin(Number(ctx.params.id));
  if (!data) return { props: { notFound: true }, status: 404 };
  return { props: { data } };
}

export async function inquiriesList(ctx: PageContext) {
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
  return { props: { ...(await listInquiries(status, { page, perPage })), status } };
}

export async function newEnquiriesList(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const requestedStatus = ctx.url.searchParams.get('status') ?? 'active';
  const allowedStatuses = new Set([
    'active',
    'new',
    'reviewing',
    'contacted',
    'accepted',
    'rejected',
    'all',
  ]);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'active';
  const query = ctx.url.searchParams.get('q') ?? '';
  const { page, perPage } = parsePageParams(ctx.url, { defaultPerPage: 25 });

  return {
    props: {
      ...(await listNewEnquiries({ status, query }, { page, perPage })),
      status,
      query,
    },
  };
}

export async function newEnquiryDetail(ctx: PageContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return { props: { notFound: true }, status: 404 };

  const backTo = `/admin/new-enquiries/${id}`;
  const adminUserId = ctx.adminAuth.user?.id;

  if (ctx.request.method === 'POST') {
    const action = getString(ctx.form, 'action');
    try {
      if (action === 'mark_reviewing' || action === 'mark_contacted') {
        if (!adminUserId) throw new Error('An admin user is required.');
        await setEnquiryWorkflowStatus({
          enquiryId: id,
          adminUserId,
          status: action === 'mark_reviewing' ? 'reviewing' : 'contacted',
        });
        setSuccess(
          ctx.cookies,
          action === 'mark_reviewing' ? 'Enquiry marked under review.' : 'Enquiry marked contacted.',
        );
        return redirect(backTo);
      }

      if (action === 'reject') {
        if (!adminUserId) throw new Error('An admin user is required.');
        await rejectEnquiry({
          enquiryId: id,
          adminUserId,
          reason: getString(ctx.form, 'reason'),
        });
        setSuccess(ctx.cookies, 'Enquiry rejected. It remains available in the rejected history.');
        return redirect(backTo);
      }

      if (action === 'save_quotation') {
        if (!adminUserId) throw new Error('An admin user is required.');
        const values = (name: string) => (ctx.form?.getAll(name) ?? []).map((value) => String(value));
        const lineIds = values('line_id');
        const lineQuantities = values('line_quantity');
        const linePrices = values('line_price');
        const lineNotes = values('line_notes');
        const lines = lineIds.map((lineId, index) => ({
          enquiryLineItemId: Number(lineId),
          quantity: Number(lineQuantities[index] ?? 0),
          quotedUnitPricePaise: parseMoneyToPaise(linePrices[index] ?? ''),
          notes: lineNotes[index] ?? '',
        }));

        const manualDescriptions = values('manual_description');
        const manualQuantities = values('manual_quantity');
        const manualPrices = values('manual_price');
        const manualNotes = values('manual_notes');
        const manualLines = manualDescriptions
          .map((description, index) => ({
            description,
            quantity: Number(manualQuantities[index] ?? 0),
            quotedUnitPricePaise: parseMoneyToPaise(manualPrices[index] ?? ''),
            notes: manualNotes[index] ?? '',
          }))
          .filter((line) => line.description.trim() || line.quotedUnitPricePaise > 0);

        const quotation = await prepareEnquiryQuotation({
          enquiryId: id,
          adminUserId,
          lines,
          manualLines,
          notes: getString(ctx.form, 'quote_notes'),
        });
        setSuccess(
          ctx.cookies,
          `Quotation version ${quotation.version} saved for ₹${(quotation.totalPaise / 100).toLocaleString('en-IN')}.`,
        );
        return redirect(backTo);
      }

      if (action === 'accept') {
        if (!adminUserId) throw new Error('An admin user is required.');
        if (getString(ctx.form, 'confirm_quotation') !== 'on') {
          throw new Error('Confirm the prepared quotation before accepting the enquiry.');
        }
        const quotationId = Number(getString(ctx.form, 'quotation_id'));
        const result = await acceptEnquiry({
          enquiryId: id,
          adminUserId,
          quotationId,
          confirm: true,
        });
        setSuccess(ctx.cookies, `Enquiry accepted. Booking #${result.bookingId} has been created.`);
        return redirect(`/admin/bookings/${result.bookingId}`);
      }

      throw new Error('Unknown action requested.');
    } catch (error) {
      setError(ctx.cookies, error instanceof Error ? error.message : 'The enquiry could not be updated.');
      return redirect(backTo);
    }
  }

  const data = await loadNewEnquiry(id);
  if (!data) return { props: { notFound: true }, status: 404 };

  return { props: { data } };
}

/**
 * The old event-enquiries list was a second, ambiguous enquiry inbox. Keep
 * bookmarks working by pointing it at the canonical New Enquiries page.
 */
export async function legacyEnquiriesRedirect(ctx: PageContext) {
  const params = new URLSearchParams(ctx.url.search);
  const legacyStatus = params.get('status');
  const mappedStatus =
    legacyStatus === 'confirmed' ? 'accepted' : legacyStatus === 'archived' ? 'rejected' : legacyStatus === 'quoted' ? 'active' : legacyStatus;
  if (mappedStatus) params.set('status', mappedStatus);
  const search = params.toString();
  return redirect(`/admin/new-enquiries${search ? `?${search}` : ''}`, 301);
}

/** Old detail links and form posts redirect to the canonical detail route. */
export async function legacyEnquiryDetailRedirect(ctx: PageContext) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return redirect('/admin/new-enquiries', 301);
  return redirect(`/admin/new-enquiries/${id}`, ctx.request.method === 'GET' ? 301 : 308);
}

export async function paymentsList(ctx: PageContext) {
  if (!paymentsEnabled()) return new Response('Not found', { status: 404 });
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
  if (!paymentsEnabled()) return new Response('Not found', { status: 404 });
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
        await processRefundAdmin(id, Math.round(refundAmount * 100), reason, ctx.adminAuth.user?.id);
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


