import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';

useIsolatedContentDb();
useIsolatedOperationalDb('customer-auth');
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { registerCustomer, authenticate, validatePassword, normalisePhone, updateOwnProfile } = await import(
  '../src/modules/accounts/service'
);
const { getCustomerBookingsForUser, updateUserName } = await import('../src/core/operational/service');
const { checkRateLimit, RATE_LIMITS, resetRateLimits } = await import('../src/core/rate-limit');

const base = {
  name: 'Asha Verma',
  username: 'asha_v',
  email: 'Asha.Verma@Example.test',
  phone: '9876501234',
  password: 'Riverstone7',
  confirmPassword: 'Riverstone7',
};

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  const neon = getNeonClient();
  await neon.query('DELETE FROM customers');
  await neon.query('DELETE FROM users');
  resetRateLimits();
});

test('registration creates the account and customer in the operational database', async () => {
  const result = await registerCustomer(base);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const neon = getNeonClient();
  const user = await neon.query<{ role: string; email: string }>('SELECT role, email FROM users WHERE id = $1', [result.userId]);
  assert.equal(user.rows[0]?.role, 'customer', 'customers must never be created with a staff role');
  assert.equal(user.rows[0]?.email, 'asha.verma@example.test', 'email is normalised to lower case');

  const customer = await neon.query<{ name: string; phone: string; user_id: number }>(
    'SELECT name, phone, user_id FROM customers WHERE user_id = $1',
    [result.userId],
  );
  assert.equal(customer.rows[0]?.name, 'Asha Verma');
  assert.equal(customer.rows[0]?.phone, '9876501234');
});

test('a duplicate email is rejected case-insensitively', async () => {
  const first = await registerCustomer(base);
  assert.equal(first.ok, true);

  const duplicate = await registerCustomer({ ...base, username: 'asha_second', email: 'ASHA.VERMA@example.test' });
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.match(duplicate.error, /email/i);
});

test('invalid registration data is rejected before any write', async () => {
  for (const [patch, pattern] of [
    [{ email: 'not-an-email' }, /email/i],
    [{ phone: '12345' }, /mobile/i],
    [{ password: 'short', confirmPassword: 'short' }, /8 characters/i],
    [{ confirmPassword: 'Different1' }, /do not match/i],
    [{ username: 'a' }, /username/i],
  ] as const) {
    const result = await registerCustomer({ ...base, ...patch });
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(patch)}`);
    if (result.ok) continue;
    assert.match(result.error, pattern);
  }

  const neon = getNeonClient();
  const users = await neon.query<{ count: number }>('SELECT COUNT(*) AS count FROM users');
  assert.equal(Number(users.rows[0]?.count ?? -1), 0, 'no partial account may be written');
});

test('login succeeds with the email and fails with the wrong password', async () => {
  await registerCustomer(base);

  const ok = await authenticate('asha.verma@example.test', 'Riverstone7');
  assert.equal(ok?.role, 'customer');

  const wrong = await authenticate('asha.verma@example.test', 'WrongPassword1');
  assert.equal(wrong, null);

  const unknown = await authenticate('nobody@example.test', 'Riverstone7');
  assert.equal(unknown, null, 'unknown accounts fail the same way as a wrong password');
});

test('a customer cannot read another customer\'s bookings', async () => {
  const a = await registerCustomer(base);
  const b = await registerCustomer({ ...base, name: 'Ravi Bose', username: 'ravi_b', email: 'ravi@example.test', phone: '9876509999' });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;

  const neon = getNeonClient();
  const customer = await neon.query<{ id: number }>('SELECT id FROM customers WHERE user_id = $1', [a.userId]);
  const booking = await neon.query<{ id: number }>(
    `INSERT INTO bookings (customer_id, access_token, event_type, event_date, total_amount, outstanding_balance)
     VALUES ($1, $2, 'Wedding', '2027-02-01', 1000000, 1000000) RETURNING id`,
    [customer.rows[0].id, 'token-a'],
  );
  assert.ok(booking.rows[0]?.id);

  assert.equal((await getCustomerBookingsForUser(a.userId)).length, 1);
  assert.equal((await getCustomerBookingsForUser(b.userId)).length, 0, 'customer B sees none of A\'s bookings');
});

test('profile updates are scoped to the signed-in user', async () => {
  const a = await registerCustomer(base);
  const b = await registerCustomer({ ...base, name: 'Ravi Bose', username: 'ravi_b', email: 'ravi@example.test', phone: '9876509999' });
  if (!a.ok || !b.ok) return assert.fail('fixtures must register');

  await updateOwnProfile(a.userId, { name: 'Asha Updated', email: 'asha.verma@example.test', phone: '9876501234', address: 'Ranchi' });

  const neon = getNeonClient();
  const rowA = await neon.query<{ name: string }>('SELECT name FROM customers WHERE user_id = $1', [a.userId]);
  const rowB = await neon.query<{ name: string }>('SELECT name FROM customers WHERE user_id = $1', [b.userId]);
  assert.equal(rowA.rows[0]?.name, 'Asha Updated');
  assert.equal(rowB.rows[0]?.name, 'Ravi Bose', 'the other customer is untouched');

  const rejected = await updateOwnProfile(b.userId, { name: 'X', email: 'bad', phone: '9876509999', address: '' });
  assert.equal(rejected.ok, false);
});

test('password policy and phone normalisation are enforced', () => {
  assert.match(validatePassword('short') ?? '', /8 characters/);
  assert.match(validatePassword('alllettersonly') ?? '', /number/);
  assert.equal(validatePassword('Riverstone7'), null);
  assert.equal(normalisePhone('+91 98765 01234'), '9876501234');
  assert.equal(normalisePhone('12345'), null);
});

test('the rate limiter blocks repeated attempts', () => {
  const rule = RATE_LIMITS.login;
  for (let i = 0; i < rule.limit; i += 1) {
    assert.equal(checkRateLimit('login:1.2.3.4', rule).allowed, true);
  }
  const blocked = checkRateLimit('login:1.2.3.4', rule);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.equal(checkRateLimit('login:5.6.7.8', rule).allowed, true, 'other clients are unaffected');
});

test('a staff account keeps its role and is not downgraded', async () => {
  const neon = getNeonClient();
  const inserted = await neon.query<{ id: number }>(
    `INSERT INTO users (username, email, password_hash, first_name, role, is_active)
     VALUES ('ops_staff', 'ops@example.test', 'scrypt$placeholder', 'Ops', 'admin', true)
     RETURNING id`,
  );
  const staffId = Number(inserted.rows[0]?.id);
  const row = await neon.query<{ role: string }>("SELECT role FROM users WHERE username = 'ops_staff'");
  assert.equal(row.rows[0]?.role, 'admin');
  await updateUserName(staffId, 'Ops', 'ops@example.test');
  const after = await neon.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [staffId]);
  assert.equal(after.rows[0]?.role, 'admin', 'profile edits never change a role');
});
