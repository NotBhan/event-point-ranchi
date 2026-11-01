import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedOperationalDb } from './helpers/isolated-db';

// Enquiries are operational records. This suite writes to an isolated file and
// is part of the default `npm test` run.
useIsolatedOperationalDb('enquiry-rooms');
after(cleanupIsolatedDatabases);

const { createEnquiry } = await import('../src/modules/plan/service');
const { getNeonClient } = await import('../src/core/operational/neon-client');

test('Enquiry persistence records AC and Non-AC room requirements', async () => {
  const futureDate = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
  const result = await createEnquiry({
    event: {
      type: 'Wedding',
      date: futureDate,
      time: '18:00',
      venue: 'Ranchi Club Ground',
      guestCount: 200,
      description: 'Test enquiry with AC and Non-AC room requirements',
    },
    contact: {
      name: 'Priya Sharma',
      phone: '9876543210',
      email: 'priya@example.com',
      budgetRange: '₹5L - ₹10L',
      preferredContact: 'Phone',
    },
    accommodation: {
      required: true,
      acRoomCount: 15,
      nonAcRoomCount: 10,
      notes: 'Need early morning check-in for groom family.',
    },
    styling: {
      lighting: 'Fairy lights',
      floralPalette: 'Pastel pink and white',
      specialInstructions: '',
    },
  });

  assert.ok(result.reference.startsWith('EP-'), 'Enquiry reference code should be generated');

  const neon = getNeonClient();
  const stored = await neon.query<{
    requires_rooms: boolean | number;
    room_count: number;
    accommodation_notes: string;
  }>('SELECT requires_rooms, room_count, accommodation_notes FROM event_enquiries WHERE reference_code = $1', [
    result.reference,
  ]);

  const enquiry = stored.rows[0];
  assert.ok(enquiry, 'Enquiry record must be persisted in the operational database');
  assert.ok(Boolean(enquiry.requires_rooms), 'requires_rooms should be recorded as true');
  assert.equal(enquiry.room_count, 25, 'Total room_count must equal acRoomCount (15) + nonAcRoomCount (10)');
  assert.ok(
    enquiry.accommodation_notes.includes('15 AC, 10 Non-AC'),
    'accommodation_notes must record explicit AC/Non-AC room amounts',
  );
});

test('The rooms feature stays removed', () => {
  const adminModuleContent = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/admin/module.ts'), 'utf8');
  assert.ok(!adminModuleContent.includes('/admin/rooms'), 'Admin module must not contain /admin/rooms');
  assert.ok(!adminModuleContent.includes('RoomsPage'), 'Admin module must not import RoomsPage');
  assert.ok(!adminModuleContent.includes('RoomFormPage'), 'Admin module must not import RoomFormPage');

  assert.ok(!fs.existsSync(path.resolve(process.cwd(), 'src/modules/rooms')), 'src/modules/rooms must be deleted');
  assert.ok(!fs.existsSync(path.resolve(process.cwd(), 'src/client/rooms.ts')), 'src/client/rooms.ts must be deleted');
});
