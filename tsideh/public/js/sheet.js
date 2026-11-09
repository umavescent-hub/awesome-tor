// The phone order sheet, built on <dialog>: the browser supplies the focus trap, Esc and an inert
// page. This adds a calm slide-in, a labelled Close button, focus return, a scroll lock that holds
// on iOS Safari, and the phone's Back button: opening the sheet adds a history entry, so Back (or
// the Android back gesture) closes the sheet instead of leaving the page.

import { h, nextId, prefersReducedMotion } from './dom.js';
import { icon } from './ui.js';

let locks = 0;
let savedY = 0;

function lockScroll() {
  locks += 1;
  if (locks > 1) return;
  savedY = scrollY;
  document.documentElement.classList.add('is-locked');
  document.body.style.setProperty('top', `-${savedY}px`);
}

function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  document.documentElement.classList.remove('is-locked');
  document.body.style.removeProperty('top');
  scrollTo({ top: savedY, behavior: 'instant' });
}

/* Open sheets, newest last, and history steps this module started itself. */
const openSheets = [];
let ownSteps = 0;

/**
 * The router calls this on every popstate before it renders. Returns true when the step belonged
 * to a sheet (Back closed it, or a sheet's own close stepped back), so the page must stay as it is.
 */
export function handleHistoryBack() {
  if (ownSteps > 0) {
    ownSteps -= 1;
    return true;
  }
  const top = openSheets.at(-1);
  if (top) {
    top.close({ fromHistory: true });
    return true;
  }
  return false;
}

/**
 * A panel that rises from the bottom with a Close button and a title. key names its history entry,
 * so a page that loads on that entry (Back from the payment page) can open it again in place.
 * Returns { el, body, open(), close(), isOpen(), ownsEntry() }.
 */
export function createSheet({ title, key, className = '', onClose }) {
  const id = key ?? nextId('sheet');
  const titleId = `${id}-title`;
  // The title opens the scrolling body; the fixed head holds only Close, so it stays one row high
  // even with very large text on a narrow phone.
  const body = h('div', { class: 'sheet__body' }, h('h2', { class: 'sheet__title', id: titleId }, title));
  const head = h('div', { class: 'sheet__head' },
    h('button', { class: 'btn btn--outline btn--small sheet__close', type: 'button', 'data-close': '' }, icon('close'), 'Close'));
  const panel = h('div', { class: 'sheet__panel' }, head, body);
  const el = h('dialog', { class: ['sheet', className], 'aria-labelledby': titleId }, panel);
  document.body.append(el);

  let returnFocus = null;
  let closing = false;
  const ownsEntry = () => history.state?.sheet === id;
  const api = { el, body, open, close, ownsEntry, isOpen: () => el.open && !closing };

  function open() {
    if (el.open) return;
    returnFocus = document.activeElement;
    lockScroll();
    el.showModal();
    openSheets.push(api);
    if (!ownsEntry()) history.pushState({ ...history.state, sheet: id }, '');
    requestAnimationFrame(() => el.classList.add('is-open'));
  }

  function finish() {
    el.close();
    el.classList.remove('is-closing');
    closing = false;
    unlockScroll();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    onClose?.();
  }

  /**
   * fromHistory: Back already removed the sheet's history entry.
   * silent: the page is going away; leave history alone and skip the motion.
   */
  function close({ fromHistory = false, silent = false } = {}) {
    if (!el.open || closing) return;
    closing = true;
    openSheets.splice(openSheets.indexOf(api), 1);
    if (!fromHistory && !silent && ownsEntry()) {
      ownSteps += 1;
      history.back();
    }
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    if (silent || prefersReducedMotion()) finish();
    else setTimeout(finish, 240);
  }

  el.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  // A click on the <dialog> itself (outside the panel) is a click on the backdrop.
  el.addEventListener('click', (event) => {
    if (event.target === el || event.target.closest('[data-close]')) close();
  });

  return api;
}
