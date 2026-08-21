// ============================================================
//  Palette : the colours a build is allowed to use.
//
//  Index 0..15 are the standard swatches and never change. Anything the
//  colour wheel produces is appended, so an index that a voxel already
//  holds always means the same colour — which is what lets the mesher
//  bake vertex colours and cache the result.
// ============================================================

export const STANDARD_COLORS = [
  0xc9d2dc, // 0 core silver
  0x2b303a, // 1 gunmetal
  0x5a6472, // 2 steel
  0xe6ebf2, // 3 white
  0xd8463c, // 4 red
  0xf07a2a, // 5 orange
  0xf2c53d, // 6 yellow
  0x62b558, // 7 green
  0x2f9e8f, // 8 teal
  0x3d7ede, // 9 blue
  0x5b4fd6, // 10 indigo
  0x9a52c9, // 11 violet
  0xdb5f9a, // 12 pink
  0x8a6244, // 13 brown
  0x1a1d24, // 14 black
  0x00e5ff, // 15 glow cyan
];

/** A voxel byte is index+1, so 0 can mean "empty". */
export const MAX_COLORS = 255;

export class Palette {
  constructor(colors) {
    this.colors = colors ? colors.slice() : STANDARD_COLORS.slice();
    /** Bumped whenever the colour list grows, so caches can invalidate. */
    this.version = 0;
  }

  get size() { return this.colors.length; }

  get(i) { return this.colors[i] ?? this.colors[0]; }

  indexOf(hex) { return this.colors.indexOf(hex & 0xffffff); }

  /** Standard swatches are the fixed head of the list. */
  isStandard(i) { return i < STANDARD_COLORS.length; }

  /**
   * Return the index for a colour, appending it if it is new.
   * Returns -1 only when the palette is completely full.
   */
  ensure(hex) {
    const c = hex & 0xffffff;
    const found = this.colors.indexOf(c);
    if (found >= 0) return found;
    if (this.colors.length >= MAX_COLORS) return -1;
    this.colors.push(c);
    this.version++;
    return this.colors.length - 1;
  }

  /** Custom entries only, with their palette index. */
  customEntries() {
    const out = [];
    for (let i = STANDARD_COLORS.length; i < this.colors.length; i++) {
      out.push({ index: i, hex: this.colors[i] });
    }
    return out;
  }

  /** Drop custom colours no longer referenced by any voxel. */
  prune(usedIndices) {
    const keep = new Set(usedIndices);
    const remap = new Map();
    const next = STANDARD_COLORS.slice();
    for (let i = 0; i < STANDARD_COLORS.length; i++) remap.set(i, i);
    for (let i = STANDARD_COLORS.length; i < this.colors.length; i++) {
      if (!keep.has(i)) continue;
      remap.set(i, next.length);
      next.push(this.colors[i]);
    }
    const changed = next.length !== this.colors.length;
    this.colors = next;
    if (changed) this.version++;
    return remap;
  }

  toJSON() { return this.colors.slice(); }

  static fromJSON(arr) {
    if (!Array.isArray(arr) || !arr.length) return new Palette();
    return new Palette(arr);
  }

  clone() { return new Palette(this.colors); }
}

// ------------------------------------------------------------
//  Colour helpers for the wheel UI
// ------------------------------------------------------------

export function hexToRgb(hex) {
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

export function rgbToHex(r, g, b) {
  return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255);
}

/** h in [0,360), s and v in [0,1]. */
export function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max <= 0 ? 0 : d / max, v: max };
}

export const hexToCss = (hex) => `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;

export function cssToHex(css) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(css).trim());
  return m ? parseInt(m[1], 16) : null;
}
