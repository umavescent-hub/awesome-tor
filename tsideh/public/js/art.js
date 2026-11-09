/* Tsideh — generative art engine.
 *
 * One small visual grammar, read from the Tsideh mark and recomposed for every seed.
 *   Motifs        whorl (sprout heart, ink ring, interleaved silver crescents), feather end (ink
 *                 sawtooth and three sprout stripes), ray fringe, leaf trefoil sprout, stepped
 *                 terrace, medallion, register band.
 *   Compositions  item tile, event tile, banner frieze, sherd keepsake, animated hero.
 * Canvas 2D only, no dependencies, deterministic for a seed (mulberry32; never Math.random).
 */

export const PALETTE = Object.freeze({
  clay: '#c16742',
  ink: '#0a0806',
  silverLight: '#e6e3e1',
  silver: '#b7b2af',
  silverDark: '#8c8784',
  sprout: '#00b055',
  leaf: '#72c366',
  earth: '#623f32',
  bone: '#f7f1eb',
});

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const FRAME_MS = 1000 / 30;
const INTRO_MS = 1200;
const RESIZE_DEBOUNCE_MS = 120;
const REST = Object.freeze({ turn: 0, sway: 0, time: null });

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

function createRng(seed) {
  let a = mix32((typeof seed === 'string' ? seedFrom(seed) : Number(seed) >>> 0) ^ 0x9e3779b9);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted(table) {
      let x = next() * table.reduce((sum, [, weight]) => sum + weight, 0);
      for (const [value, weight] of table) {
        x -= weight;
        if (x < 0) return value;
      }
      return table[table.length - 1][0];
    },
  };
}

/* ----------------------------------------------------------------- canvas */

function fitCanvas(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!(w > 0 && h > 0)) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

/** One brush per composition: outline, thick band and clay gap scale together. */
function brush(unit, ratio) {
  const lw = Math.max(1.5, unit * ratio);
  return { lw, band: lw * 2.2, gap: lw * 1.5 };
}

function ground(ctx, w, h) {
  ctx.fillStyle = PALETTE.clay;
  ctx.fillRect(0, 0, w, h);
}

function metal(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, PALETTE.silverLight);
  g.addColorStop(0.45, PALETTE.silver);
  g.addColorStop(1, PALETTE.silverDark);
  return g;
}

function ink(ctx, width, style = PALETTE.ink) {
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
}

function fillWith(ctx, style) {
  ctx.fillStyle = style;
  ctx.fill();
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Paint `draw` on the left half, then mirrored on the right half: exact bilateral symmetry. */
function bilateral(ctx, w, h, draw) {
  for (const side of [0, 1]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(side * (w / 2), 0, w / 2, h);
    ctx.clip();
    if (side) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    draw();
    ctx.restore();
  }
}

/* ----------------------------------------------------------------- motifs */

/** Rounded leaf: a point at (x, y) opening into a round tip `len` away along `angle`. */
function leafPath(ctx, x, y, angle, len) {
  const rr = len * 0.38;
  const d = len - rr;
  const phi = Math.asin(rr / d);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(d, 0, rr, -HALF_PI - phi, HALF_PI + phi);
  ctx.closePath();
  ctx.restore();
}

function trefoil(ctx, S, x, y, angle, len) {
  ctx.lineJoin = 'round';
  for (const k of [-1, 1, 0]) {
    leafPath(ctx, x, y, angle + k * 1.0, len);
    fillWith(ctx, PALETTE.leaf);
    ink(ctx, S.lw * 0.8);
  }
}

/** Leaf trefoil on a thin stem standing on (x, y), `h` tall leaves included; `twin` adds a
 *  smaller trefoil on a branch from the lower stem. */
function sprout(ctx, S, x, y, h, sway = 0, twin = false) {
  const width = Math.max(1.2, S.lw * 0.8);
  const stem = h * 0.64;
  const tipX = x + Math.sin(sway) * stem;
  const tipY = y - Math.cos(sway) * stem;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + stem * 0.1 + Math.sin(sway) * stem * 0.45, y - stem * 0.5, tipX, tipY);
  ink(ctx, width);
  if (twin) {
    const bx = x + stem * 0.05 + Math.sin(sway) * stem * 0.24;
    const by = y - stem * 0.34;
    const ex = bx + h * 0.16;
    const ey = by - h * 0.05;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + h * 0.08, by + h * 0.015, ex, ey);
    ink(ctx, width);
    trefoil(ctx, S, ex, ey, -0.4 + sway * 0.6, h * 0.2);
  }
  trefoil(ctx, S, tipX, tipY, -HALF_PI + sway, h * 0.36);
}

/** Serrated ink rays standing on the circle (cx, cy, r) from angle a0 across `span`. */
function rayRing(ctx, cx, cy, r, h, a0, span, n, lean) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = a0 + (span * i) / n;
    const b = a0 + (span * (i + 1)) / n;
    const t = a + (b - a) * (0.5 + lean);
    ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.lineTo(cx + (r + h) * Math.cos(t), cy + (r + h) * Math.sin(t));
    ctx.lineTo(cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  ctx.lineJoin = 'miter';
  fillWith(ctx, PALETTE.ink);
}

