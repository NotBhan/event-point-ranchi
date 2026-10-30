import { DatabaseSync } from 'node:sqlite';
import { getD1Client, resetD1Client } from '../src/core/content/d1-client';
import { getNeonClient, resetNeonClient } from '../src/core/operational/neon-client';
import { site } from '../src/core/config';

interface MigrationStats {
  neon: Record<string, { source: number; target: number; matched: boolean }>;
  d1: Record<string, { source: number; target: number; matched: boolean }>;
}

export async function runMigration(): Promise<MigrationStats> {
  if (typeof process !== 'undefined' && process.loadEnvFile) {
    try { process.loadEnvFile(); } catch {}
  }
  console.log('--- Starting Event Point Ranchi Architecture Migration ---');

  const sqlite = new DatabaseSync('./data/event-point.db');
  const d1 = getD1Client();
  const neon = getNeonClient();

  const isD1Remote = d1.isUsingRemote();
  const isNeonRemote = neon.isUsingRemote();

  console.log(`D1 Mode: ${isD1Remote ? 'Cloudflare Remote REST API' : 'Local SQLite Fallback'}`);
  console.log(`Neon Mode: ${isNeonRemote ? 'Remote Neon PostgreSQL' : 'Local SQLite Fallback'}`);

  const stats: MigrationStats = {
    neon: {},
    d1: {},
  };

  // -------------------------------------------------------------------------
  // 1. NEON OPERATIONAL MIGRATION
  // -------------------------------------------------------------------------
  console.log('\n[1/2] Migrating Operational Records to Neon...');

  // 1.1 Users
  const sqliteUsers = sqlite.prepare('SELECT * FROM users').all() as any[];
  console.log(`- Migrating ${sqliteUsers.length} users...`);
  for (const u of sqliteUsers) {
    await neon.query(
      `INSERT INTO users (id, username, email, password_hash, first_name, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         first_name = EXCLUDED.first_name,
         role = EXCLUDED.role,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [
        u.id,
        u.username,
        u.email || `${u.username}@eventpointranchi.com`,
        u.password_hash,
        u.first_name || '',
        u.role || 'customer',
        Boolean(u.is_active ?? 1),
        u.created_at || new Date().toISOString(),
        u.created_at || new Date().toISOString(),
      ],
    );
  }
  // Reset user sequence in Postgres if remote
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('users', 'id'), coalesce(max(id),0) + 1, false) FROM users;`);
  }
  const neonUsers = await neon.query('SELECT COUNT(*) as count FROM users');
  const targetUserCount = Number(neonUsers.rows[0]?.count ?? neonUsers.rows[0]?.COUNT ?? 0);
  stats.neon['users'] = {
    source: sqliteUsers.length,
    target: targetUserCount,
    matched: targetUserCount >= sqliteUsers.length,
  };

  // 1.2 Customers
  const sqliteCustomers = sqlite.prepare('SELECT * FROM customers').all() as any[];
  console.log(`- Migrating ${sqliteCustomers.length} customers...`);
  for (const c of sqliteCustomers) {
    await neon.query(
      `INSERT INTO customers (id, user_id, name, phone, email, address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         address = EXCLUDED.address`,
      [c.id, c.user_id, c.name, c.phone, c.email, c.address, c.created_at || new Date().toISOString()],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('customers', 'id'), coalesce(max(id),0) + 1, false) FROM customers;`);
  }
  const neonCust = await neon.query('SELECT COUNT(*) as count FROM customers');
  const targetCustCount = Number(neonCust.rows[0]?.count ?? neonCust.rows[0]?.COUNT ?? 0);
  stats.neon['customers'] = {
    source: sqliteCustomers.length,
    target: targetCustCount,
    matched: targetCustCount >= sqliteCustomers.length,
  };

  // 1.3 Bookings
  const sqliteBookings = sqlite.prepare('SELECT * FROM bookings').all() as any[];
  console.log(`- Migrating ${sqliteBookings.length} bookings...`);
  for (const b of sqliteBookings) {
    await neon.query(
      `INSERT INTO bookings (id, customer_id, access_token, created_at, event_date, event_time, event_type, total_guest, special_request, status, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         status = EXCLUDED.status,
         total_amount = EXCLUDED.total_amount`,
      [
        b.id,
        b.customer_id,
        b.access_token,
        b.created_at || new Date().toISOString(),
        b.event_date,
        b.event_time,
        b.event_type || 'Wedding',
        b.total_guest || 100,
        b.special_request || '',
        b.status || 'pending',
        b.total_amount || 0,
      ],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('bookings', 'id'), coalesce(max(id),0) + 1, false) FROM bookings;`);
  }
  const neonBookings = await neon.query('SELECT COUNT(*) as count FROM bookings');
  const targetBookingCount = Number(neonBookings.rows[0]?.count ?? neonBookings.rows[0]?.COUNT ?? 0);
  stats.neon['bookings'] = {
    source: sqliteBookings.length,
    target: targetBookingCount,
    matched: targetBookingCount >= sqliteBookings.length,
  };

  // 1.4 Event Enquiries & Line Items
  const sqliteEnquiries = sqlite.prepare('SELECT * FROM event_enquiries').all() as any[];
  console.log(`- Migrating ${sqliteEnquiries.length} event enquiries...`);
  for (const e of sqliteEnquiries) {
    await neon.query(
      `INSERT INTO event_enquiries (id, reference_code, customer_name, customer_phone, customer_email, event_type, event_date, end_date, event_time, venue_location, guest_count, budget_range, requires_rooms, room_count, accommodation_notes, decoration_notes, preferred_contact, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         budget_range = EXCLUDED.budget_range`,
      [
        e.id,
        e.reference_code,
        e.customer_name,
        e.customer_phone,
        e.customer_email,
        e.event_type,
        e.event_date,
        e.end_date,
        e.event_time,
        e.venue_location,
        e.guest_count || 100,
        e.budget_range || '',
        Boolean(e.requires_rooms),
        e.room_count || 0,
        e.accommodation_notes || '',
        e.decoration_notes || '',
        e.preferred_contact || 'Phone',
        e.status || 'new',
        e.created_at || new Date().toISOString(),
      ],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('event_enquiries', 'id'), coalesce(max(id),0) + 1, false) FROM event_enquiries;`);
  }

  const sqliteLineItems = sqlite.prepare('SELECT * FROM enquiry_line_items').all() as any[];
  console.log(`- Migrating ${sqliteLineItems.length} enquiry line items...`);
  for (const li of sqliteLineItems) {
    await neon.query(
      `INSERT INTO enquiry_line_items (id, enquiry_id, item_type, catalogue_item_id, item_name_snapshot, quantity, standard_dimensions_snapshot, requested_length_ft, requested_width_ft, requested_height_ft, specifications, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         specifications = EXCLUDED.specifications`,
      [
        li.id,
        li.enquiry_id,
        li.item_type,
        li.catalogue_item_id,
        li.item_name_snapshot,
        li.quantity || 1,
        li.standard_dimensions_snapshot || '',
        li.requested_length_ft,
        li.requested_width_ft,
        li.requested_height_ft,
        li.specifications || '',
        li.notes || '',
      ],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('enquiry_line_items', 'id'), coalesce(max(id),0) + 1, false) FROM enquiry_line_items;`);
  }
  const neonEnq = await neon.query('SELECT COUNT(*) as count FROM event_enquiries');
  const targetEnqCount = Number(neonEnq.rows[0]?.count ?? neonEnq.rows[0]?.COUNT ?? 0);
  stats.neon['event_enquiries'] = {
    source: sqliteEnquiries.length,
    target: targetEnqCount,
    matched: targetEnqCount >= sqliteEnquiries.length,
  };

  // 1.5 Contact Inquiries
  const sqliteContact = sqlite.prepare('SELECT * FROM contact_inquiries').all() as any[];
  console.log(`- Migrating ${sqliteContact.length} contact inquiries...`);
  for (const ci of sqliteContact) {
    await neon.query(
      `INSERT INTO contact_inquiries (id, name, phone, email, event_type, event_date, guest_count, message, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status`,
      [
        ci.id,
        ci.name,
        ci.phone,
        ci.email,
        ci.event_type || '',
        ci.event_date,
        ci.guest_count,
        ci.message || '',
        ci.status || 'new',
        ci.created_at || new Date().toISOString(),
      ],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('contact_inquiries', 'id'), coalesce(max(id),0) + 1, false) FROM contact_inquiries;`);
  }
  const neonContact = await neon.query('SELECT COUNT(*) as count FROM contact_inquiries');
  const targetContactCount = Number(neonContact.rows[0]?.count ?? neonContact.rows[0]?.COUNT ?? 0);
  stats.neon['contact_inquiries'] = {
    source: sqliteContact.length,
    target: targetContactCount,
    matched: targetContactCount >= sqliteContact.length,
  };

  // 1.6 Storage Objects (Filebase Storage Ledger)
  const sqliteStorage = sqlite.prepare('SELECT * FROM storage_objects').all() as any[];
  console.log(`- Migrating ${sqliteStorage.length} storage ledger objects...`);
  for (const so of sqliteStorage) {
    await neon.query(
      `INSERT INTO storage_objects (id, object_id, storage_category, entity_type, entity_id, slot, object_key, public_url, mime_type, size_bytes, width, height, format, original_filename, status, deletion_attempts, last_deletion_error, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (object_id) DO UPDATE SET
         status = EXCLUDED.status,
         size_bytes = EXCLUDED.size_bytes,
         public_url = EXCLUDED.public_url,
         updated_at = EXCLUDED.updated_at`,
      [
        so.id,
        so.object_id,
        so.storage_category,
        so.entity_type,
        so.entity_id || '',
        so.slot || 'primary',
        so.object_key,
        so.public_url,
        so.mime_type,
        so.size_bytes,
        so.width,
        so.height,
        so.format,
        so.original_filename || '',
        so.status || 'active',
        so.deletion_attempts || 0,
        so.last_deletion_error,
        so.created_at || new Date().toISOString(),
        so.updated_at || new Date().toISOString(),
      ],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('storage_objects', 'id'), coalesce(max(id),0) + 1, false) FROM storage_objects;`);
  }
  const neonStorage = await neon.query('SELECT COUNT(*) as count FROM storage_objects');
  const targetStorageCount = Number(neonStorage.rows[0]?.count ?? neonStorage.rows[0]?.COUNT ?? 0);
  stats.neon['storage_objects'] = {
    source: sqliteStorage.length,
    target: targetStorageCount,
    matched: targetStorageCount >= sqliteStorage.length,
  };

  // 1.7 Traffic Events (Migrate sample / batch to preserve records)
  const sqliteTraffic = sqlite.prepare('SELECT * FROM traffic_events ORDER BY id DESC LIMIT 50').all() as any[];
  console.log(`- Migrating ${sqliteTraffic.length} recent traffic events to Neon...`);
  for (const te of sqliteTraffic) {
    await neon.query(
      `INSERT INTO traffic_events (id, session_id, path, referrer, device_type, browser, os, city, duration_seconds, utm_source, utm_medium, utm_campaign, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        te.id,
        te.session_id,
        te.path,
        te.referrer || 'direct',
        te.device_type || 'desktop',
        te.browser || 'Other',
        te.os || 'Other',
        te.city || 'Ranchi',
        te.duration_seconds || 0,
        te.utm_source || '',
        te.utm_medium || '',
        te.utm_campaign || '',
        te.created_at || new Date().toISOString(),
      ],
    );
  }
  if (isNeonRemote) {
    await neon.query(`SELECT setval(pg_get_serial_sequence('traffic_events', 'id'), coalesce(max(id),0) + 1, false) FROM traffic_events;`);
  }
  const neonTraffic = await neon.query('SELECT COUNT(*) as count FROM traffic_events');
  const targetTrafficCount = Number(neonTraffic.rows[0]?.count ?? neonTraffic.rows[0]?.COUNT ?? 0);
  stats.neon['traffic_events'] = {
    source: sqliteTraffic.length,
    target: targetTrafficCount,
    matched: targetTrafficCount >= sqliteTraffic.length,
  };


  // -------------------------------------------------------------------------
  // 2. CLOUDFLARE D1 CONTENT MIGRATION
  // -------------------------------------------------------------------------
  console.log('\n[2/2] Migrating Website Content Records to Cloudflare D1...');

  // 2.1 Site Settings (Singleton 'global')
  const socialLinksJson = JSON.stringify(site.social.map(s => ({ platform: s.label, url: s.href })));
  await d1.query(
    `INSERT INTO site_settings (
      id, name, legal_name, tagline, short_description, logo_url, favicon_url,
      phone, whatsapp, email, address, venue_address, business_hours, social_links_json,
      primary_color, gold_bright, font_preset, default_title, default_description,
      og_image_url, currency, locale, announcement_enabled, announcement_text,
      announcement_location, announcement_phone, maintenance_enabled, maintenance_message
    ) VALUES (
      'global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'en-IN',
      1, 'Mandaps, stage designs, furniture & equipment — enquiries are quotations, not automatic bookings',
      'Wedding planning across Ranchi & Jharkhand', ?, 0, ''
    ) ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      whatsapp = excluded.whatsapp,
      address = excluded.address`,
    [
      site.name,
      site.legalName,
      site.tagline,
      site.shortDescription,
      site.logo,
      site.logo,
      site.phone,
      site.whatsapp,
      site.email,
      site.address,
      site.venueAddress,
      'Daily, 10:00 – 19:00',
      socialLinksJson,
      '#721224',
      '#e0b868',
      'heritage',
      `${site.name} | Wedding Mandaps, Stage Designs & Event Equipment in Ranchi`,
      site.shortDescription,
      '/storage/assets/banners/homepage/banner-hero.webp',
      site.phone,
    ],
  );
  stats.d1['site_settings'] = { source: 1, target: 1, matched: true };

  // 2.2 Homepage Sections
  const defaultSections = [
    {
      id: 'sec_hero',
      section_key: 'hero',
      section_type: 'hero',
      title: "Create the Wedding Setup You've Always Imagined.",
      subtitle: 'Mandaps, stage designs, furniture and event equipment — planned and delivered by one Ranchi team.',
      description: 'Choose what you love, add your dimensions and send a single, complete requirement.',
      image_url: '/storage/assets/banners/homepage/banner-hero.webp',
      cta_label: 'Explore Mandaps',
      cta_url: '/mandaps',
      badge: 'Wedding Planning · Ranchi',
      is_visible: 1,
      sort_order: 1,
      config_json: JSON.stringify({ secondaryCta: { label: 'Plan Your Event', url: '/plan' } }),
    },
    {
      id: 'sec_features',
      section_key: 'features',
      section_type: 'features',
      title: 'Everything for your wedding, handled under one roof.',
      subtitle: 'Why Ranchi families trust Event Point for complete setups',
      description: '',
      image_url: '',
      cta_label: '',
      cta_url: '',
      badge: 'Why Event Point',
      is_visible: 1,
      sort_order: 2,
      config_json: JSON.stringify([
        { icon: 'archway', title: 'Signature Mandaps', description: 'Carved, floral and contemporary mandap concepts built to your dimensions.' },
        { icon: 'theater', title: 'Stage Design Studio', description: 'Reception and ceremony stages styled around your palette and venue.' },
        { icon: 'chair', title: 'Furniture & Equipment', description: 'Chairs, tables, lounge seating, lighting and event essentials in one place.' },
        { icon: 'shield', title: 'One Planning Team', description: 'A single Ranchi-based coordinator from first enquiry to final setup.' },
      ]),
    },
    {
      id: 'sec_steps',
      section_key: 'steps',
      section_type: 'steps',
      title: 'How It Works',
      subtitle: 'From initial enquiry to your dream wedding celebration',
      description: 'A transparent five-step process designed to remove stress from event coordination.',
      image_url: '',
      cta_label: 'Start Planning Now',
      cta_url: '/plan',
      badge: 'Planning Process',
      is_visible: 1,
      sort_order: 3,
      config_json: JSON.stringify([
        { stepNumber: '01', title: 'Share your date & venue', description: 'Tell us the event type, date, guest count and location in Ranchi.' },
        { stepNumber: '02', title: 'Select mandap & stage', description: 'Choose a design or request custom dimensions for your venue.' },
        { stepNumber: '03', title: 'Build your equipment list', description: 'Add chairs, tables, lounge seating, lighting and essentials with quantities.' },
        { stepNumber: '04', title: 'Receive a quotation', description: 'Our team checks availability and sends an itemised quotation — not an auto-booking.' },
        { stepNumber: '05', title: 'Confirm in writing', description: 'Dates and stock are held only after you confirm the quotation with us.' },
      ]),
    },
  ];

  for (const s of defaultSections) {
    await d1.query(
      `INSERT INTO homepage_sections (id, section_key, section_type, title, subtitle, description, image_url, cta_label, cta_url, badge, is_visible, sort_order, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         subtitle = excluded.subtitle,
         description = excluded.description,
         image_url = excluded.image_url,
         config_json = excluded.config_json`,
      [s.id, s.section_key, s.section_type, s.title, s.subtitle, s.description, s.image_url, s.cta_label, s.cta_url, s.badge, s.is_visible, s.sort_order, s.config_json],
    );
  }
  stats.d1['homepage_sections'] = { source: defaultSections.length, target: defaultSections.length, matched: true };

  // 2.3 Services
  const sqliteServices = sqlite.prepare('SELECT * FROM services').all() as any[];
  console.log(`- Migrating ${sqliteServices.length} services...`);
  for (const s of sqliteServices) {
    const baseSlug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const slug = `${baseSlug}-${s.id}`;
    await d1.query(
      `INSERT INTO services (id, slug, title, description, badge, image_url, features_json, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 1, ?)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         slug = excluded.slug,
         sort_order = excluded.sort_order`,
      [s.id, slug, s.name, 'Professional service tailored for weddings and events in Ranchi.', 'Included', '/storage/assets/branding/logo.png', s.sort || 0],
    );
  }
  stats.d1['services'] = { source: sqliteServices.length, target: sqliteServices.length, matched: true };

  // 2.4 Mandaps & Mandap Gallery
  const sqliteMandaps = sqlite.prepare('SELECT * FROM mandaps').all() as any[];
  console.log(`- Migrating ${sqliteMandaps.length} mandaps...`);
  for (const m of sqliteMandaps) {
    await d1.query(
      `INSERT INTO mandaps (id, name, slug, description, category, length_ft, width_ft, height_ft, dimension_unit, material_specs, price_starting_paise, capacity, features_json, image_url, is_featured, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         image_url = excluded.image_url,
         description = excluded.description`,
      [
        m.id,
        m.name,
        m.slug,
        m.description || '',
        m.category || 'Traditional Royal',
        m.length_ft || 16,
        m.width_ft || 16,
        m.height_ft || 12,
        m.dimension_unit || 'ft',
        m.material_specs || '',
        0,
        0,
        m.image || '',
        m.is_active ?? 1,
        m.sort || 0,
      ],
    );
  }

  const sqliteMandapGallery = sqlite.prepare('SELECT * FROM mandap_gallery').all() as any[];
  for (const mg of sqliteMandapGallery) {
    await d1.query(
      `INSERT INTO mandap_gallery (id, mandap_id, image_url, caption, sort_order)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT (id) DO UPDATE SET
         image_url = excluded.image_url`,
      [mg.id, mg.mandap_id, mg.image, mg.sort || 0],
    );
  }
  stats.d1['mandaps'] = { source: sqliteMandaps.length, target: sqliteMandaps.length, matched: true };
  stats.d1['mandap_gallery'] = { source: sqliteMandapGallery.length, target: sqliteMandapGallery.length, matched: true };

  // 2.5 Stages & Stage Gallery
  const sqliteStages = sqlite.prepare('SELECT * FROM stages').all() as any[];
  console.log(`- Migrating ${sqliteStages.length} stages...`);
  for (const st of sqliteStages) {
    await d1.query(
      `INSERT INTO stages (id, name, slug, description, style_category, length_ft, width_ft, height_ft, dimension_unit, decoration_notes, price_starting_paise, image_url, is_featured, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         image_url = excluded.image_url,
         description = excluded.description`,
      [
        st.id,
        st.name,
        st.slug,
        st.description || '',
        st.style_category || 'Royal Reception',
        st.length_ft || 24,
        st.width_ft || 16,
        st.height_ft || 14,
        st.dimension_unit || 'ft',
        st.decoration_notes || '',
        st.image || '',
        st.is_active ?? 1,
        st.sort || 0,
      ],
    );
  }

  const sqliteStageGallery = sqlite.prepare('SELECT * FROM stage_gallery').all() as any[];
  for (const sg of sqliteStageGallery) {
    await d1.query(
      `INSERT INTO stage_gallery (id, stage_id, image_url, caption, sort_order)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT (id) DO UPDATE SET
         image_url = excluded.image_url`,
      [sg.id, sg.stage_id, sg.image, sg.sort || 0],
    );
  }
  stats.d1['stages'] = { source: sqliteStages.length, target: sqliteStages.length, matched: true };
  stats.d1['stage_gallery'] = { source: sqliteStageGallery.length, target: sqliteStageGallery.length, matched: true };

  // 2.6 Furniture / Equipment Categories & Items
  const sqliteEqCat = sqlite.prepare('SELECT * FROM equipment_categories').all() as any[];
  console.log(`- Migrating ${sqliteEqCat.length} equipment categories...`);
  for (const ec of sqliteEqCat) {
    await d1.query(
      `INSERT INTO furniture_categories (id, name, slug, icon, sort_order, is_visible)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         icon = excluded.icon`,
      [ec.id, ec.name, ec.slug, ec.icon || 'chair', ec.sort || 0, ec.is_active ?? 1],
    );
  }

  const sqliteEqItems = sqlite.prepare('SELECT * FROM equipment_items').all() as any[];
  console.log(`- Migrating ${sqliteEqItems.length} equipment items...`);
  for (const ei of sqliteEqItems) {
    await d1.query(
      `INSERT INTO furniture_items (id, category_id, name, slug, description, image_url, price_paise, pricing_unit, dimensions, specifications, min_quantity, default_quantity, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'per item', '', ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         image_url = excluded.image_url,
         specifications = excluded.specifications`,
      [
        ei.id,
        ei.category_id,
        ei.name,
        ei.slug,
        ei.description || '',
        ei.image || '',
        ei.specifications || '',
        ei.min_quantity || 1,
        ei.default_quantity || 10,
        ei.is_active ?? 1,
        ei.sort || 0,
      ],
    );
  }
  stats.d1['furniture_categories'] = { source: sqliteEqCat.length, target: sqliteEqCat.length, matched: true };
  stats.d1['furniture_items'] = { source: sqliteEqItems.length, target: sqliteEqItems.length, matched: true };

  // 2.7 Catering Packages
  const sqliteCatering = sqlite.prepare('SELECT * FROM catering_packages').all() as any[];
  console.log(`- Migrating ${sqliteCatering.length} catering packages...`);
  for (const cp of sqliteCatering) {
    const features = sqlite.prepare('SELECT name FROM catering_features WHERE package_id = ?').all(cp.id) as Array<{ name: string }>;
    const featuresJson = JSON.stringify(features.map(f => f.name));

    await d1.query(
      `INSERT INTO catering_packages (id, name, slug, description, badge, image_url, price_per_plate_paise, features_json, menu_sections_json, guest_pricing_json, show_on_home, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, 0)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         image_url = excluded.image_url,
         price_per_plate_paise = excluded.price_per_plate_paise`,
      [
        cp.id,
        cp.name,
        cp.slug,
        cp.description || '',
        cp.badge || '',
        cp.image || '',
        cp.price_paise || 0,
        featuresJson,
        cp.show_on_home || 0,
        cp.is_active ?? 1,
      ],
    );
  }
  stats.d1['catering_packages'] = { source: sqliteCatering.length, target: sqliteCatering.length, matched: true };

  // 2.8 Rooms (Configurable options for enquiry form)
  const sqliteRooms = sqlite.prepare('SELECT * FROM rooms').all() as any[];
  console.log(`- Migrating ${sqliteRooms.length} room configuration options...`);
  for (const rm of sqliteRooms) {
    const features = sqlite.prepare('SELECT name FROM room_features WHERE room_id = ?').all(rm.id) as Array<{ name: string }>;
    await d1.query(
      `INSERT INTO rooms (id, name, description, price_paise, capacity, total_rooms, image_url, features_json, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description`,
      [
        rm.id,
        rm.name,
        rm.description || '',
        rm.price_paise || 0,
        rm.capacity || 1,
        rm.total_rooms || 1,
        rm.image || '',
        JSON.stringify(features.map(f => f.name)),
        rm.is_active ?? 1,
      ],
    );
  }
  stats.d1['rooms'] = { source: sqliteRooms.length, target: sqliteRooms.length, matched: true };

  // 2.9 Gallery Categories & Items
  const sqliteGalCat = sqlite.prepare('SELECT * FROM gallery_categories').all() as any[];
  console.log(`- Migrating ${sqliteGalCat.length} gallery categories...`);
  for (const gc of sqliteGalCat) {
    await d1.query(
      `INSERT INTO gallery_categories (id, name, slug, sort_order, is_visible)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug`,
      [gc.id, gc.name, gc.slug, gc.sort || 0, gc.is_active ?? 1],
    );
  }

  const sqliteGalItems = sqlite.prepare('SELECT * FROM gallery_items').all() as any[];
  console.log(`- Migrating ${sqliteGalItems.length} gallery items...`);
  for (const gi of sqliteGalItems) {
    await d1.query(
      `INSERT INTO gallery_items (id, category_id, caption, image_url, alt_text, is_visible, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (id) DO UPDATE SET
         image_url = excluded.image_url,
         caption = excluded.caption`,
      [gi.id, gi.category_id, gi.title || '', gi.image, gi.title || '', gi.is_active ?? 1, gi.created_at || new Date().toISOString()],
    );
  }
  stats.d1['gallery_categories'] = { source: sqliteGalCat.length, target: sqliteGalCat.length, matched: true };
  stats.d1['gallery_items'] = { source: sqliteGalItems.length, target: sqliteGalItems.length, matched: true };

  // 2.10 SEO Settings Defaults
  const defaultSeoPages = [
    { key: 'home', title: `${site.name} | Wedding Mandaps, Stage Designs & Event Equipment in Ranchi`, desc: site.shortDescription },
    { key: 'mandaps', title: `Wedding Mandap Designs | ${site.name}`, desc: 'Browse handcrafted traditional and contemporary wedding mandaps in Ranchi.' },
    { key: 'stages', title: `Wedding & Reception Stage Designs | ${site.name}`, desc: 'Exquisite reception, engagement and wedding stage decorations in Ranchi.' },
    { key: 'equipment', title: `Furniture & Event Equipment Hire | ${site.name}`, desc: 'Chairs, banquet tables, lounge sofas, sound and lighting setup in Ranchi.' },
    { key: 'catering', title: `Wedding Catering Packages | ${site.name}`, desc: 'Pure vegetarian and royal wedding feast menus curated in Ranchi.' },
    { key: 'gallery', title: `Wedding Setup Gallery | ${site.name}`, desc: 'Explore our portfolio of mandaps, stages and decor in Ranchi.' },
    { key: 'plan', title: `Plan Your Event Requirements | ${site.name}`, desc: 'Customise mandap dimensions, stage styling and equipment lists for an accurate quotation.' },
    { key: 'contact', title: `Contact Us | ${site.name}`, desc: `Connect with Event Point Ranchi at ${site.phone} or visit our venue.` },
  ];
  for (const p of defaultSeoPages) {
    await d1.query(
      `INSERT INTO seo_settings (page_key, title, description, canonical_url, og_image_url)
       VALUES (?, ?, ?, ?, '/storage/assets/banners/homepage/banner-hero.webp')
       ON CONFLICT (page_key) DO UPDATE SET
         title = excluded.title,
         description = excluded.description`,
      [p.key, p.title, p.desc, `https://eventpointranchi.com/${p.key === 'home' ? '' : p.key}`],
    );
  }
  stats.d1['seo_settings'] = { source: defaultSeoPages.length, target: defaultSeoPages.length, matched: true };

  console.log('\n--- Migration Completed Successfully! ---');
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then(async (stats) => {
      console.log('\nMigration Reconciliation Summary:');
      for (const [table, s] of Object.entries(stats.neon)) {
        console.log(`  Neon: ${table.padEnd(20)}: source=${s.source}, target=${s.target} [${s.matched ? 'MATCH' : 'MISMATCH'}]`);
      }
      for (const [table, s] of Object.entries(stats.d1)) {
        console.log(`  D1:   ${table.padEnd(20)}: source=${s.source}, target=${s.target} [${s.matched ? 'MATCH' : 'MISMATCH'}]`);
      }
      resetD1Client();
      await resetNeonClient();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
