# Content architecture recommendation — 2026-11-01

Based on the measured Filebase behaviour in
`docs/filebase-compatibility-audit.md`. This document recommends a target
architecture; it does **not** implement it.

**Verdict up front: Filebase is suitable with limitations for this use case —
provided every page document is immutable and the single mutable pointer lives in
Neon PostgreSQL, which the project already operates.**

---

## 1. Why not the literal proposed design

The proposed design is: immutable page JSON in Filebase plus a mutable
`site-content/manifest.json` that is "updated last".

The probe shows the manifest cannot be updated safely:

- `If-None-Match: *` on an existing key was **accepted** and overwrote the object.
- `If-Match` with a wrong ETag **succeeded**.
- Two concurrent writes to the same key both succeeded; one silently won.
- Bucket versioning cannot be enabled (`PutBucketVersioning` unsupported,
  `GetBucketVersioning` → `unset`), so an overwritten manifest cannot be
  recovered.

A last-write-wins manifest means a publisher can finish uploading a complete,
verified version and then have it replaced by a slower publisher's older
manifest. That is a correctness failure for a site whose SEO output depends on it.

Everything else about the proposed design is sound: immutable keys, version
directories, upload-verify-then-publish, rollback by pointer.

---

## 2. Recommended storage layout

```
site-content/
  pages/
    home/v000001.json
    home/v000002.json
    about/v000001.json
    mandaps/v000003.json
    ...                          ← immutable; never rewritten
  manifests/
    2026-11-01T10-30-00Z-4f21.json   ← immutable snapshot of the whole site
    2026-11-08T09-12-44Z-a9c0.json
  backups/                       ← optional export of D1 originals
```

Neon gains one small table:

```sql
CREATE TABLE content_pointers (
  id            TEXT PRIMARY KEY,          -- always 'active'
  site_version  TEXT NOT NULL,             -- e.g. 2026-11-01T10-30-00Z-4f21
  manifest_key  TEXT NOT NULL,             -- site-content/manifests/….json
  manifest_sha256 TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by  INTEGER
);
```

One row. It is coordination metadata, not content: the page text and SEO still
live in Filebase. Neon is already required for auth, enquiries, bookings and
payments, so this introduces **no new service**.

Why not put the pointer in Filebase as well? Because there is no way to update it
atomically (see §1). Why not a queue or Redis? Not needed: a single conditional
`UPDATE` gives serialisation, and Filebase already provides the durable artifact.

---

## 3. Page document schema

```jsonc
{
  "schemaVersion": 1,
  "pageId": "home",                 // stable identifier, also the object prefix
  "path": "/",                      // validated; must match the route table
  "version": 2,                     // monotonically increasing per page
  "publishedAt": "2026-11-01T10:30:00Z",
  "siteVersion": "2026-11-01T10-30-00Z-4f21",

  "seo": {
    "title": "Wedding Mandaps in Ranchi | Event Point",
    "metaTitle": "Premium Wedding Mandaps in Ranchi",
    "metaDescription": "Explore wedding mandap designs and services.",
    "canonicalUrl": "/mandaps",     // relative, or https:// on the brand domain
    "robots": "index,follow",
    "ogTitle": "…",
    "ogDescription": "…",
    "ogImage": "/storage/assets/…"  // path only, never a binary
  },

  "content": {
    "heading": "Wedding Mandaps",
    "subheading": "Create a memorable wedding experience",
    "badge": "MANDAP COLLECTION",
    "cta": { "label": "Explore Mandaps", "url": "/mandaps" },
    "sections": [
      { "id": "intro", "heading": "…", "subheading": "…", "description": "…" }
    ],
    "chips": [{ "icon": "archway", "text": "6 signature concepts" }]
  }
}
```

Rules:

- **No HTML.** Every field is plain text rendered through Astro's escaping. This
  removes the XSS surface an HTML-in-JSON model would create.
- `pageId` and `path` are validated against a fixed allow-list of routes;
  duplicates are rejected at publish time.
- `canonicalUrl` must be either a path starting with `/` or an absolute URL on
  the configured brand host. Anything else is rejected.
- `robots` accepts only a known set (`index,follow`, `noindex,follow`,
  `index,nofollow`, `noindex,nofollow`).
