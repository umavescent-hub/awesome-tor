// The frame around every page: the header's current-section marker and the footer.

import { getSite } from './api.js';
import { h, mount } from './dom.js';
import { chefLine } from './format.js';
import { icon } from './ui.js';

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

export function createShell() {
  const root = document.documentElement;
  const navLinks = [...document.querySelectorAll('#site-header [data-nav]')];
  const footer = document.getElementById('site-footer');

  const footerContacts = h('div', { class: 'footer-contact' });
  const footerBrand = h('a', { class: 'footer-brand', href: '/', 'data-link': '' },
    h('img', { src: '/assets/logo-192.webp', width: 72, height: 72, alt: '', loading: 'lazy' }),
    h('span', null, 'Tsideh'));
  mount(footer, h('div', { class: 'site-footer__panel' },
    footerBrand,
    h('nav', { class: 'footer-nav', 'aria-label': 'Footer' },
      h('a', { href: '/#popups', 'data-link': '' }, 'Order food'),
      h('a', { href: '/catering', 'data-link': '' }, 'Catering')),
    footerContacts,
    h('p', { class: 'footer-trust' }, icon('lock'), 'Payments secured by Stripe. We never see or store your card number.'),
    h('p', { class: 'footer-legal' }, `© ${new Date().getFullYear()} Tsideh`)));

  getSite().then((site) => {
    const chef = chefLine(site.chef);
    if (chef) footerBrand.after(h('p', { class: 'footer-chef' }, chef));
    mount(footerContacts, contactLinks(site.contact).map(linkNode));
  }, () => {});

  return {
    /** Called by the router on every page change. */
    setRoute(route) {
      root.classList.toggle('is-home', route.name === 'home' || route.name === 'catering');
      const section = route.name === 'catering' ? 'catering' : null;
      for (const link of navLinks) {
        if (link.dataset.nav === section) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    },
  };
}
