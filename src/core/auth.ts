import { createHmac, timingSafeEqual } from 'node:crypto';
import { redirect, safeNext } from './http';
import type { AuthState, CookieJar, PageContext, Role, SessionUser } from './types';

const SESSION_COOKIE = 'rp_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

let warnedAboutSecret = false;

function appSecret(): string {
  const secret = process.env.APP_SECRET || import.meta.env.APP_SECRET;
  if (secret) return secret;
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn('[auth] APP_SECRET is not set. Using an insecure development secret.');
  }
  return 'event-point-development-secret';
}

function secureCookies(): boolean {
  const configured = process.env.COOKIE_SECURE ?? import.meta.env.COOKIE_SECURE;
  return configured === 'true';
}

function sign(payload: string): string {
  return createHmac('sha256', appSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

interface SessionPayload {
  uid: number;
  pv: string;
  iat: number;
}

function encodeSession(userId: number, passwordHash: string): string {
  const payload: SessionPayload = {
    uid: userId,
    pv: passwordHash.slice(-12),
    iat: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeSession(value: string): SessionPayload | null {
  const [body, signature] = value.split('.');
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload || typeof payload.uid !== 'number' || typeof payload.pv !== 'string') return null;
    if (Date.now() - payload.iat > SESSION_TTL_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  first_name: string;
  role: Role;
  is_active: number;
  password_hash: string;
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email ?? '',
    firstName: row.first_name || row.username,
    role: row.role,
    isActive: Boolean(row.is_active),
  };
}

export const emptyAuth: AuthState = {
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isEditor: false,
  isSuperadmin: false,
  isDeveloper: false,
};

export function authStateFor(user: SessionUser | null): AuthState {
  const isSuperadmin = Boolean(user && (user.role === 'superadmin' || user.role === 'developer'));
  const isAdmin = Boolean(user && (user.role === 'admin' || isSuperadmin));
  const isEditor = Boolean(user && (user.role === 'editor' || isAdmin));

  return {
    user,
    isAuthenticated: Boolean(user),
    isAdmin,
    isEditor,
    isSuperadmin,
    isDeveloper: Boolean(user && user.role === 'developer'),
  };
}

import { findUserById } from './operational/service';

export async function getAuth(cookies: CookieJar): Promise<AuthState> {
  const cookie = cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return emptyAuth;

  const payload = decodeSession(cookie);
  if (!payload) return emptyAuth;

  const row = await findUserById(payload.uid);
  if (!row) return emptyAuth;
  if (row.password_hash.slice(-12) !== payload.pv) return emptyAuth;

  return authStateFor(toSessionUser(row as any));
}

export function startSession(cookies: CookieJar, userId: number, passwordHash: string): void {
  cookies.set(SESSION_COOKIE, encodeSession(userId, passwordHash), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function endSession(cookies: CookieJar): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function refreshSession(cookies: CookieJar, userId: number, passwordHash: string): void {
  startSession(cookies, userId, passwordHash);
}

export function requireCustomer(ctx: PageContext): Response | null {
  if (ctx.auth.user) return null;
  const next = safeNext(`${ctx.url.pathname}${ctx.url.search}`, '/');
  return redirect(`/login?next=${encodeURIComponent(next)}`);
}

export function requireAdmin(ctx: PageContext): Response | null {
  if (ctx.auth.isAdmin) return null;
  const next = safeNext(`${ctx.url.pathname}${ctx.url.search}`, '/admin');
  return redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}

export function requireEditor(ctx: PageContext): Response | null {
  if (ctx.auth.isEditor) return null;
  const next = safeNext(`${ctx.url.pathname}${ctx.url.search}`, '/admin/studio');
  return redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}

export function requireDeveloper(ctx: PageContext): Response | null {
  if (ctx.auth.isDeveloper) return null;
  return redirect('/admin');
}
