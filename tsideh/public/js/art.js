/* Tsideh — generative art: "Gathered Ground" (docs/art-philosophy.md).
 *
 * One hexagonal lattice of identical dots. Each dot's size is read from a scalar field: a
 * logarithmic spiral measured in log-polar space (a solid arm, outlined, tapering outward), a
 * terraced halo stepping away from it, and a slow noise breath. Pottery registers, stepped terraces
 * and a feather band (three kelly stripes closed by a black sawtooth) are cut from the same grain,
 * so everything reads as one material. Color is assigned by role, never by chance: adobe ground,
 * black working dots and outlines, cream solid forms, kelly stripes and sprouts.
 *
 * In the hero the dots arrive on a seeded river, gather with a damped swirl, the sprouts open, and
 * the field keeps breathing. Canvas 2D only, no dependencies, deterministic for a seed.
 */

export const PALETTE = Object.freeze({
  adobe: '#c16742',
  kelly: '#4cbb17',
  cream: '#f3ead7',
  black: '#0a0806',
});

const INK = { ground: PALETTE.adobe, dot: PALETTE.black, form: PALETTE.cream, accent: PALETTE.kelly, edge: PALETTE.black };
const ROLES = ['dot', 'form', 'accent', 'edge'];

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const STEP_MS = 1000 / 60;
const FRAME_MS = 1000 / 30;
const MAX_STEPS_PER_FRAME = 4;
const RESIZE_DEBOUNCE_MS = 150;
const MAX_PIXELS = 4_500_000;
const SPROUT_STEPS = 70;

/* Field parameters, tuned in the Gathered Ground lab. */
const WINDING = 0.22;
const ARM_WIDTH = 0.19;
const TERRACES = 5;
const BREATH = 0.2;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;

/* ------------------------------------------------------------------ seeds */

function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stable 32-bit hash of any string (FNV-1a with a murmur finalizer). */
export function seedFrom(str) {
  const s = String(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

const seedNumber = (seed) => (typeof seed === 'string' ? seedFrom(seed) : Number(seed) >>> 0);

/** mulberry32 with a few helpers. */
function createRng(seed) {
  let a = mix32(seedNumber(seed) ^ 0x9e3779b9);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    gauss(sd) {
      const u = 1 - next();
      return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * next());
    },
  };
}

/** Seeded fractal gradient noise in [0, 1], centred on 0.5. */
function createNoise(rng) {
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255];
  const gx = Array.from({ length: 8 }, (_, k) => Math.cos((k * TAU) / 8));
  const gy = Array.from({ length: 8 }, (_, k) => Math.sin((k * TAU) / 8));
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function gradient(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const corner = (ix, iy) => {
      const k = perm[X + ix + perm[Y + iy]] & 7;
      return gx[k] * (xf - ix) + gy[k] * (yf - iy);
    };
    const u = fade(xf);
    return lerp(lerp(corner(0, 0), corner(1, 0), u), lerp(corner(0, 1), corner(1, 1), u), fade(yf));
  }

  return (x, y) => {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let octave = 0; octave < 4; octave++) {
      sum += amplitude * gradient(x * frequency, y * frequency);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return clamp(0.5 + (sum / norm) * 0.8, 0, 1);
  };
}

/* ------------------------------------------------------------------ canvas */

/** Sizes the backing store to the CSS box at up to 2x density. Returns null for an empty box. */
function fit(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = Math.max(1, Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (w * h))));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ------------------------------------------------------------------ geometry */

/** Log-polar reading of a point against the spiral r = a·e^(bθ); sd is the distance to the
 *  nearest arm in turns (−0.5…0.5). */
function spiralAt(G, x, y) {
  const dx = x - G.cx;
  const dy = y - G.cy;
  const rho = Math.hypot(dx, dy);
  const phi = Math.atan2(dy, dx) * G.dir - G.rot;
  const theta = Math.log(Math.max(rho, 1e-3) / G.a) / G.b;
  const s = (theta - phi) / TAU;
  return { rho, sd: s - Math.round(s), theta };
}

function spiralPoint(G, theta) {
  const r = G.a * Math.exp(G.b * theta);
  const angle = (theta + G.rot) * G.dir;
  return { x: G.cx + r * Math.cos(angle), y: G.cy + r * Math.sin(angle) };
}

