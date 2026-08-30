import * as THREE from 'three';

// ============================================================
//  The things an arena is furnished with.
//
//  Every piece of cover in a place used to be the same object at a
//  different size — eight identical slabs, or twenty-one identical towers.
//  From inside a fight that reads as a repeating pattern rather than as a
//  place, and worse, no corner is memorable: you cannot say "meet me at the
//  water tank" if everything is a rectangle.
//
//  Each kit here is a dozen silhouettes. Which one a given piece of cover
//  gets is decided by WHERE IT IS, not by a die roll, so the same arena is
//  furnished the same way every time — the same rule the fight runs under.
//
//  Every builder takes (r, h, body, trim) and returns meshes. THE FIRST ONE
//  IS THE BODY: it is what the collider is built from and what you actually
//  hide behind. Everything after it is trim, and trim must never stick out
//  past the body in a way that would let a round stop in mid-air beside it.
// ============================================================

/** A box standing on the ground, centred on the origin in x and z. */
function box(w, hh, d, mat, y = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
  m.position.y = y ?? hh / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A cylinder, likewise. `top` under `bottom` gives a taper. */
function cyl(top, bottom, hh, seg, mat, y = null) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, hh, seg), mat);
  m.position.y = y ?? hh / 2;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function ball(rad, mat, y = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 12, 9), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

/** A lit band around something, sitting just inside its footprint. */
function band(w, d, mat, y) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.34, d), mat);
  m.position.y = y;
  return m;
}

// ------------------------------------------------------------ built kits

/**
 * Poured and bolted: a testing ground, a compound, a station deck.
 *
 * The plain slab is first because it is the one everything else reads as a
 * variation OF.
 */
const BLOCK = [
  (r, h, b, t) => [box(r * 2, h, r * 2, b), band(r * 2.2, r * 2.2, t, h + 0.2)],
  // Stepped: two thirds up, then narrower. Gives cover at two heights.
  (r, h, b, t) => {
    const base = box(r * 2, h * 0.66, r * 2, b);
    const top = box(r * 1.3, h * 0.34, r * 1.3, b, h * 0.83);
    return [base, top, band(r * 1.45, r * 1.45, t, h + 0.15)];
  },
  // Tapered pylon: reads as load-bearing rather than as a wall.
  (r, h, b, t) => [cyl(r * 0.6, r * 1.15, h, 6, b), band(r * 1.4, r * 1.4, t, h * 0.9)],
  // A gantry: two legs and a beam, and you can walk under it.
  (r, h, b, t) => {
    const beam = box(r * 2.4, h * 0.18, r * 0.8, b, h * 0.91);
    const left = box(r * 0.42, h * 0.82, r * 0.7, b, h * 0.41);
    const right = left.clone();
    left.position.x = -r * 1.0;
    right.position.x = r * 1.0;
    return [beam, left, right, band(r * 2.4, r * 0.3, t, h * 0.99)];
  },
  // A drum: a tank, a silo, a fuel bunker.
  (r, h, b, t) => [cyl(r, r, h, 14, b), band(r * 2.1, r * 2.1, t, h * 0.72)],
  // Low and wide: a blast barrier. Cover you crouch behind, not hide behind.
  (r, h, b, t) => [box(r * 3, h * 0.42, r * 1.1, b), band(r * 3.05, r * 0.4, t, h * 0.42)],
  // Buttressed: a slab with fins, which changes how rounds glance off it.
  (r, h, b, t) => {
    const core = box(r * 1.6, h, r * 1.6, b);
    const fins = [0, 1, 2, 3].map((i) => {
      const f = box(r * 0.3, h * 0.7, r * 0.75, b, h * 0.35);
      f.rotation.y = (i * Math.PI) / 2;
      f.position.set(Math.cos((i * Math.PI) / 2) * r * 0.9, h * 0.35,
        Math.sin((i * Math.PI) / 2) * r * 0.9);
      return f;
    });
    return [core, ...fins, band(r * 1.7, r * 1.7, t, h + 0.15)];
  },
  // A wedge: one face you can climb, one you cannot.
  (r, h, b, t) => {
    const w = cyl(0.001, r * 1.5, h, 4, b);
    w.rotation.y = Math.PI / 4;
    return [w, band(r * 0.5, r * 0.5, t, h * 0.98)];
  },
  // A mast with a platform partway up.
  (r, h, b, t) => {
    const shaft = cyl(r * 0.34, r * 0.44, h, 8, b);
    const deck = box(r * 1.9, h * 0.06, r * 1.9, b, h * 0.62);
    return [shaft, deck, band(r * 2, r * 2, t, h * 0.66)];
  },
  // Twin slabs with a slot between them: a firing lane, or a trap.
  (r, h, b, t) => {
    const a = box(r * 0.8, h, r * 2, b);
    const c = a.clone();
    a.position.x = -r * 0.85;
    c.position.x = r * 0.85;
    return [a, c, band(r * 0.9, r * 2.1, t, h + 0.15)];
  },
  // A ring on a column: something that was for something.
  (r, h, b, t) => {
    const col = cyl(r * 0.55, r * 0.7, h, 10, b);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, r * 0.16, 8, 18), t);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h * 0.92;
    return [col, ring];
  },
  // A hopper: wide mouth, narrow foot.
  (r, h, b, t) => {
    const body = cyl(r * 1.3, r * 0.45, h * 0.7, 8, b, h * 0.35);
    const legs = box(r * 0.9, h * 0.3, r * 0.9, b, h * 0.15);
    return [body, legs, band(r * 2.6, r * 2.6, t, h * 0.7)];
  },
];

