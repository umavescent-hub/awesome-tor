// The site's grain: the same hexagonal dot lattice as the generative art, at low intensity. A
// seeded halftone field whose dots swell along a spiral or stepped terraces.

import { seedFrom } from './art.js';

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
