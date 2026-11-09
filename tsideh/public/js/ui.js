// Small shared pieces of interface: icons, toasts, loading and error states, lazily drawn art.

import { h, s } from './dom.js';

/* Icons: one 24px grid, 1.75px round strokes, drawn with currentColor. Decorative by default. */
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
  bag: 'M5 8.5h14l-1 11.5H6zM9 8.5V7a3 3 0 0 1 6 0v1.5',
};

export function icon(name, { label } = {}) {
  const svg = s('svg', {
    class: 'icon',
    viewBox: '0 0 24 24',
    width: '24',
    height: '24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  }, s('path', { d: PATHS[name] }));
  return svg;
}

/** A design token's value, e.g. token('--adobe'), for drawing on canvas. */
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const spinner = () => h('span', { class: 'spinner', 'aria-hidden': 'true' });

/* Toasts: one polite live region, newest last, each dismissed after a calm interval. */
let region = null;
export function toast(message, { tone = 'neutral', timeout = 5200 } = {}) {
  region ??= document.getElementById('toasts');
  if (!region) return;
  const item = h('div', { class: ['toast', `toast--${tone}`] },
    tone === 'success' ? icon('check') : tone === 'error' ? icon('alert') : null,
    h('span', null, message));
  region.append(item);
  requestAnimationFrame(() => item.classList.add('is-in'));
  setTimeout(() => {
    item.classList.remove('is-in');
    setTimeout(() => item.remove(), 400);
  }, timeout);
}

/** A block of shimmering placeholder lines that holds the space the content will take. */
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

/* Generative art drawn only when it nears the viewport, and redrawn when its box changes size. */
const pending = new Map();
let observer = null;

function paint(canvas) {
  const draw = pending.get(canvas);
  if (!draw || !canvas.isConnected || canvas.clientWidth === 0) return;
  draw(canvas);
  canvas.dataset.painted = `${canvas.clientWidth}x${canvas.clientHeight}`;
}

const resizer = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    if (target.dataset.painted && target.dataset.painted !== `${target.clientWidth}x${target.clientHeight}`) paint(target);
  }
});

export function lazyArt(canvas, draw) {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      paint(entry.target);
      resizer.observe(entry.target);
    }
  }, { rootMargin: '300px 0px' });
  pending.set(canvas, draw);
  observer.observe(canvas);
  return canvas;
}

/** Stop tracking art that left the page (called when a view unmounts). */
export function releaseArt(root) {
  for (const canvas of root.querySelectorAll('canvas')) {
    if (!pending.has(canvas)) continue;
    pending.delete(canvas);
    observer?.unobserve(canvas);
    resizer.unobserve(canvas);
  }
}

/** Put a button into its busy state (spinner, disabled, aria-busy) and back. */
export function setBusy(button, busy) {
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
  button.classList.toggle('is-busy', busy);
}
