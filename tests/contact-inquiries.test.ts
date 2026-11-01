import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cleanupIsolatedDatabases, useIsolatedContentDb, useIsolatedOperationalDb } from './helpers/isolated-db';

// Contact inquiries are operational records: this suite runs entirely against a
// throwaway database.
useIsolatedContentDb();
useIsolatedOperationalDb('contact-inquiries');
after(cleanupIsolatedDatabases);

const {
  createContactInquiry,
  countContactInquiries,
  listContactInquiriesPage,
  updateContactInquiryStatus,
  deleteContactInquiry,
} = await import('../src/core/operational/service');
const { listInquiries, updateInquiryStatus, deleteInquiry } = await import('../src/modules/admin/service');
const { getDb } = await import('../src/core/db');

function inquiry(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Contact Test',
    phone: '9876500777',
    email: 'contact@example.test',
    eventType: 'Wedding',
    eventDate: '2027-01-15',
    guestCount: 150,
    message: 'Please share a quotation.',
    ...overrides,
  };
}

test('a contact inquiry is committed to the operational database', async () => {
  const created = await createContactInquiry(inquiry() as never);
  assert.ok(created.id > 0);

  const rows = await listContactInquiriesPage('all');
  const stored = rows.find((row) => row.id === created.id);
  assert.ok(stored, 'the inquiry must be readable after creation');
  assert.equal(stored!.name, 'Contact Test');
  assert.equal(stored!.status, 'new');
  assert.equal(Number(stored!.guest_count), 150);
});

test('the contact form does not write to the local SQLite copy', async () => {
  const sqlite = getDb();
  const countRows = () =>
    Number((sqlite.prepare('SELECT COUNT(*) AS count FROM contact_inquiries').get() as { count: number }).count);

  const before = countRows();
  await createContactInquiry(inquiry({ phone: '9876500778' }) as never);
  const after = countRows();

  assert.equal(after, before, 'creating an inquiry must not add a SQLite row');
});

test('listing filters by status and paginates', async () => {
  const created = await createContactInquiry(inquiry({ phone: '9876500779' }) as never);
  await updateContactInquiryStatus(created.id, 'contacted');

  const contacted = await listContactInquiriesPage('contacted', { limit: 50, offset: 0 });
  assert.ok(contacted.some((row) => row.id === created.id));
  assert.ok(contacted.every((row) => row.status === 'contacted'));

  const all = await countContactInquiries();
  const contactedCount = await countContactInquiries('contacted');
  assert.ok(contactedCount >= 1);
  assert.ok(all >= contactedCount);

  const page = await listInquiries('contacted', { page: 1, perPage: 1 });
  assert.equal(page.items.length, 1);
  assert.ok(page.pagination.totalCount >= 1);
});

test('the admin can change status and failures are not silent', async () => {
  const created = await createContactInquiry(inquiry({ phone: '9876500780' }) as never);

  await updateInquiryStatus(created.id, 'closed');
  const rows = await listContactInquiriesPage('closed');
  assert.ok(rows.some((row) => row.id === created.id));

  await assert.rejects(() => updateInquiryStatus(created.id, 'nonsense'), /invalid inquiry status/i);
  await assert.rejects(() => updateInquiryStatus(999999, 'new'), /was not found/i);
});

test('the admin can delete an inquiry and unknown ids fail', async () => {
  const created = await createContactInquiry(inquiry({ phone: '9876500781' }) as never);

  await deleteInquiry(created.id);
  const rows = await listContactInquiriesPage('all');
  assert.ok(!rows.some((row) => row.id === created.id));

  await assert.rejects(() => deleteInquiry(created.id), /was not found/i);
  assert.equal(await deleteContactInquiry(created.id), false);
});
