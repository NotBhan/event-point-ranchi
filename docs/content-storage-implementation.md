# Content storage implementation — 2026-11-01

What was actually built for Phase B. Every statement here is backed by code in
this branch or by a test/run recorded in `docs/content-parity-report.md`.

---

## 1. Architecture

```
Astro SSR (Vercel)
   │
   ├── core/content/service.ts ──┬─ CONTENT_STORE=filebase → core/content-storage/read.ts
   │                             └─ otherwise → D1 / bundled snapshot (unchanged)
   │
   ├── Filebase (immutable)          Neon PostgreSQL (mutable pointer)
   │     site-content/pages/…           content_pointers  (one row, CAS)
   │     site-content/manifests/…       content_releases  (history)
   │
   └── Cloudflare D1 (unchanged): catalogue, gallery, catering, booking prices
```

The feature flag `CONTENT_STORE=filebase` switches only the four simple-content
readers (`getPageContent`, `getSeoSettings`, `getSiteSettings`,
`getHomepageContent`, `getServices`). Anything else — catalogue, gallery, catering,
bookings, payments, enquiries — is untouched.

---

## 2. Neon schema and migration

Migration `003_content_releases` (in `src/core/operational/migrations.ts`,
applied by `npm run db:migrate:schema`):

```sql
content_pointers(id PK, site_version, manifest_key, manifest_sha256,
                 publication_id, updated_at, updated_by)          -- one row: 'active'
content_releases(id PK, site_version UNIQUE, status, expected_version,
                 manifest_key, manifest_sha256, pages_json,
                 published_by, published_by_name, error,
                 created_at, updated_at, completed_at, rolled_back_to)
indexes: (status), (created_at DESC)
```

- The migration also seeds the pointer row with an **empty** `site_version`,
  which is what makes "nothing published from object storage" a first-class
  state and keeps D1 authoritative until activation.
- Statuses: `pending → uploading → verified → published`, plus `failed`,
  `conflicted`, `rolled_back`. Enforced by a CHECK constraint and by the service.
- No runtime DDL. `assertContentSchema()` is a memoised read-only probe that
  fails with "run `npm run db:migrate:schema`".

---

## 3. Filebase object layout

```
site-content/
  pages/site/v000001.json        ← brand, contact, theme, homepage sections, services
  pages/home/v000001.json
  pages/mandaps/v000001.json
  pages/stages/v000001.json
  pages/equipment/v000001.json
  pages/gallery/v000001.json
  pages/catering/v000001.json
  manifests/<siteVersion>.json
```

- Keys are derived from the approved page-id list and an integer version. The
  only configurable part is `CONTENT_PREFIX`, which is validated (`[A-Za-z0-9._/-]`,
  no `..`, no leading `/`) — used for the test namespace.
- Content type is `application/json; charset=utf-8`; each object carries
  `sha256`, `pageId`, `contentVersion` and `siteVersion` metadata.
- **There is no overwrite operation.** `putImmutable()` HEADs the key first: same
  bytes → reuse; different bytes → hard error naming the version bump.
- SHA-256 is computed locally and verified by reading the object back. The MD5
  ETag is never used as an integrity check.

`siteVersion` format: `2026-11-01T12-37-41-131Z-128359` (ISO with `:`/`.` replaced,
plus a random suffix). Sortable and collision-resistant.

---

## 4. Publication workflow

`publishContent()` = `stageContent()` + `activateRelease()`.

1. Validate the whole set (`validatePublicationDocuments`): every page id present,
   unique paths, canonical resolves to the route, text limits, no angle brackets.
2. Read the active pointer; if it no longer matches the editor's expected version,
   abort **before uploading**.
3. Record a `pending` release, then mark `uploading`.
4. Upload every page object.
5. Read each object back and compare SHA-256.
6. Build and upload the immutable manifest.
7. Verify the manifest checksum, re-read it, validate it, and re-verify every
   object it references.
8. Mark the release `verified`.
9. Compare-and-swap the pointer
   (`UPDATE … WHERE id='active' AND site_version = $expected`).
10. Mark `published`.

