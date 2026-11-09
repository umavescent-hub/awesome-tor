// Tsideh kitchen screen: orders by pickup time, the prep list and catering inquiries.
//
// Safety model: customer-provided strings only ever reach the page as text nodes (h() never parses
// markup, and nothing here touches innerHTML), the page runs under a strict CSP with Trusted Types,
// and every mutation carries the X-Tsideh-Admin header the server requires on top of its
// SameSite=Strict session cookie. A 401 from any call returns the screen to sign-in.

const POLL_MS = 15_000;
const TOAST_MS = 6_000;
const STORAGE_KEY = 'tsideh-kitchen';
const LOGIN_PATH = '/api/admin/login';
const DEFAULT_ZONE = 'America/Denver';

const ORDER_STATUS = {
  pending: { label: 'Awaiting payment' },
  paid: { label: 'Paid', action: { to: 'ready', label: 'Mark ready' } },
  ready: { label: 'Ready', action: { to: 'picked_up', label: 'Picked up' } },
  picked_up: { label: 'Picked up', action: { to: 'ready', label: 'Undo' } },
  canceled: { label: 'Canceled' },
  expired: { label: 'Expired' },
  failed: { label: 'Payment failed' },
  refunded: { label: 'Refunded' },
};

const FILTERS = {
  active: {
    test: (order) => order.status === 'pending' || order.status === 'paid' || order.status === 'ready',
    empty: 'Nothing to make right now. New paid orders show up here on their own.',
  },
  ready: { test: (order) => order.status === 'ready', empty: 'No orders are waiting for pickup.' },
  picked_up: { test: (order) => order.status === 'picked_up', empty: 'No orders have been picked up yet.' },
  all: { test: () => true, empty: 'No orders for this event yet.' },
};

const CATERING_STATUS = { new: 'New', contacted: 'Contacted', booked: 'Booked', declined: 'Declined' };

/* ------------------------------------------------------------------ DOM */

const $ = (id) => document.getElementById(id);
const PROPERTIES = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

/** h('button', { class, onclick, ...attributes }, ...children). Children become text nodes, never markup. */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === '') continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const hiddenText = (text) => h('span', { class: 'visually-hidden' }, text);
const noLimit = () => [h('span', { class: 'dash', 'aria-hidden': 'true' }, '–'), hiddenText('No limit')];

const keyedLists = new WeakMap();

/**
 * Keyed rendering for lists that refresh every few seconds: rebuilds only the entries whose
 * signature changed, moves only nodes that are out of place, and puts keyboard focus back on the
 * matching control ([data-focus]) of a rebuilt entry. Entries start after `after` (or at the top).
 * Returns the key → { node } map so callers can fill nested containers.
 */
function reconcile(parent, entries, after = null) {
  const previous = keyedLists.get(parent) ?? new Map();
  const next = new Map();
  let refocus = null;
  for (const { key, sig, build } of entries) {
    const old = previous.get(key);
    if (old && old.sig === sig) {
      next.set(key, old);
      continue;
    }
    const node = build();
    if (old) {
      const active = document.activeElement;
      if (old.node.contains(active) && active.dataset.focus) refocus = { node, focus: active.dataset.focus };
      old.node.replaceWith(node);
    }
    next.set(key, { node, sig });
  }
  for (const [key, { node }] of previous) if (!next.has(key)) node.remove();
  let prev = after;
  for (const { node } of next.values()) {
    const expected = prev ? prev.nextElementSibling : parent.firstElementChild;
    if (node !== expected) parent.insertBefore(node, prev ? prev.nextSibling : parent.firstChild);
    prev = node;
  }
  keyedLists.set(parent, next);
  refocus?.node.querySelector(`[data-focus="${CSS.escape(refocus.focus)}"]`)?.focus();
  return next;
}

/* ------------------------------------------------------------- storage */

const prefs = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    } catch {
      return {};
    }
  },
  write(patch) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prefs.read(), ...patch }));
    } catch {
      // Storage is unavailable (private mode or blocked): preferences just don't persist.
    }
  },
};

/* ---------------------------------------------------------- formatting */

