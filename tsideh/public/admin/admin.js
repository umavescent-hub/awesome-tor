// Tsideh kitchen screen: live orders board, prep sheet and catering inbox.
//
// Safety model: customer-provided strings only ever reach the page as text nodes (h() never parses
// markup, and nothing here touches innerHTML), the page runs under a strict CSP with Trusted Types,
// and every mutation carries the X-Tsideh-Admin header the server requires on top of its
// SameSite=Strict session cookie. A 401 from any call returns the screen to sign-in.

const POLL_MS = 15_000;
const FRESH_MS = 8_000;
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

const ACTIVITY_LABELS = {
  login_success: 'Signed in',
  login_failure: 'Sign-in failed',
  logout: 'Signed out',
  order_status: 'Order',
  event_pause: 'Online ordering',
  item_sold_out: '86',
  catering_status: 'Catering',
};

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
  features: { totp: false, activity: false },
  events: [],
  eventsSig: '',
  eventId: null,
  tab: 'orders',
  filter: 'active',
  query: '',
  orders: [],
  ordersLoaded: false,
  seen: new Set(),
  fresh: new Map(),
  pendingStatus: new Map(),
  prep: null,
  prepSig: '',
  pending86: new Set(),
  inquiries: [],
  pendingInquiry: new Map(),
  activitySig: '',
  updatedAt: 0,
  online: true,
  sound: false,
};

const currentEvent = () => state.events.find((event) => event.id === state.eventId) ?? null;
const hasEnded = (event) => Date.parse(event.endsAt) <= Date.now();
const byStart = (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

/* --------------------------------------------------------------- login */

const loginEl = $('login');
const loginForm = $('login-form');
const loginNotice = $('login-notice');
const passwordInput = $('password');
const totpField = $('totp-field');
const totpInput = $('totp');
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
  totpField.hidden = disabled || !state.features.totp;
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
  const body = { password };
  if (!totpField.hidden) body.totp = totpInput.value.trim();
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'Signing in';
  try {
    await api(LOGIN_PATH, { method: 'POST', body });
    passwordInput.value = '';
    totpInput.value = '';
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign in';
    state.features = featuresOf(await api('/api/admin/session'));
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
  if (error.field === 'totp') {
    totpField.hidden = false;
    setNotice(error.message);
    totpInput.focus();
    return;
  }
  if (error.code === 'bad_credentials') {
    setNotice(totpField.hidden
      ? 'That password didn’t work. Check it and try again.'
      : 'That password or code didn’t work. Check both and try again.');
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
const soundToggle = $('sound-toggle');
const tabs = [...document.querySelectorAll('[role="tab"]')];
let pollTimer = 0;
let refreshing = null;

/** Optional server capabilities advertised by GET /api/admin/session; absent means off. */
const featuresOf = (session) => ({ totp: session?.totp === true, activity: session?.activity === true });

async function enterApp({ focus = false } = {}) {
  state.signedIn = true;
  loginEl.hidden = true;
  app.hidden = false;
  $('tab-activity').hidden = !state.features.activity;
  const stored = prefs.read();
  state.filter = FILTERS[stored.filter] ? stored.filter : 'active';
  renderFilter();
  selectTab(stored.tab, { focus });
  keepAwake();
  await refresh();
}

function signedOut(error) {
  if (!state.signedIn) return;
  state.signedIn = false;
  clearTimeout(pollTimer);
  releaseAwake();
  hideToast();
  if (confirmEl.open) confirmEl.close();
  Object.assign(state, {
    events: [], eventsSig: '', orders: [], ordersLoaded: false, prep: null, prepSig: '',
    inquiries: [], activitySig: '',
  });
  state.seen.clear();
  state.fresh.clear();
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
    $('paused-banner').hidden = true;
    return;
  }
  const [statusKey, statusLabel] = eventStatus(event);
  mount(meta,
    h('span', null, fmt.span(event)),
    h('span', null, event.locationName),
    h('span', { class: 'event-status', 'data-status': statusKey }, statusLabel));
  $('paused-banner').hidden = !event.paused;
  $('csv').href = eventPath('/orders.csv');
  mount($('prep-event'),
    h('span', { class: 'prep-event-title' }, event.title),
    h('span', null, fmt.longDay(event.date)),
    h('span', null, fmt.span(event)),
    h('span', null, event.locationName));

  const pill = $('ordering-state');
  pill.dataset.status = statusKey;
  pill.textContent = statusLabel;
  const toggle = $('pause-toggle');
  const lockedByConfig = event.configStatus === 'paused' && !event.paused;
  toggle.textContent = event.paused ? 'Resume online ordering' : 'Pause online ordering';
  toggle.disabled = lockedByConfig;
  toggle.title = lockedByConfig ? 'This event is paused in the events config file.' : '';
}

function eventStatus(event) {
  if (hasEnded(event)) return ['ended', 'Ended'];
  if (event.paused || event.status === 'paused') return ['paused', 'Ordering paused'];
  if (event.configStatus === 'hidden') return ['hidden', 'Hidden from the site'];
  if (event.status === 'open') return ['open', 'Taking orders'];
  if (event.status === 'soldout') return ['soldout', 'Sold out'];
  if (event.status === 'upcoming') return ['upcoming', `Pre-orders open ${fmt.stamp(event.opensAt)}`];
  return ['closed', 'Ordering closed'];
}

eventSelect.addEventListener('change', () => {
  state.eventId = eventSelect.value;
  prefs.write({ eventId: state.eventId });
  Object.assign(state, { orders: [], ordersLoaded: false, prep: null, prepSig: '' });
  state.seen.clear();
  state.fresh.clear();
  state.pendingStatus.clear();
  state.pending86.clear();
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
  if (state.tab === 'activity') loadActivity().catch(reportLoadError);
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
    const results = await Promise.allSettled([
      loadEvents().then(eventJobs),
      loadCatering(),
      state.tab === 'activity' && loadActivity(),
    ]);
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
  if (document.hidden) {
    clearTimeout(pollTimer);
  } else {
    keepAwake();
    refresh();
  }
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

/* Screen wake lock: a kitchen tablet at the pass should not dim mid-service. */
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || wakeLock || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}
function releaseAwake() {
  wakeLock?.release();
}

/* Sound ---------------------------------------------------------------- */

let audio = null;

/** AudioContext needs a user gesture: create or resume it from one. */
function unlockAudio() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
}

function chime() {
  if (!state.sound || audio?.state !== 'running') return;
  const start = audio.currentTime + 0.02;
  for (const [frequency, offset] of [[880, 0], [1318.5, 0.17]]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.6);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.65);
  }
}

