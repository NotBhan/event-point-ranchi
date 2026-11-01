# Preview environment isolation audit — 2026-11-01

Read-only inspection of the Vercel project `event-point-ranchi`
(GitHub `NotBhan/event-point-ranchi`, production branch `main`).
No secret values were retrieved, printed or stored.

**Verdict: Preview is not isolated. It currently shares production credentials
for the database, object storage, Cloudflare D1, and the application/admin
secrets. Preview application testing must not proceed until this is fixed.**

---

## 1. Method

- `GET /v9/projects/{id}` — git link, production branch, deployment protection,
  protection-bypass entries.
- `GET /v9/projects/{id}/env` — variable **names** and **targets** only; values
  were never requested in a printable form.
- `GET /v6/deployments` — deployment state and commit.
- Code consumption mapped by grepping `src/` and `scripts/`.

---

## 2. Current protection state

| Setting | Value |
| --- | --- |
| `ssoProtection` | `all_except_custom_domains` (unchanged) |
| `passwordProtection` | none |
| Protection Bypass entries | **0** |
| `VERCEL_AUTOMATION_BYPASS_SECRET` in this environment | **absent** |

---

## 3. Variable inventory and classification

Legend for **Writes**: *no* = read-only use, *yes* = the variable enables
persistent writes to an external system, *indirect* = enables an action that
writes elsewhere.

| Variable | Category | Code consumers | Preview target | Prod target | Writes | Must be isolated? |
| --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Database | `core/operational/neon-client.ts` (all operational reads/writes: users, sessions, customers, enquiries, bookings, payments, content pointer/releases/drafts) | **yes** | yes | **yes** | **Yes — highest risk.** Currently the production connection string |
| `FILEBASE_ENDPOINT` | Object storage | `core/storage/config.ts` → `filebase.ts` | **yes** | yes | **yes** (media + content objects) | **Yes** |
| `FILEBASE_REGION` | Object storage | same | **yes** | yes | no (routing) | Yes (with bucket) |
| `FILEBASE_BUCKET` | Object storage | same | **yes** | yes | **yes** | **Yes** |
| `FILEBASE_ACCESS_KEY_ID` | Object storage | same | **yes** | yes | **yes** | **Yes** |
| `FILEBASE_SECRET_ACCESS_KEY` | Object storage | same | **yes** | yes | **yes** | **Yes** |
| `FILEBASE_PUBLIC_BASE_URL` | Object storage | same | not set | not set | no | No (defaults to `/storage` proxy) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare D1 | `core/content/d1-client.ts` | **yes** | yes | **yes** | **Yes** |
| `CLOUDFLARE_DATABASE_ID` | Cloudflare D1 | same | **yes** | yes | **yes** | **Yes** |
| `CLOUDFLARE_API_TOKEN` | Cloudflare D1 | same | **yes** | yes | **yes** | **Yes** |
| `APP_SECRET` | Auth | session cookie signing (`core/auth.ts`) | **yes** | yes | indirect (session forgery across environments if shared) | **Yes** |
| `ADMIN_PASSWORD` | Admin credential | `core/db.ts` (seeds the local admin account) | **yes** | yes | indirect (admin access) | **Yes** — use a Preview-only admin |
| `EDITOR_PASSWORD` | Admin credential | `core/db.ts` | not set | not set | indirect | Recommended |
| `DATA_DIR` | Local storage | `core/db.ts`, `content/d1-client.ts` | **yes** | yes | local `/tmp` only | Low risk; isolate for hygiene |
| `CONTENT_STORE` | App config | `content-storage/read.ts` | **not set** | not set | no (selects a source) | Must be `d1` until Preview storage exists |
| `CONTENT_FALLBACK` | App config | `content-storage/observability.ts` | **not set** | not set | no | `d1` initially |
| `CONTENT_PREFIX` | App config | `content-storage/store.ts` | not set | not set | selects key namespace | Set to a Preview-only prefix when used |
| `CONTENT_SOURCE` | App config | `content/snapshot.ts` | not set | not set | no | No |
| `CONTENT_POINTER_TTL_MS` | App config | `content-storage/read.ts` | not set | not set | no | No |
| `STORAGE_DRIVER` | Object storage | `filebase.ts` | not set | not set | chooses mock vs real | Useful (`mock`) in Preview if storage must be disabled |
| `PHONEPE_MERCHANT_ID` / `_SALT_KEY` / `_SALT_INDEX` / `PHONEPE_ENV` | Payment | `core/payment/providers/phonepe.ts` | **not defined in Vercel** | not defined | **yes** (gateway calls) if configured | Keep unset in Preview. Currently unconfigured, so payments are inert |
| `PAYMENT_ENVIRONMENT` / `PAYMENT_DEFAULT_PROVIDER` | Payment | `core/payment/*` | not defined | not defined | no | Keep unset |
| `VERCEL_DEPLOY_HOOK_URL` | Deployment | `operational/publication-service.ts`, `admin/handlers/catalog.ts` | **no** | yes | **yes** (triggers a production rebuild) | **Correctly production-only** |
| `VERCEL_API_TOKEN` | Deployment | `operational/publication-service.ts` | **no** | yes | no (read) | **Correctly production-only** |
| `VERCEL_PROJECT_ID` | Deployment | same | **no** | yes | no | **Correctly production-only** |
| `VERCEL_TEAM_ID` | Deployment | same | **no** | yes | no | **Correctly production-only** |
| `PUBLISH_REPORT_URL` / `PUBLISH_REPORT_SECRET` | Webhook | `pages/api/internal/publish-report.ts`, `scripts/report-publish.ts` | **no** | yes | **yes** (posts to the live site) | **Correctly production-only** |
| `PUBLIC_SITE_URL` | App config | QR / receipt / payment receipt services | not set | not set | no | No |
| `PAGE_CACHE*`, `PERF_*`, `IMAGE_*_CACHE*` | App config | `page-cache.ts`, `perf.ts`, `image/cache.ts` | not set | not set | no | No |
| `COOKIE_SECURE`, `DISABLED_MODULES` | App config | `auth.ts`, `registry.ts` | not set | not set | no | No |
| `PUBLIC_SANITY_*`, `SANITY_*` | Legacy CMS | not imported by current code | **yes** | yes | no | Dead configuration — remove from both targets |

