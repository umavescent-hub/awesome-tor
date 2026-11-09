// DOM construction without HTML strings. Every text value becomes a text node, so data from the
// API or the customer can never be parsed as markup (and Trusted Types can stay locked down).

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPERTIES = new Set(['value', 'checked', 'disabled', 'hidden', 'required', 'readOnly', 'selected', 'inert', 'indeterminate']);

function apply(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === '') continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * h('button', { class: 'btn', type: 'button', onclick }, 'Label')
 * Props: class (string or array), dataset, style (custom properties / CSSOM only), on<event>
 * listeners, DOM properties (value, checked, disabled, hidden, ...), everything else as attributes.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) apply(el, props);
  append(el, children);
  return el;
}

/** SVG element with the same calling convention. */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) apply(el, props);
  append(el, children);
  return el;
}

/** Replace an element's children (never through innerHTML). */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

let uid = 0;
/** A document-unique id for label/aria wiring. */
export function nextId(prefix = 'id') {
  uid += 1;
  return `${prefix}-${uid}`;
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
