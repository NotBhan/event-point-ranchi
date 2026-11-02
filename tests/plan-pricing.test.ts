import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  cleanupIsolatedDatabases,
  useIsolatedContentDb,
  useIsolatedOperationalDb,
} from './helpers/isolated-db';

useIsolatedContentDb();
useIsolatedOperationalDb('plan-pricing');
after(cleanupIsolatedDatabases);

const { getD1Client } = await import('../src/core/content/d1-client');
const content = await import('../src/core/content/service');
const { getNeonClient } = await import('../src/core/operational/neon-client');
const { applyMigrations } = await import('../src/core/operational/migrations');
const { getEventEnquiryWithItems } = await import('../src/core/operational/service');
const { createEnquiry, EnquiryError } = await import('../src/modules/plan/service');
const {
  calculateSelectionPricing,
  formatCataloguePrice,
} = await import('../src/modules/bookings/pricing-core');

const PLATE_PRICE = 85000;
const CATERING_TIER_PRICE = 80000;

let seeded = false;

async function seedCatalogue(): Promise<void> {
  if (seeded) return;
  const d1 = getD1Client();
  await d1.query(
    `INSERT INTO mandaps (name, slug, description, price_starting_paise, is_visible, sort_order)
     VALUES (?, ?, ?, 0, 1, 1)`,
    ['Zero Price Mandap', 'zero-price-mandap', 'Price on request fixture'],
  );
  await d1.query(
    `INSERT INTO stages (name, slug, description, price_starting_paise, is_visible, sort_order)
     VALUES (?, ?, ?, 0, 1, 1)`,
    ['Zero Price Stage', 'zero-price-stage', 'Price on request fixture'],
  );
  await d1.query(
    `INSERT INTO furniture_categories (name, slug, icon, sort_order, is_visible) VALUES (?, ?, 'chair', 1, 1)`,
    ['Seating', 'seating'],
  );
  const category = await d1.query<{ id: number }>('SELECT id FROM furniture_categories WHERE slug = ?', ['seating']);
  await d1.query(
    `INSERT INTO furniture_items
       (category_id, name, slug, description, price_paise, pricing_unit, min_quantity, default_quantity, is_visible, sort_order)
     VALUES (?, ?, ?, '', 0, 'piece', 10, 50, 1, 1)`,
    [Number(category.results[0].id), 'Zero Price Chair', 'zero-price-chair'],
  );
  await d1.query(
    `INSERT INTO catering_packages
       (name, slug, description, price_per_plate_paise, features_json, guest_pricing_json, is_visible, sort_order)
     VALUES (?, ?, '', ?, ?, ?, 1, 1)`,
    [
      'Royal Test Menu',
      'royal-test-menu',
      PLATE_PRICE,
      JSON.stringify(['Welcome drinks', 'Live counters']),
      JSON.stringify([{ guest_count: 120, price_per_plate_paise: CATERING_TIER_PRICE }]),
    ],
  );
  content.invalidateContentCache();
  seeded = true;
}

async function ids() {
  const mandap = (await content.getMandaps())[0];
  const stage = (await content.getStages())[0];
  const chair = (await content.getFurnitureItems())[0];
  const pkg = (await content.getCateringPackages())[0];
  return { mandap, stage, chair, pkg };
}

function syntheticCatalogue() {
  return {
    mandaps: [
      {
        id: 1,
        name: 'Zero Mandap',
        slug: 'zero-mandap',
        category: 'Mandap',
        length_ft: 16,
        width_ft: 16,
        height_ft: 12,
        dimension_unit: 'ft',
        price_starting_paise: 0,
      },
    ],
    stages: [
      {
        id: 1,
        name: 'Zero Stage',
        slug: 'zero-stage',
        style_category: 'Stage',
        length_ft: 20,
        width_ft: 12,
        height_ft: 10,
        dimension_unit: 'ft',
        price_starting_paise: 0,
      },
    ],
    furniture: [
      {
        id: 1,
        category_id: 1,
        name: 'Chair',
        slug: 'chair',
        description: '',
        image_url: '',
        price_paise: 0,
        pricing_unit: 'piece',
        dimensions: '',
        specifications: '',
        min_quantity: 10,
        default_quantity: 10,
        is_visible: true,
        sort_order: 1,
      },
    ],
    catering: [
      {
        id: 1,
        name: 'Menu',
        slug: 'menu',
        description: '',
        badge: '',
        image_url: '',
        price_per_plate_paise: PLATE_PRICE,
        features: [],
        menu_sections: [],
        guest_pricing: [{ guest_count: 120, price_per_plate_paise: CATERING_TIER_PRICE }],
        show_on_home: false,
        is_visible: true,
        sort_order: 1,
      },
    ],
  };
}

