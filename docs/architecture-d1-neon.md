# Architecture Documentation: Cloudflare D1 + Neon PostgreSQL + Filebase S3

## 1. Overview & System Boundaries

Event Point Ranchi's architecture separates concerns across three authoritative services:

```mermaid
flowchart TD
    subgraph Client ["Client / Browser"]
        PublicVisitors["Public Visitors (Web)"]
        AdminDashboard["Admin & Editor Users (/admin)"]
    end

    subgraph AstroVercel ["Astro.js on Vercel (Edge / Serverless)"]
        AstroSSR["Astro SSR Router ([...path].astro)"]
        ContentService["Content Service (Cached + Invalidatable)"]
        AuthOperationalService["Operational & Auth Service (Neon Client)"]
        StorageEngine["Storage Engine (Quotas & Sharp)"]
    end

    subgraph CloudflareD1 ["Cloudflare D1 (Authoritative Content)"]
        D1DB[("D1 SQLite (REST API)
        - site_settings
        - homepage_sections
        - services
        - mandaps & stages
        - furniture & equipment
        - catering_packages
        - rooms
        - gallery items
        - seo_settings")]
    end

    subgraph NeonDB ["Neon Serverless PostgreSQL (Authoritative Operations)"]
        NeonPostgres[("Neon PostgreSQL
        - users & roles
        - customers
        - bookings & booking_items
        - event_enquiries
        - contact_inquiries
        - storage_objects ledger
        - traffic_events
        - audit_logs")]
    end

    subgraph FilebaseS3 ["Filebase S3 (Object Storage)"]
        S3Bucket[("Bucket: event-point-ranchi
        - WebP & AVIF binaries
        - 3 GiB Gallery Quota
        - 1 GiB Non-Gallery Quota")]
    end

    PublicVisitors -->|Read Content| AstroSSR
    AdminDashboard -->|Manage Site & Ops| AstroSSR
    AstroSSR --> ContentService
    AstroSSR --> AuthOperationalService
    AstroSSR --> StorageEngine

    ContentService -->|HTTPS REST API| D1DB
    AuthOperationalService -->|Pooled TLS| NeonPostgres
    StorageEngine -->|S3 API| S3Bucket
    StorageEngine -.->|Record Ledger| NeonPostgres
```

### Separation of Responsibilities

1. **Website Content (Cloudflare D1)**:
   - Manages all mutable presentation content: site settings, branding, homepage sections, services, mandaps, stages, furniture/equipment, catering packages, rooms, gallery items, and per-page SEO metadata.
   - Accessed from Vercel via Cloudflare D1's HTTPS REST API (`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`) with local SQLite fallback for offline development and testing.
   - Cached in-memory with automatic 15-second TTL and instantaneous invalidation on admin content mutations.

2. **Operations & Authentication (Neon PostgreSQL)**:
   - Manages users, password hashes (PBKDF2/SHA-256), roles (`superadmin`, `admin`, `editor`, `developer`, `customer`), session verification, customer records, booking transactions, event enquiries, contact enquiries, traffic logs, and the Filebase storage ledger.
   - Connected via `@neondatabase/serverless` connection pooling.

3. **Media Storage (Filebase S3)**:
   - Stores image binaries (optimized WebP format).
   - Enforces 3 GiB gallery and 1 GiB non-gallery quotas.
   - Ledger and reservation metadata are committed to Neon PostgreSQL.

4. **Sanity CMS**:
   - Completely removed from dependencies, studio routes, build pipelines, and layout rendering.

---

## 2. Environment Configuration

The following variables configure the system in `.env` and Vercel Project Settings:

