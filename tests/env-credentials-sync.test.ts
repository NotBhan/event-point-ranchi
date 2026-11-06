import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';

useIsolatedContentDb();
useIsolatedOperationalDb('env-credentials-sync');
after(cleanupIsolatedDatabases);

const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const {
  syncPrivilegedAccounts,
  findUserByLogin,
  invalidateAuthUser,
} = await import('../src/core/operational/service');
const { verifyPassword } = await import('../src/core/password');
const { requireEditor } = await import('../src/core/auth');
const { getPassword, getString } = await import('../src/core/http');

before(async () => {
  await applyMigrations(getNeonClient());
});

beforeEach(async () => {
  const neon = getNeonClient();
  await neon.query('DELETE FROM customers');
  await neon.query('DELETE FROM users');
  invalidateAuthUser();
});

test('syncPrivilegedAccounts seeds all default accounts in empty database', async () => {
  const neon = getNeonClient();
  await syncPrivilegedAccounts({ client: neon, force: true });

  const admin = await findUserByLogin('admin');
  assert.ok(admin, 'admin account should exist');
  assert.equal(admin.role, 'developer');
  assert.ok(verifyPassword('admin', admin.password_hash));

  const editor = await findUserByLogin('content_editor');
  assert.ok(editor, 'content_editor account should exist');
  assert.equal(editor.role, 'editor');
  assert.ok(verifyPassword('Editor@Royal2026!', editor.password_hash));

  const superadmin = await findUserByLogin('superadmin');
  assert.ok(superadmin, 'superadmin account should exist');
  assert.equal(superadmin.role, 'superadmin');

  const manager = await findUserByLogin('event_manager');
  assert.ok(manager, 'event_manager account should exist');
  assert.equal(manager.role, 'admin');

  const customer = await findUserByLogin('rohit_sharma');
  assert.ok(customer, 'rohit_sharma customer account should exist');
  assert.equal(customer.role, 'customer');
  assert.ok(verifyPassword('Client@2026!', customer.password_hash));
});

test('syncPrivilegedAccounts updates admin password when ADMIN_PASSWORD is changed', async () => {
  const neon = getNeonClient();
  await syncPrivilegedAccounts({ client: neon, force: true });

  const originalAdmin = await findUserByLogin('admin');
  assert.ok(originalAdmin);
  assert.ok(verifyPassword('admin', originalAdmin.password_hash));

  // Change ADMIN_PASSWORD in environment
  const previous = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'NewSuperAdminPassword99!';
  try {
    await syncPrivilegedAccounts({ client: neon, force: true });

    const updatedAdmin = await findUserByLogin('admin');
    assert.ok(updatedAdmin);
    assert.ok(
      verifyPassword('NewSuperAdminPassword99!', updatedAdmin.password_hash),
      'Password hash in database should match new ADMIN_PASSWORD',
    );
    assert.ok(!verifyPassword('admin', updatedAdmin.password_hash), 'Old password should no longer verify');
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test('syncPrivilegedAccounts updates customer seed password when CUSTOMER_SEED_PASSWORD is set', async () => {
  const neon = getNeonClient();
  await syncPrivilegedAccounts({ client: neon, force: true });

  const previous = process.env.CUSTOMER_SEED_PASSWORD;
  process.env.CUSTOMER_SEED_PASSWORD = 'UpdatedClient2026!';
  try {
    await syncPrivilegedAccounts({ client: neon, force: true });

    const customer = await findUserByLogin('rohit_sharma');
    assert.ok(customer);
    assert.ok(verifyPassword('UpdatedClient2026!', customer.password_hash));
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_SEED_PASSWORD;
    else process.env.CUSTOMER_SEED_PASSWORD = previous;
  }
});

test('findUserByLogin resolves editor and manager aliases', async () => {
  const neon = getNeonClient();
  await syncPrivilegedAccounts({ client: neon, force: true });

  const editorByAlias = await findUserByLogin('editor');
  assert.ok(editorByAlias, 'should find content_editor by alias "editor"');
  assert.equal(editorByAlias.username, 'content_editor');

  const managerByAlias = await findUserByLogin('manager');
  assert.ok(managerByAlias, 'should find event_manager by alias "manager"');
  assert.equal(managerByAlias.username, 'event_manager');
});

test('requireEditor redirects unauthenticated editors to /admin/content, not /admin/studio', () => {
  const mockContext = {
    url: new URL('http://localhost/admin/content?tab=documents'),
    adminAuth: { isEditor: false },
  } as any;

  const res = requireEditor(mockContext);
  assert.ok(res instanceof Response);
  assert.equal(res.status, 303);
  const location = res.headers.get('location');
  assert.ok(location?.includes('/admin/login?next='));
  assert.ok(location?.includes('%2Fadmin%2Fcontent'), 'redirect next must point to /admin/content');
  assert.ok(!location?.includes('studio'), 'redirect must not mention deleted /admin/studio');
});

test('getPassword preserves whitespace unlike getString', () => {
  const form = new FormData();
  form.set('password', '  P@ssw0rd With Spaces  ');
  form.set('username', '  admin  ');

  assert.equal(getString(form, 'username'), 'admin');
  assert.equal(getPassword(form, 'password'), '  P@ssw0rd With Spaces  ');
});

test('syncPrivilegedAccounts succeeds in production mode when EDITOR_PASSWORD is unset', async () => {
  const neon = getNeonClient();
  const prevEnv = process.env.NODE_ENV;
  const prevTestMode = process.env.TEST_MODE;
  const prevAdminPass = process.env.ADMIN_PASSWORD;
  const prevEditorPass = process.env.EDITOR_PASSWORD;

  process.env.NODE_ENV = 'production';
  delete process.env.TEST_MODE;
  process.env.ADMIN_PASSWORD = 'ProdAdminSecret123!';
  delete process.env.EDITOR_PASSWORD;

  try {
    await syncPrivilegedAccounts({ client: neon, force: true });
    const editor = await findUserByLogin('content_editor');
    assert.ok(editor, 'content_editor should be created even without EDITOR_PASSWORD');
    assert.equal(editor.role, 'editor');
    assert.ok(editor.password_hash.length > 20);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevTestMode === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = prevTestMode;
    if (prevAdminPass === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPass;
    if (prevEditorPass === undefined) delete process.env.EDITOR_PASSWORD;
    else process.env.EDITOR_PASSWORD = prevEditorPass;
  }
});

test('getDb succeeds in production mode when EDITOR_PASSWORD is unset', async () => {
  const { getDb } = await import('../src/core/db');
  const prevEnv = process.env.NODE_ENV;
  const prevTestMode = process.env.TEST_MODE;
  const prevAdminPass = process.env.ADMIN_PASSWORD;
  const prevEditorPass = process.env.EDITOR_PASSWORD;

  process.env.NODE_ENV = 'production';
  delete process.env.TEST_MODE;
  process.env.ADMIN_PASSWORD = 'ProdAdminSecret123!';
  delete process.env.EDITOR_PASSWORD;

  try {
    assert.doesNotThrow(() => {
      getDb();
    });
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevTestMode === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = prevTestMode;
    if (prevAdminPass === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevAdminPass;
    if (prevEditorPass === undefined) delete process.env.EDITOR_PASSWORD;
    else process.env.EDITOR_PASSWORD = prevEditorPass;
  }
});
