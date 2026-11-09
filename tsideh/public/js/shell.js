// The frame around every page: the header (scroll state, current section, cart button), the phone
// menu overlay, the phone cart button and the footer.

import { getSite } from './api.js';
import * as cart from './cart.js';
import { h, mount } from './dom.js';
import { drawDotField } from './dots.js';
import { createDialog } from './sheet.js';
import { icon, lazyArt, token } from './ui.js';

/** Contact links are owner config, still checked before they become hrefs. */
export function contactLinks(contact) {
  const links = [];
  const email = contact?.email?.trim();
  if (email && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) links.push({ label: email, href: `mailto:${email}` });
  const phone = contact?.phone?.trim();
  if (phone && /\d{7,}/.test(phone.replace(/\D/g, ''))) links.push({ label: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` });
  const instagram = contact?.instagram?.trim();
  if (instagram) {
    const handle = instagram.replace(/^https:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/$/, '');
    if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) links.push({ label: 'Instagram', href: `https://www.instagram.com/${handle}/`, external: true });
  }
  return links;
}

const linkNode = ({ label, href, external }) =>
  h('a', { href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, label);

export function createShell({ navigate }) {
  const root = document.documentElement;
  const header = document.getElementById('site-header');
  const cartButton = document.getElementById('cart-button');
  const cartCount = document.getElementById('cart-count');
  const menuToggle = document.getElementById('menu-toggle');
  const footer = document.getElementById('site-footer');
  const navLinks = [...header.querySelectorAll('[data-nav]')];

  let route = { name: 'home', params: {} };
  let cartAction = null;

  /* Header: frosted once the page moves; on the home page, once the hero is behind it. */
  let ticking = false;
  function syncHeader() {
    ticking = false;
    const hero = document.querySelector('.hero');
    const limit = hero ? hero.offsetHeight - header.offsetHeight : 8;
    header.classList.toggle('is-scrolled', scrollY > limit);
  }
  addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(syncHeader);
    }
  }, { passive: true });

  /* Cart: the header button on wider screens, a floating button on phones. */
  const fabCount = h('span', { class: 'count-badge' });
  const fab = h('a', { class: 'fab', href: '/', 'data-link': '', hidden: true }, h('span', null, 'Your order'), fabCount);
  document.body.append(fab);

  function cartTarget() {
    if (route.name === 'event') return route.params.id;
    return cart.latest()?.eventId ?? null;
  }

  function syncCart() {
    const eventId = cartTarget();
    const n = eventId ? cart.count(eventId) : 0;
    const onEvent = route.name === 'event';
    const label = n === 1 ? 'Your order, 1 item' : `Your order, ${n} items`;
    cartCount.textContent = String(n);
    cartButton.hidden = !(n > 0 || (onEvent && cartAction));
    cartButton.setAttribute('aria-label', label);
    fabCount.textContent = String(n);
    fab.hidden = onEvent || n === 0;
    fab.setAttribute('aria-label', label);
    if (eventId) fab.href = `/e/${encodeURIComponent(eventId)}#order`;
    root.classList.toggle('has-fab', !fab.hidden);
    menu.syncCount(n, eventId);
  }

  cartButton.addEventListener('click', () => {
    const eventId = cartTarget();
    if (route.name === 'event' && cartAction) cartAction();
    else if (eventId) navigate(`/e/${encodeURIComponent(eventId)}#order`);
  });

  /* Phone menu overlay */
  const menu = (() => {
    const close = h('button', { class: 'menu-toggle', type: 'button', 'aria-expanded': 'true', 'data-close': '' },
      h('span', null, 'Close'), h('span', { class: 'menu-toggle__icon', 'aria-hidden': 'true' }));
    const head = h('div', { class: 'overlay__head' },
      h('a', { class: 'brand', href: '/', 'data-link': '' },
        h('img', { class: 'brand__mark', src: '/assets/logo-192.webp', width: 40, height: 40, alt: '' }),
        h('span', { class: 'brand__word' }, 'Tsideh')),
      close);
    const orderBadge = h('span', { class: 'count-badge' });
    const orderLink = h('a', { href: '/', 'data-link': '' }, 'Your order', orderBadge);
    const orderItem = h('li', { hidden: true }, orderLink);
    const contacts = h('div', { class: 'overlay__foot' });
    const dialog = createDialog({ variant: 'overlay', header: head, onClose: () => menuToggle.setAttribute('aria-expanded', 'false') });
    dialog.el.setAttribute('aria-label', 'Menu');
    mount(dialog.body,
      h('nav', { 'aria-label': 'Menu' },
        h('ul', { class: 'overlay-nav' },
          h('li', null, h('a', { href: '/#popups', 'data-link': '' }, 'Pop-ups')),
          h('li', null, h('a', { href: '/catering', 'data-link': '' }, 'Catering')),
          orderItem,
          h('li', null, h('a', { href: '/privacy', 'data-link': '' }, 'Privacy')))),
      contacts);
    // Leaving through a link closes at once, so the next page owns the scroll position.
    dialog.el.addEventListener('click', (event) => {
      if (event.target.closest('a[data-link]')) dialog.close({ immediate: true });
    });
    return {
      open() {
        menuToggle.setAttribute('aria-expanded', 'true');
        dialog.open();
      },
      close: () => dialog.close({ immediate: true }),
      syncCount(n, eventId) {
        orderItem.hidden = n === 0;
        orderBadge.textContent = String(n);
        if (eventId) orderLink.href = `/e/${encodeURIComponent(eventId)}#order`;
      },
      setContacts(links) {
        mount(contacts, links.map(linkNode));
      },
    };
  })();
  menuToggle.addEventListener('click', () => menu.open());
  matchMedia('(min-width: 820px)').addEventListener('change', (event) => {
    if (event.matches) menu.close();
  });

  /* Footer */
  const footerContacts = h('div', { class: 'footer-contact' });
  const grain = lazyArt(h('canvas', { class: 'grain', 'aria-hidden': 'true' }),
    (canvas) => drawDotField(canvas, { seed: 'tsideh-footer', ink: token('--black'), motif: 'terrace', strength: 0.1 }));
  mount(footer, h('div', { class: 'site-footer__panel' },
    grain,
    h('a', { class: 'footer-brand', href: '/', 'data-link': '', 'aria-label': 'Tsideh home' },
      h('img', { src: '/assets/logo-192.webp', width: 72, height: 72, alt: '', loading: 'lazy' }),
      h('span', { 'aria-hidden': 'true' }, 'Tsideh')),
    h('nav', { class: 'footer-nav', 'aria-label': 'Footer' },
      h('a', { href: '/#popups', 'data-link': '' }, 'Pop-ups'),
      h('a', { href: '/catering', 'data-link': '' }, 'Catering'),
      h('a', { href: '/privacy', 'data-link': '' }, 'Privacy')),
    footerContacts,
    h('p', { class: 'footer-trust' }, icon('lock'), 'Payments secured by Stripe. We never see or store your card number.'),
    h('p', { class: 'footer-legal' }, `© ${new Date().getFullYear()} Tsideh`)));

  getSite().then((site) => {
    const links = contactLinks(site.contact);
    mount(footerContacts, links.map(linkNode));
    menu.setContacts(links);
  }, () => {});

  cart.subscribe(syncCart);

  return {
    /** Called by the router on every page change. */
    setRoute(next) {
      route = next;
      cartAction = null;
      root.classList.toggle('is-home', next.name === 'home' || next.name === 'catering');
      const section = next.name === 'catering' ? 'catering' : null;
      for (const link of navLinks) {
        if (link.dataset.nav === section) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
      syncCart();
      syncHeader();
    },
    /** The event page registers how "Your order" opens its panel or sheet. */
    setCartAction(action) {
      cartAction = action;
      syncCart();
    },
    syncHeader,
  };
}