before(async () => {
  await applyMigrations(getNeonClient());
  await seedCatalogue();
});

test('zero-priced catalogue items are on request, never free, and catering is tier-priced', async () => {
  const catalogue = syntheticCatalogue();
  const pricing = calculateSelectionPricing(catalogue, {
    mandap: { id: 1 },
    furniture: [{ id: 1, quantity: 10 }],
    catering: { id: 1, guestCount: 120 },
  });

  assert.equal(pricing.pricingStatus, 'partially_priced');
  assert.equal(pricing.unpricedItemCount, 2);
  assert.equal(pricing.pricedSubtotalPaise, CATERING_TIER_PRICE * 120);
  const mandap = pricing.items.find((line) => line.category === 'mandap');
  const furniture = pricing.items.find((line) => line.category === 'furniture');
  const catering = pricing.items.find((line) => line.category === 'catering');
  assert.equal(mandap?.pricingStatus, 'on_request');
  assert.equal(mandap?.unitPricePaise, null);
  assert.equal(mandap?.subtotalPaise, null);
  assert.equal(furniture?.pricingStatus, 'on_request');
  assert.equal(catering?.pricingStatus, 'priced');
  assert.equal(catering?.unitPricePaise, CATERING_TIER_PRICE);
  assert.equal(catering?.subtotalPaise, CATERING_TIER_PRICE * 120);
  assert.equal(formatCataloguePrice(0), 'Price on request');
});

test('the shared pricing core distinguishes fully priced and quotation-required selections', async () => {
  const catalogue = syntheticCatalogue();
  catalogue.mandaps[0].price_starting_paise = 100000;
  catalogue.stages[0].price_starting_paise = 200000;
  catalogue.furniture[0].price_paise = 5000;

  const fullyPriced = calculateSelectionPricing(catalogue, {
    mandap: { id: 1 },
    stage: { id: 1 },
    furniture: [{ id: 1, quantity: 10 }],
  });
  assert.equal(fullyPriced.pricingStatus, 'fully_priced');
  assert.equal(fullyPriced.pricedSubtotalPaise, 100000 + 200000 + 5000 * 10);

  const allOnRequest = calculateSelectionPricing(syntheticCatalogue(), {
    mandap: { id: 1 },
    furniture: [{ id: 1, quantity: 10 }],
  });
  assert.equal(allOnRequest.pricingStatus, 'quotation_required');
  assert.equal(allOnRequest.pricedSubtotalPaise, 0);

  const noSelection = calculateSelectionPricing(syntheticCatalogue(), {});
  assert.equal(noSelection.pricingStatus, 'quotation_required');
  assert.equal(noSelection.items.length, 0);
});

test('minimum furniture quantities are enforced by the shared pricing authority', () => {
  assert.throws(
    () =>
      calculateSelectionPricing(syntheticCatalogue(), {
        furniture: [{ id: 1, quantity: 5 }],
      }),
    /minimum quantity of 10/i,
  );
});

