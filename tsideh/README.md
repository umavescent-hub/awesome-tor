# Tsideh

The website for Tsideh, a pop-up kitchen in Northern New Mexico. Customers see upcoming
pop-ups, pre-order from the menu, choose a pickup time and pay by card, Apple Pay or
Google Pay. Hosts can send a catering inquiry. The kitchen runs service from a private
screen at `/admin`.

The home page is kept plain on purpose: the Tsideh logo on the adobe-orange field, the next
pop-up, and two big buttons, **Order food for pickup** and **Ask about catering**. Nothing moves
and nothing sits behind the text, so anyone can find their way on a phone or a computer.

- **No monthly software fees** beyond hosting and Stripe's per-payment fee.
- **No card numbers on this server.** Payment happens on Stripe's secure page.
- **Everything you change lives in three files** in `config/`: the site, the menu, the pop-ups.

---

## 1. Try it on your computer

1. Install **Node.js 22** (the "LTS" download at [nodejs.org](https://nodejs.org)).
2. Open a terminal in this folder and run:

   ```sh
   npm start
   ```

3. Open <http://localhost:8787>.

Nothing else is needed. With no Stripe key the site runs in **demo mode**: every page works,
the pay button is simulated and the site says "Demo mode — no real charges".

To try the kitchen screen, copy `.env.example` to `.env`, set `ADMIN_PASSWORD` to a password
of at least 12 characters, run `npm start` again and open <http://localhost:8787/admin>.

`npm run dev` does the same as `npm start` but restarts by itself whenever you save a file in
`config/` or `server/`.

To preview the site as of another day (for example, the morning of a pop-up), add a line such
as `NOW=2026-11-21T16:00:00Z` to `.env`. This only works on your computer, never on the live site.

---

## 2. Edit the menu, pop-ups and site

Everything customers read comes from `config/`. After saving a file, restart the server (on
Render: push the change and it redeploys). If something is off, the server will not start and
it tells you exactly which file and field to fix, for example:

```
Tsideh cannot start. Fix the following and try again:
  - config/events.json → events[1].date: must be a date written YYYY-MM-DD
```

You can also run `npm test`: the first check confirms your config files are valid.

Times are 24-hour (`"13:30"`), dates are `"YYYY-MM-DD"`, money is in **cents**
(`1700` = $17.00), and every time is Santa Fe local time.

### `config/events.json`: your pop-ups

| Field | Example | What it does |
| --- | --- | --- |
| `id` | `"2026-11-21-santa-fe"` | Short name used in links. Lowercase letters, numbers, dashes. Do not change it once orders exist. |
| `title` | `"Winter Pop-up"` | Shown on the site. |
| `date` | `"2026-11-21"` | The day of the pop-up. |
| `start`, `end` | `"11:00"`, `"14:00"` | Pickup window. |
| `locationName` | `"Santa Fe"` | Short place name. |
| `address` | `"Exact spot posted 48 hours before"` | Street address, or a note until you know it. Customers' order pages update when you change it. |
| `mapUrl` | `"https://maps.app.goo.gl/…"` | Map link, or `""` for none. |
| `status` | `"open"` | `open` takes orders · `paused` shows the pop-up but stops new orders · `closed` shows it as closed · `hidden` takes it off the site. |
| `slotMinutes` | `15` | Length of each pickup time. |
| `ordersPerSlot` | `8` | Most orders you can hand out per pickup time. |
| `preorderOpensDaysBefore` | `21` | Pre-orders open at midnight this many days before. |
| `menu` | `"all"` or `["red-chile-posole", "biscochitos"]` | Which menu items this pop-up offers. |
| `itemLimits` | `{ "red-chile-posole": 50 }` | Portions you are making. Items not listed are unlimited. |
| `note` | `"Pickup only."` | One line shown with the pop-up. |

Pickup times run from `start` to one slot before `end`: 11:00–14:00 with 15-minute slots gives
pickups from 11:00 AM to 1:45 PM. Each pickup time closes 30 minutes before it starts
(`leadTimeMinutes` in `site.json`). A pop-up disappears from the site once it ends.

### `config/menu.json`: what you cook

`categories` lists the sections in the order they appear (`{ "id": "plates", "name": "Plates" }`).
Each entry in `items`:

| Field | Example | What it does |
| --- | --- | --- |
| `id` | `"red-chile-posole"` | Short name. Do not change it once orders exist. |
| `category` | `"bowls"` | One of the category ids. |
| `name` | `"Red Chile Posole"` | Shown on the menu and the receipt. |
| `description` | `"Hominy and pork simmered in red chile…"` | One or two sentences. |
| `priceCents` | `1400` | Price in cents ($14.00). At least 50. |
| `tags` | `["gluten-free", "spicy"]` | Any of `vegetarian`, `vegan`, `gluten-free`, `dairy-free`, `spicy`, `contains-nuts`. |
| `image` | `"/assets/menu/posole.webp"` | Optional photo. Put the file in `public/assets/menu/`. Without one, the dish is set as type only. |

Price changes apply to new orders only; existing orders keep what the customer paid.

### `config/site.json`: the rest

| Field | What it does |
| --- | --- |
| `name`, `tagline`, `description` | Site name and the lines under it (also used for search engines). |
| `heroHeadline` | The large line under the TSIDEH wordmark at the top of the home page. |
| `press` | The press line under the hero. Each entry: `name`, `kind` (`"featured"` or `"recognition"`), and optionally `url` (an https:// link to the piece) and `quote` (only a real quote from it). |
| `timezone` | `"America/Denver"`. Leave as is. |
| `taxRatePercent`, `taxLabel` | Sales tax added at checkout and its name on the receipt. See [Sales tax](#9-sales-tax). |
| `tipPresetsPercent` | Tip buttons offered at checkout, e.g. `[0, 10, 15, 20]`. |
| `order.leadTimeMinutes` | How long before a pickup time it stops taking orders. |
| `order.holdMinutes` | How long a customer's spot is held while they pay (30 to 120). |
| `order.maxQtyPerItem`, `order.maxItemsPerOrder` | Order size limits. Larger orders are pointed to catering. |
| `contact` | Email, phone and Instagram handle customers can reach you on. |
| `catering` | The catering intro (`blurb`), guest range, notice needed and the service styles offered. |

---

## 3. Take real payments with Stripe

Customers pay on Stripe's hosted checkout page, which shows card, Apple Pay and Google Pay
(and Link) automatically, depending on their device.

1. **Create your account** at [stripe.com](https://stripe.com) and complete activation
   (business details and the bank account for payouts).
2. **Copy your test key.** In the Dashboard, switch on **Test mode**, open
   **Developers → API keys** and copy the **Secret key** (`sk_test_…`). Put it in
   `STRIPE_SECRET_KEY`. Never use the publishable `pk_` key here.
3. **Turn on wallets.** Open **Settings → Payments → Payment methods** and make sure
   **Cards**, **Apple Pay** and **Google Pay** are on. Nothing else is needed: because the
   payment page is hosted by Stripe, there is no domain to verify. Apple Pay appears in Safari
   on Apple devices with a card in Wallet; Google Pay appears in Chrome and on Android.
4. **Brand the payment page.** Open **Settings → Business → Branding**:
   brand color `#C16742`, accent color `#0A0806`, icon `public/assets/icon-512.png`, logo
   `public/assets/logo.jpg`. Under **Public details**, set the statement descriptor to
   `TSIDEH` (what appears on card statements) and your support email. Under
   **Customer emails**, turn on receipts for successful payments.
5. **Add the webhook** (how Stripe tells the site an order is paid). Open
   **Developers → Webhooks → Add endpoint** (newer dashboards: **Workbench → Webhooks →
   Create an event destination**) and enter:
   - Endpoint URL: `https://YOURDOMAIN/api/stripe/webhook`
   - Events:
     `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`,
     `checkout.session.expired`,
     `charge.refunded`

   Then reveal the **Signing secret** (`whsec_…`) and put it in `STRIPE_WEBHOOK_SECRET`.
6. **Test.** Place an order on the live site while in test mode. Pay with card
   `4242 4242 4242 4242`, any future expiry, any CVC and ZIP. The order page should turn to
   "paid", the order should appear in `/admin`, and the payment should show in Stripe. Card
   `4000 0000 0000 9995` shows what a decline looks like.
7. **Go live.** Switch the Dashboard out of test mode. Copy the live secret key (`sk_live_…`),
   then add the webhook endpoint again in live mode (same URL, same five events): it has its
   own new `whsec_…` secret. Replace both values on Render; the site restarts by itself and
   its log says `payments: Stripe (live)`.

**Refunds:** issue them from the Stripe Dashboard. A full refund marks the order "refunded" on
the site automatically.

---

## 4. Go live on Render

[Render](https://render.com) runs the site for you, with HTTPS, a permanent disk for orders
and automatic deploys from GitHub.

1. Put this `tsideh` folder in its own GitHub repository, so that `render.yaml` sits at the
   top level.
2. In Render choose **New → Blueprint** and connect that repository. Render reads
   `render.yaml` and creates the `tsideh` web service (Starter plan) with a 1 GB disk at `/data`
   for the order database.
3. When asked, fill in:
   - `PUBLIC_URL`: your address, e.g. `https://tsideh.com` (use the `https://tsideh.onrender.com`
     address Render gives you until your domain is connected)
   - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (step 3 above)
   - `ADMIN_PASSWORD`: 12 or more characters, written down somewhere safe
   - `NOTIFY_WEBHOOK_URL`: optional, see [Order alerts](#6-order-alerts-in-slack)
4. Deploy. When the service is "Live", open the address and place a test order.
5. **Your own domain.** In the service, open **Settings → Custom Domains**, add `tsideh.com`
   and `www.tsideh.com`, and create the DNS records Render shows you at your domain registrar.
   Render issues the HTTPS certificate on its own. Then set `PUBLIC_URL` to
   `https://tsideh.com` and update the webhook URL in Stripe to match.

Good to know:

- Each deploy restarts the site for a few seconds. Avoid deploying while a pop-up's orders are
  rushing in.
- Render keeps daily snapshots of the disk, and every paid order is also in your Stripe
  Dashboard.
- Another host works the same way: the included `Dockerfile` builds a small image; mount a
  volume at `/data` and set the same environment values.

---

## 5. The kitchen screen (`/admin`)

Sign in at `https://YOURDOMAIN/admin` with `ADMIN_PASSWORD`. A sign-in lasts 12 hours on that
device, or ends sooner after 2 hours with the screen closed. Sign-in allows five attempts a
minute from any one connection, so guessing the password is impractical.

- **Orders:** pick a pop-up and see its paid orders by pickup time. Mark each one **Ready**,
  then **Picked up**. Orders flagged **oversold** were paid after their hold ran out and the
  spot was taken meanwhile: Stripe collected the money, so the order stands, but it pushes that
  pickup time or item past what you planned for.
- **Prep:** how many of each item are paid for, still being paid for, and what is left of each
  limit. To stop selling an item, lower its limit in `config/events.json`; to stop all orders
  for a pop-up, set its `status` to `"paused"`.
- **Catering:** every inquiry, marked new, contacted, booked or declined.

---

## 6. Order alerts in Slack

Get a message in Slack for every paid order and every catering inquiry:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**.
2. Open **Incoming Webhooks**, switch it on, **Add New Webhook to Workspace**, pick a channel
   (for example `#orders`) and copy the URL.
3. Put that URL in `NOTIFY_WEBHOOK_URL` on Render.

A message looks like:
`New paid order TS-7KQ4 · Winter Pop-up · pickup 11:15 AM · Maria · 2× Bison Red Chile Tacos · $36.78`.
Alerts include a first name, the items and the total, never email addresses, phone numbers
or payment details. Whatever a customer typed shows as plain text, so it cannot ping the whole
channel or disguise a link.

---

## 7. How an order works

1. The customer picks a pop-up, items and a pickup time, then taps **Pay**.
2. The site checks prices and stock itself (the browser never sets a price) and **holds** the
   pickup time and any limited items for 30 minutes. One internet connection can have at most two
   unpaid orders waiting at once, so nobody can sell out your dishes without paying. If the same
   person starts their order again (for example after pressing Back on the payment page), the
   new order simply replaces their unpaid one.
3. The customer pays on Stripe's page and comes back to their order page with a pickup code
   such as `TS-7KQ4`.
4. Stripe confirms the payment to the site (the webhook). If the customer closes the page
   early, the order is still confirmed; if they never pay, the hold lapses and the spot is
   released for someone else.

---

## 8. Security, in plain words

- **Cards never touch this server.** Customers enter payment details on Stripe's page
  (Stripe handles PCI compliance; the site qualifies for the simplest level, SAQ A).
- **Prices are set by the server**, never by the browser.
- **Order pages need a private link.** Each order gets a long random key; the database keeps
  only a fingerprint of it, and a wrong key looks exactly like a missing order.
- **The kitchen screen** uses a password compared in constant time, a session cookie (12 hours
  at most, 2 hours idle) that scripts cannot read and other sites cannot send, an extra check
  on every change, and a limit on sign-in attempts.
- **Strict browser rules** (Content Security Policy with Trusted Types, cross-origin
  isolation): pages load only this site's own files and never turn text into code. No
  trackers, ad scripts, third-party fonts or embeds. Pages cannot be framed by other sites.
- **HTTPS only** on the live site, with HSTS. Requests are size-limited, rate-limited per
  visitor (every address of one IPv6 home or phone network counts as one visitor), and every
  text field is cleaned before it is stored.
- **Stripe webhooks are verified** by signature and timestamp; repeats are ignored. A payment
  is recorded only if Stripe charged exactly the order's total; anything else is left unpaid
  and sent to your Slack alerts for review.
- **Logs** record method, path, status and timing only: never card data, keys, contact details
  or private order links. Error messages from Stripe are logged with keys and email addresses
  removed.
- **Your data stays yours:** one database file on your Render disk.

Keep these secret: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PASSWORD` and the Slack
URL. If one leaks, roll the key in Stripe (**Developers → API keys → Roll key**) or change the
value on Render; the site restarts with the new one.

---

## 9. Sales tax

`taxRatePercent` is set to **8.1875%, a placeholder**. New Mexico gross receipts tax depends on
where the sale happens and changes on January 1 and July 1, and towns differ (Española's rate is
not Santa Fe's). **Confirm the current rate with your accountant** and update `config/site.json`.
The tax appears as its own line on the Stripe receipt, labelled with `taxLabel`.

---

## For developers

- Node.js 22.13 or newer, **zero npm dependencies**: `node:http`, `node:sqlite`, `node:crypto`,
  `node:zlib`, `node:test`. The front end is plain ES modules with no build step.
- `npm start` runs the server, `npm run dev` restarts on changes, `npm test` runs the suite
  (unit tests plus full API flows in demo and Stripe mode against a local fake Stripe).
- `npm run e2e` drives the real site in Chromium on a phone and a desktop viewport: order, demo
  payment, confirmation, catering inquiry and the kitchen screen, failing on any console error,
  Content Security Policy violation or sideways scroll. It needs Playwright, which is not a
  project dependency: `npm install --no-save playwright && npx playwright install chromium`.
- Settings are environment variables, documented in `.env.example`.

```
server/
  index.js       entry point, startup banner, graceful shutdown
  app.js         composition, request handling, rate limits, housekeeping
  config.js      environment and config/*.json validation
  catalog.js     events, slots, availability and status (pure)
  pricing.js     cart validation and totals (pure, integer cents)
  time.js        America/Denver <-> UTC with Intl, DST-safe
  db.js          SQLite schema and migrations
  orders.js      capacity-safe reservations and order queries
  payments.js    Stripe Checkout, webhook, confirm-on-return, cancel, demo pay
  stripe.js      Stripe REST client and webhook signature check
  auth.js        kitchen sessions
  security.js    headers, client IP, rate and open-hold limits, body limits
  notify.js      kitchen alerts (Slack-compatible webhook)
  static.js      static files, compression, caching, SPA fallback
  routes/        public and admin API
config/          site.json, menu.json, events.json
public/          the site, the admin, fonts and images
test/            node:test suites; test/e2e/ holds the browser check
```

API summary (JSON; errors are `{ "error": { "code", "message", "field"?, "details"? } }`):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/site` | Site settings and payment mode |
| GET | `/api/events` | Visible pop-ups with live status |
| GET | `/api/events/:id` | One pop-up: menu with stock, pickup times |
| POST | `/api/checkout` | Hold an order and get the payment URL |
| GET | `/api/orders/:code?k=…` | Order status (with `session_id` after Stripe) |
| POST | `/api/orders/:code/cancel` | Release an unpaid hold |
| POST | `/api/catering` | Catering inquiry |
| POST | `/api/stripe/webhook` | Stripe events (signed) |
| POST | `/api/demo/pay/:code` | Demo mode only: simulate payment |
| * | `/api/admin/…` | Kitchen: session, events, orders, prep, order status, catering |

Rate limits count an IPv6 /64 as one client. `POST /api/checkout` also answers `429 too_many_holds`
(with `Retry-After`) when that client already has two unpaid orders; the same person starting the same
pop-up's order again replaces their unpaid ones instead.