const fmt = {
  setZone(zone) {
    const opts = (extra) => ({ timeZone: zone, ...extra });
    this.timeFmt = new Intl.DateTimeFormat('en-US', opts({ hour: 'numeric', minute: '2-digit' }));
    this.stampFmt = new Intl.DateTimeFormat('en-US', opts({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    this.partsFmt = new Intl.DateTimeFormat('en-CA', opts({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  },
  dayFmt: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }),
  longDayFmt: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),

  time: (iso) => fmt.timeFmt.format(new Date(iso)),
  stamp: (iso) => fmt.stampFmt.format(new Date(iso)),
  /** Time alone for today (in the site's zone), date and time for anything earlier. */
  when: (iso) => (fmt.wall(new Date(iso)).date === fmt.wall().date ? fmt.time(iso) : fmt.stamp(iso)),
  /** A calendar date ("2026-11-21") is a wall date, not an instant: format it in UTC so it never shifts. */
  day: (ymd) => fmt.dayFmt.format(fromYmd(ymd)),
  longDay: (ymd) => fmt.longDayFmt.format(fromYmd(ymd)),
  /** "13:45" -> "1:45 PM" */
  clock(hhmm) {
    const [hour, minute] = hhmm.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  },
  span: (event) => `${fmt.clock(event.start)}–${fmt.clock(event.end)}`,
  /** Wall-clock date and time in the site's time zone, for now or a given instant. */
  wall(date = new Date()) {
    const parts = Object.fromEntries(fmt.partsFmt.formatToParts(date).map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  },
};
fmt.setZone(DEFAULT_ZONE);

function fromYmd(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;
const digitsOf = (text) => text.replace(/\D/g, '');

/* ----------------------------------------------------------------- API */

class ApiError extends Error {
  constructor(status, code, message, { field, retryAfter = 0 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers, credentials: 'same-origin', cache: 'no-store' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Tsideh-Admin'] = '1';
    init.body = JSON.stringify(body ?? {});
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the kitchen server. Check the connection and try again.');
  }
  const data = await response.json().catch(() => null);
  if (response.ok) return data;
  const { code = 'error', message = `The server answered ${response.status}. Try again.`, field } = data?.error ?? {};
  const error = new ApiError(response.status, code, message, {
    field,
    retryAfter: Number(response.headers.get('Retry-After')) || 0,
  });
  if (path !== LOGIN_PATH && (response.status === 401 || code === 'admin_disabled')) signedOut(error);
  throw error;
}

const eventPath = (suffix = '') => `/api/admin/events/${encodeURIComponent(state.eventId)}${suffix}`;

/* --------------------------------------------------------------- state */

const state = {
  signedIn: false,
  events: [],
  eventsSig: '',
  eventId: null,
  tab: 'orders',
  filter: 'active',
  query: '',
  orders: [],
  ordersLoaded: false,
  pendingStatus: new Map(),
  prep: null,
  inquiries: [],
  pendingInquiry: new Map(),
  updatedAt: 0,
  online: true,
};

const currentEvent = () => state.events.find((event) => event.id === state.eventId) ?? null;
const hasEnded = (event) => Date.parse(event.endsAt) <= Date.now();
const byStart = (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

/* --------------------------------------------------------------- login */

const loginEl = $('login');
const loginForm = $('login-form');
const loginNotice = $('login-notice');
const passwordInput = $('password');
const loginSubmit = $('login-submit');
let lockTimer = 0;

function setNotice(content, tone = 'error') {
  loginNotice.hidden = !content;
  loginNotice.dataset.tone = tone;
  if (content) mount(loginNotice, content);
}

function showLogin({ notice, tone, disabled = false } = {}) {
  app.hidden = true;
  loginEl.hidden = false;
  $('password-field').hidden = disabled;
  loginSubmit.hidden = disabled;
  setNotice(notice, tone);
  if (!disabled) passwordInput.focus();
}

const disabledNotice = () => [
  h('strong', null, 'The kitchen screen is turned off. '),
  'To turn it on, set the ',
  h('code', null, 'ADMIN_PASSWORD'),
  ' environment variable on the server to a password of at least 12 characters, then restart the server.',
];

function lockLogin(seconds) {
  const until = Date.now() + seconds * 1000;
  setNotice('Too many sign-in attempts. Sign-in is paused for a moment to keep the kitchen screen safe.');
  loginSubmit.disabled = true;
  clearInterval(lockTimer);
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left > 0) {
      loginSubmit.textContent = `Try again in ${left}s`;
      return;
    }
    clearInterval(lockTimer);
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign in';
    setNotice(null);
  };
  tick();
  lockTimer = setInterval(tick, 1000);
}

loginForm.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  if (loginSubmit.disabled) return;
  const password = passwordInput.value;
  if (!password) {
    setNotice('Enter the kitchen password.');
    passwordInput.focus();
    return;
  }
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Signing in';
  try {
    await api(LOGIN_PATH, { method: 'POST', body: { password } });
    passwordInput.value = '';
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign in';
    await enterApp({ focus: true });
  } catch (error) {
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign in';
    loginFailed(error);
  }
});

function loginFailed(error) {
  if (error.code === 'rate_limited') return lockLogin(error.retryAfter || 60);
  if (error.code === 'admin_disabled') return showLogin({ notice: disabledNotice(), tone: 'info', disabled: true });
  if (error.code === 'bad_credentials') {
    setNotice('That password didn’t work. Check it and try again.');
    passwordInput.select();
    return;
  }
  setNotice(error.message);
}

/* ---------------------------------------------------------------- shell */

const app = $('app');
const eventSelect = $('event-select');
const liveEl = $('live');
const liveLong = $('live-long');
const liveShort = $('live-short');
const tabs = [...document.querySelectorAll('[role="tab"]')];
let pollTimer = 0;
let refreshing = null;

async function enterApp({ focus = false } = {}) {
  state.signedIn = true;
  loginEl.hidden = true;
  app.hidden = false;
  const stored = prefs.read();
  state.filter = FILTERS[stored.filter] ? stored.filter : 'active';
  renderFilter();
  selectTab(stored.tab, { focus });
  await refresh();
}

function signedOut(error) {
  if (!state.signedIn) return;
  state.signedIn = false;
  clearTimeout(pollTimer);
  hideToast();
  Object.assign(state, { events: [], eventsSig: '', orders: [], ordersLoaded: false, prep: null, inquiries: [] });
  if (error?.code === 'admin_disabled') showLogin({ notice: disabledNotice(), tone: 'info', disabled: true });
  else showLogin({ notice: error ? 'Your session ended. Sign in again to keep going.' : 'Signed out.', tone: error ? 'error' : 'info' });
}

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => null);
  signedOut(null);
});