/** Stepped terrace: a pyramid of `steps` levels on a base centred at (x, y); hangs when `down`. */
function terracePath(ctx, x, y, w, h, steps, down) {
  const sy = down ? 1 : -1;
  const sh = h / steps;
  const inset = steps > 1 ? (w * (0.12 + 0.07 * steps)) / (steps - 1) : 0;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  for (let i = 0; i < steps; i++) {
    const xl = x - w / 2 + i * inset;
    ctx.lineTo(xl, y + sy * i * sh);
    ctx.lineTo(xl, y + sy * (i + 1) * sh);
  }
  for (let i = steps - 1; i >= 0; i--) {
    const xr = x + w / 2 - i * inset;
    ctx.lineTo(xr, y + sy * (i + 1) * sh);
    ctx.lineTo(xr, y + sy * i * sh);
  }
  ctx.closePath();
}

function silverTerrace(ctx, S, x, y, w, h, down, steps = 0) {
  const levels =
    steps || Math.max(2, Math.min(4, Math.round(2 + (3 * h) / w), Math.floor(h / (S.lw * 2.2))));
  terracePath(ctx, x, y, w, h, levels, down);
  fillWith(ctx, metal(ctx, x - w / 2, down ? y : y - h, x + w / 2, down ? y + h : y));
  ctx.lineJoin = 'miter';
  ink(ctx, S.lw);
}

function inkTriangle(ctx, x, y, w, h, down) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x, y + (down ? h : -h));
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.lineJoin = 'miter';
  fillWith(ctx, PALETTE.ink);
}

/** Pottery register: a thick band on `y` and a thin companion line toward `inward`.
 *  Returns the y of the register's inner edge. */
function register(ctx, S, x0, x1, y, inward, style = PALETTE.ink) {
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ink(ctx, S.band, style);
  const y2 = y + inward * (S.band / 2 + S.gap + S.lw / 2);
  ctx.beginPath();
  ctx.moveTo(x0, y2);
  ctx.lineTo(x1, y2);
  ink(ctx, S.lw, style);
  return y2 + (inward * S.lw) / 2;
}

const STRIPE = 0.22;

/** Clay gap above the first of three stripes in a band `th` tall. */
function stripeGap(th) {
  return (th * (1 - 3 * STRIPE)) / 4;
}

/** Three sprout stripes in a horizontal band from x0 to x1, top edge at y, total height `th`.
 *  Returns the y of the first stripe's top edge. */
function stripeBand(ctx, S, x0, x1, y, th) {
  const bar = th * STRIPE;
  const gap = stripeGap(th);
  ctx.lineJoin = 'miter';
  for (let j = 0; j < 3; j++) {
    ctx.beginPath();
    ctx.rect(x0, y + gap + j * (bar + gap), x1 - x0, bar);
    fillWith(ctx, PALETTE.sprout);
    ink(ctx, S.lw * 0.7);
  }
  return y + gap;
}

/** Medallion: clay disk in an ink ring with a sprout (or a seed eye), optionally rayed. */
function medallion(ctx, S, cx, cy, r, { rays = 0, twin = false } = {}) {
  if (rays) rayRing(ctx, cx, cy, r, r * 0.34, -HALF_PI, TAU, rays, 0.3);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  fillWith(ctx, PALETTE.clay);
  ink(ctx, S.band);
  const inner = r - S.band / 2 - S.gap - S.lw / 2;
  if (inner > S.lw * 6) {
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, TAU);
    ink(ctx, S.lw);
  }
  if (inner > S.lw * 7) {
    sprout(ctx, S, cx - inner * 0.05, cy + inner * 0.64, inner * 1.56, 0, twin);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(S.lw, r * 0.24), 0, TAU);
    fillWith(ctx, PALETTE.ink);
  }
}

/* ------------------------------------------------------------- obstacles */

/** Free room from `y` heading `dir` (1 down, -1 up) before circle `o`, within [xa, xb]. */
function clearance(o, xa, xb, y, dir) {
  const dx = Math.min(Math.max(o.cx, xa), xb) - o.cx;
  if (Math.abs(dx) >= o.r) return Infinity;
  const edge = o.cy - dir * Math.sqrt(o.r * o.r - dx * dx);
  return Math.max(0, (edge - y) * dir);
}

/** A rhythm of ink triangles or silver terraces hung from (dir 1) or raised on (dir -1) a
 *  register line. A form that would come within a clay gap of an obstacle circle is left out,
 *  so every form keeps its full size. */
function row(ctx, S, { xs, y, dir, width, height, kind, obstacles = [], steps = 0 }) {
  const down = dir > 0;
  xs.forEach((x, i) => {
    const k = kind(i);
    const clear = obstacles.every(
      (o) => clearance(o, x - width / 2, x + width / 2, y, dir) >= height + S.gap * 2,
    );
    if (!k || !clear) return;
    if (k === 'triangle') inkTriangle(ctx, x, y, width, height, down);
    else silverTerrace(ctx, S, x, y, width, height, down, steps);
  });
}

/** Evenly spaced cell centres across [x0, x1], about `unit` apart; an odd count when asked,
 *  so a mirrored rhythm has a true centre. */
function spaced(x0, x1, unit, odd = false) {
  const count = Math.max(1, Math.round((x1 - x0) / unit));
  const n = odd && count % 2 === 0 ? count + 1 : count;
  const step = (x1 - x0) / n;
  return { step, xs: Array.from({ length: n }, (_, i) => x0 + (i + 0.5) * step) };
}

/* ------------------------------------------------------------------ whorl */

/**
 * Plan a whorl of radius R about the origin: a sprout heart in an ink ring, wrapped by `count`
 * interleaved silver crescents that spiral in from a square end to a tip tucked under the ring.
 * opts: count, dir (+1 clockwise), base (angle of the first square end), tails (feather tail
 * length per blade from its square end, 0 for none), rays (indices of rayed blades), fine (room
 * for small detail).
 */
