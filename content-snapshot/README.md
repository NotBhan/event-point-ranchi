# Content snapshots (generated)

This directory holds the build-time public content snapshot consumed by the
Astro app. The JSON files are **generated** by:

```bash
npm run sync:content
```

- `public-content.json` — published/visible public content fetched from
  Cloudflare D1 in a single batched request (settings, page content, SEO,
  homepage sections, services, mandaps, stages, furniture, catering, gallery,
  video previews).
- `manifest.json` — schema version, deterministic content version, timestamp
  and entity counts.

Only the JSON files are gitignored; this README keeps the directory present so
the Vite/Rollup glob that inlines the snapshot always resolves.

Production builds run the sync automatically (`npm run build:vercel`). Local
development without a snapshot falls back to live D1 reads.
