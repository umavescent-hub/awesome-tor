# Tsideh

## Go live: checklist

Do these in order. Each step has more detail further down; replace `YOURDOMAIN` with your
address, for example `tsideh.com`.

1. **Stripe account.** Sign up at [stripe.com](https://stripe.com) and finish **Activate payments** (business details, identity, bank account for payouts).
2. **Receipts.** Stripe → **Settings → Customer emails** → turn on **Successful payments**, so every buyer gets a receipt by email.
3. **One-tap paying.** Stripe → **Settings → Payment methods** → make sure **Apple Pay**, **Google Pay** and **Link** are on.
4. **Payment page look.** Stripe → **Settings → Branding** → brand color `#C16742`, then upload `public/assets/logo.jpg` as the logo.
5. **Live secret key.** Stripe, with **Test mode** off → **Developers → API keys** → **Secret key** → **Reveal**, and copy it (`sk_live_…`).
6. **Webhook.** Stripe → **Developers → Webhooks → Add endpoint** → `https://YOURDOMAIN/api/stripe/webhook` with the [five events](#webhook-events), then copy its **Signing secret** (`whsec_…`).
7. **Render.** [render.com](https://render.com) → **New → Blueprint** → this repository → fill in `PUBLIC_URL` (`https://YOURDOMAIN`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PASSWORD` and, if you want Slack alerts, `NOTIFY_WEBHOOK_URL` → **Apply**.
8. **Your domain.** Render → **tsideh → Settings → Custom Domains** → add `YOURDOMAIN` and `www.YOURDOMAIN`, then add the DNS records Render shows at your domain registrar.
9. **Your pop-ups and menus.** Put the real dates, dishes, prices and your contact details in `config/events.json`, `config/menu.json` and `config/site.json` (on GitHub: open the file → pencil icon → **Commit changes**); Render redeploys by itself.
10. **Tax rate.** Confirm the gross receipts tax rate with your accountant and set `taxRatePercent` in `config/site.json` ([why](#9-sales-tax)).
11. **Real test order.** Buy a 1-dollar test item on your phone, check the receipt email and `/admin`, then refund it in Stripe → **Payments** ([how](#test-with-real-money)).

You are live when the Render log (**tsideh → Logs**) shows `payments: Stripe (live)` and no
`WARNING` line.

---

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
(`1700` is 17, `1450` is 14.50), and every time is Santa Fe local time.

### `config/events.json`: your pop-ups

| Field | Example | What it does |
| --- | --- | --- |
| `id` | `"2026-11-21-santa-fe"` | Short name used in links. Lowercase letters, numbers, dashes. Do not change it once orders exist. |
| `title` | `"Santa Fe pop-up"` | Shown on the site. |
| `date` | `"2026-11-21"` | The day of the pop-up. |
| `start`, `end` | `"11:00"`, `"14:00"` | Pickup window. |
| `locationName` | `"Santa Fe"` | Short place name. |
| `address` | `"Exact spot posted here 48 hours before pickup"` | Street address, or a note until you know it. Customers' order pages update when you change it. |
| `mapUrl` | `"https://maps.app.goo.gl/…"` | Map link, or `""` for none. |
| `status` | `"open"` | `open` takes orders · `paused` shows the pop-up but stops new orders · `closed` shows it as closed · `hidden` takes it off the site. |
| `slotMinutes` | `15` | Length of each pickup time. |
| `ordersPerSlot` | `8` | Most orders you can hand out per pickup time. |
| `preorderOpensDaysBefore` | `21` | Pre-orders open at midnight this many days before. |
| `ordersCloseAt` | `"2026-11-20T20:00"` | Optional. The moment orders stop, written `YYYY-MM-DDTHH:MM` in Santa Fe time, for pickups you cook days ahead (holidays). It must be after pre-orders open and before `start`. Leave it out to take orders until each pickup time. |
| `menu` | `"all"` or `["red-chile-posole", "biscochitos"]` | Which menu items this pop-up offers. `"all"` includes the holiday dishes, so regular pop-ups list their items. |
| `itemLimits` | `{ "red-chile-posole": 50 }` | Portions you are making. Items not listed are unlimited. |
| `note` | `"Pickup only."` | One line shown with the pop-up. |

Pickup times run from `start` to one slot before `end`: 11:00–14:00 with 15-minute slots gives
pickups from 11:00 AM to 1:45 PM. Each pickup time closes 30 minutes before it starts
(`leadTimeMinutes` in `site.json`). With `ordersCloseAt`, the pop-up shows as closed for orders
from that minute on; until then the site shows "Order by Friday, November 20 at 8:00 PM" on its
card, on its page and in the hero when it is the next pop-up, so the `note` need not repeat it. Anyone already paying at that
moment can still finish. A pop-up disappears from the site once it ends.

**Waiting on you: the Winter Feast Table.** The Christmas Eve pickup (`2026-12-24-winter-feast`)
is `hidden` until you have its pickup hours. Its `start` and `end` (`"10:00"`, `"14:00"`) are
placeholders so the file checks out. Put in the real hours, then set `status` to `"open"`. Orders
close Friday, December 18 at 8:00 PM (`ordersCloseAt`).

### `config/menu.json`: what you cook

`categories` lists the sections in the order they appear (`{ "id": "plates", "name": "Plates" }`).
Within a section, dishes appear in the order they are listed in `items`. Each entry in `items`:

| Field | Example | What it does |
| --- | --- | --- |
| `id` | `"red-chile-posole"` | Short name. Do not change it once orders exist. |
| `category` | `"bowls"` | One of the category ids. |
| `name` | `"Red chile posole"` | Shown on the menu and the receipt. |
| `description` | `"Hominy and pork simmered in red chile…"` | One or two sentences. |
| `priceCents` | `1400` | Price in cents (`1400` is 14). At least 50. |
| `minQty` | `2` | Optional. The fewest of this item one order may have (leave out for 1; at most `order.maxQtyPerItem`). The menu shows "Minimum 2" beside the price, so the description need not say it. With an `itemLimits` entry, the item shows as sold out once fewer than this are left. |
| `tags` | `["gluten-free", "spicy"]` | Any of `vegetarian`, `vegan`, `gluten-free`, `dairy-free`, `spicy`, `contains-nuts`. |
| `image` | `"/assets/menu/posole.webp"` | Optional photo. Put the file in `public/assets/menu/`. Without one, the dish is set as type only. |

Price changes apply to new orders only; existing orders keep what the customer paid.

### `config/site.json`: the rest

| Field | What it does |
| --- | --- |
| `name`, `tagline`, `description` | Site name and the lines under it (also used for search engines). |
| `heroHeadline` | The large line under the TSIDEH wordmark at the top of the home page. |
| `chef` | `{ "name": "Chef Rainbird Taylor", "from": "Ohkay Owingeh" }`: the chef line under the headline and in the footer. `from` is optional; leave `chef` out to show no chef line. |
| `press` | The press line under the hero. Each entry: `name`, `kind` (`"featured"` or `"recognition"`), and optionally `url` (an https:// link to the piece) and `quote` (only a real quote from it). |
| `timezone` | `"America/Denver"`. Leave as is. |
| `taxRatePercent`, `taxLabel` | Sales tax added at checkout and its name on the receipt. See [Sales tax](#9-sales-tax). |
| `tipPresetsPercent` | Tip buttons offered at checkout, e.g. `[0, 10, 15, 20]`. |
| `order.leadTimeMinutes` | How long before a pickup time it stops taking orders. |
| `order.holdMinutes` | How long a customer's spot is held while they pay (30 to 120). |
| `order.maxQtyPerItem`, `order.maxItemsPerOrder` | Order size limits. Larger orders are pointed to catering. |
| `contact` | Email, phone and Instagram handle customers can reach you on. |
| `catering` | The catering intro (`blurb`), guest range, notice needed and `serviceStyles`, the choices on the catering form (up to 120 characters each). |

---

## 3. Take real payments with Stripe

Customers pay on Stripe's hosted checkout page. It offers Apple Pay, Google Pay, Link and card,
whichever the customer's device supports, so most people pay with one tap. Card numbers never
reach this server.

1. **Account.** Create your account at [stripe.com](https://stripe.com) and complete
   **Activate payments**: business details, identity and the bank account for payouts.
2. **Receipts.** Open **Settings → Customer emails** and turn on **Successful payments**.
   Stripe then emails every buyer a receipt listing each dish, the tax line and the total.
   Stripe sends receipts only for live payments, not in test mode.
3. **Wallets.** Open **Settings → Payment methods** and make sure **Cards**, **Apple Pay**,
   **Google Pay** and **Link** are on. Nothing else is needed: the payment page is hosted by
   Stripe, so there is no domain to verify. Apple Pay appears in Safari on Apple devices with a
   card in Wallet; Google Pay appears in Chrome and on Android.
4. **Branding.** Open **Settings → Branding**: brand color `#C16742`, accent color `#0A0806`,
   icon `public/assets/icon-512.png`, logo `public/assets/logo.jpg`. Under
   **Settings → Public details**, set the statement descriptor to `TSIDEH` (what appears on
   card statements) and your support email.
5. **Secret key.** Open **Developers → API keys** and copy the **Secret key**: `sk_live_…`
   for real payments, `sk_test_…` while **Test mode** is on. It goes in `STRIPE_SECRET_KEY`.
   Never use the publishable `pk_` key here.
6. **Webhook** (how Stripe tells the site an order is paid, even if the customer closes the
   page). Open **Developers → Webhooks → Add endpoint** (newer dashboards: **Workbench →
   Webhooks → Create an event destination**), enter the endpoint URL
   `https://YOURDOMAIN/api/stripe/webhook` and select the five events below. Then reveal the
   **Signing secret** (`whsec_…`) and put it in `STRIPE_WEBHOOK_SECRET`. Test mode and live
   mode each have their own endpoint and secret.

<a id="webhook-events"></a>**Webhook events:** `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired`, `charge.refunded`.

### Rehearse in test mode (optional)

With **Test mode** on, use the `sk_test_…` key and a test-mode webhook. Pay with card
`4242 4242 4242 4242`, any future expiry, any CVC and ZIP; card `4000 0000 0000 9995` shows what
a decline looks like. When you are done, put the live key and the live webhook's secret on
Render; the site restarts by itself and its log says `payments: Stripe (live)`.

### Test with real money

Before you announce the site, buy something yourself, the way a customer would:

1. Add a temporary item to `config/menu.json`:
   `{ "id": "test-item", "category": "drinks", "name": "Test item", "priceCents": 100 }`,
   add `"test-item"` to the `menu` list of one open pop-up in `config/events.json`, and commit.
2. On your phone, open that pop-up, add **Test item**, choose a pickup time and pay with
   Apple Pay or Google Pay (1 plus tax).
3. Check that the confirmation shows a pickup code, the Stripe receipt arrives by email, the
   order appears in `/admin` and, if you set it up, Slack posts it.
4. Refund it: Stripe → **Payments** → the payment → **Refund**. The order is marked refunded
   on the site by itself.
5. Delete the test item from both files and commit.

Stripe keeps its processing fee on a refund, so this test costs about 30 cents.

**Refunds:** issue them from the Stripe Dashboard. A full refund marks the order "refunded" on
the site automatically.

---

## 4. Host it on Render

[Render](https://render.com) runs the site for you, with HTTPS, a permanent disk for orders
and automatic deploys from GitHub.

1. Put this `tsideh` folder in its own GitHub repository, so that `render.yaml` sits at the
   top level.
2. In Render choose **New → Blueprint** and connect that repository. Render reads
   `render.yaml` and creates the `tsideh` web service (Starter plan) with a 1 GB disk at `/data`
   for the order database. It sets `NODE_ENV`, `DATA_DIR` and `TRUST_PROXY` for you.
3. When asked, fill in:
   - `PUBLIC_URL`: your address, e.g. `https://tsideh.com`. Stripe sends customers back here,
     and link previews in texts and social posts use it. (No domain yet? Use the
     `https://tsideh.onrender.com` address Render shows, and change it, along with the webhook
     URL in Stripe, once your domain works.)
   - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` ([Stripe](#3-take-real-payments-with-stripe),
     steps 5 and 6)
   - `ADMIN_PASSWORD`: 12 or more characters, written down somewhere safe
   - `NOTIFY_WEBHOOK_URL`: optional, see [Order alerts](#6-order-alerts-in-slack)
4. Click **Apply**. When the service shows **Live**, open its address.
5. **Your own domain.** In the service, open **Settings → Custom Domains**, add `tsideh.com`
   and `www.tsideh.com`, and create the DNS records Render shows you at your domain registrar.
   Render issues the HTTPS certificate on its own.

To change a setting later, open **tsideh → Environment**, edit the value and save; the site
restarts with it.

Good to know:

- The log (**tsideh → Logs**) starts by saying how payments run, for example
  `payments: Stripe (live)`, with a `WARNING` line for anything missing.
- Each deploy restarts the site for a few seconds. Avoid deploying while a pop-up's orders are
  rushing in.
- Render keeps daily snapshots of the disk, and every paid order is also in your Stripe
  Dashboard.
- Another host works the same way: the included `Dockerfile` builds a small image; mount a
  volume at `/data`, set the same environment values, and set `TRUST_PROXY` to the number of
  proxies in front of the site (usually 1).

---

## 5. The kitchen screen (`/admin`)

Sign in at `https://YOURDOMAIN/admin` with `ADMIN_PASSWORD`. A sign-in lasts 12 hours on that
device, or ends sooner after 2 hours with the screen closed. Sign-in allows five attempts a
minute from any one connection, so guessing the password is impractical.

- **Orders:** pick a pop-up and see its paid orders by pickup time. Tap **Mark ready**, then
  **Picked up** on each one. Orders flagged **oversold** were paid after their hold ran out and the
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
`New paid order TS-7KQ4 · Santa Fe Pop-up · pickup 11:15 AM · Maria · 2× Bison Red Chile Tacos · total 36.78`.
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
- `public/index.html` carries two placeholders, `%PUBLIC_URL%` and `%PAGE_URL%`, in its
  canonical link and `og:url` / `og:image` tags. The server fills them in from `PUBLIC_URL`
  (link previews and search engines need absolute addresses), so leave them in place.

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
  static.js      static files, compression, caching, app pages
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
