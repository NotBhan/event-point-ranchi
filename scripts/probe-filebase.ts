/**
 * Filebase S3 compatibility probe.
 *
 * Answers the questions the content-storage design depends on — read-after-write
 * consistency, conditional writes, ETag behaviour, metadata, concurrency,
 * listing and delete — using only objects this script creates.
 *
 * Safety:
 *   - refuses to run without --yes;
 *   - requires a dedicated prefix under `_compatibility-probe/`;
 *   - refuses prefixes that look like real content or media namespaces;
 *   - HEADs every key first and aborts if it already exists, so nothing can be
 *     overwritten;
 *   - deletes exactly the keys it created, in a `finally` block, and reports
 *     any cleanup failure;
 *   - never prints credentials.
 *
 * Usage:
 *   npm run probe:filebase            # dry run: prints the plan, writes nothing
 *   npm run probe:filebase -- --yes   # execute
 */
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetBucketAclCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getStorageConfig } from '../src/core/storage/config';

const PROBE_ROOT = '_compatibility-probe/';

/** Prefixes that hold real content or media and must never be touched. */
const FORBIDDEN_PREFIXES = [
  'assets/',
  'gallery/',
  'mandaps/',
  'stages/',
  'equipment/',
  'catering/',
  'banners/',
  'uploads/',
  'site-content/',
  'content/',
  'published/',
  'versions/',
];

