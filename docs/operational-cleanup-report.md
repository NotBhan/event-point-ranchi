# Operational cleanup report — 2026-11-01

Branch `NotBhan/tope`, starting from commit `2b860cf`. This pass closes the
remaining operational risks before any public-content migration. It is an audit
plus targeted fixes; nothing was deployed and no production records were
modified.

---

## 1. Legacy bookings

### What was inspected

All 59 rows in Neon `bookings`, plus every plausible recovery source.

| Measure | Value |
| --- | --- |
| Bookings inspected | **59** |
| With `booking_items` | **0** |
| Without `booking_items` | **59** |
| Created between | 2026-10-25 19:06 UTC and 2026-11-01 11:00 UTC |
| Distinct totals | 6 |
| Distinct customers | 5 |
| Payments referencing them | 214 |

### Are they legacy records, or is a newer booking missing items?

They are **all legacy artefacts of the pre-consolidation code**, and none is a
regression from the current code:

- ids **6–59** (54 rows) are identical ₹1,00,000 bookings with 24-character
  base64url tokens. That shape and the three-payments-per-row pattern match
  `payment.test.ts` calling `createBooking()` in
  `src/core/operational/service.ts` — i.e. automated test fixtures.
- ids **1–5** carry varied totals and the five seeded demo customer names. Their
  totals do not match the seeded SQLite bookings (₹13,81,250 vs ₹13,11,250), so
  they were created by an earlier seeding/migration run, not migrated from the
  current SQLite file.
- Nothing created after commit `2b860cf` lacks items: the consolidated
  `createBooking()` writes `bookings` and `booking_items` in one transaction, and
  `npm run verify:booking` proves it (booking created with its line item, then
  removed).

### Can the breakdown be recovered?

**No.** Every candidate source was checked:

| Source | Finding |
| --- | --- |
| Local `data/event-point.db` | 5 bookings **with** full line items — but different tokens and different totals from the Neon rows; they cannot reconstruct Neon ids 1–5 |
| `data/event-point-d1.db` | catalogue content only, no bookings |
| `data/event-point-neon-fallback.db` | empty |
| `audit_logs` (40 rows) | only `BOOKING_DEPOSIT_CONFIGURED`; no line-item data |
| `invoices`, `payment_receipts` | 0 rows |
| `data/` backups, `migration-manifest.json` | storage migration manifest only |

### Recommend treatment (no data correction)

| Decision | Detail |
| --- | --- |
| Fabricate line items? | **No.** Prices and quantities are unrecoverable; inventing them would create a false historical quotation. |
| Modify the 59 rows? | **No.** They are untouched. |
| Delete them? | **No.** Out of scope and requires owner approval. |
| Presentation | Mark the quotation as a legacy record: keep the original total, state that the item-level breakdown predates the current system and is unavailable, and offer the contact channel. |
| Implemented | Yes — `QuotationData.isLegacy` / `legacyReason` in `src/modules/bookings/service.ts`, rendered as a banner on `QuotationPage.astro`. It reads data only; no record is modified. |

`isLegacy` is derived (`lines.length === 0 && total_amount > 0`) rather than
stored, so it needs no migration and becomes false automatically if items are
ever backfilled.

**Data correction necessary?** No. The records are internally consistent
(`amount_paid + outstanding_balance = total_amount`); only the item breakdown is
missing, and it is unrecoverable.

---

## 2. Runtime DDL moved into versioned migrations

### Findings

Two runtime schema modifications were found on the operational (Neon) path:

| Location | What it did |
| --- | --- |
| `ensureBookingDepositColumns()` (`core/operational/service.ts`) | `ALTER TABLE bookings ADD COLUMN deposit_type / deposit_value` on the first booking write |
| `ensurePublicationsTable()` (`core/operational/publication-service.ts`) | `CREATE TABLE content_publications` on the first Content Studio read |

The SQLite DDL in `core/db.ts`, `core/storage/schema.ts` and
`initSqliteFallbackSchema()` is local-only and was left alone.

### Action

- New `src/core/operational/migrations.ts`: ordered, idempotent migrations
  recorded in a `schema_migrations` table, dialect-aware (PostgreSQL and the
  SQLite fallback).
  - `001_booking_deposit_snapshot` — deposit columns + index.
  - `002_content_publications` — ledger table + index.
- New `scripts/migrate-schema-neon.ts` (`npm run db:migrate:schema`): reports
  applied/pending by default, `--apply` to run, prints the masked target host,
  refuses to touch a live database during a test run.
- Both former `ensure*` functions are now **read-only assertions**
  (`assertBookingDepositColumns`, `assertPublicationsTable`). They run one
  `SELECT … LIMIT 0`, memoised per process, and fail with "run
  `npm run db:migrate:schema`" if the schema is behind.
- Normal requests therefore need **no DDL privileges**.

### Deployment order

1. `npm run db:migrate:schema` (status) — confirm what is pending.
2. `npm run db:migrate:schema -- --apply` against the target database.
3. Deploy the application build that expects the new schema.

