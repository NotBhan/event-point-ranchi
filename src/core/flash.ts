import type { CookieJar, FlashMessage } from './types';

const COOKIE = 'rp_flash';

export function setFlash(cookies: CookieJar, message: FlashMessage | string): void {
  const payload: FlashMessage =
    typeof message === 'string' ? { type: 'success', message } : message;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  cookies.set(COOKIE, encoded, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60,
  });
}

export function setSuccess(cookies: CookieJar, message: string): void {
  setFlash(cookies, { type: 'success', message });
}

export function setError(cookies: CookieJar, message: string): void {
  setFlash(cookies, { type: 'error', message });
}

export function takeFlash(cookies: CookieJar): FlashMessage | null {
  const cookie = cookies.get(COOKIE);
  if (!cookie?.value) return null;
  cookies.delete(COOKIE, { path: '/' });

  try {
    const parsed = JSON.parse(Buffer.from(cookie.value, 'base64url').toString('utf-8'));
    if (!parsed || typeof parsed.message !== 'string') return null;
    const type = ['success', 'error', 'info'].includes(parsed.type) ? parsed.type : 'info';
    return { type, message: parsed.message };
  } catch {
    return null;
  }
}