### Email

There is **no email integration** in the codebase (no SMTP, SendGrid, Resend or
similar variables are read anywhere). Nothing to isolate; outbound email cannot
be triggered from Preview. The customer-facing flow is phone/WhatsApp follow-up
plus downloadable receipts.

---

## 4. Findings

1. **Preview runs on the production operational database.** `DATABASE_URL` is a
   single value shared by both targets. Everything in `core/operational/*` —
   including users, sessions, bookings, enquiries, payments and the new
   `content_releases` / `content_drafts` tables — resolves to production Neon.
   Loading `/admin` on a Preview deployment therefore reads production; any
   write path (login creates a session, Content Studio saves a draft, a booking
   POST) would write production rows.

2. **Preview has write access to the production Filebase bucket.**
   `FILEBASE_*` is shared, so "isolated prefix" is a convention, not an
   enforcement boundary: the credentials can address every object, including
   `assets/` media and the (currently empty) production `site-content/`.

3. **Preview has write access to the production Cloudflare D1 database.**
   `CLOUDFLARE_*` is shared; the admin catalogue editors write there.

4. **`APP_SECRET` is shared**, so a Preview-issued session cookie is valid on
   production (and vice versa). Session payloads fingerprint the password hash,
   which limits the blast radius but does not make sharing safe.

5. **`ADMIN_PASSWORD` is shared**, so there is no Preview-only administrator.

6. Correctly scoped: deploy hooks, the Vercel API credentials and the publish
   report webhook exist only in Production. Preview cannot trigger a production
   rebuild or post a bogus publication report.

7. **Payments are unconfigured everywhere** (no `PHONEPE_*` in Vercel). Preview
   cannot initiate a real payment today, but that must not be relied on if the
   gateway is configured later.

---

## 5. Required provisioning (owner actions)

| Resource | Requirement | Why |
| --- | --- | --- |
| Neon | Separate database or branch; set `DATABASE_URL` on **preview only** | Preview must not read or write production operational data |
| Filebase | Separate bucket (preferred) or credentials restricted to a dedicated prefix; set `FILEBASE_*` on **preview only** | Content objects and media must be isolated |
| Cloudflare D1 | Separate database; set `CLOUDFLARE_*` on **preview only**. If unavailable, Preview public-page checks are *not* production-independent and need explicit read-only approval | Catalogue/content reads would otherwise hit production D1 |
| App secrets | New `APP_SECRET`; Preview-only `ADMIN_PASSWORD` (and optional `EDITOR_PASSWORD`) | No cross-environment session or admin reuse |
| Content flags | `CONTENT_STORE=d1`, `CONTENT_FALLBACK=d1` on preview for the first deployment | Keeps the new source off until storage is isolated |
| Payments | Leave `PHONEPE_*` unset, or use sandbox credentials on preview | Prevent real payment activity |
| Legacy | Remove `PUBLIC_SANITY_*` / `SANITY_*` from both targets | Dead configuration |

**Do not** copy production secrets into Preview. Each value must be generated or
provisioned for Preview.

---

## 6. Production protection status

Confirmed unchanged during this audit:

- No environment variable was created, edited or deleted.
- No deployment was created, promoted or altered.
- Production D1, Neon and Filebase were not written to.
- SSO protection remains `all_except_custom_domains`.

---

## 7. Re-verification (Phase C.3)

Read-only re-check of the live project configuration:

| Check | Result |
| --- | --- |
| Project git link | `NotBhan/event-point-ranchi`, production branch `main` |
| `ssoProtection` | `all_except_custom_domains` (unchanged) |
| Protection Bypass entries | 1 (configured; header verified separately) |
| Env definitions | 25 |
| Definitions targeting `preview` | 19 — **every one also targets `production`** |
| Preview-only overrides | **NONE** |

The shared set still includes `DATABASE_URL`, `FILEBASE_BUCKET`,
`FILEBASE_ACCESS_KEY_ID`, `FILEBASE_SECRET_ACCESS_KEY`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`,
`APP_SECRET`, `ADMIN_PASSWORD`, `DATA_DIR`.

### Cloudflare D1 identity

A read-only Cloudflare API query shows the account holds **one** D1 database:

```
d1 databases in account: 1 → event-point-ranchi
```

So the Preview target and the production site resolve the *same* D1 database.
There is no isolated Preview D1 to switch to.

### Provisioning capability available in this environment

| Credential | Present | Could provision the missing resource? |
| --- | --- | --- |
| `NEON_API_KEY` / `NEON_API_TOKEN` | **absent** | No — a Preview Neon branch/database cannot be created from here |
| `CLOUDFLARE_API_TOKEN` | present | Technically yes (new D1 database), but that is an account-level provisioning action the owner reserved |
| `FILEBASE_ACCESS_KEY_ID` | present | Technically yes (new bucket), same reservation |
| `VERCEL_API_TOKEN` | present | Yes, env vars could be written — but there are no isolated values to write |

**Status: Blocked.** No isolated resource has been provisioned; application
testing must not proceed.
