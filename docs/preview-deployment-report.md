# Preview deployment report — 2026-11-01

Status: **deployment succeeded; on-Preview verification blocked by Vercel
deployment protection.** Production is unchanged.

---

## 1. Commit and branch

| Item | Value |
| --- | --- |
| Branch | `NotBhan/tope` |
| Starting commit | `2b860cf` |
| New commit | `6ab1ae4` — `feat(content): publish page content as immutable Filebase versions` |
| Files | 50 changed, 7,991 insertions, 130 deletions |
| Remote branch after push | `NotBhan/tope` → `6ab1ae456c4b24388c9c956b8078f3f581858893` (fast-forward from `0f28954`) |

### Repository-name discrepancy

The task names `MOHAMMAD-SAIF786/event-management-system-2026`. The configured
remote — and the GitHub repository the Vercel project is linked to — is
**`NotBhan/event-point-ranchi`**. Verified through the Vercel API:

```
project      : event-point-ranchi (astro)
git link     : github NotBhan/event-point-ranchi, productionBranch=main
```

The named repository exists but is not connected to this deployment project, so a
push there could not produce a Preview of this site. The push went to the linked
repository and the feature branch only; `main` was not touched.

---

## 2. Filebase test-object cleanup

| Step | Result |
| --- | --- |
| Prefix inspected | `site-content-test/` |
| Objects found | 8 (1 manifest + 7 page documents, all `v000001`) |
| Ownership check | every key matched the documented test prefix; abort guard would have stopped otherwise |
| Deleted | 8 |
| Remaining under the test prefix | 0 |
| `site-content/` (production content) | 0 objects before and after — never activated, not touched |
| `assets/` (media) | 83 objects before and after — not touched |

The cleanup was repeated after the final parity run (8 objects re-uploaded and
removed again), leaving the bucket in the same state.

---

## 3. Build and test results (local, commit `6ab1ae4`)

| Command | Result |
| --- | --- |
| `npx astro check` | 0 errors, 0 warnings, 3 hints |
| `npm test` | 178 tests — 162 pass, 0 fail, 16 skipped (live D1 suite) |
| `npm run build` | success |
| `npm run content:parity` | **14/14 routes identical** (D1 vs Filebase, same build) |

Parity requires the test objects, so it was run with them present and cleaned up
immediately afterwards.

---

## 4. Vercel Preview

| Item | Value |
| --- | --- |
| Deployment id | `dpl_6dKAHLKJWPrMjpUdT6qXqXoedyHu` |
| URL | https://event-point-ranchi-4a5wd937y-chandrabhans-projects.vercel.app |
| Branch alias | https://event-point-ranchi-git-notbhan-tope-chandrabhans-projects.vercel.app |
| Target | **preview** (not production) |
| State | **READY** |
| Commit built | `6ab1ae4` on `NotBhan/tope` |

### Blocker: deployment protection

Both URLs answer **302** to `https://vercel.com/sso-api?...`. The project setting is:

```
ssoProtection: { deploymentType: "all_except_custom_domains" }
passwordProtection: none
```

There is no `VERCEL_AUTOMATION_BYPASS_SECRET` in the environment and the
deployment has no custom-domain alias, so an unauthenticated client cannot reach
the Preview. Disabling SSO protection or adding a bypass secret is a
project-wide security change, which this task forbids without approval.

Consequences:

| Check | Status |
| --- | --- |
| Vercel reports a successful Preview deployment | **Verified** (READY, commit matches) |
| Preview URL accessible | **Blocked** (302 to Vercel SSO) |
| Homepage and public routes render | **Blocked** |
| SEO metadata on Preview | **Blocked** |
| Booking wizard / enquiry form load | **Blocked** |
| Admin login / Content Studio load | **Blocked** |
| Content Studio shows schema-unavailable message | **Blocked** (not observable) |
| No publish/rollback offered without schema | **Blocked** (not observable) |
| No production pointer touched | **Verified** (see §6) |
| No unexpected server errors | **Blocked** |

Lighthouse against the Preview is likewise **blocked**; no Preview performance
numbers are reported rather than fabricated. The local production-build baseline
from the previous phase is unchanged by this commit (no client JS or blocking
requests were added; the new modules are server-only).

---

## 5. Preview environment configuration

Not readable without bypassing protection. Expected and recommended:

```
CONTENT_STORE=d1        # default when unset — the new read path stays off
CONTENT_FALLBACK=d1     # default when unset — D1 fallback with structured logs
```

The implementation defaults to D1 when both are absent, so the Preview runs the
unchanged content path regardless. No Preview environment variables were created,
changed or copied in this task.

---

## 6. Production safety evidence

| Check | Result |
| --- | --- |
| Production site reachable | `https://event-point-ranchi.vercel.app/` → **200** |
| Production deployment changed | **No** — the Preview is a separate target; nothing was promoted |
| `npm run db:migrate:schema -- --apply` against production | **Not run** |
| `content_pointers` / `content_releases` / `content_drafts` / `schema_migrations` in production Neon | **all absent** (read-only `to_regclass` check) |
| Production content pointer | **Does not exist — nothing activated** |
| Production D1 | **Unchanged** — read only during export dry runs |
| Production Filebase `site-content/` | **0 objects** — never written |
| Production environment variables | **Unchanged** |
| `main` branch | **Untouched** (remote `main` still at `0f28954`) |

---

## 7. What remains unverified or blocked

| Item | Status |
| --- | --- |
| Preview route rendering and SEO | **Blocked by SSO protection** |
| Preview Content Studio behaviour | **Blocked by SSO protection** |
| Preview Lighthouse (mobile/desktop) | **Blocked by SSO protection** |
| Publishing against Preview Neon | **Not possible** — migrations 003/004 are absent in the configured database |
| Filebase publishing/rollback in Preview | **Not attempted** — requires isolated Preview storage credentials |

---

## 8. Next approval milestone

To move past the blocker, one of the following is required (neither performed):

1. **Add a Vercel Protection Bypass for Automation** secret for the project and
   share the value through the environment (recommended: it is scoped and does
   not make previews public), **or**
2. Explicitly authorise disabling SSO protection for preview deployments.

After that, the next stage is:

1. Verify the Preview routes, SEO metadata and Content Studio schema-unavailable
   state through the bypass.
2. Run Lighthouse on the Preview and compare against the recorded baseline.
3. Provision **isolated** Preview Neon and Filebase credentials, apply migrations
   003/004 to the Preview database only, and exercise publish → verify → rollback
   there, including `CONTENT_FALLBACK=strict`.
4. Re-run parity against the Preview before any production activation.

Production activation remains a separate, explicitly approved milestone.
