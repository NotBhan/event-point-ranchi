# Content parity report

Generated 2026-11-01T13:27:19.477Z by `scripts/content-parity.ts`.

Both servers render the same build. The left column reads Cloudflare D1
(`CONTENT_SOURCE=d1`), the right column reads the published Filebase content
(`CONTENT_STORE=filebase`). Only CSRF tokens and whitespace are normalised.

**Result: PASS** — 14/14 routes identical.

| Route | Result | Title present | Differing fields | Fields |
| --- | --- | --- | ---: | --- |
| `/` | pass | yes | 0 | — |
| `/mandaps` | pass | yes | 0 | — |
| `/stages` | pass | yes | 0 | — |
| `/equipment` | pass | yes | 0 | — |
| `/gallery` | pass | yes | 0 | — |
| `/catering` | pass | yes | 0 | — |
| `/contact` | pass | yes | 0 | — |
| `/plan` | pass | yes | 0 | — |
| `/policies` | pass | yes | 0 | — |
| `/privacy` | pass | yes | 0 | — |
| `/terms` | pass | yes | 0 | — |
| `/payment-policy` | pass | yes | 0 | — |
| `/cancellation-refund` | pass | yes | 0 | — |
| `/grievance` | pass | yes | 0 | — |

## Verification basis

Compared per route: HTTP status, `<title>`, meta description, canonical, robots,
Open Graph title/description/image, every `h1`/`h2` in `<main>`, the visible text of
`<main>`, and the full normalised HTML document.

The catalogue routes are included deliberately: they must render identically because
they still read Cloudflare D1 in both servers.

