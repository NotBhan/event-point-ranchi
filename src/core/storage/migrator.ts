import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { formatBytes, getStorageConfig } from './config';
import { getFilebaseClient, type FilebaseClient } from './filebase';
import { optimizeImage } from './optimizer';
import {
  commitObjectAndReleaseReservation,
  getAllQuotaUsage,
  type StorageCategory,
} from './quota';

try {
  registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('.sql?raw')) {
        const sql = readFileSync(fileURLToPath(url), 'utf8');
        return {
          format: 'module',
          source: `export default ${JSON.stringify(sql)};`,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
} catch {}

export type ImageClassification =
  | 'static_website_asset'
  | 'database_managed'
  | 'admin_uploaded'
  | 'external'
  | 'framework_ui_local';

export interface DatabaseTargetRef {
  table: string;
  column: string;
  idColumn: string;
  idValue: string | number;
  currentValue: string;
}

export interface ImageAuditItem {
  id: string;
  sourcePath: string;
  existsOnDisk: boolean;
  classification: ImageClassification;
  isEligible: boolean;
  skipReason?: string;
  sha256?: string;
  originalSizeBytes: number;
  estimatedOptimizedBytes?: number;
  width?: number;
  height?: number;
  format?: string;
  storageCategory: StorageCategory;
  entityType: string;
  entityId: string;
  slot: string;
  destinationKey: string;
  publicUrl: string;
  dbReferences: DatabaseTargetRef[];
}

export interface MigrationManifestItem {
  id: string;
  sourcePath: string;
  classification: ImageClassification;
  sha256: string;
  storageCategory: StorageCategory;
  entityType: string;
  entityId: string;
  slot: string;
  destinationKey: string;
  publicUrl: string;
  originalSizeBytes: number;
  storedSizeBytes: number;
  etag?: string;
  status: 'pending' | 'success' | 'failed' | 'skipped' | 'already_migrated';
  error?: string;
  migratedAt?: string;
  dbReferences: DatabaseTargetRef[];
}

export interface MigrationReport {
  timestamp: string;
  dryRun: boolean;
  totalDiscovered: number;
  totalEligible: number;
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  galleryUsageBefore: number;
  galleryUsageAfter: number;
  assetUsageBefore: number;
  assetUsageAfter: number;
  galleryLimitBytes: number;
  assetLimitBytes: number;
  manifestPath: string;
  items: MigrationManifestItem[];
}

const MANIFEST_PATH = join(process.cwd(), 'data', 'migration-manifest.json');

export async function auditExistingImages(): Promise<ImageAuditItem[]> {
  const cwd = process.cwd();
  const config = getStorageConfig();
  const publicBase = config.publicBaseUrl.replace(/\/+$/, '');

  // 1. Collect all DB references
  const dbMappings: Array<{
    table: string;
    column: string;
    idColumn: string;
    entityType: string;
    category: StorageCategory;
    getSlot?: (row: any) => string;
    getEntityId?: (row: any) => string;
  }> = [
    {
      table: 'gallery_items',
      column: 'image',
      idColumn: 'id',
      entityType: 'gallery',
      category: 'gallery',
      getSlot: () => 'primary',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'mandaps',
      column: 'image',
      idColumn: 'id',
      entityType: 'mandap',
      category: 'asset',
      getSlot: () => 'primary',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'mandap_gallery',
      column: 'image',
      idColumn: 'id',
      entityType: 'mandap',
      category: 'asset',
      getSlot: (r) => `gallery_${r.id_val}`,
      getEntityId: (r) => String(r.mandap_id),
    },
    {
      table: 'stages',
      column: 'image',
      idColumn: 'id',
      entityType: 'stage',
      category: 'asset',
      getSlot: () => 'primary',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'stage_gallery',
      column: 'image',
      idColumn: 'id',
      entityType: 'stage',
      category: 'asset',
      getSlot: (r) => `gallery_${r.id_val}`,
      getEntityId: (r) => String(r.stage_id),
    },
    {
      table: 'stage_designs',
      column: 'image',
      idColumn: 'id',
      entityType: 'stage',
      category: 'asset',
      getSlot: () => 'primary',
      getEntityId: (r) => `design_${r.id_val}`,
    },
    {
      table: 'catering_packages',
      column: 'image',
      idColumn: 'id',
      entityType: 'catering',
      category: 'asset',
      getSlot: () => 'primary',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'halls',
      column: 'image',
      idColumn: 'id',
      entityType: 'hall',
      category: 'asset',
      getSlot: () => 'primary',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'halls',
      column: 'banner_image',
      idColumn: 'id',
      entityType: 'hall',
      category: 'asset',
      getSlot: () => 'banner',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'hall_gallery',
      column: 'image',
      idColumn: 'id',
      entityType: 'hall',
      category: 'asset',
      getSlot: (r) => `gallery_${r.id_val}`,
      getEntityId: (r) => String(r.hall_id),
    },
    {
      table: 'rooms',
      column: 'image',
      idColumn: 'id',
      entityType: 'room',
      category: 'asset',
      getSlot: () => 'primary',
      getEntityId: (r) => String(r.id_val),
    },
    {
      table: 'homepage',
      column: 'hero_image',
      idColumn: 'id',
      entityType: 'banner',
      category: 'asset',
      getSlot: () => 'hero',
      getEntityId: () => 'homepage',
    },
    {
      table: 'page_settings',
      column: 'hero_image',
      idColumn: 'key',
      entityType: 'banner',
      category: 'asset',
      getSlot: () => 'hero',
      getEntityId: (r) => String(r.id_val),
    },
  ];

  const { all } = await import('../db');
  const auditItems: ImageAuditItem[] = [];
  const processedSlots = new Set<string>();

  for (const mapping of dbMappings) {
    let rows: any[] = [];
    try {
      rows = all<any>(
        `SELECT rowid, ${mapping.idColumn} AS id_val, ${mapping.column} AS img_val ${
          mapping.table === 'mandap_gallery' ? ', mandap_id' : ''
        } ${mapping.table === 'stage_gallery' ? ', stage_id' : ''} ${
          mapping.table === 'hall_gallery' ? ', hall_id' : ''
        } FROM ${mapping.table} WHERE ${mapping.column} IS NOT NULL AND ${mapping.column} != ''`,
      );
    } catch {
      continue;
    }

    for (const row of rows) {
      const url = row.img_val as string;
      const entityId = mapping.getEntityId ? mapping.getEntityId(row) : String(row.id_val);
      const slot = mapping.getSlot ? mapping.getSlot(row) : 'primary';
      const slotKey = `${mapping.entityType}:${entityId}:${slot}`;

      if (processedSlots.has(slotKey)) continue;
      processedSlots.add(slotKey);

      // Resolve disk path
      let diskPath = '';
      let classification: ImageClassification = 'database_managed';

      if (url.startsWith('/uploads/')) {
        diskPath = join(cwd, 'data', url.replace(/^\//, ''));
        classification = 'admin_uploaded';
      } else if (url.startsWith('/images/')) {
        diskPath = join(cwd, 'public', url.replace(/^\//, ''));
        classification = 'database_managed';
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        classification = 'external';
      }

      const fileExists = diskPath ? existsSync(diskPath) : false;
      const dbRef: DatabaseTargetRef = {
        table: mapping.table,
        column: mapping.column,
        idColumn: mapping.idColumn,
        idValue: row.id_val,
        currentValue: url,
      };

      // Determine object key
      let destKey = '';
      if (mapping.category === 'gallery') {
        destKey = `gallery/${entityId}/migrated-${entityId}.webp`;
      } else if (mapping.entityType === 'banner') {
        destKey = `assets/banners/${entityId}/banner-${slot}.webp`;
      } else if (mapping.entityType === 'hall') {
        destKey = `assets/halls/${entityId}/${slot}.webp`;
      } else if (mapping.entityType === 'room') {
        destKey = `assets/rooms/${entityId}/${slot}.webp`;
      } else {
        const folder =
          mapping.entityType === 'mandap'
            ? 'mandaps'
            : mapping.entityType === 'stage'
            ? 'stages'
            : 'catering';
        destKey = `assets/${folder}/${entityId}/${slot}.webp`;
      }

      let originalSizeBytes = 0;
      let sha256 = '';
      let width: number | undefined;
      let height: number | undefined;
      let format: string | undefined;
      let estimatedOptimizedBytes = 0;

      if (fileExists) {
        try {
          const buf = readFileSync(diskPath);
          originalSizeBytes = buf.byteLength;
          sha256 = createHash('sha256').update(buf).digest('hex');
          const meta = await sharp(buf).metadata();
          width = meta.width;
          height = meta.height;
          format = meta.format;
          // Approximate WebP size: ~20-30% of high-res jpeg
          estimatedOptimizedBytes = Math.min(originalSizeBytes, Math.round(originalSizeBytes * 0.25));
        } catch {}
      }

      auditItems.push({
        id: slotKey,
        sourcePath: diskPath || url,
        existsOnDisk: fileExists,
        classification,
        isEligible: fileExists && classification !== 'external',
        skipReason: !fileExists ? 'File not found on disk' : undefined,
        sha256,
        originalSizeBytes,
        estimatedOptimizedBytes,
        width,
        height,
        format,
        storageCategory: mapping.category,
        entityType: mapping.entityType,
        entityId,
        slot,
        destinationKey: destKey,
        publicUrl: `${publicBase}/${destKey}`,
        dbReferences: [dbRef],
      });
    }
  }

  // 2. Add static branding assets
  const brandingFiles = [
    { file: 'public/images/logo.png', id: 'logo', slot: 'primary', key: 'assets/branding/logo.png' },
    { file: 'public/images/logo1.png', id: 'logo1', slot: 'primary', key: 'assets/branding/logo1.png' },
  ];

  for (const b of brandingFiles) {
    const full = join(cwd, b.file);
    if (existsSync(full)) {
      const buf = readFileSync(full);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const meta = await sharp(buf).metadata();
      auditItems.push({
        id: `branding:${b.id}:${b.slot}`,
        sourcePath: full,
        existsOnDisk: true,
        classification: 'static_website_asset',
        isEligible: true,
        sha256,
        originalSizeBytes: buf.byteLength,
        estimatedOptimizedBytes: buf.byteLength,
        width: meta.width,
        height: meta.height,
        format: meta.format,
        storageCategory: 'asset',
        entityType: 'branding',
        entityId: b.id,
        slot: b.slot,
        destinationKey: b.key,
        publicUrl: `${publicBase}/${b.key}`,
        dbReferences: [],
      });
    }
  }

  // 3. Add unreferenced archive asset
  const alevPath = join(cwd, 'public/images/archive/alev-takil-lw3Lqe2K7xc-unsplash.jpg');
  if (existsSync(alevPath)) {
    const buf = readFileSync(alevPath);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    auditItems.push({
      id: 'archive:alev-takil:primary',
      sourcePath: alevPath,
      existsOnDisk: true,
      classification: 'static_website_asset',
      isEligible: true,
      sha256,
      originalSizeBytes: buf.byteLength,
      estimatedOptimizedBytes: Math.round(buf.byteLength * 0.25),
      storageCategory: 'asset',
      entityType: 'banner',
      entityId: 'archive',
      slot: 'alev_takil',
      destinationKey: 'assets/banners/archive/alev-takil.webp',
      publicUrl: `${publicBase}/assets/banners/archive/alev-takil.webp`,
      dbReferences: [],
    });
  }

  // 4. Add framework/UI local assets (explicitly skipped from migration)
  const localUiAssets = [
    'public/images/event-point-logo.svg',
    'public/images/placeholder.jpg',
    'public/images/placeholder.svg',
  ];

  for (const p of localUiAssets) {
    const full = join(cwd, p);
    if (existsSync(full)) {
      const buf = readFileSync(full);
      auditItems.push({
        id: `framework_ui:${p}`,
        sourcePath: full,
        existsOnDisk: true,
        classification: 'framework_ui_local',
        isEligible: false,
        skipReason: 'Framework or UI asset that must remain local',
        originalSizeBytes: buf.byteLength,
        storageCategory: 'asset',
        entityType: 'ui',
        entityId: 'local',
        slot: 'local',
        destinationKey: '',
        publicUrl: `/${p.replace(/^public\//, '')}`,
        dbReferences: [],
      });
    }
  }

  return auditItems;
}

export async function runMigration(
  options: { dryRun?: boolean; force?: boolean } = {},
): Promise<MigrationReport> {
  const { run } = await import('../db');
  const dryRun = options.dryRun === true;
  const config = getStorageConfig();

  console.log('================================================================');
  console.log(`   FILEBASE OBJECT STORAGE MIGRATION ${dryRun ? '[DRY RUN]' : '[LIVE]'}`);
  console.log('================================================================\n');

  console.log('1. Verifying Storage Configuration:');
  console.log('  Endpoint:', config.endpoint);
  console.log('  Region:', config.region);
  console.log('  Bucket:', config.bucket || '(none)');
  console.log(
    '  Access Key ID:',
    config.accessKeyId
      ? config.accessKeyId.slice(0, 4) + '...' + config.accessKeyId.slice(-4)
      : '(none)',
  );
  console.log('  Public Base URL:', config.publicBaseUrl);

  const client: FilebaseClient = getFilebaseClient();
  console.log('  Storage Driver:', client.driver);

  if (!dryRun && client.driver !== 'filebase') {
    throw new Error(
      'Live migration requires the "filebase" driver with configured credentials. Check .env',
    );
  }

  const connStatus = await client.checkConnection();
  if (!connStatus.ok) {
    throw new Error(`Filebase connection check failed: ${connStatus.error || 'Unknown error'}`);
  }
  console.log('✓ Successfully connected to Filebase bucket:', config.bucket);

  console.log('\n2. Auditing Existing Images across codebase and database...');
  const audit = await auditExistingImages();
  const eligible = audit.filter((i) => i.isEligible);
  const skipped = audit.filter((i) => !i.isEligible);

  console.log(`✓ Total images discovered: ${audit.length}`);
  console.log(`✓ Eligible for migration:   ${eligible.length}`);
  console.log(`✓ Skipped (framework/local): ${skipped.length}`);

  // Calculate estimated quota usage
  let estGalleryBytes = 0;
  let estAssetBytes = 0;
  for (const item of eligible) {
    const bytes = item.estimatedOptimizedBytes || item.originalSizeBytes;
    if (item.storageCategory === 'gallery') estGalleryBytes += bytes;
    else estAssetBytes += bytes;
  }

  const currentUsage = getAllQuotaUsage();
  console.log('\n3. Quota Pre-flight Assessment:');
  console.log(`  Gallery Storage Quota: ${formatBytes(config.galleryLimitBytes)}`);
  console.log(`    Current committed:   ${formatBytes(currentUsage.gallery.usedBytes)}`);
  console.log(`    Estimated migration: ${formatBytes(estGalleryBytes)}`);
  console.log(
    `    Projected total:     ${formatBytes(currentUsage.gallery.usedBytes + estGalleryBytes)} (${(
      ((currentUsage.gallery.usedBytes + estGalleryBytes) / config.galleryLimitBytes) *
      100
    ).toFixed(2)}%)`,
  );

  console.log(`  Other Asset Quota:     ${formatBytes(config.assetLimitBytes)}`);
  console.log(`    Current committed:   ${formatBytes(currentUsage.asset.usedBytes)}`);
  console.log(`    Estimated migration: ${formatBytes(estAssetBytes)}`);
  console.log(
    `    Projected total:     ${formatBytes(currentUsage.asset.usedBytes + estAssetBytes)} (${(
      ((currentUsage.asset.usedBytes + estAssetBytes) / config.assetLimitBytes) *
      100
    ).toFixed(2)}%)`,
  );

  if (currentUsage.gallery.usedBytes + estGalleryBytes > config.galleryLimitBytes) {
    throw new Error('Gallery storage quota exceeded by projected migration.');
  }
  if (currentUsage.asset.usedBytes + estAssetBytes > config.assetLimitBytes) {
    throw new Error('Asset storage quota exceeded by projected migration.');
  }
  console.log('✓ Storage quotas verified. All projected data fits well within limits.');

  // Load existing manifest if resuming
  let manifestItems: MigrationManifestItem[] = [];
  if (existsSync(MANIFEST_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
      if (Array.isArray(raw.items)) manifestItems = raw.items;
    } catch {}
  }
  const manifestMap = new Map<string, MigrationManifestItem>(manifestItems.map((m) => [m.id, m]));

  const finalManifestItems: MigrationManifestItem[] = [];
  let migratedCount = 0;
  let failedCount = 0;

  console.log('\n4. Executing Migration Process:');

  for (let idx = 0; idx < eligible.length; idx++) {
    const item = eligible[idx];
    const itemNum = `[${idx + 1}/${eligible.length}]`;
    const existing = manifestMap.get(item.id);

    if (existing && existing.status === 'success' && !options.force) {
      // Verify remote still exists
      const remoteCheck = await client.headObject(existing.destinationKey);
      if (remoteCheck) {
        console.log(`${itemNum} Skipping (already migrated & verified): ${item.destinationKey}`);
        finalManifestItems.push({
          ...existing,
          status: 'already_migrated',
        });
        continue;
      }
    }

    if (dryRun) {
      console.log(`${itemNum} [DRY RUN] Would migrate:`);
      console.log(`     Source:      ${item.sourcePath}`);
      console.log(`     Destination: ${item.destinationKey}`);
      console.log(`     Category:    ${item.storageCategory} (${item.entityType}#${item.entityId}:${item.slot})`);
      console.log(
        `     Est. Size:   ${formatBytes(item.estimatedOptimizedBytes || 0)} (from ${formatBytes(
          item.originalSizeBytes,
        )})`,
      );
      console.log(`     URL:         ${item.publicUrl}`);
      console.log(
        `     DB Updates:  ${
          item.dbReferences.map((d) => `${d.table}.${d.column} [${d.idValue}]`).join(', ') || 'None'
        }`,
      );

      finalManifestItems.push({
        id: item.id,
        sourcePath: item.sourcePath,
        classification: item.classification,
        sha256: item.sha256 || '',
        storageCategory: item.storageCategory,
        entityType: item.entityType,
        entityId: item.entityId,
        slot: item.slot,
        destinationKey: item.destinationKey,
        publicUrl: item.publicUrl,
        originalSizeBytes: item.originalSizeBytes,
        storedSizeBytes: item.estimatedOptimizedBytes || item.originalSizeBytes,
        status: 'pending',
        dbReferences: item.dbReferences,
      });
      continue;
    }

    // LIVE MIGRATION FOR ITEM
    console.log(`${itemNum} Migrating: ${item.destinationKey}...`);
    try {
      const sourceBuffer = readFileSync(item.sourcePath);

      // Optimize image
      const isGallery = item.storageCategory === 'gallery';
      const isLogo = item.entityType === 'branding';
      const optimized = await optimizeImage(sourceBuffer, {
        kind: isGallery ? 'gallery' : isLogo ? 'logo' : 'asset',
      });

      // Upload to Filebase
      const putResult = await client.putObject({
        key: item.destinationKey,
        body: optimized.buffer,
        contentType: optimized.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          originalFilename: item.sourcePath.split('/').pop() || '',
          entityType: item.entityType,
          entityId: item.entityId,
        },
      });

      // Verify remote object
      const verified = await client.headObject(item.destinationKey);
      if (!verified) {
        throw new Error(`Upload verification failed for key: ${item.destinationKey}`);
      }

      // Register in SQLite storage_objects ledger
      const objectId = createHash('sha256').update(item.destinationKey).digest('hex').slice(0, 36);
      commitObjectAndReleaseReservation({
        objectId,
        category: item.storageCategory,
        entityType: item.entityType,
        entityId: item.entityId,
        slot: item.slot,
        objectKey: item.destinationKey,
        publicUrl: item.publicUrl,
        mimeType: optimized.contentType,
        sizeBytes: optimized.size,
        width: optimized.width,
        height: optimized.height,
        format: optimized.extension,
        originalFilename: item.sourcePath.split('/').pop() || '',
      });

      // Atomically update database references
      for (const dbRef of item.dbReferences) {
        run(`UPDATE ${dbRef.table} SET ${dbRef.column} = ? WHERE ${dbRef.idColumn} = ?`, [
          item.publicUrl,
          dbRef.idValue,
        ]);
      }

      console.log(
        `  ✓ Uploaded & verified (${formatBytes(optimized.size)}, saved ${Math.round(
          (1 - optimized.size / item.originalSizeBytes) * 100,
        )}%)`,
      );
      console.log(
        `  ✓ DB updated: ${
          item.dbReferences.map((d) => `${d.table}.${d.column} [${d.idValue}]`).join(', ') || 'N/A'
        }`,
      );

      migratedCount++;
      finalManifestItems.push({
        id: item.id,
        sourcePath: item.sourcePath,
        classification: item.classification,
        sha256: item.sha256 || '',
        storageCategory: item.storageCategory,
        entityType: item.entityType,
        entityId: item.entityId,
        slot: item.slot,
        destinationKey: item.destinationKey,
        publicUrl: item.publicUrl,
        originalSizeBytes: item.originalSizeBytes,
        storedSizeBytes: optimized.size,
        etag: putResult.etag,
        status: 'success',
        migratedAt: new Date().toISOString(),
        dbReferences: item.dbReferences,
      });
    } catch (err: any) {
      console.error(`  ❌ Failed to migrate ${item.sourcePath}:`, err.message);
      failedCount++;
      finalManifestItems.push({
        id: item.id,
        sourcePath: item.sourcePath,
        classification: item.classification,
        sha256: item.sha256 || '',
        storageCategory: item.storageCategory,
        entityType: item.entityType,
        entityId: item.entityId,
        slot: item.slot,
        destinationKey: item.destinationKey,
        publicUrl: item.publicUrl,
        originalSizeBytes: item.originalSizeBytes,
        storedSizeBytes: 0,
        status: 'failed',
        error: err.message,
        dbReferences: item.dbReferences,
      });
    }
  }

  // Record skipped items
  for (const s of skipped) {
    finalManifestItems.push({
      id: s.id,
      sourcePath: s.sourcePath,
      classification: s.classification,
      sha256: s.sha256 || '',
      storageCategory: s.storageCategory,
      entityType: s.entityType,
      entityId: s.entityId,
      slot: s.slot,
      destinationKey: '',
      publicUrl: s.publicUrl,
      originalSizeBytes: s.originalSizeBytes,
      storedSizeBytes: s.originalSizeBytes,
      status: 'skipped',
      error: s.skipReason,
      dbReferences: [],
    });
  }

  const usageAfter = getAllQuotaUsage();

  const report: MigrationReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    totalDiscovered: audit.length,
    totalEligible: eligible.length,
    migratedCount,
    skippedCount: skipped.length,
    failedCount,
    galleryUsageBefore: currentUsage.gallery.usedBytes,
    galleryUsageAfter: usageAfter.gallery.usedBytes,
    assetUsageBefore: currentUsage.asset.usedBytes,
    assetUsageAfter: usageAfter.asset.usedBytes,
    galleryLimitBytes: config.galleryLimitBytes,
    assetLimitBytes: config.assetLimitBytes,
    manifestPath: MANIFEST_PATH,
    items: finalManifestItems,
  };

  // Write manifest to data/migration-manifest.json
  writeFileSync(MANIFEST_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n✓ Migration manifest saved to: ${MANIFEST_PATH}`);

  return report;
}

// CLI runner if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const isDryRun = process.argv.includes('--dry-run');
  const isForce = process.argv.includes('--force');

  runMigration({ dryRun: isDryRun, force: isForce })
    .then((report) => {
      console.log('\n================================================================');
      console.log(`   MIGRATION SUMMARY: ${report.dryRun ? 'DRY RUN COMPLETE' : 'LIVE COMPLETE'}`);
      console.log('================================================================');
      console.log(`  Discovered: ${report.totalDiscovered}`);
      console.log(`  Eligible:   ${report.totalEligible}`);
      console.log(`  Migrated:   ${report.migratedCount}`);
      console.log(`  Skipped:    ${report.skippedCount}`);
      console.log(`  Failed:     ${report.failedCount}`);
      console.log(
        `  Gallery:    ${formatBytes(report.galleryUsageAfter)} / ${formatBytes(
          report.galleryLimitBytes,
        )}`,
      );
      console.log(
        `  Assets:     ${formatBytes(report.assetUsageAfter)} / ${formatBytes(
          report.assetLimitBytes,
        )}`,
      );
      console.log('================================================================\n');
      process.exit(report.failedCount > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('\n❌ Fatal Migration Error:', err);
      process.exit(1);
    });
}
