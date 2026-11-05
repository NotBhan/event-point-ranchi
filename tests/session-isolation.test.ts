import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';

useIsolatedContentDb();
useIsolatedOperationalDb('session-isolation');
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { createUser, ensureCustomerForUser, findOrCreateCustomer, invalidateAuthUser } = await import('../src/core/operational/service');
const {
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE,
  endSession,
  getAdminAuth,
  getAuth,
  requireCustomer,
  startAdminSession,
  startSession,
} = await import('../src/core/auth');
const { adminLogin, adminLogout } = await import('../src/modules/admin/handlers/operations');

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  const neon = getNeonClient();
  await neon.query('DELETE FROM customers');
  await neon.query('DELETE FROM users');
  invalidateAuthUser();
});

interface CookieRecord { value: string; options?: Record<string, unknown> }

class CookieJar {
  values = new Map<string, CookieRecord>();
  get(name: string) { return this.values.get(name); }
  set(name: string, value: string, options?: Record<string, unknown>) { this.values.set(name, { value, options }); }
  delete(name: string) { this.values.delete(name); }
}

function context(cookies: CookieJar, adminAuth: any = null, form: FormData | null = null) {
  return {
    request: new Request('http://localhost/admin/login', { method: form ? 'POST' : 'GET' }),
    url: new URL('http://localhost/admin/login'),
    params: {},
    form,
    auth: { user: null, isAuthenticated: false, isAdmin: false, isEditor: false, isSuperadmin: false, isDeveloper: false },
    adminAuth: adminAuth ?? { user: null, isAuthenticated: false, isAdmin: false, isEditor: false, isSuperadmin: false, isDeveloper: false },
    csrf: 'test',
    cookies,
  } as any;
}

async function seedUsers() {
  const customer = await createUser({ username: 'customer_one', email: 'customer@example.test', password: 'Riverstone7', role: 'customer' });
  const admin = await createUser({ username: 'root_admin', email: 'root@example.test', password: 'Riverstone7', role: 'developer' });
  return { customer, admin };
}

test('admin and customer sessions use separate signed cookies and audiences', async () => {
  const { customer, admin } = await seedUsers();
  const cookies = new CookieJar();
  startSession(cookies, customer.id, customer.password_hash);
  startAdminSession(cookies, admin.id, admin.password_hash);

  assert.ok(cookies.get(SESSION_COOKIE));
  assert.ok(cookies.get(ADMIN_SESSION_COOKIE));
  assert.notEqual(cookies.get(SESSION_COOKIE)?.value, cookies.get(ADMIN_SESSION_COOKIE)?.value);

  const customerAuth = await getAuth(cookies as any);
  const adminAuth = await getAdminAuth(cookies as any);
  assert.equal(customerAuth.user?.username, 'customer_one');
  assert.equal(adminAuth.user?.username, 'root_admin');
  assert.equal(adminAuth.isAdmin, true);
});

test('a cookie cannot be replayed across the customer/admin audience boundary', async () => {
  const { customer, admin } = await seedUsers();
  const customerCookies = new CookieJar();
  startSession(customerCookies, customer.id, customer.password_hash);
  const copiedToAdmin = new CookieJar();
  copiedToAdmin.set(ADMIN_SESSION_COOKIE, customerCookies.get(SESSION_COOKIE)!.value);
  assert.equal((await getAdminAuth(copiedToAdmin as any)).user, null);

  const adminCookies = new CookieJar();
  startAdminSession(adminCookies, admin.id, admin.password_hash);
  const copiedToCustomer = new CookieJar();
  copiedToCustomer.set(SESSION_COOKIE, adminCookies.get(ADMIN_SESSION_COOKIE)!.value);
  assert.equal((await getAuth(copiedToCustomer as any)).user, null);
});

test('admin login mints only the admin cookie; customer login surface rejects staff roles', async () => {
  const { admin } = await seedUsers();
  const cookies = new CookieJar();
  const loginForm = new FormData();
  loginForm.set('username', 'root_admin');
  loginForm.set('password', 'Riverstone7');
  loginForm.set('_csrf', 'test');

  const response = await adminLogin(context(cookies, null, loginForm));
  assert.ok(response instanceof Response);
  assert.equal(cookies.get(ADMIN_SESSION_COOKIE) !== undefined, true);
  assert.equal(cookies.get(SESSION_COOKIE), undefined);
  assert.equal((await getAdminAuth(cookies as any)).user?.id, admin.id);
  assert.equal((await getAuth(cookies as any)).user, null);
});

test('admin logout leaves a customer session intact and customer logout leaves admin intact', async () => {
  const { customer, admin } = await seedUsers();
  const cookies = new CookieJar();
  startSession(cookies, customer.id, customer.password_hash);
  startAdminSession(cookies, admin.id, admin.password_hash);

  await adminLogout(context(cookies));
  assert.equal(cookies.get(ADMIN_SESSION_COOKIE), undefined);
  assert.equal((await getAuth(cookies as any)).user?.username, 'customer_one');

  startAdminSession(cookies, admin.id, admin.password_hash);
  endSession(cookies);
  assert.equal(cookies.get(SESSION_COOKIE), undefined);
  assert.equal((await getAdminAuth(cookies as any)).user?.username, 'root_admin');
});

test('requireCustomer only accepts customer identities', async () => {
  const { admin } = await seedUsers();
  const cookies = new CookieJar();
  startAdminSession(cookies, admin.id, admin.password_hash);
  const ctx = context(cookies);
  ctx.adminAuth = await getAdminAuth(cookies as any);
  const response = requireCustomer(ctx);
  assert.ok(response instanceof Response);
  assert.equal(response.status, 303);
});

test('staff identities cannot create or own customer records', async () => {
  const { admin } = await seedUsers();
  await assert.rejects(() => ensureCustomerForUser(admin.id, { name: 'Root' }), /customer accounts/i);
  await assert.rejects(
    () => findOrCreateCustomer({ userId: admin.id, name: 'Root', phone: '9999999999', email: 'root@example.test', address: '' }),
    /staff account/i,
  );
  const rows = await getNeonClient().query('SELECT id FROM customers WHERE user_id = $1', [admin.id]);
  assert.equal(rows.rows.length, 0);
});

test('session cookies are HttpOnly, SameSite=Lax and path-scoped', async () => {
  const { customer, admin } = await seedUsers();
  const cookies = new CookieJar();
  startSession(cookies, customer.id, customer.password_hash);
  startAdminSession(cookies, admin.id, admin.password_hash);
  for (const name of [SESSION_COOKIE, ADMIN_SESSION_COOKIE]) {
    const record = cookies.get(name);
    assert.equal(record?.options?.httpOnly, true);
    assert.equal(record?.options?.sameSite, 'lax');
    assert.equal(record?.options?.path, '/');
    assert.ok(Number(record?.options?.maxAge) > 0);
  }
});