function planWhorl(rng, S, R, { count, dir, base, tails, rays, fine }) {
  const ring = Math.max(S.lw * 1.5, Math.min(S.band, R * 0.085));
  const heartR = R * 0.35;
  const ri = heartR + ring + R * 0.06;
  const W = R * 0.92 - ri;
  const sector = TAU / count;
  const span = count === 1 ? rng.range(1.2, 1.4) * Math.PI : sector * rng.range(0.84, 0.92);
  const blades = Array.from({ length: count }, (_, i) => ({
    a0: base + dir * i * sector,
    span,
    dir,
    ri,
    W,
    curl: ri - heartR - ring / 2,
    saw: W * 0.17,
    stripes: Math.max(0, (tails[i] || 0) - W * 0.17),
    window: fine && W > 20,
    rays: rays.includes(i) ? { t0: 0.04, t1: 0.66, n: fine ? 7 : 5, h: R * 0.2, lean: 0.28 } : null,
  }));
  const body = R * 0.92 + (rays.length ? R * 0.2 : 0) + S.lw;
  let reach = body;
  for (const b of blades) {
    if (b.stripes) reach = Math.max(reach, Math.hypot(ri + W, b.saw + b.stripes) + S.lw);
  }
  return { dir, ring, heartR, blades, body, reach, twin: fine && heartR > 34 };
}

function bladeGeometry(b, t) {
  return { r: b.ri - b.curl * t ** 1.5, w: b.W * (1 - t ** 1.8) };
}

function bladeEdges(b, cx, cy, a0) {
  const steps = Math.max(24, Math.ceil(b.span * 24));
  const inner = [];
  const outer = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + b.dir * b.span * t;
    const { r, w } = bladeGeometry(b, t);
    const c = Math.cos(a);
    const s = Math.sin(a);
    inner.push([cx + r * c, cy + r * s]);
    outer.push([cx + (r + w) * c, cy + (r + w) * s]);
  }
  return { inner, outer };
}

function bladeRays(ctx, b, cx, cy, a0, time) {
  const { t0, t1, n, h, lean } = b.rays;
  const at = (t, lift) => {
    const a = a0 + b.dir * b.span * t;
    const { r, w } = bladeGeometry(b, t);
    return [cx + (r + w + lift) * Math.cos(a), cy + (r + w + lift) * Math.sin(a)];
  };
  const sink = -b.W * 0.15;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ta = t0 + ((t1 - t0) * i) / n;
    const tb = t0 + ((t1 - t0) * (i + 1)) / n;
    const fade = 1 - 0.5 * (i / n) ** 1.5;
    const breathe = time === null ? 1 : 1 + 0.14 * Math.sin(time * 1.4 - i * 0.7);
    ctx.moveTo(...at(ta, sink));
    ctx.lineTo(...at(ta + (tb - ta) * (0.5 + lean), h * fade * breathe));
    ctx.lineTo(...at(tb, sink));
  }
  ctx.lineJoin = 'miter';
  fillWith(ctx, PALETTE.ink);
}

/** Feather tail in a local frame: x runs away from the blade, y crosses its width [0, W].
 *  An ink sawtooth column `saw` wide, then three sprout stripes `length` long. */
function featherTail(ctx, S, W, saw, length) {
  stripeBand(ctx, S, saw, saw + length, 0, W);
  const teeth = W > 36 ? 4 : 3;
  const tooth = W / teeth;
  ctx.beginPath();
  for (let j = 0; j < teeth; j++) {
    ctx.moveTo(0, j * tooth);
    ctx.lineTo(saw, (j + 0.5) * tooth);
    ctx.lineTo(0, (j + 1) * tooth);
  }
  fillWith(ctx, PALETTE.ink);
  ctx.beginPath();
  ctx.rect(0, 0, saw, W);
  ink(ctx, S.lw * 0.8);
}

/** The tail leaves a whorl blade's square end tangentially, against the sweep. */
function featherEnd(ctx, S, b, cx, cy, a0) {
  const c = Math.cos(a0);
  const s = Math.sin(a0);
  ctx.save();
  ctx.transform(b.dir * s, -b.dir * c, c, s, cx + b.ri * c, cy + b.ri * s);
  featherTail(ctx, S, b.W, b.saw, b.stripes);
  ctx.restore();
}

/** Window: a small clay rectangle outlined in ink, set into a silver form. */
function windowAt(ctx, S, x, y, angle, w, h) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.restore();
  fillWith(ctx, PALETTE.clay);
  ctx.lineJoin = 'miter';
  ink(ctx, S.lw);
}

/** Extent of everything a whorl paints, relative to its centre. */
function whorlBounds(wh) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x, y) => {
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  };
  const core = wh.heartR + wh.ring;
  add(-core, -core);
  add(core, core);
  for (const b of wh.blades) {
    for (const [x, y] of bladeEdges(b, 0, 0, b.a0).outer) add(x, y);
    if (b.rays) {
      const { t0, t1, n, h } = b.rays;
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        const a = b.a0 + b.dir * b.span * t;
        const { r, w } = bladeGeometry(b, t);
        add((r + w + h) * Math.cos(a), (r + w + h) * Math.sin(a));
      }
    }
    if (b.stripes) {
      const c = Math.cos(b.a0);
      const s = Math.sin(b.a0);
      for (const x of [0, b.saw + b.stripes]) {
        for (const y of [0, b.W]) add(b.dir * s * x + c * (y + b.ri), -b.dir * c * x + s * (y + b.ri));
      }
    }
  }
  return box;
}

