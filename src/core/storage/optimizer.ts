import sharp, { type Metadata } from 'sharp';

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_DECODED_DIMENSION = 8000;
export const MAX_DECODED_PIXELS = MAX_DECODED_DIMENSION * MAX_DECODED_DIMENSION;

const GALLERY_MAX_EDGE = 2400;
const ASSET_MAX_EDGE = 1600;
const WEBP_QUALITY = 82;
const WEBP_EFFORT = 4;

const RASTER_FORMATS = new Set(['jpeg', 'png', 'webp']);

const SHARP_INPUT_OPTIONS = {
  failOn: 'warning' as const,
  limitInputPixels: MAX_DECODED_PIXELS,
  sequentialRead: true,
};

const SVG_TAG_PATTERN = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const SVG_ATTRIBUTE_PATTERN = /([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

const SVG_DANGEROUS_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'applet',
  'audio',
  'video',
  'canvas',
  'frame',
  'frameset',
  'meta',
  'link',
  'base',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'template',
  'handler',
]);

export type ImageKind = 'gallery' | 'asset' | 'logo';
export type ImageInput = Buffer | Uint8Array | ArrayBuffer;
export type SourceImageFormat = 'jpeg' | 'png' | 'webp' | 'svg';

export type ImageValidationErrorCode =
  | 'empty_input'
  | 'input_too_large'
  | 'unsupported_format'
  | 'invalid_dimensions'
  | 'invalid_image'
  | 'unsafe_svg';

export class ImageValidationError extends Error {
  readonly code: ImageValidationErrorCode;

  constructor(message: string, code: ImageValidationErrorCode = 'invalid_image') {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

export interface OptimizeImageOptions {
  kind: ImageKind;
}

export interface OptimizedImage {
  buffer: Buffer;
  contentType: 'image/webp' | 'image/png' | 'image/svg+xml';
  extension: 'webp' | 'png' | 'svg';
  width: number;
  height: number;
  size: number;
  source: {
    format: SourceImageFormat;
    width: number;
    height: number;
    size: number;
  };
}

function toBuffer(input: ImageInput): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new ImageValidationError('Image input must be binary data.', 'invalid_image');
}

function isImageKind(value: unknown): value is ImageKind {
  return value === 'gallery' || value === 'asset' || value === 'logo';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function svgLocalName(name: string): string {
  const separator = name.lastIndexOf(':');
  return (separator >= 0 ? name.slice(separator + 1) : name).toLowerCase();
}

function unquoteSvgValue(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function decodeSvgEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();

    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";

    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);

    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    return String.fromCodePoint(codePoint);
  });
}

function isSafeSvgCss(css: string): boolean {
  if (css.includes('\\')) return false;

  const normalized = decodeSvgEntities(css).replace(/\s+/g, '').toLowerCase();

  if (
    normalized.includes('@import') ||
    normalized.includes('expression(') ||
    normalized.includes('javascript:') ||
    normalized.includes('vbscript:') ||
    normalized.includes('behavior:') ||
    normalized.includes('-moz-binding')
  ) {
    return false;
  }

  const urls = normalized.match(/url\([^)]*\)/g) ?? [];
  return urls.every((url) => /^url\(["']?#/.test(url));
}

function isSafeSvgAttributeValue(value: string): boolean {
  if (value.includes('\\')) return false;

  const normalized = decodeSvgEntities(value).replace(/\s+/g, '').toLowerCase();

  if (
    normalized.includes('javascript:') ||
    normalized.includes('vbscript:') ||
    normalized.includes('data:text/html') ||
    normalized.includes('expression(') ||
    normalized.includes('behavior:') ||
    normalized.includes('-moz-binding')
  ) {
    return false;
  }

  const urls = normalized.match(/url\([^)]*\)/g) ?? [];
  return urls.every((url) => /^url\(["']?#/.test(url));
}

function sanitizeSvgAttributes(attributes: string): string {
  let output = '';

  SVG_ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SVG_ATTRIBUTE_PATTERN.exec(attributes)) !== null) {
    const rawName = match[1];
    const rawValue = match[2];
    const name = svgLocalName(rawName);
    const value = unquoteSvgValue(rawValue);
    const decoded = decodeSvgEntities(value);

    if (name.startsWith('on')) continue;
    if (name === 'base') continue;
    if ((name === 'href' || name === 'src') && !decoded.trim().startsWith('#')) continue;
    if (name === 'attributename') {
      const target = decoded.trim().toLowerCase();
      const localTarget = target.includes(':')
        ? target.slice(target.lastIndexOf(':') + 1)
        : target;

      if (/^(?:on|href|src|style|base)/.test(localTarget)) continue;
    }
    if (!isSafeSvgAttributeValue(value)) continue;

    output += ` ${rawName}=${rawValue}`;
  }

  return output;
}

function sanitizeSvgStyleText(css: string): string {
  return isSafeSvgCss(css) ? css : '';
}

function decodeSvg(input: Buffer): string {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new ImageValidationError('SVG input must be valid UTF-8 text.', 'unsafe_svg');
  }

  if (text.includes('\u0000')) {
    throw new ImageValidationError('SVG input contains null bytes.', 'unsafe_svg');
  }

  return text;
}

function assertSanitizedSvg(markup: string): void {
  SVG_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SVG_TAG_PATTERN.exec(markup)) !== null) {
    const name = svgLocalName(match[2]);

    if (SVG_DANGEROUS_ELEMENTS.has(name)) {
      throw new ImageValidationError('SVG contains unsafe elements.', 'unsafe_svg');
    }

    const attributes = match[3] ?? '';
    SVG_ATTRIBUTE_PATTERN.lastIndex = 0;
    let attributeMatch: RegExpExecArray | null;

    while ((attributeMatch = SVG_ATTRIBUTE_PATTERN.exec(attributes)) !== null) {
      const attributeName = svgLocalName(attributeMatch[1]);
      const value = unquoteSvgValue(attributeMatch[2]);
      const decoded = decodeSvgEntities(value);

      if (attributeName.startsWith('on')) {
        throw new ImageValidationError('SVG contains event handler attributes.', 'unsafe_svg');
      }
      if ((attributeName === 'href' || attributeName === 'src') && !decoded.trim().startsWith('#')) {
        throw new ImageValidationError('SVG contains external references.', 'unsafe_svg');
      }
      if (!isSafeSvgAttributeValue(value)) {
        throw new ImageValidationError('SVG contains unsafe attribute values.', 'unsafe_svg');
      }
    }
  }

  if (markup.includes('<?') || markup.includes('<!')) {
    throw new ImageValidationError('SVG contains unsafe declarations.', 'unsafe_svg');
  }
}

