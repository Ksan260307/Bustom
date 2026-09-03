import * as THREE from 'three';
import { envMap } from './Kit.js';

// ============================================================
//  The light the world sits in.
//
//  Everything metal in this game — bone shafts, plate accents, the caps on
//  the pillars — is a MeshStandardMaterial with a metalness above zero, and
//  a metal with nothing to reflect is just a dark smudge. Three lights
//  cannot fix that; only an environment can.
//
//  So the arena carries a tiny procedural sky: a vertical gradient painted
//  once into a 256-tall equirectangular canvas, run through PMREM to get the
//  roughness mips, and handed to both scenes as `scene.environment`. It
//  costs one canvas and one prefilter at boot, and it is the difference
//  between "flat shaded boxes" and "machines standing in a place".
// ============================================================

/**
 * Paint the sky. Deep overhead, bright along the horizon, cool and dark
 * below — the same shape as the arena's own fog, so reflections agree with
 * what the camera sees.
 */
function paintGradient({ top, horizon, bottom, glow }) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.00, top);
  g.addColorStop(0.42, horizon);
  g.addColorStop(0.50, glow);
  g.addColorStop(0.58, horizon);
  g.addColorStop(1.00, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The arena's palette: cold blue night with a lit horizon band. */
export const FIELD_SKY = {
  top: '#03050a',
  horizon: '#0a1220',
  glow: '#183246',
  bottom: '#05070c',
};

/** The workshop's: a shade lighter, so parts read while you build. */
export const EDITOR_SKY = {
  top: '#060a11',
  horizon: '#0f1724',
  glow: '#1f374b',
  bottom: '#080c12',
};

/** sRGB byte -> linear, the same curve the renderer uses. */
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The average colour of a painted sky, in linear light.
 *
 * Weighted the way the gradient actually covers the sphere: the horizon band
 * is a sliver of it and the two ends are most of it, so averaging the four
 * stops evenly would report a sky several times brighter than the one that
 * gets drawn.
 */
function paletteMean(palette) {
  const stops = [
    [palette.top, 0.42], [palette.horizon, 0.16],
    [palette.glow, 0.08], [palette.bottom, 0.34],
  ];
  const out = [0, 0, 0];
  for (const [hex, weight] of stops) {
    const n = parseInt(hex.slice(1), 16);
    out[0] += toLinear(((n >> 16) & 255) / 255) * weight;
    out[1] += toLinear(((n >> 8) & 255) / 255) * weight;
    out[2] += toLinear((n & 255) / 255) * weight;
  }
  return out;
}

/**
 * A photographed sky, levelled and tinted to the painted one.
 *
 * Handing the raw picture to the renderer was the obvious thing and the
 * wrong one. `scene.environment` lights EVERY material in the arena, so a
 * night photograph — grey, and several times brighter than the gradient it
 * replaced — turned a warm brown canyon grey, and the machine standing in it
 * with it. The arena's own colour is a decision somebody made; a texture
 * swap does not get to overrule it.
 *
 * So the photograph contributes its SHAPES and nothing else: scaled per
 * channel until its average is the painted sky's average, exactly. Same
 * colour, same brightness, and structure where there was a smooth wash —
 * which is the only part of it a reflection was ever going to show.
 */
function levelled(hdri, palette) {
  const src = hdri.image;
  if (!src?.data) return hdri;

  const want = paletteMean(palette);
  const n = src.width * src.height;
  const data = src.data;
  const stride = data.length / n;

  const have = [0, 0, 0];
  for (let i = 0; i < data.length; i += stride) {
    have[0] += data[i];
    have[1] += data[i + 1];
    have[2] += data[i + 2];
  }
  for (let c = 0; c < 3; c++) have[c] = Math.max(have[c] / n, 1e-6);

  const gain = [want[0] / have[0], want[1] / have[1], want[2] / have[2]];
  const out = new Float32Array(n * 4);
  for (let i = 0, j = 0; i < data.length; i += stride, j += 4) {
    out[j] = data[i] * gain[0];
    out[j + 1] = data[i + 1] * gain[1];
    out[j + 2] = data[i + 2] * gain[2];
    out[j + 3] = 1;
  }

  const tex = new THREE.DataTexture(out, src.width, src.height, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build a sky and its prefiltered environment.
 *
 * The PMREM generator is disposed straight away — it is only needed to chew
 * the gradient into mips, and holding one open keeps a render target alive
 * for the life of the game for no reason.
 */
export function makeSky(renderer, palette = FIELD_SKY, sky = null) {
  const texture = paintGradient(palette);

  /**
   * What the metal actually reflects.
   *
   * The painted gradient is right for the BACKGROUND — it is built from the
   * same numbers as the fog, so what the camera sees agrees with itself —
   * and wrong for a reflection, because a gradient has no shapes in it and a
   * reflection is made of shapes. A machine polished to a mirror finish was
   * reflecting a smooth wash of blue, which reads as no reflection at all.
   *
   * So the two are allowed to differ: the arena keeps its painted sky, and
   * hands a photographed one to the metal when it has a place for it. Space
   * and the Moon pass nothing, and that is not an omission — there is no sky
   * over either of them to reflect.
   */
  const shot = envMap(sky);
  const source = shot ? levelled(shot, palette) : texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environment = pmrem.fromEquirectangular(source).texture;
  pmrem.dispose();
  // The levelled copy has done its job the moment it is prefiltered.
  if (source !== texture) source.dispose();
  return {
    texture,
    environment,
    dispose() {
      texture.dispose();
      environment.dispose();
    },
  };
}

/**
 * A ring of distant lights around the arena.
 *
 * The horizon used to end in flat fog, which reads as "the level stopped"
 * rather than "the city is far away". These are additive quads that cost
 * nothing and give the bloom something to catch out at the edge.
 */
export function makeSkyline(radius, { count = 26, color = 0x3f8fd0 } = {}) {
  const group = new THREE.Group();
  group.name = 'skyline';

  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.06;
    const d = radius * (1.35 + (i % 3) * 0.16);
    const w = 3 + ((i * 7) % 7);
    const hgt = 18 + ((i * 13) % 54);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.cos(a) * d, hgt / 2, Math.sin(a) * d);
    m.scale.set(w, hgt, 1);
    m.lookAt(0, hgt / 2, 0);
    group.add(m);
  }

  group.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return group;
}