function renderSound() {
  soundToggle.setAttribute('aria-pressed', String(state.sound));
  soundToggle.querySelector('.bar-btn-label').textContent = state.sound ? 'Sound on' : 'Sound off';
}

soundToggle.addEventListener('click', () => {
  state.sound = !state.sound;
  prefs.write({ sound: state.sound });
  renderSound();
  if (state.sound) {
    unlockAudio();
    chime();
  }
});

/* A remembered "sound on" still needs one gesture after a reload before the browser allows audio. */
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, () => {
    if (state.sound) unlockAudio();
  }, { capture: true, passive: true });
}

/* ---------------------------------------------------------------- orders */

const board = $('board');
const boardEmpty = $('board-empty');
const searchInput = $('order-search');

async function loadOrders() {
  if (!state.eventId) return;
  const eventId = state.eventId;
  const { orders } = await api(eventPath('/orders?all=1'));
  if (eventId !== state.eventId) return;
  const now = Date.now();
  let arrivals = 0;
  for (const order of orders) {
    const pending = state.pendingStatus.get(order.code);
    if (pending) order.status = pending.to;
    if (!['paid', 'ready', 'picked_up'].includes(order.status) || state.seen.has(order.code)) continue;
    state.seen.add(order.code);
    if (state.ordersLoaded && order.status === 'paid') {
      state.fresh.set(order.code, now + FRESH_MS);
      arrivals += 1;
    }
  }
  state.orders = orders;
  state.ordersLoaded = true;
  if (arrivals) {
    chime();
    setTimeout(renderOrders, FRESH_MS + 50);
  }
  renderOrders();
}