function sanitizeSvg(input: Buffer): string {
  let source = decodeSvg(input)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, content: string) =>
      content.replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    );

  if (source.includes('<!--') || source.includes('<?') || source.includes('<!')) {
    throw new ImageValidationError('SVG contains unsafe or malformed declarations.', 'unsafe_svg');
  }

  let output = '';
  let lastIndex = 0;
  let firstElement: string | null = null;
  let styleDepth = 0;
  let removingElement: string | null = null;
  let removingDepth = 0;

  SVG_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SVG_TAG_PATTERN.exec(source)) !== null) {
    const text = source.slice(lastIndex, match.index);

    if (text.includes('<')) {
      throw new ImageValidationError('SVG contains malformed markup.', 'unsafe_svg');
    }

    if (!removingElement) {
      output += styleDepth > 0 ? sanitizeSvgStyleText(text) : text;
    }

    lastIndex = match.index + match[0].length;

    const closing = match[1] === '/';
    const rawName = match[2];
    const name = svgLocalName(rawName);
    const attributes = match[3] ?? '';
    const selfClosing = match[4] === '/';

    if (removingElement) {
      if (name === removingElement) {
        if (closing) {
          removingDepth -= 1;
          if (removingDepth === 0) removingElement = null;
        } else if (!selfClosing) {
          removingDepth += 1;
        }
      }
      continue;
    }

    if (SVG_DANGEROUS_ELEMENTS.has(name)) {
      if (closing) continue;

      if (!selfClosing) {
        removingElement = name;
        removingDepth = 1;
      }
      continue;
    }

    if (closing) {
      if (name === 'style' && styleDepth > 0) styleDepth -= 1;
      output += `</${rawName}>`;
      continue;
    }

    if (firstElement === null) firstElement = name;

    output += `<${rawName}${sanitizeSvgAttributes(attributes)}${selfClosing ? '/' : ''}>`;

    if (name === 'style' && !selfClosing) styleDepth += 1;
  }

  const tail = source.slice(lastIndex);

  if (tail.includes('<')) {
    throw new ImageValidationError('SVG contains malformed markup.', 'unsafe_svg');
  }
  if (removingElement) {
    throw new ImageValidationError('SVG contains an unterminated element.', 'unsafe_svg');
  }

  output += styleDepth > 0 ? sanitizeSvgStyleText(tail) : tail;

  if (firstElement !== 'svg') {
    throw new ImageValidationError('SVG markup must have an svg root element.', 'unsafe_svg');
  }

  assertSanitizedSvg(output);
  return output;
}

function isSvgCandidate(input: Buffer): boolean {
  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];

    if (byte === 0xef && input[index + 1] === 0xbb && input[index + 2] === 0xbf) {
      index += 2;
      continue;
    }
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;

    return byte === 0x3c;
  }

  return false;
}

function toProcessingError(error: unknown): ImageValidationError {
  if (error instanceof ImageValidationError) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (/pixel limit/i.test(message)) {
    return new ImageValidationError(
      `Image dimensions must not exceed ${MAX_DECODED_DIMENSION}x${MAX_DECODED_DIMENSION} pixels.`,
      'invalid_dimensions',
    );
  }

  return new ImageValidationError(
    'File content could not be decoded as a supported image.',
    'invalid_image',
  );
}

