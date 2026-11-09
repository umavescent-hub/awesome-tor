/* Tsideh — generative art engine.
 *
 * One small visual grammar, read from the Tsideh mark and recomposed for every seed.
 *   Motifs        whorl (heart, ring, spiral arms, silver blades), feather end (ink sawtooth and
 *                 three sprout stripes), ray fringe, leaf trefoil sprout, stepped terrace, register band.
 *   Compositions  item tile, event tile, banner frieze, sherd keepsake, animated hero.
 * Canvas 2D only, no dependencies, fully deterministic for a seed (mulberry32, never Math.random).
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
const REST = Object.freeze({ turn: 0, spin: 0, sway: 0, time: null });

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

/** One brush per composition: outline, thick band and clay gap all scale together. */
function brush(unit, ratio = 0.015) {
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

function ink(ctx, width) {
  ctx.lineWidth = width;
  ctx.strokeStyle = PALETTE.ink;
  ctx.stroke();
}

function fillWith(ctx, style) {
  ctx.fillStyle = style;
  ctx.fill();
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/* ----------------------------------------------------------------- motifs */

/** Rounded leaf: a point at (x, y) opening into a round tip `len` away along `angle`. */
function leafPath(ctx, x, y, angle, len) {
  const rr = len * 0.37;
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

function trefoil(ctx, S, x, y, angle, len, spread) {
  for (const k of [-1, 1, 0]) {
    leafPath(ctx, x, y, angle + k * spread, len);
    fillWith(ctx, PALETTE.leaf);
    ink(ctx, S.lw * 0.8);
  }
}

/** Leaf trefoil on a thin stem rising `h` from (x, y); `twin` adds a smaller branch below. */
function sprout(ctx, S, x, y, h, sway = 0, twin = false) {
  const tipX = x + Math.sin(sway) * h;
  const tipY = y - Math.cos(sway) * h;
  const midX = x + h * 0.07 + Math.sin(sway) * h * 0.45;
  const midY = y - h * 0.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(midX, midY, tipX, tipY);
  ink(ctx, S.lw * 0.75);
  if (twin) {
    const bx = x + h * 0.035 + Math.sin(sway) * h * 0.24;
    const by = y - h * 0.3;
    const ex = bx + h * 0.2;
    const ey = by - h * 0.06;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + h * 0.1, by + h * 0.02, ex, ey);
    ink(ctx, S.lw * 0.75);
    trefoil(ctx, S, ex, ey, -0.35 + sway * 0.6, h * 0.25, 0.95);
  }
  trefoil(ctx, S, tipX, tipY, -HALF_PI + sway, h * 0.42, 0.98);
}

/** Thick ink spiral arm (Archimedean) from radius r0 to r1 while turning `sweep` radians. */
function spiralArm(ctx, cx, cy, r0, r1, a0, sweep, width) {
  const steps = Math.max(12, Math.ceil(Math.abs(sweep) * 24));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + sweep * t;
    const r = r0 + (r1 - r0) * t;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineCap = 'round';
  ink(ctx, width);
}

/** Polar outline of a crescent blade: square end at t = 0, tapering and curling inward to t = 1. */
function bladeEdges(b, cx, cy, a0) {
  const steps = Math.max(18, Math.ceil(b.span * 22));
  const inner = [];
  const outer = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + b.dir * b.span * t;
    const r = b.ri - b.curl * t * t;
    const w = b.W * (1 - t * t);
    const c = Math.cos(a);
    const s = Math.sin(a);
    inner.push([cx + r * c, cy + r * s]);
    outer.push([cx + (r + w) * c, cy + (r + w) * s]);
  }
  return { inner, outer };
}

/** Ink sawtooth column plus three sprout stripes, drawn off a blade's square end. */
function featherEnd(ctx, S, origin, radial, back, W, saw, length, fine) {
  ctx.save();
  ctx.transform(back[0], back[1], radial[0], radial[1], origin[0], origin[1]);
  const bar = W * 0.22;
  const gap = (W - bar * 3) / 4;
  ctx.lineJoin = 'miter';
  for (let j = 0; j < 3; j++) {
    ctx.beginPath();
    ctx.rect(saw, gap + j * (bar + gap), length, bar);
    fillWith(ctx, PALETTE.sprout);
    ink(ctx, S.lw * (fine ? 0.75 : 0.6));
  }
  const teeth = W > 40 ? 4 : 3;
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
  ink(ctx, S.lw * 0.75);
  ctx.restore();
}

/** Serrated ink rays standing on a blade's outer edge, from t0 to t1 along the blade. */
function bladeRays(ctx, b, cx, cy, a0, rays, time) {
  const { t0, t1, n, h, lean } = rays;
  const edge = (t) => {
    const a = a0 + b.dir * b.span * t;
    const r = b.ri - b.curl * t * t + b.W * (1 - t * t);
    return [a, r];
  };
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ta = t0 + ((t1 - t0) * i) / n;
    const tb = t0 + ((t1 - t0) * (i + 1)) / n;
    const tt = ta + (tb - ta) * (0.5 + lean);
    const [aa, ra] = edge(ta);
    const [ab, rb] = edge(tb);
    const [at, rt] = edge(tt);
    const breathe = time === null ? 1 : 1 + 0.16 * Math.sin(time * 1.3 - i * 0.6);
    const hh = h * breathe * (1 - 0.45 * ((ta - t0) / (t1 - t0)) ** 2);
    const sink = b.W * 0.12;
    ctx.moveTo(cx + (ra - sink) * Math.cos(aa), cy + (ra - sink) * Math.sin(aa));
    ctx.lineTo(cx + (rt + hh) * Math.cos(at), cy + (rt + hh) * Math.sin(at));
    ctx.lineTo(cx + (rb - sink) * Math.cos(ab), cy + (rb - sink) * Math.sin(ab));
  }
  ctx.lineJoin = 'miter';
  fillWith(ctx, PALETTE.ink);
}