/* Event picker ------------------------------------------------------- */

/**
 * The remembered event wins only while it is still running or ahead: on the next service day the
 * board must open on that day's event, not last week's.
 */
async function loadEvents() {
  const { events } = await api('/api/admin/events');
  state.events = [...events].sort(byStart);
  if (!currentEvent()) {
    const preferred = prefs.read().eventId;
    const remembered = state.events.find((event) => event.id === preferred && !hasEnded(event));
    const upcoming = state.events.find((event) => !hasEnded(event));
    state.eventId = (remembered ?? upcoming ?? state.events.at(-1))?.id ?? null;
  }
  renderEventChrome();
}

function renderEventChrome() {
  const sig = JSON.stringify(state.events.map((event) => [event.id, event.title, event.date, event.configStatus, hasEnded(event)]));
  if (sig !== state.eventsSig) {
    state.eventsSig = sig;
    const option = (event) => h('option', { value: event.id, selected: event.id === state.eventId },
      `${fmt.day(event.date)}: ${event.title}${event.configStatus === 'hidden' ? ' (hidden from site)' : ''}`);
    const upcoming = state.events.filter((event) => !hasEnded(event));
    const past = state.events.filter(hasEnded);
    mount(eventSelect,
      upcoming.length > 0 && h('optgroup', { label: 'Upcoming' }, upcoming.map(option)),
      past.length > 0 && h('optgroup', { label: 'Recently ended' }, past.reverse().map(option)));
  }
  eventSelect.disabled = state.events.length === 0;
  eventSelect.value = state.eventId ?? '';

  const event = currentEvent();
  const meta = $('event-meta');
  if (!event) {
    mount(meta, 'No events coming up or in the last two weeks.');
    return;
  }
  const [statusKey, statusLabel] = eventStatus(event);
  mount(meta,
    h('span', null, fmt.span(event)),
    h('span', null, event.locationName),
    h('span', { class: 'event-status', 'data-status': statusKey }, statusLabel));
  mount($('prep-event'),
    h('span', { class: 'prep-event-title' }, event.title),
    h('span', null, fmt.longDay(event.date)),
    h('span', null, fmt.span(event)),
    h('span', null, event.locationName));
}

