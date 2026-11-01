# Operational database consolidation — 2026-11-01

Branch: `NotBhan/tope`. This pass finishes the split-store cleanup the earlier
audit found, before any public-content migration.

---

## 1. Booking split-store root cause

`createBooking()` (`src/modules/bookings/service.ts`) inserted `bookings` and its
five per-type line-item tables into **SQLite**, while
`src/core/payment/payment-service.ts` read `getBookingById()` from **Neon** and
wrote `payments`/`refunds`/`invoices` there. On Vercel SQLite lives in
`/tmp/data` and is re-seeded per instance, so:

- a booking confirmed to the customer could disappear with the lambda;
- payments refused with "Booking #N not found" for a booking that had just been
  created;
- the admin booking list and the payment screens listed different universes.

`updateBookingDepositConfig()` made it worse: it read Neon, fell back to SQLite,
then wrote the new advance to **both** inside `try/catch` blocks that only
`console.warn`-ed. A failed write was still reported to the admin as a success.

Customers had the same defect: bookings wrote `customers` to SQLite, while
`ensureCustomerForUser()` (profile pages) and the payment service used Neon.

**Fix:** Neon is now the only owner of bookings, booking items, customers and
payments. SQLite keeps no operational rows.

## 2. Booking migration

`scripts/migrate-bookings-neon.ts` (`npm run db:migrate:bookings`):

- **dry run by default**; `--apply` writes;
- reads the legacy SQLite file read-only;
- resolves customers by Neon user → phone → new row (never by SQLite id);
- skips a booking whose `access_token` already exists in Neon;
- refuses to merge two different bookings that share an id, and reports it;
- `--remap-ids` imports a colliding booking under a fresh id, keeping its access
  token (the public quotation reference) intact;
- maps the five legacy line-item tables into `booking_items`, keeping menu items
  in `metadata_json`;
- never overwrites a Neon row, and is idempotent.

Rehearsal evidence (isolated target database):

```
import #1 -> #1 29pcPnhxPSVv9TMwpGJPFiqH (7 line items)
...
Imported 5, already present 0, id conflicts 0.

# second run
skip   #1 ... — already present in Neon as #1
Imported 0, already present 5, id conflicts 0.

# with a conflicting id present
conflict #1 29pcPnhxPSVv9TMwpGJPFiqH — Neon already has booking #1; use --remap-ids
Conflict rows left untouched; nothing was overwritten.

# with --remap-ids
import #1 -> #6 29pcPnhxPSVv9TMwpGJPFiqH (7 line items)
```

Run against the current production Neon it reports 5 legacy rows, 5 id
conflicts, 0 imported, and changes nothing — the durable Neon history is left
untouched. The five SQLite rows are seeded demo data, not production bookings.

## 3. Catalogue source of truth

Decision: **the published catalogue is the single pricing source** — Cloudflare
D1 today, versioned object storage after the next migration. Reasons:

- it is what the customer sees on `/mandaps`, `/stages`, `/equipment`,
  `/catering`;
- `src/modules/bookings/pricing.ts` depends on `core/content/service`, so the
  source can move without touching booking code;
- the SQLite catalogue (`halls`, `furniture_items`, `stage_designs`, `services`)
  belongs to the retired `/halls` routes and has no relationship to public
  pages.

`priceBookingSelection()` resolves every line server-side. Requests carry ids and
quantities only. `hall` and `services` selections are rejected with an explicit
message instead of being priced from SQLite.

### Price consistency evidence

The live catalogue currently configures prices **only for catering packages**
(₹1,150 / ₹1,450 / ₹1,850 per plate). Mandaps, stages and all 24 equipment items
have `price = 0`. That is not invented data — it is the real state of the
published catalogue — so:

- `formatCataloguePrice(0)` renders "Price on request";
- the server refuses to persist a ₹0 line: "…is priced on request. Send an
  enquiry and our team will confirm the amount before booking."

Live verification against real D1 + Neon:

```
PASS  An unpriced catalogue item cannot be booked at zero
      status 400 · Royal Rajputana Carved Mandap is priced on request…
PASS  Server total matches the published catalogue — server 22200000 · expected 22200000
PASS  Booking unit price equals the catalogue price — 185000 vs 185000
PASS  Catering quantity equals the requested guest count — 120 plates
```

**Consequence for the estimator:** it can price catering today. Mandap, stage
and equipment estimates stay "Price on request" until prices are entered in
Content Studio. No prices were invented or copied from the legacy tables.

## 4. Deposit configuration

`updateBookingDepositConfig()` rewritten:

- one database, one `UPDATE bookings SET advance_amount, deposit_type,
  deposit_value`;
- no SQLite fallback and no swallowed errors — a missing row or a failed write
  throws, and `runFormAction` turns it into an error flash instead of "saved";
