import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import {
  cleanupIsolatedDatabases,
  useIsolatedContentDb,
  useIsolatedOperationalDb,
} from './helpers/isolated-db';

useIsolatedOperationalDb('plan-privacy');
useIsolatedContentDb();
after(cleanupIsolatedDatabases);

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
(globalThis as any).localStorage = local;
(globalThis as any).sessionStorage = session;
(globalThis as any).document = { getElementById: () => null };

// Import before defining window so enquiry-state does not install its DOM
// submit listener during this Node-only suite.
const requirements = await import('../src/client/requirements');
const cart = await import('../src/client/cart');
const enquiryState = await import('../src/client/enquiry-state');

(globalThis as any).window = { dispatchEvent: () => true };

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { registerCustomer } = await import('../src/modules/accounts/service');
const { loadEnquiryProfile } = await import('../src/modules/plan/profile');

const REQUIREMENTS_KEY = 'eventPointRequirements:session:v1';
const CART_KEY = 'royalEventCart:session:v1';
const LEGACY_REQUIREMENTS_KEY = 'eventPointRequirements:v1';
const LEGACY_CART_KEY = 'royalEventCart:v2';
const LEGACY_DRAFT_KEY = 'eventPointPlanDraft:v1';

const mandap = {
  id: '1',
  slug: 'test-mandap',
  name: 'Test Mandap',
  category: 'Mandap',
  image: '',
  standard: { length: 10, width: 10, height: 10, unit: 'ft' },
  requested: null,
  note: '',
};

const catering = {
  id: 'catering-1',
  name: 'Test Catering',
  guestCount: 100,
  pricePerPlate: 50000,
  selectedItems: [],
  total: 5000000,
};

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  const neon = getNeonClient();
  await neon.query('DELETE FROM customers');
  await neon.query('DELETE FROM users');

  local.clear();
  session.clear();
  requirements.clearRequirements();
  cart.clearCart();
});

test('package selections live in sessionStorage and are consumed once by the Plan page', () => {
  local.setItem(
    LEGACY_REQUIREMENTS_KEY,
    JSON.stringify({ mandap: { ...mandap, name: 'Leaked legacy mandap' }, stage: null, equipment: [] }),
  );

  assert.deepEqual(
    requirements.readRequirements(),
    requirements.emptyRequirements(),
    'legacy localStorage must never be restored',
  );

  requirements.addMandap(mandap);
  const handoff = JSON.parse(session.getItem(REQUIREMENTS_KEY) ?? 'null');
  assert.equal(handoff?.state?.mandap?.name, 'Test Mandap', 'selection should be written to sessionStorage');
  assert.ok(Number(handoff?.savedAt) > 0, 'handoff should be timestamped');
  assert.equal(local.getItem(REQUIREMENTS_KEY), null, 'session key must not be written to localStorage');
  assert.equal(local.getItem(LEGACY_REQUIREMENTS_KEY), null, 'legacy key should be purged on write');

  const consumed = requirements.consumeRequirementsForPlan();
  assert.equal(consumed.mandap?.name, 'Test Mandap', 'Plan page should receive the handoff');
  assert.equal(session.getItem(REQUIREMENTS_KEY), null, 'handoff must be removed after it is consumed');
  assert.equal(requirements.readRequirements().mandap?.name, 'Test Mandap', 'in-page memory should remain');

  requirements.clearRequirements();
  assert.deepEqual(
    requirements.readRequirements(),
    requirements.emptyRequirements(),
    'a cleared/reloaded Plan page must start with no package selections',
  );
});

test('a blocked sessionStorage does not abort requirement initialization', () => {
  const originalRemove = session.removeItem;
  session.removeItem = () => {
    throw new Error('storage blocked');
  };

  try {
    assert.doesNotThrow(() => requirements.consumeRequirementsForPlan());
    assert.doesNotThrow(() => requirements.clearRequirements());
  } finally {
    session.removeItem = originalRemove;
    requirements.clearRequirements();
  }
});

test('wizard initialization guards requirement handoff before attaching navigation listeners', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/client/plan-wizard.ts'), 'utf8');
  const initStart = source.indexOf('if (state && form)');
  const init = source.slice(initStart);
  const tryIndex = init.indexOf('try {');
  const consumeIndex = init.indexOf('consumeRequirementsForPlan()');
  const listenerIndex = init.indexOf("form.addEventListener('input'");

  assert.ok(initStart >= 0, 'wizard initialization block must exist');
  assert.ok(tryIndex >= 0, 'wizard initialization must be guarded');
  assert.ok(consumeIndex > tryIndex, 'requirement handoff must run inside the guarded initialization');
  assert.ok(listenerIndex > consumeIndex, 'listeners must attach even if handoff restoration fails');
});

