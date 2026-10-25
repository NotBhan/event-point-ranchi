import { one, run } from '../../core/db';
import { setError, setSuccess } from '../../core/flash';
import { getInt, getString, isEmail, redirect } from '../../core/http';
import type { PageContext } from '../../core/types';

export interface ContactInfo {
  address: string;
  phone: string;
  email: string;
}

export function loadContactInfo(): ContactInfo {
  return (
    one<ContactInfo>('SELECT address, phone, email FROM contact_info WHERE id = 1') ?? {
      address: 'Event Point, Main Road, Ranchi, Jharkhand 834001, India',
      phone: '+91 98765 43210',
      email: 'info@eventpointranchi.com',
    }
  );
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

  return { props: { info: loadContactInfo(), sent: ctx.url.searchParams.has('sent') } };
}