/** Arm half-width in turns; it tapers to nothing toward the outer end. */
const armWidthAt = (G, rho) => G.arm * (1 - smoothstep(G.rmax * 0.42, G.rmax, rho));

/** A feather band: three stripes along u, stacked across n, closed by a sawtooth past `length`. */
function featherBand({ ox, oy, ux, uy, length, S, rng, flip = false }) {
  const nx = flip ? uy : -uy;
  const ny = flip ? -ux : ux;
  const stripe = S * 2.05;
  const gap = S * 1.25;
  return { ox, oy, ux, uy, nx, ny, length, stripe, gap, span: stripe * 3 + gap * 2, tooth: S * rng.range(3, 3.8) };
}

/** 'accent' on a stripe, 'gap' between stripes, 'edge' on a tooth, or null outside the band. */
function bandRole(B, x, y) {
  const dx = x - B.ox;
  const dy = y - B.oy;
  const u = dx * B.ux + dy * B.uy;
  const n = dx * B.nx + dy * B.ny;
  if (n < 0 || n > B.span) return null;
  if (u >= 0 && u <= B.length) {
    const k = Math.floor(n / (B.stripe + B.gap));
    return n - k * (B.stripe + B.gap) <= B.stripe ? 'accent' : 'gap';
  }
  const pitch = B.span / 3;
  const f = (n % pitch) / pitch;
  return u > B.length && u <= B.length + B.tooth * (1 - Math.abs(2 * f - 1)) ? 'edge' : null;
}

/** Distance from a point to a band's rectangle (teeth included), in pixels. */
function bandDistance(B, x, y) {
  const dx = x - B.ox;
  const dy = y - B.oy;
  const u = dx * B.ux + dy * B.uy;
  const n = dx * B.nx + dy * B.ny;
  const du = Math.max(0, -u, u - (B.length + B.tooth));
  const dn = Math.max(0, -n, n - B.span);
  return Math.hypot(du, dn);
}

/** The band laid along the outer arm's tangent at radius rho, just outside the arm. */
function spiralBand(G, rng, length, rho) {
  const theta = Math.log(rho / G.a) / G.b;
  const p0 = spiralPoint(G, theta);
  const p1 = spiralPoint(G, theta + 0.02);
  const ul = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const ux = (p1.x - p0.x) / ul;
  const uy = (p1.y - p0.y) / ul;
  const outward = (p0.x - G.cx) * -uy + (p0.y - G.cy) * ux >= 0;
  const half = armWidthAt(G, rho) * TAU * G.b * rho + G.S * 0.9;
  const nx = outward ? -uy : uy;
  const ny = outward ? ux : -ux;
  return featherBand({ ox: p0.x + nx * half, oy: p0.y + ny * half, ux, uy, length, S: G.S, rng, flip: !outward });
}

/* ------------------------------------------------------------------ composition */

/** The vertical span between the registers, where bands may run. */
function frameInterior(G, h) {
  const dy = (G.S * Math.sqrt(3)) / 2;
  const rows = Math.floor((h - G.S * 0.5) / dy);
  const top = (h - (rows - 1) * dy) / 2;
  return {
    top: G.top === null ? G.S : top + (G.top + 4.5) * dy,
    bottom: G.bottom === null ? h - G.S : top + (rows - 1 - G.bottom - 4.5) * dy,
  };
}

/**
 * Lays the feather band along the arm, turning the spiral (its rotation is free) until the whole
 * band, teeth included, sits inside the frame on the art side of the mask; a band that fits
 * nowhere is shortened, and only then left out.
 */
function fitBand(G, rng, w, h, length, [near, far] = [0.52, 0.64]) {
  const inside = frameInterior(G, h);
  const fits = (B) => [0, B.length + B.tooth].every((u) => [0, B.span].every((n) => {
    const x = B.ox + B.ux * u + B.nx * n;
    const y = B.oy + B.uy * u + B.ny * n;
    return x > G.S && x < w - G.S && y > inside.top && y < inside.bottom && G.mask(x, y) > 0.5;
  }));
  const rho = G.rmax * rng.range(near, far);
  for (const scale of [1, 0.8, 0.6, 0.45]) {
    for (let turn = 0; turn < 16; turn++) {
      const band = spiralBand(G, rng, length * scale, rho);
      if (fits(band)) return band;
      G.rot += TAU / 16;
    }
  }
  return null;
}