A partial upload never becomes visible: nothing reads a version until the pointer
moves.

---

## 5. Concurrency protection

The only mutable fact is the pointer. It is moved with a single conditional
UPDATE, and the code requires **exactly one row** to be affected:

```sql
UPDATE content_pointers
   SET site_version = $1, manifest_key = $2, manifest_sha256 = $3,
       publication_id = $4, updated_at = NOW(), updated_by = $5
 WHERE id = 'active' AND site_version = $6
```

- 0 rows → someone else published first → `PublicationError('conflict')`, the
  release is marked `conflicted`, the active version is untouched.
- There is no SELECT-then-UPDATE race: the check is in the WHERE clause.
- Verified by `tests/content-publication.test.ts` → "a concurrent publisher
  conflicts instead of overwriting the newer version".

This is the reason the pointer is not in Filebase: the probe showed conditional
PUT is not enforced there.

---

## 6. Rollback

`rollbackContent({ targetSiteVersion, expectedVersion, actor })`:

1. Admin only; expected version must still be current.
2. The target release must exist with status `published`/`rolled_back`.
3. Its manifest is re-read and its checksum compared with the recorded one.
4. Every page object in that manifest is re-verified.
5. The pointer is CAS-moved to the target.
6. A history row with status `rolled_back` and `rolled_back_to` is written.

Page objects are never rewritten. A failed verification leaves the current
version active (tested: missing object, missing release, wrong admin, stale
expected version).

---

## 7. Read path and caching

`core/content-storage/read.ts`:

```
Neon pointer (TTL 10 s, env CONTENT_POINTER_TTL_MS)
   → manifest object (cached per siteVersion, 20 entries)
   → page object (cached per `${siteVersion}:${pageId}`, 200 entries)
   → validateContentDocument
```

- Immutable documents are cached forever for their version — no TTL needed.
- The pointer has a deliberate short TTL; a stale pointer may be reused if Neon
  is briefly unreachable (it still names a real published version).
- Every key is derived; a request cannot select an object key.
- On integrity failure the read falls back to the most recent *published* release
  (max 3 attempts) and logs loudly; it never returns a partial document.
- `resetContentReadCache()` clears everything (used by tests and after a publish).

One Filebase round trip per page version per instance (measured ~0.33 s); zero
after warm-up. No Redis, no queue.

---

## 8. Content Studio

The existing **Publish** tab now has an "Object-storage content version" panel:

- Shows the active version and manifest, or "Not published yet".
- Lists the last 8 releases with status, publisher, timestamp and any error.
- "Publish to object storage" — admin-only server action that exports the current
  content and runs the full publish sequence (CSRF via the existing middleware).
- "Roll back" per published version — admin-only, confirms first.

If migration 003 has not run, the panel renders a warning with the command to run
and no publish button. Verified against the live database (which is intentionally
un-migrated): the panel reports "Object-storage publishing is unavailable… run
`npm run db:migrate:schema`".

Editing still uses the existing D1-backed forms. Moving the editors onto the new
store is the remaining Phase 11 work (see the plan).

---

## 9. What is intentionally unchanged

- Catalogue reads and `src/modules/bookings/pricing.ts` — still D1.
- Booking prices, deposit snapshots, historical quotations.
- The existing snapshot/deploy-hook publishing flow (still present, still works).
- Public HTML rendering, routing, SEO output.

---

## 10. Test-object cleanup (Phase C)

| Step | Result |
| --- | --- |
| Prefix inspected | `site-content-test/` |
| Objects inspected | **8** — 1 manifest and 7 page documents (`v000001`) |
| Ownership check | all keys matched the documented test prefix; the script aborts if a listing returns anything else |
| Objects deleted | **8** |
| Objects remaining | **0** |
| `site-content/` before / after | **0 / 0** — production content was never activated |
| `assets/` before / after | **83 / 83** — media untouched |

The cleanup ran once at the start of the phase and again after the final parity
run (which re-uploads the same eight objects), so the bucket is back to its
pre-test state. No object outside `site-content-test/` was listed for deletion or
deleted.
