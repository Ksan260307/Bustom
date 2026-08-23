import * as THREE from 'three';

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

/**
 * Build a sky and its prefiltered environment.
 *
 * The PMREM generator is disposed straight away — it is only needed to chew
 * the gradient into mips, and holding one open keeps a render target alive
 * for the life of the game for no reason.
 */
export function makeSky(renderer, palette = FIELD_SKY) {
  const texture = paintGradient(palette);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environment = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
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
