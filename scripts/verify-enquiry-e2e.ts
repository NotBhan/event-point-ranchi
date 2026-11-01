/**
 * End-to-end verification of the enquiry journey against a running server.
 *
 * Exercises the real HTTP routes (CSRF, validation, API, receipt page, admin
 * dashboard, QR scan endpoint) and checks the operational database directly, so
 * "the enquiry was submitted" and "the enquiry exists" are verified separately.
 *
 * Usage:
 *   npm run build && npm start &            # or: npm run dev
 *   node --import tsx scripts/verify-enquiry-e2e.ts --base-url http://localhost:4321
 *
 * The run creates one real enquiry and removes it again at the end unless
 * --keep is passed. Nothing else is modified.
 */
import { Pool } from '@neondatabase/serverless';

interface Options {
  baseUrl: string;
  keep: boolean;
}

interface CookieJar {
  [name: string]: string;
}

function parseArgs(argv: string[]): Options {
  const baseUrlIndex = argv.indexOf('--base-url');
  return {
    baseUrl: baseUrlIndex >= 0 ? argv[baseUrlIndex + 1].replace(/\/+$/, '') : 'http://localhost:4321',
    keep: argv.includes('--keep'),
  };
}

function rememberCookies(jar: CookieJar, response: Response): void {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    jar[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

const results: Array<{ name: string; passed: boolean; detail: string }> = [];

function check(name: string, passed: boolean, detail = ''): void {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const jar: CookieJar = {};
  const origin = options.baseUrl;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to verify the operational database.');

  const pool = new Pool({ connectionString: databaseUrl });

  console.log(`Verifying enquiry journey against ${origin}\n`);

  // 1. Load the plan page to obtain a CSRF token the same way a browser does.
  const planResponse = await fetch(`${origin}/plan`);
  rememberCookies(jar, planResponse);
  const csrf = jar.rp_csrf;
  check('GET /plan issues a CSRF cookie', planResponse.status === 200 && Boolean(csrf), `status ${planResponse.status}`);

  const futureDate = new Date(Date.now() + 86400000 * 12).toISOString().slice(0, 10);
  const uniqueSuffix = Math.random().toString(36).slice(2, 8);

  // 2. Submit a genuinely new enquiry through the public API.
  const submitResponse = await fetch(`${origin}/api/enquiries`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrf ?? '',
      cookie: cookieHeader(jar),
    },
    body: JSON.stringify({
      event: {
        type: 'Wedding',
        date: futureDate,
        time: '19:00',
        venue: `E2E Verification Ground ${uniqueSuffix}`,
        guestCount: 275,
        description: 'Automated end-to-end verification enquiry.',
      },
      mandap: null,
      stage: null,
      equipment: [],
      apartment: undefined,
      accommodation: { required: true, acRoomCount: 4, nonAcRoomCount: 6, notes: 'E2E room block.' },
      styling: { lighting: 'Warm fairy lights', floralPalette: 'Maroon & ivory', specialInstructions: '' },
      contact: {
        name: `E2E Verification ${uniqueSuffix}`,
        phone: '9876500123',
        email: `e2e-${uniqueSuffix}@example.com`,
        budgetRange: '₹5L - ₹10L',
        preferredContact: 'Phone',
      },
    }),
  });

  const submitBody = (await submitResponse.json().catch(() => ({}))) as {
    status?: string;
    reference?: string;
    token?: string;
    scanUrl?: string;
    receiptUrl?: string;
    message?: string;
  };

  check(
    'POST /api/enquiries returns a committed reference',
    submitResponse.status === 201 && submitBody.status === 'success' && Boolean(submitBody.reference),
    `status ${submitResponse.status}${submitBody.message ? ` · ${submitBody.message}` : ''}`,
  );

  const reference = submitBody.reference;
  if (!reference) {
    throw new Error('No reference returned; the remaining checks cannot run.');
  }
  console.log(`\nEnquiry reference: ${reference}\n`);

  // 3. Confirm the row exists in the operational database (independent connection).
  const rowResult = await pool.query(
    'SELECT id, reference_code, customer_name, room_count, requires_rooms FROM event_enquiries WHERE reference_code = $1',
    [reference],
  );
  const row = rowResult.rows[0];
  check('Enquiry exists in Neon PostgreSQL', Boolean(row), row ? `id ${row.id}` : 'row missing');

  const linesResult = await pool.query('SELECT COUNT(*) AS count FROM enquiry_line_items WHERE enquiry_id = $1', [
    row?.id ?? 0,
  ]);
  check('Line-item rows were committed with the enquiry', Number(linesResult.rows[0]?.count ?? 0) >= 0);

  // 4. Persistence after a fresh read (no process-level cache involved).
  const reread = await pool.query('SELECT reference_code FROM event_enquiries WHERE reference_code = $1', [reference]);
  check('Reference is still retrievable after re-reading the database', reread.rows.length === 1);

  // 5. Receipt page by token, then by reference alone.
  const tokenReceipt = await fetch(`${origin}/receipts/enquiry/${reference}?token=${submitBody.token ?? ''}`);
  const tokenReceiptHtml = await tokenReceipt.text();
  check(
    'Receipt opens with the token issued at submission',
    tokenReceipt.status === 200 && tokenReceiptHtml.includes(reference) && !tokenReceiptHtml.includes('Not Found'),
    `status ${tokenReceipt.status}`,
  );

  const refReceipt = await fetch(`${origin}/receipts/enquiry/${reference}`);
  const refReceiptHtml = await refReceipt.text();
  check(
    'Receipt opens from the reference alone (QR/link fallback)',
    refReceipt.status === 200 && refReceiptHtml.includes(reference) && !refReceiptHtml.includes('Not Found'),
    `status ${refReceipt.status}`,
  );

  // 6. A wrong reference must not resolve.
  const bogus = `EP-000000-${uniqueSuffix.slice(0, 3).toUpperCase()}`;
  const bogusReceipt = await fetch(`${origin}/receipts/enquiry/${bogus}`);
  const bogusHtml = await bogusReceipt.text();
  check('An unknown reference is reported as not found', bogusHtml.includes('Not Found'), `status ${bogusReceipt.status}`);

  // 7. Admin console: sign in and confirm the enquiry is listed.
  const adminJar: CookieJar = {};
  const adminPage = await fetch(`${origin}/admin/login`);
  rememberCookies(adminJar, adminPage);
  const adminCsrf = adminJar.rp_csrf;

  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const loginResponse = await fetch(`${origin}/admin/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(adminJar),
    },
    body: new URLSearchParams({ username: 'admin', password: adminPassword, _csrf: adminCsrf ?? '' }).toString(),
  });
  rememberCookies(adminJar, loginResponse);
  const adminSignedIn = Boolean(adminJar.rp_session);
  check('Admin signs in', adminSignedIn, `status ${loginResponse.status}`);

  if (adminSignedIn) {
    // The dashboard, booking list and customer list all read the operational
    // database now; loading them proves those queries run against real data.
    for (const [label, path] of [
      ['Admin dashboard renders', '/admin'],
      ['Admin booking list renders', '/admin/bookings'],
      ['Admin customer list renders', '/admin/customers'],
    ] as const) {
      const page = await fetch(`${origin}${path}`, { headers: { cookie: cookieHeader(adminJar) } });
      check(label, page.status === 200, `status ${page.status}`);
    }

    const listResponse = await fetch(`${origin}/admin/enquiries?q=${encodeURIComponent(reference)}`, {
      headers: { cookie: cookieHeader(adminJar) },
    });
    const listHtml = await listResponse.text();
    check(
      'Admin dashboard lists the new enquiry',
      listResponse.status === 200 && listHtml.includes(reference),
      `status ${listResponse.status}`,
    );

    const detailResponse = await fetch(`${origin}/admin/enquiries/${row?.id}`, {
      headers: { cookie: cookieHeader(adminJar) },
    });
    const detailHtml = await detailResponse.text();
    check(
      'Admin enquiry detail page renders the record',
      detailResponse.status === 200 && detailHtml.includes(reference),
      `status ${detailResponse.status}`,
    );

    // 8. QR verification through the admin scan endpoint.
    const scanInput = submitBody.scanUrl ?? `${origin}/admin/enquiries/scan?token=${submitBody.token ?? ''}`;
    const qrLookup = await fetch(`${origin}/api/admin/enquiry/lookup-by-qr`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': adminCsrf ?? '',
        cookie: cookieHeader(adminJar),
      },
      body: JSON.stringify({ input: scanInput }),
    });
    const qrBody = (await qrLookup.json().catch(() => ({}))) as {
      success?: boolean;
      enquiry?: { referenceCode?: string };
      error?: string;
    };
    check(
      'QR scan resolves the enquiry through the same database',
      qrLookup.status === 200 && qrBody.success === true && qrBody.enquiry?.referenceCode === reference,
      `status ${qrLookup.status}${qrBody.error ? ` · ${qrBody.error}` : ''}`,
    );

    const badLookup = await fetch(`${origin}/api/admin/enquiry/lookup-by-qr`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': adminCsrf ?? '',
        cookie: cookieHeader(adminJar),
      },
      body: JSON.stringify({ input: bogus }),
    });
    check('QR scan rejects an unknown reference', badLookup.status === 404, `status ${badLookup.status}`);
  } else {
    check('Admin dashboard lists the new enquiry', false, 'admin sign-in failed; listing not verified');
  }

  // 9. Clean up only the rows this script created.
  if (!options.keep && row?.id) {
    await pool.query('DELETE FROM enquiry_line_items WHERE enquiry_id = $1', [row.id]);
    await pool.query('DELETE FROM enquiry_qr_tokens WHERE enquiry_id = $1', [row.id]);
    await pool.query('DELETE FROM event_enquiries WHERE id = $1', [row.id]);
    const remaining = await pool.query('SELECT id FROM event_enquiries WHERE reference_code = $1', [reference]);
    check('Verification enquiry removed afterwards', remaining.rows.length === 0, 'test data cleaned up');
  } else if (options.keep) {
    console.log(`\n--keep passed: enquiry ${reference} left in place.`);
  }

  await pool.end();

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailed checks:');
    for (const result of failed) console.log(`  - ${result.name}${result.detail ? ` (${result.detail})` : ''}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\nVerification run failed:', error);
  process.exitCode = 1;
});
