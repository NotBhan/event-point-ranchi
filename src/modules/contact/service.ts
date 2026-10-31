import { run } from '../../core/db';
import { getSiteSettings } from '../../core/content/service';
import { setError, setSuccess } from '../../core/flash';
import { getInt, getString, isEmail, redirect } from '../../core/http';
import type { PageContext } from '../../core/types';

export interface ContactInfo {
  address: string;
  phone: string;
  email: string;
}

/**
 * Contact details come from the shared site settings (snapshot-backed), so the
 * contact card always matches the header/footer after a publish.
 */
export async function loadContactInfo(): Promise<ContactInfo> {
  const settings = await getSiteSettings();
  return {
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
  };
}

export async function handleContactRequest(ctx: PageContext) {
  if (ctx.request.method === 'POST') {
    const name = getString(ctx.form, 'name');
    const phone = getString(ctx.form, 'phone');
    const email = getString(ctx.form, 'email');
    const eventType = getString(ctx.form, 'event_type');
    const eventDate = getString(ctx.form, 'event_date');
    const guestCount = getInt(ctx.form, 'guest_count', 0);
    const message = getString(ctx.form, 'message');

    if (!name || !phone || !email) {
      setError(ctx.cookies, 'Please share your name, phone number and email.');
      return redirect('/contact');
    }

    if (!isEmail(email)) {
      setError(ctx.cookies, 'Please enter a valid email address.');
      return redirect('/contact');
    }

    run(
      `INSERT INTO contact_inquiries (name, phone, email, event_type, event_date, guest_count, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`,
      [name, phone, email, eventType, eventDate || null, guestCount || null, message],
    );

    setSuccess(ctx.cookies, 'Thank you! Our event consultant will call you within one working day.');
    return redirect('/contact?sent=1');
  }

  return { props: { info: await loadContactInfo(), sent: ctx.url.searchParams.has('sent') } };
}