function eventStatus(event) {
  if (hasEnded(event)) return ['ended', 'Ended'];
  if (event.status === 'paused') return ['paused', 'Ordering paused'];
  if (event.configStatus === 'hidden') return ['hidden', 'Hidden from the site'];
  if (event.status === 'open') return ['open', 'Taking orders'];
  if (event.status === 'soldout') return ['soldout', 'Sold out'];
  if (event.status === 'upcoming') return ['upcoming', `Pre-orders open ${fmt.stamp(event.opensAt)}`];
  return ['closed', 'Ordering closed'];
}

eventSelect.addEventListener('change', () => {
  state.eventId = eventSelect.value;
  prefs.write({ eventId: state.eventId });
  Object.assign(state, { orders: [], ordersLoaded: false, prep: null });
  state.pendingStatus.clear();
  renderEventChrome();
  renderOrders();
  renderPrep();
  Promise.all([loadOrders(), loadPrep()]).catch(reportLoadError);
});

function reportLoadError(error) {
  if (state.signedIn && error.status !== 401) toast(error.message, { tone: 'error' });
}

/* Tabs ----------------------------------------------------------------- */

function selectTab(name, { focus = true } = {}) {
  const available = tabs.filter((tab) => !tab.hidden);
  const target = available.find((tab) => tab.dataset.tab === name) ?? available[0];
  state.tab = target.dataset.tab;
  app.dataset.tab = state.tab;
  for (const tab of tabs) {
    const selected = tab === target;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) target.focus();
  prefs.write({ tab: state.tab });
}

/** Bring the newly opened view up to date without waiting for the next poll. */
function loadTab() {
  if (state.tab === 'prep') loadPrep().catch(reportLoadError);
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    if (tab.getAttribute('aria-selected') === 'true') return;
    selectTab(tab.dataset.tab);
    loadTab();
  });
}

document.querySelector('[role="tablist"]').addEventListener('keydown', (keyEvent) => {
  const available = tabs.filter((tab) => !tab.hidden);
  const index = available.indexOf(document.activeElement);
  if (index < 0) return;
  const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: available.length - 1 };
  if (!(keyEvent.key in moves)) return;
  keyEvent.preventDefault();
  const next = available[(moves[keyEvent.key] + available.length) % available.length];
  selectTab(next.dataset.tab);
  loadTab();
});

/* Polling ---------------------------------------------------------------- */

