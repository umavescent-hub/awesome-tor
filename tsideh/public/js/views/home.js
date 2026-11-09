// Home: the adobe hero with the living mark, press, the pop-up index beside the dot map, a taste
// of the menu, and catering. /catering is this same page, scrolled to the catering block.

import { getEvent, getEvents, getSite } from '../api.js';
import { drawTile, mountHero, seedFrom } from '../art.js';
import { h, mount, prefersReducedMotion } from '../dom.js';
import { drawDotField, mountPopupMap } from '../dots.js';
import { dateParts, formatLongDate, formatTimeRange } from '../format.js';
import { categoryNode, dishNode } from '../menu.js';
import { errorState, lazyArt, skeleton, token } from '../ui.js';
import { cateringSection } from './catering.js';

const PREVIEW_PER_CATEGORY = 2;

const STATUS = {
  open: 'Open for orders',
  soldout: 'Sold out',
  paused: 'Orders paused',
  closed: 'Orders closed',
};

export function statusLabel(event) {
  if (event.status === 'upcoming') return `Orders open ${formatLongDate(isoDay(event.opensAt))}`;
  return STATUS[event.status] ?? 'Orders closed';
}

/** Kitchen-zone calendar day of an ISO instant. */
function isoDay(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(iso));
}

const eventPath = (event) => `/e/${encodeURIComponent(event.id)}`;
const orderable = (event) => event.status === 'open';

function grain(seed, motif) {
  return lazyArt(h('canvas', { class: 'grain', 'aria-hidden': 'true' }),
    (canvas) => drawDotField(canvas, { seed, ink: token('--black'), motif, strength: 0.075 }));
}

/* ---------------------------------------------------------------- hero */

function heroSection() {
  const art = h('canvas', { class: 'hero__art', 'aria-hidden': 'true' });
  const headline = h('p', { class: 'hero__headline' });
  const next = h('div', { class: 'hero__next' }, skeleton(3));
  const actions = h('div', { class: 'hero__actions' });
  const node = h('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
    art,
    h('div', { class: 'hero__inner wrap' },
      h('div', { class: 'hero__copy' },
        h('h1', { class: 'hero__word', id: 'hero-title' }, 'Tsideh'),
        headline,
        next),
      actions));

  function fill(site, events) {
    headline.textContent = site.heroHeadline || site.tagline;
    const featured = events.find(orderable) ?? events[0];
    if (featured) {
      mount(next,
        h('span', { class: 'hero__next-label' }, 'Next pop-up'),
        h('span', { class: 'hero__next-date' }, formatLongDate(featured.date)),
        h('span', { class: 'hero__next-meta' }, `${formatTimeRange(featured.start, featured.end)}, ${featured.locationName}`));
    } else {
      next.remove();
    }
    mount(actions,
      featured && orderable(featured)
        ? h('a', { class: 'btn btn--primary', href: eventPath(featured), 'data-link': '' }, 'Order for pickup')
        : h('a', { class: 'btn btn--primary', href: '/#popups', 'data-link': '' }, 'See upcoming pop-ups'),
      h('a', { class: 'link', href: '/catering', 'data-link': '' }, 'Book catering'));
  }

  function fail() {
    headline.textContent = 'A pop-up kitchen of the Northern Rio Grande.';
    next.remove();
    mount(actions, h('a', { class: 'link', href: '/catering', 'data-link': '' }, 'Book catering'));
  }

  let hero = null;
  return {
    node,
    fill,
    fail,
    start() {
      hero = mountHero(art, { seed: seedFrom('tsideh') });
    },
    stop() {
      hero?.destroy();
    },
  };
}

/* ---------------------------------------------------------------- press */

function joinNames(entries) {
  return entries.map((entry) => h('span', { class: 'press__name' },
    entry.url && /^https:\/\//.test(entry.url)
      ? h('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer' }, entry.name)
      : entry.name));
}