- The object key is derived from `pageId` and `version`, never from user input.

### Manifest document (immutable)

```json
{
  "schemaVersion": 1,
  "siteVersion": "2026-11-01T10-30-00Z-4f21",
  "publishedAt": "2026-11-01T10:30:00Z",
  "pages": {
    "home":    { "version": 2, "object": "site-content/pages/home/v000002.json", "sha256": "…", "etag": "…" },
    "mandaps": { "version": 3, "object": "site-content/pages/mandaps/v000003.json", "sha256": "…", "etag": "…" }
  }
}
```

The manifest is a *record* of a publication, not a mutable switch. The switch is
the Neon pointer.

---

## 4. Publishing sequence

1. **Authorise** — existing admin/editor session, CSRF token (already enforced
   centrally by `src/middleware.ts`).
2. **Validate** — schema, page id ∈ allow-list, path uniqueness, SEO fields,
   canonical/robots rules.
3. **Acquire the publish lock** — a transaction that inserts/updates the
   `content_publications` ledger row (the existing table already models
   `requested → deploying → built → published/failed`); a second publisher gets
   "publication in progress" and stops.
4. **Upload page objects** — `PutObject` with `ContentType: application/json`,
   `Metadata: { siteVersion, pageId, schemaVersion }`. If an identical object
   already exists (same SHA-256 in the recording DB), reuse it.
5. **Verify uploads** — `HeadObject` each key: size, content-type, metadata and
   SHA-256 must match. A mismatch aborts the publication.
6. **Upload the manifest object** and verify it the same way.
7. **Commit the pointer** — one transaction:

   ```sql
   UPDATE content_pointers
      SET site_version = $1, manifest_key = $2, manifest_sha256 = $3,
          published_at = NOW(), published_by = $4
    WHERE id = 'active' AND site_version = $5   -- the version the publisher read
   ```

   `rowCount = 0` means somebody else published first: abort and report a
   conflict. The uploaded objects remain as unreferenced (inert) versions.
8. **Read back** — re-read the pointer and the manifest, and fetch one page
   object to prove the version is live.
9. **Invalidate** — drop the per-instance content cache immediately; other
   instances pick up the new `siteVersion` within the pointer TTL (§6).
10. **Report** — the Content Studio shows the verified site version, not just an
    HTTP 200.

A partial upload never becomes visible: nothing reads the new versions until the
pointer moves, and the pointer moves only after every object is verified.

---

## 5. Concurrency, rollback and failure behaviour

| Situation | Behaviour |
| --- | --- |
| Two publishers start together | Second fails at the ledger/lock step; no partial visibility |
| Two publishers race the pointer update | Conditional `UPDATE` lets exactly one win |
| Upload fails midway | Pointer unchanged; old content keeps serving; orphan objects are inert |
| Manifest upload fails | Pointer unchanged |
| Read-back verification fails | Pointer not updated; publication marked failed with the reason |
| Pointer update fails | Previous version remains active |
| Rollback | `UPDATE content_pointers SET site_version = <old>, manifest_key = <old manifest>` — no object is rewritten; page versions are immutable and still present |
| Rollback while a publish is running | Blocked by the same ledger lock |
| Old versions | Retained indefinitely (no lifecycle API on Filebase), so a retention policy must be an explicit deletion job with an allow-list |

---

## 6. Caching strategy

| Layer | Recommendation | Rationale |
| --- | --- | --- |
| Immutable page JSON | Cache in-process by `(pageId, version)` indefinitely; safe to also set `public, max-age=31536000, immutable` if a public bucket is ever used | The key never changes; measured read is ~330 ms, so cache misses matter |
| Manifest / pointer | Read the **pointer from Neon**, cached in-process for ~10–15 s, plus an immediate invalidation on publish | Neon query is ~5–20 ms vs ~330 ms for an S3 GET; 15 s bounds cross-instance staleness |
| Public HTML | Keep the existing 45 s anonymous page cache; add `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` for anonymous HTML only | HTML has no cache headers today (verified: only media routes set them) |
| Media | Unchanged: `public, max-age=31536000, immutable` via `/storage/[...path]` | Already correct |
| Content Studio preview | `no-store`, read the working copy — never the published pointer | Prevents draft leakage |
| Filebase edge cache | Not usable for content today: the bucket is private and private reads bypass the CDN | Verified |