function refresh() {
  refreshing ??= (async () => {
    clearTimeout(pollTimer);
    if (!state.signedIn) return;
    const eventJobs = () => Promise.all([loadOrders(), (state.tab === 'prep' || !state.prep) && loadPrep()]);
    const results = await Promise.allSettled([loadEvents().then(eventJobs), loadCatering()]);
    if (!state.signedIn) return;
    const failure = results.find((result) => result.status === 'rejected');
    state.online = !failure;
    if (!failure) state.updatedAt = Date.now();
    renderLive();
    schedule();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function schedule() {
  clearTimeout(pollTimer);
  if (state.signedIn && !document.hidden) pollTimer = setTimeout(refresh, POLL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (!state.signedIn) return;
  if (document.hidden) clearTimeout(pollTimer);
  else refresh();
});

function renderLive() {
  const connecting = !state.updatedAt && state.online;
  liveEl.dataset.state = connecting ? 'connecting' : state.online ? 'live' : 'offline';
  if (connecting || !state.online) {
    liveLong.textContent = connecting ? 'Connecting' : 'Offline, retrying';
    liveShort.textContent = connecting ? 'Connecting' : 'Offline';
    return;
  }
  const seconds = Math.max(0, Math.round((Date.now() - state.updatedAt) / 1000));
  liveLong.textContent = seconds < 5 ? 'Updated just now'
    : seconds < 60 ? `Updated ${seconds}s ago`
      : `Updated ${Math.floor(seconds / 60)} min ago`;
  liveShort.textContent = 'Live';
}

setInterval(() => {
  if (state.signedIn && !document.hidden) renderLive();
}, 1000);

/* ---------------------------------------------------------------- orders */

const board = $('board');
const boardEmpty = $('board-empty');
const searchInput = $('order-search');

async function loadOrders() {
  if (!state.eventId) return;
  const eventId = state.eventId;
  const { orders } = await api(eventPath('/orders?all=1'));
  if (eventId !== state.eventId) return;
  for (const order of orders) {
    const pending = state.pendingStatus.get(order.code);
    if (pending) order.status = pending.to;
  }
  state.orders = orders;
  state.ordersLoaded = true;
  renderOrders();
}

function matchesQuery(order) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  if (order.code.toLowerCase().includes(query)) return true;
  if (order.customer.name.toLowerCase().includes(query)) return true;
  const digits = digitsOf(query);
  return digits.length >= 3 && digitsOf(order.customer.phone).includes(digits);
}

function renderOrders() {
  const counts = { active: 0, ready: 0, picked_up: 0, all: state.orders.length };
  for (const order of state.orders) {
    for (const key of ['active', 'ready', 'picked_up']) if (FILTERS[key].test(order)) counts[key] += 1;
  }
  for (const el of document.querySelectorAll('[data-count]')) {
    el.textContent = state.ordersLoaded ? String(counts[el.dataset.count]) : '';
  }
  const tabCount = $('count-orders');
  tabCount.hidden = counts.active === 0;
  mount(tabCount, String(counts.active), hiddenText(' active'));

  const filter = FILTERS[state.filter];
  const visible = state.orders.filter((order) => filter.test(order) && matchesQuery(order));
  const bySlot = new Map();
  for (const order of visible) {
    if (!bySlot.has(order.slot)) bySlot.set(order.slot, { slot: order.slot, label: order.slotLabel, orders: [] });
    bySlot.get(order.slot).orders.push(order);
  }
  const groups = [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot));

  const sections = reconcile(board, groups.map((group) => ({
    key: group.slot,
    sig: group.slot,
    build: () => h('section', { class: 'slot', 'aria-labelledby': `slot-${group.slot.replace(':', '')}` },
      h('header', { class: 'slot-head' }),
      h('div', { class: 'tickets' })),
  })));
  for (const group of groups) {
    const section = sections.get(group.slot).node;
    const [head, grid] = section.children;
    mount(head,
      h('h3', { class: 'slot-time', id: `slot-${group.slot.replace(':', '')}` }, group.label),
      h('span', { class: 'slot-count' }, plural(group.orders.length, 'order', 'orders')));
    reconcile(grid, group.orders.map((order) => ({
      key: order.code,
      sig: JSON.stringify([order, state.pendingStatus.has(order.code)]),
      build: () => ticket(order),
    })));
  }

  const noEvents = state.signedIn && state.updatedAt > 0 && state.events.length === 0;
  boardEmpty.hidden = !noEvents && (!state.ordersLoaded || visible.length > 0);
  if (boardEmpty.hidden) return;
  if (noEvents) mount(boardEmpty, h('p', null, 'No events coming up or in the last two weeks. Add one in config/events.json.'));
  else if (state.query.trim()) {
    mount(boardEmpty,
      h('p', null, `No orders match “${state.query.trim()}”.`),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: clearSearch }, 'Clear search'));
  } else mount(boardEmpty, h('p', null, filter.empty));
}