/** A city at night: everything is tall, and most of it is asleep. */
const TOWER = [
  (r, h, b, t) => {
    const shaft = box(r * 2, h, r * 2, b);
    const crown = box(r * 1.35, h * 0.14, r * 1.35, b, h * 1.07);
    return [shaft, crown, band(r * 1.45, r * 1.45, t, h * 1.15)];
  },
  // Setback twice: the shape that makes a skyline read as buildings.
  (r, h, b, t) => {
    const base = box(r * 2, h * 0.55, r * 2, b);
    const mid = box(r * 1.5, h * 0.3, r * 1.5, b, h * 0.7);
    const top = box(r * 0.95, h * 0.15, r * 0.95, b, h * 0.925);
    return [base, mid, top, band(r * 1.0, r * 1.0, t, h + 0.2)];
  },
  // Twin shafts joined by a skybridge, which is cover in the air.
  (r, h, b, t) => {
    const a = box(r * 0.85, h, r * 1.8, b);
    const c = a.clone();
    a.position.x = -r * 0.95;
    c.position.x = r * 0.95;
    const bridge = box(r * 1.2, h * 0.07, r * 0.9, b, h * 0.72);
    return [a, c, bridge, band(r * 1.2, r * 0.9, t, h * 0.76)];
  },
  // Slab tower turned side-on: a wall from one angle, a blade from another.
  (r, h, b, t) => [box(r * 3.1, h, r * 0.85, b), band(r * 3.15, r * 0.9, t, h + 0.18)],
  // Podium and shaft: what an office block actually looks like at ground level.
  (r, h, b, t) => {
    const podium = box(r * 2.8, h * 0.16, r * 2.8, b);
    const shaft = box(r * 1.5, h * 0.84, r * 1.5, b, h * 0.58);
    return [shaft, podium, band(r * 2.85, r * 2.85, t, h * 0.17)];
  },
  // A stack with a chimney.
  (r, h, b, t) => {
    const shaft = box(r * 1.8, h * 0.8, r * 1.8, b);
    const stack = cyl(r * 0.3, r * 0.38, h * 0.4, 10, b, h * 0.98);
    return [shaft, stack, band(r * 0.8, r * 0.8, t, h * 1.17)];
  },
  // Ziggurat: four setbacks, and a way up if you can jump.
  (r, h, b, t) => {
    const steps = [0, 1, 2, 3].map((i) => box(
      r * (2 - i * 0.42), h * 0.25, r * (2 - i * 0.42), b, h * (0.125 + i * 0.25),
    ));
    return [...steps, band(r * 0.5, r * 0.5, t, h + 0.16)];
  },
  // A water tank on legs, and you can shelter under it.
  (r, h, b, t) => {
    const legs = box(r * 1.4, h * 0.62, r * 1.4, b);
    const tank = cyl(r * 1.15, r * 1.15, h * 0.38, 12, b, h * 0.81);
    return [legs, tank, band(r * 2.35, r * 2.35, t, h * 0.63)];
  },
  // A billboard frame: mostly hole, and it glows.
  (r, h, b, t) => {
    const post = box(r * 0.5, h * 0.72, r * 0.5, b);
    const face = box(r * 2.6, h * 0.3, r * 0.24, b, h * 0.85);
    const lit = new THREE.Mesh(new THREE.BoxGeometry(r * 2.3, h * 0.2, r * 0.1), t);
    lit.position.set(0, h * 0.85, r * 0.16);
    return [post, face, lit];
  },
  // A dome roof: the one round thing in a city of boxes.
  (r, h, b, t) => {
    const drum = box(r * 1.9, h * 0.8, r * 1.9, b);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), b,
    );
    dome.position.y = h * 0.8;
    dome.castShadow = true;
    return [drum, dome, band(r * 2, r * 2, t, h * 0.81)];
  },
  // Antennas on a low roof: a silhouette you can name at range.
  (r, h, b, t) => {
    const roof = box(r * 2, h * 0.7, r * 2, b);
    const masts = [-0.5, 0, 0.5].map((k, i) => {
      const m = cyl(0.14, 0.2, h * (0.2 + i * 0.09), 6, b, h * (0.8 + i * 0.045));
      m.position.x = k * r;
      return m;
    });
    return [roof, ...masts, band(r * 2.05, r * 2.05, t, h * 0.71)];
  },
  // A tower that leans, because one of them should.
  (r, h, b, t) => {
    const shaft = box(r * 1.6, h, r * 1.6, b);
    shaft.rotation.z = 0.055;
    return [shaft, band(r * 1.7, r * 1.7, t, h + 0.2)];
  },
];