/** Terraces hanging from the top register, spread evenly across [from, to] of the width. */
function hangingSteps(rng, w, { from, to, levels }) {
  const count = rng.int(2, 3);
  return Array.from({ length: count }, (_, i) => ({
    x: w * (from + ((to - from) * (i + rng.range(0.25, 0.75))) / count),
    levels: rng.int(levels[0], levels[1]),
  }));
}

/** Shared geometry for a spiral composition centred at (cx, cy) reaching rmax. */
function spiralGeometry(rng, { S, cx, cy, rmax, eyeScale = rng.range(3.3, 4.1) }) {
  const eyeR = S * eyeScale;
  return {
    S,
    cx,
    cy,
    rmax,
    rot: rng.range(0, TAU),
    dir: rng.next() < 0.5 ? 1 : -1,
    b: WINDING,
    arm: ARM_WIDTH,
    eyeR,
    a: eyeR * 0.92,
    spiral: true,
  };
}

const NO_MASK = () => 1;

/**
 * Builds the geometry G for a kind of composition on a w×h canvas:
 * 'hero' (with zone 'left' | 'top'), 'event', 'item', 'banner', 'sherd'.
 */
function compose(kind, w, h, rng, { zone } = {}) {
  const min = Math.min(w, h);
  let G;

  if (kind === 'hero' && zone === 'left') {
    const S = clamp(Math.round(min / 50), 10, 20);
    const cx = w * rng.range(0.74, 0.76);
    G = spiralGeometry(rng, { S, cx, cy: h * rng.range(0.48, 0.54), rmax: Math.min(h * 0.42, cx - w * 0.53) });
    G.mask = (x) => smoothstep(w * 0.5, w * 0.6, x);
    G.top = 2;
    G.bottom = 2;
    G.band = fitBand(G, rng, w, h, w * rng.range(0.08, 0.11));
    G.steps = hangingSteps(rng, w, { from: 0.6, to: 0.96, levels: [3, 4] });
    G.sprouts = 3;
    G.river = riverAcross(rng, w, h, 'vertical', { from: 0.64, to: 0.94, wander: w * 0.07 });
  } else if (kind === 'hero') {
    const S = clamp(Math.round(min / 34), 10, 18);
    const free = Math.min(w * 1.1, 620, h * 0.56);
    G = spiralGeometry(rng, { S, cx: w * rng.range(0.47, 0.53), cy: h - free * 0.52, rmax: Math.min(w * 0.37, free * 0.37) });
    G.mask = (x, y) => smoothstep(h - free - h * 0.02, h - free + h * 0.08, y);
    G.top = null;
    G.bottom = 1;
    G.band = fitBand(G, rng, w, h, w * rng.range(0.14, 0.2), [0.4, 0.48]);
    G.steps = [];
    G.sprouts = 3;
    G.river = riverAcross(rng, w, h, 'horizontal', { from: (h - free * 0.85) / h, to: (h - free * 0.2) / h, wander: free * 0.12 });
  } else if (kind === 'event') {
    const S = Math.max(3.5, min / 34);
    G = spiralGeometry(rng, { S, cx: w * rng.range(0.4, 0.6), cy: h * rng.range(0.47, 0.53), rmax: min * rng.range(0.36, 0.4) });
    G.top = 1;
    G.bottom = 1;
    G.mask = NO_MASK;
    G.band = fitBand(G, rng, w, h, w * rng.range(0.12, 0.18));
    G.steps = hangingSteps(rng, w, { from: 0.08, to: 0.92, levels: [2, 3] });
    G.sprouts = 2;
  } else if (kind === 'item') {
    const S = Math.max(2, min / 18);
    G = spiralGeometry(rng, { S, cx: w / 2, cy: h / 2, rmax: min * 0.48, eyeScale: rng.range(2.5, 2.8) });
    G.top = null;
    G.bottom = null;
    G.band = null;
    G.steps = [];
    G.sprouts = min >= 96 ? 1 : 0;
  } else if (kind === 'sherd') {
    const S = min / 25;
    G = spiralGeometry(rng, { S, cx: w * rng.range(0.46, 0.54), cy: h * rng.range(0.56, 0.6), rmax: min * 0.36, eyeScale: rng.range(2.7, 3) });
    G.top = Math.ceil((h * 0.16) / ((S * Math.sqrt(3)) / 2));
    G.bottom = null;
    G.band = null;
    G.steps = [];
    G.sprouts = 1;
  } else {
    G = composeBanner(w, h, rng);
  }

  G.mask ??= NO_MASK;
  G.rMin = G.S * 0.075;
  G.rMax = G.S * 0.47;
  G.noise = createNoise(rng);
  return G;
}

