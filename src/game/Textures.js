import * as THREE from 'three';
import { Random } from '../core/Random.js';

// ============================================================
//  The surfaces an arena is made of.
//
//  Every prop in the game used to be one flat colour, so a forty-metre
//  tower and a two-metre crate were the same grey rectangle at different
//  sizes — and with nothing on a surface to give it scale, a machine could
//  be standing next to either and you could not tell which.
//
//  These are painted into canvases at load and cached, so a texture shared
//  by three arenas is drawn once. Nothing here is fetched: an image file
//  would be another thing to ship, another thing to fail to load, and a
//  licence to keep track of.
//
//  All of it is drawn through a seeded generator, so the same arena is the
//  same arena every time it is built — which is the same rule the fight
//  itself runs under.
// ============================================================

const _cache = new Map();

/** A canvas of the given size, ready to paint into. */
function surface(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return { canvas: c, ctx: c.getContext('2d') };
}

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/** Mix two packed colours, `t` of the way from a to b. */
function mix(a, b, t) {
  const ar = (a >> 16) & 255; const ag = (a >> 8) & 255; const ab = a & 255;
  const br = (b >> 16) & 255; const bg = (b >> 8) & 255; const bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t)
  );
}

/**
 * Speckle: the thing that makes a flat fill read as a material.
 *
 * Without it every surface is a solid rectangle, and a solid rectangle has
 * no scale — it is the same picture whether it is a metre across or forty.
 */
function grain(ctx, size, rng, { amount = 0.08, step = 2 } = {}) {
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const v = rng.signed() * amount;
      ctx.fillStyle = v > 0
        ? `rgba(255,255,255,${v.toFixed(3)})`
        : `rgba(0,0,0,${(-v).toFixed(3)})`;
      ctx.fillRect(x, y, step, step);
    }
  }
}

/** Soft blotches, for anything weathered rather than manufactured. */
function blotches(ctx, size, rng, color, { count = 40, max = 0.3, alpha = 0.2 } = {}) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.02, size * max);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${(alpha * rng.range(0.4, 1)).toFixed(3)})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ------------------------------------------------------------ grounds

/** Poured slabs with expansion joints. A parade ground, or a hangar floor. */
function concrete(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rng, '255,255,255', { count: 26, max: 0.22, alpha: 0.05 });
  grain(ctx, size, rng, { amount: 0.07 });
  // Joints on a four-slab grid, drawn as a dark line with a light lip: a
  // single dark line reads as a scratch, two lines read as an edge.
  ctx.lineWidth = Math.max(1, size / 256);
  const cell = size / 4;
  for (let i = 0; i <= 4; i++) {
    const at = Math.round(i * cell) + 0.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.moveTo(at, 0); ctx.lineTo(at, size);
    ctx.moveTo(0, at); ctx.lineTo(size, at);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(at + 1.5, 0); ctx.lineTo(at + 1.5, size);
    ctx.moveTo(0, at + 1.5); ctx.lineTo(size, at + 1.5);
    ctx.stroke();
  }
}

