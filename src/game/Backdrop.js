import * as THREE from 'three';
import { spaceMap, fxSprite, skyPanorama, SKY_MEAN } from './Kit.js';
import { Random } from '../core/Random.js';

// ============================================================
//  What is behind the fight.
//
//  Every arena used to end at its own boundary: past the wall there was fog,
//  and past the fog there was the flat colour of the sky. That reads as "the
//  level stopped", not as "the world continues" — and it made every place
//  feel like the same box with different furniture in it, because the box
//  was all you could see.
//
//  A backdrop is a ring of silhouettes far outside the arena, plus whatever
//  belongs in the sky above it. None of it collides, none of it is lit, and
//  none of it is in the fog: it is a painted horizon, and it is meant to be
//  read as unreachable at a glance rather than approached and discovered to
//  be flat.
//
//  Drawn from a seeded generator, so a place looks the same every time.
// ============================================================

/**
 * The outline a piece of horizon is cut to.
 *
 * A quad is a rectangle, and a rectangle is not a mountain. Painted as an
 * alpha mask so the silhouette is the shape of the thing rather than the
 * shape of the polygon it is drawn on — which is the whole difference
 * between "a distant range" and "flat grey slabs floating over the edge of
 * the map", and there is no mistaking the second for the first.
 *
 * White where the horizon is solid, transparent where it is sky. Cached:
 * one mask serves every piece that uses it.
 */
const _masks = new Map();

function ridgeMask(kind, seed = 1) {
  const key = kind + '|' + seed;
  if (_masks.has(key)) return _masks.get(key);
  if (typeof document === 'undefined') return null;

  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext('2d');
  const rng = new Random(seed);
  ctx.fillStyle = '#ffffff';

  // Most masks are one filled path along the top edge: `at(t)` gives the
  // height of the horizon at that column, 0..1 from the bottom.
  const draw = (at, steps = 96) => {
    ctx.beginPath();
    ctx.moveTo(0, N);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      ctx.lineTo(t * N, N - Math.max(0, Math.min(1, at(t))) * N);
    }
    ctx.lineTo(N, N);
    ctx.closePath();
    ctx.fill();
  };

  if (kind === 'mountains') {
    // Two summits and a saddle, with small roughness on the slopes. The
    // one thing it must not have anywhere is a flat top.
    const a = rng.range(0.22, 0.42);
    const b = rng.range(0.58, 0.8);
    const ha = rng.range(0.75, 1);
    const hb = rng.range(0.5, 0.85);
    draw((t) => {
      const p1 = ha - Math.abs(t - a) * 2.6;
      const p2 = hb - Math.abs(t - b) * 2.9;
      return Math.max(p1, p2, 0) * (0.94 + Math.sin(t * 41) * 0.06);
    });
  } else if (kind === 'mesas') {
    // A flat top with steep, slightly ragged sides. This one IS mostly a
    // rectangle — that is what a mesa is — but the sides have to lean and
    // the top has to be worn.
    const lo = rng.range(0.05, 0.16);
    const hi = 1 - rng.range(0.05, 0.16);
    const top = rng.range(0.7, 0.95);
    draw((t) => {
      if (t < lo || t > hi) return 0;
      const edge = Math.min((t - lo) / 0.09, (hi - t) / 0.09, 1);
      return top * edge * (0.96 + Math.sin(t * 57) * 0.04);
    });
  } else if (kind === 'city') {
    // A strip of buildings: flat tops at wildly different heights, packed
    // shoulder to shoulder.
    let x = 0;
    while (x < 1) {
      const w = rng.range(0.06, 0.2);
      const hgt = rng.range(0.28, 1.0);
      ctx.fillRect(x * N, N - hgt * N, Math.ceil(w * N) + 1, hgt * N);
      x += w;
    }
  } else if (kind === 'industry') {
    // Low sheds, with a chimney coming out of some of them.
    let x = 0;
    while (x < 1) {
      const w = rng.range(0.12, 0.3);
      const hgt = rng.range(0.16, 0.38);
      ctx.fillRect(x * N, N - hgt * N, Math.ceil(w * N) + 1, hgt * N);
      if (rng.chance(0.42)) {
        ctx.fillRect((x + w * 0.5) * N, N - rng.range(0.62, 1) * N, 0.02 * N, N);
      }
      x += w;
    }
  } else if (kind === 'compound') {
    // Hangars: long, low, curved on top, with the odd mast.
    let x = 0;
    while (x < 1) {
      const w = rng.range(0.2, 0.4);
      const hgt = rng.range(0.25, 0.5);
      ctx.beginPath();
      ctx.moveTo(x * N, N);
      ctx.lineTo(x * N, N - hgt * N * 0.55);
      ctx.quadraticCurveTo(
        (x + w / 2) * N, N - hgt * N * 1.45, (x + w) * N, N - hgt * N * 0.55,
      );
      ctx.lineTo((x + w) * N, N);
      ctx.closePath();
      ctx.fill();
      if (rng.chance(0.35)) {
        ctx.fillRect((x + w * 0.8) * N, N - rng.range(0.7, 1) * N, 0.013 * N, N);
      }
      x += w;
    }
  } else {
    // craterWall — a low, rounded, entirely natural hump.
    const c = rng.range(0.35, 0.65);
    const k = rng.range(0.88, 1);
    draw((t) => Math.max(0, Math.cos((t - c) * Math.PI * 1.12)) * k);
  }

  /**
   * Shade the fill, keeping the outline.
   *
   * The alpha is the silhouette and stays exactly as drawn; the colour
   * channels get a vertical ramp, dark at the base and lifting toward the
   * crest. Without it every landform in the game is ONE flat colour — the
   * outline is good and the thing inside it is a paper cutout, which is
   * precisely how the salt flat and the canyon read.
   *
   * Applied in place so the alpha is untouched: `globalCompositeOperation`
   * of `source-atop` paints only where something is already drawn.
   */
  const shade = ctx.createLinearGradient(0, N, 0, 0);
  // Lifted well off black. The first try ran the base down to 0.17 and the
  // salt flat's low pale ridges simply went out — the shading has to give
  // them relief, not take them away.
  shade.addColorStop(0.00, '#737373');       // the base, in shadow
  shade.addColorStop(0.55, '#c8c8c8');
  shade.addColorStop(1.00, '#ffffff');       // the crest, catching the sky
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, N, N);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _masks.set(key, tex);
  return tex;
}

