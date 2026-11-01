# D1 dependency inventory — 2026-11-01

Every place the application depends on Cloudflare D1, what kind of data it holds,
and where it should live after the content migration. D1 stays fully operational
until the replacement has passed parity checks; nothing here was changed.

---

## 1. Where D1 is touched

| Entry point | Role |
| --- | --- |
| `src/core/content/d1-client.ts` | The only D1 transport (HTTP API in production, local SQLite for dev/test) |
| `src/core/content/service.ts` | Public read API for every page (settings, pages, SEO, catalogue, videos) |
| `src/core/content/catalog-store.ts` | Gallery and catering reads **and admin writes** |
| `src/core/content/snapshot-builder.ts` | 21 batched statements → build-time snapshot |
| `scripts/sync-content.ts` | Runs the snapshot at build time (`build:vercel`) |
| `src/modules/admin/service.ts` | Site settings, SEO rows, page content, mandap locations, video preview CRUD |
| `src/modules/admin/handlers/catalog.ts` | Content Studio save actions → D1 writes |
| `scripts/migrate-*.ts` | One-off seed/migration helpers (not part of the request path) |
| `tests/d1-neon.test.ts` | Live integration suite (opt-in) |
| Env | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, `CLOUDFLARE_API_TOKEN` |

There are **no scheduled tasks, queues or cron jobs** reading D1.

---

## 2. Dependency table

Data type key: **Page** = simple public page text/SEO · **Brand** = site identity
and contact details · **Catalogue** = structured, priced, relational product data
· **Media meta** = records describing media.

| Dependency (D1 table) | Data type | Used by | Current consumer | Target source | Migration required? | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `page_content` (6 keys: home, mandaps, stages, equipment, gallery, catering) | Page | all public page heroes, admin page editor | `service.getPageContent`, `admin.savePageContent` | **Filebase JSON** | Yes | Low — flat rows, explicit field allowlist |
| `seo_settings` | Page | `<head>` metadata per page | `service.getSeoSettings`, `admin.saveSeo` | **Filebase JSON** (folded into page documents) | Yes | Medium — canonical URLs and robots must be preserved exactly |
| `homepage_sections` (hero, features, steps, promo_banner) | Page | homepage sections | `service.getHomepageContent` | **Filebase JSON** | Yes | Low |
| `site_settings` (single row) | Brand + default SEO | header, footer, contact card, JSON-LD, enquiry receipts | `service.getSiteSettings` | **Filebase JSON** | Yes | Medium — it is read on nearly every page and by the receipt service |
| `services` (public service tiles) | Page | homepage/feature tiles | `service.getServices` | **Filebase JSON** | Yes | Low |
| `video_previews` | Media meta | homepage + gallery video facades | `service.getVideoPreviews`, admin CRUD | **Filebase JSON** (or keep in D1) | Optional | Low — small table, simple rows |
| `mandaps`, `mandap_gallery` | Catalogue (priced) | `/mandaps`, detail pages, **booking pricing** | `service.getMandaps`, admin location edits | **Keep in D1** for now | No | High if moved — pricing authority |
| `stages`, `stage_gallery` | Catalogue (priced) | `/stages`, detail pages, **booking pricing** | `service.getStages` | **Keep in D1** | No | High |
| `furniture_categories`, `furniture_items` | Catalogue (priced) | `/equipment`, **booking pricing** | `service.getFurnitureItems` | **Keep in D1** | No | High |
| `catering_packages`, `catering_features`, `banner_features`, `guest_pricing`, `menu_sections`, `menu_categories`, `menu_items` | Catalogue (priced, relational) | `/catering`, detail page, **booking pricing** | `service.getCateringPackages`, `catalog-store` | **Keep in D1** | No | High — menu hierarchy and guest-price tiers are relational |
| `gallery_categories`, `gallery_items` | Catalogue (media index) | `/gallery`, homepage strip | `service.getGalleryCatalog`, `catalog-store` | **Keep in D1** for now | No | Medium — admin CRUD already writes here |
| `site_settings.tagline` | Brand | footer `<small>` | `service.getSiteSettings` | **Filebase JSON** | Yes (with page content) | Low, but see §4 |

