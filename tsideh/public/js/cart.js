// The cart: item quantities per pop-up, kept in this browser so a reload or a canceled checkout
// never loses an order in progress, plus the checkout draft for this tab. Prices are never stored;
// the server prices every order.

const KEY = 'tsideh.cart.v1';
const events = new EventTarget();

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

let memory = read();

function write(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode or full storage: the cart still works for this page view.
  }
  memory = all;
  events.dispatchEvent(new Event('change'));
}

/** { itemId: qty } for one pop-up. */
export function getItems(eventId) {
  const entry = memory[eventId];
  return entry && typeof entry.items === 'object' ? { ...entry.items } : {};
}

export function getQty(eventId, itemId) {
  const qty = memory[eventId]?.items?.[itemId];
  return Number.isInteger(qty) && qty > 0 ? qty : 0;
}

export function setQty(eventId, itemId, qty) {
  const all = { ...memory };
  const items = { ...(all[eventId]?.items ?? {}) };
  if (qty > 0) items[itemId] = qty;
  else delete items[itemId];
  if (Object.keys(items).length) all[eventId] = { items, updatedAt: Date.now() };
  else delete all[eventId];
  write(all);
}

function replaceItems(eventId, items) {
  const all = { ...memory };
  if (Object.keys(items).length) all[eventId] = { items, updatedAt: all[eventId]?.updatedAt ?? Date.now() };
  else delete all[eventId];
  write(all);
}

export function clear(eventId) {
  if (!memory[eventId]) return;
  const all = { ...memory };
  delete all[eventId];
  write(all);
}

export const count = (eventId) => Object.values(getItems(eventId)).reduce((sum, qty) => sum + qty, 0);

/** The pop-up with the most recently touched non-empty cart, or null. */
export function latest() {
  let best = null;
  for (const [eventId, entry] of Object.entries(memory)) {
    if (!best || (entry.updatedAt ?? 0) > best.updatedAt) best = { eventId, updatedAt: entry.updatedAt ?? 0 };
  }
  return best ? { eventId: best.eventId, count: count(best.eventId) } : null;
}

/** The fewest of a dish one order can have: 1, unless the kitchen sets a minimum (dinners for two and up). */
export const minQtyOf = (item) => (Number.isInteger(item.minQty) && item.minQty > 1 ? item.minQty : 1);

/** How many more of a dish one order can take: 0 when fewer than its minimum are left. */
export function capOf(item, maxQtyPerItem) {
  const cap = item.soldOut ? 0 : Math.min(maxQtyPerItem, item.remaining ?? Infinity);
  return cap < minQtyOf(item) ? 0 : cap;
}

/**
 * Brings a saved cart in line with the live menu: drops items that left the menu or sold out,
 * trims quantities to what is left and raises any below a dish's minimum. Returns what changed:
 * [{ name, before, after }].
 */
export function reconcile(eventId, menuItems, maxQtyPerItem) {
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  const items = getItems(eventId);
  const next = {};
  const changed = [];
  for (const [id, qty] of Object.entries(items)) {
    const item = byId.get(id);
    if (!item) continue;
    const cap = capOf(item, maxQtyPerItem);
    const kept = Math.min(Math.max(qty, minQtyOf(item)), cap);
    if (kept !== qty) changed.push({ name: item.name, before: qty, after: kept });
    if (kept > 0) next[id] = kept;
  }
  if (Object.keys(next).length !== Object.keys(items).length || changed.length) replaceItems(eventId, next);
  return changed;
}

export function subscribe(listener) {
  events.addEventListener('change', listener);
  return () => events.removeEventListener('change', listener);
}

/* Checkout details typed on this device live only for this tab (sessionStorage), so a canceled
   Stripe checkout comes back to a filled-in form without keeping personal data around. */
const DRAFT_KEY = 'tsideh.checkout.v1';

export function getDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}');
    return draft && typeof draft === 'object' ? draft : {};
  } catch {
    return {};
  }
}

export function saveDraft(patch) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...getDraft(), ...patch }));
  } catch {
    // Storage blocked: the form still works, it just will not be refilled after a reload.
  }
}

// Keep tabs in step: another tab's change arrives as a storage event.
addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  memory = read();
  events.dispatchEvent(new Event('change'));
});