/** A yard: things stacked by somebody in a hurry, a long time ago. */
const CRATE = [
  (r, h, b, t) => {
    const base = box(r * 2, h, r * 2.6, b);
    return [base, band(r * 2.05, r * 0.35, t, h * 0.86)];
  },
  // The stack that is always slightly off.
  (r, h, b, t) => {
    const base = box(r * 2, h, r * 2.6, b);
    const top = box(r * 1.5, h * 0.55, r * 1.9, b, h * 1.275);
    top.position.set(r * 0.25, top.position.y, -r * 0.3);
    top.rotation.y = 0.12;
    return [base, top, band(r * 2.05, r * 0.3, t, h * 0.86)];
  },
  // Three high, and leaning.
  (r, h, b, t) => {
    const a = box(r * 2, h * 0.5, r * 2.4, b);
    const c = box(r * 1.8, h * 0.42, r * 2.2, b, h * 0.71);
    const d = box(r * 1.5, h * 0.36, r * 1.9, b, h * 1.1);
    c.rotation.y = -0.09;
    d.rotation.y = 0.16;
    d.position.x = r * 0.2;
    return [a, c, d, band(r * 1.55, r * 0.3, t, h * 1.26)];
  },
  // A silo.
  (r, h, b, t) => [cyl(r * 1.1, r * 1.1, h, 14, b), band(r * 2.3, r * 2.3, t, h * 0.9)],
  // A pipe bundle: three drums lashed together.
  (r, h, b, t) => {
    const mid = cyl(r * 0.7, r * 0.7, h, 10, b);
    const l = cyl(r * 0.5, r * 0.5, h * 0.8, 8, b, h * 0.4);
    const rr = l.clone();
    l.position.x = -r * 1.05;
    rr.position.x = r * 1.05;
    return [mid, l, rr, band(r * 1.5, r * 1.5, t, h * 0.55)];
  },
  // A skip: open on top, sloped sides.
  (r, h, b, t) => {
    const s = cyl(r * 1.45, r * 1.05, h, 4, b);
    s.rotation.y = Math.PI / 4;
    return [s, band(r * 2.1, r * 2.1, t, h * 0.96)];
  },
  // A cable spool on its side.
  (r, h, b, t) => {
    const drum = cyl(r * 0.7, r * 0.7, h, 12, b);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r * 1.3, h * 0.1, 14), b);
    cap.position.y = h * 0.95;
    cap.castShadow = true;
    const foot = cap.clone();
    foot.position.y = h * 0.05;
    return [drum, cap, foot, band(r * 1.4, r * 1.4, t, h * 0.5)];
  },
  // A gantry frame with nothing hanging off it any more.
  (r, h, b, t) => {
    const beam = box(r * 2.8, h * 0.14, r * 0.6, b, h * 0.93);
    const l = box(r * 0.34, h * 0.86, r * 0.55, b, h * 0.43);
    const rr = l.clone();
    l.position.x = -r * 1.2;
    rr.position.x = r * 1.2;
    return [beam, l, rr, band(r * 2.8, r * 0.24, t, h * 1.0)];
  },
  // A generator: a box with a duct on the roof.
  (r, h, b, t) => {
    const shell = box(r * 2.2, h * 0.8, r * 1.6, b);
    const duct = cyl(r * 0.4, r * 0.4, h * 0.5, 8, b, h * 1.05);
    return [shell, duct, band(r * 2.25, r * 0.28, t, h * 0.62)];
  },
  // Pallets: low, wide, and you shoot straight over them.
  (r, h, b, t) => {
    const a = box(r * 2.4, h * 0.36, r * 2.4, b);
    const c = box(r * 1.7, h * 0.26, r * 1.7, b, h * 0.49);
    return [a, c, band(r * 1.75, r * 1.75, t, h * 0.63)];
  },
  // A hopper on legs.
  (r, h, b, t) => {
    const legs = box(r * 1.5, h * 0.4, r * 1.5, b);
    const hopper = cyl(r * 1.35, r * 0.55, h * 0.6, 6, b, h * 0.7);
    return [legs, hopper, band(r * 2.7, r * 2.7, t, h * 0.98)];
  },
  // A container standing on its end. Somebody had a reason.
  (r, h, b, t) => [box(r * 1.2, h, r * 1.5, b), band(r * 1.25, r * 1.55, t, h * 0.94)],
];

