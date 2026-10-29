export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  galleryLimitBytes: number;
  assetLimitBytes: number;
  isConfigured: boolean;
}

export const DEFAULT_GALLERY_LIMIT_BYTES = 3 * 1024 * 1024 * 1024; // 3 GiB = 3,221,225,472 bytes
export const DEFAULT_ASSET_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;   // 1 GiB = 1,073,741,824 bytes

export function getStorageConfig(): StorageConfig {
  const env = process.env;

  const endpoint = env.FILEBASE_ENDPOINT || 'https://s3.filebase.io';
  const region = env.FILEBASE_REGION || 'auto';
  const bucket = env.FILEBASE_BUCKET || '';
  const accessKeyId = env.FILEBASE_ACCESS_KEY_ID || '';
  const secretAccessKey = env.FILEBASE_SECRET_ACCESS_KEY || '';
  const publicBaseUrl = env.FILEBASE_PUBLIC_BASE_URL || '/storage';

  const galleryLimitBytes = env.GALLERY_STORAGE_LIMIT_BYTES
    ? parseInt(env.GALLERY_STORAGE_LIMIT_BYTES, 10) || DEFAULT_GALLERY_LIMIT_BYTES
    : DEFAULT_GALLERY_LIMIT_BYTES;

  const assetLimitBytes = env.ASSET_STORAGE_LIMIT_BYTES
    ? parseInt(env.ASSET_STORAGE_LIMIT_BYTES, 10) || DEFAULT_ASSET_LIMIT_BYTES
    : DEFAULT_ASSET_LIMIT_BYTES;

  const isConfigured = Boolean(bucket && accessKeyId && secretAccessKey);

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    galleryLimitBytes,
    assetLimitBytes,
    isConfigured,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
