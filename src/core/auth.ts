import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, redirect, safeNext } from './http';
import type { AuthState, CookieJar, PageContext, Role, SessionUser } from './types';

export const SESSION_COOKIE = 'rp_session';
export const ADMIN_SESSION_COOKIE = 'rp_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

type SessionAudience = 'customer' | 'admin';

let warnedAboutSecret = false;

function appSecret(): string {
  const secret = process.env.APP_SECRET || (import.meta as { env?: { APP_SECRET?: string } }).env?.APP_SECRET;
  if (secret) return secret;
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn('[auth] APP_SECRET is not set. Using an insecure development secret.');
  }
  return 'event-point-development-secret';
}

function secureCookies(): boolean {
  const configured = process.env.COOKIE_SECURE ?? (import.meta as { env?: { COOKIE_SECURE?: string } }).env?.COOKIE_SECURE;
  if (configured === 'false') return false;
  if (configured === 'true') return true;
  return process.env.NODE_ENV === 'production';
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
  aud?: SessionAudience;
}

function encodeSession(userId: number, passwordHash: string, audience: SessionAudience): string {
  const payload: SessionPayload = {
    uid: userId,
    pv: passwordHash.slice(-12),
    iat: Date.now(),
    aud: audience,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeSession(value: string, audience: SessionAudience): SessionPayload | null {
  const [body, signature] = value.split('.');
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload || typeof payload.uid !== 'number' || typeof payload.pv !== 'string') return null;
    // Old customer cookies predate the audience claim. They remain valid only
    // for the customer cookie; an admin session must carry aud=admin.
    if (payload.aud !== undefined && payload.aud !== audience) return null;
    if (audience === 'admin' && payload.aud !== 'admin') return null;
    const ttl = audience === 'admin' ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
    if (Date.now() - payload.iat > ttl * 1000) return null;
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

import { findUserByIdCached } from './operational/service';

export async function getAuth(cookies: CookieJar): Promise<AuthState> {
  const cookie = cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return emptyAuth;

  const payload = decodeSession(cookie, 'customer');
  if (!payload) return emptyAuth;

  const row = await findUserByIdCached(payload.uid);
  if (!row) return emptyAuth;
  if (row.role !== 'customer') return emptyAuth;
  if (row.password_hash.slice(-12) !== payload.pv) return emptyAuth;

  return authStateFor(toSessionUser(row as any));
}

export async function getAdminAuth(cookies: CookieJar): Promise<AuthState> {
  const cookie = cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!cookie) return emptyAuth;

  const payload = decodeSession(cookie, 'admin');
  if (!payload) return emptyAuth;

  const row = await findUserByIdCached(payload.uid);
  if (!row) return emptyAuth;
  if (row.role === 'customer') return emptyAuth;
  if (row.password_hash.slice(-12) !== payload.pv) return emptyAuth;

  return authStateFor(toSessionUser(row as any));
}

export function startSession(cookies: CookieJar, userId: number, passwordHash: string): void {
  cookies.set(SESSION_COOKIE, encodeSession(userId, passwordHash, 'customer'), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function startAdminSession(cookies: CookieJar, userId: number, passwordHash: string): void {
  cookies.set(ADMIN_SESSION_COOKIE, encodeSession(userId, passwordHash, 'admin'), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function endSession(cookies: CookieJar): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function endAdminSession(cookies: CookieJar): void {
  cookies.delete(ADMIN_SESSION_COOKIE, { path: '/' });
}

export function refreshSession(cookies: CookieJar, userId: number, passwordHash: string): void {
  startSession(cookies, userId, passwordHash);
}

export function refreshAdminSession(cookies: CookieJar, userId: number, passwordHash: string): void {
  startAdminSession(cookies, userId, passwordHash);
}

export function requireCustomer(ctx: PageContext): Response | null {
  if (!ctx.auth.user) {
    const next = safeNext(`${ctx.url.pathname}${ctx.url.search}`, '/');
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (ctx.auth.user.role !== 'customer') {
    return new Response('Customer account access only.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return null;
}

export function requireAdmin(ctx: PageContext): Response | null {
  if (ctx.adminAuth?.isAdmin) return null;
  const next = safeNext(`${ctx.url.pathname}${ctx.url.search}`, '/admin');
  return redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}

export function requireEditor(ctx: PageContext): Response | null {
  if (ctx.adminAuth?.isEditor) return null;
  const next = safeNext(`${ctx.url.pathname}${ctx.url.search}`, '/admin/content');
  return redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}

export function requireDeveloper(ctx: PageContext): Response | null {
  if (ctx.adminAuth?.isDeveloper) return null;
  return redirect('/admin');
}

export function requireAdminApi(ctx: PageContext): Response | null {
  if (ctx.adminAuth?.isAdmin) return null;
  return json({ status: 'error', message: 'Administrator access required.' }, 403);
}
