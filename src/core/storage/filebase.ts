import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from '@aws-sdk/client-s3';
import { getStorageConfig, type StorageConfig } from './config';

export type StorageDriver = 'filebase' | 'mock';

export type StorageOperation =
  | 'putObject'
  | 'getObject'
  | 'headObject'
  | 'deleteObject'
  | 'listObjects'
  | 'checkConnection';

export interface GetObjectResult {
  key: string;
  body: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  etag: string;
  size: number;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array | string;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  etag: string;
  size: number;
}

export interface StoredObject {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ListObjectsOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface ListObjectsResult {
  objects: StoredObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface ConnectionStatus {
  ok: boolean;
  driver: StorageDriver;
  error?: string;
}

export interface FilebaseClient {
  readonly driver: StorageDriver;
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  getObject(key: string): Promise<GetObjectResult | null>;
  headObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(options?: ListObjectsOptions): Promise<ListObjectsResult>;
  checkConnection(): Promise<ConnectionStatus>;
}

export interface SimulatedFailureOptions {
  error?: Error;
  times?: number;
}

const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 2_000;
const MAX_LIST_KEYS = 1_000;

const TRANSIENT_ERROR_CODES = new Set([
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'NetworkingError',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'InternalError',
  'InternalServerError',
  'ServiceUnavailable',
  'SlowDown',
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
]);

interface S3ErrorLike extends Partial<S3ServiceException> {
  code?: string;
}

function isTransientS3Error(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as S3ErrorLike;
  const status = candidate.$metadata?.httpStatusCode;

  if (status !== undefined && (status === 408 || status === 429 || status >= 500)) {
    return true;
  }
  if (candidate.$retryable?.throttling) {
    return true;
  }

  const code = candidate.code ?? candidate.name;
  return code !== undefined && TRANSIENT_ERROR_CODES.has(code);
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as S3ErrorLike;
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt);
  const jitter = exponential * (0.5 + Math.random() * 0.5);
  return Math.round(jitter);
}

async function retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientS3Error(error) || attempt >= MAX_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await delay(backoffDelay(attempt));
      attempt += 1;
    }
  }
}

function normalizeEtag(etag: string | undefined): string {
  return (etag ?? '').replaceAll('"', '');
}

