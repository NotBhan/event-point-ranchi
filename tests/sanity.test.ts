import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.sql?raw') || url.endsWith('.sql')) {
      const sql = readFileSync(fileURLToPath(url), 'utf8');
      return {
        format: 'module',
        source: `export default ${JSON.stringify(sql)};`,
        shortCircuit: true,
      };
    }

    return nextLoad(url, context);
  },
});

const { isSanityConfigured, getSanityConfig } = await import('../src/core/sanity/config');
const { resolveSanityImage } = await import('../src/core/sanity/image');
const { clearSanityCache } = await import('../src/core/sanity/client');
const {
  getSiteSettings,
  getHomepageContent,
  getCataloguePresentationsMap,
  getGalleryPresentationsMap,
  getServices,
} = await import('../src/core/sanity/service');
const { POST, ALL } = await import('../src/pages/api/sanity-webhook');
const { studioAdmin } = await import('../src/modules/admin/handlers/studio');
import type { PageContext } from '../src/core/types';

test('Sanity CMS configuration detector', () => {
  const original = process.env.PUBLIC_SANITY_PROJECT_ID;
  try {
    delete process.env.PUBLIC_SANITY_PROJECT_ID;
    assert.equal(isSanityConfigured(), false);
    const config = getSanityConfig();
    assert.equal(config.dataset, 'production');

    process.env.PUBLIC_SANITY_PROJECT_ID = 'test-proj-123';
    assert.equal(isSanityConfigured(), true);
    const configured = getSanityConfig();
    assert.equal(configured.projectId, 'test-proj-123');
    assert.equal(configured.dataset, 'production');
  } finally {
    if (original !== undefined) {
      process.env.PUBLIC_SANITY_PROJECT_ID = original;
    } else {
      delete process.env.PUBLIC_SANITY_PROJECT_ID;
    }
  }
});

test('resolveSanityImage resolves Filebase, strings, objects, and fallbacks', () => {
  // Fallbacks on falsy
  assert.equal(resolveSanityImage(null), '/images/placeholder.jpg');
  assert.equal(resolveSanityImage(undefined, '/fallback.png'), '/fallback.png');
  assert.equal(resolveSanityImage('   ', '/fallback.png'), '/fallback.png');

  // Direct string (Filebase path or web URL)
  assert.equal(
    resolveSanityImage('/storage/mandaps/royal.webp'),
    '/storage/mandaps/royal.webp',
  );
  assert.equal(
    resolveSanityImage('https://cdn.example.com/photo.jpg'),
    'https://cdn.example.com/photo.jpg',
  );

  // Custom Sanity reference with filebaseUrl
  assert.equal(
    resolveSanityImage({
      _type: 'image',
      filebaseUrl: '/storage/assets/branding/logo.png',
    }),
    '/storage/assets/branding/logo.png',
  );

  // Asset with direct URL
  assert.equal(
    resolveSanityImage({
      _type: 'image',
      asset: { url: 'https://cdn.sanity.io/images/123/prod/abc.jpg' },
    }),
    'https://cdn.sanity.io/images/123/prod/abc.jpg',
  );
});

test('getSiteSettings provides complete fallback when unconfigured', async () => {
  clearSanityCache();
  const settings = await getSiteSettings();

  assert.ok(settings.name.length > 0);
  assert.ok(settings.phone.length > 0);
  assert.ok(settings.theme.primaryColor.startsWith('#'));
  assert.ok(settings.seo.defaultTitle.length > 0);
  assert.ok(settings.seo.ogImage.length > 0);
  assert.ok(Array.isArray(settings.social));
  assert.ok(settings.social.length > 0);
});

