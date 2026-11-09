// Modal surfaces built on <dialog>: the browser supplies the focus trap, Esc and an inert page;
// this adds the motion, swipe-to-close, backdrop dismissal, focus return and a scroll lock that
// holds on iOS Safari.

import { h, nextId, prefersReducedMotion } from './dom.js';
import { icon } from './ui.js';

const CLOSE_DISTANCE = 96;
const CLOSE_VELOCITY = 0.55; // px per ms

let locks = 0;
let savedY = 0;

function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  savedY = scrollY;
  const { style } = document.body;
  document.documentElement.classList.add('is-locked');
  style.setProperty('top', `-${savedY}px`);
}

function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  document.documentElement.classList.remove('is-locked');
  document.body.style.removeProperty('top');
  scrollTo({ top: savedY, behavior: 'instant' });
}

/**
 * variant 'sheet': a panel that rises from the bottom on phones (drag handle, swipe down to close).
 * variant 'overlay': a full-screen surface that fades in.
 * Returns { el, body, open(), close(), isOpen() }. `header` replaces the default title row; any
 * element marked data-close closes the dialog.
 */
export function createDialog({ variant = 'sheet', title = '', header = null, className = '', onClose } = {}) {
  const titleId = nextId('dialog-title');
  const body = h('div', { class: `${variant}__body` });
  const head = header ?? h('div', { class: `${variant}__head` },
    h('h2', { class: `${variant}__title`, id: titleId }, title),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', 'data-close': '' }, icon('close')));
  const grip = variant === 'sheet' ? h('div', { class: 'sheet__grip', 'aria-hidden': 'true' }) : null;
  const panel = h('div', { class: `${variant}__panel` }, grip, head, body);
  const el = h('dialog', { class: [variant, className], 'aria-labelledby': header ? null : titleId }, panel);
  document.body.append(el);

  let returnFocus = null;
  let closing = false;

  function open() {
    if (el.open) return;
    returnFocus = document.activeElement;
    lockScroll();
    el.showModal();
    requestAnimationFrame(() => el.classList.add('is-open'));
  }

  function finish() {
    el.close();
    el.classList.remove('is-closing');
    panel.style.removeProperty('transform');
    closing = false;
    unlockScroll();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    onClose?.();
  }

  /** immediate: skip the exit motion (used when a link inside is leaving the page). */
  function close({ immediate = false } = {}) {
    if (!el.open || closing) return;
    closing = true;
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    if (immediate || prefersReducedMotion()) finish();
    else setTimeout(finish, 320);
  }

  el.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // A click on the <dialog> itself (outside the panel) is a click on the backdrop; any element
  // marked data-close inside it closes it too.
  el.addEventListener('click', (event) => {
    if (event.target === el || event.target.closest('[data-close]')) close();
  });

  if (grip) {
    let start = null;
    const dragZones = [grip, head];
    const onMove = (event) => {
      if (!start) return;
      const dy = Math.max(0, event.clientY - start.y);
      start.dy = dy;
      panel.style.setProperty('transform', `translateY(${dy}px)`);
    };
    const onEnd = (event) => {
      if (!start) return;
      const { dy = 0, t, pointerId } = start;
      start = null;
      panel.classList.remove('is-dragging');
      event.currentTarget.releasePointerCapture?.(pointerId);
      const velocity = dy / Math.max(1, performance.now() - t);
      if (dy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) close();
      else panel.style.removeProperty('transform');
    };
    for (const zone of dragZones) {
      zone.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('button, a, input')) return;
        start = { y: event.clientY, t: performance.now(), pointerId: event.pointerId };
        zone.setPointerCapture(event.pointerId);
        panel.classList.add('is-dragging');
      });
      zone.addEventListener('pointermove', onMove);
      zone.addEventListener('pointerup', onEnd);
      zone.addEventListener('pointercancel', onEnd);
    }
  }

  return { el, body, open, close, isOpen: () => el.open && !closing };
}