function ticket(order) {
  const status = ORDER_STATUS[order.status] ?? { label: order.status };
  const busy = state.pendingStatus.has(order.code);
  const id = `ticket-${order.code}`;
  const split = order.code.indexOf('-') + 1;
  const { action } = status;
  const when = order.paidAt ? `Paid ${fmt.when(order.paidAt)}`
    : order.status === 'pending' ? `Checking out since ${fmt.when(order.createdAt)}`
      : `Placed ${fmt.when(order.createdAt)}`;

  return h('article', { class: ['ticket', `is-${order.status}`], 'aria-labelledby': id },
    h('p', { class: 'ticket-strip' }, h('span', null, status.label)),
    h('h4', { class: 'ticket-code', id }, h('span', { class: 'ticket-code-prefix' }, order.code.slice(0, split)), order.code.slice(split)),
    h('p', { class: 'ticket-name' }, order.customer.name),
    order.customer.phone && h('a', { class: 'ticket-phone', href: telHref(order.customer.phone) }, order.customer.phone),
    order.oversold && h('p', { class: 'ticket-flag' },
      h('strong', null, 'Oversold. '),
      'Paid after its hold expired, so it goes past a limit. Check stock.'),
    h('ul', { class: 'ticket-items' }, order.items.map((item) => h('li', null,
      h('span', { class: 'ticket-qty' }, `${item.qty}×`),
      h('span', { class: 'ticket-item' }, item.name)))),
    order.notes && h('p', { class: 'ticket-note' }, h('strong', null, 'Note '), order.notes),
    h('p', { class: 'ticket-when' }, when),
    action && h('button', {
      class: ['btn', 'ticket-action', `ticket-action-${order.status}`],
      type: 'button',
      'data-focus': 'action',
      'aria-busy': busy ? 'true' : null,
      onclick: () => setOrderStatus(order.code, action.to),
    }, action.label));
}

function changeMessage(code, from, to) {
  if (to === 'picked_up') return `${code} picked up.`;
  if (to === 'ready') return from === 'picked_up' ? `${code} is back to ready.` : `${code} is ready.`;
  return `${code} is back to paid.`;
}

async function setOrderStatus(code, to, { undoable = true } = {}) {
  const order = state.orders.find((candidate) => candidate.code === code);
  if (!order || state.pendingStatus.has(code) || order.status === to) return;
  const from = order.status;
  state.pendingStatus.set(code, { from, to });
  order.status = to;
  renderOrders();
  try {
    await api(`/api/admin/orders/${encodeURIComponent(code)}/status`, { method: 'POST', body: { status: to } });
    state.pendingStatus.delete(code);
    toast(changeMessage(code, from, to), undoable
      ? { action: { label: 'Undo', run: () => setOrderStatus(code, from, { undoable: false }) } }
      : {});
  } catch (error) {
    state.pendingStatus.delete(code);
    const current = state.orders.find((candidate) => candidate.code === code);
    if (current) current.status = from;
    if (error.status !== 401) toast(error.status === 0 ? `${code} wasn’t changed. ${error.message}` : error.message, { tone: 'error' });
    if (error.status === 409) loadOrders().catch(() => null);
  }
  renderOrders();
}

function renderFilter() {
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
  }
}

for (const button of document.querySelectorAll('[data-filter]')) {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    prefs.write({ filter: state.filter });
    renderFilter();
    renderOrders();
  });
}

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  renderOrders();
});

function clearSearch() {
  searchInput.value = '';
  state.query = '';
  renderOrders();
  searchInput.focus();
}

/* ------------------------------------------------------------------ prep */

const prepTable = document.querySelector('.prep-table');
const prepHead = prepTable.tHead;
const prepTotal = $('prep-total');

async function loadPrep() {
  if (!state.eventId) return;
  const eventId = state.eventId;
  const prep = await api(eventPath('/prep'));
  if (eventId !== state.eventId) return;
  state.prep = prep;
  renderPrep();
}