Build/runtime consumers of the same data:

| Consumer | Depends on |
| --- | --- |
| `scripts/sync-content.ts` + `content-snapshot/*.json` | all of the above, 21 SQL statements in one batch |
| `import.meta.glob` snapshot in `src/core/content/snapshot.ts` | the generated JSON files |
| Prerendered `/mandaps/:slug`, `/stages/:slug`, legal pages | the snapshot at build time |
| `src/modules/bookings/pricing.ts` | `core/content/service` catalogue reads (prices) |
| `src/core/operational/enquiry-receipt-service.ts` | `getSiteSettings` for the receipt header |

---

## 3. What can move to Filebase, and what should not

**Can move (simple, flat, no relations):**

- `page_content`, `seo_settings`, `homepage_sections`, `services`,
  `site_settings`, and optionally `video_previews`.

These are what the brief describes: titles, meta, canonical URLs, headings,
subheadings, page-level text, small configuration values. They are read by
`core/content/service` behind a small number of well-typed functions, so the
storage swap is contained.

**Should stay in a structured store (D1) for now:**

- `mandaps`, `stages`, `furniture_*`, `catering_*`, `gallery_*`.

Reasons:

1. They are **priced** and are the authority for quotations
   (`src/modules/bookings/pricing.ts`). Moving them without a parity guarantee
   would risk mispricing real bookings.
2. They are **relational**: gallery images per item, menu sections → categories →
   items, guest-price tiers. Flattening them into JSON would either duplicate
   data or invent a schema the admin tooling does not have.
3. The Content Studio already edits gallery and catering rows through
   `catalog-store.ts` with writes; a JSON store would need a full publishing
   pipeline for catalogue changes too.

The brief explicitly allows this split ("Catalogue data may have different
requirements from simple page text").

---

## 4. The seeded footer value

Reported value: `Premier Test Wedding Decorators - 1793451852977`.

| Question | Finding |
| --- | --- |
| Where does it originate? | `site_settings.tagline` in **D1**, not in the repository (no such string exists in `src/` or `scripts/`) |
| Current live value | `"Premier Test Wedding Decorators - 1793530800710"` (the numeric suffix changes per seed run) |
| Visible in production? | **Yes** — `src/components/Footer.astro` renders `settings?.tagline` under the brand name, and `BaseLayout`/contact card use the same settings |
| Is it a bug? | Yes — a seed placeholder was written to production content |
| Correct copy established in the repo? | Yes: `src/core/config.ts` → `tagline: 'Wedding Mandap, Stage Designs, Furniture & Event Equipment Planning'` |
| Action taken | **None.** Modifying production D1 content is out of scope for this task |

**Proposed correction (requires approval):**

1. Content Studio → Brand tab → set the tagline to the established copy above.
2. Publish (this currently triggers a Vercel rebuild).
3. Verify the footer on the deployed site.

Until then the placeholder remains visible. This is a content-data fix, not a
code defect — but it is also evidence that D1 has been written by seed scripts
without a review step, which the new publishing workflow should prevent.

---

## 5. Migration blockers for the next phase

| Blocker | Detail |
| --- | --- |
| Snapshot parity | The build-time snapshot must produce byte-equivalent public HTML before D1 reads are removed, including canonical URLs and robots directives |
| `getSiteSettings` blast radius | Used by every layout and by the enquiry receipt service; a storage change reaches nearly every page |
| Admin write paths | Content Studio writes page content/SEO to D1 today; the new store needs an authorised server-side write API first |
| Catalogue stays in D1 | The content service will read page content from Filebase and catalogue from D1 during the transition; both paths must stay typed and cached correctly |
| Publishing | Publishing must move from "trigger a full rebuild" to the new flow only after the manifest is proven safe |
| Rollback | Requires immutable versions plus a pointer the server can switch atomically (see the architecture document) |
| D1 retirement | Not possible in the next phase: catalogue, gallery and video data still live there |
