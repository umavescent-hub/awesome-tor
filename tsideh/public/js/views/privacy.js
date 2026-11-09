// Privacy notice: what we collect, why, how long we keep it, and who to ask.

import { getSite } from '../api.js';
import { h, mount } from '../dom.js';
import { contactLinks } from '../shell.js';

export function render() {
  const retention = h('p', null, 'We remove names, phone numbers, email addresses and notes from pickup orders after 180 days, and delete catering inquiries after a year. Order totals are kept for our accounts.');
  const contact = h('p', null, 'Questions, or want us to delete your information sooner? Ask us at any pop-up.');

  getSite().then((site) => {
    const orderDays = site.privacy?.retentionDays;
    const cateringDays = site.privacy?.cateringRetentionDays;
    if (Number.isInteger(orderDays) && Number.isInteger(cateringDays)) {
      retention.textContent = `We remove names, phone numbers, email addresses and notes from pickup orders after ${orderDays} days, and delete catering inquiries after ${cateringDays} days. Order totals are kept for our accounts.`;
    }
    const email = contactLinks(site.contact).find((link) => link.href.startsWith('mailto:'));
    if (email) mount(contact, 'Questions, or want us to delete your information sooner? Email ', h('a', { href: email.href }, email.label), '.');
  }, () => {});

  return {
    title: 'Privacy',
    node: h('article', { class: 'wrap wrap--narrow prose' },
      h('h1', null, 'Privacy'),
      h('p', { class: 'lede' }, 'We collect only what we need to hand you the right order and to plan your event.'),
      h('h2', null, 'What we collect'),
      h('ul', null,
        h('li', null, 'For pickup orders: your name, mobile number, email, any notes for the kitchen, what you ordered and your pickup time.'),
        h('li', null, 'For catering inquiries: your name, email, phone if you give it, and the event details you share.')),
      h('h2', null, 'Payments'),
      h('p', null, 'Payments are made on Stripe’s secure checkout page. Card numbers go straight to Stripe: we never see or store them. Stripe’s own privacy policy covers the payment itself.'),
      h('h2', null, 'How we use it'),
      h('p', null, 'To prepare and hand over your order, to contact you if something about it changes, and to answer catering inquiries. We do not sell your information or use it for advertising.'),
      h('h2', null, 'How long we keep it'),
      retention,
      h('h2', null, 'On this device'),
      h('p', null, 'Your cart is saved in this browser so it survives a reload. Checkout details you type are kept only until you close the tab. We use no tracking or advertising cookies.'),
      h('h2', null, 'Contact'),
      contact),
  };
}