/**
 * A ridge of silhouettes right around the arena.
 *
 * The profile decides how tall and wide each piece is; the mask decides
 * what shape it is cut to. Both matter — a range of identical triangles is
 * as wrong as a range of identical rectangles.
 *
 * Everything is sunk below zero by a share of its own height. A piece
 * standing ON the ground plane, seen from inside the edge of that plane,
 * appears to float: the ground runs out before the mountain starts and you
 * can see the gap between them. Burying the foot puts the join out of sight.
 *
 * @param {number} radius     the arena's own radius
 * @param {object} opts
 * @param {number} opts.color
 * @param {string} opts.kind      which mask, and which profile
 * @param {number} [opts.count]   how many pieces
 * @param {number} [opts.spread]  how far out, as a multiple of radius
 * @param {number} [opts.opacity]
 * @param {number} [opts.seed]
 * @param {(rng: Random) => {w: number, h: number, d: number}} opts.profile
 */
function ridge(radius, {
  color, kind, count = 42, spread = 1.6, opacity = 0.5, seed = 1, profile,
}) {
  const group = new THREE.Group();
  const rng = new Random(seed);
  const geo = new THREE.PlaneGeometry(1, 1);
  // Four masks rather than one, so the same outline does not turn up four
  // times round the horizon.
  const mats = [0, 1, 2, 3].map((k) => {
    const mask = ridgeMask(kind, seed * 31 + k);
    // `map` now carries the shading and `alphaMap` the outline. They are
    // still the same canvas — three reads RGB from one and A from the
    // other, which is exactly the split that was baked into it.
    return new THREE.MeshBasicMaterial({
      color, map: mask, alphaMap: mask, transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
  });

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.03, 0.03);
    const shape = profile(rng, i, count);
    const d = radius * (spread + shape.d);
    const m = new THREE.Mesh(geo, mats[i % mats.length]);
    const sink = shape.h * 0.35;
    m.position.set(Math.cos(a) * d, shape.h / 2 - sink, Math.sin(a) * d);
    m.scale.set(shape.w, shape.h, 1);
    m.lookAt(0, m.position.y, 0);
    m.renderOrder = -2;
    group.add(m);
  }

  group.userData.dispose = () => {
    geo.dispose();
    for (const m of mats) m.dispose();
  };
  return group;
}

/**
 * Stars, on a sphere that never moves.
 *
 * Points rather than quads: a few thousand of them cost one draw call and
 * one buffer, and at this distance a star has no size worth arguing about.
 * Turned off by the fog and never lit, so they stay exactly as bright at
 * the horizon as overhead — which is what airless actually looks like.
 */