/** A silver crescent blade with its optional rays, feather end and clay window. */
function blade(ctx, S, b, cx, cy, turn, time) {
  const a0 = b.a0 + turn;
  if (b.rays) bladeRays(ctx, b, cx, cy, a0, b.rays, time);
  const { inner, outer } = bladeEdges(b, cx, cy, a0);
  if (b.stripes > 0) {
    const radial = [Math.cos(a0), Math.sin(a0)];
    const back = [b.dir * Math.sin(a0), -b.dir * Math.cos(a0)];
    featherEnd(ctx, S, inner[0], radial, back, b.W, b.saw, b.stripes, b.fine);
  }
  ctx.beginPath();
  ctx.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i][0], outer[i][1]);
  for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
  ctx.closePath();
  const tip = inner[inner.length - 1];
  fillWith(ctx, metal(ctx, outer[0][0], outer[0][1], tip[0], tip[1]));
  ctx.lineJoin = 'round';
  ink(ctx, S.lw);
  if (b.window) {
    const t = 0.24;
    const a = a0 + b.dir * b.span * t;
    const r = b.ri - b.curl * t * t + (b.W * (1 - t * t)) / 2;
    ctx.save();
    ctx.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.rotate(a + HALF_PI);
    ctx.beginPath();
    ctx.rect(-b.W * 0.2, -b.W * 0.14, b.W * 0.4, b.W * 0.28);
    ctx.restore();
    fillWith(ctx, PALETTE.clay);
    ctx.lineJoin = 'miter';
    ink(ctx, S.lw);
  }
}

/** Stepped terrace: a pyramid of `steps` levels on a base centred at (x, y); hangs when `down`. */
function terracePath(ctx, x, y, w, h, steps, down) {
  const sy = down ? 1 : -1;
  const sh = h / steps;
  const inset = steps > 1 ? (w * 0.36) / (steps - 1) : 0;
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

function trianglePath(ctx, x, y, w, h, down) {
  const sy = down ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x, y + sy * h);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
}

/** Pottery register: a thick band on `y` with a thin companion line toward `inward`.
 *  Returns the y of the register's inner edge. */
function register(ctx, S, x0, x1, y, inward) {
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ink(ctx, S.band);
  const y2 = y + inward * (S.band / 2 + S.gap + S.lw / 2);
  ctx.beginPath();
  ctx.moveTo(x0, y2);
  ctx.lineTo(x1, y2);
  ink(ctx, S.lw);
  return y2 + (inward * S.lw) / 2;
}

/** Free vertical room from `y` (heading `dir`) before touching circle `o` within [xa, xb]. */
function clearance(o, xa, xb, y, dir) {
  const dx = Math.min(Math.max(o.cx, xa), xb) - o.cx;
  if (Math.abs(dx) >= o.r) return Infinity;
  const edge = o.cy - dir * Math.sqrt(o.r * o.r - dx * dx);
  return Math.max(0, (edge - y) * dir);
}

