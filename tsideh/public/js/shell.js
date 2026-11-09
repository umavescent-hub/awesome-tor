// The frame around every page: the header (scroll state, current section, cart button) and the
// footer.

import { getSite } from './api.js';
import * as cart from './cart.js';
import { h, mount } from './dom.js';
import { drawDotField } from './dots.js';
import { icon, lazyArt, token } from './ui.js';

/** Contact links are owner config, still checked before they become hrefs. */
function contactLinks(contact) {
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

  /* Cart: the header button on wider screens; on phones the pop-up page's order bar does the job. */
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
    cartButton.classList.toggle('is-empty', n === 0);
    cartButton.hidden = !(n > 0 || (onEvent && cartAction));
    cartButton.setAttribute('aria-label', label);
  }

  cartButton.addEventListener('click', () => {
    const eventId = cartTarget();
    if (route.name === 'event' && cartAction) cartAction();
    else if (eventId) navigate(`/e/${encodeURIComponent(eventId)}#order`);
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
      h('a', { href: '/catering', 'data-link': '' }, 'Catering')),
    footerContacts,
    h('p', { class: 'footer-trust' }, icon('lock'), 'Payments secured by Stripe. We never see or store your card number.'),
    h('p', { class: 'footer-legal' }, `© ${new Date().getFullYear()} Tsideh`)));

  getSite().then((site) => mount(footerContacts, contactLinks(site.contact).map(linkNode)), () => {});

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
  };
}
