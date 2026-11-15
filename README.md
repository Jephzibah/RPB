# starter-static

Starter template for small, fast marketing and e-commerce sites.

- **Build:** Vite + SCSS, using the same approach as Starter-LP2025. Partials, responsive images, sitemap and security headers are all generated at build time.
- **Hosting:** Cloudflare Workers static assets. Free tier, global CDN, custom domain, HTTPS, `_headers`.
- **API:** a small Worker on the same domain (`/api/*`) handles the contact form (Turnstile spam check) plus Stripe and PayPal checkout and webhooks. It needs no SDKs and no servers.

The output is plain HTML/CSS/JS. Pages work without JavaScript, and nothing loads from third parties unless a feature needs it.

## Quick start

```bash
nvm use                      # Node 22 (see .nvmrc)
npm install
cp .dev.vars.example .dev.vars
npm run dev                  # site on :3000 (hot reload) + Worker API on :8787
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + `wrangler dev` for `/api/*` (proxied) |
| `npm run build` | Production build to `dist/`, which is a checkout of the `prod` branch: each build replaces `prod` with exactly that output and force-pushes it (skipped in CI) |
| `npm run preview` | Build, then serve `dist/` and the Worker exactly as Cloudflare will |
| `npm run check` | Build + axe accessibility audit of every page → `reports/axe-results.json` + a readable `reports/axe/<page>.txt` per page |
| `npm run deploy` | Build + `wrangler deploy` |

## How it fits together

```
site.config.js         name, URL, nav, feature switches, analytics, public keys
catalog/products.json  products & prices: rendered by the build AND trusted by the Worker
src/
  *.html               pages (about.html → /about, shop/x.html → /shop/x). _*.html are not built.
  partials/            head, header, footer, contact-form, product-card
  scss/                base/ (tokens, fonts, mixins, globals) · parts/ (components) · sections/ (page sections)
  js/main.js           always-on modules + lazy-loaded ones (carousel, contact form, cart)
  assets/images|fonts  originals; the build generates optimized versions
  public/              copied as-is (favicon, og-image)
plugins/
  html-includes.js     <include>, {{ vars }}, <if feature>, <each> → static HTML
  images.js            <img> → <picture> AVIF/WebP srcset + width/height + lazy
  icons.js             <i class="fa-brands fa-github"></i> → inline SVG (no Font Awesome kit/CDN)
  site-files.js        sitemap.xml, robots.txt, _headers (CSP built from enabled features)
  axe-reporter.js      accessibility audit (from Starter-LP2025, audits all pages)
worker/                /api/contact, /api/checkout/stripe, /api/webhooks/stripe, /api/paypal/orders[/:id/capture]
```

### Partials and template syntax

```html
<head><include src="partials/head.html" title="About" description="…"></include></head>
<include src="partials/header.html"></include>

{{ title || site.name }}   {{ page.url }}   {{ year }}   {{ nav }}
<if feature="shop">…</if>   <if set="site.analytics.gtm">…</if>   <if not="hideCta">…</if>
<each in="catalog.products" as="product"><include src="partials/product-card.html"></include></each>
```

Edit a partial once and every page picks it up on the next build. Nothing is fetched at runtime, so there is no layout flash and search engines see everything.

### Images

Put originals (JPG/PNG, any size) in `src/assets/images/` and reference them with a normal `<img>`. The build:

- outputs AVIF and WebP at 480/960/1440/1920 px (capped at the original width)
- writes `width`/`height` so the layout doesn't shift while images load
- adds `loading="lazy"` by default; use `data-eager` on the hero/LCP image
- takes a `sizes="(min-width: 768px) 50vw, 100vw"` attribute when the image isn't full-width
- skips SVG, GIF, remote URLs and anything marked `data-no-optimize`

### Icons

Write normal Font Awesome markup (`<i class="fa-solid fa-code"></i>`). The build inlines only the SVGs that are used, taken from `@fortawesome/fontawesome-free`, so there's no kit script, no web font and no CSP entry. Icons are decorative by default; add `aria-label`, `title` or `data-tooltip` and the icon is announced to screen readers. Font Awesome Free is CC BY 4.0, so keep `iconCredit: true` in `site.config.js` (it adds a footer credit).

## New client site checklist

1. On GitHub, open this repo → **Use this template** → create `client-site`. One repo per site; don't use branches for different sites.
2. `site.config.js`: set name, URL, `hosting`, description, nav and theme color, and turn off features the site doesn't need (`shop`, `paypal`, …).
3. `wrangler.jsonc`: set `name` and update `vars` (`CONTACT_TO`, `EMAIL_FROM`).
4. Re-theme in `src/scss/base/_tokens.scss` and `_fonts.scss`. Add woff2 files for only the weights you use, and update the two preloads in `partials/head.html`.
5. Replace `src/public/favicon.svg`, `apple-touch-icon.png` and `og-image.jpg` (1200×630).
6. Build the pages: copy `src/_page-template.html` and delete the demo pages you don't need (shop/cart if there's no store).
7. `npm run check`, fix the axe findings, and fill in `reports/accessibility-statement.md`.

### Cloudflare setup (one time per site)

1. Add the domain to Cloudflare (nameservers). SSL/TLS mode: **Full (strict)**. Turn on **Always Use HTTPS**.
2. Deploy from the `prod` branch: **Workers & Pages → Create → Workers → Import a repository** (it starts on the default branch; that's expected). Then in the Worker's **Settings → Build**: production branch `prod`, build command empty, deploy command `npx wrangler deploy`. The Worker name must match `name` in `wrangler.jsonc`.
   Every local `npm run build` (with `hosting: 'cloudflare'`) writes the bundled Worker (`_worker/`) and a generated `wrangler.jsonc` into `dist/`, pushes `prod`, and Cloudflare deploys exactly that. `npm run deploy` still deploys straight from your machine.
3. Custom domain: uncomment `routes` in `wrangler.jsonc` (or add it under Worker → Settings → Domains). Cloudflare creates the DNS records.
4. **Turnstile:** create a widget for the domain, put the site key in `site.config.js`, then `npx wrangler secret put TURNSTILE_SECRET`.
5. **Email** (choose one):
   - Resend: verify the domain in Resend, then `wrangler secret put RESEND_API_KEY`.
   - Cloudflare Email Routing: enable it on the domain, verify `CONTACT_TO` as a destination, and uncomment `send_email` in `wrangler.jsonc`.
6. Optional: turn on Web Analytics (cookieless) and paste the token into `site.config.js`. Add a rate-limiting rule for `/api/*` under Security → WAF.

**Coming soon / password preview:** set `comingSoon: true` in `site.config.js` and `npx wrangler secret put SITE_PASSWORD`. While it's on, the build makes the Worker run for every request (`run_worker_first: true` in the generated `dist/wrangler.jsonc`). Every URL then shows `src/coming-soon.html` with a 503 and `X-Robots-Tag: noindex`, and robots.txt disallows everything. Entering the password sets a 30-day cookie. Changing the secret signs everyone out. Stripe webhooks still get through. To launch, set `comingSoon: false` and build. Cloudflare only: on other hosts the site is **not** protected.

**Moving a site off GitHub Pages:** deploy to Cloudflare first and test it on the `*.workers.dev` URL. Then add the custom domain to the Worker; this replaces the old GitHub Pages DNS records. Finally, set `hosting: 'cloudflare'`, turn off Pages in the GitHub repo settings and delete the `CNAME` file.

## Hosting

Set `hosting` in `site.config.js`. Everything that depends on the host follows from it:

| | `cloudflare` | `github-pages` | `static` (any other host) |
| --- | --- | --- | --- |
| Base path | `/` | `/<repo>/` from the git remote (`/` with a `CNAME` file or a `<user>.github.io` repo) | `/` |
| Contact form, shop, checkout | on (Worker runs `/api/*`) | off | off |
| CSP | `_headers` file, plus HSTS, `nosniff`, framing and caching headers | `<meta>` tag only | `<meta>` tag only |
| Page links | `/about` | `/<repo>/about` | `/about.html` |
| Extra files | `_headers` | `.nojekyll` | none |

`base` overrides the automatic base path. Canonical links, `og:image` and the sitemap use `url` + base path, so set `url` to the origin of whichever host is live.

## E-commerce

Pick the simplest option that fits:

| Need | Use | Code |
| --- | --- | --- |
| A few products, no cart | **Stripe Payment Links** / Buy Button, **PayPal hosted buttons**. Paste the link or button into a page | none |
| Cart, multiple products | Built-in cart + **Stripe Checkout** and/or **PayPal Smart Buttons** | already in this template |
| Inventory, accounts, subscriptions at scale | A hosted platform (Shopify Lite/Buy Button, Snipcart, etc.) | n/a |

How the built-in cart works:

- `catalog/products.json` is the single source of truth. The Worker looks up every price there, so a customer editing localStorage or a request can't change what they're charged. `stripePriceId` is optional; without it the Worker sends `price_data` from the catalog.
- Stripe: `/api/checkout/stripe` creates a Checkout Session and redirects to Stripe's hosted page. Card data never touches the site, which keeps you at **PCI SAQ-A** scope. `/api/webhooks/stripe` verifies the signature, stores the order and emails the owner and customer (see Orders below).
- PayPal: the order is created and captured server-side with the Orders v2 API. The Smart Buttons only collect approval.
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (set with `wrangler secret put`). Set `PAYPAL_ENV=live` and the live PayPal client ID in `site.config.js` for production.
- Webhook: in the Stripe dashboard add the endpoint `https://<domain>/api/webhooks/stripe` with the event `checkout.session.completed`.

Local testing:

```bash
stripe listen --forward-to localhost:8787/api/webhooks/stripe   # prints whsec_… for .dev.vars
# pay with card 4242 4242 4242 4242, any future date and CVC
```

## Orders

Paid orders are stored in Cloudflare D1 (`migrations/`). On eCom sites (`features.shop`), the nav has a **Log in** link to `/login`. The email entered there decides where the person goes:

- **Admins** (anyone on the Access policy, see Admin users) go straight to `/admin`, where Cloudflare Access emails them a one-time code.
- **Customers** get a one-time link (expires in 15 minutes, max 3 per 15 minutes). They confirm on `/orders/verify` and get a 1-hour session on `/orders`. There are no accounts and no passwords. The response is identical whether or not the email has orders. Only a hash of each link token is stored.

What each side can do:

- **Customers** (`/orders`): see their orders and status/tracking, and **message the business** on each order. Each message emails `CONTACT_TO` with a link to the order in the admin. Limit: 10 customer messages per order per hour.
- **Admin, Orders** (`/admin`): list, search, and the order detail with:
  - **Customer**: edit name, email and shipping address. Name and address change that order only. A new email moves **all** of the customer's orders and needs a "verified this person" confirmation.
  - **Messages**: the conversation with the customer. Each reply emails them.
  - Status and tracking (optionally emailing the customer), **internal notes** (never shown to customers), and history.
  - Links like `/admin#order-1001` open an order directly. The notification emails use them.
- **Admin, Customers** (`/admin/customers`): everyone who has ordered, with order count, total spent and last order. Open one to see their orders or change their email.
- **Admin, Admin users** (`/admin/users`): who can sign in to the admin. Add or remove people; changes update the Cloudflare Access policy directly. Owners can manage owners; only the provider can remove a provider; nobody can remove themselves.

Cloudflare Access handles admin sign-in, and the Worker re-verifies Access's signed JWT on every `/api/admin/*` call. Every admin change goes to `audit_log` with who made it.

Stored per order: email, name, items, totals, shipping address, status, tracking, messages and notes. No card data.

### Setup (one time per site)

1. `npx wrangler d1 create <name>` and paste the `database_id` into `wrangler.jsonc`. Then `npx wrangler d1 migrations apply <name> --remote`. Run that again after adding a migration (e.g. `0002_messages.sql`); deploys don't run migrations.
2. `npx wrangler secret put ORDERS_SECRET` (a long random string, e.g. `openssl rand -base64 32`). Changing it signs every customer out.
3. Zero Trust → Access → Applications → **Add a self-hosted application**:
   - Destinations `<domain>/admin` and `<domain>/api/admin` (plus `www.` versions if the site answers on both). Subpaths like `/admin/customers` are covered.
   - Policy: **Allow**, emails = you (provider) + the site owner.
   - Login method: one-time PIN (optionally Google).

   Copy the team domain (`<team>.cloudflareaccess.com`) and the app's **Audience (AUD) tag** into `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc`, and put your own email in `PROVIDER_EMAILS`.
4. **Admin users page:**
   - Put the account ID in `CF_ACCOUNT_ID` and the policy's ID in `ACCESS_POLICY_ID`.
   - Create an API token (My Profile → API Tokens → Custom token) with **Account → Access: Apps and Policies → Edit**, for this account only.
   - Run `npx wrangler secret put CF_API_TOKEN`.

   Without the token, `/admin/users` says it isn't set up, and `/login` falls back to `PROVIDER_EMAILS` + `OWNER_EMAILS` to recognise admins.
5. `workers_dev` and `preview_urls` are off in `wrangler.jsonc` so the Worker is only reachable on the domain Access protects. Keep it that way.

Local: `npx wrangler d1 migrations apply <name> --local`. Then `ACCESS_DEV_EMAIL` and `ORDERS_SECRET` in `.dev.vars` let `/admin` work on localhost without Access.

### Runbook: lost access

- **Site owner changed or lost their email:** on `/admin/users`, add their new email and remove the old one. Or edit the Access policy in Zero Trust. Update `CONTACT_TO` in `wrangler.jsonc` if notifications should follow, then rebuild. Removing someone stops new sign-ins; to end a session they already have (up to 24 hours), revoke it in Zero Trust → Users.
- **Customer lost access to their email:** first confirm who they are another way, e.g. the order number plus the card's last 4 digits (in Stripe/PayPal), or a reply from a phone number on the order. Then change it in the order's **Customer** section or on `/admin/customers`. It moves every order on the old address, emails both addresses (the old one sees a masked new address) and writes the change to `audit_log`.
- **Audit trail:** `npx wrangler d1 execute <name> --remote --command "SELECT * FROM audit_log ORDER BY id DESC LIMIT 50"`.

## Security headers

With `hosting: 'cloudflare'`, `plugins/site-files.js` writes `dist/_headers` (other hosts get the CSP as a `<meta>` tag; they can't set the other headers):

- a CSP that allows only the third-party origins your enabled features need (Turnstile, Stripe, PayPal, Cloudflare Web Analytics, Google Tag Manager)
- HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`
- one-year immutable caching for `/assets/*` (the filenames are content-hashed)

For an extra origin (e.g. an embed, or a tag your GTM container loads beyond GA4), add `csp: { script: ['https://…'], frame: [...] }` to `site.config.js`.