/** A rhythm of terraces, triangles and sprouts hung from (dir = 1) or raised on (dir = -1) a
 *  register line. Each element shrinks to keep clear of the obstacle circles. */
function row(ctx, S, { xs, y, dir, width, maxH, minH, obstacles, pattern }) {
  xs.forEach((x, i) => {
    let room = maxH;
    for (const o of obstacles) room = Math.min(room, clearance(o, x - width / 2, x + width / 2, y, dir) - S.gap * 2);
    if (room < minH) return;
    const kind = pattern(i);
    const down = dir > 0;
    if (kind === 'sprout') {
      sprout(ctx, S, x, y, room * 0.9, 0, room > minH * 2.4);
    } else if (kind === 'triangle') {
      trianglePath(ctx, x, y, width * 0.72, room, down);
      ctx.lineJoin = 'miter';
      fillWith(ctx, PALETTE.ink);
    } else {
      const steps = Math.max(2, Math.min(4, Math.round(room / (width * 0.28))));
      terracePath(ctx, x, y, width, room, steps, down);
      fillWith(ctx, metal(ctx, x - width / 2, y, x + width / 2, y + dir * room));
      ctx.lineJoin = 'miter';
      ink(ctx, S.lw);
    }
  });
}

function spacedPositions(x0, x1, unit) {
  const n = Math.max(1, Math.round((x1 - x0) / unit));
  const step = (x1 - x0) / n;
  return { step, xs: Array.from({ length: n }, (_, i) => x0 + (i + 0.5) * step) };
}

/* ------------------------------------------------------------------ whorl */

/**
 * Plan a whorl around the origin: heart disk, ink ring, spiral arms, `count` silver blades.
 * opts: count, dir (+1 clockwise), base (angle of the first square end), stripes, rays
 * ('none' | 'one' | 'all'), heart ('sprout' | 'eye'), fine (enough room for small details).
 */
function planWhorl(rng, S, R, opts) {
  const { count, dir, base, stripes, rays, heart, fine } = opts;
  const W = R * 0.4;
  const ri = R * 0.52;
  const sector = TAU / count;
  const ring = Math.min(S.band, R * 0.09);
  const heartR = R * 0.3;
  const blades = [];
  for (let i = 0; i < count; i++) {
    const withRays = rays === 'all' || (rays === 'one' && i === 0);
    blades.push({
      a0: base + dir * i * sector,
      span: sector * (count === 1 ? rng.range(0.5, 0.62) : rng.range(0.7, 0.8)),
      dir,
      ri,
      W,
      curl: W * 0.42,
      saw: W * 0.17,
      stripes: stripes ? R * rng.range(0.5, 0.72) : 0,
      window: fine && W > 22,
      fine,
      rays: withRays
        ? { t0: 0.1, t1: 0.86, n: Math.max(5, Math.round(R / (fine ? 12 : 9))), h: R * 0.17, lean: 0.32 }
        : null,
    });
  }
  const arms = blades.map((b) => ({
    r0: heartR + ring / 2,
    r1: ri + W * 0.55,
    a0: b.a0 - b.dir * 1.1,
    sweep: b.dir * 1.3,
  }));
  let reach = ri + W;
  for (const b of blades) {
    if (b.stripes) reach = Math.max(reach, Math.hypot(ri + W, b.saw + b.stripes));
    if (b.rays) reach = Math.max(reach, ri + W + b.rays.h * 1.2);
  }
  return { R, dir, ring, heartR, heart, blades, arms, reach: reach + S.lw };
}

function drawWhorl(ctx, S, wh, cx, cy, motion = REST) {
  for (const arm of wh.arms) spiralArm(ctx, cx, cy, arm.r0, arm.r1, arm.a0 + motion.spin, arm.sweep, wh.ring);
  for (const b of wh.blades) blade(ctx, S, b, cx, cy, motion.turn, motion.time);
  ctx.beginPath();
  ctx.arc(cx, cy, wh.heartR + wh.ring / 2, 0, TAU);
  ink(ctx, wh.ring);
  if (wh.heart === 'sprout') {
    const r = wh.heartR;
    sprout(ctx, S, cx - r * 0.08, cy + r * 0.62, r * 1.08, motion.sway, r > 26);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, wh.heartR * 0.36, 0, TAU);
    fillWith(ctx, PALETTE.ink);
  }
}

