import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTexture, roughnessFrom, clearTextureCache } from '../src/game/Textures.js';
import { ARENAS, ARENA_ORDER } from '../src/game/Arenas.js';

// ============================================================
//  The painted surfaces.
//
//  There is no browser here, so what a canvas would draw cannot be checked.
//  What CAN be checked is everything that would go wrong quietly: a painter
//  that does not exist for a name an arena uses, a texture that does not
//  tile, and the cache handing back a fresh canvas every time it is asked —
//  which would paint the same picture once per arena switch, for ever.
// ============================================================

/** A canvas stand-in that records nothing but answers everything. */
function fakeCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return {};
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      if (k === 'fillStyle' || k === 'strokeStyle' || k === 'lineWidth'
        || k === 'globalAlpha') return 0;
      return () => {};
    },
    set: () => true,
  });
  return { width: 0, height: 0, getContext: () => ctx };
}

describe('the surfaces an arena is made of', () => {
  beforeEach(() => {
    clearTextureCache();
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
  });
  afterEach(() => {
    clearTextureCache();
    vi.unstubAllGlobals();
  });

  it('has a painter for every surface any arena asks for', () => {
    for (const id of ARENA_ORDER) {
      const a = ARENAS[id];
      expect(makeTexture(a.floor, a.ground, a.accent), `${id} floor: ${a.floor}`).toBeTruthy();
      expect(makeTexture(a.skin, a.skinColor, a.accent), `${id} cover: ${a.skin}`).toBeTruthy();
    }
  });

  it('says so rather than guessing when there is no such painter', () => {
    expect(makeTexture('no such surface', 0x808080)).toBe(null);
  });

  it('tiles, so a 300-metre floor is not one stretched picture', () => {
    const tex = makeTexture('concrete', 0x202020, 0x40a0ff, { repeat: 24 });
    expect(tex.repeat.x).toBe(24);
    expect(tex.repeat.y).toBe(24);
    expect(tex.wrapS).toBe(tex.wrapT);
  });

  it('paints each one once, however often it is asked for', () => {
    // Six arena switches used to mean six paintings of the same concrete.
    const a = makeTexture('concrete', 0x202020, 0x40a0ff, { repeat: 24 });
    const b = makeTexture('concrete', 0x202020, 0x40a0ff, { repeat: 24 });
    expect(b).toBe(a);
    // But a different colour or tiling is a different surface.
    expect(makeTexture('concrete', 0x203040, 0x40a0ff, { repeat: 24 })).not.toBe(a);
    expect(makeTexture('concrete', 0x202020, 0x40a0ff, { repeat: 8 })).not.toBe(a);
  });

  it('gives roughness its own copy, not the colour map itself', () => {
    const tex = makeTexture('deckplate', 0x303030, 0x40a0ff);
    const rough = roughnessFrom(tex);
    expect(rough).not.toBe(tex);
    // Sharing one texture would put the colour space of one onto the other.
    expect(rough.colorSpace).not.toBe(tex.colorSpace);
    expect(roughnessFrom(tex)).toBe(rough);
    expect(roughnessFrom(null)).toBe(null);
  });

  it('draws nothing at all outside a browser', () => {
    vi.unstubAllGlobals();
    clearTextureCache();
    // The node suite builds worlds; a texture painter that threw here would
    // take every one of those tests with it.
    expect(makeTexture('concrete', 0x202020)).toBe(null);
  });
});
