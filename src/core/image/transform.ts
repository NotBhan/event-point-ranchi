import sharp from 'sharp';

export type TransformFormat = 'webp' | 'avif' | 'jpeg';

export interface TransformParams {
  width?: number;
  quality: number;
  format: TransformFormat;
}

const MIN_WIDTH = 16;
const MAX_WIDTH = 2400;
const WIDTH_STEP = 8; // quantise so cache keys stay bounded
const MIN_QUALITY = 40;
const MAX_QUALITY = 90;
const DEFAULT_QUALITY = 78;

const FORMATS: TransformFormat[] = ['webp', 'avif', 'jpeg'];

/**
 * Parses `?w=&q=&f=` from a stored-object URL. Returns null when no transform
 * is requested or the parameters are invalid (callers then serve the original).
 */
export function parseTransformParams(searchParams: URLSearchParams): TransformParams | null {
  const rawWidth = searchParams.get('w');
  const rawQuality = searchParams.get('q');
  const rawFormat = searchParams.get('f');

  const hasWidth = rawWidth !== null && rawWidth !== '';
  const hasQuality = rawQuality !== null && rawQuality !== '';
  const hasFormat = rawFormat !== null && rawFormat !== '';
  if (!hasWidth && !hasQuality && !hasFormat) return null;

  let width: number | undefined;
  if (hasWidth) {
    const parsed = Number(rawWidth);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
    width = Math.round(clamped / WIDTH_STEP) * WIDTH_STEP;
  }

  let quality = DEFAULT_QUALITY;
  if (hasQuality) {
    const parsed = Number(rawQuality);
    if (Number.isFinite(parsed) && parsed > 0) {
      quality = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, Math.round(parsed)));
    }
  }

  const format = FORMATS.includes(rawFormat as TransformFormat) ? (rawFormat as TransformFormat) : 'webp';

  return { width, quality, format };
}

export function transformCacheKey(objectKey: string, params: TransformParams): string {
  return `${objectKey}|w${params.width ?? ''}|q${params.quality}|f${params.format}`;
}

const CONTENT_TYPES: Record<TransformFormat, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
};

export async function renderTransformedImage(
  input: Buffer,
  params: TransformParams,
): Promise<{ data: Buffer; contentType: string }> {
  let pipeline = sharp(input, { failOn: 'none', limitInputPixels: 8000 * 8000, sequentialRead: true });

  if (params.width) {
    pipeline = pipeline.resize({ width: params.width, withoutEnlargement: true });
  }

  let data: Buffer;
  switch (params.format) {
    case 'avif':
      data = await pipeline.avif({ quality: params.quality, effort: 4 }).toBuffer();
      break;
    case 'jpeg':
      data = await pipeline.jpeg({ quality: params.quality, mozjpeg: true }).toBuffer();
      break;
    default:
      data = await pipeline.webp({ quality: params.quality, effort: 4 }).toBuffer();
  }

  return { data, contentType: CONTENT_TYPES[params.format] };
}
