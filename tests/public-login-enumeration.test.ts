import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';

useIsolatedContentDb();
useIsolatedOperationalDb('public-login-enumeration');
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { createUser, invalidateAuthUser } = await import('../src/core/operational/service');
const { adminLogin } = await import('../src/modules/admin/handlers/operations');
const { handlePublicLogin } = await import('../src/modules/accounts/login');
const {
  PUBLIC_LOGIN_ACCOUNT_NOT_FOUND,
  PUBLIC_LOGIN_INVALID_PASSWORD,
} = await import('../src/modules/accounts/service');
const { resetRateLimits } = await import('../src/core/rate-limit');

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  const neon = getNeonClient();
  await neon.query('DELETE FROM customers');
  await neon.query('DELETE FROM users');
  invalidateAuthUser();
  resetRateLimits();
});

interface CookieRecord { value: string; options?: Record<string, unknown> }

class CookieJar {
  values = new Map<string, CookieRecord>();
  get(name: string) { return this.values.get(name); }
  set(name: string, value: string, options?: Record<string, unknown>) { this.values.set(name, { value, options }); }
  delete(name: string) { this.values.delete(name); }
}

const emptyAuth = {
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isEditor: false,
  isSuperadmin: false,
  isDeveloper: false,
};

const loginRoute = { handle: handlePublicLogin };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function loginContext(username: string, password: string, cookies = new CookieJar()) {
  return {
    request: new Request('http://localhost/login', { method: 'POST' }),
    url: new URL('http://localhost/login'),
    params: {},
    form: form({ username, password }),
    auth: emptyAuth,
    adminAuth: emptyAuth,
    csrf: 'test-csrf',
    cookies,
  } as any;
}

async function attempt(username: string, password = 'WrongPassword1') {
  const cookies = new CookieJar();
  const result = await loginRoute!.handle(loginContext(username, password, cookies));
  return { result, cookies };
}

function failureProps(result: unknown) {
  assert.ok(!(result instanceof Response), 'failed public login must render the login form, not redirect');
  return result as { props?: Record<string, unknown>; status?: number };
}

for (const role of ['developer', 'admin', 'superadmin', 'editor'] as const) {
  test(`nonexistent and ${role} usernames produce identical public login responses`, async () => {
    const username = `enumeration_${role}_probe`;
    const beforeAccount = await attempt(username);
    const beforeFailure = failureProps(beforeAccount.result);

    await createUser({
      username,
      email: `${username}@example.test`,
      password: 'Riverstone7',
      role,
      firstName: 'Staff Probe',
    });

    const afterAccount = await attempt(username);
    const afterFailure = failureProps(afterAccount.result);

    assert.deepEqual(afterFailure, beforeFailure, 'staff and nonexistent responses must be indistinguishable');
    assert.equal(afterFailure.status, beforeFailure.status);
    assert.equal(afterFailure.props?.error, PUBLIC_LOGIN_ACCOUNT_NOT_FOUND);
    assert.equal(afterFailure.props?.username, username);
    assert.equal(afterAccount.cookies.get('rp_session'), undefined, 'staff login must not mint a customer session');
    assert.equal(afterAccount.cookies.get('rp_admin_session'), undefined, 'public login must not mint an admin session');

    const customerRows = await getNeonClient().query(
      'SELECT id FROM customers WHERE name = $1',
      ['Staff Probe'],
    );
    assert.equal(customerRows.rows.length, 0, 'staff login must not create a customer record');
  });
}

test('valid customer login still succeeds with only the customer session', async () => {
  const customer = await createUser({
    username: 'public_customer',
    email: 'public.customer@example.test',
    password: 'Riverstone7',
    role: 'customer',
    firstName: 'Public Customer',
  });

  const { result, cookies } = await attempt('public_customer', 'Riverstone7');
  assert.ok(result instanceof Response);
  assert.equal(result.status, 303);
  assert.equal(cookies.get('rp_session')?.value !== undefined, true);
  assert.equal(cookies.get('rp_admin_session'), undefined);
  assert.equal((cookies.get('rp_session')?.options as any)?.httpOnly, true);

  const customerRows = await getNeonClient().query('SELECT id FROM customers WHERE user_id = $1', [customer.id]);
  assert.equal(customerRows.rows.length, 0, 'public login must not create customer records');
});

test('invalid customer password keeps the generic credential failure and creates no session', async () => {
  await createUser({
    username: 'public_customer_bad',
    email: 'public.customer.bad@example.test',
    password: 'Riverstone7',
    role: 'customer',
    firstName: 'Public Customer',
  });

  const { result, cookies } = await attempt('public_customer_bad', 'WrongPassword1');
  const failure = failureProps(result);
  assert.equal(failure.props?.error, PUBLIC_LOGIN_INVALID_PASSWORD);
  assert.equal(failure.status, undefined);
  assert.equal(cookies.get('rp_session'), undefined);
});

test('admin login continues to work and mints only the admin session', async () => {
  await createUser({
    username: 'admin_probe',
    email: 'admin.probe@example.test',
    password: 'Riverstone7',
    role: 'admin',
    firstName: 'Admin Probe',
  });

  const cookies = new CookieJar();
  const result = await adminLogin({
    request: new Request('http://localhost/admin/login', { method: 'POST' }),
    url: new URL('http://localhost/admin/login'),
    params: {},
    form: form({ username: 'admin_probe', password: 'Riverstone7', _csrf: 'test-csrf' }),
    auth: emptyAuth,
    adminAuth: emptyAuth,
    csrf: 'test-csrf',
    cookies,
  } as any);

  assert.ok(result instanceof Response);
  assert.equal(result.status, 303);
  assert.ok(cookies.get('rp_admin_session'));
  assert.equal(cookies.get('rp_session'), undefined);
});
