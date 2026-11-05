import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  optionalSeedCredential,
  requiredSeedCredential,
} = await import('../src/core/seed-credentials');

test('development falls back to local seed credentials', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  delete process.env.ADMIN_PASSWORD;
  try {
    assert.equal(requiredSeedCredential('ADMIN_PASSWORD', 'admin'), 'admin');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

function enterProductionTestMode(): () => void {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestMode = process.env.TEST_MODE;
  const previousVitest = process.env.VITEST;
  process.env.NODE_ENV = 'production';
  delete process.env.TEST_MODE;
  delete process.env.VITEST;
  return () => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTestMode === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = previousTestMode;
    if (previousVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = previousVitest;
  };
}

test('production requires privileged seed credentials', () => {
  const leaveProduction = enterProductionTestMode();
  const previousPassword = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    assert.throws(
      () => requiredSeedCredential('ADMIN_PASSWORD', 'admin'),
      /ADMIN_PASSWORD must be set/,
    );
    process.env.ADMIN_PASSWORD = 'configured-secret';
    assert.equal(requiredSeedCredential('ADMIN_PASSWORD', 'admin'), 'configured-secret');
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    leaveProduction();
  }
});

test('production never reuses a known demo password', () => {
  const leaveProduction = enterProductionTestMode();
  const previousPassword = process.env.SUPERADMIN_PASSWORD;
  delete process.env.SUPERADMIN_PASSWORD;
  try {
    const generated = optionalSeedCredential('SUPERADMIN_PASSWORD', 'Super@Royal2026!');
    assert.notEqual(generated, 'Super@Royal2026!');
    assert.ok(generated.length >= 40);
  } finally {
    if (previousPassword === undefined) delete process.env.SUPERADMIN_PASSWORD;
    else process.env.SUPERADMIN_PASSWORD = previousPassword;
    leaveProduction();
  }
});
