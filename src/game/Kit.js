import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// ============================================================
//  The files the game ships with.
//
//  Everything in BLOSTOM used to be drawn by code — surfaces painted into
//  canvases, the sky a vertical gradient, every sound an oscillator. That
//  is a good default and it stays the fallback: nothing here is required,
//  and a machine that cannot read any of it plays exactly the game it
//  played before.
//
//  What files buy is the thing code is worst at. A photographed surface has
//  grain that nobody would sit down and write; a real night sky has shapes
//  in it that a gradient cannot have, and metal reflects shapes. Both are
//  CC0 — see LICENSES.md, which also records what was done to each file.
//
//  Loaded in the BACKGROUND, never awaited by the boot. The title screen
//  comes up on the procedural version and the arena picks these up when
//  they land, which for three megabytes off local disk is long before
//  anybody has chosen where to fight.
// ============================================================

/** Which surface painters have a photographed set to go with them. */
export const KIT_SURFACES = [
  'concrete', 'asphalt', 'stone', 'deckplate', 'saltpan', 'regolith', 'rust', 'strata',
];

/** The skies. All levelled to the same average brightness when baked. */
export const KIT_ENVS = ['dikhololo_night', 'modern_buildings_night', 'moonless_golf'];

/**
 * Sprites for the things that happen: shots, hits, thrust, dust.
 *
 * Every one is a MASK, not a picture. The game multiplies it by the colour
 * of whatever made the effect — the player's own accent for a muzzle flash,
 * the arena's dust for a puff — so two machines firing the same gun still
 * look like two machines.
 */
export const KIT_FX = [
  'muzzle', 'spark', 'flame', 'smoke', 'dirt', 'flare', 'trace', 'blob', 'scorch',
];

/**
 * The sky over the two places that have no weather.
 *
 * Space and the Moon were lit by the same painted gradient as everywhere
 * else, with drawn dots for stars and a flat circle for a planet. That reads
 * as a dark arena rather than as space, and no amount of tuning the gradient
 * fixes it: what is missing is not colour, it is that there was nothing up
 * there to look at.
 */
export const KIT_SPACE = ['milkyway', 'earth', 'moon'];

/**
 * The sky the five weather arenas are seen against.
 *
 * Each of them was a four-stop vertical gradient, chosen to agree with the
 * fog — which it does, and which is the whole of what it has. Standing on
 * the salt flat, the top half of the screen was one colour with a visible
 * band across it where two stops met.
 *
 * "Pure sky" panoramas: no ground in them, so the arena keeps the bottom of
 * its own picture and nothing fights.
 */
export const KIT_SKIES = [
  'kloppenheim_02_puresky', 'kloppenheim_07_puresky',
  'qwantani_dusk_1_puresky', 'qwantani_moon_noon_puresky',
];

/**
 * What every baked sky averages out to, in sRGB.
 *
 * The arena tints its sky to its own palette, and a tint is a multiply — so
 * the thing being multiplied has to be a known quantity, or each of the
 * five needs an exposure guessed by eye and re-guessed whenever a sky is
 * swapped.
 */
export const SKY_MEAN = 0.32;

/** The one-shot sounds. Everything else stays synthesised. */
export const KIT_SFX = [
  'fire-light', 'fire-heavy', 'hit-landed', 'hit-taken', 'boom', 'lock-on', 'lock-off',
];

/**
 * What a detail map averages out to, from the bake.
 *
 * A photograph of concrete is not white, so multiplying an arena's colour by
 * one would darken the whole place. The material scales its tint by the
 * reciprocal of this and comes out where it started.
 */
export const DETAIL_MEAN = 0.75;

const surfaces = new Map();
const envs = new Map();
const sfx = new Map();

let started = null;
const fx = new Map();
const space = new Map();
const skies = new Map();

let loaded = { surfaces: 0, envs: 0, sfx: 0, fx: 0, space: 0, skies: 0, failed: 0 };

/** Where the files sit, relative to whatever is serving the page. */
function kitURL(rel) {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`kit/${rel}`, base).toString();
}