test('legacy Plan draft storage is purged and the wizard never reads browser storage', () => {
  local.setItem(LEGACY_DRAFT_KEY, JSON.stringify({ customerName: 'Previous Visitor', customerPhone: '9999999999' }));

  enquiryState.clearLegacyEnquiryStorage();
  assert.equal(local.getItem(LEGACY_DRAFT_KEY), null, 'legacy Plan draft must be deleted');
  assert.equal(local.getItem(LEGACY_REQUIREMENTS_KEY), null, 'legacy requirements must be deleted');
  assert.equal(local.getItem(LEGACY_CART_KEY), null, 'legacy cart must be deleted');

  const wizardSource = fs.readFileSync(path.resolve(process.cwd(), 'src/client/plan-wizard.ts'), 'utf8');
  assert.equal(wizardSource.includes('localStorage.'), false, 'plan wizard must not read or write localStorage');
  assert.equal(wizardSource.includes('sessionStorage.'), false, 'plan wizard must not persist its personal fields');
  assert.equal(wizardSource.includes('eventPointPlanDraft'), false, 'plan wizard must not reference the legacy draft key');
});

test('catering selections are tab-scoped and do not use legacy localStorage', () => {
  local.setItem(LEGACY_CART_KEY, JSON.stringify({ catering: { ...catering, name: 'Leaked legacy catering' } }));

  assert.deepEqual(cart.readCart(), cart.emptyCart(), 'legacy cart must never be restored');

  cart.setCatering(catering);
  assert.equal(cart.readCart().catering?.name, 'Test Catering');
  assert.equal(local.getItem(CART_KEY), null, 'cart must not be written to localStorage');
  assert.equal(local.getItem(LEGACY_CART_KEY), null, 'legacy cart key should be purged on write');

  cart.clearCart();
  assert.deepEqual(cart.readCart(), cart.emptyCart(), 'cleared cart must be empty');
  assert.equal(session.getItem(CART_KEY), null, 'session cart key must be removed');
});

test('clearing at auth boundaries or after submission removes every enquiry value', () => {
  local.setItem(LEGACY_DRAFT_KEY, '{"customerName":"Previous Visitor"}');
  local.setItem(LEGACY_REQUIREMENTS_KEY, '{"mandap":{"name":"Previous Mandap"}}');
  local.setItem(LEGACY_CART_KEY, '{"catering":{"name":"Previous Catering"}}');
  requirements.addMandap(mandap);
  cart.setCatering(catering);

  enquiryState.clearEnquiryBrowserState();

  for (const key of [LEGACY_DRAFT_KEY, LEGACY_REQUIREMENTS_KEY, LEGACY_CART_KEY, REQUIREMENTS_KEY, CART_KEY]) {
    assert.equal(session.getItem(key) ?? local.getItem(key), null, `${key} should be cleared`);
  }
  assert.deepEqual(requirements.readRequirements(), requirements.emptyRequirements());
  assert.deepEqual(cart.readCart(), cart.emptyCart());
});

test('a failed enquiry submission keeps the current input instead of clearing it', () => {
  const wizardSource = fs.readFileSync(path.resolve(process.cwd(), 'src/client/plan-wizard.ts'), 'utf8');
  const submitStart = wizardSource.indexOf('async function submitEnquiry');
  const receiptStart = wizardSource.indexOf('function showReceipt');
  const submitBody = wizardSource.slice(submitStart, receiptStart);
  const catchStart = submitBody.indexOf('} catch');
  const finallyStart = submitBody.indexOf('} finally');
  const catchBlock = submitBody.slice(catchStart, finallyStart);

  assert.match(catchBlock, /showError\(/, 'a failed request should report the error to the visitor');
  assert.equal(catchBlock.includes('showReceipt'), false, 'a failed request must not show the receipt/reset path');
  assert.equal(
    catchBlock.includes('clearEnquiryBrowserState'),
    false,
    'a failed request must not clear the current enquiry input',
  );
});

test('Plan page renders only profile contact values and is not shareable-cacheable', () => {
  const pageSource = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/plan/pages/PlanPage.astro'), 'utf8');
  assert.match(pageSource, /value=\{profile\?\.name \?\? ''\}/);
  assert.match(pageSource, /value=\{profile\?\.phone \?\? ''\}/);
  assert.match(pageSource, /value=\{profile\?\.email \?\? ''\}/);
  assert.match(pageSource, /Cache-Control', 'private, no-store'/);
  assert.match(pageSource, /autocomplete="off"/);
  assert.doesNotMatch(pageSource, /eventPointPlanDraft/);

  const navSource = fs.readFileSync(path.resolve(process.cwd(), 'src/client/nav.ts'), 'utf8');
  assert.match(navSource, /targetPath === '\/plan'/);
  assert.match(navSource, /window\.location\.assign/);
});

function sessionUser(row: {
  id: number;
  username: string;
  email: string;
  first_name: string;
  role: 'customer' | 'admin' | 'editor' | 'superadmin' | 'developer';
  is_active: number;
}) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    firstName: row.first_name,
    role: row.role,
    isActive: Boolean(row.is_active),
  };
}