function bladeBody(ctx, S, b, cx, cy, a0) {
  const { inner, outer } = bladeEdges(b, cx, cy, a0);
  ctx.beginPath();
  ctx.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i][0], outer[i][1]);
  for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
  ctx.closePath();
  const shade = inner[Math.round(inner.length * 0.55)];
  fillWith(ctx, metal(ctx, outer[0][0], outer[0][1], shade[0], shade[1]));
  ctx.lineJoin = 'round';
  ink(ctx, S.lw);
  if (!b.window) return;
  const t = 0.22;
  const a = a0 + b.dir * b.span * t;
  const { r, w } = bladeGeometry(b, t);
  const mid = r + w / 2;
  windowAt(ctx, S, cx + mid * Math.cos(a), cy + mid * Math.sin(a), a + HALF_PI, b.W * 0.38, b.W * 0.26);
}

/** motion: { turn (radians), sway (sprout lean), time (seconds, or null for a still frame) } */
function drawWhorl(ctx, S, wh, cx, cy, motion = REST) {
  const a0 = (b) => b.a0 + motion.turn;
  for (const b of wh.blades) if (b.rays) bladeRays(ctx, b, cx, cy, a0(b), motion.time);
  for (const b of wh.blades) if (b.stripes) featherEnd(ctx, S, b, cx, cy, a0(b));
  for (const b of wh.blades) bladeBody(ctx, S, b, cx, cy, a0(b));
  ctx.beginPath();
  ctx.arc(cx, cy, wh.heartR + wh.ring / 2, 0, TAU);
  fillWith(ctx, PALETTE.clay);
  ink(ctx, wh.ring);
  const r = wh.heartR;
  if (r >= 11) {
    sprout(ctx, S, cx - r * 0.05, cy + r * 0.66, r * 1.6, motion.sway, wh.twin);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, TAU);
    fillWith(ctx, PALETTE.ink);
  }
}

/* ----------------------------------------------------------- compositions */

function paintItem(ctx, rng, w, h) {
  const m = Math.min(w, h);
  const S = brush(m, 0.016);
  const fine = m >= 150;
  ground(ctx, w, h);
  const kind = rng.weighted([['whorl', 4], ['pinwheel', 2], ['terrace', 2], ['medallion', 2]]);

  if (kind === 'whorl' || kind === 'pinwheel') {
    const pin = kind === 'pinwheel';
    const count = pin ? rng.pick([3, 4]) : rng.weighted([[2, 3], [1, 1]]);
    const opts = {
      count,
      dir: rng.pick([1, -1]),
      base: rng.range(0, TAU),
      rays: !pin && rng.chance(0.6) ? [0] : [],
      fine,
    };
    const tail = pin ? 0 : rng.range(0.5, 0.66);
    const sub = rng.int(0, 0x7fffffff);
    const plan = (R) =>
      planWhorl(createRng(sub), S, R, { ...opts, tails: Array(count).fill(R * tail) });
    // Fit the whole whorl — tails and rays included — inside the tile, then centre its mass.
    const R0 = m * (pin ? 0.42 : 0.38);
    let wh = plan(R0);
    let box = whorlBounds(wh);
    const fit = Math.min(1, (w * 0.86) / (box.x1 - box.x0), (h * 0.86) / (box.y1 - box.y0));
    if (fit < 1) {
      wh = plan(R0 * fit);
      box = whorlBounds(wh);
    }
    drawWhorl(ctx, S, wh, w / 2 - (box.x0 + box.x1) / 2, h / 2 - (box.y0 + box.y1) / 2);
    return;
  }

  if (kind === 'terrace') {
    const inset = S.lw * 2 + S.band / 2;
    const top = register(ctx, S, 0, w, inset, 1);
    const bottom = register(ctx, S, 0, w, h - inset, -1);
    const field = bottom - top;
    const tw = w * rng.range(0.52, 0.62);
    const th = field * rng.range(0.28, 0.34);
    silverTerrace(ctx, S, w / 2, bottom, tw, th, false);
    const corner = w * 0.2;
    for (const x of [corner / 2, w - corner / 2]) {
      inkTriangle(ctx, x, top, corner * 0.82, field * 0.16, true);
    }
    sprout(ctx, S, w / 2, bottom - th, (field - th) * 0.82, 0, fine);
    return;
  }

  medallion(ctx, S, w / 2, h / 2, m * 0.27, { rays: fine ? 12 : 10, twin: fine });
}

