import { describe, it, expect } from 'vitest';
import {
  Palette, STANDARD_COLORS, MAX_COLORS,
  hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, hexToCss, cssToHex,
} from '../src/core/Palette.js';

describe('Palette', () => {
  it('starts as the standard swatches', () => {
    const p = new Palette();
    expect(p.size).toBe(STANDARD_COLORS.length);
    expect(p.get(0)).toBe(STANDARD_COLORS[0]);
    expect(p.isStandard(0)).toBe(true);
    expect(p.isStandard(STANDARD_COLORS.length)).toBe(false);
  });

  it('ensure() returns the existing index for a standard colour', () => {
    const p = new Palette();
    const before = p.size;
    expect(p.ensure(STANDARD_COLORS[4])).toBe(4);
    expect(p.size).toBe(before);
  });

  it('ensure() appends new colours and bumps the version', () => {
    const p = new Palette();
    const v0 = p.version;
    const i = p.ensure(0x123456);
    expect(i).toBe(STANDARD_COLORS.length);
    expect(p.get(i)).toBe(0x123456);
    expect(p.version).toBeGreaterThan(v0);
    // idempotent
    expect(p.ensure(0x123456)).toBe(i);
  });

  it('masks anything above 24 bits', () => {
    const p = new Palette();
    const i = p.ensure(0xff123456);
    expect(p.get(i)).toBe(0x123456);
  });

  it('refuses to grow past the byte-indexable limit', () => {
    const p = new Palette();
    let i = 0;
    while (p.size < MAX_COLORS) p.ensure(0x010000 + (i++));
    expect(p.size).toBe(MAX_COLORS);
    expect(p.ensure(0xabcdef)).toBe(-1);
  });

  it('prune() drops unused custom colours and remaps the rest', () => {
    const p = new Palette();
    const a = p.ensure(0xaa0000);
    const b = p.ensure(0xbb0000);
    const c = p.ensure(0xcc0000);
    const remap = p.prune(new Set([0, b]));

    expect(p.size).toBe(STANDARD_COLORS.length + 1);
    expect(remap.get(b)).toBe(STANDARD_COLORS.length);
    expect(p.get(remap.get(b))).toBe(0xbb0000);
    // standard indices never move
    for (let i = 0; i < STANDARD_COLORS.length; i++) expect(remap.get(i)).toBe(i);
    // dropped colours have no mapping
    expect(remap.has(a)).toBe(false);
    expect(remap.has(c)).toBe(false);
  });

  it('round-trips through JSON', () => {
    const p = new Palette();
    p.ensure(0x314159);
    const q = Palette.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(q.colors).toEqual(p.colors);
  });

  it('falls back to the standard set for empty input', () => {
    expect(Palette.fromJSON(null).size).toBe(STANDARD_COLORS.length);
    expect(Palette.fromJSON([]).size).toBe(STANDARD_COLORS.length);
  });

  it('clone is independent', () => {
    const p = new Palette();
    const q = p.clone();
    q.ensure(0x00ff00);
    expect(q.size).toBe(p.size + 1);
  });
});

describe('colour conversion', () => {
  it('hsv -> rgb hits the primaries', () => {
    expect(hsvToRgb(0, 1, 1)).toMatchObject({ r: 255, g: 0, b: 0 });
    const g = hsvToRgb(120, 1, 1);
    expect(Math.round(g.g)).toBe(255);
    const b = hsvToRgb(240, 1, 1);
    expect(Math.round(b.b)).toBe(255);
  });

  it('round-trips rgb -> hsv -> rgb', () => {
    for (const hex of [0xd8463c, 0x3d7ede, 0x62b558, 0xffffff, 0x000000, 0x808080]) {
      const { r, g, b } = hexToRgb(hex);
      const hsv = rgbToHsv(r, g, b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(rgbToHex(back.r, back.g, back.b)).toBe(hex);
    }
  });

  it('greys have zero saturation', () => {
    expect(rgbToHsv(128, 128, 128).s).toBeCloseTo(0, 6);
    expect(rgbToHsv(0, 0, 0).s).toBe(0);
  });

  it('css hex parses and formats', () => {
    expect(hexToCss(0x0a0b0c)).toBe('#0a0b0c');
    expect(cssToHex('#0A0B0C')).toBe(0x0a0b0c);
    expect(cssToHex('0a0b0c')).toBe(0x0a0b0c);
    expect(cssToHex('nope')).toBeNull();
    expect(cssToHex('#12345')).toBeNull();
  });
});