function starfield(radius, { count = 1400, seed = 7, color = 0xdfe8ff } = {}) {
  const rng = new Random(seed);
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  // Modest, because this rides with the camera. Built at six times the
  // arena it sat a thousand metres from the world's origin while the
  // camera's far plane is nine hundred — so half the sky was beyond it,
  // and which half changed as the camera moved.
  const R = radius * 2.4;

  for (let i = 0; i < count; i++) {
    // Even over the sphere: picking two angles at random crowds the poles,
    // and a night sky with a bald patch overhead looks wrong immediately.
    const z = rng.range(-1, 1);
    const t = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    pos[i * 3] = Math.cos(t) * s * R;
    pos[i * 3 + 1] = z * R;
    pos[i * 3 + 2] = Math.sin(t) * s * R;
    // Most stars are faint and a few are not. A uniform field reads as
    // noise; the bright handful is what makes it read as a sky.
    size[i] = rng.chance(0.06) ? rng.range(2.6, 4.4) : rng.range(0.7, 1.7);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));

  const mat = new THREE.PointsMaterial({
    color, size: R * 0.004, sizeAttenuation: false,
    transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = -6;
  points.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return points;
}

/**
 * A band of dust across the sky.
 *
 * One big soft quad, additive, well out past everything. It is what stops a
 * starfield from being a spray of white dots on black — the eye wants
 * somewhere for the stars to be.
 */
function nebula(radius, { color = 0x2a4a8c, seed = 11 } = {}) {
  const rng = new Random(seed);
  const group = new THREE.Group();
  const R = radius * 2.0;

  // A soft round falloff, painted once.
  //
  // A plain quad shows its own corners: five of them across the sky read as
  // five blue rectangles, which is worse than no nebula at all. The texture
  // is what makes the edge stop being an edge.
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color, map: tex, transparent: true, opacity: rng.range(0.05, 0.13),
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    });
    const a = rng.range(0, Math.PI * 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(
      Math.cos(a) * R,
      R * rng.range(-0.35, 0.6),
      Math.sin(a) * R,
    );
    m.scale.set(R * rng.range(0.7, 1.6), R * rng.range(0.4, 1.0), 1);
    m.lookAt(0, m.position.y * 0.3, 0);
    m.rotation.z = rng.range(0, Math.PI);
    m.renderOrder = -5;
    group.add(m);
  }
  group.userData.dispose = () => { geo.dispose(); tex.dispose(); };
  return group;
}

/**
 * A lit ball that lights nothing else.
 *
 * The obvious way to give a planet a night side is a directional light and
 * a Lambert material. It is also wrong here: a light in three.js belongs to
 * the SCENE, not to the group it was added to, so a sun put in the sky to
 * shade a planet lights every machine in the arena from the same direction
 * — and the arena has its own lighting, chosen per place.
 *
 * Twenty lines of shader instead. The sun direction is a constant, the
 * terminator is softened so the edge is a limb rather than a cut, and
 * nothing about it escapes this mesh.
 */
function planetMaterial(map, sun) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      sun: { value: new THREE.Vector3(...sun).normalize() },
      // Never fully black: a night side with nothing in it is a hole cut
      // out of the sky, which reads as a rendering fault rather than as
      // night.
      night: { value: 0.09 },
    },
    fog: false,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 sun;
      uniform float night;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        // Softened across a few degrees, so the terminator is a limb and
        // not a knife edge drawn across a photograph.
        float lit = smoothstep(-0.12, 0.34, dot(normalize(vN), sun));
        vec3 c = texture2D(map, vUv).rgb * mix(night, 1.0, lit);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * The whole sky, photographed.
 *
 * Drawn dots make stars and nothing else. What was missing over both of the
 * airless places was the BAND — the Milky Way is the single most obvious
 * thing in a real night sky and the reason black reads as depth rather than
 * as an unlit room.
 *
 * Inside-out sphere, unlit, behind everything. The drawn stars stay on top
 * of it: a photograph at this size has no points sharp enough to be stars,
 * and the two together are what the eye expects.
 */