function paintEvent(ctx, rng, w, h) {
  const S = brush(Math.min(w, h), 0.016);
  const fine = Math.min(w, h) >= 150;
  ground(ctx, w, h);
  const inset = S.lw * 2 + S.band / 2;
  const top = register(ctx, S, 0, w, inset, 1);
  const bottom = register(ctx, S, 0, w, h - inset, -1);
  const fh = bottom - top;
  const mode = rng.weighted([['single', 5], ['twin', 2], ['center', 2]]);
  const fringeKind = rng.pick(['triangle', 'terrace']);
  const fringeH = fh * (fringeKind === 'terrace' ? rng.range(0.13, 0.15) : rng.range(0.1, 0.13));
  const fringeW = fringeH * (fringeKind === 'terrace' ? 2.2 : 1.3);
  const fringe = (x0, x1, obstacles) =>
    row(ctx, S, {
      xs: spaced(x0, x1, fringeW * 1.9).xs,
      y: top,
      dir: 1,
      width: fringeW,
      height: fringeH,
      kind: () => fringeKind,
      obstacles,
      steps: 3,
    });

  if (mode === 'center') {
    // A pinwheel set in a ring, the planted furrow passing behind it; mirror-symmetric field.
    const R = Math.min(fh * 0.38, w * 0.2);
    const wh = planWhorl(rng, S, R, {
      count: rng.pick([3, 4]),
      dir: rng.pick([1, -1]),
      base: rng.range(0, TAU),
      tails: [],
      rays: [],
      fine,
    });
    const cx = w / 2;
    const cy = top + fh / 2;
    const ringR = wh.reach + S.gap;
    const band = fh * 0.2;
    const furrow = stripeBand(ctx, S, -S.lw, w + S.lw, cy + R * 0.3, band);
    const keep = { cx, cy, r: ringR + S.lw + S.gap };
    const room = furrow - top - fringeH - S.gap * 3;
    bilateral(ctx, w, h, () => {
      fringe(0, w / 2, [keep]);
      const lane = cx - keep.r;
      sprout(ctx, S, lane * rng.range(0.42, 0.58), furrow, room * rng.range(0.7, 0.9), 0, fine);
    });
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, TAU);
    fillWith(ctx, PALETTE.clay);
    ink(ctx, S.lw);
    drawWhorl(ctx, S, wh, cx, cy);
    return;
  }

  // single / twin: a whorl whose lower feather runs out across the card as a planted furrow.
  const twin = mode === 'twin';
  const bleed = S.lw * 4;
  const R = Math.min(fh * 0.4, w * (twin ? 0.15 : 0.2));
  const cx = Math.max(R * 1.3, w * (twin ? 0.2 : 0.23));
  const cy = top + fh * 0.46;
  const wh = planWhorl(rng, S, R, {
    count: 2,
    dir: 1,
    base: HALF_PI,
    tails: [(twin ? w / 2 : w) + bleed - cx, cx + bleed],
    rays: rng.chance(0.5) ? [0] : [],
    fine,
  });
  const furrow = cy + wh.blades[0].ri + stripeGap(wh.blades[0].W);
  const keep = { cx, cy, r: wh.body + S.gap };
  const room = furrow - top - fringeH - S.gap * 3;
  const paintHalf = () => {
    fringe(cx + R * 0.7, twin ? w / 2 : w, [keep]);
    drawWhorl(ctx, S, wh, cx, cy);
  };
  if (twin) {
    bilateral(ctx, w, h, paintHalf);
    sprout(ctx, S, w / 2, furrow, room * 0.94, 0, fine);
    return;
  }
  ctx.save();
  if (rng.chance(0.5)) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  paintHalf();
  // One to three sprouts stand on the furrow in the open lane beside the whorl.
  const from = cx + wh.body;
  const lane = spaced(from, w - R * 0.3, (w - R * 0.3 - from) / rng.int(1, 3));
  for (const x of lane.xs) {
    const sh = room * rng.range(0.62, 0.92);
    sprout(ctx, S, x + rng.range(-0.15, 0.15) * R, furrow, sh, 0, fine && sh > R * 0.9);
  }
  ctx.restore();
}

/** Horizontal feather centred on (x, y): tail, sawtooth, then a blade tapering to a point. */
function feather(ctx, S, x, y, len, thick, dir, fine) {
  const tail = len * 0.34;
  const saw = thick * 0.17;
  const blade = len - tail - saw;
  ctx.save();
  ctx.transform(dir, 0, 0, 1, x - (dir * len) / 2 + dir * (tail + saw), y - thick / 2);
  ctx.save();
  ctx.scale(-1, 1);
  featherTail(ctx, S, thick, saw, tail);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(blade * 0.55, 0, blade * 0.86, thick * 0.3, blade, thick * 0.62);
  ctx.bezierCurveTo(blade * 0.74, thick * 0.94, blade * 0.38, thick, 0, thick);
  ctx.closePath();
  fillWith(ctx, metal(ctx, 0, 0, blade, thick));
  ctx.lineJoin = 'round';
  ink(ctx, S.lw);
  if (fine && thick > 20) windowAt(ctx, S, blade * 0.24, thick / 2, 0, thick * 0.38, thick * 0.26);
  ctx.restore();
}

