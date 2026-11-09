// Boot and routing. One HTML shell; each route renders a view into <main>. Same-origin links
// marked data-link move through the History API.

import { h, mount, prefersReducedMotion } from './dom.js';
import { createShell } from './shell.js';
import { errorState, releaseArt } from './ui.js';
import * as demoPayView from './views/demo-pay.js';
import * as eventView from './views/event.js';
import * as homeView from './views/home.js';
import * as orderView from './views/order.js';

const ROUTES = [
  { name: 'home', pattern: /^\/$/, view: homeView },
  { name: 'catering', pattern: /^\/catering\/?$/, view: homeView },
  { name: 'event', pattern: /^\/e\/([^/]+)\/?$/, keys: ['id'], view: eventView },
  { name: 'order', pattern: /^\/order\/([^/]+)\/?$/, keys: ['code'], view: orderView },
  { name: 'demo-pay', pattern: /^\/pay\/demo\/([^/]+)\/?$/, keys: ['code'], view: demoPayView },
];

const notFoundView = {
  render: () => ({
    title: 'Not found',
    node: h('div', { class: 'wrap' }, errorState({
      title: 'This page is not on the menu',
      message: 'The link may be old or mistyped.',
      action: h('a', { class: 'btn btn--primary', href: '/', 'data-link': '' }, 'Go to Tsideh'),
    })),
  }),
};

const main = document.getElementById('main');
const shell = createShell({ navigate });
let current = null;

function match(pathname) {
  for (const route of ROUTES) {
    const found = route.pattern.exec(pathname);
    if (!found) continue;
    const params = {};
    (route.keys ?? []).forEach((key, i) => {
      try {
        params[key] = decodeURIComponent(found[i + 1]);
      } catch {
        params[key] = found[i + 1];
      }
    });
    return { ...route, params };
  }
  return { name: 'not-found', view: notFoundView, params: {} };
}

function setTitle(title) {
  document.title = title ? `${title} | Tsideh` : 'Tsideh | Pop-up kitchen in Northern New Mexico';
}

/** Scroll to the element a hash names, or to the top. */
function scrollToTarget(hash, { smooth = false } = {}) {
  const target = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
  const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'instant';
  if (target) target.scrollIntoView({ behavior, block: 'start' });
  else scrollTo({ top: 0, behavior });
}

function context(route, url, { pop = false } = {}) {
  return {
    pop,
    params: route.params,
    query: url.searchParams,
    hash: url.hash,
    route: route.name,
    navigate,
    shell,
    setTitle,
    scrollToTarget,
    replaceUrl,
  };
}

/** Rewrite the address bar without rendering (e.g. to drop one-time query parameters). */
function replaceUrl(to) {
  const next = new URL(to, location.href);
  history.replaceState(history.state, '', next);
  if (current) current.search = next.search;
}

function render({ pop = false, initial = false } = {}) {
  const url = new URL(location.href);
  const route = match(url.pathname);
  const ctx = context(route, url, { pop });

  // Same view, same parameters (the home page and /catering are one page): update in place.
  if (current && current.route.view === route.view && current.instance.update
    && JSON.stringify(current.route.params) === JSON.stringify(route.params)) {
    current.route = route;
    current.search = url.search;
    shell.setRoute(route);
    current.instance.update(ctx, { pop });
    return;
  }

  if (current) {
    current.instance.destroy?.();
    releaseArt(main);
  }
  let instance;
  try {
    instance = route.view.render(ctx);
  } catch (error) {
    console.error(error);
    instance = { title: 'Something went wrong', node: h('div', { class: 'wrap' }, errorState({ message: 'Reload the page to try again.', onRetry: () => location.reload() })) };
  }
  current = { route, instance, search: url.search };
  mount(main, instance.node);
  setTitle(instance.title);
  shell.setRoute(route);
  instance.mounted?.();
  if (pop && history.state?.scrollY !== undefined) {
    const y = history.state.scrollY;
    Promise.resolve(instance.ready).then(() => scrollTo({ top: y, behavior: 'instant' }));
  } else if (!instance.handlesScroll) {
    scrollToTarget(url.hash);
  }
  if (!initial) main.focus({ preventScroll: true });
}

function rememberScroll() {
  history.replaceState({ ...history.state, scrollY }, '');
}

/** Go to an in-site URL. replace: swap the current history entry instead of adding one. */
function navigate(to, { replace = false } = {}) {
  const next = new URL(to, location.href);
  const sameDocument = next.pathname === location.pathname && next.search === location.search;
  rememberScroll();
  if (replace) history.replaceState({}, '', next);
  else if (next.href !== location.href) history.pushState({}, '', next);
  if (sameDocument && current?.route.name !== 'not-found' && !replace) {
    if (current.instance.update) current.instance.update(context(match(next.pathname), next), { pop: false });
    else scrollToTarget(next.hash, { smooth: true });
    return;
  }
  render();
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[data-link]');
  if (!link || link.target || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

addEventListener('popstate', () => {
  const url = new URL(location.href);
  const route = match(url.pathname);
  // A hash-only step on the same page: just scroll.
  if (current && current.route.name === route.name && current.search === url.search
    && JSON.stringify(current.route.params) === JSON.stringify(route.params)) {
    scrollToTarget(url.hash, { smooth: true });
    return;
  }
  render({ pop: true });
});

history.scrollRestoration = 'manual';
render({ initial: true });