/* ----------------------------------------------------------- compositions */

function paintItem(ctx, rng, w, h) {
  const m = Math.min(w, h);
  const S = brush(m, 0.016);
  ground(ctx, w, h);
  const fine = m >= 150;
  const kind = rng.weighted([['whorl', 4], ['pinwheel', 2], ['terrace', 2], ['medallion', 2]]);
  const cx = w / 2;
  const cy = h / 2;

  if (kind === 'whorl' || kind === 'pinwheel') {
    const pin = kind === 'pinwheel';
    const R = m * (pin ? 0.4 : 0.36);
    const wh = planWhorl(rng, S, R, {
      count: pin ? rng.pick([3, 4]) : rng.weighted([[2, 3], [1, 1]]),
      dir: rng.pick([1, -1]),
      base: rng.range(0, TAU),
      stripes: !pin,
      rays: pin ? rng.pick(['all', 'none']) : rng.pick(['one', 'none']),
      heart: R * 0.3 >= 14 ? 'sprout' : 'eye',
      fine,
    });
    drawWhorl(ctx, S, wh, cx + rng.range(-0.04, 0.04) * w, cy + rng.range(-0.04, 0.04) * h);
    return;
  }

  if (kind === 'terrace') {
    const top = register(ctx, S, 0, w, S.lw * 2 + S.band / 2, 1);
    const bottom = register(ctx, S, 0, w, h - S.lw * 2 - S.band / 2, -1);
    const tw = w * rng.range(0.5, 0.62);
    const th = (bottom - top) * rng.range(0.34, 0.42);
    const steps = fine ? rng.int(3, 4) : 3;
    terracePath(ctx, cx, bottom, tw, th, steps, false);
    fillWith(ctx, metal(ctx, cx - tw / 2, bottom - th, cx + tw / 2, bottom));
    ctx.lineJoin = 'miter';
    ink(ctx, S.lw);
    const corner = w * 0.3;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(side, 1);
      terracePath(ctx, w / 2, top, corner * 2, th * 0.62, steps - 1, true);
      ctx.restore();
      fillWith(ctx, PALETTE.ink);
    }
    sprout(ctx, S, cx, bottom - th, (bottom - top - th) * 0.62, 0, fine);
    return;
  }

  // medallion: a sprout held in an ink ring under a full ray fringe
  const r = m * 0.25;
  const n = fine ? 18 : 14;
  const hRay = m * 0.1;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n;
    const b = (TAU * (i + 1)) / n;
    const t = a + (b - a) * 0.82;
    ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    ctx.lineTo(cx + (r + hRay) * Math.cos(t), cy + (r + hRay) * Math.sin(t));
    ctx.lineTo(cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  ctx.lineJoin = 'miter';
  fillWith(ctx, PALETTE.ink);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  fillWith(ctx, PALETTE.clay);
  ink(ctx, S.band);
  ctx.beginPath();
  ctx.arc(cx, cy, r - S.band / 2 - S.gap - S.lw / 2, 0, TAU);
  ink(ctx, S.lw);
  sprout(ctx, S, cx - r * 0.06, cy + r * 0.56, r * 1.05, 0, fine);
}