function paintBanner(ctx, rng, w, h) {
  const S = brush(h, 0.02);
  ground(ctx, w, h);
  const inset = S.lw + S.band / 2;
  const top = register(ctx, S, 0, w, inset, 1);
  const bottom = register(ctx, S, 0, w, h - inset, -1);
  const fh = bottom - top;
  if (fh < S.lw * 8) return;
  const fine = fh >= 90;
  const mid = (top + bottom) / 2;
  const mirrored = rng.chance(0.6);
  const kind = rng.weighted([['terraces', 3], ['furrow', 3], ['feathers', 2]]);

  if (kind === 'terraces') {
    // Interlocking terraces: raised between the cells, hung from the cell edges, with a
    // medallion standing in for every few raised terraces.
    const { step, xs } = spaced(0, w, fh * rng.range(1.2, 1.5), mirrored);
    const centre = (xs.length - 1) / 2;
    const every = rng.pick([3, 4, 5]);
    const phase = mirrored ? 0 : rng.int(0, every - 1);
    const isMedallion = (i) => ((mirrored ? Math.abs(i - centre) : i) + phase) % every === 0;
    const r = fh * 0.36;
    const keeps = xs
      .filter((_, i) => isMedallion(i))
      .map((x) => ({ cx: x, cy: mid, r: r + S.gap }));
    const hangKind = rng.pick(['triangle', 'terrace']);
    const tall = fh * 0.56;
    row(ctx, S, {
      xs: Array.from({ length: xs.length + 1 }, (_, i) => i * step),
      y: top,
      dir: 1,
      width: step * (hangKind === 'terrace' ? 0.6 : 0.44),
      height: tall,
      kind: () => hangKind,
      obstacles: keeps,
    });
    row(ctx, S, {
      xs,
      y: bottom,
      dir: -1,
      width: step * 0.6,
      height: tall,
      kind: (i) => (isMedallion(i) ? null : 'terrace'),
    });
    for (const k of keeps) medallion(ctx, S, k.cx, k.cy, r, { twin: fine });
    return;
  }

  if (kind === 'furrow') {
    // A planted furrow: three stripes the full width with sprouts rising in a seeded rhythm.
    const band = fh * rng.range(0.2, 0.26);
    const furrow = stripeBand(ctx, S, -S.lw, w + S.lw, bottom - S.gap * 2 - band, band);
    const fringeKind = rng.pick(['triangle', 'terrace', null]);
    const fringeH = fringeKind ? fh * 0.15 : 0;
    if (fringeKind) {
      const fw = fringeH * (fringeKind === 'terrace' ? 2.2 : 1.3);
      row(ctx, S, {
        xs: spaced(0, w, fw * 1.7).xs,
        y: top,
        dir: 1,
        width: fw,
        height: fringeH,
        kind: () => fringeKind,
      });
    }
    const rhythm = rng.pick([[1, 0.6], [1], [0.66, 1, 0.66], [1, 0.5, 0.78, 0.5]]);
    const { xs } = spaced(0, w, fh * rng.range(1.1, 1.7), mirrored);
    const centre = (xs.length - 1) / 2;
    const room = furrow - top - fringeH - S.gap * 3;
    xs.forEach((x, i) => {
      const sh = room * rhythm[(mirrored ? Math.abs(i - centre) : i) % rhythm.length];
      sprout(ctx, S, x, furrow, sh, 0, fine && sh > room * 0.8);
    });
    return;
  }

  // A procession of feathers between medallions; mirrored processions meet at the centre.
  const { step, xs } = spaced(0, w, fh * rng.range(1.7, 2.1), true);
  const centre = (xs.length - 1) / 2;
  const thick = fh * 0.42;
  xs.forEach((x, i) => {
    const k = mirrored ? Math.abs(i - centre) : i;
    if (k % 2 === 0) medallion(ctx, S, x, mid, fh * 0.3);
    else feather(ctx, S, x, mid, step * 0.92, thick, mirrored && x > w / 2 ? -1 : 1, fine);
  });
}

/* ------------------------------------------------------------------ sherd */

function circleThrough(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx: x, cy: y, r: Math.hypot(a[0] - x, a[1] - y) };
}