/**
 * A frieze: registers top and bottom, and between them a rhythm of feather bands and stepped
 * terraces with sprouts on the rising steps. No eye.
 */
function composeBanner(w, h, rng) {
  const S = clamp(h / 27, 3.5, 16);
  const dy = (S * Math.sqrt(3)) / 2;
  const rows = Math.floor((h - S * 0.5) / dy);
  const cells = clamp(Math.round(w / (h * 1.15)), 2, 6);
  const cell = w / cells;
  const bandsFirst = rng.next() < 0.5;
  const flow = rng.next() < 0.5 ? 1 : -1;
  const bands = [];
  const steps = [];
  const rises = [];
  for (let i = 0; i < cells; i++) {
    const center = cell * (i + 0.5);
    if ((i % 2 === 0) === bandsFirst) {
      const length = cell * rng.range(0.42, 0.52);
      const span = S * (2.05 * 3 + 1.25 * 2);
      const tooth = S * 3.4;
      const start = center - (flow * (length + tooth)) / 2;
      bands.push(featherBand({ ox: start, oy: h / 2 - span / 2, ux: flow, uy: 0, length, S, rng, flip: flow < 0 }));
    } else {
      steps.push({ x: center + rng.range(-0.08, 0.08) * cell, levels: rng.int(3, 4) });
      rises.push({ x: center + rng.range(-0.1, 0.1) * cell, levels: 3 });
    }
  }
  return {
    S,
    spiral: false,
    top: rows >= 20 ? 1 : 0,
    bottom: rows >= 20 ? 1 : 0,
    bands,
    steps,
    rises,
    band: null,
    sprouts: 0,
  };
}

/** A seeded current crossing the canvas, along which dots arrive. */
function riverAcross(rng, w, h, direction, { from, to, wander }) {
  const t0 = rng.range(from, to);
  const t1 = rng.range(from, to);
  const enter = direction === 'vertical' ? { x: w * t0, y: -60 } : { x: -60, y: h * t0 };
  const leave = direction === 'vertical' ? { x: w * t1, y: h + 60 } : { x: w + 60, y: h * t1 };
  if (rng.next() < 0.5) return { enter: leave, leave: enter, wander, phase: rng.range(0, 100) };
  return { enter, leave, wander, phase: rng.range(0, 100) };
}

function riverPoint(G, t) {
  const { enter, leave, wander, phase } = G.river;
  const length = Math.hypot(leave.x - enter.x, leave.y - enter.y) || 1;
  const px = -(leave.y - enter.y) / length;
  const py = (leave.x - enter.x) / length;
  const meander = (G.noise(t * 1.7, phase) - 0.5) * 2 * wander;
  return { x: lerp(enter.x, leave.x, t) + px * meander, y: lerp(enter.y, leave.y, t) + py * meander };
}

/* ------------------------------------------------------------------ the field */

/** Register rows: a double band, a fine row, then a single band. k counts rows from the edge. */
const registerRole = (k) => (k === 0 || k === 1 || k === 3 ? 'edge' : k === 2 ? 'fine' : null);

function stepRole(steps, x, depth, S) {
  if (depth < 0) return false;
  return steps.some((step) => depth < step.levels && Math.abs(x - step.x) <= (step.levels - depth) * S * 1.25);
}