function pressSection(press) {
  const list = Array.isArray(press) ? press.filter((entry) => entry && entry.name) : [];
  if (!list.length) return null;
  const featured = list.filter((entry) => entry.kind !== 'recognition');
  const recognized = list.filter((entry) => entry.kind === 'recognition');
  const quotes = list.filter((entry) => entry.quote);
  const row = (label, entries) => entries.length
    ? h('div', { class: 'press__row' },
      h('span', { class: 'press__label' }, label),
      h('span', { class: ['press__names', entries.length === 1 ? 'press__names--single' : ''] }, joinNames(entries)))
    : null;
  return h('section', { class: 'press', 'aria-label': 'Press and recognition' },
    h('div', { class: 'wrap' },
      h('div', { class: 'press__rows' }, row('As featured in', featured), row('Recognized by', recognized)),
      quotes.map((entry) => h('blockquote', { class: 'press__quote' },
        h('p', null, `“${entry.quote}”`),
        h('cite', null, entry.name)))));
}

/* ---------------------------------------------------------------- pop-ups */

function popupRow(event, { featured }) {
  const parts = dateParts(event.date);
  const open = orderable(event);
  const cta = h('a', { class: ['popup__cta', 'btn', open ? 'btn--primary' : 'btn--outline'], href: eventPath(event), 'data-link': '' },
    open ? 'Order for pickup' : 'View the menu',
    h('span', { class: 'visually-hidden' }, `: ${event.title}, ${formatLongDate(event.date)}`));
  return h('li', { class: ['popup', featured ? 'popup--featured' : ''], dataset: { event: event.id } },
    featured
      ? lazyArt(h('canvas', { class: 'popup__art', 'aria-hidden': 'true' }),
        (canvas) => drawTile(canvas, { seed: seedFrom(event.id), variant: 'banner' }))
      : null,
    h('div', { class: 'popup__row' },
      h('div', { class: 'popup__date', 'aria-hidden': 'true' },
        h('span', { class: 'popup__day' }, parts.day),
        h('span', { class: 'popup__month' }, parts.month),
        h('span', { class: 'popup__weekday' }, parts.weekday)),
      h('div', null,
        h('h3', { class: 'popup__title' }, event.title),
        h('p', { class: 'visually-hidden' }, formatLongDate(event.date)),
        h('div', { class: 'popup__facts' },
          h('span', { class: 'num' }, formatTimeRange(event.start, event.end)),
          h('span', null, h('strong', null, event.locationName)),
          event.address ? h('span', { class: 'muted' }, event.address) : null)),
      h('div', { class: 'popup__foot' },
        h('span', { class: ['pill', `pill--${event.status}`] }, statusLabel(event)),
        cta)));
}

function popupsSection() {
  const list = h('div', { class: 'popups__list' }, skeleton(4, { className: 'skeleton--block' }));
  const mapCol = h('div', { class: 'popups__map-col' });
  const node = h('section', { class: 'section popups', id: 'popups', 'aria-labelledby': 'popups-title' },
    grain('tsideh-popups', 'spiral'),
    h('div', { class: 'wrap' },
      h('header', { class: 'section-head' },
        h('h2', { id: 'popups-title' }, 'Upcoming pop-ups'),
        h('p', null, 'Order ahead, choose a pickup time and skip the line.')),
      h('div', { class: 'popups__grid' }, list, mapCol)));

  function fill(events, { onRetry } = {}) {
    if (!events) {
      mount(list, errorState({ title: 'Pop-ups did not load', message: 'Check your connection and try again.', onRetry }));
      mapCol.remove();
      return;
    }
    if (!events.length) {
      mount(list, h('div', { class: 'empty' },
        h('h3', null, 'No pop-ups on the calendar right now'),
        h('p', null, 'New dates are posted here first. Planning a gathering? ',
          h('a', { href: '/catering', 'data-link': '' }, 'Book catering'), '.')));
      mapCol.remove();
      return;
    }
    const rows = events.map((event, i) => popupRow(event, { featured: i === 0 }));
    const ul = h('ul', { class: 'popup-list' }, rows);
    mount(list, ul);

    const mapBox = h('div', { class: 'map' });
    const map = mountPopupMap(mapBox, {
      events,
      onSelect(ids, how) {
        for (const row of rows) row.classList.toggle('is-active', ids !== null && ids.includes(row.dataset.event));
        if (how === 'click' && ids) {
          const row = rows.find((candidate) => ids.includes(candidate.dataset.event));
          row?.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'center' });
        }
      },
    });
    if (!map) {
      mapCol.remove();
      return;
    }
    mount(mapCol, h('h3', null, 'Where we pop up'), mapBox);
    for (const row of rows) {
      const on = () => map.highlight(row.dataset.event);
      const off = () => map.highlight(null);
      row.addEventListener('pointerenter', on);
      row.addEventListener('pointerleave', off);
      row.addEventListener('focusin', on);
      row.addEventListener('focusout', off);
    }
  }

  return { node, fill };
}

