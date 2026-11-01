# Content publishing failure and recovery — 2026-11-01

Filebase and Neon are **not** one transaction. This document states exactly what
happens when each step fails, and how the system self-heals or how an operator
recovers it.

---

## 1. State machine

```
pending ──► uploading ──► verified ──► published
   │            │            │            │
   │            │            │            └──► rolled_back (history row)
   │            │            └──► failed    (pointer never moved)
   │            └──► failed                (upload/verify failure)
   └──► failed                             (validation)

verified ──► conflicted                   (someone else moved the pointer)
```

Only `published` releases are eligible as rollback targets. `verified` means
"fully uploaded and verified, not active".

---

## 2. Failure matrix

| Failure point | Active pointer | Content served | Release record | Recovery |
| --- | --- | --- | --- | --- |
| Validation | unchanged | old version | none created | Fix content, retry |
| Expected version stale (pre-upload check) | unchanged | old version | none created | Reload Content Studio |
| Page upload fails | unchanged | old version | `failed` + error | Retry; orphan objects are inert |
| Read-back checksum mismatch | unchanged | old version | `failed` + error | Retry; investigate storage |
| Manifest upload fails | unchanged | old version | `failed` | Retry |
| Manifest verification fails | unchanged | old version | `failed` | Retry |
| Pointer CAS returns 0 rows | unchanged | **newer** version | `conflicted` | Reload; the winning version stays live |
| Pointer update succeeds, status write fails | **moved** | new version | stays `verified` | `reconcileReleases()` repairs it to `published` |
| Rollback: target missing/broken | unchanged | current version | rollback row not created | Fix or choose another version |
| Rollback: CAS conflict | unchanged | newer version | — | Reload and retry |

Key guarantee: **a failed publication never replaces the active version.** The
pointer is the only switch, and it moves last.

---

## 3. Orphaned objects

A failed upload leaves immutable objects under `site-content/pages/…` that no
manifest references. They are harmless:

- nothing can select them (keys come from the manifest / page id + version);
- they cost a few KB;
- deleting them is safe once no release references them.

A cleanup job would list `site-content/pages/` and compare against the union of
all manifests. No lifecycle API exists on Filebase (`PutBucketLifecycle` is not
supported), so this must be an explicit operation. Not implemented in this phase.

---

## 4. Reconciliation

`reconcileReleases()` reads the authoritative pointer and repairs records whose
final write was lost:

- release `pending`/`uploading`/`verified` whose `site_version` **equals** the
  pointer → marked `published`;
- release `verified` that never went live → marked `failed` with an explanation;
- `pending`/`uploading` that never went live are left for the operator to inspect.

This is what prevents the UI from claiming an old version is active after a
crash between the pointer swap and the status update. Tested in
`tests/content-publication.test.ts` → "reconciliation repairs a release whose
final status write was lost".

Recovery command (to be exposed on the CLI in the next phase): the function is
exported and can be called from a script; it is idempotent.

---

## 5. Read-side failures

| Failure | Behaviour |
| --- | --- |
| Neon pointer unreachable | Cached pointer (≤10 s old) is reused; the failure is logged. With no cached pointer, the read raises `unavailable` and `content/service` falls back to D1. |
| Manifest missing / checksum mismatch | `integrity` error; the active pointer is **not** misreported; falls back to the last published release, then to D1. |
| Page object missing / tampered / invalid schema | `integrity` error, same fallback chain. Never returns a partial document. |
| Older version also broken | Error propagates; `content/service` logs and serves D1. |

The fallback chain always ends at D1 until the flag is on, so a storage fault
degrades to today's behaviour rather than an outage.

---

## 6. Operator runbook

| Symptom | Check | Action |
| --- | --- | --- |
| Publish button reports conflict | Someone published after you loaded the page | Reload, re-apply your edit, publish |
| Publish reports "verification failed" | Storage flakiness or a corrupted object | Retry; if it repeats, inspect the object key and SHA-256 in the message |
| UI shows `verified` forever | Status write lost after the pointer moved | Run reconciliation; it will mark it `published` if it is live |
| Site shows older content than expected | `CONTENT_STORE` not set in the target environment | Check the deployment env; the pointer may be correct but unused |
| "schema is out of date" in the admin panel | Migration 003 not applied | `npm run db:migrate:schema -- --apply` |
| Need to undo a bad publish | — | Content Studio → Roll back on the previous published version |
