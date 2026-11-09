// Catering: the adobe block on the home page with the catering request form.

import { sendCatering } from '../api.js';
import { h, mount } from '../dom.js';
import { addDays, formatLongDate, today } from '../format.js';
import { choiceGroup, clean, emailError, errorSummary, field, phoneError } from '../forms.js';
import { errorState, icon, setBusy, skeleton, spinner } from '../ui.js';

function points(catering) {
  const styles = catering.serviceStyles.map((style, i) => (i === 0 ? style : style.toLowerCase()));
  const styleList = styles.length > 1 ? `${styles.slice(0, -1).join(', ')} or ${styles.at(-1)}` : styles[0];
  return h('ul', { class: 'catering__points' },
    h('li', null, h('strong', null, `${catering.minGuests} to ${catering.maxGuests} guests`), h('span', null, 'Weddings, offices, family tables and celebrations.')),
    styles.length ? h('li', null, h('strong', null, 'Served your way'), h('span', null, `${styleList}.`)) : null,
    h('li', null, h('strong', null, `${catering.leadTimeDays} days' notice`), h('span', null, 'Most events book a few weeks out. Ask about shorter notice.')));
}

function buildForm(site, onDone) {
  const { catering } = site;
  const minDate = today();
  const name = field({ name: 'name', label: 'Your name', attrs: { autocomplete: 'name', autocapitalize: 'words', maxlength: 80, enterkeyhint: 'next' },
    validate: (v) => (clean(v) ? null : 'Enter your name.') });
  const email = field({ name: 'email', label: 'Email', type: 'email', hint: ['We reply by email. For example: name', h('wbr'), '@example.com'],
    attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', maxlength: 254 },
    validate: emailError });
  const phone = field({ name: 'phone', label: 'Phone number', type: 'tel', optional: true, hint: 'For example: 505 555 0142',
    attrs: { autocomplete: 'tel', inputmode: 'tel', maxlength: 20 },
    validate: (v) => phoneError(v, { required: false }) });
  const date = field({ name: 'eventDate', label: 'Date of your event', type: 'date', hint: `We plan menus at least ${catering.leadTimeDays} days ahead.`,
    attrs: { min: minDate, max: addDays(minDate, 730) },
    validate: (v) => {
      if (!v) return 'Choose the date of your event.';
      if (v < minDate) return 'Choose a date from today onward.';
      return null;
    } });
  const guests = field({ name: 'guestCount', label: 'Number of guests', type: 'number', hint: `Between ${catering.minGuests} and ${catering.maxGuests}`,
    attrs: { inputmode: 'numeric', min: catering.minGuests, max: catering.maxGuests, step: 1 },
    validate: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= catering.minGuests && n <= catering.maxGuests && v.trim() !== ''
        ? null : `Enter a guest count from ${catering.minGuests} to ${catering.maxGuests}.`;
    } });
  const location = field({ name: 'location', label: 'Where is it?', hint: 'Town or venue', attrs: { autocomplete: 'address-level2', maxlength: 120 },
    validate: (v) => (clean(v) ? null : 'Enter where the event is.') });
  const style = choiceGroup({ name: 'serviceStyle', legend: 'How should we serve the food?', options: catering.serviceStyles.map((value) => ({ value, label: value })) });
  const budget = field({ name: 'budget', label: 'Budget', optional: true, hint: 'A rough range is fine.', attrs: { maxlength: 60 } });
  const dietary = field({ name: 'dietary', label: 'Allergies or diets', optional: true, multiline: true, max: 300 });
  const message = field({ name: 'message', label: 'Anything else we should know', optional: true, multiline: true, max: 1500 });
  const honeypot = h('div', { class: 'hp', 'aria-hidden': 'true' },
    h('label', { for: 'catering-website' }, 'Website'),
    h('input', { id: 'catering-website', name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' }));
  const shortNotice = h('p', { class: 'form-note', 'aria-live': 'polite' });
  date.input.addEventListener('change', () => {
    shortNotice.textContent = date.input.value && date.input.value >= minDate && date.input.value < addDays(minDate, catering.leadTimeDays)
      ? 'That is short notice. Send it anyway and we will tell you quickly whether we can make it work.'
      : '';
  });
  dietary.input.rows = 2;

  const summary = errorSummary();
  const submit = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' }, 'Send catering request');
  const fields = { name, email, phone, eventDate: date, guestCount: guests, location, budget, dietary, message };
  const form = h('form', { class: 'form', novalidate: true, 'aria-label': 'Catering request' },
    summary.node,
    h('div', { class: 'form__row form__row--2' }, name.node, email.node),
    h('div', { class: 'form__row form__row--2' }, phone.node, location.node),
    h('div', { class: 'form__row form__row--2' }, h('div', null, date.node, shortNotice), guests.node),
    style.node,
    budget.node,
    dietary.node,
    message.node,
    honeypot,
    submit,
    h('p', { class: 'form-note' }, 'Sending this does not book anything or cost anything. We will reply with a menu and a price.'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const problems = [];
    // In the order the fields appear on the page, so the summary reads top to bottom.
    for (const f of [name, email, phone, location, date, guests]) {
      const problem = f.check();
      if (problem) problems.push({ message: problem, target: f.input });
    }
    if (!style.value()) {
      const problem = 'Choose a service style.';
      style.setError(problem);
      problems.push({ message: problem, target: style.target() });
    }
    if (problems.length) {
      summary.show(problems.length === 1 ? 'One thing to fix before sending' : `${problems.length} things to fix before sending`, problems);
      return;
    }
    summary.hide();
    setBusy(submit, true);
    mount(submit, spinner(), 'Sending');
    try {
      await sendCatering({
        name: clean(name.value()),
        email: clean(email.value()),
        phone: clean(phone.value()),
        eventDate: date.value(),
        guestCount: Number(guests.value()),
        location: clean(location.value()),
        serviceStyle: style.value(),
        budget: clean(budget.value()),
        dietary: dietary.value().trim(),
        message: message.value().trim(),
        website: form.elements.website.value,
      });
      onDone({ firstName: clean(name.value()).split(' ')[0], date: date.value() });
    } catch (error) {
      setBusy(submit, false);
      mount(submit, 'Send catering request');
      const target = error.field && fields[error.field];
      if (error.code === 'invalid' && target) {
        target.setError(error.message);
        summary.show('Check these details', [{ message: error.message, target: target.input }]);
      } else if (error.code === 'invalid' && error.field === 'serviceStyle') {
        style.setError(error.message);
        summary.show('Check these details', [{ message: error.message, target: style.target() }]);
      } else if (error.code === 'rate_limited') {
        summary.show('Too many requests from this connection', [{ message: 'Wait a few minutes, then send it again.' }]);
      } else {
        summary.show('Your request was not sent', [{ message: error.message }]);
      }
    }
  });
  return form;
}

function successNode({ firstName, date }, onAgain) {
  const title = h('h3', { tabindex: '-1' }, `Thank you, ${firstName}.`);
  const node = h('div', { class: 'catering__done', role: 'status' },
    h('span', { class: 'done-mark' }, icon('check')),
    title,
    h('p', null, `We got your catering request for ${formatLongDate(date)}. We will reply by email within 48 hours.`),
    h('button', { class: 'btn btn--outline', type: 'button', onclick: onAgain }, 'Send another request'));
  return { node, focus: () => title.focus() };
}

export function cateringSection() {
  const heading = h('h2', { id: 'catering-title', tabindex: '-1' }, 'Catering');
  const blurb = h('div', { class: 'catering__blurb' }, skeleton(2));
  const pointsSlot = h('div');
  const formSlot = h('div', { class: 'catering__form' }, skeleton(8));
  const node = h('section', { class: 'section catering', id: 'catering', 'aria-labelledby': 'catering-title' },
    h('div', { class: 'wrap' },
      h('div', { class: 'catering__panel' },
        h('div', { class: 'catering__intro' }, heading, blurb, pointsSlot),
        formSlot)));

  function showForm(site) {
    mount(formSlot, buildForm(site, (result) => {
      const done = successNode(result, () => {
        showForm(site);
        formSlot.querySelector('input')?.focus();
      });
      mount(formSlot, done.node);
      done.focus();
    }));
  }

  return {
    node,
    fill(site) {
      mount(blurb, h('p', null, site.catering.blurb));
      mount(pointsSlot, points(site.catering));
      showForm(site);
    },
    fail(onRetry) {
      mount(blurb, h('p', null, 'Tell us about your gathering and we will come back with a menu and a price.'));
      mount(formSlot, errorState({ title: 'The catering form did not load', message: 'Check your connection and try again.', onRetry }));
    },
    focusHeading() {
      heading.focus({ preventScroll: true });
    },
  };
}