function bodySize(body: Uint8Array | string): number {
  return typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
}

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new Uint8Array(Buffer.from(body)) : Uint8Array.from(body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MockStoredObject {
  key: string;
  bytes: Uint8Array;
  etag: string;
  lastModified: Date;
  contentType?: string;
  metadata?: Record<string, string>;
}

interface FailureRule {
  error: Error;
  remaining: number;
}

export class MockFilebaseClient implements FilebaseClient {
  readonly driver = 'mock' as const;

  private readonly objects = new Map<string, MockStoredObject>();
  private readonly failures = new Map<StorageOperation, FailureRule[]>();
  private readonly globalFailures: FailureRule[] = [];

  simulateFailure(operation: StorageOperation | 'all', options: SimulatedFailureOptions = {}): void {
    const rule: FailureRule = {
      error: options.error ?? new Error(`Simulated ${operation} failure`),
      remaining: options.times ?? Number.POSITIVE_INFINITY,
    };

    if (operation === 'all') {
      this.globalFailures.push(rule);
      return;
    }

    const rules = this.failures.get(operation) ?? [];
    rules.push(rule);
    this.failures.set(operation, rules);
  }

  clearFailures(): void {
    this.failures.clear();
    this.globalFailures.length = 0;
  }

  reset(): void {
    this.objects.clear();
    this.clearFailures();
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    this.assertHealthy('putObject');

    if (!input.key) {
      throw new Error('Object key is required');
    }

    const bytes = toBytes(input.body);
    const etag = createHash('md5').update(bytes).digest('hex');

    this.objects.set(input.key, {
      key: input.key,
      bytes,
      etag,
      lastModified: new Date(),
      contentType: input.contentType,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    });

    return { key: input.key, etag, size: bytes.byteLength };
  }

  async getObject(key: string): Promise<GetObjectResult | null> {
    this.assertHealthy('getObject');

    const object = this.objects.get(key);
    if (!object) return null;

    return {
      key: object.key,
      body: object.bytes,
      contentType: object.contentType,
      etag: object.etag,
      size: object.bytes.byteLength,
    };
  }

  async headObject(key: string): Promise<StoredObject | null> {
    this.assertHealthy('headObject');

    const object = this.objects.get(key);
    return object ? this.snapshot(object) : null;
  }

  async deleteObject(key: string): Promise<void> {
    this.assertHealthy('deleteObject');
    this.objects.delete(key);
  }

  async listObjects(options: ListObjectsOptions = {}): Promise<ListObjectsResult> {
    this.assertHealthy('listObjects');

    const prefix = options.prefix ?? '';
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();

    let start = 0;
    if (options.continuationToken) {
      const index = keys.indexOf(options.continuationToken);
      start = index >= 0 ? index + 1 : keys.length;
    }

    const limit = Math.min(Math.max(options.maxKeys ?? MAX_LIST_KEYS, 1), MAX_LIST_KEYS);
    const page = keys.slice(start, start + limit);
    const objects = page.flatMap((key) => {
      const object = this.objects.get(key);
      return object ? [this.snapshot(object)] : [];
    });
    const isTruncated = start + page.length < keys.length;

    return {
      objects,
      isTruncated,
      nextContinuationToken: isTruncated ? page[page.length - 1] : undefined,
    };
  }

  async checkConnection(): Promise<ConnectionStatus> {
    const error = this.nextFailure('checkConnection');

    if (error) {
      return { ok: false, driver: 'mock', error: error.message };
    }

    return { ok: true, driver: 'mock' };
  }

  private snapshot(object: MockStoredObject): StoredObject {
    return {
      key: object.key,
      size: object.bytes.byteLength,
      etag: object.etag,
      lastModified: new Date(object.lastModified),
      contentType: object.contentType,
      metadata: object.metadata ? { ...object.metadata } : undefined,
    };
  }

  private assertHealthy(operation: StorageOperation): void {
    const error = this.nextFailure(operation);
    if (error) throw error;
  }

  private nextFailure(operation: StorageOperation): Error | null {
    return this.consume(this.globalFailures) ?? this.consume(this.failures.get(operation));
  }

  private consume(rules: FailureRule[] | undefined): Error | null {
    const rule = rules?.[0];
    if (!rule) return null;

    if (Number.isFinite(rule.remaining)) {
      rule.remaining -= 1;
      if (rule.remaining <= 0) {
        rules?.shift();
      }
    }

    return rule.error;
  }
}

class S3FilebaseClient implements FilebaseClient {
  readonly driver = 'filebase' as const;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
      maxAttempts: 1,
    });
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const response = await retryWithBackoff(() =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
          Metadata: input.metadata,
        }),
      ),
    );

    return {
      key: input.key,
      etag: normalizeEtag(response.ETag),
      size: bodySize(input.body),
    };
  }

  async getObject(key: string): Promise<GetObjectResult | null> {
    try {
      const response = await retryWithBackoff(() =>
        this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
      );

      if (!response.Body) return null;
      const body = await response.Body.transformToByteArray();

      return {
        key,
        body,
        contentType: response.ContentType,
        cacheControl: response.CacheControl,
        etag: normalizeEtag(response.ETag),
        size: body.length,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async headObject(key: string): Promise<StoredObject | null> {
    try {
      const response = await retryWithBackoff(() =>
        this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
      );

      return {
        key,
        size: response.ContentLength ?? 0,
        etag: normalizeEtag(response.ETag),
        lastModified: response.LastModified ?? new Date(0),
        contentType: response.ContentType,
        metadata: response.Metadata,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await retryWithBackoff(() =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }

  async listObjects(options: ListObjectsOptions = {}): Promise<ListObjectsResult> {
    const response = await retryWithBackoff(() =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: options.prefix,
          MaxKeys: Math.min(Math.max(options.maxKeys ?? MAX_LIST_KEYS, 1), MAX_LIST_KEYS),
          ContinuationToken: options.continuationToken,
        }),
      ),
    );

    const objects = (response.Contents ?? []).flatMap((item) => {
      if (!item.Key) return [];

      return [
        {
          key: item.Key,
          size: item.Size ?? 0,
          etag: normalizeEtag(item.ETag),
          lastModified: item.LastModified ?? new Date(0),
        },
      ];
    });

    return {
      objects,
      isTruncated: response.IsTruncated ?? false,
      nextContinuationToken: response.NextContinuationToken,
    };
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      await retryWithBackoff(() =>
        this.client.send(new HeadBucketCommand({ Bucket: this.bucket })),
      );
      return { ok: true, driver: 'filebase' };
    } catch (error) {
      return { ok: false, driver: 'filebase', error: errorMessage(error) };
    }
  }
}

let cachedClient: { signature: string; client: FilebaseClient } | null = null;

function clientSignature(config: StorageConfig, useMock: boolean): string {
  if (useMock) return 'mock';
  return [
    config.endpoint,
    config.region,
    config.bucket,
    config.accessKeyId,
    config.secretAccessKey,
  ].join('\u0000');
}

export function getFilebaseClient(): FilebaseClient {
  const config = getStorageConfig();
  const useMock =
    !config.isConfigured || process.env.STORAGE_DRIVER?.toLowerCase() === 'mock';
  const signature = clientSignature(config, useMock);

  if (cachedClient?.signature === signature) {
    return cachedClient.client;
  }

  const client: FilebaseClient = useMock
    ? new MockFilebaseClient()
    : new S3FilebaseClient(config);

  cachedClient = { signature, client };
  return client;
}

export function resetFilebaseClient(): void {
  cachedClient = null;
}