function renderPrep() {
  const prep = state.prep;
  if (!prep) {
    reconcile(prepTable, [], prepHead);
    mount(prepTotal);
    return;
  }
  const categories = [];
  for (const item of prep.items) {
    const last = categories.at(-1);
    if (last?.name === item.category) last.items.push(item);
    else categories.push({ name: item.category, items: [item] });
  }
  const bodies = reconcile(prepTable, categories.map((category) => ({
    key: category.name,
    sig: category.name,
    build: () => h('tbody', null,
      h('tr', { class: 'group-row' }, h('th', { scope: 'rowgroup', colspan: '5' }, category.name))),
  })), prepHead);
  for (const category of categories) {
    const body = bodies.get(category.name).node;
    reconcile(body, category.items.map((item) => ({
      key: item.id,
      sig: JSON.stringify(item),
      build: () => prepRow(item),
    })), body.firstElementChild);
  }

  const committed = prep.items.reduce((sum, item) => sum + item.committed, 0);
  const pending = prep.items.reduce((sum, item) => sum + item.pending, 0);
  mount(prepTotal, h('tr', null,
    h('th', { scope: 'row', class: 'col-item' }, 'Total'),
    h('td', { class: 'num num-major' }, committed, pending > 0 && h('span', { class: 'pending-sub' }, `+${pending} paying now`)),
    h('td', { class: 'num col-pending' }, pending),
    h('td', { class: 'num col-limit' }),
    h('td', { class: 'num' })));
}

function prepRow(item) {
  const limited = item.limit !== null;
  const out = limited && item.remaining <= 0;
  const low = limited && !out && item.remaining <= Math.max(3, Math.ceil(item.limit * 0.1));
  return h('tr', { class: ['prep-row', out && 'is-off'] },
    h('th', { scope: 'row', class: 'col-item' },
      h('span', { class: 'prep-name' }, item.name),
      out && h('span', { class: 'prep-flag' }, 'All sold')),
    h('td', { class: 'num num-major' }, item.committed,
      item.pending > 0 && h('span', { class: 'pending-sub' }, `+${item.pending} paying now`)),
    h('td', { class: ['num', 'col-pending', item.pending === 0 && 'is-zero'] }, item.pending),
    h('td', { class: 'num col-limit' }, limited ? item.limit : noLimit()),
    h('td', { class: ['num', low && 'is-low', out && 'is-out'] },
      limited ? [String(Math.max(0, item.remaining)), h('span', { class: 'of-limit' }, ` of ${item.limit}`), low && hiddenText(', running low')] : noLimit()));
}

$('print').addEventListener('click', () => window.print());


/* -------------------------------------------------------------- catering */

const inquiriesEl = $('inquiries');

async function loadCatering() {
  const { inquiries } = await api('/api/admin/catering');
  for (const inquiry of inquiries) {
    const pending = state.pendingInquiry.get(inquiry.id);
    if (pending) inquiry.status = pending;
  }
  state.inquiries = inquiries;
  renderCatering();
}

function renderCatering() {
  const fresh = state.inquiries.filter((inquiry) => inquiry.status === 'new').length;
  const tabCount = $('count-catering');
  tabCount.hidden = fresh === 0;
  mount(tabCount, String(fresh), hiddenText(' new'));
  mount($('catering-summary'), state.inquiries.length === 0 ? ''
    : fresh > 0 ? `${plural(fresh, 'new inquiry', 'new inquiries')} to answer, ${state.inquiries.length} in all.`
      : `All caught up. ${plural(state.inquiries.length, 'inquiry', 'inquiries')} in all.`);
  reconcile(inquiriesEl, state.inquiries.map((inquiry) => ({
    key: String(inquiry.id),
    sig: JSON.stringify([inquiry, state.pendingInquiry.has(inquiry.id)]),
    build: () => inquiryCard(inquiry),
  })));
  const empty = $('catering-empty');
  empty.hidden = state.inquiries.length > 0;
  if (!empty.hidden) mount(empty, h('p', null, 'No catering inquiries yet. New ones from the catering form land here.'));
}

function fact(label, value, wide = false) {
  if (value === null || value === undefined || value === '') return null;
  return h('div', { class: ['fact', wide && 'fact-wide'] }, h('dt', null, label), h('dd', null, value));
}