function paintSherd(ctx, rng, w, h) {
  const m = Math.min(w, h);
  const S = brush(m, 0.014);
  const R = m * 0.43;
  const depth = S.lw * 2;
  const tilt = rng.range(-0.32, 0.32);

  // Local frame: the sherd centred on the origin, its rim arcing across the top.
  const left = [-R * rng.range(0.82, 0.95), -R * rng.range(0.5, 0.66)];
  const right = [R * rng.range(0.82, 0.95), -R * rng.range(0.5, 0.66)];
  const apex = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2 - R * rng.range(0.14, 0.2)];
  const rim = circleThrough(left, apex, right);
  const aFrom = Math.atan2(right[1], right[0]);
  const aTo = Math.atan2(left[1], left[0]) + TAU;
  const breaks = rng.int(4, 6);
  const vertices = [right];
  for (let i = 1; i <= breaks; i++) {
    const a = aFrom + ((aTo - aFrom) * (i + rng.range(-0.28, 0.28))) / (breaks + 1);
    const r = R * rng.range(0.78, 1.04);
    vertices.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  vertices.push(left);
  const bends = vertices.map(() => rng.range(-0.08, 0.08));
  const place = (dx, dy) => {
    ctx.translate(w / 2 + dx - depth * 0.3, h / 2 + dy - depth * 0.4);
    ctx.rotate(tilt);
  };
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(left[0], left[1]);
    ctx.arc(rim.cx, rim.cy, rim.r, Math.atan2(left[1] - rim.cy, left[0] - rim.cx),
      Math.atan2(right[1] - rim.cy, right[0] - rim.cx));
    for (let i = 1; i < vertices.length; i++) {
      const [x0, y0] = vertices[i - 1];
      const [x1, y1] = vertices[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const bend = len * bends[i];
      const qx = (x0 + x1) / 2 - ((y1 - y0) / len) * bend;
      const qy = (y0 + y1) / 2 + ((x1 - x0) / len) * bend;
      ctx.quadraticCurveTo(qx, qy, x1, y1);
    }
    ctx.closePath();
  };

  // The broken edge shows the fired body beneath the painted face.
  ctx.save();
  place(depth * 0.55, depth);
  outline();
  ctx.restore();
  fillWith(ctx, PALETTE.earth);
  ctx.lineJoin = 'round';
  ink(ctx, S.lw);

  ctx.save();
  place(0, 0);
  outline();
  fillWith(ctx, PALETTE.clay);
  ctx.save();
  ctx.clip();

  // Painted rim band, a register of hanging forms, then a fragment of a whorl below.
  const ringAt = (r, width) => {
    ctx.beginPath();
    ctx.arc(rim.cx, rim.cy, r, 0, TAU);
    ink(ctx, width);
  };
  const rBand = rim.r - S.band / 2 - S.lw;
  ringAt(rBand, S.band);
  const rThin = rBand - S.band / 2 - S.gap - S.lw / 2;
  ringAt(rThin, S.lw);
  const hangH = R * rng.range(0.16, 0.2);
  const rLow = rThin - hangH - S.gap * 2.4;
  ringAt(rLow, S.lw);
  const arcStep = (R * rng.range(0.44, 0.54)) / rim.r;
  const hangKind = rng.pick(['terrace', 'triangle']);
  for (let i = -4; i <= 4; i++) {
    const a = -HALF_PI + (i + 0.5) * arcStep;
    const ew = arcStep * rThin * (hangKind === 'terrace' ? 0.66 : 0.5);
    ctx.save();
    ctx.translate(rim.cx + (rThin - S.lw / 2) * Math.cos(a), rim.cy + (rThin - S.lw / 2) * Math.sin(a));
    ctx.rotate(a + HALF_PI);
    if (hangKind === 'terrace') silverTerrace(ctx, S, 0, 0, ew, hangH, true, 3);
    else inkTriangle(ctx, 0, 0, ew, hangH, true);
    ctx.restore();
  }
  const wr = R * rng.range(0.5, 0.6);
  const count = rng.pick([1, 2]);
  const wh = planWhorl(rng, S, wr, {
    count,
    dir: rng.pick([1, -1]),
    base: rng.range(0, TAU),
    tails: Array(count).fill(wr * rng.range(0.6, 0.9)),
    rays: rng.chance(0.6) ? [0] : [],
    fine: m >= 120,
  });
  const shoulder = rim.cy - rLow + S.gap * 2;
  drawWhorl(ctx, S, wh, R * rng.range(-0.3, 0.3), shoulder + wh.body * rng.range(0.86, 0.96));

  // Fired-clay grain.
  ctx.fillStyle = PALETTE.earth;
  ctx.globalAlpha = 0.16;
  const grains = Math.round((R * R) / 80);
  for (let i = 0; i < grains; i++) {
    const a = rng.range(0, TAU);
    const r = R * 1.05 * Math.sqrt(rng.range(0, 1));
    ctx.beginPath();
    ctx.arc(r * Math.cos(a), r * Math.sin(a), S.lw * rng.range(0.2, 0.55), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  outline();
  ctx.lineJoin = 'round';
  ink(ctx, S.lw * 1.2);
  ctx.restore();
}

/* ------------------------------------------------------------------- hero */

/** Hero layout: a whorl inside a bowl-rim ring, placed away from the headline zone. */
function planHero(rng, w, h, zone) {
  const wide = zone === 'left';
  const R = wide ? Math.min(h * 0.29, w * 0.18) : Math.min(w * 0.34, h * 0.2);
  const S = brush(R, 0.036);
  const whorl = planWhorl(rng, S, R, {
    count: 2,
    dir: rng.pick([1, -1]),
    base: rng.range(0, TAU),
    tails: [R * rng.range(0.56, 0.66), R * rng.range(0.56, 0.66)],
    rays: [0],
    fine: true,
  });
  const rim = whorl.reach + S.gap + S.band / 2;
  const outer = rim + S.band / 2 + S.gap + S.lw;
  const inset = S.lw * 1.6 + S.band / 2;
  const cx = wide ? w - outer - R * 0.12 : w / 2;
  const cy = wide ? h / 2 : h - inset - outer - S.band - R * 0.1;
  const reveal = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  return { zone, S, R, cx, cy, whorl, rim, outer, inset, reveal };
}

function paintHeroGround(ctx, plan, w, h) {
  const { S, R, cx, cy, rim, outer, inset, zone } = plan;
  ground(ctx, w, h);

  // Faint ripples spread from the bowl across the calm zone, fading as they travel.
  const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  const stepR = S.band * 3.2;
  ctx.lineWidth = S.lw * 0.6;
  ctx.strokeStyle = PALETTE.earth;
  for (let r = outer + stepR; r < far; r += stepR) {
    ctx.globalAlpha = 0.17 * (1 - (r - outer) / (far - outer)) ** 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const obstacles = [{ cx, cy, r: outer + S.gap }];
  const fringeH = R * 0.15;
  const terraceH = R * 0.2;
  const terraces = (x0, bottom) => {
    const { xs } = spaced(x0, w, terraceH * 3.2);
    row(ctx, S, {
      xs,
      y: bottom,
      dir: -1,
      width: terraceH * 2.3,
      height: terraceH,
      kind: () => 'terrace',
      obstacles,
      steps: 3,
    });
  };
  if (zone === 'left') {
    // Registers emerge from the clay toward the art side; the headline side stays open.
    const calmEdge = Math.max(0, cx - outer);
    const fade = ctx.createLinearGradient(calmEdge * 0.3, 0, calmEdge, 0);
    fade.addColorStop(0, 'rgba(10, 8, 6, 0)');
    fade.addColorStop(1, PALETTE.ink);
    const top = register(ctx, S, 0, w, inset, 1, fade);
    const bottom = register(ctx, S, 0, w, h - inset, -1, fade);
    row(ctx, S, {
      xs: spaced(calmEdge, w, fringeH * 2.4).xs,
      y: top,
      dir: 1,
      width: fringeH * 1.3,
      height: fringeH,
      kind: () => 'triangle',
      obstacles,
    });
    terraces(calmEdge, bottom);
  } else {
    terraces(0, register(ctx, S, 0, w, h - inset, -1));
  }

  // The bowl's rim: a thick band and its thin companion, circling the turning whorl.
  ctx.beginPath();
  ctx.arc(cx, cy, rim, 0, TAU);
  ink(ctx, S.band);
  ctx.beginPath();
  ctx.arc(cx, cy, outer - S.lw / 2, 0, TAU);
  ink(ctx, S.lw);
}

function heroMotion(seconds, intro, dir) {
  const settle = 1 - easeInOutCubic(intro);
  return {
    turn: dir * ((seconds * TAU) / 150 - settle * 1.1),
    sway: Math.sin((seconds * TAU) / 7) * 0.07 + Math.sin((seconds * TAU) / 3.1) * 0.015,
    time: seconds,
  };
}

/** Mount the animated hero on `canvas`. safeZone: where the headline sits ('left' | 'top' |
 *  'auto'). Returns { destroy }. */
export function mountHero(canvas, { seed = 0, safeZone = 'auto' } = {}) {
  const motionQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let scene = null;
  let scratch = null;
  let raf = 0;
  let resizeTimer = 0;
  let onScreen = true;
  let elapsed = 0;
  let last = 0;
  let destroyed = false;

  const still = () => motionQuery !== null && motionQuery.matches;
  const running = () => !destroyed && scene !== null && onScreen && !document.hidden && !still();
  const sizeKey = () =>
    `${canvas.clientWidth}x${canvas.clientHeight}@${Math.min(window.devicePixelRatio || 1, 2)}`;

  function build() {
    const key = sizeKey();
    const fit = fitCanvas(canvas);
    if (!fit) {
      scene = null;
      return;
    }
    const { ctx, w, h, dpr } = fit;
    const auto = w >= h * 1.05 ? 'left' : 'top';
    const zone = safeZone === 'left' || safeZone === 'top' ? safeZone : auto;
    const plan = planHero(createRng(seed), w, h, zone);
    const cache = document.createElement('canvas');
    cache.width = canvas.width;
    cache.height = canvas.height;
    const cctx = cache.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintHeroGround(cctx, plan, w, h);
    const reach = plan.whorl.reach + plan.S.lw;
    const x = Math.max(0, Math.floor((plan.cx - reach) * dpr));
    const y = Math.max(0, Math.floor((plan.cy - reach) * dpr));
    const dirty = {
      x,
      y,
      w: Math.min(canvas.width, Math.ceil((plan.cx + reach) * dpr)) - x,
      h: Math.min(canvas.height, Math.ceil((plan.cy + reach) * dpr)) - y,
    };
    scene = { ctx, w, h, dpr, plan, cache, dirty, full: true, key };
  }

  function composeIntro(time, motion) {
    const { ctx, w, h, dpr, plan, cache } = scene;
    if (!scratch || scratch.width !== cache.width || scratch.height !== cache.height) {
      scratch = document.createElement('canvas');
      scratch.width = cache.width;
      scratch.height = cache.height;
    }
    const sctx = scratch.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.drawImage(cache, 0, 0);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWhorl(sctx, plan.S, plan.whorl, plan.cx, plan.cy, motion);
    const soft = plan.R * 0.9;
    const radius = easeInOutCubic(time / INTRO_MS) * (plan.reveal + soft);
    const { cx, cy } = plan;
    const mask = sctx.createRadialGradient(cx, cy, Math.max(0, radius - soft), cx, cy, radius);
    mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sctx.globalCompositeOperation = 'destination-in';
    sctx.fillStyle = mask;
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.clay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scratch, 0, 0);
  }

  function paint(time) {
    if (!scene) return;
    const { ctx, dpr, plan, cache } = scene;
    const calm = still();
    const intro = calm ? 1 : Math.min(1, time / INTRO_MS);
    const motion = calm ? REST : heroMotion(time / 1000, intro, plan.whorl.dir);
    if (intro < 1) {
      composeIntro(time, motion);
      scene.full = true;
      return;
    }
    scratch = null;
    const r = scene.full ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : scene.dirty;
    scene.full = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x / dpr, r.y / dpr, r.w / dpr, r.h / dpr);
    ctx.clip();
    drawWhorl(ctx, plan.S, plan.whorl, plan.cx, plan.cy, motion);
    ctx.restore();
  }

  function tick(now) {
    raf = 0;
    if (!running()) return;
    const dt = now - last;
    if (dt >= FRAME_MS - 2) {
      elapsed += Math.min(dt, 100);
      last = now;
      paint(elapsed);
    }
    raf = requestAnimationFrame(tick);
  }

  function sync() {
    if (running()) {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function refresh() {
    build();
    paint(elapsed);
    sync();
  }

  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!scene || scene.key !== sizeKey()) refresh();
    }, RESIZE_DEBOUNCE_MS);
  });
  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    sync();
  });
  resizeObserver.observe(canvas);
  intersectionObserver.observe(canvas);
  document.addEventListener('visibilitychange', sync);
  motionQuery?.addEventListener('change', refresh);
  refresh();

  return {
    destroy() {
      destroyed = true;
      clearTimeout(resizeTimer);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motionQuery?.removeEventListener('change', refresh);
      scene = null;
      scratch = null;
    },
  };
}

/* ------------------------------------------------------------- public API */

/** Static generative tile. variant: 'item' (small, bold), 'event' (16:9 card) or 'banner'
 *  (wide frieze). */
export function drawTile(canvas, { seed = 0, variant = 'item' } = {}) {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const paint = variant === 'event' ? paintEvent : variant === 'banner' ? paintBanner : paintItem;
  paint(fit.ctx, createRng(seed), fit.w, fit.h);
}

/** The customer's order mark: a pottery sherd on a transparent background. */
export function drawSherd(canvas, { seed = 0 } = {}) {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  paintSherd(fit.ctx, createRng(seed), fit.w, fit.h);
}
