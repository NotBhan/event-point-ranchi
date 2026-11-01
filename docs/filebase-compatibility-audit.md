# Filebase compatibility audit — 2026-11-01

Question: **can Filebase safely store simple public page content as versioned
JSON objects, with a mutable manifest and a reliable publishing workflow?**

Short answer: **suitable with limitations.** Immutable, uniquely-keyed objects
are a good fit (strong read-after-write, content-addressed ETag, SHA-256
checksum). The *mutable manifest* is **not safe as a last-write-wins object**,
because Filebase does not implement conditional writes. The recommendation in
`docs/content-architecture-recommendation.md` keeps every page object immutable
in Filebase and moves the single mutable pointer into the operational database
the project already runs.

Evidence below is separated into what the provider documents and what was
measured.

---

## 1. Existing integration

| Aspect | Implementation |
| --- | --- |
| Client | `@aws-sdk/client-s3` in `src/core/storage/filebase.ts` |
| Endpoint | `FILEBASE_ENDPOINT` (default `https://s3.filebase.io`) |
| Region | `FILEBASE_REGION` (default `auto`) |
| Addressing | `forcePathStyle: true` |
| Bucket | `FILEBASE_BUCKET` (`event-point-ranchi`, verified private) |
| Credentials | `FILEBASE_ACCESS_KEY_ID` / `FILEBASE_SECRET_ACCESS_KEY`, server-only |
| Public URL | `FILEBASE_PUBLIC_BASE_URL` = `/storage` — a same-origin proxy route, not a Filebase URL |
| Operations used | `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`, `ListObjectsV2`, `HeadBucket` |
| Conditional support in use | `GetObject` with `IfNoneMatch` (media 304 revalidation) |
| Retry | Custom exponential backoff for 408/429/5xx and network codes, 4 attempts |
| Mock driver | `MockFilebaseClient` used when unconfigured or `STORAGE_DRIVER=mock` |
| Known-at-start capability | No conditional PUT, no versioning API, no per-object ACL |

No content JSON exists in the bucket today; Filebase holds media only, and media
keys are served through the app's `/storage/[...path]` route with
`public, max-age=31536000, immutable`.

---

## 2. Provider documentation