/** Laid road, with the odd patch and crack. */
function asphalt(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, rng, { amount: 0.13, step: 2 });
  blotches(ctx, size, rng, '0,0,0', { count: 30, max: 0.18, alpha: 0.3 });
  // Cracks: a walk that mostly goes one way and wanders.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(1, size / 400);
  for (let i = 0; i < 7; i++) {
    let x = rng.range(0, size);
    let y = rng.range(0, size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 14; j++) {
      x += rng.range(-size * 0.05, size * 0.05);
      y += rng.range(0, size * 0.06);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Bare rock: no straight lines anywhere. */
function stone(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rng, '255,235,215', { count: 46, max: 0.3, alpha: 0.13 });
  blotches(ctx, size, rng, '0,0,0', { count: 46, max: 0.26, alpha: 0.22 });
  grain(ctx, size, rng, { amount: 0.11 });
}

/** Riveted deck plate. Manufactured, and it has been used. */
function deckplate(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, rng, { amount: 0.06 });
  const cell = size / 2;
  ctx.lineWidth = Math.max(1, size / 200);
  for (let i = 0; i <= 2; i++) {
    const at = Math.round(i * cell) + 0.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.moveTo(at, 0); ctx.lineTo(at, size);
    ctx.moveTo(0, at); ctx.lineTo(size, at);
    ctx.stroke();
  }
  // Rivets down every seam.
  const step = size / 16;
  for (let i = 0; i <= 2; i++) {
    for (let k = step / 2; k < size; k += step) {
      for (const [x, y] of [[i * cell, k], [k, i * cell]]) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.arc(x, y, size / 220, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath();
        ctx.arc(x, y + size / 300, size / 260, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  blotches(ctx, size, rng, '120,70,30', { count: 16, max: 0.16, alpha: 0.22 });
}

/** Dried salt: pale polygons with raised rims. */
function saltpan(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, rng, { amount: 0.05 });
  // Seeds on a jittered grid, joined to their neighbours. Not a true
  // Voronoi — this only has to read as "cracked flat" from twenty metres.
  const n = 7;
  const cell = size / n;
  const pts = [];
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      pts.push([x * cell + rng.range(-cell * 0.3, cell * 0.3),
        y * cell + rng.range(-cell * 0.3, cell * 0.3)]);
    }
  }
  ctx.lineWidth = Math.max(1, size / 300);
  for (let y = 0; y <= n; y++) {
    for (let x = 0; x <= n; x++) {
      const at = pts[y * (n + 1) + x];
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (x + dx > n || y + dy > n) continue;
        const to = pts[(y + dy) * (n + 1) + (x + dx)];
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.moveTo(at[0], at[1]); ctx.lineTo(to[0], to[1]);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.moveTo(at[0], at[1] - 1.5); ctx.lineTo(to[0], to[1] - 1.5);
        ctx.stroke();
      }
    }
  }
}

/**
 * Lunar regolith: dust, and craters at every size.
 *
 * The craters are what make it the Moon rather than a grey field — a rim
 * lit from one side and a floor in shadow, over and over, small ones inside
 * big ones.
 */
function regolith(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rng, '255,255,255', { count: 30, max: 0.3, alpha: 0.05 });

  const crater = (x, y, r) => {
    // Shadowed floor.
    const floor = ctx.createRadialGradient(x, y, 0, x, y, r);
    floor.addColorStop(0, 'rgba(0,0,0,0.34)');
    floor.addColorStop(0.72, 'rgba(0,0,0,0.20)');
    floor.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // A lit rim, always on the same side, or the light contradicts itself.
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.94, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.94, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
  };

  for (let i = 0; i < 7; i++) crater(rng.range(0, size), rng.range(0, size), rng.range(size * 0.07, size * 0.17));
  for (let i = 0; i < 26; i++) crater(rng.range(0, size), rng.range(0, size), rng.range(size * 0.02, size * 0.055));
  for (let i = 0; i < 90; i++) crater(rng.range(0, size), rng.range(0, size), rng.range(size * 0.004, size * 0.016));
  grain(ctx, size, rng, { amount: 0.09 });
}

// ------------------------------------------------------------ props

/** Panel lines and a strip of lit trim: something that was built. */
function panels(ctx, size, rng, base, accent) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, rng, { amount: 0.05 });
  ctx.lineWidth = Math.max(1, size / 300);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  for (let i = 1; i < 8; i++) {
    const at = Math.round((i / 8) * size) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, at); ctx.lineTo(size, at);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const at = Math.round((i / 4) * size) + 0.5;
    ctx.beginPath();
    ctx.moveTo(at, 0); ctx.lineTo(at, size);
    ctx.stroke();
  }
  // One lit band, so the prop has a direction and catches the bright pass.
  ctx.fillStyle = css(accent);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, Math.round(size * 0.62), size, Math.max(2, size / 90));
  ctx.globalAlpha = 1;
}

/** Windows, most of them dark. A building is mostly people being asleep. */
function windows(ctx, size, rng, base, accent) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  grain(ctx, size, rng, { amount: 0.05 });
  // Many more rows than columns.
  //
  // The texture is square and the buildings it goes on are four times taller
  // than they are wide, so a square grid comes out as windows four times
  // taller than they are wide — which reads as a lift shaft, not a floor.
  const cols = 8;
  const rows = 40;
  const w = size / cols;
  const hgt = size / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng.chance(0.18);
      ctx.fillStyle = lit ? css(accent) : 'rgba(0,0,0,0.5)';
      ctx.globalAlpha = lit ? rng.range(0.45, 0.95) : 1;
      ctx.fillRect(
        x * w + w * 0.24, y * hgt + hgt * 0.26,
        w * 0.52, hgt * 0.42,
      );
    }
  }
  ctx.globalAlpha = 1;
}