---

## 7. Astro rendering approach

**Keep server-rendered HTML.** The requirement — title, meta, canonical,
headings and body text present in the initial response — is already met and must
not regress.

### Option A vs Option B

Measured inputs: Filebase GET ≈ 330–365 ms; local production build TTFB 3–6 ms;
deployed TTFB 68 ms; current content cache 5 min in-process; page cache 45 s.

| Criterion | A — build-time snapshot (today) | B — runtime reads + cache |
| --- | --- | --- |
| Initial HTML | Prerendered/inline, fastest possible | SSR; first request per instance pays 1 Filebase GET |
| Publish latency | Full Vercel rebuild (minutes) | Seconds |
| Vercel function work | Only prerendered pages at build | Per-page render, with content cached in memory |
| Filebase requests | Build-time only | One per page version per instance (plus one per pointer TTL if the manifest lived there) |
| Cache invalidation | Automatic (new deployment) | In-process + pointer version; needs a TTL |
| Failure behaviour | Build fails, previous deployment keeps serving | Old pointer keeps serving; failed publish is inert |
| Operational complexity | Deploy hook + publish ledger + snapshot script | Publisher API + pointer + cache; no rebuild |
| Rollback | Promote a previous Vercel deployment | Move the pointer |

**Recommendation: Option B**, with the pointer read from Neon and page documents
read from Filebase on version change. It removes the full-rebuild requirement
(the stated goal), keeps the failure mode "old content keeps serving", and pays
Filebase latency only once per version per instance.

Keep Option A's snapshot as the **bootstrap**: the deployment still bundles the
last published snapshot, so a cold instance can render before its first Filebase
fetch completes. That is a fallback, not the source of truth.

### ISR

The installed adapter (`@astrojs/vercel@11.0.16`) supports `isr`, `bypassToken`,
`expiration` and `exclude`, and on-demand revalidation via the
`x-prerender-revalidate` header. Nothing currently uses it.

**Recommendation: do not adopt ISR in the migration phase.**

- ISR applies to *prerendered* routes; the site is `output: 'server'`, so adopting
  it means converting public pages back to prerendered — the opposite direction
  from Option B.
- It adds a second staleness mechanism (cached HTML) on top of the pointer, which
  is exactly where stale SEO metadata would come from.
- The goal (publish without a redeploy) is achieved by Option B without it.

Revisit only if measured HTML caching shows the SSR render itself is the
bottleneck.

---

## 8. Migration stages (next phase, not started)

1. **Schema + publisher** — `content_pointers`, migration `003`, JSON schema
   validator, server-side write API, allow-listed object keys.
2. **Export + upload** — read D1 page content + SEO + brand settings, map to the
   new schema, validate every document, upload immutable versions, verify,
   commit the pointer. Keep a D1 export as a backup.
3. **Shadow read** — render with Filebase and with D1, diff the resulting HTML
   for every public route; any difference blocks the cutover.
4. **Cut over reads** — Filebase first, D1 fallback for one release.
5. **Retire D1 page reads** — after parity is proven; catalogue stays in D1.
6. **Publishing UI** — Content Studio edits the new store; the deploy-hook path
   becomes optional.

Rollback from any stage is the pointer (or, before cutover, leaving the flag off).

---

## 9. What stays where

| Responsibility | System |
| --- | --- |
| Page text, SEO, brand/site settings, homepage sections, service tiles | **Filebase immutable JSON** + Neon pointer |
| Publication ledger, lock, audit | **Neon** |
| Catalogue (mandaps, stages, equipment, catering, gallery) and prices | **Cloudflare D1** for now |
| Enquiries, bookings, payments, customers, contact inquiries | **Neon** |
| Media assets | **Filebase**, separate namespace from content |
| Rendering | **Astro SSR** on Vercel |

---

## 10. Go / no-go

**Go**, with the design above. Filebase is reliable for immutable objects and
read-back verification; it is not a coordination service. Using the operational
database for the one mutable pointer is the smallest correct mechanism and adds
no infrastructure.

**No-go** for the literal "mutable manifest object updated last" design — the
probe shows it would be last-write-wins under concurrent publishing.