/** Classifies one lattice node: { r, role, phase, level } or null to leave the ground bare. */
function classify(G, x, y, row, rows) {
  const { S } = G;
  const small = { r: G.rMin, role: 'dot', phase: 0, level: 0 };
  const solid = (role, phase = 0) => ({ r: G.rMax, role, phase, level: 1 });

  if (G.top !== null) {
    const role = registerRole(row - G.top);
    if (role) return role === 'edge' ? solid('edge') : small;
  }
  if (G.bottom !== null) {
    const role = registerRole(rows - 1 - G.bottom - row);
    if (role) return role === 'edge' ? solid('edge') : small;
  }
  if ((G.top !== null && row < G.top) || (G.bottom !== null && row > rows - 1 - G.bottom)) return small;
  const below = G.top !== null ? row - (G.top + 4) : -1;
  const above = G.bottom !== null ? rows - 1 - (G.bottom + 4) - row : -1;
  const mask = G.mask(x, y);
  const art = mask > 0.5;

  if (G.steps.length && art && stepRole(G.steps, x, below, S)
    && (!G.spiral || Math.hypot(x - G.cx, y - G.cy) > G.rmax * 1.05)
    && (!G.band || bandDistance(G.band, x, y) > S * 1.5)) return solid('form');

  if (!G.spiral) return bannerField(G, x, y, above, small, solid);

  const sp = spiralAt(G, x, y);
  if (G.band && art) {
    const role = bandRole(G.band, x, y);
    if (role === 'accent' || role === 'edge') return solid(role);
    if (role === 'gap') return small;
  }

  if (sp.rho < G.eyeR) return null;
  if (sp.rho < G.eyeR + S * 1.05) return solid('edge');

  const width = armWidthAt(G, sp.rho);
  const off = Math.abs(sp.sd);
  if (art && sp.rho < G.rmax && off <= width && width > 0.012) return solid(off <= width * 0.56 ? 'form' : 'edge', sp.theta);

  const halo = (1 - smoothstep(width, width + 0.24, off)) * (1 - smoothstep(G.rmax * 0.7, G.rmax * 1.2, sp.rho));
  return fieldDot(G, x, y, halo * 0.86, mask, sp.theta);
}

/** A working dot: halo plus breath, quantized to terraces and quieted by the mask; the calm zone
 *  stays bare ground, and the finest dots fade in at its edge. */
function fieldDot(G, x, y, halo, mask, phase) {
  if (mask < 0.02) return null;
  const breath = (G.noise((x / G.S) * 0.046 + 31.7, (y / G.S) * 0.046 + 11.3) - 0.47) * 2 * BREATH;
  const level = Math.round(clamp((halo + breath) * mask, 0, 1) * TERRACES) / TERRACES;
  const r = level === 0 ? G.rMin * smoothstep(0.02, 0.5, mask) : lerp(G.rMin, G.rMax, level);
  return { r, role: 'dot', phase, level };
}

function bannerField(G, x, y, above, small, solid) {
  if (stepRole(G.rises, x, above, G.S)) return solid('form');
  let near = Infinity;
  for (const band of G.bands) {
    const role = bandRole(band, x, y);
    if (role === 'accent' || role === 'edge') return solid(role);
    if (role === 'gap') return small;
    near = Math.min(near, bandDistance(band, x, y));
  }
  const halo = 1 - smoothstep(0, G.S * 3.5, near);
  return fieldDot(G, x, y, halo * 0.62, 1, x * 0.01);
}

/* ------------------------------------------------------------------ the scene */

function createScene(kind, { ctx, w, h }, seed, { zone, animate = false } = {}) {
  const rng = createRng(seed);
  const G = compose(kind, w, h, rng, { zone });
  const { S } = G;
  const dy = (S * Math.sqrt(3)) / 2;
  const rows = Math.floor((h - S * 0.5) / dy);
  const top = (h - (rows - 1) * dy) / 2;
  const reach = G.spiral ? Math.hypot(Math.max(G.cx, w - G.cx), Math.max(G.cy, h - G.cy)) : w;
  const grains = [];

  for (let row = 0; row < rows; row++) {
    const y = top + row * dy;
    for (let x = S / 2 + (row % 2) * (S / 2); x <= w - S / 2 + 0.01; x += S) {
      const c = classify(G, x, y, row, rows);
      if (!c) continue;
      const rho = G.spiral ? Math.hypot(x - G.cx, y - G.cy) : x;
      const grain = {
        tx: x, ty: y, x, y, vx: 0, vy: 0,
        r: c.r,
        role: c.role,
        level: c.level,
        phase: c.phase * 0.55 + (rho / S) * 0.08,
        breathe: G.mask(x, y),
        settled: true,
      };
      if (animate && grain.breathe > 0.02) {
        grain.settled = false;
        grain.riverT = rng.next();
        grain.lateral = rng.gauss(S * 2.2);
        grain.delay = 28 + (rho / reach) * 150 + rng.range(0, 36);
        const start = riverPoint(G, grain.riverT);
        grain.x = start.x + grain.lateral * 0.6;
        grain.y = start.y + grain.lateral * 0.6;
      }
      grains.push(grain);
    }
  }

  const byRole = Object.fromEntries(ROLES.map((role) => [role, grains.filter((grain) => grain.role === role)]));
  return {
    ctx, w, h, G, grains, byRole,
    sprouts: placeSprouts(G, grains, rng, { w, h, rows, dy, top }),
    clock: 0,
    acc: 0,
    time: 0,
    settledAt: animate ? -1 : 0,
  };
}

