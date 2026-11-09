// Form building blocks: labelled fields with inline errors, chip groups on real radio inputs, an
// error summary, and the same validation rules the server applies.

import { h, mount, nextId } from './dom.js';
import { icon } from './ui.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\-. ]{7,20}$/;

export const clean = (value) => value.replace(/\s+/g, ' ').trim();

export function phoneError(value, { required }) {
  const cleaned = clean(value);
  if (!cleaned) return required ? 'Enter a mobile number so we can reach you about this order.' : null;
  if (!PHONE.test(cleaned) || cleaned.replace(/\D/g, '').length < 7) return 'Enter a phone number using digits, like 505 555 0142.';
  return null;
}

export function emailError(value) {
  const cleaned = clean(value);
  if (!cleaned) return 'Enter your email address.';
  if (cleaned.length > 254 || !EMAIL.test(cleaned)) return 'Enter an email address like name@example.com.';
  return null;
}

function errorNode(id) {
  return h('p', { class: 'field__error', id, 'aria-live': 'polite' });
}

function showError(node, message) {
  if (message) mount(node, icon('alert'), h('span', null, message));
  else node.replaceChildren();
}

/**
 * A labelled input. options: name, label, type, optional, hint, multiline, max (shows a counter for
 * multiline), attrs (extra input attributes), validate(value) -> message | null.
 * Returns { node, input, id, value(), check(), setError(message) }.
 */
export function field({ name, label, type = 'text', optional = false, hint = '', multiline = false, max, attrs = {}, validate }) {
  const id = nextId(name);
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const error = errorNode(errorId);
  const input = h(multiline ? 'textarea' : 'input', {
    class: 'input',
    id,
    name,
    ...(multiline ? { rows: 4 } : { type }),
    ...(max ? { maxlength: max } : {}),
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' '),
    ...(optional ? {} : { required: true, 'aria-required': 'true' }),
    ...attrs,
  });
  const counter = multiline && max ? h('span', { class: 'field__count', 'aria-hidden': 'true' }, `${input.value.length}/${max}`) : null;
  const node = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label, optional ? h('span', { class: 'optional' }, ' (optional)') : null),
    hint ? h('p', { class: 'field__hint', id: hintId }, hint) : null,
    input,
    h('div', { class: 'field__foot' }, error, counter));

  let touched = false;
  const api = {
    node,
    input,
    id,
    value: () => input.value,
    setError(message) {
      node.classList.toggle('is-invalid', Boolean(message));
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      showError(error, message);
    },
    /** Validate now; returns the message or null. */
    check() {
      touched = true;
      const message = validate?.(input.value) ?? null;
      api.setError(message);
      return message;
    },
  };
  input.addEventListener('blur', () => {
    if (input.value !== '' || touched) api.check();
  });
  input.addEventListener('input', () => {
    if (counter) counter.textContent = `${input.value.length}/${max}`;
    if (node.classList.contains('is-invalid')) api.check();
  });
  return api;
}

/**
 * Chips on radio inputs inside a fieldset. options: [{ value, label, sub, disabled }].
 * Returns { node, value(), set(options), setSubs(fn), select(value), setError(message), target() }.
 */
export function choiceGroup({ name, legend, legendNode = null, className = '', options = [], onChange }) {
  const errorId = nextId(`${name}-error`);
  const error = errorNode(errorId);
  const list = h('div', { class: ['choices', className] });
  const node = h('fieldset', { class: 'choice-group', 'aria-describedby': errorId },
    legendNode ?? h('legend', { class: 'field__label' }, legend),
    list,
    error);
  let inputs = [];

  const api = {
    node,
    value: () => inputs.find((input) => input.checked)?.value ?? null,
    set(next) {
      const selected = api.value();
      inputs = next.map((option) => h('input', {
        class: 'choice__input',
        type: 'radio',
        name,
        value: option.value,
        disabled: Boolean(option.disabled),
        checked: option.value === selected && !option.disabled,
        onchange: () => {
          api.setError(null);
          onChange?.(option.value);
        },
      }));
      mount(list, next.map((option, i) => h('label', { class: 'choice' },
        inputs[i],
        h('span', { class: 'choice__box' },
          h('span', null, option.label),
          option.sub === undefined ? null : h('span', { class: 'choice__sub' }, option.sub)))));
    },
    /** Rewrite each chip's secondary line in place (keeps focus and selection). */
    setSubs(text) {
      for (const input of inputs) {
        const sub = input.nextElementSibling.querySelector('.choice__sub');
        if (sub) sub.textContent = text(input.value);
      }
    },
    select(value) {
      for (const input of inputs) input.checked = input.value === value && !input.disabled;
    },
    setError(message) {
      node.classList.toggle('is-invalid', Boolean(message));
      showError(error, message);
    },
    /** The input keyboard focus should land on: the checked one, else the first enabled one. */
    target: () => inputs.find((input) => input.checked) ?? inputs.find((input) => !input.disabled) ?? null,
  };
  api.set(options);
  return api;
}

/**
 * The error summary shown at the top of a form after a failed submit. Each entry links to the
 * control to fix. show(title, entries: [{ message, target }]) moves focus to the summary;
 * target is the element to focus (or null for a message without a control).
 */
export function errorSummary() {
  const titleId = nextId('summary');
  const node = h('div', { class: 'error-summary', tabindex: '-1', 'aria-labelledby': titleId, hidden: true });
  return {
    node,
    show(title, entries = []) {
      mount(node,
        h('h3', { id: titleId }, title),
        entries.length ? h('ul', null, entries.map(({ message, target }) => h('li', null, target
          ? h('a', {
            href: target.id ? `#${target.id}` : '#',
            onclick: (event) => {
              event.preventDefault();
              target.focus({ preventScroll: true });
              target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            },
          }, message)
          : message))) : null);
      node.hidden = false;
      node.focus();
    },
    hide() {
      node.hidden = true;
      node.replaceChildren();
    },
  };
}