function skyShell(radius, map, { tint = 0xffffff, brightness = 1 } = {}) {
  const geo = new THREE.SphereGeometry(radius * 1.86, 32, 20);
  const mat = new THREE.MeshBasicMaterial({
    map,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    color: new THREE.Color(tint).multiplyScalar(brightness),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -8;                    // behind the stars and the planet
  mesh.userData.dispose = () => { geo.dispose(); mat.dispose(); };
  return mesh;
}

/**
 * A planet, low and far off.
 *
 * One fixed landmark. Open ground with no boundary wall has nothing in it
 * to say which way is which — every direction is the same colour to the
 * same black — and this is what a wall was really for on a map this size.
 */
function planet(radius, {
  color = 0x4d7fc4, halo = 0x6fa8ff, at = [-0.55, 0.30, -0.78], size = 0.13,
  map = null, spin = 0.35, sun = [0.6, 0.35, 0.7],
} = {}) {
  const R = radius * 1.9;
  const group = new THREE.Group();
  const geo = map ? new THREE.SphereGeometry(1, 40, 28) : new THREE.CircleGeometry(1, 48);

  /**
   * A ball with a real face on it, and a night side.
   *
   * A flat disc says "there is a light over there"; a lit sphere says which
   * way the sun is, which on a map with no walls is the only thing telling
   * you which way you are facing. Lambert rather than Basic exactly for
   * that: the terminator is the whole point, and it wants a light.
   */
  const mat = map
    ? planetMaterial(map, sun)
    : new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.92, fog: false, depthWrite: false,
    });
  const disc = new THREE.Mesh(geo, mat);
  disc.scale.setScalar(R * size);
  disc.position.set(R * at[0], R * at[1], R * at[2]);
  if (map) {
    // Turned so the interesting half faces the arena, and tipped over a
    // little: a planet drawn dead upright reads as a diagram.
    disc.rotation.set(0.18, spin, 0.12);
  } else {
    disc.lookAt(0, disc.position.y * 0.4, 0);
  }
  disc.renderOrder = -3;

  /**
   * The air around it, not a plate behind it.
   *
   * The old glow was the same circle as the planet, scaled up — which was
   * fine while the planet was itself a flat circle, and became a hard-edged
   * blue dinner plate the moment there was a ball in front of it. A soft
   * sprite has no edge to give away, which is the whole job.
   */
  const soft = fxSprite('blob');
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const glow = new THREE.Mesh(soft ? glowGeo : geo, new THREE.MeshBasicMaterial({
    color: halo, map: soft, transparent: true, opacity: soft ? 0.30 : 0.16, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.setScalar(R * size * (soft ? 2.4 : 1.55));
  glow.position.copy(disc.position);
  // Always square on to the camera, or a flat glow seen edge-on vanishes
  // exactly when the planet is at its most side-lit.
  glow.lookAt(0, 0, 0);
  // AFTER the ball, not before it. A soft blob drawn first has nothing to
  // be hidden by and lies across the planet's face like a bruise; drawn
  // second it is cut away by the ball itself and what is left is the rim,
  // which is the only part of it that was ever meant to show.
  glow.renderOrder = -2;

  group.add(glow, disc);
  group.userData.dispose = () => { geo.dispose(); glowGeo.dispose(); mat.dispose(); };
  return group;
}

// ------------------------------------------------------------ the profiles

/** Blocks of wildly different heights, packed shoulder to shoulder. */
const city = (rng) => ({
  w: rng.range(10, 30),
  h: rng.range(40, 165),
  d: rng.range(0, 0.55),
});

/** Low sheds with the odd chimney, and everything the same dull height. */
const industry = (rng) => (rng.chance(0.22)
  ? { w: rng.range(3, 6), h: rng.range(60, 110), d: rng.range(0, 0.3) }
  : { w: rng.range(16, 40), h: rng.range(14, 34), d: rng.range(0, 0.4) });

/** Big flat-topped masses. A canyon is walls, not peaks. */
const mesas = (rng) => ({
  w: rng.range(40, 110),
  h: rng.range(55, 130),
  d: rng.range(0, 0.35),
});

/** A far mountain range: pointed, and very far away. */
const mountains = (rng) => ({
  w: rng.range(40, 95),
  h: rng.range(20, 60),
  d: rng.range(0, 0.5),
});

/** Crater walls: low, wide, and hardly there. */
const craterWall = (rng) => ({
  w: rng.range(50, 130),
  h: rng.range(12, 34),
  d: rng.range(0, 0.4),
});

/** A compound: hangars, masts, a fence line. */
const compound = (rng) => (rng.chance(0.18)
  ? { w: rng.range(2, 4), h: rng.range(40, 70), d: rng.range(0, 0.2) }
  : { w: rng.range(20, 44), h: rng.range(10, 26), d: rng.range(0, 0.3) });

const PROFILES = { city, industry, mesas, mountains, craterWall, compound };

/**
 * Build everything that sits behind an arena.
 *
 * @param {object} arena the arena description
 * @returns {THREE.Group} one group; call `userData.dispose()` when done
 */
/**
 * sRGB byte -> linear. The same curve the renderer uses.
 *
 * A copy of the one in Sky.js rather than an import, because the two
 * modules are the two halves of "what the sky is" and neither should have
 * to load the other to draw its own half.
 */
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * A photographed sky, tinted to the painted one it replaces.
 *
 * Same idea as the surfaces: the picture brings the SHAPE — cloud, a
 * horizon glow, depth — and the arena keeps its colour, because the colour
 * is a decision somebody made and each of the seven places is told apart by
 * it. The sky's average is a known number from the bake, so the tint is
 * simply the arena's average divided by it.
 *
 * Weighted the way the gradient covers the sphere: the horizon band is a
 * sliver and the two ends are most of it, so a flat average of the four
 * stops would report a sky several times brighter than the drawn one.
 */
function skyTint(palette, arena) {
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
  const mean = toLinear(SKY_MEAN);
  // Matched to the painted average, and no more.
  //
  // The first try lifted it 2.6x on the theory that half a photograph is
  // darker than its own average. Measured, that theory cost the salt flat
  // its night: the sky band came out at 0.42 against a painted sky whose
  // whole point was to be nearly black, and the place read as afternoon.
  const lift = arena.skyLift ?? 1;
  return new THREE.Color(
    Math.min(1, (out[0] / mean) * lift),
    Math.min(1, (out[1] / mean) * lift),
    Math.min(1, (out[2] / mean) * lift),
  );
}

export function makeBackdrop(arena) {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const parts = [];
  const R = arena.radius;
  const back = arena.backdrop ?? {};

  /**
   * The part of the backdrop that rides with the camera.
   *
   * Stars, dust and a planet are supposed to be infinitely far away, which
   * means two things: they must not parallax as you cross the arena, and
   * they must never fall outside the camera's far plane. Both are had by
   * keeping them centred on the camera — and without it, a sphere centred
   * on the world origin has half of itself past a 900-metre far plane from
   * anywhere but the middle of the map, so the sky empties and refills as
   * the camera moves or a lock swings it round.
   */
  const sky = new THREE.Group();
  sky.name = 'sky';
  group.add(sky);
  group.userData.sky = sky;

  /**
   * The sky, for the places that have one.
   *
   * Behind the ridge silhouettes and inside the fog, so it is the thing
   * they are seen AGAINST — which is what turns a row of flat cutouts into
   * a horizon.
   */
  if (!back.stars && back.sky) {
    const shot = skyPanorama(back.sky);
    if (shot) {
      const shell = skyShell(R, shot, { tint: 0xffffff });
      shell.material.color.copy(skyTint(arena.sky, arena));
      sky.add(shell);
    }
  }

  if (back.stars) {
    // The photograph carries the band; the drawn points carry the stars.
    // Neither is enough on its own — a 2k panorama has nothing in it sharp
    // enough to read as a point of light at this distance, and a spray of
    // points has no shape to it at all.
    const shot = back.sky ? spaceMap(back.sky) : null;
    if (shot) {
      sky.add(skyShell(R, shot, {
        tint: back.skyTint ?? 0xffffff,
        brightness: back.skyBrightness ?? 1,
      }));
    } else {
      sky.add(nebula(R, { color: back.nebula ?? 0x2a4a8c, seed: 11 }));
    }
    sky.add(starfield(R, {
      count: shot ? Math.round(back.stars * 0.55) : back.stars,
      seed: 7,
      color: back.starColor,
    }));
  }

  if (back.ridge) {
    parts.push(ridge(R, {
      color: back.ridgeColor ?? arena.grid,
      kind: back.ridge,
      profile: PROFILES[back.ridge] ?? mountains,
      count: back.ridgeCount ?? 42,
      spread: back.ridgeSpread ?? 1.6,
      opacity: back.ridgeOpacity ?? 0.5,
      seed: 23,
    }));
    // A second, fainter line further out. One ridge reads as a fence; two
    // at different distances read as distance.
    parts.push(ridge(R, {
      color: back.ridgeColor ?? arena.grid,
      kind: back.ridge,
      profile: PROFILES[back.ridge] ?? mountains,
      count: Math.round((back.ridgeCount ?? 42) * 0.7),
      spread: (back.ridgeSpread ?? 1.6) * 1.8,
      opacity: (back.ridgeOpacity ?? 0.5) * 0.45,
      seed: 29,
    }));
  }

  if (back.planet) {
    sky.add(planet(R, { ...back.planet, map: spaceMap(back.planet.map ?? null) }));
  }
  // A second body, for somewhere that has two things worth looking at.
  if (back.planet2) {
    sky.add(planet(R, { ...back.planet2, map: spaceMap(back.planet2.map ?? null) }));
  }

  for (const p of parts) group.add(p);
  group.userData.dispose = () => {
    for (const p of parts) p.userData.dispose?.();
    sky.traverse((o) => o.userData?.dispose?.());
  };
  return group;
}

export { PROFILES };