test('public enquiry persists D1 selections, server prices, optional budget, and no booking', async () => {
  const selected = await ids();
  const futureDate = new Date(Date.now() + 86400000 * 40).toISOString().slice(0, 10);
  const result = await createEnquiry({
    event: {
      type: 'Wedding',
      date: futureDate,
      time: '18:00',
      venue: 'Harmu Ground, Ranchi',
      guestCount: 120,
      description: 'Pricing persistence fixture',
    },
    mandap: { id: selected.mandap.id },
    stage: { id: selected.stage.id },
    furniture: [{ id: selected.chair.id, quantity: 10, notes: 'Gold cushions' }],
    catering: { id: selected.pkg.id, guestCount: 120, notes: 'Two live counters' },
    additionalServices: 'Valet parking and welcome girls',
    contact: {
      name: 'Pricing Test',
      phone: '9876504321',
      email: 'pricing@example.test',
      budgetRange: '',
      preferredContact: 'Phone',
    },
  });

  assert.equal(result.pricing.pricingStatus, 'partially_priced');
  assert.equal(result.pricing.pricedSubtotalPaise, CATERING_TIER_PRICE * 120);

  const neon = getNeonClient();
  const enquiry = await neon.query<{
    pricing_status: string;
    priced_subtotal_paise: number;
    budget_range: string;
    additional_services: string;
  }>(
    'SELECT pricing_status, priced_subtotal_paise, budget_range, additional_services FROM event_enquiries WHERE id = $1',
    [result.id],
  );
  assert.equal(enquiry.rows[0]?.pricing_status, 'partially_priced');
  assert.equal(Number(enquiry.rows[0]?.priced_subtotal_paise), CATERING_TIER_PRICE * 120);
  assert.equal(enquiry.rows[0]?.budget_range, '');
  assert.equal(enquiry.rows[0]?.additional_services, 'Valet parking and welcome girls');

  const data = await getEventEnquiryWithItems(result.id);
  assert.ok(data);
  assert.equal(data?.lines.length, 4);
  const mandap = data?.lines.find((line) => line.item_type === 'mandap');
  const furniture = data?.lines.find((line) => line.item_type === 'furniture');
  const catering = data?.lines.find((line) => line.item_type === 'catering');
  assert.equal(mandap?.pricing_status, 'on_request');
  assert.equal(mandap?.catalogue_unit_price_paise, null);
  assert.equal(furniture?.pricing_status, 'on_request');
  assert.equal(furniture?.quantity, 10);
  assert.equal(catering?.pricing_status, 'priced');
  assert.equal(catering?.catalogue_unit_price_paise, CATERING_TIER_PRICE);
  assert.equal(catering?.catalogue_subtotal_paise, CATERING_TIER_PRICE * 120);
  assert.equal(data?.lines.some((line) => line.item_type === 'stage'), true);

  const bookings = await neon.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM bookings WHERE source_enquiry_id = $1',
    [result.id],
  );
  assert.equal(Number(bookings.rows[0]?.count), 0, 'submitting an enquiry must not create a booking');
});

test('an invalid furniture quantity rejects the enquiry before persistence', async () => {
  const selected = await ids();
  const futureDate = new Date(Date.now() + 86400000 * 41).toISOString().slice(0, 10);
  const neon = getNeonClient();
  const before = await neon.query<{ count: number }>('SELECT COUNT(*) AS count FROM event_enquiries');

  await assert.rejects(
    () =>
      createEnquiry({
        event: {
          type: 'Wedding',
          date: futureDate,
          venue: 'Harmu Ground, Ranchi',
          guestCount: 100,
        },
        furniture: [{ id: selected.chair.id, quantity: 5 }],
        contact: {
          name: 'Invalid Quantity',
          phone: '9876504322',
          preferredContact: 'Phone',
        },
      }),
    (error: unknown) => error instanceof EnquiryError && /minimum quantity/i.test(error.message),
  );

  const after = await neon.query<{ count: number }>('SELECT COUNT(*) AS count FROM event_enquiries');
  assert.equal(Number(after.rows[0]?.count), Number(before.rows[0]?.count));
});

test('an enquiry with no catalogue selection is still persisted with quotation-required pricing', async () => {
  const futureDate = new Date(Date.now() + 86400000 * 42).toISOString().slice(0, 10);
  const result = await createEnquiry({
    event: {
      type: 'Corporate Event',
      date: futureDate,
      venue: 'Ranchi Club Ground',
      guestCount: 50,
    },
    contact: {
      name: 'No Selection',
      phone: '9876504323',
      preferredContact: 'Email',
    },
  });

  assert.equal(result.pricing.pricingStatus, 'quotation_required');
  assert.equal(result.pricing.pricedSubtotalPaise, 0);
  const data = await getEventEnquiryWithItems(result.id);
  assert.equal(data?.lines.length, 0);
});

test('client-submitted price fields cannot override the D1 catalogue calculation', async () => {
  const selected = await ids();
  const futureDate = new Date(Date.now() + 86400000 * 43).toISOString().slice(0, 10);
  const result = await createEnquiry({
    event: {
      type: 'Wedding',
      date: futureDate,
      venue: 'Harmu Ground, Ranchi',
      guestCount: 120,
    },
    catering: { id: selected.pkg.id, guestCount: 120, price: 1, unitPrice: 1 } as any,
    contact: {
      name: 'Price Tamper Attempt',
      phone: '9876504324',
      preferredContact: 'Phone',
    },
  });
  const data = await getEventEnquiryWithItems(result.id);
  const catering = data?.lines.find((line) => line.item_type === 'catering');
  assert.equal(catering?.catalogue_unit_price_paise, CATERING_TIER_PRICE);
  assert.equal(catering?.catalogue_subtotal_paise, CATERING_TIER_PRICE * 120);
  assert.equal(result.pricing.pricedSubtotalPaise, CATERING_TIER_PRICE * 120);
});
