// The site's grain: the same hexagonal dot lattice as the generative art, at low intensity.
//   drawDotField   a seeded halftone field whose dots swell along a spiral or stepped terraces.
//   mountPopupMap  "Where we pop up": a stylized dot map of the Northern Rio Grande corridor with
//                  the river traced in larger adobe dots and a marker for each pop-up place.

import { seedFrom } from './art.js';
import { h } from './dom.js';
import { lazyArt, token } from './ui.js';

const TAU = Math.PI * 2;
const MAX_PIXELS = 5_000_000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth seeded value noise in [0, 1]. */
function valueNoise(seed) {
  const hash = (x, y) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const top = hash(xi, yi) + (hash(xi + 1, yi) - hash(xi, yi)) * u;
    const bottom = hash(xi, yi + 1) + (hash(xi + 1, yi + 1) - hash(xi, yi + 1)) * u;
    return top + (bottom - top) * v;
  };
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Size the backing store to the box at up to 2x density, capped for very large boxes. */
function fit(canvas) {
  const w = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!w || !height) return null;
  const dpr = Math.max(1, Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (w * height))));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, height };
}

/** Visit every node of a hexagonal lattice with spacing S covering w x h. */
function lattice(w, height, S, visit) {
  const dy = (S * Math.sqrt(3)) / 2;
  for (let row = 0, y = S / 2; y < height + S; row += 1, y += dy) {
    for (let x = row % 2 ? S : S / 2; x < w + S; x += S) visit(x, y);
  }
}

/** Motif fields in [0, 1]: where the lattice swells. */
function spiralField(rng, w, height, S) {
  const cx = w * (0.7 + rng() * 0.18);
  const cy = height * (0.16 + rng() * 0.2);
  const rot = rng() * TAU;
  const dir = rng() < 0.5 ? 1 : -1;
  const b = 0.22;
  const a = S * 3.2;
  const reach = Math.max(w, height) * 0.62;
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const rho = Math.hypot(dx, dy);
    if (rho < a) return 0;
    const phi = Math.atan2(dy, dx) * dir - rot;
    const turns = (Math.log(rho / a) / b - phi) / TAU;
    const off = Math.abs(turns - Math.round(turns));
    return (1 - smoothstep(0.03, 0.3, off)) * (1 - smoothstep(reach * 0.25, reach, rho));
  };
}

function terraceField(rng, w, height) {
  const cx = w * (0.2 + rng() * 0.6);
  const levels = 5;
  const step = height * 0.1;
  const half = w * (0.42 + rng() * 0.12);
  return (x, y) => {
    let inside = 0;
    for (let k = 0; k < levels; k += 1) {
      const top = height - step * (k + 1);
      const width = half * (1 - k / levels);
      if (y >= top && Math.abs(x - cx) <= width) inside += 1;
    }
    return inside / levels;
  };
}

/**
 * Paint the dot field. seed: string or number. ink: dot color. bg: ground color or null for a
 * transparent canvas. density: grains per 18px. motif: 'spiral' | 'terrace' | 'none'.
 * strength: dot opacity (0.04-0.1 keeps text contrast intact).
 */
export function drawDotField(canvas, { seed = 'tsideh', ink, bg = null, density = 1, motif = 'spiral', strength = 0.06 } = {}) {
  const box = fit(canvas);
  if (!box) return;
  const { ctx, w, height } = box;
  const numericSeed = typeof seed === 'number' ? seed >>> 0 : seedFrom(String(seed));
  const rng = mulberry32(numericSeed);
  const noise = valueNoise(numericSeed);
  const S = 18 / density;
  const field = motif === 'spiral' ? spiralField(rng, w, height, S) : motif === 'terrace' ? terraceField(rng, w, height) : () => 0;
  const rMin = S * 0.07;
  const rMax = S * 0.3;
  const terraces = 5;

  ctx.clearRect(0, 0, w, height);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, height);
  }
  ctx.fillStyle = ink;
  ctx.globalAlpha = strength;
  ctx.beginPath();
  lattice(w, height, S, (x, y) => {
    const breath = (noise(x * 0.004, y * 0.004) - 0.5) * 0.36;
    const v = Math.min(1, Math.max(0, field(x, y) * 0.9 + breath));
    const r = rMin + (rMax - rMin) * (Math.round(v * terraces) / terraces);
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  });
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ the pop-up map */