function paintEvent(ctx, rng, w, h) {
  const m = Math.min(w, h);
  const S = brush(m, 0.016);
  ground(ctx, w, h);
  const fine = m >= 150;
  const mode = rng.weighted([['single', 5], ['twin', 2], ['center', 2]]);
  const side = rng.pick([-1, 1]);
  const pad = S.lw * 2 + S.band / 2;
  const top = register(ctx, S, 0, w, pad, 1);
  const bottom = register(ctx, S, 0, w, h - pad, -1);
  const unit = (bottom - top) * rng.range(0.2, 0.26);
  const maxH = (bottom - top) * 0.3;
  const hang = rng.pick([['terrace', 'triangle'], ['terrace'], ['triangle', 'terrace', 'triangle']]);
  const rise = rng.pick([['terrace', 'sprout'], ['sprout', 'terrace', 'terrace'], ['terrace']]);
  const fieldMid = (top + bottom) / 2;

  const whorls = [];
  if (mode === 'center') {
    const R = Math.min((bottom - top) * 0.4, w * 0.22);
    whorls.push({
      cx: w / 2,
      cy: fieldMid,
      mirror: false,
      wh: planWhorl(rng, S, R, {
        count: rng.pick([3, 4]),
        dir: side,
        base: rng.range(0, TAU),
        stripes: false,
        rays: 'all',
        heart: 'sprout',
        fine,
      }),
    });
  } else {
    const twin = mode === 'twin';
    const R = Math.min((bottom - top) * (twin ? 0.36 : 0.4), w * (twin ? 0.15 : 0.2));
    const wh = planWhorl(rng, S, R, {
      count: 2,
      dir: 1,
      base: HALF_PI + rng.range(-0.25, 0.25),
      stripes: true,
      rays: 'one',
      heart: 'sprout',
      fine,
    });
    const cx = w * (twin ? 0.24 : 0.27);
    whorls.push({ cx, cy: fieldMid, wh, mirror: !twin && side > 0 });
    if (twin) whorls.push({ cx, cy: fieldMid, wh, mirror: true });
  }

  const obstacles = whorls.map(({ cx, cy, wh, mirror }) => ({ cx: mirror ? w - cx : cx, cy, r: wh.reach }));
  const { step, xs } = spacedPositions(0, w, unit);
  const symmetric = mode !== 'single';
  const at = (list) => (i) => list[(symmetric ? Math.min(i, xs.length - 1 - i) : i) % list.length];
  const rowOpts = { xs, width: step * 0.74, maxH, minH: S.lw * 4, obstacles };
  row(ctx, S, { ...rowOpts, y: top, dir: 1, pattern: at(hang) });
  row(ctx, S, { ...rowOpts, y: bottom, dir: -1, pattern: at(rise) });

  for (const { cx, cy, wh, mirror } of whorls) {
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    drawWhorl(ctx, S, wh, cx, cy);
    ctx.restore();
  }
}

/** Horizontal feather: stripes, sawtooth and a gently drooping blade, centred on (x, y). */
function feather(ctx, S, x, y, len, thick, dir, fine) {
  const L = len * 0.4;
  const saw = thick * 0.17;
  const bladeLen = len - L - saw;
  const bigR = thick * 6;
  const ri = bigR - thick / 2;
  const start = x - (dir * len) / 2 + dir * (L + saw);
  const b = {
    a0: -HALF_PI,
    span: bladeLen / (ri + thick / 2),
    dir,
    ri,
    W: thick,
    curl: thick * 0.5,
    saw,
    stripes: L,
    window: fine && thick > 22,
    fine,
    rays: null,
  };
  blade(ctx, S, b, start, y + ri + thick / 2, 0, null);
}

function paintBanner(ctx, rng, w, h) {
  const S = brush(h, 0.022);
  ground(ctx, w, h);
  const pad = S.lw + S.band / 2;
  const top = register(ctx, S, 0, w, pad, 1);
  const bottom = register(ctx, S, 0, w, h - pad, -1);
  const fh = bottom - top;
  if (fh < S.lw * 8) return;
  const fine = fh >= 90;
  const mid = (top + bottom) / 2;
  const kind = rng.weighted([['terraces', 3], ['feathers', 2]]);
  const unit = fh * rng.range(1.15, 1.45);
  const { step, xs } = spacedPositions(0, w, unit);
  const n = xs.length;
  const mirrored = rng.chance(0.6);
  const ix = (i) => (mirrored ? Math.min(i, n - 1 - i) : i);

  if (kind === 'terraces') {
    const every = rng.pick([3, 4]);
    const offset = mirrored ? Math.floor((n - 1) / 2) % every : rng.int(0, every - 1);
    const medallion = (i) => ix(i) % every === offset;
    const R = fh * 0.4;
    const medallions = xs.filter((_, i) => medallion(i)).map((x) => ({ cx: x, cy: mid }));
    const heart = fh >= 60 ? 'sprout' : 'eye';
    const wh = planWhorl(rng, S, R, {
      count: rng.pick([2, 3]),
      dir: 1,
      base: rng.range(0, TAU),
      stripes: false,
      rays: 'none',
      heart,
      fine,
    });
    const obstacles = medallions.map((p) => ({ ...p, r: wh.reach }));
    const edges = Array.from({ length: n + 1 }, (_, i) => i * step);
    const hangKind = rng.pick(['ink', 'silver']);
    row(ctx, S, {
      xs: edges,
      y: top,
      dir: 1,
      width: step * 0.62,
      maxH: fh * 0.58,
      minH: S.lw * 3,
      obstacles,
      pattern: () => (hangKind === 'ink' ? 'triangle' : 'terrace'),
    });
    row(ctx, S, {
      xs: xs.filter((_, i) => !medallion(i)),
      y: bottom,
      dir: -1,
      width: step * 0.62,
      maxH: fh * 0.58,
      minH: S.lw * 3,
      obstacles,
      pattern: () => 'terrace',
    });
    medallions.forEach((p, i) => {
      ctx.save();
      if (mirrored && p.cx > w / 2) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      drawWhorl(ctx, S, wh, mirrored && p.cx > w / 2 ? w - p.cx : p.cx, p.cy, { ...REST, spin: i });
      ctx.restore();
    });
    return;
  }

  // feathers: a procession of feather bands with spiral eyes between them
  const thick = fh * 0.46;
  xs.forEach((x, i) => {
    const k = ix(i);
    if (k % 2 === 1) {
      const r = fh * 0.24;
      spiralArm(ctx, x, mid, r * 0.15, r, rng.range(0, TAU), TAU * 1.6, Math.min(S.band, r * 0.3));
      return;
    }
    const dir = mirrored ? (x < w / 2 ? 1 : -1) : 1;
    feather(ctx, S, x, mid, step * 0.94, thick, dir, fine);
  });
}