function inquiryCard(inquiry) {
  const id = `inquiry-${inquiry.id}`;
  const selectId = `inquiry-status-${inquiry.id}`;
  // Only a plain address becomes a mailto: link. Anything with ?, &, % or the like could add
  // Bcc, subject or body headers to the kitchen's reply, so it is shown as text instead.
  const validEmail = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(inquiry.email);
  return h('article', { class: ['inquiry', `is-${inquiry.status}`], 'aria-labelledby': id },
    h('header', { class: 'inquiry-head' },
      h('div', { class: 'inquiry-who' },
        h('h3', { class: 'inquiry-name', id },
          inquiry.name,
          inquiry.status === 'new' && h('span', { class: 'tag tag-new' }, 'New')),
        h('p', { class: 'inquiry-received' }, `Received ${fmt.stamp(inquiry.createdAt)}`)),
      h('div', { class: 'inquiry-status' },
        h('label', { for: selectId }, 'Status'),
        h('span', { class: 'select-wrap' },
          h('select', {
            id: selectId,
            'data-focus': 'status',
            onchange: (changeEvent) => setInquiryStatus(inquiry.id, changeEvent.target),
          }, Object.entries(CATERING_STATUS).map(([value, label]) => h('option', { value, selected: value === inquiry.status }, label)))))),
    h('dl', { class: 'facts' },
      fact('Event date', fmt.longDay(inquiry.eventDate)),
      fact('Guests', String(inquiry.guestCount)),
      fact('Service', inquiry.serviceStyle),
      fact('Budget', inquiry.budget),
      fact('Location', inquiry.location, true),
      fact('Dietary needs', inquiry.dietary, true)),
    inquiry.message && h('p', { class: 'inquiry-message' }, inquiry.message),
    h('p', { class: 'inquiry-contact' },
      validEmail ? h('a', { href: `mailto:${inquiry.email}` }, inquiry.email) : h('span', null, inquiry.email),
      inquiry.phone && h('a', { href: telHref(inquiry.phone) }, inquiry.phone)));
}

async function setInquiryStatus(id, select) {
  const inquiry = state.inquiries.find((candidate) => candidate.id === id);
  const status = select.value;
  if (!inquiry || inquiry.status === status) return;
  if (state.pendingInquiry.has(id)) {
    select.value = inquiry.status;
    return;
  }
  const previous = inquiry.status;
  inquiry.status = status;
  state.pendingInquiry.set(id, status);
  renderCatering();
  try {
    await api(`/api/admin/catering/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } });
    toast(`${inquiry.name} marked ${CATERING_STATUS[status].toLowerCase()}.`);
  } catch (error) {
    inquiry.status = previous;
    if (error.status !== 401) toast(`Status wasn’t changed. ${error.message}`, { tone: 'error' });
  }
  state.pendingInquiry.delete(id);
  renderCatering();
}

/* ---------------------------------------------------------------- toast */

const toastEl = $('toast');
const toastText = $('toast-text');
const toastAction = $('toast-action');
const announcer = $('announcer');
let toastTimer = 0;

/** Visual toast plus a screen-reader announcement through a live region that is always present. */
function toast(message, { tone = 'info', action } = {}) {
  clearTimeout(toastTimer);
  announcer.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  announcer.textContent = message;
  toastEl.dataset.tone = tone;
  toastText.textContent = message;
  toastAction.hidden = !action;
  toastAction.onclick = action ? () => {
    hideToast();
    action.run();
  } : null;
  if (action) toastAction.textContent = action.label;
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, action ? TOAST_MS * 1.5 : TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const [session, site] = await Promise.allSettled([api('/api/admin/session'), api('/api/site')]);
  if (site.status === 'fulfilled' && site.value?.timezone) fmt.setZone(site.value.timezone);
  if (session.status === 'rejected') {
    const error = session.reason;
    if (error.code === 'admin_disabled') showLogin({ notice: disabledNotice(), tone: 'info', disabled: true });
    else showLogin({ notice: error.message });
    return;
  }
  if (session.value.authenticated) await enterApp();
  else showLogin();
}

boot();