/** Nothing here was made. No straight lines, and no lit trim at all. */
const ROCK = [
  (r, h, b) => {
    const m = cyl(r * 0.72, r * 1.12, h, 7, b);
    m.rotation.y = (r * 7.3) % Math.PI;
    m.rotation.z = ((r * 3.1) % 0.16) - 0.08;
    return [m];
  },
  // A spire: tall and thin, and it does not hide much.
  (r, h, b) => {
    const m = cyl(r * 0.18, r * 0.9, h * 1.25, 6, b);
    m.rotation.y = (r * 2.1) % Math.PI;
    return [m];
  },
  // A boulder, mostly buried.
  (r, h, b) => {
    const m = ball(r * 1.15, b, h * 0.42);
    m.scale.set(1, 0.72, 1.1);
    m.rotation.set(0.2, (r * 5.5) % Math.PI, 0.14);
    return [m];
  },
  // A tilted slab, leaning on nothing.
  (r, h, b) => {
    const m = box(r * 1.9, h, r * 0.9, b);
    m.rotation.set(0.1, (r * 4.2) % Math.PI, 0.22);
    return [m];
  },
  // A cluster: three of them, which is what talus actually looks like.
  (r, h, b) => {
    const a = cyl(r * 0.6, r * 0.95, h, 6, b);
    const c = cyl(r * 0.4, r * 0.7, h * 0.62, 5, b, h * 0.31);
    const d = cyl(r * 0.3, r * 0.5, h * 0.44, 5, b, h * 0.22);
    c.position.set(r * 1.1, c.position.y, r * 0.5);
    d.position.set(-r * 0.9, d.position.y, -r * 0.8);
    return [a, c, d];
  },
  // A hoodoo: narrow waist, cap on top.
  (r, h, b) => {
    const stem = cyl(r * 0.45, r * 0.8, h * 0.85, 7, b);
    const cap = cyl(r * 0.95, r * 0.6, h * 0.18, 7, b, h * 0.93);
    return [stem, cap];
  },
  // A ridge: long, low, and it runs one way.
  (r, h, b) => {
    const m = cyl(r * 1.1, r * 1.9, h * 0.62, 5, b);
    m.scale.set(1, 1, 0.42);
    m.rotation.y = (r * 6.1) % Math.PI;
    return [m];
  },
  // Split: two halves with a gap you can shoot through.
  (r, h, b) => {
    const a = cyl(r * 0.55, r * 0.85, h, 5, b);
    const c = cyl(r * 0.5, r * 0.8, h * 0.9, 5, b, h * 0.45);
    a.position.x = -r * 0.7;
    c.position.x = r * 0.75;
    a.rotation.z = -0.07;
    c.rotation.z = 0.09;
    return [a, c];
  },
  // Cap rock: a hard layer that outlasted what was under it.
  (r, h, b) => {
    const stem = cyl(r * 0.85, r * 1.0, h * 0.78, 8, b);
    const cap = box(r * 1.6, h * 0.22, r * 1.5, b, h * 0.89);
    cap.rotation.y = 0.3;
    return [stem, cap];
  },
  // A fin: a wall of rock, thin edge on.
  (r, h, b) => {
    const m = box(r * 2.4, h, r * 0.45, b);
    m.rotation.set(0, (r * 3.7) % Math.PI, 0.05);
    return [m];
  },
  // A mesa with a notch out of it.
  (r, h, b) => {
    const a = cyl(r * 0.9, r * 1.25, h, 7, b);
    const c = cyl(r * 0.5, r * 0.65, h * 0.5, 6, b, h * 1.05);
    c.position.x = r * 0.4;
    return [a, c];
  },
  // A pair of leaning boulders that nearly meet.
  (r, h, b) => {
    const a = ball(r * 0.85, b, h * 0.45);
    const c = ball(r * 0.7, b, h * 0.38);
    a.scale.set(1, 1.1, 0.9);
    c.scale.set(0.9, 1, 1.05);
    a.position.x = -r * 0.6;
    c.position.x = r * 0.7;
    a.rotation.z = 0.18;
    c.rotation.z = -0.2;
    return [a, c];
  },
];