| Topic | Documentation | Source |
| --- | --- | --- |
| Endpoint / region | Single global endpoint, region literal `auto`, SigV4 only | [S3 API overview](https://filebase.com/docs/s3-api/overview) |
| Addressing | Path-style and virtual-host style both supported | S3 API overview |
| `PutBucketVersioning` | **❌ not supported** | [Compatibility matrix](https://filebase.com/docs/s3-api/compatibility-matrix) |
| `GetBucketVersioning` | ✅ read-only metadata | Compatibility matrix |
| `ListObjectVersions` | **❌** — "Versioning is read-only metadata" | Compatibility matrix |
| `PutBucketPolicy` | **❌** — use bucket ACLs | Compatibility matrix |
| Object-level ACL | **🟡** `PutObjectAcl` accepted but ignored | Compatibility matrix |
| Bucket access model | Bucket-level only; mixing public and private objects is not supported | [Public vs private](https://filebase.com/docs/concepts/public-vs-private-buckets) |
| Public buckets | Paid plans only | Public vs private |
| CDN | Public-bucket reads are edge-cached; **private reads bypass the cache** | [CDN and caching](https://filebase.com/docs/concepts/cdn-and-caching) |
| Cache invalidation | Overwriting an object invalidates its edge copy; hashed filenames recommended | CDN and caching |
| `Cache-Control` | Documented as respected on uploaded objects (for public delivery) | CDN and caching |
| Rate limit | 500 requests/second per account | S3 API overview |
| Checksums | SHA-256 returned on every GET/HEAD (object-storage buckets) | Compatibility matrix |
| Conditional writes | Not documented either way | Compatibility matrix |

Documentation does not promise S3 conditional-write semantics, so the probe tests
them directly rather than assuming.

---

## 3. Probe methodology

Script: `scripts/probe-filebase.ts` (`npm run probe:filebase`).

Safety properties, all enforced in code:

- dry-run unless `--yes`;
- refuses any prefix outside `_compatibility-probe/`;
- refuses prefixes that look like content/media namespaces (`assets/`,
  `site-content/`, `versions/`, `gallery/`, …);
- `HEAD`s every key first and aborts if it already exists, so nothing can be
  overwritten;
- creates objects only under `_compatibility-probe/<timestamp>-<uuid>/`;
- deletes exactly the keys it created in a `finally` block and reports any
  cleanup failure;
- never prints credentials.

Two runs were executed against the configured bucket. Each created 5 objects,
verified them, and removed all 5 (`0 of 5 still present`; cleanup reported).

---

## 4. Capability matrix

Legend: **Verified** = measured on the real bucket · **Verified with
limitations** = works, but not in the way the design needs · **Not supported** =
measured to be absent or documented as absent · **Not tested** · **Blocked**.

| Capability | Provider documentation | Tested result | Supported? | Impact |
| --- | --- | --- | --- | --- |
| Upload JSON | `PutObject` ✅ | 201, ETag returned, 334–348 ms | **Verified** | Fine |
| Immediate read-after-write (new key) | Not stated | 3/3 immediate reads returned the exact body (331–365 ms), first read already correct | **Verified** | Publish → read-back verification is meaningful |
| Overwrite visibility | Not stated | Overwrite visible on the very next GET, ETag changed | **Verified** | A manifest overwrite is immediately visible to this client |
| ETag retrieval | Not stated | Returned on PUT/GET/HEAD; **equals MD5 of the body** (computed independently for both payloads) | **Verified** | Good for change detection; not a version id |
| Conditional PUT (`If-None-Match: *` on existing key) | Not documented | Request **accepted**, object overwritten | **Not supported** | **Manifest cannot be updated atomically** |
| Conditional PUT (`If-Match` with wrong ETag) | Not documented | Request **succeeded** despite mismatch | **Not supported** | ETag-based optimistic concurrency is impossible |
| Conditional GET (`If-None-Match`) | Not documented | 304 returned | **Verified** | Existing media revalidation is valid |
| Native object versioning | `PutBucketVersioning` ❌ | `GetBucketVersioning` → `Status=unset`; `ListObjectVersions` → 0 versions | **Not supported** | Versioning must be done with immutable keys |
| Immutable object keys | n/a | New keys behave correctly; nothing overwrites them | **Verified** | The primary pattern is safe |
| Private object reads | ✅ | Bucket ACL is `CanonicalUser:FULL_CONTROL`; authenticated reads work | **Verified** | Server-side reads are fine |
| Public object access | Public buckets only (paid) | Not configured: `FILEBASE_PUBLIC_BASE_URL=/storage` is an app proxy, and the bucket is private | **Blocked by configuration** | Cannot test CDN delivery without a public bucket |
| Object metadata (`x-amz-meta-*`) | `PutObject` ✅ | Round-tripped exactly through HEAD | **Verified** | Useful for run ids / content version |
| Content-Type | ✅ | Round-tripped exactly | **Verified** | Fine |
| SHA-256 checksum | Documented | `HeadObject` reports a checksum | **Verified** | Integrity check available on read-back |
| `Cache-Control` | Documented as respected (public delivery) | Set on PUT → **absent** on both GET and HEAD | **Verified with limitations** | Cannot be relied on for a private bucket; unproven for public |
| CDN invalidation | Overwrite invalidates edge copy | Not tested (private bucket bypasses the CDN, and no public bucket is configured) | **Not tested** | Blocks a CDN-only caching design |
| Presigned URLs | ✅ documented | Not exercised in the probe (no browser consumer yet) | **Not tested** | Optional for preview links |
| Concurrent writes, distinct keys | Not stated | Both writes and both reads correct | **Verified** | Parallel uploads are safe |
| Concurrent writes, same key | Not stated | Both requests succeeded; one body won | **Verified (last-write-wins)** | Concurrent publishes can silently lose a manifest update |
| Delete behaviour | `DeleteObject` ✅ | 5 deletes in 3.5 s, all keys gone, no tombstone | **Verified** | Cleanup works; deletion is immediate and unrecoverable |
| List reflects recent writes | Not stated | New key present in `ListObjectsV2` immediately | **Verified** | Listing is usable for orphan detection |
| Bucket policy | ❌ | Not tested (documented unsupported) | **Not supported** | Access must use bucket ACLs |
| Rate limits | 500 req/s | Not load-tested | **Not tested** | Unlikely to bind for this workload |

Observed latencies (from the development machine, sequential requests):
PUT ~334–348 ms, GET ~331–365 ms, DELETE ~3.5 s for 5 sequential calls.

---

## 5. Consistency observations

- **New object**: readable immediately, three times in a row, exact bytes.
- **Overwritten object**: the new body and new ETag are visible on the next read
  (~327–392 ms round trip). No stale read was observed.
- **Listing**: a key written moments earlier appeared in `ListObjectsV2`.
- **Cross-gateway staleness**: not tested — a single endpoint
  (`s3.filebase.io`) is used, and private reads bypass the CDN by design.
- **Public vs private**: only private was tested; public object freshness and
  edge-cache invalidation remain unverified.

These results are consistent with a strong read-after-write path for the API
endpoint used here, but they are sample evidence, not a provider guarantee.

---

## 6. Concurrency findings

The decisive result:

```
FAIL  Conditional PUT (If-None-Match: *) on an existing key
      request was accepted and overwrote the object — conditional writes are NOT enforced
FAIL  Conditional PUT (If-Match with a wrong ETag)
      request succeeded despite a mismatched ETag — If-Match is NOT enforced
PASS  Concurrent writes to the same key — winner=writer-1 (both requests succeeded)
```

With no conditional write, two publishers writing `site-content/manifest.json`
would both succeed, and the later request silently wins. That is unacceptable for
a manifest that decides which page versions the public site serves: a publisher
whose upload completed could have their manifest replaced by a slower, older
publisher.

Two mitigations were considered:

1. **Serialize in application memory** — only protects one serverless instance.
   Multi-instance Vercel deployments make this insufficient.
2. **Use the operational database as the publish lock / pointer** — Neon is
   already a dependency, supports transactions and `SELECT … FOR UPDATE`, and
   costs one small row. No new service is introduced.

Recommendation: option 2 (see the architecture document). Versioned page objects
stay in Filebase; only the pointer lives in Neon.

---

## 7. Caching findings

- `Cache-Control` sent with `PutObject` was **not returned** by `GetObject` or
  `HeadObject` on this private bucket. Filebase documents `Cache-Control` as
  affecting public delivery, so this is best read as "not observable on a private
  bucket", not "broken on the CDN".
- Private reads bypass the Filebase CDN entirely, so private content JSON gets
  no edge caching. Any caching must be in the application.
- Overwriting an object is documented to invalidate its edge copy, and the probe
  confirms the overwrite is immediately visible through the API — but cached
  public responses were not observable without a public bucket.
- Because ETag is the MD5 of the body, an unchanged payload produces the same
  ETag; this is useful for "did content actually change" checks, not for
  concurrency.

Design consequence: **immutable versioned keys are the reliable cache strategy.**
A key that is never rewritten can be cached for a year (by the app, or by the CDN
if a public bucket is used later). The mutable pointer must not be treated as
cacheable.

---

## 8. Security considerations

| Concern | Finding |
| --- | --- |
| Credentials in the browser | None. All Filebase access is server-side; `FILEBASE_*` variables are not `PUBLIC_`-prefixed and are never rendered |
| Object-level ACLs | Not supported — mixing public and private objects in one bucket is impossible. Any public content bucket must be dedicated |
| Bucket policy | Not supported; access is the bucket ACL only |
| Presigned URLs | Supported; if used for preview links they must be short-lived and scoped to a single key |
| Deletion | `DeleteObject` is immediate and permanent (no versioning). A bad delete cannot be undone — object keys must be validated before deletion |
| Arbitrary key writes | Not a Filebase control; the application must constrain keys to known page ids and prefixes |
| Public exposure | The current bucket is private. Making content JSON public would expose drafts only if drafts share the bucket — keep preview/private data in a separate namespace or bucket |

---

## 9. Unsupported and untested capabilities

Unsupported (verified or documented):

- conditional PUT (`If-Match`, `If-None-Match`)
- object versioning (`PutBucketVersioning`, `ListObjectVersions`)
- bucket policies
- per-object ACLs
- lifecycle rules (`PutBucketLifecycle*` ❌) — no automatic expiry of old versions
- object tagging
- event notifications

Untested:

- anonymous public reads and CDN behaviour (requires a public bucket, paid plan)
- presigned URL round-trip
- sustained throughput against the 500 req/s limit
- maximum object size (irrelevant for page JSON, which is a few KB)

---

## 10. Overall suitability

| Use | Verdict |
| --- | --- |
| Immutable versioned page JSON | **Suitable.** Strong read-after-write, content-addressed ETag, metadata, checksum, clean delete. |
| Read-back verification after upload | **Suitable.** Verified reads are trustworthy at the API endpoint. |
| Mutable manifest updated by concurrent publishers | **Not suitable on its own.** No conditional write, no versioning, last-write-wins. |
| Long-lived caching of versioned objects | **Suitable in principle**; on a private bucket the caching must be done in the application. |
| Public CDN delivery of content | **Unproven** — needs a dedicated public bucket to test. Not required for server-rendered pages. |

**Verdict: suitable with limitations.** Proceed with immutable objects in
Filebase, but do not build the publishing workflow on a mutable Filebase
manifest. Use the existing Neon database as the atomic publication pointer and
lock, as detailed in `docs/content-architecture-recommendation.md`.