```bash
# Neon PostgreSQL Operational Database
DATABASE_URL=postgresql://neondb_owner:password@ep-royal-breeze-arv67inj-pooler.c-4.us-west-2.aws.neon.tech/neondb?sslmode=require

# Cloudflare D1 Website Content Database (HTTP API)
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_DATABASE_ID=your_cloudflare_database_id
CLOUDFLARE_API_TOKEN=your_cloudflare_d1_api_token

# Filebase S3 Object Storage
FILEBASE_ENDPOINT=https://s3.filebase.io
FILEBASE_REGION=auto
FILEBASE_BUCKET=event-point-ranchi
FILEBASE_ACCESS_KEY_ID=your_filebase_key
FILEBASE_SECRET_ACCESS_KEY=your_filebase_secret
FILEBASE_PUBLIC_BASE_URL=https://event-point-ranchi.s3.filebase.io

# Application Secrets & Quotas
APP_SECRET=your_32_byte_hex_secret
GALLERY_STORAGE_LIMIT_BYTES=3221225472   # 3 GiB
ASSET_STORAGE_LIMIT_BYTES=1073741824     # 1 GiB
```

---

## 3. Database Schemas

### Cloudflare D1 Tables (`src/core/content/d1-schema.sql`)
- `site_settings`: Global brand name, tagline, description, phone, whatsapp, email, address, announcement text, colors (`primary_color`, `gold_bright`), logo/favicon URLs.
- `homepage_sections`: Dynamic homepage sections (`hero`, `features`, `process`, `stats`, `test_images`).
- `services`: Service catalogue with category names, descriptions, icons, images, pricing, and sort order.
- `mandaps` & `mandap_gallery`: Wedding mandaps with standard dimensions ($L \times W \times H$), specifications, image URLs, and secondary gallery images.
- `stages` & `stage_gallery`: Reception and wedding stage setups with dimensions, style categories, and gallery photos.
- `furniture_categories` & `furniture_items`: Event equipment (chairs, tables, sofas, decor) with pricing units, quantities, and images.
- `catering_packages`: Food & beverage packages with plate pricing, features, menu sections, and guest pricing tiers.
- `rooms`: Bridal suites and guest room packages with capacity, pricing, and features.
- `gallery_categories` & `gallery_items`: Photo portfolio items with categories, captions, alt text, and image URLs.
- `seo_settings`: Per-page SEO metadata (`meta_title`, `meta_description`, `canonical_url`, `og_image_url`).

### Neon PostgreSQL Tables (`src/core/operational/neon-schema.sql`)
- `users`: User authentication, roles (`superadmin`, `admin`, `editor`, `developer`, `customer`), status, and password hashes.
- `customers`: Customer profiles linked to users.
- `bookings` & `booking_items`: Event venue and equipment booking orders with payment statuses.
- `event_enquiries` & `enquiry_line_items`: Inquiries for weddings and events with itemized requirement lists.
- `contact_inquiries`: General contact and inquiry form submissions.
- `storage_objects` & `storage_reservations`: Filebase ledger tracking object keys, bytes, sha256 checksums, and categories.
- `traffic_events`: Analytics logging page visits, referrers, and user agents.
- `audit_logs`: Administrative action tracking.

---

## 4. Admin Content Management Interface

The admin content management interface is located at `/admin/content`:
- **Role Permissions**: Accessible by administrators and dedicated content editors (`requireEditor`). Content editors are automatically restricted to content management.
- **Site Settings & Branding**: Update site name, tagline, description, announcement bar text, phone, WhatsApp direct number, and brand colors (burgundy `#721224` and gold `#e0b868`).
- **Page SEO Defaults**: Edit page meta titles, descriptions, and canonical URLs for `home`, `mandaps`, `stages`, `furniture`, `catering`, `rooms`, `gallery`, and `contact`.
- **Immediate Invalidation**: Any update calls `invalidateContentCache()`, instantaneously refreshing public Astro pages.

---

## 5. Verification & Testing

Run all automated checks and builds:
```bash
# Astro TypeScript and template diagnostics (0 errors, 0 warnings)
npm run check

# Full automated test suite (38 passing tests)
npm test

# Production Vercel serverless build
npm run build:vercel
```