test('getHomepageContent provides complete fallback structure and 5 process steps', async () => {
  clearSanityCache();
  const content = await getHomepageContent('/storage/assets/hero.webp');

  assert.ok(content.heroHeading.length > 0);
  assert.ok(content.heroSubtitle.length > 0);
  assert.equal(content.heroImage, '/storage/assets/hero.webp');
  assert.ok(content.primaryCta.label.length > 0);
  assert.ok(content.secondaryCta.label.length > 0);
  assert.equal(content.steps.length, 5);
  assert.equal(content.steps[0].stepNumber, '01');
  assert.equal(content.steps[4].stepNumber, '05');
  assert.ok(content.sectionsVisibility.mandaps);
  assert.ok(content.sectionsVisibility.stages);
  assert.ok(content.sectionsVisibility.equipment);
});

test('getCataloguePresentationsMap, getGalleryPresentationsMap and getServices fallback gracefully', async () => {
  clearSanityCache();
  const catalogueMap = await getCataloguePresentationsMap();
  assert.ok(catalogueMap instanceof Map);

  const galleryMap = await getGalleryPresentationsMap();
  assert.ok(galleryMap instanceof Map);

  const services = await getServices();
  assert.ok(Array.isArray(services));
});

test('Sanity webhook rejects invalid HTTP method and enforces secret', async () => {
  // Non-POST method
  const invalidMethodResponse = await ALL({} as any);
  assert.equal(invalidMethodResponse.status, 405);

  const originalSecret = process.env.SANITY_WEBHOOK_SECRET;
  try {
    process.env.SANITY_WEBHOOK_SECRET = 'secret-token-xyz';

    // Missing signature header
    const missingSecretRequest = new Request('http://localhost/api/sanity-webhook', {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ _type: 'siteSettings' }),
    });
    const unauthorizedResponse = await POST({ request: missingSecretRequest } as any);
    assert.equal(unauthorizedResponse.status, 401);

    // Matching secret header
    const validRequest = new Request('http://localhost/api/sanity-webhook', {
      method: 'POST',
      headers: {
        'sanity-webhook-secret': 'secret-token-xyz',
      },
      body: JSON.stringify({ _type: 'siteSettings' }),
    });
    const successResponse = await POST({ request: validRequest } as any);
    assert.equal(successResponse.status, 200);
    const body = await successResponse.json();
    assert.equal(body.revalidated, true);
  } finally {
    if (originalSecret !== undefined) {
      process.env.SANITY_WEBHOOK_SECRET = originalSecret;
    } else {
      delete process.env.SANITY_WEBHOOK_SECRET;
    }
  }
});

test('Admin studio handler enforces admin authorization', () => {
  // Anonymous context
  const anonCtx: PageContext = {
    request: new Request('http://localhost/admin/studio'),
    url: new URL('http://localhost/admin/studio'),
    params: {},
    form: null,
    auth: {
      user: null,
      isAuthenticated: false,
      isAdmin: false,
      isSuperadmin: false,
      isDeveloper: false,
    },
    csrf: 'token',
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
  };

  const anonResult = studioAdmin(anonCtx);
  assert.ok(anonResult && typeof anonResult === 'object');
  // requireAdmin returns redirect response
  assert.equal((anonResult as any).status, 303);
  assert.equal((anonResult as any).headers?.get('Location'), '/admin/login?next=%2Fadmin%2Fstudio');

  // Authenticated admin context
  const adminCtx: PageContext = {
    request: new Request('http://localhost/admin/studio'),
    url: new URL('http://localhost/admin/studio'),
    params: {},
    form: null,
    auth: {
      user: {
        id: 1,
        username: 'admin',
        email: 'admin@eventpoint.com',
        firstName: 'Admin',
        role: 'admin',
        isActive: true,
      },
      isAuthenticated: true,
      isAdmin: true,
      isSuperadmin: false,
      isDeveloper: false,
    },
    csrf: 'token',
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
  };

  const adminResult = studioAdmin(adminCtx);
  assert.ok(adminResult && 'props' in adminResult);
  assert.equal(typeof adminResult.props.configured, 'boolean');
});
