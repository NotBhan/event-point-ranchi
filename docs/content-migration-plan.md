# Content migration plan and rehearsal results — 2026-11-01

How the D1 page content moves to immutable Filebase objects, and what happened
when it was rehearsed locally.

**No production data was read-modify-written. D1 was only read; the pointer was
moved only in an isolated database; the objects went to a test namespace.**

---

## 1. Scope

| Migrated | Not migrated |
| --- | --- |
| `page_content` (6 pages) | `mandaps`, `mandap_gallery` |
| `seo_settings` (canonical, titles, OG) | `stages`, `stage_gallery` |
| `site_settings` (brand, contact, theme) | `furniture_*` |
| `homepage_sections` | `catering_*` (menu relations, guest tiers) |
| `services` | `gallery_*` |
| | `video_previews` — deferred (evaluated, not required for page text) |

The catalogue stays in D1 and remains the booking pricing authority. Nothing in
`src/modules/bookings/pricing.ts` changed.

---

## 2. The exporter

`scripts/migrate-page-content-to-filebase.ts` (`npm run content:export`):

```
dry run (default) → read D1 → report inventory + unmapped fields → validate → print
--apply           → stage: upload immutable objects + manifest, verify, record 'verified'   (pointer untouched)
--activate        → CAS the pointer to the newest verified release
```

Safety properties:

- D1 access is read-only; the script contains no D1 write.
- Apply never changes the active pointer. Activation is a separate, explicit run.
- Re-running is safe: identical documents produce identical bytes and reuse the
  existing object; changed content is refused with a message to bump `--version`.
- `updatedAt` is derived from the source rows' `updated_at`, not from "now", which
  is what makes repeated runs byte-identical.

---

## 3. Rehearsal results (local, non-production)

Command sequence (isolated operational DB at `/tmp/ep-parity.db`, objects under
`site-content-test/`):

```
npm run db:migrate:schema -- --apply     → applied 3 migrations
npm run content:export                    → dry run
npm run content:export -- --apply         → staged release #1
npm run content:export -- --apply         → staged release #2 (objects reused)
npm run content:export -- --activate      → pointer moved in the isolated DB
```

Dry-run output:

```
D1 inventory
  page_content rows      : 6 (home, mandaps, stages, equipment, gallery, catering)
  seo_settings rows      : 8
  site_settings rows     : 1
  homepage_sections rows : 3
  services rows          : 16

Unmapped fields
  (none)

Validated 7 documents:
  site       v1 /__site     16 services, 4 homepage sections
  home       v1 /           0 sections, canonical https://eventpointranchi.com/
  mandaps    v1 /mandaps    0 sections, canonical https://eventpointranchi.com/mandaps
  stages     v1 /stages     0 sections, canonical https://eventpointranchi.com/stages
  equipment  v1 /equipment  0 sections, canonical https://eventpointranchi.com/equipment
  gallery    v1 /gallery    0 sections, canonical https://eventpointranchi.com/gallery
  catering   v1 /catering   0 sections, canonical https://eventpointranchi.com/catering
```

### Unmapped fields found during the rehearsal

| Field | Finding | Resolution |
| --- | --- | --- |
| `seo_settings.canonical_url` | Holds **absolute** URLs (`https://eventpointranchi.com/mandaps`), not paths | Schema accepts a path **or** an absolute URL whose pathname equals the route; the value is preserved verbatim. The exporter blocks if a canonical points at a different route. |
| `site_settings.social_links_json` | Real profile URLs are placeholders (`#`) | `#` is accepted and preserved; no destination is invented. |

Nothing was silently dropped: the exporter aborts on any unclassified column with
a non-empty value.

### Object layout produced

```
site-content-test/pages/{site,home,mandaps,stages,equipment,gallery,catering}/v000001.json
site-content-test/manifests/<siteVersion>.json
```

8 objects for 7 documents + 1 manifest. All verified by read-back SHA-256.

---

## 4. Activation (production procedure, not executed)

```
1. npm run db:migrate:schema                # status: confirm 003 is pending
2. npm run db:migrate:schema -- --apply     # create pointer + releases tables (production)
3. npm run content:export                    # dry run against production D1
4. npm run content:export -- --apply         # upload immutable objects (default prefix)
5. npm run content:export -- --activate      # move the pointer (production)
```

Step 3 must show zero blocking findings. Step 4 changes no user-visible state.
Step 5 is the first step that can change what the site serves — and only when
`CONTENT_STORE=filebase` is also set in Vercel.

Per the task rules, steps 2, 4 and 5 were **not** executed against production.

---

## 5. Footer placeholder

Production D1 `site_settings.tagline` currently reads
`Premier Test Wedding Decorators - 1793530800710` and is rendered by
`Footer.astro`. The approved copy already in the repository is
`src/core/config.ts → tagline: 'Wedding Mandap, Stage Designs, Furniture & Event
Equipment Planning'`.

The migration copies the D1 value verbatim (it does not invent copy), so the
placeholder would be preserved. To correct it:

1. Fix the tagline in D1 (Content Studio → Brand) **or** in the new document
   before the production publish.
2. Re-run the export with `--version 2` so a new immutable object is created.
3. Confirm the footer in the parity report before activating.

This is called out as a manual decision because choosing production copy is not a
technical decision. No repository value was written into D1.

---

## 6. Rollback of the migration itself

| Stage | How to undo |
| --- | --- |
| Objects uploaded, pointer not moved | Nothing to undo; the objects are unreferenced. Delete `site-content/` if desired. |
| Pointer moved, flag off | The site still reads D1; move the pointer back or leave it. |
| Pointer moved, flag on | `rollback_object_store` in Content Studio, or set `CONTENT_STORE` back to unset — D1 is untouched and still current. |
| D1 retirement | Not in scope. D1 keeps the catalogue permanently. |

D1 data is never modified by any step, so the fallback is always available.