interface CheckResult {
  name: string;
  ok: boolean | null;
  detail: string;
  ms?: number;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean | null, detail: string, ms?: number): void {
  results.push({ name, ok, detail, ms });
  const status = ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL';
  console.log(`${status}  ${name}${ms !== undefined ? ` (${ms}ms)` : ''} — ${detail}`);
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function normalizeEtag(etag: string | undefined): string {
  return (etag ?? '').replaceAll('"', '');
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function nameOf(error: unknown): string {
  return (error as { name?: string })?.name ?? 'Error';
}

function messageOf(error: unknown): string {
  const code = (error as { Code?: string })?.Code ?? nameOf(error);
  const message = (error as { message?: string })?.message ?? '';
  return `${code}${message ? `: ${message.slice(0, 160)}` : ''}`;
}

async function main(): Promise<void> {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch {
      // .env is optional when the environment is already populated.
    }
  }

  const confirmed = process.argv.includes('--yes');
  const config = getStorageConfig();

  if (!config.isConfigured) {
    throw new Error(
      'Filebase is not configured. Set FILEBASE_BUCKET, FILEBASE_ACCESS_KEY_ID and FILEBASE_SECRET_ACCESS_KEY.',
    );
  }

  const overridePrefix = (() => {
    const index = process.argv.indexOf('--prefix');
    return index >= 0 ? process.argv[index + 1] : undefined;
  })();

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const prefix = overridePrefix ? `${overridePrefix.replace(/\/?$/, '/')}${runId}/` : `${PROBE_ROOT}${runId}/`;

  // ---- guards -------------------------------------------------------------
  if (!prefix.startsWith(PROBE_ROOT)) {
    throw new Error(`Refusing to probe outside ${PROBE_ROOT}. Requested prefix: ${prefix}`);
  }
  for (const forbidden of FORBIDDEN_PREFIXES) {
    if (prefix.startsWith(forbidden) || prefix.includes(`/${forbidden}`)) {
      throw new Error(`Refusing to probe a production content prefix (${forbidden}).`);
    }
  }
  if (process.env.STORAGE_DRIVER?.toLowerCase() === 'mock') {
    throw new Error('STORAGE_DRIVER=mock is active; this probe needs the real S3 endpoint.');
  }

  const bucket = config.bucket;
  console.log(`Endpoint : ${config.endpoint}`);
  console.log(`Bucket   : ${bucket}`);
  console.log(`Prefix   : ${prefix}`);
  console.log(`Mode     : ${confirmed ? 'execute' : 'dry run'}\n`);

  if (!confirmed) {
    console.log('Plan (nothing written):');
    console.log(`  1. HEAD ${prefix}manifest.json and abort if it already exists`);
    console.log('  2. PutObject JSON → immediate GetObject ×3 → HeadObject');
    console.log('  3. Conditional GET (If-None-Match) → expect 304');
    console.log('  4. Conditional PUT (If-None-Match) on the existing key → observe');
    console.log('  5. Overwrite → read back and compare ETag/body');
    console.log('  6. ListObjectsV2 with the probe prefix → compare with written keys');
    console.log('  7. Two concurrent PUTs to distinct keys → verify no cross-contamination');
    console.log('  8. Two concurrent PUTs to the same key → observe last-write-wins');
    console.log('  9. Delete every created key → HEAD each → expect 404');
    console.log('\nRe-run with --yes to execute.');
    return;
  }

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 1,
  });

  const mainKey = `${prefix}manifest.json`;
  const secondaryKey = `${prefix}pages/home.json`;
  const concurrentA = `${prefix}concurrent-a.json`;
  const concurrentB = `${prefix}concurrent-b.json`;
  const raceKey = `${prefix}race.json`;
  const createdKeys = new Set<string>([mainKey, secondaryKey, concurrentA, concurrentB, raceKey]);

  // Refuse to touch any key that already exists.
  for (const key of createdKeys) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      throw new Error(`Key already exists, refusing to overwrite: ${key}`);
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
    }
  }

  try {
    // ---- bucket properties ------------------------------------------------
    try {
      const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }));
      const grants = (acl.Grants ?? [])
        .map((grant) => `${grant.Grantee?.Type ?? '?'}:${grant.Permission ?? '?'}`)
        .join(', ');
      const isPublic = grants.includes('AllUsers');
      record('Bucket ACL', true, `${isPublic ? 'public' : 'private'} (${grants || 'no grants returned'})`);
    } catch (error) {
      record('Bucket ACL', null, `unavailable: ${messageOf(error)}`);
    }

    try {
      const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
      record(
        'Bucket versioning state',
        versioning.Status === 'Enabled',
        `Status=${versioning.Status ?? 'unset'} MfaDelete=${versioning.MFADelete ?? 'unset'}`,
      );
    } catch (error) {
      record('Bucket versioning state', null, `unavailable: ${messageOf(error)}`);
    }

    try {
      const versions = await client.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, MaxKeys: 5 }),
      );
      record(
        'ListObjectVersions',
        true,
        `responded; versions=${versions.Versions?.length ?? 0} ` +
          `deleteMarkers=${versions.DeleteMarkers?.length ?? 0}`,
      );
    } catch (error) {
      record('ListObjectVersions', false, `${statusOf(error) ?? ''} ${messageOf(error)}`.trim());
    }

    // ---- basic write / read ----------------------------------------------
    const v1 = JSON.stringify({ schemaVersion: 1, version: 1, body: 'probe-v1' });
    const putStart = performance.now();
    const put1 = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mainKey,
        Body: v1,
        ContentType: 'application/json',
        CacheControl: 'no-cache, max-age=0',
        Metadata: { 'probe-run': runId, 'probe-version': '1' },
      }),
    );
    record('PutObject (new JSON object)', true, `ETag=${normalizeEtag(put1.ETag)}`, elapsed(putStart));

    const readTimes: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const readStart = performance.now();
      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: mainKey }));
      const body = await got.Body?.transformToString();
      readTimes.push(elapsed(readStart));
      record(
        `Immediate read #${attempt} after write`,
        body === v1,
        `bytes=${body?.length ?? 0} contentType=${got.ContentType ?? 'none'} ` +
          `cacheControl=${got.CacheControl ?? 'none'} etag=${normalizeEtag(got.ETag)}`,
        readTimes[readTimes.length - 1],
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const head1 = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: mainKey }));
    record(
      'HeadObject metadata',
      head1.ContentType === 'application/json' &&
        head1.Metadata?.['probe-run'] === runId &&
        (head1.ContentLength ?? 0) === Buffer.byteLength(v1),
      `size=${head1.ContentLength} contentType=${head1.ContentType} cacheControl=${head1.CacheControl ?? 'none'} ` +
        `metadata=${JSON.stringify(head1.Metadata ?? {})} etag=${normalizeEtag(head1.ETag)} ` +
        `sha256=${head1.ChecksumSHA256 ? 'present' : 'absent'}`,
    );

    // ---- conditional GET --------------------------------------------------
    try {
      await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: mainKey, IfNoneMatch: head1.ETag ?? undefined }),
      );
      record('Conditional GET (If-None-Match)', false, 'returned 200 with a body; 304 expected');
    } catch (error) {
      record(
        'Conditional GET (If-None-Match)',
        statusOf(error) === 304,
        `${statusOf(error) ?? ''} ${nameOf(error)}`.trim(),
      );
    }

    // ---- conditional PUT --------------------------------------------------
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: mainKey,
          Body: JSON.stringify({ ...JSON.parse(v1), conditionalWrite: 'if-none-match-honoured' }),
          ContentType: 'application/json',
          IfNoneMatch: '*',
        }),
      );
      const after = await client.send(new GetObjectCommand({ Bucket: bucket, Key: mainKey }));
      const body = await after.Body?.transformToString();
      record(
        'Conditional PUT (If-None-Match: *) on an existing key',
        false,
        body?.includes('conditionalWrite')
          ? 'request was accepted and overwrote the object — conditional writes are NOT enforced'
          : 'request returned 200 but the object was unchanged — inconsistent',
      );
    } catch (error) {
      record(
        'Conditional PUT (If-None-Match: *) on an existing key',
        statusOf(error) === 412,
        `rejected with ${statusOf(error) ?? ''} ${nameOf(error)}`.trim(),
      );
    }

    // ---- If-Match conditional PUT ----------------------------------------
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: mainKey,
          Body: JSON.stringify({ ...JSON.parse(v1), conditionalWrite: 'if-match-honoured' }),
          ContentType: 'application/json',
          IfMatch: '00000000000000000000000000000000',
        }),
      );
      record(
        'Conditional PUT (If-Match with a wrong ETag)',
        false,
        'request succeeded despite a mismatched ETag — If-Match is NOT enforced',
      );
    } catch (error) {
      record(
        'Conditional PUT (If-Match with a wrong ETag)',
        statusOf(error) === 412,
        `rejected with ${statusOf(error) ?? ''} ${nameOf(error)}`.trim(),
      );
    }

    // ---- overwrite visibility --------------------------------------------
    const v2 = JSON.stringify({ schemaVersion: 1, version: 2, body: 'probe-v2' });
    const overwriteStart = performance.now();
    const put2 = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mainKey,
        Body: v2,
        ContentType: 'application/json',
        CacheControl: 'no-cache, max-age=0',
        Metadata: { 'probe-run': runId, 'probe-version': '2' },
      }),
    );
    const overwriteMs = elapsed(overwriteStart);

    const afterOverwrite = await client.send(new GetObjectCommand({ Bucket: bucket, Key: mainKey }));
    const afterBody = await afterOverwrite.Body?.transformToString();
    record(
      'Overwrite then immediate read',
      afterBody === v2,
      `new ETag=${normalizeEtag(put2.ETag)} changed=${normalizeEtag(put1.ETag) !== normalizeEtag(put2.ETag)}`,
      overwriteMs,
    );

    // ---- listing ----------------------------------------------------------
    const listStart = performance.now();
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 100 }),
    );
    const listed = new Set((list.Contents ?? []).map((entry) => entry.Key));
    record(
      'ListObjectsV2 reflects recent writes',
      listed.has(mainKey),
      `keys=${listed.size} truncated=${list.IsTruncated ?? false}`,
      elapsed(listStart),
    );

    // ---- concurrency ------------------------------------------------------
    await Promise.all([
      client.send(
        new PutObjectCommand({ Bucket: bucket, Key: concurrentA, Body: 'alpha', ContentType: 'text/plain' }),
      ),
      client.send(
        new PutObjectCommand({ Bucket: bucket, Key: concurrentB, Body: 'bravo', ContentType: 'text/plain' }),
      ),
    ]);
    const [readA, readB] = await Promise.all([
      client.send(new GetObjectCommand({ Bucket: bucket, Key: concurrentA })).then((r) => r.Body?.transformToString()),
      client.send(new GetObjectCommand({ Bucket: bucket, Key: concurrentB })).then((r) => r.Body?.transformToString()),
    ]);
    record('Concurrent writes to distinct keys', readA === 'alpha' && readB === 'bravo', `a=${readA} b=${readB}`);

    await Promise.all([
      client.send(new PutObjectCommand({ Bucket: bucket, Key: raceKey, Body: 'writer-1' })),
      client.send(new PutObjectCommand({ Bucket: bucket, Key: raceKey, Body: 'writer-2' })),
    ]);
    const raceRead = await client
      .send(new GetObjectCommand({ Bucket: bucket, Key: raceKey }))
      .then((r) => r.Body?.transformToString());
    record(
      'Concurrent writes to the same key',
      raceRead === 'writer-1' || raceRead === 'writer-2',
      `winner=${raceRead} (last-write-wins; both requests succeeded)`,
    );

    // ---- public access ----------------------------------------------------
    if (config.publicBaseUrl.startsWith('http')) {
      const publicUrl = `${config.publicBaseUrl.replace(/\/+$/, '')}/${secondaryKey}`;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: secondaryKey, Body: '{"public":true}', ContentType: 'application/json' }),
      );
      const anon = await fetch(publicUrl).catch(() => null);
      record(
        'Anonymous public read',
        anon ? anon.status === 200 : false,
        anon ? `HTTP ${anon.status} via ${new URL(publicUrl).host}` : 'request failed',
      );
    } else {
      record('Anonymous public read', null, 'FILEBASE_PUBLIC_BASE_URL is not an absolute URL');
    }

    // ---- delete -----------------------------------------------------------
    const deleteStart = performance.now();
    for (const key of createdKeys) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
    let remaining = 0;
    for (const key of createdKeys) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        remaining += 1;
      } catch (error) {
        if (statusOf(error) !== 404) remaining += 1;
      }
    }
    record('DeleteObject removes objects', remaining === 0, `${remaining} of ${createdKeys.size} still present`, elapsed(deleteStart));
  } finally {
    // Best-effort cleanup, reported explicitly rather than silently ignored.
    let cleanupFailures = 0;
    for (const key of createdKeys) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        cleanupFailures += 1;
        console.error(`CLEANUP FAILED for ${key}: ${messageOf(error)}`);
      }
    }
    if (cleanupFailures === 0) {
      console.log(`\nCleanup: deleted ${createdKeys.size} probe object(s) under ${prefix}`);
    } else {
      console.error(`\nCleanup: ${cleanupFailures} probe object(s) could NOT be deleted. Remove ${prefix} manually.`);
      process.exitCode = 1;
    }
  }

  const failed = results.filter((result) => result.ok === false);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('Failed checks:');
    for (const result of failed) console.log(`  - ${result.name}: ${result.detail}`);
  }
}

main().catch((error) => {
  console.error('\nProbe failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