/** Bedding planes. Rock that was laid down rather than poured. */
function strata(ctx, size, rng, base) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  let y = 0;
  while (y < size) {
    const band = rng.range(size * 0.03, size * 0.13);
    const shade = rng.signed() * 0.16;
    ctx.fillStyle = shade > 0
      ? `rgba(255,220,190,${shade.toFixed(3)})`
      : `rgba(0,0,0,${(-shade).toFixed(3)})`;
    // Bands are not flat: a straight edge here reads as a painted stripe.
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += size / 8) {
      ctx.lineTo(x, y + rng.range(-size * 0.012, size * 0.012));
    }
    ctx.lineTo(size, y + band);
    for (let x = size; x >= 0; x -= size / 8) {
      ctx.lineTo(x, y + band + rng.range(-size * 0.012, size * 0.012));
    }
    ctx.closePath();
    ctx.fill();
    y += band;
  }
  grain(ctx, size, rng, { amount: 0.10 });
}

/** Steel that has been outside for a long time. */
function rust(ctx, size, rng, base, accent) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rng, '150,74,32', { count: 34, max: 0.24, alpha: 0.34 });
  blotches(ctx, size, rng, '0,0,0', { count: 22, max: 0.2, alpha: 0.24 });
  grain(ctx, size, rng, { amount: 0.1 });
  // Corrugation: the reason a shed reads as a shed.
  ctx.lineWidth = Math.max(1, size / 220);
  for (let i = 0; i < 24; i++) {
    const at = Math.round((i / 24) * size) + 0.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.moveTo(at, 0); ctx.lineTo(at, size);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(at + 2, 0); ctx.lineTo(at + 2, size);
    ctx.stroke();
  }
  ctx.fillStyle = css(accent);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, Math.round(size * 0.08), size, Math.max(2, size / 120));
  ctx.globalAlpha = 1;
}

const GROUNDS = { concrete, asphalt, stone, deckplate, saltpan, regolith };
const PROPS = { panels, windows, strata, rust };

/**
 * Paint a texture, or hand back the one already painted.
 *
 * @param {string} kind    which painter
 * @param {number} base    the colour it is mostly made of
 * @param {number} accent  the colour of whatever is lit on it
 * @param {object} [opts]
 * @param {number} [opts.size]    canvas edge, in pixels
 * @param {number} [opts.repeat]  how many times it tiles across the surface
 * @param {number} [opts.seed]
 * @returns {THREE.CanvasTexture|null} null when there is no such painter
 */
export function makeTexture(kind, base, accent = base, {
  size = 512, repeat = 1, seed = 1,
} = {}) {
  const key = `${kind}|${base}|${accent}|${size}|${repeat}|${seed}`;
  if (_cache.has(key)) return _cache.get(key);

  const paint = GROUNDS[kind] ?? PROPS[kind];
  if (!paint || typeof document === 'undefined') return null;

  const { canvas, ctx } = surface(size);
  paint(ctx, size, new Random(seed), base, accent);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _cache.set(key, tex);
  return tex;
}

/**
 * A roughness map from the same painting.
 *
 * Reusing the colour texture as roughness is what stops a lit strip and the
 * metal around it from having identical shine — which is most of what makes
 * a flat-lit prop look like a decal rather than a surface.
 */
export function roughnessFrom(tex) {
  if (!tex) return null;
  const key = `rough|${tex.uuid}`;
  if (_cache.has(key)) return _cache.get(key);
  const clone = tex.clone();
  clone.colorSpace = THREE.NoColorSpace;
  clone.needsUpdate = true;
  _cache.set(key, clone);
  return clone;
}

export { mix };

/** Throw away every painted texture. For tests, and for a clean shutdown. */
export function clearTextureCache() {
  for (const tex of _cache.values()) tex.dispose?.();
  _cache.clear();
}