Running the migration before the deploy is required; running it again after is
harmless (both the ledger and the individual migrations are idempotent).

### Verification

`tests/schema-migrations.test.ts` (7 tests): ids unique/ordered, status reports
pending, apply creates the columns and ledger, second run applies nothing,
recorded migrations are not re-executed, dialect detection, and a missing schema
produces the actionable error. All pass.

Production note: migration 001 and 002 were already applied to the live database
as a side effect of the previous release, so `--apply` is expected to report
"schema already up to date". Nothing was executed against production in this
task.

---

## 3. Contact inquiries

### Findings

| Question | Answer |
| --- | --- |
| Where created? | `src/modules/contact/service.ts` — `INSERT INTO contact_inquiries` into **SQLite** |
| Where listed? | `src/modules/admin/service.ts` → `listInquiries()` reading SQLite |
| Where updated/deleted? | `updateInquiryStatus()` / `deleteInquiry()` on SQLite |
| Do admins rely on them? | Yes — `/admin/inquiries` list, status workflow, delete, and the dashboard's "new inquiries" count |
| Does customer follow-up depend on them? | Yes — the confirmation promises a call within one working day |
| Is SQLite persistent on Vercel? | **No.** `/tmp/data`, re-seeded per instance |
| Any API assuming local SQLite? | Only the admin pages; no public JSON API |

The same commit that consolidated enquiries and bookings left this one on the
ephemeral store: the visitor is thanked, the row disappears with the lambda, and
the admin never sees it. This is the same defect class as the two earlier
milestones, so migration was required rather than optional.

### Action

- `createContactInquiry()` in `core/operational/service.ts` — Neon insert,
  returns only after it commits.
- Contact form awaits it; on failure it shows "could not save your message" and
  does **not** claim success.
- Admin list / status / delete and the dashboard count now read Neon
  (`countContactInquiries`, `listContactInquiriesPage`,
  `updateContactInquiryStatus`, `deleteContactInquiry`); unknown ids throw
  instead of silently doing nothing.
- `scripts/migrate-contact-inquiries-neon.ts`
  (`npm run db:migrate:inquiries`): dry run by default, read-only source,
  dedupe on (phone, email, created_at, message), keeps the original id when free,
  never overwrites.

Local development is unchanged: with no `DATABASE_URL` the operational client
falls back to the same SQLite file as before.

### Tests

`tests/contact-inquiries.test.ts` (5 tests): committed creation and read-back,
no SQLite write, status filtering + pagination, admin status change with explicit
errors for invalid/unknown ids, and delete with explicit error on a second
delete. All pass.

---

## 4. Deposit configuration verification

Re-verified against commit `2b860cf`:

| Guarantee | Status | Evidence |
| --- | --- | --- |
| One authoritative database | Yes | Only `UPDATE bookings` in Neon; the SQLite branch is gone |
| No dual-write | Yes | `updateBookingDepositConfig()` performs a single statement |
| No swallowed errors | Yes | Missing row, failed update and below-paid values all throw; audit-log failure is logged as an error, not hidden |
| Historical bookings keep their snapshot | Yes | `deposit_type` / `deposit_value` are columns on the booking; a policy change writes only that booking |
| New policy affects new bookings only | Yes | No global policy exists; `DEFAULT_DEPOSIT_PERCENT` is only read at creation |
| Deposit cannot fall below money received | Yes | Explicit guard, covered by a test |
| Payment calculations use the stored snapshot | Yes | `initiateBookingPayment()` reads `advance_amount` from the booking row |

No code change was needed. Coverage already exists in
`tests/booking-consolidation.test.ts` (percentage/fixed/full, isolation between
bookings, below-paid rejection, unknown booking) and `tests/payment.test.ts`
(advance/partial/balance lifecycle against the snapshot).

---

## 5. Test isolation verification

| Requirement | Result |
| --- | --- |
| Complete suite runs | `npm test` → 126 tests, **110 pass, 0 fail, 16 skipped** |
| Cannot write to production by default | `TEST_MODE=1`; both clients throw unless an isolated path is configured (`core/db-guard.ts`) |
| Missing configuration fails safely | Yes — the clients throw; they do not fall back to production |
| Isolated per process/run | `tests/helpers/isolated-db.ts` creates a `mkdtemp` directory per test process |
| Cleanup runs even on failure | `after(cleanupIsolatedDatabases)` is registered per file; temp dirs are also outside the repo |
| Skipped tests reviewed | 16 skipped = the D1/Neon live integration suite, opted in via `npm run test:live` |
| Live tests require opt-in + identify the target | `ALLOW_LIVE_DB_TESTS=1` only; the suite name says "live", and the migration CLI prints the masked target host |
| Production credentials never silently selected | The guard runs before any remote client is created |

Suites inspected: `publication.test.ts` (isolated `NeonOperationalClient` per
test), `payment.test.ts` (isolated + self-owned fixtures),
`enquiry-receipts-deposits.test.ts`, `form-ux-receipts-scanner.test.ts`,
`booking-consolidation.test.ts`, `contact-inquiries.test.ts`, `d1-neon.test.ts`
(live-gated), `storage.test.ts` and `catalog-snapshot.test.ts` (already isolated
with `DATA_DIR` + `D1_LOCAL`).