const isFresh = (code) => (state.fresh.get(code) ?? 0) > Date.now();

function matchesQuery(order) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  if (order.code.toLowerCase().includes(query)) return true;
  if (order.customer.name.toLowerCase().includes(query)) return true;
  const digits = digitsOf(query);
  return digits.length >= 3 && digitsOf(order.customer.phone).includes(digits);
}

/** The pickup slot that is happening right now, on the event's own day and clock. */
function currentSlot() {
  const event = currentEvent();
  const slots = state.prep?.slots;
  if (!event || !slots?.length) return null;
  const now = fmt.wall();
  if (now.date !== event.date || now.time < slots[0].time || now.time >= event.end) return null;
  return slots.findLast((slot) => slot.time <= now.time)?.time ?? null;
}

function renderOrders() {
  for (const [code, until] of state.fresh) if (until <= Date.now()) state.fresh.delete(code);
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

  const nowSlot = currentSlot();
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
    const isNow = group.slot === nowSlot;
    section.classList.toggle('is-now', isNow);
    mount(head,
      h('h3', { class: 'slot-time', id: `slot-${group.slot.replace(':', '')}` }, group.label),
      h('span', { class: 'slot-count' }, plural(group.orders.length, 'order', 'orders')),
      isNow && h('span', { class: 'tag tag-now' }, 'Now'));
    reconcile(grid, group.orders.map((order) => ({
      key: order.code,
      sig: JSON.stringify([order, isFresh(order.code), state.pendingStatus.has(order.code)]),
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
  const fresh = isFresh(order.code);
  const busy = state.pendingStatus.has(order.code);
  const id = `ticket-${order.code}`;
  const split = order.code.indexOf('-') + 1;
  const { action } = status;
  const when = order.paidAt ? `Paid ${fmt.when(order.paidAt)}`
    : order.status === 'pending' ? `Checking out since ${fmt.when(order.createdAt)}`
      : `Placed ${fmt.when(order.createdAt)}`;

  return h('article', { class: ['ticket', `is-${order.status}`, fresh && 'is-fresh'], 'aria-labelledby': id },
    h('p', { class: 'ticket-strip' }, h('span', null, status.label), fresh && h('span', { class: 'tag tag-new' }, 'New')),
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
const matrix = $('matrix');

async function loadPrep() {
  if (!state.eventId) return;
  const eventId = state.eventId;
  const prep = await api(eventPath('/prep'));
  if (eventId !== state.eventId) return;
  for (const item of prep.items) {
    if (state.pending86.has(item.id)) item.soldOut = !item.soldOut;
  }
  state.prep = prep;
  renderPrep();
  renderOrders();
}

function renderPrep() {
  const prep = state.prep;
  if (!prep) {
    reconcile(prepTable, [], prepHead);
    mount(prepTotal);
    mount(matrix);
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
      h('tr', { class: 'group-row' }, h('th', { scope: 'rowgroup', colspan: '6' }, category.name))),
  })), prepHead);
  for (const category of categories) {
    const body = bodies.get(category.name).node;
    reconcile(body, category.items.map((item) => ({
      key: item.id,
      sig: JSON.stringify([item, state.pending86.has(item.id)]),
      build: () => prepRow(item),
    })), body.firstElementChild);
  }

  const committed = prep.items.reduce((sum, item) => sum + item.committed, 0);
  const pending = prep.items.reduce((sum, item) => sum + item.pending, 0);
  const off = prep.items.filter((item) => item.soldOut).length;
  mount(prepTotal, h('tr', null,
    h('th', { scope: 'row', class: 'col-item' }, 'Total'),
    h('td', { class: 'num num-major' }, committed, pending > 0 && h('span', { class: 'pending-sub' }, `+${pending} pending`)),
    h('td', { class: 'num col-pending' }, pending),
    h('td', { class: 'num col-limit' }),
    h('td', { class: 'num' }),
    h('td', { class: 'col-86 total-86' }, off > 0 && `${off} out`)));

  renderMatrix();
}

function prepRow(item) {
  const limited = item.limit !== null;
  const out = limited && item.remaining <= 0;
  const low = limited && !out && item.remaining <= Math.max(3, Math.ceil(item.limit * 0.1));
  const busy = state.pending86.has(item.id);
  return h('tr', { class: ['prep-row', item.soldOut && 'is-off'] },
    h('th', { scope: 'row', class: 'col-item' },
      h('span', { class: 'prep-name' }, item.name),
      item.soldOut && h('span', { class: 'prep-flag' }, out ? 'Limit reached' : '86’d')),
    h('td', { class: 'num num-major' }, item.committed,
      item.pending > 0 && h('span', { class: 'pending-sub' }, `+${item.pending} pending`)),
    h('td', { class: ['num', 'col-pending', item.pending === 0 && 'is-zero'] }, item.pending),
    h('td', { class: 'num col-limit' }, limited ? item.limit : noLimit()),
    h('td', { class: ['num', low && 'is-low', out && 'is-out'] },
      limited ? [String(Math.max(0, item.remaining)), h('span', { class: 'of-limit' }, ` of ${item.limit}`), low && hiddenText(', running low')] : noLimit()),
    h('td', { class: 'col-86' },
      h('button', {
        class: 'switch',
        type: 'button',
        role: 'switch',
        'aria-checked': String(item.soldOut),
        'aria-label': `86 ${item.name}`,
        title: out ? 'The limit is reached, so it’s sold out already.' : item.soldOut ? 'Put back on the menu' : 'Mark sold out',
        'data-focus': 'switch',
        'aria-busy': busy ? 'true' : null,
        disabled: out,
        onclick: () => toggle86(item.id),
      }, h('span', { class: 'switch-text', 'aria-hidden': 'true' }, '86'), h('span', { class: 'switch-knob' }))));
}

function renderMatrix() {
  const { items, slots } = state.prep;
  const nowSlot = currentSlot();
  const columns = items.filter((item) => slots.some((slot) => slot.items[item.id]));
  const sig = JSON.stringify([columns.map((item) => [item.id, item.name]), slots, nowSlot]);
  if (sig === state.prepSig) return;
  state.prepSig = sig;
  const empty = columns.length === 0;
  $('matrix-scroll').hidden = empty;
  $('matrix-empty').hidden = !empty;
  if (empty) {
    mount($('matrix-empty'), h('p', null, 'Nothing committed yet. The breakdown fills in as orders are paid.'));
    mount(matrix);
    return;
  }
  const qty = (value) => (value ? String(value) : [h('span', { class: 'dash', 'aria-hidden': 'true' }, '–'), hiddenText('0')]);
  const total = (id) => slots.reduce((sum, slot) => sum + (slot.items[id] ?? 0), 0);
  mount(matrix,
    h('thead', null, h('tr', null,
      h('th', { scope: 'col', class: 'col-slot' }, 'Pickup'),
      h('th', { scope: 'col', class: 'num col-orders' }, 'Orders'),
      columns.map((item) => h('th', { scope: 'col', class: 'num' }, item.name)))),
    h('tbody', null, slots.map((slot) => h('tr', { class: [slot.orders === 0 && 'is-quiet', slot.time === nowSlot && 'is-now'] },
      h('th', { scope: 'row', class: 'col-slot' }, slot.label, slot.time === nowSlot && h('span', { class: 'tag tag-now' }, 'Now')),
      h('td', { class: 'num col-orders' }, qty(slot.orders)),
      columns.map((item) => h('td', { class: 'num' }, qty(slot.items[item.id])))))),
    h('tfoot', null, h('tr', null,
      h('th', { scope: 'row', class: 'col-slot' }, 'Total'),
      h('td', { class: 'num col-orders' }, slots.reduce((sum, slot) => sum + slot.orders, 0)),
      columns.map((item) => h('td', { class: 'num' }, total(item.id))))));
}

async function toggle86(itemId) {
  const item = state.prep?.items.find((candidate) => candidate.id === itemId);
  if (!item || state.pending86.has(itemId)) return;
  const eventId = state.eventId;
  const soldOut = !item.soldOut;
  state.pending86.add(itemId);
  item.soldOut = soldOut;
  renderPrep();
  try {
    await api(`${eventPath('/items/')}${encodeURIComponent(itemId)}/sold-out`, { method: 'POST', body: { soldOut } });
    toast(soldOut ? `${item.name} is 86’d. Customers see it as sold out.` : `${item.name} is back on the menu.`);
  } catch (error) {
    item.soldOut = !soldOut;
    if (error.status !== 401) toast(`${item.name} wasn’t changed. ${error.message}`, { tone: 'error' });
  }
  state.pending86.delete(itemId);
  if (eventId !== state.eventId) return;
  renderPrep();
  loadPrep().catch(() => null);
}

$('print').addEventListener('click', () => window.print());

async function setPaused(paused) {
  const event = currentEvent();
  if (!event) return;
  if (paused) {
    const confirmed = await confirmDialog({
      title: `Pause online ordering for ${event.title}?`,
      body: 'Customers won’t be able to place new pre-orders until you resume. Orders already paid stay on the board.',
      confirm: 'Pause ordering',
    });
    if (!confirmed) return;
  }
  event.paused = paused;
  renderEventChrome();
  try {
    await api(eventPath('/pause'), { method: 'POST', body: { paused } });
    toast(paused ? 'Online ordering is paused.' : 'Online ordering is back on.');
    loadEvents().catch(() => null);
  } catch (error) {
    event.paused = !paused;
    renderEventChrome();
    if (error.status !== 401) toast(`Online ordering wasn’t changed. ${error.message}`, { tone: 'error' });
  }
}

$('pause-toggle').addEventListener('click', () => setPaused(!currentEvent()?.paused));
$('banner-resume').addEventListener('click', () => setPaused(false));

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
  const validEmail = /^[^\s@<>]+@[^\s@<>]+$/.test(inquiry.email);
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

/* -------------------------------------------------------------- activity */

async function loadActivity() {
  if (!state.features.activity) return;
  const { entries } = await api('/api/admin/activity');
  const sig = JSON.stringify(entries);
  if (sig === state.activitySig) return;
  state.activitySig = sig;
  mount($('activity'), entries.map((entry) => h('li', { class: ['activity-entry', `is-${entry.action}`] },
    h('time', { datetime: entry.at }, fmt.stamp(entry.at)),
    h('span', { class: 'activity-action' }, ACTIVITY_LABELS[entry.action] ?? entry.action.replaceAll('_', ' ')),
    h('span', { class: 'activity-detail' }, entry.detail))));
  const empty = $('activity-empty');
  empty.hidden = entries.length > 0;
  if (!empty.hidden) mount(empty, h('p', null, 'Nothing logged yet.'));
}

/* ---------------------------------------------------------- toast, dialog */

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

const confirmEl = $('confirm');

function confirmDialog({ title, body, confirm }) {
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('confirm-ok').textContent = confirm;
  confirmEl.returnValue = '';
  confirmEl.showModal();
  return new Promise((resolve) => {
    confirmEl.addEventListener('close', () => resolve(confirmEl.returnValue === 'confirm'), { once: true });
  });
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  state.sound = prefs.read().sound === true;
  renderSound();
  const [session, site] = await Promise.allSettled([api('/api/admin/session'), api('/api/site')]);
  if (site.status === 'fulfilled' && site.value?.timezone) fmt.setZone(site.value.timezone);
  if (session.status === 'rejected') {
    const error = session.reason;
    if (error.code === 'admin_disabled') showLogin({ notice: disabledNotice(), tone: 'info', disabled: true });
    else showLogin({ notice: error.message });
    return;
  }
  state.features = featuresOf(session.value);
  if (session.value.authenticated) await enterApp();
  else showLogin();
}

boot();