/* ------------------------------------------------------------------ sherd */

function circleThrough(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx: ux, cy: uy, r: Math.hypot(a[0] - ux, a[1] - uy) };
}

function paintSherd(ctx, rng, w, h) {
  const m = Math.min(w, h);
  const S = brush(m, 0.014);
  const R = m * 0.42;
  const depth = S.lw * 1.8;
  const cx = w / 2 - depth * 0.3;
  const cy = h / 2 - depth * 0.4;

  // Silhouette: a rim arc across the top, then 5–7 fracture edges around the rest.
  const rimLeft = [cx - R * rng.range(0.78, 0.92), cy - R * rng.range(0.42, 0.6)];
  const rimRight = [cx + R * rng.range(0.78, 0.92), cy - R * rng.range(0.42, 0.6)];
  const sag = R * rng.range(0.16, 0.24);
  const rimMid = [(rimLeft[0] + rimRight[0]) / 2, (rimLeft[1] + rimRight[1]) / 2 - sag];
  const rim = circleThrough(rimLeft, rimMid, rimRight);
  const aStart = Math.atan2(rimRight[1] - cy, rimRight[0] - cx);
  const aEnd = Math.atan2(rimLeft[1] - cy, rimLeft[0] - cx) + TAU;
  const breaks = rng.int(5, 7);
  const vertices = [rimRight];
  for (let i = 1; i <= breaks; i++) {
    const a = aStart + ((aEnd - aStart) * (i + rng.range(-0.3, 0.3))) / (breaks + 1);
    const r = R * rng.range(0.78, 1.02);
    vertices.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  vertices.push(rimLeft);
  const bends = vertices.slice(1).map(() => rng.range(-0.07, 0.07));
  const outline = (dx, dy) => {
    ctx.beginPath();
    ctx.moveTo(rimLeft[0] + dx, rimLeft[1] + dy);
    ctx.arc(rim.cx + dx, rim.cy + dy, rim.r, Math.atan2(rimLeft[1] - rim.cy, rimLeft[0] - rim.cx),
      Math.atan2(rimRight[1] - rim.cy, rimRight[0] - rim.cx));
    for (let i = 1; i < vertices.length; i++) {
      const [x0, y0] = vertices[i - 1];
      const [x1, y1] = vertices[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      const qx = (x0 + x1) / 2 + nx * len * bends[i - 1];
      const qy = (y0 + y1) / 2 + ny * len * bends[i - 1];
      ctx.quadraticCurveTo(qx + dx, qy + dy, x1 + dx, y1 + dy);
    }
    ctx.closePath();
  };

  // Broken-edge thickness, then the painted face.
  outline(depth * 0.6, depth);
  fillWith(ctx, PALETTE.earth);
  ctx.lineJoin = 'round';
  ink(ctx, S.lw);
  outline(0, 0);
  fillWith(ctx, PALETTE.clay);

  ctx.save();
  ctx.clip();
  const ring = (r, width) => {
    ctx.beginPath();
    ctx.arc(rim.cx, rim.cy, r, 0, TAU);
    ink(ctx, width);
  };
  const rBand = rim.r - S.band / 2 - S.lw * 0.5;
  ring(rBand, S.band);
  const rThin = rBand - S.band / 2 - S.gap - S.lw / 2;
  ring(rThin, S.lw);
  const hangH = R * rng.range(0.16, 0.22);
  const rLow = rThin - hangH - S.gap * 2.2;
  ring(rLow, S.lw);
  const aMid = Math.atan2(cy - rim.cy, cx - rim.cx);
  const count = rng.int(5, 7);
  const arcStep = (R * rng.range(0.34, 0.42)) / rim.r;
  const hangKind = rng.pick(['terrace', 'triangle']);
  for (let i = -count; i <= count; i++) {
    const a = aMid + i * arcStep;
    ctx.save();
    ctx.translate(rim.cx + rThin * Math.cos(a), rim.cy + rThin * Math.sin(a));
    ctx.rotate(a - HALF_PI);
    const ew = arcStep * rThin * 0.62;
    if (hangKind === 'terrace') {
      terracePath(ctx, 0, S.lw / 2, ew, hangH, 3, false);
      ctx.restore();
      fillWith(ctx, metal(ctx, cx - R, cy - R, cx + R, cy));
      ctx.lineJoin = 'miter';
      ink(ctx, S.lw);
    } else {
      trianglePath(ctx, 0, S.lw / 2, ew * 0.8, hangH, false);
      ctx.restore();
      fillWith(ctx, PALETTE.ink);
    }
  }
  const wr = R * rng.range(0.62, 0.78);
  const wh = planWhorl(rng, S, wr, {
    count: 2,
    dir: rng.pick([1, -1]),
    base: rng.range(0, TAU),
    stripes: true,
    rays: 'one',
    heart: 'sprout',
    fine: m >= 120,
  });
  const along = rng.range(-0.5, 0.5);
  const wx = cx + R * along;
  const wy = rim.cy + rLow + S.gap * 2 + wh.reach * 0.92;
  drawWhorl(ctx, S, wh, wx, Math.max(wy, cy + R * 0.1));
  ctx.restore();

  // Fired-clay grain, then the ink outline over everything.
  ctx.save();
  outline(0, 0);
  ctx.clip();
  ctx.fillStyle = PALETTE.earth;
  ctx.globalAlpha = 0.14;
  const grains = Math.round((R * R) / 90);
  for (let i = 0; i < grains; i++) {
    const a = rng.range(0, TAU);
    const r = R * Math.sqrt(rng.range(0, 1.1));
    ctx.beginPath();
    ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), rng.range(0.4, 1.1) * S.lw * 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  outline(0, 0);
  ctx.lineJoin = 'round';
  ink(ctx, S.lw * 1.2);
}

/* ------------------------------------------------------------------- hero */

function planHero(rng, w, h, zone) {
  const wide = zone === 'left';
  const R = wide ? Math.min(h * 0.34, w * 0.22) : Math.min(w * 0.4, h * 0.21);
  const S = brush(R, 0.034);
  const cx = wide ? w - R * 1.28 : w * 0.6;
  const cy = wide ? h * 0.52 : h - R * 1.5;
  const dir = rng.pick([1, -1]);
  // Feather stripes leave toward the art side, never into the headline zone.
  const base = wide ? (dir > 0 ? HALF_PI : -HALF_PI) : dir > 0 ? Math.PI : 0;
  const whorl = planWhorl(rng, S, R, {
    count: 2,
    dir,
    base: base + rng.range(-0.18, 0.18),
    stripes: true,
    rays: 'one',
    heart: 'sprout',
    fine: true,
  });
  const reveal = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
  return { zone, S, R, cx, cy, whorl, reveal };
}

function paintHeroGround(ctx, rng, plan, w, h) {
  const { S, cx, cy, whorl, zone } = plan;
  ground(ctx, w, h);
  const keep = whorl.reach + S.gap * 3;
  const calm = zone === 'left'
    ? { x: 0, y: 0, w: Math.max(0, cx - keep), h }
    : { x: 0, y: 0, w, h: Math.max(0, cy - keep) };

  // Calm zone: faint concentric ripples from the whorl, fading as they travel.
  ctx.save();
  ctx.beginPath();
  ctx.rect(calm.x, calm.y, calm.w, calm.h);
  ctx.clip();
  ctx.strokeStyle = PALETTE.earth;
  ctx.lineWidth = S.lw * 0.7;
  const stepR = S.band * 3;
  const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  for (let r = keep + stepR; r < far; r += stepR) {
    ctx.globalAlpha = 0.16 * (1 - (r - keep) / (far - keep)) ** 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  const obstacle = [{ cx, cy, r: keep }];
  const unit = plan.R * rng.range(0.34, 0.42);
  const pad = S.lw * 2 + S.band / 2;
  const hang = rng.pick([['terrace', 'triangle'], ['terrace'], ['triangle', 'terrace']]);
  const rise = rng.pick([['terrace', 'sprout'], ['sprout', 'terrace', 'terrace'], ['terrace', 'terrace', 'sprout']]);
  const x0 = zone === 'left' ? calm.w : 0;
  const { step, xs } = spacedPositions(x0, w, unit);
  const rowOpts = { xs, width: step * 0.72, maxH: plan.R * 0.62, minH: S.lw * 4, obstacles: obstacle };
  if (zone === 'left') {
    const top = register(ctx, S, x0, w, pad, 1);
    row(ctx, S, { ...rowOpts, y: top, dir: 1, pattern: (i) => hang[i % hang.length] });
  }
  const bottom = register(ctx, S, x0, w, h - pad, -1);
  row(ctx, S, { ...rowOpts, y: bottom, dir: -1, pattern: (i) => rise[i % rise.length] });
}

function heroMotion(seconds, intro, dir) {
  const unwind = (1 - easeOutCubic(intro)) * 0.9;
  return {
    turn: dir * (Math.sin((seconds * TAU) / 26) * 0.08 - unwind),
    spin: (dir * seconds * TAU) / 48,
    sway: Math.sin((seconds * TAU) / 7) * 0.07 + Math.sin((seconds * TAU) / 3.1) * 0.015,
    time: seconds,
  };
}

/** Mount the animated hero on `canvas`. Returns { destroy }. */
export function mountHero(canvas, { seed = 0, safeZone = 'auto' } = {}) {
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
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

  function build() {
    const fit = fitCanvas(canvas);
    if (!fit) {
      scene = null;
      return;
    }
    const { ctx, w, h, dpr } = fit;
    const zone = safeZone === 'left' || safeZone === 'top' ? safeZone : w >= h * 1.05 ? 'left' : 'top';
    const rng = createRng(seed);
    const plan = planHero(rng, w, h, zone);
    const cache = document.createElement('canvas');
    cache.width = canvas.width;
    cache.height = canvas.height;
    const cctx = cache.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintHeroGround(cctx, rng, plan, w, h);
    const reach = plan.whorl.reach + plan.S.lw;
    const x = Math.max(0, Math.floor((plan.cx - reach) * dpr));
    const y = Math.max(0, Math.floor((plan.cy - reach) * dpr));
    const dirty = {
      x,
      y,
      w: Math.min(canvas.width, Math.ceil((plan.cx + reach) * dpr)) - x,
      h: Math.min(canvas.height, Math.ceil((plan.cy + reach) * dpr)) - y,
    };
    scene = { ctx, w, h, dpr, plan, cache, dirty, full: true, key: `${w}x${h}@${dpr}` };
  }

  function composeIntro(time, motion) {
    const { ctx, dpr, plan, cache } = scene;
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
    const radius = easeOutCubic(time / INTRO_MS) * (plan.reveal + plan.R);
    const mask = sctx.createRadialGradient(plan.cx, plan.cy, Math.max(0, radius - plan.R), plan.cx, plan.cy, radius);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.globalCompositeOperation = 'destination-in';
    sctx.fillStyle = mask;
    sctx.fillRect(0, 0, scene.w, scene.h);
    sctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.clay;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(scratch, 0, 0);
  }

  function paint(time) {
    if (!scene) return;
    const { ctx, dpr, plan, cache } = scene;
    const intro = Math.min(1, time / INTRO_MS);
    const motion = still() ? REST : heroMotion(time / 1000, intro, plan.whorl.dir);
    if (intro < 1 && !still()) {
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
    paint(still() ? INTRO_MS : elapsed);
    sync();
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const key = `${canvas.clientWidth}x${canvas.clientHeight}@${dpr}`;
      if (!scene || scene.key !== key) refresh();
    }, RESIZE_DEBOUNCE_MS);
  }

  const resizeObserver = new ResizeObserver(onResize);
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

/** Static generative tile. variant: 'item' (small, bold), 'event' (16:9 card), 'banner' (wide frieze). */
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