/** The Moon: craters, and the few things people left behind. */
const LUNAR = [
  (r, h, b, t) => {
    const rim = cyl(r * 1.15, r * 1.45, h, 12, b, h / 2 - h * 0.15);
    const mast = cyl(0.22, 0.22, h * 0.9, 6, b, h * 0.75);
    mast.position.x = r * 0.75;
    const lamp = ball(0.55, t, h * 1.2);
    lamp.position.x = r * 0.75;
    return [rim, mast, lamp];
  },
  // A plain crater rim: most of them are nobody's.
  (r, h, b) => {
    const rim = cyl(r * 1.2, r * 1.5, h, 14, b, h / 2 - h * 0.2);
    return [rim];
  },
  // A habitat: a buried can with a dome on it.
  (r, h, b, t) => {
    const drum = cyl(r * 0.95, r * 1.0, h * 0.7, 12, b, h * 0.35);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.98, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), b,
    );
    dome.position.y = h * 0.7;
    dome.castShadow = true;
    return [drum, dome, band(r * 2, r * 0.3, t, h * 0.3)];
  },
  // A dish, pointed at something that is not here.
  (r, h, b, t) => {
    const mast = cyl(r * 0.2, r * 0.3, h, 8, b);
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), b,
    );
    dish.position.y = h * 1.05;
    dish.rotation.set(Math.PI * 0.72, 0, 0.3);
    dish.castShadow = true;
    const lamp = ball(0.3, t, h * 1.05);
    return [mast, dish, lamp];
  },
  // A lander on its legs.
  (r, h, b, t) => {
    const can = cyl(r * 0.85, r * 0.7, h * 0.6, 8, b, h * 0.62);
    const legs = [0, 1, 2, 3].map((i) => {
      const a = (i * Math.PI) / 2 + 0.4;
      const l = cyl(0.16, 0.22, h * 0.7, 5, b, h * 0.33);
      l.position.set(Math.cos(a) * r * 0.8, l.position.y, Math.sin(a) * r * 0.8);
      l.rotation.z = Math.cos(a) * 0.24;
      l.rotation.x = -Math.sin(a) * 0.24;
      return l;
    });
    return [can, ...legs, band(r * 1.4, r * 1.4, t, h * 0.92)];
  },
  // Solar wings: wide, flat, and they read from a long way off.
  (r, h, b, t) => {
    const post = cyl(r * 0.28, r * 0.34, h, 6, b);
    const wing = box(r * 3.4, h * 0.06, r * 1.1, b, h * 0.88);
    const lit = new THREE.Mesh(new THREE.BoxGeometry(r * 3.2, 0.06, r * 0.9), t);
    lit.position.y = h * 0.92;
    return [post, wing, lit];
  },
  // A boulder thrown out of a crater.
  (r, h, b) => {
    const m = ball(r * 1.0, b, h * 0.4);
    m.scale.set(1.1, 0.8, 0.95);
    m.rotation.set(0.3, (r * 4.4) % Math.PI, 0.2);
    return [m];
  },
  // A rille: a low ridge you take cover along, not behind.
  (r, h, b) => {
    const m = cyl(r * 1.3, r * 2.0, h * 0.5, 6, b);
    m.scale.set(1, 1, 0.38);
    m.rotation.y = (r * 5.9) % Math.PI;
    return [m];
  },
  // A comms mast with a beacon at the top.
  (r, h, b, t) => {
    const mast = cyl(0.2, 0.34, h * 1.4, 6, b);
    const arm = box(r * 1.2, 0.2, 0.2, b, h * 1.1);
    const lamp = ball(0.42, t, h * 1.42);
    return [mast, arm, lamp];
  },
  // A cargo pod, dropped and left.
  (r, h, b, t) => {
    const pod = box(r * 1.8, h * 0.75, r * 1.2, b);
    pod.rotation.y = 0.22;
    const cap = cyl(r * 0.6, r * 0.6, h * 0.2, 8, b, h * 0.85);
    return [pod, cap, band(r * 1.85, r * 0.26, t, h * 0.6)];
  },
  // A drill rig: a tower over a hole.
  (r, h, b, t) => {
    const frame = cyl(r * 0.3, r * 0.9, h * 1.2, 4, b);
    frame.rotation.y = Math.PI / 4;
    const deck = box(r * 1.7, h * 0.12, r * 1.7, b, h * 0.06);
    return [frame, deck, band(r * 1.75, r * 1.75, t, h * 0.13)];
  },
  // A marker: almost nothing, but you can navigate by it.
  (r, h, b, t) => {
    const post = cyl(0.16, 0.24, h, 5, b);
    const flag = box(r * 0.9, h * 0.22, 0.08, b, h * 0.9);
    flag.position.x = r * 0.45;
    const lamp = ball(0.34, t, h * 1.02);
    return [post, flag, lamp];
  },
];