test('guests and staff never receive a customer profile prefill', async () => {
  assert.equal(await loadEnquiryProfile(null), null);
  assert.equal(
    await loadEnquiryProfile({
      id: 999,
      username: 'admin',
      email: 'admin@example.com',
      firstName: 'Admin',
      role: 'admin',
      isActive: true,
    }),
    null,
    'staff accounts must not be prefilled into a customer enquiry',
  );
});

test('authenticated customer profile returns name, email and mobile only', async () => {
  const registered = await registerCustomer({
    name: 'Asha Verma',
    username: 'asha_v',
    email: 'Asha.Verma@Example.test',
    phone: '9876501234',
    password: 'Riverstone7',
    confirmPassword: 'Riverstone7',
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const user = await getNeonClient().query<{
    id: number;
    username: string;
    email: string;
    first_name: string;
    role: 'customer';
    is_active: number;
  }>('SELECT id, username, email, first_name, role, is_active FROM users WHERE id = $1', [registered.userId]);

  const profile = await loadEnquiryProfile(sessionUser(user.rows[0]!));
  assert.deepEqual(profile, {
    name: 'Asha Verma',
    email: 'asha.verma@example.test',
    phone: '9876501234',
  });
  assert.deepEqual(Object.keys(profile!).sort(), ['email', 'name', 'phone']);
  assert.equal('eventType' in profile!, false);
  assert.equal('budgetRange' in profile!, false);
  assert.equal('mandap' in profile!, false);
});

test('switching customers returns only the current customer profile', async () => {
  const asha = await registerCustomer({
    name: 'Asha Verma',
    username: 'asha_v',
    email: 'asha.verma@example.test',
    phone: '9876501234',
    password: 'Riverstone7',
    confirmPassword: 'Riverstone7',
  });
  const bikash = await registerCustomer({
    name: 'Bikash Mahto',
    username: 'bikash_m',
    email: 'bikash.mahto@example.test',
    phone: '9123456780',
    password: 'Riverstone8',
    confirmPassword: 'Riverstone8',
  });
  assert.equal(asha.ok, true);
  assert.equal(bikash.ok, true);
  if (!asha.ok || !bikash.ok) return;

  const neon = getNeonClient();
  const users = await neon.query<{
    id: number;
    username: string;
    email: string;
    first_name: string;
    role: 'customer';
    is_active: number;
  }>('SELECT id, username, email, first_name, role, is_active FROM users ORDER BY id');
  const [ashaUser, bikashUser] = users.rows.map(sessionUser);

  const ashaProfile = await loadEnquiryProfile(ashaUser!);
  const bikashProfile = await loadEnquiryProfile(bikashUser!);
  assert.equal(ashaProfile?.name, 'Asha Verma');
  assert.equal(bikashProfile?.name, 'Bikash Mahto');
  assert.notEqual(ashaProfile?.phone, bikashProfile?.phone);
  assert.equal(bikashProfile?.phone, '9123456780');
  assert.equal(bikashProfile?.email, 'bikash.mahto@example.test');
  assert.equal(ashaProfile?.phone === bikashProfile?.phone, false);
});

test('placeholder operational phone numbers are never prefilled', async () => {
  const registered = await registerCustomer({
    name: 'Pending Phone',
    username: 'pending_phone',
    email: 'pending@example.test',
    phone: '9876509999',
    password: 'Riverstone9',
    confirmPassword: 'Riverstone9',
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const neon = getNeonClient();
  await neon.query('UPDATE customers SET phone = $1 WHERE user_id = $2', [`pending-${registered.userId}`, registered.userId]);
  const user = await neon.query<{
    id: number;
    username: string;
    email: string;
    first_name: string;
    role: 'customer';
    is_active: number;
  }>('SELECT id, username, email, first_name, role, is_active FROM users WHERE id = $1', [registered.userId]);

  const profile = await loadEnquiryProfile(sessionUser(user.rows[0]!));
  assert.equal(profile?.name, 'Pending Phone');
  assert.equal(profile?.phone, '', 'a pending placeholder must not be shown to the customer');
});