/** The eye's sprout first, then sprouts on the highest terraces, kept apart and inside the art. */
function placeSprouts(G, grains, rng, { w, h, rows, dy, top }) {
  const { S } = G;
  const sprouts = [];
  if (!G.spiral) {
    const base = G.bottom !== null ? top + (rows - 1 - (G.bottom + 4)) * dy : h - S;
    for (const rise of G.rises) {
      const stepTop = base - (rise.levels - 0.5) * dy;
      sprouts.push({ x: rise.x, y: stepTop, size: S * rng.range(1.7, 2.1), lean: rng.range(-0.12, 0.12) });
    }
    return sprouts;
  }
  if (G.sprouts === 0) return sprouts;
  sprouts.push({ x: G.cx, y: G.cy + G.eyeR * 0.62, size: G.eyeR * 1.02, lean: rng.range(-0.12, 0.12) });
  const margin = S * 3;
  const candidates = grains.filter((grain) => {
    if (grain.role !== 'dot' || grain.level < 0.6 || G.mask(grain.tx, grain.ty) < 0.9) return false;
    const rho = Math.hypot(grain.tx - G.cx, grain.ty - G.cy);
    const clearTop = G.top === null ? margin : top + (G.top + 9) * dy;
    const clearBottom = G.bottom === null ? h - margin : top + (rows - G.bottom - 7) * dy;
    return rho > G.eyeR * 2.4 && rho < G.rmax * 0.95 && grain.ty > clearTop && grain.ty < clearBottom
      && grain.tx > margin && grain.tx < w - margin && (!G.band || bandDistance(G.band, grain.tx, grain.ty) > S * 3);
  });
  for (let guard = 0; sprouts.length < G.sprouts && candidates.length && guard < 400; guard++) {
    const pick = rng.pick(candidates);
    if (sprouts.every((sprout) => Math.hypot(sprout.x - pick.tx, sprout.y - pick.ty) > S * 7)) {
      const out = Math.atan2(pick.ty - G.cy, pick.tx - G.cx) + HALF_PI;
      sprouts.push({ x: pick.tx, y: pick.ty, size: S * rng.range(1.8, 2.4), lean: clamp(Math.atan2(Math.sin(out), Math.cos(out)), -0.55, 0.55) });
    }
  }
  return sprouts;
}

/** One 60 Hz step of the gathering: waiting grains drift on the river, then spring home. */
function step(scene) {
  const { G } = scene;
  let unsettled = 0;
  for (const grain of scene.grains) {
    if (grain.settled) continue;
    unsettled += 1;
    const age = scene.clock - grain.delay;
    if (age < 0) {
      grain.riverT = (grain.riverT + 0.0012) % 1;
      const p = riverPoint(G, grain.riverT);
      grain.x = p.x + grain.lateral * 0.6;
      grain.y = p.y + grain.lateral * 0.6;
      continue;
    }
    const dx = grain.tx - grain.x;
    const dy = grain.ty - grain.y;
    const dist = Math.hypot(dx, dy);
    const k = 0.01 + 0.032 * Math.min(1, age / 70);
    const cx = grain.x - G.cx;
    const cy = grain.y - G.cy;
    const cd = Math.hypot(cx, cy) + 1;
    const swirl = 1.15 * G.dir * (dist / (dist + G.S * 4.5)) * (G.S / 20);
    grain.vx = (grain.vx + dx * k + (-cy / cd) * swirl) * 0.86;
    grain.vy = (grain.vy + dy * k + (cx / cd) * swirl) * 0.86;
    grain.x += grain.vx;
    grain.y += grain.vy;
    if (dist < 0.6 && Math.hypot(grain.vx, grain.vy) < 0.25) {
      grain.x = grain.tx;
      grain.y = grain.ty;
      grain.settled = true;
      unsettled -= 1;
    }
  }
  if (scene.settledAt < 0 && unsettled === 0) scene.settledAt = scene.clock;
  scene.clock += 1;
}