function loadTexture(loader, rel, srgb, tiles = true) {
  return new Promise((resolve) => {
    loader.load(
      kitURL(rel),
      (tex) => {
        // A surface tiles; a sprite and a sky do not. Repeating a sprite
        // wraps its own soft edge back over itself and puts a seam down
        // the middle of every spark in the game.
        tex.wrapS = tiles ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.wrapT = tiles ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      // A missing file is not an error worth stopping for: the painted
      // version is right there and always was.
      () => { loaded.failed++; resolve(null); },
    );
  });
}

/**
 * Pull in everything, quietly.
 *
 * Idempotent: the second call gets the first call's promise. Nothing here
 * rejects — a failure leaves that entry absent and the game falls back.
 */
export function loadKit() {
  if (started) return started;
  if (typeof document === 'undefined') {
    started = Promise.resolve(false);
    return started;
  }

  const texLoader = new THREE.TextureLoader();
  const hdrLoader = new RGBELoader();

  const jobs = [];

  for (const kind of KIT_SURFACES) {
    jobs.push(Promise.all([
      loadTexture(texLoader, `surface/${kind}_detail.jpg`, true),
      loadTexture(texLoader, `surface/${kind}_rough.jpg`, false),
      loadTexture(texLoader, `surface/${kind}_normal.jpg`, false),
    ]).then(([map, roughnessMap, normalMap]) => {
      // The detail map is the one that matters; a set without it is not a
      // set, and half-applying one would look worse than not applying it.
      if (!map) return;
      surfaces.set(kind, { map, roughnessMap, normalMap });
      loaded.surfaces++;
    }));
  }

  for (const name of KIT_ENVS) {
    jobs.push(new Promise((resolve) => {
      hdrLoader.load(
        kitURL(`env/${name}.hdr`),
        (tex) => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          envs.set(name, tex);
          loaded.envs++;
          resolve();
        },
        undefined,
        () => { loaded.failed++; resolve(); },
      );
    }));
  }

  for (const name of KIT_FX) {
    jobs.push(loadTexture(texLoader, `fx/${name}.png`, true, false).then((tex) => {
      if (!tex) return;
      fx.set(name, tex);
      loaded.fx++;
    }));
  }

  for (const name of KIT_SPACE) {
    jobs.push(loadTexture(texLoader, `space/${name}.jpg`, true, false).then((tex) => {
      if (!tex) return;
      space.set(name, tex);
      loaded.space++;
    }));
  }

  for (const name of KIT_SKIES) {
    jobs.push(loadTexture(texLoader, `sky/${name}.jpg`, true, false).then((tex) => {
      if (!tex) return;
      skies.set(name, tex);
      loaded.skies++;
    }));
  }

  // Fetched now, decoded later: an AudioContext does not exist until the
  // player has clicked something, and the bytes should already be here when
  // it does.
  for (const name of KIT_SFX) {
    jobs.push(
      fetch(kitURL(`sfx/${name}.ogg`))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          /**
           * Ogg, and actually Ogg.
           *
           * Neither the status nor the length can be trusted here: asking
           * the desktop scheme for a file that is not there comes back as a
           * successful response with a body in it, so seven sounds that did
           * not exist were counted as loaded and then quietly failed to
           * decode much later, with nothing anywhere saying why.
           *
           * The four bytes at the front of the file cannot lie about it.
           */
          const head = buf && buf.byteLength >= 4 ? new Uint8Array(buf, 0, 4) : null;
          const ogg = head
            && head[0] === 0x4F && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53;
          if (!ogg) { loaded.failed++; return; }
          sfx.set(name, buf);
          loaded.sfx++;
        })
        .catch(() => { loaded.failed++; }),
    );
  }

  started = Promise.all(jobs).then(() => true);
  return started;
}

const tiled = new Map();

/**
 * The three maps for a surface at a given tiling, or null if it is not here.
 *
 * Two arenas can want the same concrete at different scales, and how often a
 * texture repeats lives on the texture rather than on the material — so that
 * needs a copy. Cached by scale as well as by surface: a copy per arena
 * BUILD would upload the same picture to the card again on every trip
 * between two places, which is what the painted version was careful not to
 * do and is no less wasteful for being a photograph.
 */
export function surfaceMaps(kind, repeat = 1) {
  const base = surfaces.get(kind);
  if (!base) return null;
  if (repeat === 1) return base;

  const key = `${kind}|${repeat}`;
  let set = tiled.get(key);
  if (!set) {
    set = {};
    for (const [slot, tex] of Object.entries(base)) {
      if (!tex) { set[slot] = null; continue; }
      const copy = tex.clone();
      copy.repeat.set(repeat, repeat);
      copy.needsUpdate = true;
      set[slot] = copy;
    }
    tiled.set(key, set);
  }
  return set;
}

/** One effect sprite, or null. */
export function fxSprite(name) {
  return fx.get(name) ?? null;
}

/** One of the photographed skies, or null. */
export function skyPanorama(name) {
  return (name && skies.get(name)) ?? null;
}

/** One of the pictures the space stages are made of, or null. */
export function spaceMap(name) {
  return space.get(name) ?? null;
}

/** A sky, or null. */
export function envMap(name) {
  return (name && envs.get(name)) ?? null;
}

/** The undecoded bytes of a sound, or null. */
export function sfxBytes(name) {
  return sfx.get(name) ?? null;
}

/** What actually arrived. For the panel that reports it, and for tests. */
export function kitStatus() {
  return { ...loaded, ready: started !== null };
}

/** Drop the lot. For tests, and for a clean shutdown. */
export function clearKit() {
  for (const set of [...surfaces.values(), ...tiled.values()]) {
    for (const tex of Object.values(set)) tex?.dispose?.();
  }
  tiled.clear();
  for (const tex of [
    ...envs.values(), ...fx.values(), ...space.values(), ...skies.values(),
  ]) tex.dispose?.();
  surfaces.clear();
  envs.clear();
  fx.clear();
  space.clear();
  skies.clear();
  sfx.clear();
  started = null;
  loaded = { surfaces: 0, envs: 0, sfx: 0, fx: 0, space: 0, skies: 0, failed: 0 };
}