- the applied policy is snapshotted on the booking (`deposit_type`,
  `deposit_value`; added idempotently to the existing table), so a later policy
  change cannot rewrite an existing booking;
- a deposit may not be set below money already received;
- audit logging is best-effort but a failure is logged as an error, not hidden.

Verified: percentage 40%, fixed ₹5,000 → 500,000 paise, full → total, policies do
not leak between bookings, unknown booking throws, paid-below-deposit throws.

## 5. Test isolation

`npm test` now runs with `TEST_MODE=1`, and both clients refuse remote
connections in that mode unless `ALLOW_LIVE_DB_TESTS=1` (`src/core/db-guard.ts`).
Suites opt in with `tests/helpers/isolated-db.ts`, which creates a throwaway
per-process database.

| Suite | Before | After |
| --- | --- | --- |
| `payment.test.ts` | wrote bookings/payments to production Neon | isolated file, self-owned fixtures |
| `enquiry-receipts-deposits.test.ts` | rewrote production deposits | isolated file |
| `form-ux-receipts-scanner.test.ts` | QR lookups against production | isolated file |
| `d1-neon.test.ts` | read/wrote live D1 + Neon | live-only, skipped unless `npm run test:live` |
| `publication.test.ts` | already isolated | unchanged |
| `catalog-snapshot`, `storage`, `migration` | already isolated | unchanged |

The duplicate of the removed D1-only test was preserved as
`tests/operational-enquiry.test.ts` so enquiry storage coverage still runs by
default.

Two real fallback bugs surfaced while doing this and were fixed: the SQLite
fallback discarded `INSERT … RETURNING` rows, and it bound repeated `$n`
placeholders incorrectly (which silently NULLed later columns).

## 6. Results

- `npx astro check` — 0 errors, 0 warnings.
- `npm test` — **98 passing, 0 failing, 16 skipped** (the live suite).
- `npm run verify:e2e` — **17/17** against live Neon, including the admin
  dashboard, booking list and customer list.
- `npm run verify:booking` — **11/11** against live D1 + Neon.
- `npm run build` — clean.
- Public route smoke test: `/`, `/plan`, `/mandaps`, `/stages`, `/equipment`,
  `/gallery`, `/catering`, `/contact`, `/admin/login` → 200; `/admin` → 303 to
  login.
- No verification rows left behind: production bookings 59 (unchanged),
  booking_items 0, no verification customer.

## 7. Changed files

```
src/core/db-guard.ts                     new — test-mode database guard
src/core/operational/neon-client.ts      guard, NOW(), RETURNING, $n binding, schema
src/core/operational/service.ts          booking items, customers, stats, deposit config
src/modules/bookings/service.ts          Neon booking creation + quotation loading
src/modules/bookings/pricing.ts          new — authoritative catalogue pricing
src/modules/bookings/module.ts           async handlers
src/modules/accounts/service.ts          customers resolved from Neon
src/modules/accounts/module.ts           async customer lookups
src/modules/admin/service.ts             dashboard/bookings/customers/halls from Neon
src/modules/admin/handlers/operations.ts async handlers
src/modules/admin/pages/*.astro          awaited types
src/core/content/d1-client.ts            test-mode guard
src/core/operational/neon-schema{.ts,.sql} deposit snapshot columns
scripts/migrate-bookings-neon.ts         new — legacy booking migration
scripts/verify-booking-live.ts           new — live booking verification
tests/helpers/isolated-db.ts             new
tests/booking-consolidation.test.ts      new — 14 tests
tests/operational-enquiry.test.ts        new — isolated enquiry coverage
tests/payment.test.ts, d1-neon.test.ts,  isolation + self-owned fixtures
tests/enquiry-receipts-deposits.test.ts,
tests/form-ux-receipts-scanner.test.ts
package.json, README.md
```

## 8. Remaining risks

- **Legacy bookings have no line items.** Production Neon holds 59 bookings and
  214 payments from earlier test runs (`booking_items` is empty). The admin
  quotation page for those shows a total but no breakdown. This is pre-existing
  data, not created by this pass; do not delete without owner approval.
- **`contact_inquiries` is still split** (written to SQLite, read from SQLite by
  the admin). Not booking-related, not addressed here.
- **The legacy `/halls` catalogue still exists in SQLite.** Its routes redirect
  and `bookedDatesByHall()` reads tables that will stay empty. Dead code, left in
  place deliberately.
- **`ensureBookingDepositColumns()` runs a DDL on first operational write.** It
  is idempotent and fast on Postgres, but it is DDL at runtime; a formal
  migration in the deploy pipeline would be cleaner.
- **Catalogue prices are mostly unset.** Until mandaps, stages and equipment have
  prices in Content Studio, estimates and bookings can only cover catering.
- **`npm run test:live` still writes to production** for the D1 read-only suite
  and any suite not isolated; it is intentionally opt-in and should be treated as
  a production action.
