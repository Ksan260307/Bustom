import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import {
  KIT_SURFACES, KIT_ENVS, KIT_SFX, KIT_FX, KIT_SPACE, KIT_SKIES, SKY_MEAN,
  loadKit, surfaceMaps, envMap, sfxBytes, fxSprite, spaceMap, skyPanorama,
  kitStatus, clearKit,
} from '../src/game/Kit.js';
import { ARENAS } from '../src/game/Arenas.js';

const KIT = 'public/kit';
const read = (p) => fs.readFileSync(path.join(KIT, p));

/**
 * Whether the outside assets have been fetched.
 *
 * They are not in the repository — they are not ours, and every one of them
 * is reproducible from a URL and a script (see tools/README.md). A clean
 * checkout therefore has none of them, and the game is built to run that
 * way: everything here has a procedural version underneath it.
 *
 * So these checks SKIP rather than fail when the files are absent. What
 * they must never do is pass quietly when the files are present and wrong,
 * which is why the skip is all-or-nothing: a half-fetched kit fails.
 */
const fetched = fs.existsSync(path.join(KIT, 'surface'));
const whenFetched = fetched ? describe : describe.skip;

// ============================================================
//  The files the game ships with.
//
//  These are checked as FILES rather than through the loader, because a
//  loader needs a document and the thing worth knowing here is whether what
//  is in the repository is what the game is going to ask for.
// ============================================================

whenFetched('everything the game asks for is actually here', () => {
  it('has three maps for every surface', () => {
    for (const kind of KIT_SURFACES) {
      for (const slot of ['detail', 'rough', 'normal']) {
        const file = path.join(KIT, 'surface', `${kind}_${slot}.jpg`);
        expect(fs.existsSync(file), `${kind}_${slot}`).toBe(true);
        // A zero-byte file loads as nothing and looks like a bug elsewhere.
        expect(fs.statSync(file).size).toBeGreaterThan(1024);
      }
    }
  });

  it('has every sky and every sound', () => {
    for (const name of KIT_ENVS) {
      expect(fs.existsSync(path.join(KIT, 'env', `${name}.hdr`)), name).toBe(true);
    }
    for (const name of KIT_SFX) {
      const file = path.join(KIT, 'sfx', `${name}.ogg`);
      expect(fs.existsSync(file), name).toBe(true);
      // Ogg, and actually Ogg: a renamed WAV plays on nothing.
      expect(read(path.join('sfx', `${name}.ogg`)).subarray(0, 4).toString()).toBe('OggS');
    }
  });

  it('has every effect sprite and every picture of space', () => {
    for (const name of KIT_FX) {
      const file = path.join(KIT, 'fx', `${name}.png`);
      expect(fs.existsSync(file), name).toBe(true);
      expect(read(path.join('fx', `${name}.png`)).subarray(1, 4).toString()).toBe('PNG');
    }
    for (const name of [...KIT_SPACE.map((n) => `space/${n}`),
      ...KIT_SKIES.map((n) => `sky/${n}`)]) {
      const file = path.join(KIT, `${name}.jpg`);
      expect(fs.existsSync(file), name).toBe(true);
      // Equirectangular, or it will not wrap onto a sphere. Read out of the
      // JPEG's own header, because a 4:3 photograph put here would stretch
      // across the sky and nothing would say so.
      const b = read(`${name}.jpg`);
      let i = 2;
      let w = 0;
      let h = 0;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8) {
          h = b.readUInt16BE(i + 5);
          w = b.readUInt16BE(i + 7);
          break;
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
      expect(w / h, `${name} is ${w}x${h}`).toBeCloseTo(2, 2);
    }
  });

  it('carries its own type, and the licence that lets it', () => {
    const css = read(path.join('font', 'fonts.css')).toString();
    expect(css).toContain("font-family: 'Inter'");
    expect(css).toContain("font-family: 'JetBrains Mono'");
    // A url relative to the PAGE rather than to the stylesheet resolves to
    // kit/font/kit/font/… and quietly loads nothing.
    expect(css).not.toContain('kit/font/');
    for (const m of css.matchAll(/url\('\.\/([^']+)'\)/g)) {
      expect(fs.existsSync(path.join(KIT, 'font', m[1])), m[1]).toBe(true);
    }
    // The Open Font License asks that its text travel with the fonts.
    for (const name of ['Inter-OFL.txt', 'JetBrainsMono-OFL.txt']) {
      const text = read(path.join('font', name)).toString();
      expect(text).toContain('SIL Open Font License');
    }
  });

  it('says where all of it came from', () => {
    const doc = fs.readFileSync('LICENSES.md', 'utf8');
    // Every shipped file has to be findable in the record. An asset whose
    // provenance is not written down is one somebody has to work out again
    // later, from nothing.
    for (const name of [...KIT_ENVS, ...KIT_SFX, ...KIT_SPACE, ...KIT_SKIES]) {
      expect(doc, name).toContain(name);
    }
    for (const kind of KIT_SURFACES) expect(doc).toContain(kind);
    expect(doc).toContain('CC0');
    // The Milky Way is the one thing here that is not CC0. Its licence asks
    // for a credit people can actually see, so the game carries one — and
    // this is the reminder that the two go together.
    expect(doc).toContain('CC BY 4.0');
    const help = fs.readFileSync('src/ui/Help.js', 'utf8');
    expect(help).toContain('S. Brunier');
    expect(help).toContain('CC BY 4.0');
  });
});