/** Orbit: structure with no floor to relate it to, and no up. */
const STATION = [
  // A hull module: the plain one.
  (r, h, b, t) => {
    const can = cyl(r, r, h, 12, b);
    return [can, band(r * 2.1, r * 2.1, t, h * 0.5)];
  },
  // A truss: mostly gap, and you can shoot through it.
  (r, h, b, t) => {
    const spine = box(r * 0.4, h, r * 0.4, b);
    const rungs = [0.2, 0.45, 0.7, 0.95].map((k) => {
      const g = box(r * 1.9, h * 0.05, r * 0.3, b, h * k);
      g.rotation.y = k * 2.4;
      return g;
    });
    return [spine, ...rungs, band(r * 0.5, r * 0.5, t, h * 1.01)];
  },
  // A docking ring, and you can fly through the middle of it.
  (r, h, b, t) => {
    const hub = cyl(r * 0.45, r * 0.45, h * 0.5, 10, b, h * 0.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.5, r * 0.22, 8, 22), b);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h * 0.5;
    ring.castShadow = true;
    const lit = new THREE.Mesh(new THREE.TorusGeometry(r * 1.5, r * 0.07, 6, 22), t);
    lit.rotation.x = Math.PI / 2;
    lit.position.y = h * 0.5;
    return [hub, ring, lit];
  },
  // Solar wings, which is what a station mostly is.
  (r, h, b, t) => {
    const spine = cyl(r * 0.3, r * 0.3, h * 0.8, 8, b, h * 0.4);
    const wing = box(r * 4.2, h * 0.05, r * 1.2, b, h * 0.4);
    const lit = new THREE.Mesh(new THREE.BoxGeometry(r * 4, 0.05, r * 1.0), t);
    lit.position.y = h * 0.44;
    return [spine, wing, lit];
  },
  // A tank cluster.
  (r, h, b, t) => {
    const a = cyl(r * 0.6, r * 0.6, h, 10, b);
    const c = a.clone();
    const d = a.clone();
    c.position.set(r * 0.95, h / 2, r * 0.4);
    d.position.set(-r * 0.8, h / 2, -r * 0.6);
    return [a, c, d, band(r * 1.4, r * 1.4, t, h * 0.85)];
  },
  // A radiator panel: a flat plane edge-on, which is nearly invisible from
  // one angle and a wall from another.
  (r, h, b, t) => {
    const panel = box(r * 3.4, h, r * 0.22, b);
    const lit = new THREE.Mesh(new THREE.BoxGeometry(r * 3.2, h * 0.05, r * 0.26), t);
    lit.position.y = h * 0.82;
    return [panel, lit];
  },
  // A node hub: modules going off in every direction.
  (r, h, b, t) => {
    const core = ball(r * 0.85, b, h * 0.5);
    const arms = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(([x, , z]) => {
      const a = cyl(r * 0.32, r * 0.32, r * 1.5, 8, b, h * 0.5);
      a.rotation.z = x ? Math.PI / 2 : 0;
      a.rotation.x = z ? Math.PI / 2 : 0;
      a.position.set(x * r * 1.1, h * 0.5, z * r * 1.1);
      return a;
    });
    return [core, ...arms, band(r * 0.6, r * 0.6, t, h * 0.5 + r * 0.9)];
  },
  // A dish, pointed home.
  (r, h, b, t) => {
    const mast = cyl(r * 0.2, r * 0.24, h, 8, b);
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.25, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), b,
    );
    dish.position.y = h * 1.0;
    dish.rotation.set(Math.PI * 0.66, 0, 0.2);
    dish.castShadow = true;
    return [mast, dish, ball(0.36, t, h * 1.0)];
  },
  // A spar with pods hanging off it.
  (r, h, b, t) => {
    const spar = box(r * 0.34, h, r * 0.34, b);
    const pods = [0.28, 0.55, 0.82].map((k, i) => {
      const p = box(r * 0.85, h * 0.13, r * 0.6, b, h * k);
      p.position.x = (i % 2 ? 1 : -1) * r * 0.75;
      return p;
    });
    return [spar, ...pods, band(r * 0.44, r * 0.44, t, h * 1.01)];
  },
  // A gyro: two rings crossed.
  (r, h, b, t) => {
    const hub = ball(r * 0.5, b, h * 0.5);
    const a = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, r * 0.14, 8, 20), b);
    const c = a.clone();
    a.position.y = h * 0.5;
    c.position.y = h * 0.5;
    c.rotation.y = Math.PI / 2;
    a.castShadow = true;
    c.castShadow = true;
    return [hub, a, c, ball(0.3, t, h * 0.5)];
  },
  // A wrecked module: the same can, opened up.
  (r, h, b, t) => {
    const can = cyl(r * 0.9, r * 0.9, h * 0.7, 10, b, h * 0.35);
    can.rotation.z = 0.3;
    const shard = box(r * 1.4, h * 0.1, r * 0.5, b, h * 0.78);
    shard.rotation.set(0.4, 0.7, 0.25);
    return [can, shard, band(r * 1.9, r * 1.9, t, h * 0.06)];
  },
  // A beacon: a strut and a very bright light.
  (r, h, b, t) => {
    const post = cyl(r * 0.16, r * 0.22, h, 6, b);
    const cage = new THREE.Mesh(new THREE.TorusGeometry(r * 0.5, r * 0.08, 6, 14), b);
    cage.rotation.x = Math.PI / 2;
    cage.position.y = h * 0.96;
    return [post, cage, ball(r * 0.34, t, h * 0.96)];
  },
];