const BOUNDS = { latMin: 35.45, latMax: 36.35, lngMin: -106.45, lngMax: -105.75 };
const RIVER = [
  [36.32, -105.73], [36.2, -105.93], [36.1, -106.04], [36.05, -106.07], [35.99, -106.08], [35.94, -106.11],
  [35.87, -106.14], [35.78, -106.2], [35.7, -106.26], [35.62, -106.32], [35.52, -106.37],
];

/** Equirectangular fit of the corridor's bounding box to [0, 1] x [0, 1]. */
const project = ([lat, lng]) => ({
  x: (lng - BOUNDS.lngMin) / (BOUNDS.lngMax - BOUNDS.lngMin),
  y: (BOUNDS.latMax - lat) / (BOUNDS.latMax - BOUNDS.latMin),
});

function distanceToRiver(px, py, river) {
  let best = Infinity;
  for (let i = 1; i < river.length; i += 1) {
    const a = river[i - 1];
    const b = river[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy)));
    best = Math.min(best, Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t)));
  }
  return best;
}

function drawMap(canvas, colors) {
  const box = fit(canvas);
  if (!box) return;
  const { ctx, w, height } = box;
  const S = Math.max(9, Math.min(13, w / 34));
  const noise = valueNoise(seedFrom('rio-grande'));
  const river = RIVER.map(project).map((p) => ({ x: p.x * w, y: p.y * height }));
  const ground = new Path2D();
  const water = new Path2D();
  lattice(w, height, S, (x, y) => {
    const d = distanceToRiver(x, y, river) / S;
    if (d < 1.1) {
      const r = S * (0.4 - d * 0.14);
      water.moveTo(x + r, y);
      water.arc(x, y, r, 0, TAU);
      return;
    }
    // Higher ground reads as slightly larger dots; the valley floor stays fine.
    const lift = noise(x / (S * 9), y / (S * 9)) * smoothstep(1.1, 9, d);
    const r = S * (0.08 + Math.round(lift * 4) * 0.035);
    ground.moveTo(x + r, y);
    ground.arc(x, y, r, 0, TAU);
  });
  ctx.clearRect(0, 0, w, height);
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = colors.ink;
  ctx.fill(ground);
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.river;
  ctx.fill(water);
}

/**
 * Mount the map into `container`. events: EventSummary[] (those without coords are skipped).
 * onSelect(eventIds, how): a place was hovered ('hover') or clicked ('click'); null on leave.
 * Returns { highlight(eventId | null) }, or null when no event has coordinates.
 */
export function mountPopupMap(container, { events, onSelect }) {
  const places = new Map();
  for (const event of events) {
    const { coords } = event;
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) continue;
    const key = `${coords.lat.toFixed(3)},${coords.lng.toFixed(3)}`;
    if (!places.has(key)) places.set(key, { name: event.locationName, coords, ids: [] });
    places.get(key).ids.push(event.id);
  }
  if (places.size === 0) return null;

  const colors = { ink: token('--black'), river: token('--adobe') };
  const canvas = lazyArt(h('canvas', { class: 'map__canvas' }), (c) => drawMap(c, colors));
  const label = project([35.56, -106.33]);
  const markers = [];
  const layer = h('div', { class: 'map__layer' },
    h('span', { class: 'map__river', style: { left: `${label.x * 100}%`, top: `${label.y * 100}%` } }, 'Rio Grande'));

  for (const place of places.values()) {
    const at = project([place.coords.lat, place.coords.lng]);
    const marker = h('span', {
      class: ['map__marker', at.x > 0.62 ? 'map__marker--left' : ''],
      style: { left: `${at.x * 100}%`, top: `${at.y * 100}%` },
      onpointerenter: () => onSelect?.(place.ids, 'hover'),
      onpointerleave: () => onSelect?.(null, 'hover'),
      onclick: () => onSelect?.(place.ids, 'click'),
    },
    h('span', { class: 'map__dot' }),
    h('span', { class: 'map__name' }, place.name));
    markers.push({ marker, ids: new Set(place.ids) });
    layer.append(marker);
  }

  const names = [...places.values()].map((place) => place.name);
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `Map of the Northern Rio Grande showing where the next pop-ups are: ${[...new Set(names)].join(', ')}.`);
  layer.setAttribute('aria-hidden', 'true');
  container.replaceChildren(canvas, layer);

  return {
    highlight(eventId) {
      for (const { marker, ids } of markers) marker.classList.toggle('is-active', eventId !== null && ids.has(eventId));
    },
  };
}