function advance(scene, ms) {
  scene.time += ms / 1000;
  scene.acc += ms;
  for (let n = 0; scene.acc >= STEP_MS && n < MAX_STEPS_PER_FRAME; n++) {
    step(scene);
    scene.acc -= STEP_MS;
  }
  scene.acc = Math.min(scene.acc, STEP_MS);
}

/* ------------------------------------------------------------------ drawing */

function leaf(ctx, length, width) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width, -length * 0.25, width * 0.9, -length * 0.85, 0, -length);
  ctx.bezierCurveTo(-width * 0.9, -length * 0.85, -width, -length * 0.25, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** A trefoil sprout on a thin stem with a smaller pair lower down, in kelly outlined in black. */
function drawSprout(ctx, sprout, growth, sway, S) {
  const size = sprout.size * growth;
  if (size < 0.5) return;
  ctx.save();
  ctx.translate(sprout.x, sprout.y);
  ctx.rotate(sprout.lean + sway);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK.edge;
  ctx.fillStyle = INK.accent;
  ctx.lineWidth = Math.max(1, S * 0.11) * Math.max(0.6, growth);
  const stem = size * 1.05;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.12, -stem * 0.35, -size * 0.1, -stem * 0.7, 0, -stem);
  ctx.stroke();
  ctx.save();
  ctx.translate(size * 0.02, -stem * 0.38);
  for (const angle of [-0.95, 0.95]) {
    ctx.save();
    ctx.rotate(angle);
    leaf(ctx, size * 0.42, size * 0.2);
    ctx.restore();
  }
  ctx.restore();
  ctx.translate(0, -stem);
  for (const angle of [-0.78, 0, 0.78]) {
    ctx.save();
    ctx.rotate(angle);
    leaf(ctx, size * 0.62, size * 0.27);
    ctx.restore();
  }
  ctx.restore();
}

/** Paints the field. breathing: the slow outward wave; growth: how far the sprouts have opened. */
function paintField(scene, { breathing = false, growth = 1 } = {}) {
  const { ctx, byRole, G, time } = scene;
  const travel = G.S * 7;
  for (const role of ROLES) {
    ctx.fillStyle = INK[role];
    ctx.beginPath();
    for (const grain of byRole[role]) {
      let { r } = grain;
      if (!grain.settled) r *= 0.35 + 0.65 * (1 - Math.min(1, Math.hypot(grain.tx - grain.x, grain.ty - grain.y) / travel));
      else if (breathing && grain.breathe) r *= 1 + 0.05 * grain.breathe * Math.sin(time * 1.15 - grain.phase);
      ctx.moveTo(grain.x + r, grain.y);
      ctx.arc(grain.x, grain.y, r, 0, TAU);
    }
    ctx.fill();
  }
  if (growth > 0) {
    for (const sprout of scene.sprouts) {
      drawSprout(ctx, sprout, growth, breathing ? Math.sin(time * 0.9 + sprout.x * 0.01) * 0.035 : 0, G.S);
    }
  }
}

function paintGround(scene) {
  scene.ctx.fillStyle = INK.ground;
  scene.ctx.fillRect(0, 0, scene.w, scene.h);
}

/* ------------------------------------------------------------------ public API */

const VARIANTS = new Set(['event', 'item', 'banner']);

/** A settled, static composition. variant: 'event' | 'item' | 'banner'. */
export function drawTile(canvas, { seed, variant = 'item' } = {}) {
  const box = fit(canvas);
  if (!box) return;
  const scene = createScene(VARIANTS.has(variant) ? variant : 'item', box, seed);
  paintGround(scene);
  paintField(scene);
}