whenFetched('the environment maps', () => {
  const parse = (name) => {
    const buf = read(path.join('env', `${name}.hdr`));
    return new RGBELoader().setDataType(THREE.FloatType)
      .parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };

  it('are readable, and all at the same brightness', () => {
    const means = [];
    for (const name of KIT_ENVS) {
      const tex = parse(name);
      expect(tex.width).toBe(512);
      expect(tex.height).toBe(256);
      let sum = 0;
      for (let i = 0; i < tex.data.length; i += 4) {
        sum += tex.data[i] + tex.data[i + 1] + tex.data[i + 2];
      }
      means.push(sum / (tex.data.length / 4) / 3);
    }
    // They were shot at different times of night and one of them was fifty
    // times brighter than another. Levelled at the bake, so that swapping
    // one sky for another is not also a change of exposure.
    for (const m of means) expect(m).toBeCloseTo(0.1, 2);
  });
});

describe('the arenas that reflect a photographed sky', () => {
  it('name one that exists, and vacuum names none', () => {
    for (const [id, arena] of Object.entries(ARENAS)) {
      if (!arena.reflects) continue;
      expect(KIT_ENVS, `${id} reflects an unknown sky`).toContain(arena.reflects);
    }
    // There is no sky over either of these to reflect, and giving them one
    // would be a mistake dressed up as a feature.
    expect(ARENAS.orbit.reflects ?? null).toBe(null);
    expect(ARENAS.moon.reflects ?? null).toBe(null);
    // And every other place does have one, or half the game gained nothing.
    const lit = Object.entries(ARENAS).filter(([, a]) => a.reflects);
    expect(lit.length).toBe(Object.keys(ARENAS).length - 2);
  });
});

describe('without a document', () => {
  it('loads nothing and complains about nothing', async () => {
    clearKit();
    // Node has no document, which is exactly the shape of a machine that
    // cannot read any of this. The game has to play the game it played
    // before files existed, not fall over.
    await expect(loadKit()).resolves.toBe(false);
    expect(surfaceMaps('concrete')).toBe(null);
    expect(envMap('dikhololo_night')).toBe(null);
    expect(sfxBytes('boom')).toBe(null);
    expect(fxSprite('muzzle')).toBe(null);
    expect(spaceMap('earth')).toBe(null);
    expect(skyPanorama('kloppenheim_02_puresky')).toBe(null);
    expect(kitStatus().failed).toBe(0);
    clearKit();
  });
});

whenFetched('the drawn skies', () => {
  it('are baked to the average the arena tint is calibrated against', () => {
    // Each arena multiplies its sky by (its own palette average / SKY_MEAN).
    // The bake writes that average into the files and the game divides by
    // it; if the two numbers drift apart, all five places come out at the
    // wrong exposure at once and nothing in the picture points at why.
    const baker = fs.readFileSync('tools/bake-sky.py', 'utf8');
    const m = baker.match(/^MEAN = ([\d.]+)$/m);
    expect(m, 'bake-sky.py no longer states its target average').not.toBe(null);
    expect(Number(m[1])).toBe(SKY_MEAN);
  });

  it('is named by every arena that has weather, and by no other', async () => {
    const weather = Object.entries(ARENAS).filter(([id]) => id !== 'orbit' && id !== 'moon');
    for (const [id, arena] of weather) {
      const named = arena.backdrop?.sky ?? null;
      expect(named, `${id} has no sky`).not.toBe(null);
      expect(KIT_SKIES, `${id} names an unknown sky`).toContain(named);
    }
    // Space and the Moon name one of the space pictures instead, and must
    // never pick up a terrestrial sky by accident.
    for (const id of ['orbit', 'moon']) {
      expect(KIT_SPACE).toContain(ARENAS[id].backdrop.sky);
    }
  });
});