async function readMetadata(buffer: Buffer): Promise<Metadata> {
  try {
    return await sharp(buffer, SHARP_INPUT_OPTIONS).metadata();
  } catch (error) {
    throw toProcessingError(error);
  }
}

function validateDimensions(metadata: Metadata): { width: number; height: number } {
  const { width, height } = metadata;

  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new ImageValidationError('Image dimensions could not be determined.', 'invalid_image');
  }

  const orientedWidth = metadata.autoOrient?.width ?? width;
  const orientedHeight = metadata.autoOrient?.height ?? height;

  if (!isPositiveInteger(orientedWidth) || !isPositiveInteger(orientedHeight)) {
    throw new ImageValidationError('Image dimensions could not be determined.', 'invalid_image');
  }

  if (
    width > MAX_DECODED_DIMENSION ||
    height > MAX_DECODED_DIMENSION ||
    orientedWidth > MAX_DECODED_DIMENSION ||
    orientedHeight > MAX_DECODED_DIMENSION
  ) {
    throw new ImageValidationError(
      `Image dimensions must not exceed ${MAX_DECODED_DIMENSION}x${MAX_DECODED_DIMENSION} pixels.`,
      'invalid_dimensions',
    );
  }

  return { width, height };
}

async function renderWebp(
  buffer: Buffer,
  kind: 'gallery' | 'asset',
  source: OptimizedImage['source'],
): Promise<OptimizedImage> {
  const maxEdge = kind === 'gallery' ? GALLERY_MAX_EDGE : ASSET_MAX_EDGE;

  try {
    const { data, info } = await sharp(buffer, SHARP_INPUT_OPTIONS)
      .autoOrient()
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      contentType: 'image/webp',
      extension: 'webp',
      width: info.width,
      height: info.height,
      size: data.byteLength,
      source,
    };
  } catch (error) {
    throw toProcessingError(error);
  }
}

async function renderLogoPng(
  buffer: Buffer,
  source: OptimizedImage['source'],
): Promise<OptimizedImage> {
  try {
    const { data, info } = await sharp(buffer, SHARP_INPUT_OPTIONS)
      .autoOrient()
      .resize({
        width: ASSET_MAX_EDGE,
        height: ASSET_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      contentType: 'image/png',
      extension: 'png',
      width: info.width,
      height: info.height,
      size: data.byteLength,
      source,
    };
  } catch (error) {
    throw toProcessingError(error);
  }
}

async function renderLogoSvg(input: Buffer): Promise<OptimizedImage> {
  const sanitized = Buffer.from(sanitizeSvg(input), 'utf8');
  const metadata = await readMetadata(sanitized);

  if (metadata.format !== 'svg') {
    throw new ImageValidationError('Sanitized SVG could not be decoded.', 'invalid_image');
  }

  const { width, height } = validateDimensions(metadata);

  return {
    buffer: sanitized,
    contentType: 'image/svg+xml',
    extension: 'svg',
    width,
    height,
    size: sanitized.byteLength,
    source: {
      format: 'svg',
      width,
      height,
      size: input.byteLength,
    },
  };
}

export async function optimizeImage(
  input: ImageInput,
  options: OptimizeImageOptions,
): Promise<OptimizedImage> {
  const buffer = toBuffer(input);

  if (buffer.byteLength === 0) {
    throw new ImageValidationError('Image file is empty.', 'empty_input');
  }

  if (buffer.byteLength > MAX_INPUT_BYTES) {
    throw new ImageValidationError(
      `Image file must not exceed ${MAX_INPUT_BYTES / (1024 * 1024)} MiB.`,
      'input_too_large',
    );
  }

  const kind = options?.kind;

  if (!isImageKind(kind)) {
    throw new ImageValidationError('Unknown image kind.', 'unsupported_format');
  }

  if (isSvgCandidate(buffer)) {
    if (kind !== 'logo') {
      throw new ImageValidationError('SVG images are only allowed for logos.', 'unsupported_format');
    }

    return renderLogoSvg(buffer);
  }

  const metadata = await readMetadata(buffer);

  if (metadata.format === 'svg') {
    throw new ImageValidationError('SVG input must be UTF-8 encoded text.', 'unsafe_svg');
  }

  if (!RASTER_FORMATS.has(metadata.format)) {
    throw new ImageValidationError(
      'Only JPEG, PNG, and WebP raster images are supported.',
      'unsupported_format',
    );
  }

  const { width, height } = validateDimensions(metadata);
  const source: OptimizedImage['source'] = {
    format: metadata.format as SourceImageFormat,
    width,
    height,
    size: buffer.byteLength,
  };

  if (kind === 'logo') {
    return renderLogoPng(buffer, source);
  }

  return renderWebp(buffer, kind, source);
}