Residual: `npm run test:live` still points at whatever `.env` contains and
should be treated as a production action.

---

## 6. Files changed in this pass

```
src/core/operational/migrations.ts                    new — versioned migrations
scripts/migrate-schema-neon.ts                        new — migration CLI
scripts/migrate-contact-inquiries-neon.ts             new — legacy inquiry import
scripts/probe-filebase.ts                             new — Filebase capability probe
src/core/operational/service.ts                       contact inquiries on Neon; assertion instead of DDL
src/core/operational/publication-service.ts           assertion instead of DDL
src/modules/contact/service.ts                        durable inquiry write
src/modules/admin/service.ts                          inquiries from Neon
src/modules/admin/handlers/operations.ts              async inquiry handlers
src/modules/admin/pages/InquiriesPage.astro           awaited types
src/modules/bookings/service.ts                       legacy quotation flag
src/modules/bookings/pages/QuotationPage.astro        legacy notice
tests/schema-migrations.test.ts                       new — 7 tests
tests/contact-inquiries.test.ts                       new — 5 tests
tests/publication.test.ts                             renamed helper
scripts/migrate-publications-neon.ts                  renamed helper
package.json                                          db:migrate:schema, db:migrate:inquiries, db:migrate:bookings, probe:filebase
```

---

## 7. Test evidence

```
npx astro check     → 0 errors, 0 warnings
npm test            → 126 tests, 110 pass, 0 fail, 16 skipped
npm run build       → success
```

(Exact numbers are re-run and reported again at the end of the task.)

---

## 8. Remaining risks

- The 59 legacy bookings remain without line items. They now render an explicit
  "legacy record" notice instead of an empty breakdown. Whether they represent
  real business or test data is an owner decision; nothing was deleted.
- `contact_inquiries` rows that accumulated in the discarded `/tmp` SQLite files
  on Vercel are gone. Only rows in a local `data/event-point.db` can be imported
  with the new script.
- `scripts/migrate-contact-inquiries-neon.ts` has not been run against production
  (it requires explicit approval). It was rehearsed only against an isolated
  database.
- The dashboard still reads halls, catering counts and page content from other
  stores; those are content concerns, not operational records.

---

## 9. Catalogue pricing verification

Checked against the live catalogue (read-only) and the current code.

| # | Requirement | Result |
| --- | --- | --- |
| 1 | Public pages use the published catalogue | **Yes** — every catalogue page reads `core/content/service`, which reads D1 (or the build snapshot) |
| 2 | Booking calculations use the same source | **Yes** — `modules/bookings/pricing.ts` imports the same functions |
| 3 | No old SQLite price fallback | **Yes** — the only SQLite prices left are in `halls`/legacy tables used by the redirected `/halls` routes |
| 4 | Client-supplied price cannot influence the quotation | **Yes** — covered by "client-supplied prices are ignored" and the live booking verification |
| 5 | Zero-priced items cannot enter a quotation as free | **Yes** — `requireConfiguredPrice()` rejects the line before the transaction |
| 6 | Minimum quantities enforced server-side | **Yes** — `min_quantity` checked in `priceBookingSelection()` |
| 7 | Invalid/unpublished ids rejected | **Yes** — lookups only see `is_visible = 1` rows and throw when absent |
| 8 | UI clearly communicates "Price on request" | **No** — mandap, stage and equipment pages show **no price at all**; only catering shows one |
| 9 | Admin can enter catalogue prices | **Partially** — catering and halls have admin forms; **mandaps, stages and equipment have no price editor** |
| 10 | Price updates reach public pages and new quotations | **Would work** — both read the same functions — but only for the two editable categories |

Live catalogue state (read-only):

```
mandaps         6 rows, price_starting_paise = 0
stages          6 rows, price_starting_paise = 0
furniture_items 24 rows, price_paise = 0
catering_packages 3 rows, 115000 / 145000 / 185000 paise per plate
```

So three of the four categories have no price data, and two of them (mandaps,
stages) also have no way to be priced from the admin UI. This is a **product gap,
not a bug**: no price is invented or defaulted anywhere, and the server refuses
to book an unpriced item.

### Content Studio workflow needed to add prices (next phase)

Today the Content Studio tabs are `brand, locations, videos, seo, features,
publish, page-home, page-mandaps, page-gallery, page-catering, page-stages,
page-equipment` — page copy only. The required workflow does not exist yet:

1. Add price fields to the Content Studio for mandaps, stages and equipment
   (mirroring the existing catering form's rupee→paise conversion).
2. Save through the authenticated server action (editor/admin + CSRF already
   enforced), validating non-negative integer paise.
3. Publish, so the public pages and `priceBookingSelection()` see the new value.
4. Because prices are catalogue data, they stay in D1 in the next phase — a
   price change does not need the Filebase content pipeline.

Until that exists, the only way to set these prices is a direct D1 write, which
is not an acceptable production workflow.

