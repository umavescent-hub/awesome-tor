// The catalog is the validated config compiled into fast lookups with every event time resolved to
// UTC once. The evaluation functions are pure: they take "now", current usage and kitchen
// overrides, and say what is orderable.

import { addDays, minutesOf, timeLabel, timeOf, toIso, zonedToUtc } from './time.js';

const DAY = 86_400_000;

function compileEvent(config, items, timeZone) {
  const slots = [];
  for (let m = minutesOf(config.start); m + config.slotMinutes <= minutesOf(config.end); m += config.slotMinutes) {
    const time = timeOf(m);
    slots.push({ time, label: timeLabel(time), atMs: zonedToUtc(config.date, time, timeZone) });
  }
  const onMenu = config.menu === 'all' ? null : new Set(config.menu);
  return {
    id: config.id,
    title: config.title,
    date: config.date,
    start: config.start,
    end: config.end,
    locationName: config.locationName,
    address: config.address ?? '',
    mapUrl: config.mapUrl ?? '',
    note: config.note ?? '',
    configStatus: config.status,
    slotMinutes: config.slotMinutes,
    ordersPerSlot: config.ordersPerSlot,
    startsAtMs: zonedToUtc(config.date, config.start, timeZone),
    endsAtMs: zonedToUtc(config.date, config.end, timeZone),
    opensAtMs: zonedToUtc(addDays(config.date, -config.preorderOpensDaysBefore), '00:00', timeZone),
    slots,
    slotsByTime: new Map(slots.map((slot) => [slot.time, slot])),
    menuItems: [...items.values()].filter((item) => !onMenu || onMenu.has(item.id)),
    limits: new Map(Object.entries(config.itemLimits ?? {})),
  };
}

export function buildCatalog({ site, menu, events }) {
  const timeZone = site.timezone;
  const categoryNames = new Map(menu.categories.map((category) => [category.id, category.name]));
  const items = new Map(menu.items.map((item) => [item.id, {
    id: item.id,
    category: item.category,
    categoryName: categoryNames.get(item.category),
    name: item.name,
    description: item.description ?? '',
    priceCents: item.priceCents,
    tags: item.tags ?? [],
    image: item.image ?? null,
  }]));
  const eventList = events.events
    .map((config) => compileEvent(config, items, timeZone))
    .sort((a, b) => a.startsAtMs - b.startsAtMs || a.id.localeCompare(b.id));
  return {
    site,
    timeZone,
    leadMs: site.order.leadTimeMinutes * 60_000,
    categories: menu.categories.map(({ id, name }) => ({ id, name })),
    items,
    eventList,
    events: new Map(eventList.map((event) => [event.id, event])),
  };
}

/** Public listing rule: hidden events and events that have ended are not shown at all. */
export function isListed(event, now) {
  return event.configStatus !== 'hidden' && event.endsAtMs > now;
}

/** Events the kitchen still cares about: everything upcoming plus the last two weeks. */
export function isRecent(event, now) {
  return event.endsAtMs > now - 14 * DAY;
}

/**
 * Computes status, slot availability and item stock for one event.
 * usage = { slotCounts: Map<slot, activeOrders>, itemQty: Map<itemId, activeQty> }
 * overrides = { paused: boolean, soldOut: Set<itemId> }
 */
export function evaluateEvent(catalog, event, { now, usage, overrides }) {
  const cutoff = now + catalog.leadMs;

  const items = new Map();
  for (const item of event.menuItems) {
    const limit = event.limits.get(item.id) ?? null;
    const remaining = limit === null ? null : Math.max(0, limit - (usage.itemQty.get(item.id) ?? 0));
    items.set(item.id, { limit, remaining, soldOut: remaining === 0 || overrides.soldOut.has(item.id) });
  }

  const ordersIn = (slot) => usage.slotCounts.get(slot.time) ?? 0;
  const bookable = event.slots.filter((slot) => slot.atMs >= cutoff);
  let status;
  if (event.configStatus === 'closed' || event.configStatus === 'hidden' || bookable.length === 0) status = 'closed';
  else if (event.configStatus === 'paused' || overrides.paused) status = 'paused';
  else if (now < event.opensAtMs) status = 'upcoming';
  else if (bookable.every((slot) => ordersIn(slot) >= event.ordersPerSlot)
    || [...items.values()].every((item) => item.soldOut)) status = 'soldout';
  else status = 'open';

  const slots = event.slots.map((slot) => {
    const remaining = Math.max(0, event.ordersPerSlot - ordersIn(slot));
    return {
      time: slot.time,
      label: slot.label,
      available: status === 'open' && slot.atMs >= cutoff && remaining > 0,
      remaining,
    };
  });

  return { status, slots, items };
}

export function eventSummary(event, status) {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    start: event.start,
    end: event.end,
    startsAt: toIso(event.startsAtMs),
    endsAt: toIso(event.endsAtMs),
    locationName: event.locationName,
    address: event.address,
    mapUrl: event.mapUrl,
    note: event.note,
    status,
    opensAt: toIso(event.opensAtMs),
  };
}

/** The event's menu grouped by category, in config order, with live stock. */
export function menuView(catalog, event, itemStates) {
  const categories = catalog.categories.map((category) => ({
    id: category.id,
    name: category.name,
    items: event.menuItems
      .filter((item) => item.category === category.id)
      .map((item) => {
        const state = itemStates.get(item.id);
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          priceCents: item.priceCents,
          tags: [...item.tags],
          image: item.image,
          remaining: state.remaining,
          soldOut: state.soldOut,
        };
      }),
  }));
  return { categories: categories.filter((category) => category.items.length > 0) };
}
