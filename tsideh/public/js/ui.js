// Small shared pieces of interface: icons, loading and error states, busy buttons.

import { h, s } from './dom.js';

/* Icons: one 24px grid, round strokes, drawn with currentColor. They always sit next to words and
   are hidden from screen readers. */
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  back: 'M15 5l-7 7 7 7',
  calendar: 'M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4',
  pin: 'M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  alert: 'M12 8v5M12 16.5v.01M10.3 3.9L2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 11v6M12 7.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};

export function icon(name) {
  return s('svg', {
    class: 'icon',
    viewBox: '0 0 24 24',
    width: '24',
    height: '24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    focusable: 'false',
    'aria-hidden': 'true',
  }, s('path', { d: PATHS[name] }));
}

export const spinner = () => h('span', { class: 'spinner', 'aria-hidden': 'true' });

/** Quiet placeholder lines that hold the space the content will take (no animation). */
export function skeleton(lines = 3, { className = '' } = {}) {
  return h('div', { class: ['skeleton', className], 'aria-hidden': 'true' },
    Array.from({ length: lines }, (_, i) => h('span', { class: 'skeleton__line', style: { '--w': `${[92, 76, 84, 60, 70][i % 5]}%` } })));
}

/** A calm, actionable failure: what happened and one way forward. */
export function errorState({ title = 'This did not load', message, onRetry, action }) {
  return h('div', { class: 'state', role: 'alert' },
    h('h2', { class: 'state__title' }, title),
    h('p', { class: 'state__text' }, message),
    h('div', { class: 'state__actions' },
      onRetry ? h('button', { class: 'btn btn--primary', type: 'button', onclick: onRetry }, 'Try again') : null,
      action ?? null));
}

/** A plain message box that stays on screen until the page changes (no timers). */
export function notice({ title, text, tone = 'info', role = 'status' }) {
  return h('div', { class: ['notice', `notice--${tone}`], role },
    icon(tone === 'info' ? 'info' : 'alert'),
    h('div', null,
      title ? h('p', { class: 'notice__title' }, title) : null,
      text ? h('p', { class: 'notice__text' }, text) : null));
}

/** Put a button into its busy state (disabled, aria-busy) and back. */
export function setBusy(button, busy) {
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
  button.classList.toggle('is-busy', busy);
}
