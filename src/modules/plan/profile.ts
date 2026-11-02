import { ensureCustomerForUser, normalisePhone } from '../accounts/service';
import type { SessionUser } from '../../core/types';

/**
 * Basic contact details for the authenticated customer only.
 *
 * The plan form is personalised from the server-side session. There is no
 * client profile lookup, so a stale browser response can never repopulate the
 * form after a logout or account switch.
 */
export interface EnquiryProfile {
  name: string;
  email: string;
  phone: string;
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export async function loadEnquiryProfile(user: SessionUser | null): Promise<EnquiryProfile | null> {
  if (!user || user.role !== 'customer') return null;

  const customer = await ensureCustomerForUser(user.id, {
    name: user.firstName,
    email: user.email,
    phone: '',
  });

  const storedPhone = clean(customer.phone);
  const phone = normalisePhone(storedPhone) ?? '';

  return {
    name: clean(customer.name) || clean(user.firstName),
    email: clean(customer.email) || clean(user.email),
    phone,
  };
}
