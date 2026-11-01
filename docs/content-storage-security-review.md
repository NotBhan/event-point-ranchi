# Content storage security review — 2026-11-01

Review of the new content path. Each item states what was checked and the code
that enforces it.

---

## 1. Credentials

| Check | Result |
| --- | --- |
| Filebase keys reachable from the browser | **No.** `FILEBASE_*` are server-only, not `PUBLIC_`-prefixed, and appear in no Astro component or client script |
| Keys logged or returned in errors | **No.** The probe and migration print the endpoint/bucket only; the migration CLI prints a masked DB host |
| `.env` committed | **No** — untracked; `.gitignore` covers it |
| Content store uses a separate credential path | Same server-side client as media; no new secret, no new exposure |

## 2. Authorisation on writes

| Operation | Guard |
| --- | --- |
| Publish to object storage | `requireEditor` on the Content Studio route **plus** an explicit `ctx.auth.isAdmin` check inside `publishObjectStoreAction` |
| Roll back | `ctx.auth.isAdmin` inside `rollbackObjectStoreAction`; `rollbackContent()` also refuses when `actor.isAdmin` is false (defence in depth) |
| View the publish tab | Admin only (`tab === 'publish' && !ctx.auth.isAdmin` redirects) |
| CLI export/apply/activate | Server-side script; requires shell access and a configured database URL. Exporter refuses to migrate into the local fallback unless `ALLOW_LOCAL_MIGRATION=1` |
| Filebase from the browser | Impossible — no endpoint accepts an object key from a request |

CSRF is enforced centrally in `src/middleware.ts` for every non-GET request, so
the new form actions inherit it. Both new forms include `_csrf`.

## 3. Object keys

- Keys are built from the fixed `PAGE_IDS` list and an integer version:
  `pages/<pageId>/v000001.json`.
- `assertContentKey()` rejects any key that does not start with the configured
  prefix, that is not `[A-Za-z0-9._/-]`, or that contains `..`.
- `CONTENT_PREFIX` itself is validated the same way, so a misconfiguration cannot
  escape the namespace.
- Manifests are validated against the **exact key the store would generate** for
  each page id/version — a tampered manifest cannot point the reader at another
  object (tested).
- A request cannot supply a key: `getPublishedPage(pageId)` takes a page id, and
  `getPublishedPageByPath` maps a route to a page id.

## 4. Content validation and injection

- Every document is validated twice: on publish (server) and on read.
- All fields are plain strings rendered through Astro's escaping. There is **no
  HTML field**, so content cannot inject markup.
- Validation rejects `<` and `>` in any text field, control characters, over-long
  fields, unknown page ids, paths that do not match the page, canonical URLs that
  resolve elsewhere, invalid robots directives, unsafe colours/URLs and social
  hrefs that are not `#` or http(s).
- Section ids must be unique; publication paths must be unique; a partial set is
  rejected.
- Limits: title 200, meta 200/320, description 4000, sections ≤ 30, services ≤ 30.

## 5. Preview isolation

- The Content Studio edit forms still write to D1 (the current content source).
  There is no "preview the new store" endpoint yet, so unpublished Filebase
  content cannot leak: only `published` pointers are read.
- Reads always go through the active pointer; there is no query parameter that
  selects a version or an object.
- `CONTENT_STORE` is a deployment-level env flag, not a request input.

## 6. Publication integrity

- Upload → read back → SHA-256 compare for every object and the manifest.
- The manifest is re-parsed with the same validator the reader uses before the
  pointer can move.
- Rollback re-verifies the whole target manifest before moving the pointer.
- The pointer update is a single conditional UPDATE requiring `rowCount === 1`.

## 7. Path traversal

- Routes → page ids use a fixed map; no path segment becomes an object key.
- `checkPath()` rejects whitespace, backslashes, `//` and `..`.
- `CONTENT_PREFIX` and site versions are pattern-validated before use.

## 8. Error exposure

- Public pages never surface storage errors: `content/service` logs and falls back
  to D1.
- Admin errors are messages from `PublicationError`/`ContentStorageError` capped
  at 1000 characters in the release record; no stack traces, no credentials.
- `console.error` on the server logs the underlying message for operators.

## 9. Audit

- `content_releases` records who published (`published_by`, `published_by_name`),
  when (`created_at`, `completed_at`), the exact manifest and checksum, every
  page version, and any error.
- Rollbacks are recorded as their own rows with `rolled_back_to`.
- The existing `audit_logs` table is not written by this path; the release ledger
  is the audit trail for content.

## 10. Known limitations

| Item | Note |
| --- | --- |
| No retention/lifecycle policy | Filebase does not support `PutBucketLifecycle`; old versions persist until an explicit cleanup job exists |
| No per-object ACL | If content later needs public CDN delivery, it must be a dedicated public bucket. Today the bucket is private and reads are server-side |
| No object-level versioning | Immutability is by key convention, enforced by `putImmutable()` refusing to overwrite |
| Single publish lock | The CAS serialises the pointer; two publishers can both upload, only one activates. That is the intended trade-off |
| `Cache-Control` unverified | Not returned by GET/HEAD on the private bucket; the app caches in-process instead |