export const KITS = {
  block: BLOCK,
  tower: TOWER,
  crate: CRATE,
  rock: ROCK,
  lunar: LUNAR,
  station: STATION,
};

/**
 * Build one piece of cover.
 *
 * @param {string} kit      which set of silhouettes this place uses
 * @param {number} variant  which one; wraps, so any integer is valid
 * @param {number} r        half-width
 * @param {number} h        height
 * @param {THREE.Material} body
 * @param {THREE.Material} trim
 * @returns {THREE.Mesh[]} the body first, then trim
 */
export function buildProp(kit, variant, r, h, body, trim) {
  const set = KITS[kit] ?? BLOCK;
  const make = set[((variant % set.length) + set.length) % set.length];
  return make(r, h, body, trim);
}

/**
 * Which variant a piece of cover at (x, z) gets.
 *
 * From its own position rather than from a counter or a die: a counter ties
 * the furniture to the order the list happens to be written in, and a die
 * would furnish the same arena differently on two runs of the same seed.
 */
export function variantAt(x, z, salt = 0) {
  // A 32-bit integer mix, done with imul.
  //
  // The obvious `n * 2654435761 % p` loses precision the moment the product
  // passes 2^53, which in practice meant a dozen positions all landing on
  // the same three variants — a place furnished out of a kit of twelve that
  // only ever showed eight of them.
  let n = (Math.round(x * 8) | 0) ^ Math.imul(Math.round(z * 8) | 0, 0x27d4eb2d);
  n = Math.imul(n ^ (salt | 0), 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) % 12;
}
