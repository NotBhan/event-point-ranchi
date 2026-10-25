import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieJar } from './types';

const COOKIE = 'rp_csrf';

export function ensureCsrf(cookies: CookieJar): string {
  const existing = cookies.get(COOKIE)?.value;
  if (existing && existing.length >= 32) return existing;

  const token = randomBytes(24).toString('hex');
  cookies.set(COOKIE, token, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
  return token;
}

export async function submittedCsrfToken(request: Request): Promise<string> {
  const header = request.headers.get('x-csrf-token');
  if (header) return header;

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('form')) {
    try {
      const form = await request.clone().formData();
      const value = form.get('_csrf');
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }
  return '';
}

export function csrfMatches(submitted: string, expected: string): boolean {
  if (!submitted || !expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
