# Royal Palace — Astro Event Management System

An Astro (SSR) port of the Django `event-management-system-2026` project, rebuilt as a set of
**self-registering feature modules** so that features can be added or removed without touching
shared code.

```bash
npm install
npm run dev          # http://localhost:4321  (seeds the database on first request)

npm run check        # astro check — types + templates
npm run build        # check + production build
npm start            # run the built server (needs a build first)
npm run db:reset     # delete the SQLite file; it is reseeded on the next request
```

### Seeded accounts

| Role | Username | Password |
| --- | --- | --- |
| Developer (full admin) | `admin` | `Admin@Royal2026!` |
| Superadmin | `superadmin` | `Super@Royal2026!` |
| Admin (operations) | `event_manager` | `Manager@Royal2026!` |
| Customers | `rohit_sharma`, `priya_patel`, `vikram_mehta`, `ananya_singh`, `kavita_reddy`, `arjun_kapoor` | `Client@2026!` |

Admin console: `/admin`. Customer account pages: `/profile`, `/my-bookings`.

---

## Why the structure looks like this

The Django project was organised as apps (`halls`, `rooms`, `catering`, `booking`, `cart`, `accounts`, `cms`, …)
but the wiring was duplicated across `urls.py`, `views.py`, `templates/` and `static/` files of each app,
and the core booking maths lived in three places (server view, `unified_summary.js`, `booking_overview.js`).

This port keeps the domain split but makes each feature a **single folder that owns its routes, data access,
pages and client code**, and registers itself:

```
src/
├── core/                     # framework-agnostic kernel (no site features)
│   ├── types.ts              # module + route contracts
│   ├── define-module.ts      # defineModule() helper
│   ├── registry.ts           # auto-discovers modules, matches routes, builds nav
│   ├── db.ts                 # node:sqlite client, schema bootstrap, seeding
│   ├── schema.sql            # full relational schema
│   ├── seed.ts               # demo venues, menus, bookings, staff
│   ├── auth.ts               # password hashing, signed sessions, route guards
│   ├── csrf.ts               # double-submit CSRF tokens
│   ├── flash.ts              # one-shot flash cookies (toasts)
│   ├── http.ts               # money/date formatting, form parsing, responses
│   ├── uploads.ts            # validated image uploads
│   └── api-dispatch.ts       # shared JSON API dispatcher
│
├── modules/                  # ← every feature lives here
│   ├── home/                 # module.ts · service.ts · pages/
│   ├── halls/
│   ├── rooms/
│   ├── catering/
│   ├── cart/
│   ├── bookings/
│   ├── accounts/
│   ├── gallery/
│   ├── contact/
│   ├── admin/                # handlers/ · pages/ · service.ts
│   ├── media/                # serves uploaded files
│   └── about/
│
├── components/               # shared Astro components (Header, Footer, cards, icons)
├── layouts/                  # BaseLayout (public), AdminLayout (console)
├── client/                   # browser modules (cart, summaries, page controllers)
├── pages/
│   ├── [...path].astro       # renders whichever module owns the URL
│   ├── api/[...path].ts      # JSON APIs registered by modules
│   └── uploads/[...path].ts  # uploaded media
├── styles/                   # tokens + base + components + cards + admin
└── middleware.ts             # DB bootstrap, auth context, CSRF enforcement
```

`src/core/registry.ts` discovers modules with `import.meta.glob('/src/modules/*/module.ts', { eager: true })`.
There is **no central list of routes to update** — adding or deleting a folder is enough.

---

## Adding a feature (frictionless path)

1. Create `src/modules/reviews/`.
2. Add a `module.ts`:

```ts
import { defineModule } from '../../core/define-module';
import ReviewsPage from './pages/ReviewsPage.astro';
import { loadReviews } from './service';

export default defineModule({
  id: 'reviews',
  label: 'Reviews',
  order: 65,                                        // nav order
  nav: [{ label: 'Reviews', href: '/reviews', order: 65 }],
  routes: [
    { path: '/reviews', component: ReviewsPage, handle: () => ({ props: { reviews: loadReviews() } }) },
    { path: '/reviews/:id', component: ReviewsPage, handle: ({ params }) => ({ props: loadReviews(Number(params.id)) }) },
  ],
  api: [
    { path: '/api/reviews', method: 'POST', handle: createReview },
  ],
});
```

3. Add `service.ts` (DB queries), `pages/*.astro` (UI) and optional `reviews.css`.

That is the whole integration: the router picks up the routes, the header and footer pick up the nav
entry, the admin sidebar picks up `adminNav`, and duplicate-route mistakes fail loudly at boot with the
two conflicting module ids.

**Removing a feature** is the same in reverse: delete (or rename) the folder, or set `enabled: false`
in its module definition, or add its id to `DISABLED_MODULES` in `.env`. Its routes, APIs and nav
entries disappear with it — no dangling references (`DISABLED_MODULES=gallery,about` turns both the
`/gallery` and `/about` routes into 404s and drops them from the header/footer). Admin screens live in
the `admin` module, which reads the same tables, so leaving it enabled while a storefront module is off
is safe.

### Module contract