/* ---------------------------------------------------------------- menu preview */

function menuSection() {
  const body = h('div', null, skeleton(6));
  const lead = h('p', null, 'Menus change with every pop-up.');
  const node = h('section', { class: 'section menu-preview', 'aria-labelledby': 'menu-title' },
    grain('tsideh-menu', 'terrace'),
    h('div', { class: 'wrap' },
      h('header', { class: 'section-head' }, h('h2', { id: 'menu-title' }, 'On the menu'), lead),
      body));

  function fill(detail) {
    const { event, menu } = detail;
    lead.textContent = `For the ${event.title}, ${formatLongDate(event.date)}. Menus change with every pop-up.`;
    const categories = menu.categories.map((category) => ({ ...category, items: category.items.slice(0, PREVIEW_PER_CATEGORY) }));
    const total = menu.categories.reduce((sum, category) => sum + category.items.length, 0);
    mount(body,
      h('div', { class: 'menu-preview__grid' },
        categories.map((category) => categoryNode(category, { level: 3, id: `preview-${category.id}`, dish: (item) => dishNode(item, { level: 4 }) }))),
      h('div', { class: 'menu-preview__foot' },
        h('p', null, `${total} dishes and drinks on this menu.`),
        h('a', { class: 'btn btn--primary', href: eventPath(event), 'data-link': '' },
          orderable(event) ? 'See the full menu and order' : 'See the full menu')));
  }

  return { node, fill };
}

/* ---------------------------------------------------------------- page */

export function render(ctx) {
  const hero = heroSection();
  const popups = popupsSection();
  const menu = menuSection();
  const catering = cateringSection();
  const pressSlot = h('div');
  const node = h('div', { class: 'home' }, hero.node, pressSlot, popups.node, menu.node, catering.node);
  const controller = new AbortController();

  function scrollForRoute(next, { smooth }) {
    if (next.route === 'catering') {
      next.scrollToTarget('#catering', { smooth });
      catering.focusHeading();
    } else {
      next.scrollToTarget(next.hash, { smooth });
    }
  }

  async function loadEvents() {
    try {
      const { events } = await getEvents({ signal: controller.signal });
      return events;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      return null;
    }
  }

  async function load() {
    const [site, events] = await Promise.all([getSite().catch(() => null), loadEvents()]);
    if (controller.signal.aborted) return;
    if (site && events) hero.fill(site, events);
    else hero.fail();
    if (site) {
      const press = pressSection(site.press);
      if (press) pressSlot.replaceWith(press);
      catering.fill(site);
    } else {
      catering.fail(() => getSite().then(catering.fill, () => {}));
    }
    popups.fill(events, { onRetry: () => loadEvents().then((list) => popups.fill(list)) });

    const featured = events?.find(orderable) ?? events?.[0];
    if (!featured) {
      menu.node.remove();
      return;
    }
    try {
      menu.fill(await getEvent(featured.id, { signal: controller.signal }));
    } catch {
      if (!controller.signal.aborted) menu.node.remove();
    }
  }

  const ready = load().catch(() => {});

  return {
    node,
    title: null,
    ready,
    handlesScroll: true,
    mounted() {
      hero.start();
      // Wait for the sections above to settle so the scroll lands where it should.
      if (ctx.route === 'catering' || ctx.hash) ready.then(() => scrollForRoute(ctx, { smooth: false }));
      else scrollTo({ top: 0, behavior: 'instant' });
    },
    update(next, { pop }) {
      scrollForRoute(next, { smooth: !pop });
    },
    destroy() {
      controller.abort();
      hero.stop();
    },
  };
}
