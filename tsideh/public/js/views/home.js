// Home: the adobe hero (logo, wordmark, headline, two buttons and the next pop-up), the press
// line, the list of upcoming pop-ups, and catering. /catering is this same page, scrolled to the
// catering block.

import { getEvents, getSite } from '../api.js';
import { h, mount } from '../dom.js';
import { dateParts, eventStatusLabel, formatLongDate, formatMonth, formatTimeRange, formatWeekday } from '../format.js';
import { errorState, skeleton } from '../ui.js';
import { cateringSection } from './catering.js';

const eventPath = (event) => `/e/${encodeURIComponent(event.id)}`;
const orderable = (event) => event.status === 'open';

/** Where "Order food for pickup" goes: straight to the menu when exactly one pop-up is open. */
function orderTarget(events) {
  const open = (events ?? []).filter(orderable);
  return open.length === 1 ? eventPath(open[0]) : '/#popups';
}

/* ---------------------------------------------------------------- hero */

function heroSection() {
  const headline = h('p', { class: 'hero__headline' });
  const next = h('div', { class: 'hero__next' }, skeleton(3));
  const orderButton = h('a', { class: 'btn btn--primary btn--lg', href: '/#popups', 'data-link': '' }, 'Order food for pickup');
  const node = h('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
    h('div', { class: 'hero__inner wrap' },
      h('img', { class: 'hero__logo', src: '/assets/logo-512.webp', width: 512, height: 512, alt: 'Tsideh', fetchpriority: 'high' }),
      h('div', { class: 'hero__copy' },
        h('h1', { class: 'hero__word', id: 'hero-title' }, 'Tsideh'),
        headline,
        // The two buttons come before the next pop-up's details, so they are on the first screen.
        h('div', { class: 'hero__actions' },
          orderButton,
          h('a', { class: 'btn btn--outline btn--lg', href: '/catering', 'data-link': '' }, 'Ask about catering')),
        next)));

  function fill(site, events) {
    headline.textContent = site.heroHeadline || site.tagline;
    const featured = events.find(orderable) ?? events[0];
    orderButton.setAttribute('href', orderTarget(events));
    if (!featured) {
      next.remove();
      return;
    }
    mount(next,
      h('p', { class: 'hero__next-label' }, 'Next pop-up'),
      h('p', { class: 'hero__next-date' }, formatLongDate(featured.date)),
      h('p', { class: 'num' }, formatTimeRange(featured.start, featured.end)),
      h('p', null, featured.locationName),
      orderable(featured) ? null : h('p', { class: ['status', `status--${featured.status}`] }, eventStatusLabel(featured)));
  }

  function fail() {
    headline.textContent = 'A pop-up kitchen of the Northern Rio Grande.';
    next.remove();
  }

  return { node, fill, fail };
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
      h('span', { class: 'press__names' }, joinNames(entries)))
    : null;
  return h('section', { class: 'press', 'aria-label': 'Press and recognition' },
    h('div', { class: 'wrap' },
      h('div', { class: 'press__rows' }, row('As featured in', featured), row('Recognized by', recognized)),
      quotes.map((entry) => h('blockquote', { class: 'press__quote' },
        h('p', null, `“${entry.quote}”`),
        h('cite', null, entry.name)))));
}

/* ---------------------------------------------------------------- pop-ups */

function popupCard(event) {
  const parts = dateParts(event.date);
  const open = orderable(event);
  const longDate = formatLongDate(event.date);
  return h('li', { class: 'popup' },
    h('div', { class: 'popup__date', 'aria-hidden': 'true' },
      h('span', { class: 'popup__day' }, parts.day),
      h('span', { class: 'popup__month' }, formatMonth(event.date)),
      h('span', { class: 'popup__weekday' }, formatWeekday(event.date))),
    h('div', { class: 'popup__body' },
      h('h3', { class: 'popup__title' }, event.title),
      h('p', { class: 'visually-hidden' }, longDate),
      h('p', { class: 'popup__time num' }, formatTimeRange(event.start, event.end)),
      h('p', { class: 'popup__place' }, event.locationName),
      event.address ? h('p', { class: 'popup__address' }, event.address) : null,
      h('p', { class: ['status', `status--${event.status}`] }, eventStatusLabel(event)),
      h('a', { class: ['btn', 'btn--block', open ? 'btn--primary' : 'btn--outline'], href: eventPath(event), 'data-link': '' },
        open ? 'Order food' : 'See the menu',
        h('span', { class: 'visually-hidden' }, ` from the ${event.title}, ${longDate}`))));
}

function popupsSection() {
  const list = h('div', { class: 'popups__list' }, skeleton(4, { className: 'skeleton--block' }));
  const heading = h('h2', { id: 'popups-title', tabindex: '-1' }, 'Upcoming pop-ups');
  const node = h('section', { class: 'section popups', id: 'popups', 'aria-labelledby': 'popups-title' },
    h('div', { class: 'wrap' },
      h('header', { class: 'section-head' },
        heading,
        h('p', null, 'Order ahead online, choose a pickup time, then come and get your food.')),
      list));

  function fill(events, { onRetry } = {}) {
    if (!events) {
      mount(list, errorState({ title: 'The pop-ups did not load', message: 'Check your connection and try again.', onRetry }));
      return;
    }
    if (!events.length) {
      mount(list, h('div', { class: 'empty' },
        h('h3', null, 'No pop-ups on the calendar right now'),
        h('p', null, 'New dates are posted here first. Planning a gathering? ',
          h('a', { href: '/catering', 'data-link': '' }, 'Ask about catering'), '.')));
      return;
    }
    mount(list, h('ul', { class: 'popup-list' }, events.map(popupCard)));
  }

  return { node, fill, focusHeading: () => heading.focus({ preventScroll: true }) };
}

/* ---------------------------------------------------------------- page */

export function render(ctx) {
  const hero = heroSection();
  const popups = popupsSection();
  const catering = cateringSection();
  const pressSlot = h('div');
  const node = h('div', { class: 'home' }, hero.node, pressSlot, popups.node, catering.node);
  const controller = new AbortController();

  function scrollForRoute(next, { smooth }) {
    if (next.route === 'catering') {
      next.scrollToTarget('#catering', { smooth });
      catering.focusHeading();
    } else {
      next.scrollToTarget(next.hash, { smooth });
      // Keyboard and screen reader users continue from the list they were taken to.
      if (next.hash === '#popups') popups.focusHeading();
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
  }

  const ready = load().catch(() => {});

  return {
    node,
    title: null,
    ready,
    handlesScroll: true,
    mounted() {
      if (ctx.pop) return;
      // Wait for the sections above to settle so the scroll lands where it should.
      if (ctx.route === 'catering' || ctx.hash) ready.then(() => scrollForRoute(ctx, { smooth: false }));
      else scrollTo({ top: 0, behavior: 'instant' });
    },
    update(next, { pop }) {
      scrollForRoute(next, { smooth: !pop });
    },
    destroy() {
      controller.abort();
    },
  };
}