```ts
interface AppModule {
  id: string;
  label: string;
  enabled?: boolean;          // false = skip registration entirely
  order?: number;             // nav ordering
  nav?: NavItem[];            // public header/footer links
  adminNav?: AdminNavItem[];  // admin console sidebar
  routes?: PageRoute[];       // path, .astro component, data handler
  api?: ApiRoute[];           // path, HTTP method, Response handler
}
```

Page handlers return either `{ props, status? }` (the router renders the component) or a `Response`
(redirects/errors), so form posts and GET rendering live side by side:

```ts
handle: async (ctx) => {
  if (ctx.request.method === 'POST') {           // ctx.form is already parsed
    setSuccess(ctx.cookies, 'Saved.');
    return redirect('/admin/halls');
  }
  return { props: { halls: listHalls() } };
}
```

---

## Data layer

- **`node:sqlite`** (built into Node ≥ 22.5) — no native build step, no ORM.
- Money is stored as **integer paise**; `formatMoney`/`parseMoneyToPaise` handle presentation and parsing,
  so no float rounding errors.
- `getDb()` creates `data/royal-palace.db`, applies `schema.sql`, and seeds demo content only when the
  `users` table is empty. `npm run db:reset` forces a fresh seed.
- Uploaded images go to `data/uploads/<folder>/` and are served by the `media` module; the DB stores
  `/uploads/...` paths. Seed images live in `public/images/archive/`.

## Security model (what the port enforces)

- Passwords: `scrypt` hashes (`scrypt$salt$hash`), verified with `timingSafeEqual`.
- Sessions: HMAC-signed, `httpOnly`, `SameSite=Lax` cookies. The payload fingerprints the password hash,
  so **changing a password invalidates every existing session** for that user.
- CSRF: double-submit token cookie (`rp_csrf`) checked on every non-GET request — form field `_csrf` or
  `x-csrf-token` header. Enforced centrally in `src/middleware.ts`, so a new module cannot forget it.
- Guards: `requireCustomer()` / `requireAdmin()` / `requireDeveloper()` from `core/auth.ts`.
- Uploads: MIME/extension allow-list, 8 MB cap, random filenames, SVG script rejection, traversal-proof
  path handling in the media module.
- The admin console is `noindex` and never renders the public cart.

## Corrections carried over from the Django build

Bugs in the original that were fixed while porting:

1. **Quotation relations** — the invoice template read `booking.hall` / `booking.stage` although the
   models expose `hall_booking` / `stage`; line items silently rendered empty. The invoice now joins each
   line item explicitly.
2. **Guest pricing tiers were dead data** — `GuestPricing.price_per_plate` was stored but never used;
   bookings always charged the package base price. Tiers (and the custom plate count) now price the booking.
3. **Server-side authority** — prices, quantities, tier rates and totals are recomputed from the database
   on submit; the browser cart is only a proposal.
4. **Double bookings** — the same hall could be booked twice for one date. Hall/date conflicts are rejected
   with a clear message before anything is written.
5. **Room inventory** — quantities above `total_rooms` were accepted. Now validated.
6. **Contact form never persisted anything** — inquiries are now stored and appear in the admin console.
7. **Invoice IDOR** — any visitor could open `/booking/<id>/quotation/`. Access is now limited to the owner,
   an admin, or a per-booking access token issued at checkout.
8. **Client-side XSS surface** — the cart/summary rendered localStorage values into `innerHTML` unescaped;
   everything interpolated in the port is escaped.
9. **Session invalidation** — password changes now revoke existing sessions (password-hash fingerprint).
10. **Money as floats** — Django `Decimal` values are stored as integer paise here, with one formatter used
    by server-rendered pages and client scripts alike.
11. **Alias route sprawl** (`/caterings/`, `.../alias/`, `furniture/<id>/edit` vs `furniture/edit/<id>`, …)
    is replaced by canonical paths; a couple of legacy URLs (`/room`, `/cms`) still resolve.

## Route map

| Public | Admin |
| --- | --- |
| `/` homepage | `/admin` dashboard |
| `/halls`, `/halls/:slug` | `/admin/bookings`, `/admin/bookings/:id` |
| `/rooms` (and legacy `/room`) | `/admin/halls`, `/admin/halls/new`, `/admin/halls/:id` |
| `/catering`, `/catering/:slug` | `/admin/rooms`, `/admin/rooms/:id` |
| `/cart` event cart | `/admin/catering`, `/admin/catering/:id` (menu builder) |
| `/booking/overview` checkout | `/admin/gallery` (upload/manage) |
| `/booking/:id/quotation` invoice | `/admin/customers`, `/admin/customers/:id` |
| `/login`, `/register`, `/logout` | `/admin/inquiries` |
| `/profile`, `/my-bookings` | `/admin/content` (heroes, feature tiles, contact) |
| `/about`, `/gallery`, `/contact` | `/admin/login`, `/admin/logout` |

JSON APIs: `POST /api/bookings` (server-priced booking creation).

## Environment

Copy `.env.example` to `.env`:

| Variable | Purpose |
| --- | --- |
| `APP_SECRET` | HMAC key for session cookies — set this in production |
| `DATA_DIR` | SQLite + uploads directory (default `./data`) |
| `DISABLED_MODULES` | Comma-separated module ids to switch off, e.g. `gallery,about` |
| `COOKIE_SECURE` | `true` to mark session cookies `Secure` (HTTPS deployments) |