/** The jagged outline of a pottery sherd in a size×size frame: a gently curved rim on top. */
function sherdOutline(rng, size) {
  const j = (v) => v + rng.range(-0.035, 0.035) * size;
  const rim = [];
  const lift = size * rng.range(0.03, 0.05);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    rim.push({ x: size * lerp(0.1, 0.9, t), y: size * 0.12 - Math.sin(t * Math.PI) * lift });
  }
  const broken = [
    { x: j(size * 0.95), y: j(size * 0.3) },
    { x: j(size * 0.86), y: j(size * 0.52) },
    { x: j(size * 0.96), y: j(size * 0.7) },
    { x: j(size * 0.74), y: j(size * 0.92) },
    { x: j(size * 0.5), y: j(size * 0.84) },
    { x: j(size * 0.27), y: j(size * 0.95) },
    { x: j(size * 0.06), y: j(size * 0.68) },
    { x: j(size * 0.12), y: j(size * 0.42) },
    { x: j(size * 0.05), y: j(size * 0.2) },
  ];
  return [...rim, ...broken];
}

function tracePath(ctx, points, dx = 0, dy = 0) {
  ctx.beginPath();
  points.forEach((point, i) => (i ? ctx.lineTo(point.x + dx, point.y + dy) : ctx.moveTo(point.x + dx, point.y + dy)));
  ctx.closePath();
}

/** The order keepsake: a settled mini-gathering on a sherd, on a transparent background. */
export function drawSherd(canvas, { seed } = {}) {
  const box = fit(canvas);
  if (!box) return;
  const { ctx, w, h } = box;
  const size = Math.min(w, h) * 0.86;
  const shape = createRng(mix32(seedNumber(seed) ^ 0x5eed));
  const outline = sherdOutline(shape, size);
  const tilt = shape.range(-0.14, 0.14);
  const scene = createScene('sherd', { ctx, w: size, h: size }, seed);
  const S = scene.G.S;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(tilt);
  ctx.translate(-size / 2, -size / 2);
  ctx.lineJoin = 'round';
  tracePath(ctx, outline, S * 0.3, S * 0.45);
  ctx.fillStyle = INK.edge;
  ctx.fill();
  tracePath(ctx, outline);
  ctx.save();
  ctx.clip();
  paintGround(scene);
  paintField(scene);
  ctx.restore();
  tracePath(ctx, outline);
  ctx.strokeStyle = INK.edge;
  ctx.lineWidth = S * 0.32;
  ctx.stroke();
  ctx.restore();
}

/**
 * The living hero: the dots gather from a river into the spiral, the sprouts open, then the field
 * breathes. safeZone keeps the headline area calm: 'left' (wide screens), 'top' (tall screens) or
 * 'auto'. Pauses offscreen and in hidden tabs; one static frame under reduced motion.
 * Returns { destroy }.
 */
export function mountHero(canvas, { seed, safeZone = 'auto' } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let scene = null;
  let played = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let resizeTimer = 0;
  let size = '';

  function build() {
    const box = fit(canvas);
    scene = null;
    if (!box) return;
    size = `${box.w}x${box.h}`;
    const zone = safeZone === 'auto' ? (box.w >= box.h * 1.05 ? 'left' : 'top') : safeZone;
    const animate = !played && !reduced.matches;
    scene = createScene('hero', box, seed, { zone, animate });
    played = true;
    paintGround(scene);
    paintField(scene, { growth: animate ? 0 : 1 });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS - 1) return;
    advance(scene, Math.min(now - last, 100));
    last = now;
    const growth = scene.settledAt < 0 ? 0 : easeOutCubic((scene.clock - scene.settledAt) / SPROUT_STEPS);
    paintGround(scene);
    paintField(scene, { breathing: scene.settledAt >= 0, growth });
  }

  function start() {
    if (raf || !scene || !visible || document.hidden || reduced.matches) return;
    last = performance.now() - FRAME_MS;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function rebuild() {
    stop();
    build();
    start();
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  const onMotion = () => rebuild();
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  });
  const resize = new ResizeObserver(() => {
    if (`${canvas.clientWidth}x${canvas.clientHeight}` === size) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, scene ? RESIZE_DEBOUNCE_MS : 0);
  });

  build();
  intersection.observe(canvas);
  resize.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', onMotion);
  start();

  return {
    destroy() {
      stop();
      clearTimeout(resizeTimer);
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onMotion);
      scene = null;
    },
  };
}
