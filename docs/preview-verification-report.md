# Preview verification report — 2026-11-01

Status: **bypass unblocked and verified; application verification blocked by
missing environment isolation.**

Vercel Preview: `dpl_6dKAHLKJWPrMjpUdT6qXqXoedyHu`
https://event-point-ranchi-4a5wd937y-chandrabhans-projects.vercel.app

| Item | Status |
| --- | --- |
| Protection Bypass for Automation configured | **Verified** (1 entry, secret present in the environment) |
| Bypass header accepted | **Verified** (documented `x-vercel-protection-bypass`) |
| Deployment READY, correct commit | **Verified** |
| Preview environment isolated | **Blocked** — still shares production credentials |
| Application route verification | **Blocked** (would read production D1/Neon) |
| Content Studio verification | **Blocked** (would read and potentially write production Neon) |
| Lighthouse on Preview | **Blocked** (same reason) |
| Preview migrations / publishing / rollback | **Blocked** (no isolated Neon, D1 or Filebase) |

---

## 1. Bypass configuration

Read-only project inspection:

```
ssoProtection     : all_except_custom_domains   (unchanged — not weakened)
passwordProtection: none
protectionBypass  : 1 entry
```

`VERCEL_AUTOMATION_BYPASS_SECRET` is present in the execution environment. Its
value was never printed, written to a file, committed, or placed in a URL.

Mechanism used (Vercel's documented one, no alternatives):

```
x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET
```

Evidence, restricted to responses that require **no database**:

| Request | Without bypass | With bypass |
| --- | --- | --- |
| `GET /images/event-point-logo.svg` (static asset) | **302** → `vercel.com/sso-api` | **200**, `image/svg+xml`, 593 B |
| `GET /content-manifest.json` (prerendered) | — | **200**, 375 B, `contentVersion 1563a60653429734`, `generatedAt 2026-11-01T13:28:15Z` |

The manifest timestamp confirms the Preview was built from commit `6ab1ae4` at
13:28 UTC and re-synced content from D1 at build time (production's manifest
still reports `e07cb18220ed4122`).

---

## 2. Preview environment inventory (summary)

Full table: `docs/preview-environment-isolation.md`.

| Variable group | Preview target | Production target | Write-capable | Isolated |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **same value** | same value | yes | **no** |
| `FILEBASE_*` | **same value** | same value | yes | **no** |
| `CLOUDFLARE_*` | **same value** | same value | yes | **no** |
| `APP_SECRET` | **same value** | same value | indirect | **no** |
| `ADMIN_PASSWORD` | **same value** | same value | indirect | **no** |
| `DATA_DIR` | **same value** | same value | local only | **no** |
| `CONTENT_STORE` / `CONTENT_FALLBACK` | undefined | undefined | no (defaults to D1) | n/a |
| `VERCEL_DEPLOY_HOOK_URL`, `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | absent | present | yes (prod rebuild) | correct |
| `PUBLISH_REPORT_URL` / `_SECRET` | absent | present | yes (prod webhook) | correct |
| `PHONEPE_*` (payments) | absent | absent | would be | inert today |
| Email | no integration exists in the codebase | — | n/a | n/a |

---

## 3. Isolation evidence

The Vercel env listing returns a **single definition per variable with
`targets=preview,production`** for the database, storage, D1 and application
secrets. There is no Preview-specific override, so Preview resolves the exact
production connection string, bucket, credentials and admin account.

Consequences, and why application verification stopped:

- `GET /` on Preview renders from **production D1**.
- Signing in at `/admin/login` would query **production Neon** and create a
  session row there.
- Content Studio would read the production operational database and, if the new
  schema existed, could write drafts or move the pointer there.
- Enabling `CONTENT_STORE=filebase` would address the **production bucket**.

The project brief requires explicit owner approval before read-only production
D1 access; that approval has not been given, so no application page was fetched.

---

## 4. What was verified vs blocked

**Verified**
- Bypass secret is configured and accepted by the documented header.
- SSO protection remains enabled; nothing made public.
- Preview deployment is `READY` on commit `6ab1ae4`, target `preview`.
- Prerendered content endpoint serves the Preview build's manifest.

**Blocked (not guessed, not worked around)**
- Homepage, catalogue, contact, plan, admin and Content Studio responses.
- SEO/canonical checks on Preview.
- Mobile/desktop layout checks.
- Lighthouse (mobile homepage/desktop homepage/mandaps/second page).
- Content Studio schema-unavailable state.
- Preview Neon migrations 003/004, content export, publication, rollback and
  strict-fallback testing.

---

## 5. Required to unblock

1. **Isolated Preview Neon** — a separate database/branch, set as `DATABASE_URL`
   on the `preview` target only.
2. **Isolated Preview Cloudflare D1** — set `CLOUDFLARE_*` on `preview` only.
   If this is not possible, an explicit written approval to perform *read-only*
   Preview page checks against production D1 (no logins, no writes).
3. **Isolated Preview Filebase** — separate bucket or credentials restricted to a
   Preview prefix, set on `preview` only.
4. **Preview-only secrets** — new `APP_SECRET`, Preview-specific `ADMIN_PASSWORD`
   (and `EDITOR_PASSWORD`). Do not copy production values.
5. `CONTENT_STORE=d1`, `CONTENT_FALLBACK=d1` on `preview` for the first
   verification deployment.

After (1)–(4), a new deployment is required (env changes only apply to new
builds), then this report can be completed with real route and Lighthouse
numbers.

---

## 6. Production protection

- No production environment variable was read for its value, created, edited or
  deleted.
- No deployment was created, promoted or altered; production still serves its
  previous build (`content-manifest` `e07cb18220ed4122`, generated 2026-10-31).
- No production migration, D1 write, Filebase write or pointer change.
- SSO protection unchanged.

---

## 7. Git status

Branch `NotBhan/tope`, HEAD `6ab1ae4` (pushed). Working tree:

```
 M docs/content-storage-implementation.md      (test-object cleanup appendix)
?? docs/preview-deployment-report.md
?? docs/preview-environment-isolation.md
?? docs/preview-verification-report.md
 M src/components/skeletons/SkeletonGalleryItem.astro   (pre-existing, excluded)
 M src/modules/gallery/gallery.css                      (pre-existing, excluded)
 M src/modules/gallery/pages/GalleryPage.astro          (pre-existing, excluded)
 M src/styles/cards.css                                 (pre-existing, excluded)
```

No commit was made in this phase. `.env` remains untracked and holds the bypass
secret — it is gitignored and was never printed or staged.

---

## 8. Re-verification (Phase C.3)

| Item | Status |
| --- | --- |
| Protection Bypass | **Verified** (1 entry; `x-vercel-protection-bypass` accepted) |
| Preview env overrides | **Blocked** — 19 preview-targeted definitions, all shared with production; zero preview-only overrides |
| Preview D1 | **Blocked** — the Cloudflare account contains a single database (`event-point-ranchi`) |
| Preview Neon | **Blocked** — no Neon provisioning credential available here |
| Preview Filebase | **Blocked** — shared bucket/credentials |
| Preview secrets | **Blocked** — `APP_SECRET` and `ADMIN_PASSWORD` still shared |
| Redeploy with isolated config | **Not performed** — nothing to deploy with |
| Route / admin / Lighthouse verification | **Blocked** |

No resource was created, no environment variable was written, no deployment was
made. Production remains untouched.
