import * as THREE from 'three';
import { Assembly, boneAnchor } from './Assembly.js';
import { SHAPE } from './Shapes.js';
import { BONE, EQUIP } from './constants.js';

// ============================================================
//  The machines that come with the game.
//
//  There were four, all within a metre or two of the same height, and all
//  built the same way: a torso, two or four limbs, a plate or three. Four
//  machines that differ only in leg count are one machine seen four times —
//  and as opponents they gave a run nothing to escalate WITH, because the
//  thing that makes a fight feel different is how big the other thing is.
//
//  So: twenty, across five size classes from a two-metre drone to a
//  thirty-metre siege frame. A run climbs them; the editor offers them all
//  as starting points.
//
//  ---- what a preset owes the player
//
//  1. IT STANDS UP AND MOVES. A preset that falls over is not a starting
//     point, it is a bug report. Legs get the gains and the lag the walk
//     model actually wants; anything that flies gets lift.
//  2. NO BARE CORE. The core is a metre of unpainted silver and every build
//     that leaves it showing has a bright square in its stomach.
//  3. IT READS AT A GLANCE. Size class is the first thing you should be
//     able to tell, from any angle, at any distance.
// ============================================================

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** A bone chained off another's tip, bent by `deg`. */
function bent(bone, deg) {
  _q.setFromAxisAngle(_v.set(1, 0, 0), (deg * Math.PI) / 180);
  return { pos: boneAnchor(bone.length), rot: _q.toArray() };
}

/** Turned about the vertical, for anything arranged in a ring. */
const spun = (t) => new THREE.Quaternion().setFromAxisAngle(UP, -t).toArray();

/**
 * A pair of legs, mirrored, with the joints the walk model wants.
 *
 * Every walking machine here is built from this rather than from its own
 * copy of the same twelve lines: what makes CRAWLER different from TITAN is
 * how many, how long and how thick — not a different idea about knees.
 *
 * @param {Assembly} a
 * @param {string} hipId   what the legs hang off
 * @param {object} o
 * @param {number[]} o.faces which faces of the host to hang them from
 * @param {number} o.length  thigh length; the shin follows from it
 * @param {string} o.gauge
 * @param {number} o.thigh   how wide the thigh block is
 * @param {number[]} o.foot
 * @param {number} [o.bend]  how far the knee is set back
 * @param {number} [o.gain]
 */
function legs(a, hipId, {
  faces = [0, 1], length = 1.6, gauge = 'mid', thigh = 0.65, foot = [0.75, 0.35, 1.25],
  bend = -14, gain = 1, color = 1, hipSize = null, segments = 2,
}) {
  const out = [];
  for (const face of faces) {
    const hip = a.addBlockOnFace(hipId, face, 2, {
      size: hipSize ?? [thigh * 0.4, thigh * 0.8, thigh * 0.8], shape: SHAPE.SPHERE, label: 'HIP',
    });
    const upper = a.addBoneOnFace(hip.id, 3, BONE.LEG, { length, gauge, gain });
    a.addBlockOnBone(upper.id, length * 0.45, color, {
      size: [thigh, length * 0.94, thigh * 1.08], shape: SHAPE.CAPSULE, label: 'THIGH',
    });
    let last = upper;
    for (let i = 1; i < segments; i++) {
      const seg = a.addBone(last.id, bent(last, bend), BONE.LEG, {
        length: length * 0.88, gauge, gain: gain * 0.9, lag: 0.08 * i,
      });
      a.addBlockOnBone(seg.id, 0, color, {
        size: [thigh * 0.85, thigh * 0.85, thigh * 0.85], shape: SHAPE.SPHERE, label: 'KNEE',
      });
      a.addBlockOnBone(seg.id, length * 0.44, color, {
        size: [thigh * 0.85, length * 0.84, thigh * 0.92], shape: SHAPE.CAPSULE, label: 'SHIN',
      });
      last = seg;
    }
    const pad = a.addBlock(last.id, { pos: [0, last.length * 0.92, foot[2] * 0.2] }, color, {
      size: foot, shape: SHAPE.BEVEL, label: 'FOOT',
    });
    out.push({ hip, foot: pad });
  }
  return out;
}

/**
 * A pair of arms, mirrored, ending in a hand you can hang a gun on.
 *
 * @returns {{hand: object}[]}
 */
function arms(a, hostId, {
  faces = [0, 1], length = 1.05, gauge = 'mid', thick = 0.5, color = 1,
  pauldron = [0.65, 0.8, 1.15], segments = 2,
}) {
  const out = [];
  for (const face of faces) {
    const shoulder = a.addBlockOnFace(hostId, face, 2, {
      size: pauldron, shape: SHAPE.DOME, label: 'PAULDRON',
    });
    // The SHOULDER is the joint that gives; everything past it swings with
    // the arm. One reduced bone per side, which is what makes an arm read
    // as an arm rather than as a stick on a hinge.
    let last = a.addBoneOnFace(shoulder.id, 3, BONE.ARM, { length, gauge, gain: 0.4 });
    a.addBlockOnBone(last.id, length * 0.45, color, {
      size: [thick, length * 0.95, thick], shape: SHAPE.CAPSULE, label: 'UPPER ARM',
    });
    for (let i = 1; i < segments; i++) {
      const seg = a.addBone(last.id, bent(last, 12), BONE.ARM, {
        length: length * 0.9, gauge: 'thin', gain: 1, lag: 0.1 * i,
      });
      a.addBlockOnBone(seg.id, length * 0.42, color, {
        size: [thick * 0.9, length * 0.86, thick * 0.9], shape: SHAPE.CAPSULE, label: 'FOREARM',
      });
      last = seg;
    }
    const hand = a.addBlockOnBone(last.id, 1, color, {
      size: [thick, thick, thick * 1.1], shape: SHAPE.BEVEL, label: 'HAND',
    });
    out.push({ hand, shoulder });
  }
  return out;
}

/**
 * Shapes that actually fill the box they are given.
 *
 * A cone, a wedge, a frustum, an octahedron — anything that tapers — has to
 * be very much bigger than the core before its faces clear the core's
 * CORNERS, and at preset scale that means a hull four times the size of the
 * thing it is hiding. Five of the twenty machines here were first built with
 * one and every one of them had a bright silver corner poking out.
 *
 * A sphere is allowed, and has the same problem in a milder form: it is only
 * safe when it is comfortably wider than the core in all three directions.
 */
const FILLS_ITS_BOX = new Set([
  SHAPE.BOX, SHAPE.BEVEL, SHAPE.HEX, SHAPE.CYLINDER, SHAPE.SPHERE,
]);

/**
 * A hull that wraps the core, so no bare silver shows anywhere.
 *
 * The shape is checked here rather than left to a test, because "which
 * shapes can cover a box" is a fact about the shapes and belongs next to
 * the code that relies on it.
 */
function hull(a, core, size, shape = SHAPE.BEVEL, color = 1, label = 'HULL') {
  if (!FILLS_ITS_BOX.has(shape)) {
    throw new Error(
      `${label}: ${shape} tapers, so it cannot cover the core. `
      + 'Wrap the core in a box-filling shape and put the taper on top of it.',
    );
  }
  return a.addBlock(core.id, { pos: [0, 0, 0] }, color, { size, shape, label });
}

/** Thrusters arranged round the back of something. */
function thrusters(a, hostId, count, radius, size, y = 0) {
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const pod = a.addBlock(hostId, {
      pos: [Math.cos(t) * radius, y + Math.sin(t) * radius * 0.4, -radius * 0.6],
      rot: spun(t),
    }, 2, { size: [size, size, size * 1.3], shape: SHAPE.CYLINDER, label: 'THRUSTER' });
    a.addEquipOnFace(pod.id, 5, EQUIP.BOOST, { size: size * 0.8 });
  }
}

/** Free-floating bits on a ring, the way FUNNEL carries them. */
function bits(a, core, { count = 6, radius = 1.9, size = [0.5, 0.3, 0.9], weapon = EQUIP.SHOT }) {
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const bit = a.addBlock(core.id, {
      pos: [Math.cos(t) * radius, 0.35 + Math.sin(t * 2) * radius * 0.16, Math.sin(t) * radius],
      rot: spun(t),
    }, 15, { size, shape: SHAPE.PRISM, label: 'BIT' });
    if (i % 2 === 0) {
      a.addEquipOnFace(bit.id, 2, EQUIP.ROLLING, {
        size: size[0] * 0.8, spin: { dir: i % 4 === 0 ? 1 : -1, rpm: 90 },
      });
    } else {
      a.addEquipOnFace(bit.id, 2, weapon, { size: size[0] * 0.8 });
    }
  }
}

// ============================================================
//  TINY — two to three metres. A person could pick one up.
// ============================================================

/** GNAT: a flying eye with one gun. The smallest thing that fights. */
export function presetGnat() {
  const a = new Assembly('GNAT');
  const core = a.addCore();
  // A bevelled box, not an octahedron. A tapering shape has to be far
  // bigger than the core before its faces clear the core's corners, and at
  // this size that would stop it being the smallest machine in the game.
  const pod = hull(a, core, [1.3, 1.2, 1.4], SHAPE.BEVEL, 9, 'POD');
  const lens = a.addBlockOnFace(pod.id, 4, 15, { size: [0.5, 0.35, 0.18], shape: SHAPE.DISH });
  a.addEquipOnFace(lens.id, 4, EQUIP.SHOT, { size: 0.3 });
  a.addEquipOnFace(pod.id, 5, EQUIP.BOOST, { size: 0.45 });
  a.addEquipOnFace(pod.id, 2, EQUIP.FLOAT, { size: 0.4 });
  for (const face of [0, 1]) {
    const fin = a.addBlockOnFace(pod.id, face, 2, {
      size: [0.22, 0.5, 0.75], shape: SHAPE.WEDGE, label: 'FIN',
    });
    a.addEquipOnFace(fin.id, 5, EQUIP.BOOST, { size: 0.28 });
  }
  return a;
}

/** MITE: two legs, no arms, and a gun where its head should be. */
export function presetMite() {
  const a = new Assembly('MITE');
  const core = a.addCore();
  const body = hull(a, core, [1.25, 1.2, 1.3], SHAPE.BEVEL, 1, 'BODY');
  const cap = a.addBlockOnFace(body.id, 2, 15, { size: [0.55, 0.3, 0.55], shape: SHAPE.DOME });
  a.addEquipOnFace(cap.id, 4, EQUIP.SHOT, { size: 0.35 });
  legs(a, body.id, {
    length: 0.85, gauge: 'thin', thigh: 0.34, foot: [0.42, 0.2, 0.66], gain: 1.2,
  });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 0.4 });
  return a;
}

/** SPARK: three bits round a marble. No body to speak of. */
export function presetSpark() {
  const a = new Assembly('SPARK');
  const core = a.addCore();
  // Big enough to swallow the core whole. A sphere's surface pulls away from
  // the corners of the box inside it, so it has to be wider than the core in
  // every direction before the corners are covered — 1.2 against a 1m core
  // left twenty of the twenty-six test points in the open.
  const shell = hull(a, core, [1.8, 1.75, 1.8], SHAPE.SPHERE, 9, 'SHELL');
  a.addEquipOnFace(shell.id, 2, EQUIP.FLOAT, { size: 0.45 });
  a.addEquipOnFace(shell.id, 5, EQUIP.BOOST, { size: 0.5 });
  bits(a, core, { count: 3, radius: 1.15, size: [0.34, 0.22, 0.6] });
  return a;
}

/** TICK: all blade, and it has to reach you to be worth anything. */
export function presetTick() {
  const a = new Assembly('TICK');
  const core = a.addCore();
  // A wedge cuts a whole corner off, so it can never cover a box on its own.
  // The wedge goes on the FRONT of a hull that does.
  const body = hull(a, core, [1.2, 1.15, 1.25], SHAPE.BEVEL, 5, 'BODY');
  const prow = a.addBlockOnFace(body.id, 4, 5, {
    size: [1.0, 0.9, 0.9], shape: SHAPE.WEDGE, label: 'PROW',
  });
  a.addEquipOnFace(prow.id, 4, EQUIP.BLADE, { size: 0.5 });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 0.55 });
  legs(a, body.id, {
    length: 0.7, gauge: 'thin', thigh: 0.3, foot: [0.34, 0.18, 0.5], gain: 1.4, color: 5,
  });
  return a;
}

// ============================================================
//  SMALL — four to six metres. Head height on a STRIDER.
// ============================================================

/** POGO: one leg and a lot of nerve. */
export function presetHopper() {
  const a = new Assembly('POGO');
  const core = a.addCore();
  const pod = hull(a, core, [1.5, 1.4, 1.6], SHAPE.BEVEL, 1, 'POD');
  const cap = a.addBlockOnFace(pod.id, 2, 2, { size: [1.1, 0.4, 1.2], shape: SHAPE.DOME });

  // Two bits, circling the cap. The plate draws a line at 1.5m level with
  // the top of the cap and the bits sit ON it — hanging them in mid-air is
  // a good deal less convincing for something with no visible support.
  const RING = 1.5;
  a.addEquipOnFace(cap.id, 2, EQUIP.CIRCLE, {
    size: 0.6, ringRadius: RING, spin: { dir: 1, rpm: 40 },
  });
  for (const side of [-1, 1]) {
    const bit = a.addBlock(pod.id, { pos: [side * RING, 1.1, 0] }, 15, {
      size: [0.4, 0.4, 0.8], shape: SHAPE.PRISM, label: 'BIT',
    });
    a.addEquipOnFace(bit.id, 4, EQUIP.BEAM, { size: 0.4 });
  }

  const eye = a.addBoneOnFace(pod.id, 4, BONE.FACE, { length: 0.6, gauge: 'thin' });
  const lens = a.addBlockOnBone(eye.id, 0.4, 1, { size: [0.9, 0.6, 0.6], shape: SHAPE.DOME });
  a.addBlockOnFace(lens.id, 4, 15, { size: [0.6, 0.3, 0.15], shape: SHAPE.DISH });
  a.addEquipOnFace(lens.id, 2, EQUIP.SHOT, { size: 0.5 });

  for (const face of [0, 1]) {
    const fin = a.addBlock(pod.id, {
      pos: [(face === 0 ? -1 : 1) * 0.7, 0.1, -0.75],
    }, 2, { size: [0.3, 0.9, 0.8], shape: SHAPE.WEDGE });
    a.addEquipOnFace(fin.id, 5, EQUIP.BOOST, { size: 0.45 });
  }
  arms(a, pod.id, {
    length: 0.9, gauge: 'thin', thick: 0.35, pauldron: [0.4, 0.5, 0.6], segments: 1,
  }).forEach(({ hand }) => a.addEquipOnFace(hand.id, 4, EQUIP.BLADE, { size: 0.4 }));

  // One leg, folded, with a dish for a foot: it lands rather than walks.
  const leg = a.addBoneOnFace(pod.id, 3, BONE.LEG, { length: 1.3, gauge: 'mid', gain: 1.1 });
  a.addBlockOnBone(leg.id, 0.65, 2, { size: [0.5, 1.2, 0.5], shape: SHAPE.CAPSULE });
  const shank = a.addBone(leg.id, bent(leg, -16), BONE.LEG, {
    length: 1, gauge: 'thin', gain: 1, lag: 0.06,
  });
  a.addBlockOnBone(shank.id, 0, 9, { size: [0.45, 0.45, 0.45], shape: SHAPE.SPHERE });
  const pad = a.addBlockOnBone(shank.id, 1, 2, { size: [1.3, 0.35, 1.3], shape: SHAPE.DISH });
  a.addEquipOnFace(pad.id, 3, EQUIP.MISSILE, { size: 0.45 });
  return a;
}

/** DART: a flyer built round its thrusters. Fast, thin, and made of glass. */
export function presetDart() {
  const a = new Assembly('DART');
  const core = a.addCore();
  const fuselage = hull(a, core, [1.25, 1.2, 2.6], SHAPE.HEX, 9, 'FUSELAGE');
  const nose = a.addBlockOnFace(fuselage.id, 4, 15, {
    size: [1.0, 0.9, 1.4], shape: SHAPE.CONE, label: 'NOSE',
  });
  a.addEquipOnFace(nose.id, 4, EQUIP.BEAM, { size: 0.45 });
  for (const face of [0, 1]) {
    const wing = a.addBlockOnFace(fuselage.id, face, 2, {
      size: [1.5, 0.18, 1.1], shape: SHAPE.WEDGE, label: 'WING',
    });
    a.addEquipOnFace(wing.id, 5, EQUIP.BOOST, { size: 0.4 });
    a.addEquipOnFace(wing.id, 3, EQUIP.MISSILE, { size: 0.35 });
  }
  a.addEquipOnFace(fuselage.id, 2, EQUIP.FLOAT, { size: 0.55 });
  a.addEquipOnFace(fuselage.id, 5, EQUIP.BOOST, { size: 0.7 });
  return a;
}

/** SCARAB: four short legs under a shell. Low, and hard to knock over. */
export function presetScarab() {
  const a = new Assembly('SCARAB');
  const core = a.addCore();
  const body = hull(a, core, [1.4, 1.15, 1.5], SHAPE.BEVEL, 2, 'BODY');
  const shell = a.addBlockOnFace(body.id, 2, 2, {
    size: [2.0, 0.8, 2.3], shape: SHAPE.DOME, label: 'SHELL',
  });
  const turret = a.addBlockOnFace(shell.id, 2, 1, {
    size: [0.9, 0.55, 1.0], shape: SHAPE.HEX, label: 'TURRET',
  });
  a.addEquipOnFace(turret.id, 4, EQUIP.GATLING, { size: 0.5 });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 0.5 });
  for (const z of [0.7, -0.7]) {
    const rail = a.addBlock(body.id, { pos: [0, -0.4, z] }, 2, {
      size: [1.9, 0.3, 0.4], shape: SHAPE.BEVEL, label: 'RAIL',
    });
    legs(a, rail.id, {
      length: 0.8, gauge: 'thin', thigh: 0.32, foot: [0.4, 0.2, 0.6], gain: 1.1, color: 2,
    });
  }
  return a;
}

/** PIP: a gun on a skirt. It does not walk; it holds ground. */
export function presetPip() {
  const a = new Assembly('PIP');
  const core = a.addCore();
  const body = hull(a, core, [1.3, 1.25, 1.35], SHAPE.BEVEL, 2, 'BODY');
  const skirt = a.addBlockOnFace(body.id, 3, 2, {
    size: [2.1, 0.8, 2.1], shape: SHAPE.FRUSTUM, label: 'SKIRT',
  });
  const ring = a.addBlockOnFace(body.id, 2, 1, {
    size: [1.3, 0.4, 1.3], shape: SHAPE.CYLINDER, label: 'RING',
  });
  const mantlet = a.addBlockOnFace(ring.id, 2, 1, {
    size: [1.1, 0.7, 1.4], shape: SHAPE.BEVEL, label: 'MANTLET',
  });
  a.addEquipOnFace(mantlet.id, 4, EQUIP.SNIPER, { size: 0.55 });
  a.addEquipOnFace(mantlet.id, 2, EQUIP.MISSILE, { size: 0.4 });
  a.addEquipOnFace(skirt.id, 3, EQUIP.FLOAT, { size: 0.6 });
  a.addEquipOnFace(skirt.id, 5, EQUIP.BOOST, { size: 0.5 });
  return a;
}

// ============================================================
//  MEDIUM — eight to twelve metres. The default scale.
// ============================================================

/** STRIDER: the two-legged one, and the shape most people picture. */
export function presetBiped() {
  const a = new Assembly('STRIDER');
  const core = a.addCore();

  // The waist twists against the pelvis, which is most of what makes a walk
  // read as a walk. It carries the chest rather than sitting under the legs:
  // a bone on a downward face flips its frame, and everything under it would
  // then have to be built upside down.
  const spine = a.addBoneOnFace(core.id, 2, BONE.CUSTOM, {
    length: 0.4, gauge: 'thick', limit: 30,
    custom: { axis: 'y', wave: 'sine', amp: 16, freq: 1, phase: 0, offset: 0, source: 'stride' },
  });
  const chest = a.addBlockOnBone(spine.id, 0.5, 1, {
    size: [1.75, 1.25, 1.3], shape: SHAPE.BEVEL, label: 'CHEST',
  });
  a.addBlockOnFace(chest.id, 4, 15, { size: [0.5, 0.25, 0.25], shape: SHAPE.PRISM, label: 'VENT' });

  const belly = a.addBlock(core.id, { pos: [0, -0.15, 0] }, 2, {
    size: [1.15, 1.1, 1.15], label: 'BELLY',
  });
  const pelvis = a.addBlockOnFace(belly.id, 3, 1, {
    size: [1, 0.6, 1.2], shape: SHAPE.BEVEL, label: 'PELVIS',
  });

  const neck = a.addBoneOnFace(chest.id, 2, BONE.FACE, { length: 0.4, gauge: 'thin' });
  const skull = a.addBlockOnBone(neck.id, 0.35, 1, {
    size: [0.9, 0.8, 1], shape: SHAPE.HEX, label: 'HEAD',
  });
  a.addBlockOnFace(skull.id, 4, 15, { size: [0.6, 0.25, 0.1] });

  arms(a, chest.id, { length: 1.05, thick: 0.5 })
    .forEach(({ hand }) => a.addEquipOnFace(hand.id, 4, EQUIP.GATLING, { size: 0.5 }));
  legs(a, pelvis.id, { length: 1.6, thigh: 0.65, foot: [0.75, 0.35, 1.25] });

  a.addEquipOnFace(chest.id, 1, EQUIP.MISSILE, { size: 0.7 });
  a.addEquipOnFace(chest.id, 5, EQUIP.BOOST, { size: 0.8 });
  return a;
}

/** CRAWLER: six legs and a low body. It comes all the way in. */
export function presetMultileg() {
  const a = new Assembly('CRAWLER');
  const core = a.addCore();
  const body = hull(a, core, [2.2, 1.0, 3.0], SHAPE.BEVEL, 2, 'BODY');
  const back = a.addBlockOnFace(body.id, 2, 1, {
    size: [1.5, 0.6, 2.0], shape: SHAPE.DOME, label: 'BACK',
  });
  const head = a.addBlockOnFace(body.id, 4, 1, {
    size: [1.0, 0.7, 0.9], shape: SHAPE.HEX, label: 'HEAD',
  });
  a.addBlockOnFace(head.id, 4, 15, { size: [0.7, 0.2, 0.12], shape: SHAPE.DISH });
  a.addEquipOnFace(head.id, 4, EQUIP.SPREAD, { size: 0.5 });
  a.addEquipOnFace(back.id, 2, EQUIP.MISSILE, { size: 0.5 });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 0.6 });

  // Heavy enough that it gives up flight for armour — the one machine in
  // the set that trades that way, and the reason a GRAVITY plate exists.
  a.addEquipOnFace(back.id, 2, EQUIP.GRAVITY, { size: 0.6 });

  const tail = a.addBoneOnFace(body.id, 5, BONE.CUSTOM, {
    length: 2.2,
    gauge: 'thin',
    custom: { axis: 'x', amp: 24, freq: 1.6, phase: 0, source: 'speed' },
  });
  a.addBlockOnBone(tail.id, 0.9, 2, { size: [0.3, 1.6, 0.3], shape: SHAPE.CAPSULE });
  const tip = a.addBlockOnBone(tail.id, 1.9, 15, { size: [0.45, 0.6, 0.45], shape: SHAPE.OCTA });
  a.addEquipOnFace(tip.id, 2, EQUIP.BEAM, { size: 0.45 });

  for (const z of [1.1, -1.1]) {
    const rail = a.addBlock(body.id, { pos: [0, -0.15, z] }, 2, {
      size: [2.1, 0.35, 0.5], shape: SHAPE.BEVEL, label: 'RAIL',
    });
    legs(a, rail.id, {
      length: 1.1, gauge: 'thin', thigh: 0.4, foot: [0.5, 0.24, 0.8], gain: 1.05, color: 2,
    });
  }
  return a;
}

/** FUNNEL: a ball, a ring of bits, and one leg to land on. */
export function presetBits() {
  const a = new Assembly('FUNNEL');
  const core = a.addCore();
  const shell = hull(a, core, [2.1, 2.0, 2.1], SHAPE.SPHERE, 1, 'SHELL');
  const crown = a.addBlockOnFace(shell.id, 2, 9, { size: [1.1, 0.6, 1.1], shape: SHAPE.DOME });
  a.addBlockOnFace(crown.id, 4, 15, { size: [0.5, 0.25, 0.2], shape: SHAPE.DISH });
  a.addEquipOnFace(crown.id, 4, EQUIP.BEAM, { size: 0.5 });
  a.addEquipOnFace(shell.id, 5, EQUIP.BOOST, { size: 0.7 });
  // A skirt of vanes round the middle. Without it FUNNEL came out lighter
  // than every SMALL machine while being classed MEDIUM, which makes the
  // classes labels rather than facts.
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.5;
    a.addBlock(shell.id, {
      pos: [Math.cos(t) * 1.0, -0.35, Math.sin(t) * 1.0], rot: spun(t),
    }, 2, { size: [0.55, 0.4, 0.95], shape: SHAPE.WEDGE, label: 'VANE' });
  }
  bits(a, core, { count: 8, radius: 2.1, size: [0.55, 0.34, 1.0] });

  const leg = a.addBoneOnFace(shell.id, 3, BONE.LEG, { length: 1.3, gauge: 'mid', gain: 1.1 });
  a.addBlockOnBone(leg.id, 0.65, 2, { size: [0.5, 1.2, 0.5], shape: SHAPE.CAPSULE });
  const shank = a.addBone(leg.id, bent(leg, -16), BONE.LEG, {
    length: 1, gauge: 'thin', gain: 1, lag: 0.06,
  });
  a.addBlockOnBone(shank.id, 0, 9, { size: [0.45, 0.45, 0.45], shape: SHAPE.SPHERE });
  const pad = a.addBlockOnBone(shank.id, 1, 2, { size: [1.3, 0.35, 1.3], shape: SHAPE.DISH });
  a.addEquipOnFace(pad.id, 3, EQUIP.MISSILE, { size: 0.45 });
  return a;
}

/** LANCE: a biped built around one long gun it has to stand still to use. */
export function presetLance() {
  const a = new Assembly('LANCE');
  const core = a.addCore();
  const chest = hull(a, core, [1.5, 1.5, 1.4], SHAPE.HEX, 9, 'CHEST');
  const pelvis = a.addBlockOnFace(chest.id, 3, 1, {
    size: [0.95, 0.55, 1.1], shape: SHAPE.BEVEL, label: 'PELVIS',
  });
  const head = a.addBlockOnFace(chest.id, 2, 1, {
    size: [0.7, 0.55, 0.8], shape: SHAPE.WEDGE, label: 'HEAD',
  });
  a.addBlockOnFace(head.id, 4, 15, { size: [0.5, 0.16, 0.1], shape: SHAPE.DISH });

  // The gun is an arm's worth of machine on its own, braced to the shoulder.
  const brace = a.addBlockOnFace(chest.id, 0, 2, {
    size: [0.6, 0.7, 1.0], shape: SHAPE.DOME, label: 'BRACE',
  });
  const barrel = a.addBlockOnFace(brace.id, 4, 2, {
    size: [0.45, 0.45, 3.2], shape: SHAPE.CYLINDER, label: 'BARREL',
  });
  a.addEquipOnFace(barrel.id, 4, EQUIP.SNIPER, { size: 0.6 });
  arms(a, chest.id, { faces: [1], length: 1.0, thick: 0.45 })
    .forEach(({ hand }) => a.addEquipOnFace(hand.id, 4, EQUIP.SHOT, { size: 0.45 }));

  legs(a, pelvis.id, { length: 1.7, thigh: 0.6, foot: [0.85, 0.35, 1.4] });
  a.addEquipOnFace(chest.id, 5, EQUIP.BOOST, { size: 0.7 });
  a.addEquipOnFace(chest.id, 2, EQUIP.TANK, { size: 0.5 });
  return a;
}

/** TURTLE: four legs under a slab of armour. Slow, and hard to move. */
export function presetTurtle() {
  const a = new Assembly('TURTLE');
  const core = a.addCore();
  const body = hull(a, core, [2.6, 1.4, 2.8], SHAPE.BEVEL, 2, 'BODY');
  const carapace = a.addBlockOnFace(body.id, 2, 1, {
    size: [2.8, 0.9, 3.0], shape: SHAPE.DOME, label: 'CARAPACE',
  });
  const head = a.addBlockOnFace(body.id, 4, 1, {
    size: [0.9, 0.8, 0.9], shape: SHAPE.HEX, label: 'HEAD',
  });
  a.addEquipOnFace(head.id, 4, EQUIP.SPREAD, { size: 0.55 });
  a.addEquipOnFace(carapace.id, 2, EQUIP.SHIELD, { size: 0.7 });
  a.addEquipOnFace(carapace.id, 0, EQUIP.MISSILE, { size: 0.5 });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 0.6 });
  for (const z of [0.9, -0.9]) {
    const rail = a.addBlock(body.id, { pos: [0, -0.3, z] }, 2, {
      size: [2.5, 0.4, 0.6], shape: SHAPE.BEVEL, label: 'RAIL',
    });
    legs(a, rail.id, {
      length: 1.15, gauge: 'thick', thigh: 0.55, foot: [0.7, 0.3, 1.0], gain: 0.9, color: 2,
    });
  }
  return a;
}

// ============================================================
//  LARGE — fifteen to twenty metres. It looks down at a STRIDER.
// ============================================================

/** TITAN: a STRIDER at twice the size, and built like a building. */
export function presetTitan() {
  const a = new Assembly('TITAN');
  const core = a.addCore();
  const chest = hull(a, core, [3.4, 2.6, 2.8], SHAPE.BEVEL, 1, 'CHEST');
  const collar = a.addBlockOnFace(chest.id, 2, 2, {
    size: [3.0, 0.7, 2.4], shape: SHAPE.DOME, label: 'COLLAR',
  });
  const head = a.addBlockOnFace(collar.id, 2, 1, {
    size: [1.1, 1.0, 1.2], shape: SHAPE.HEX, label: 'HEAD',
  });
  a.addBlockOnFace(head.id, 4, 15, { size: [0.8, 0.24, 0.14], shape: SHAPE.DISH });
  const pelvis = a.addBlockOnFace(chest.id, 3, 1, {
    size: [2.2, 1.2, 2.2], shape: SHAPE.BEVEL, label: 'PELVIS',
  });

  arms(a, chest.id, { length: 2.2, gauge: 'thick', thick: 1.0, pauldron: [1.3, 1.6, 2.2] })
    .forEach(({ hand }, i) => a.addEquipOnFace(
      hand.id, 4, i === 0 ? EQUIP.GATLING : EQUIP.BEAM, { size: 0.9 },
    ));
  legs(a, pelvis.id, {
    length: 3.2, gauge: 'thick', thigh: 1.3, foot: [1.6, 0.7, 2.6], gain: 0.85,
  });

  a.addEquipOnFace(collar.id, 2, EQUIP.MISSILE, { size: 1.0 });
  a.addEquipOnFace(chest.id, 5, EQUIP.BOOST, { size: 1.2 });
  a.addEquipOnFace(chest.id, 0, EQUIP.TANK, { size: 0.8 });
  return a;
}

/** SPIDER: six long legs and a body slung between them. */
export function presetSpider() {
  const a = new Assembly('SPIDER');
  const core = a.addCore();
  const body = hull(a, core, [3.2, 1.6, 4.0], SHAPE.HEX, 2, 'BODY');
  const dome = a.addBlockOnFace(body.id, 2, 1, {
    size: [2.4, 1.1, 2.6], shape: SHAPE.DOME, label: 'DOME',
  });
  a.addEquipOnFace(dome.id, 2, EQUIP.MISSILE, { size: 0.8 });
  const head = a.addBlockOnFace(body.id, 4, 1, {
    size: [1.3, 1.0, 1.2], shape: SHAPE.WEDGE, label: 'HEAD',
  });
  a.addEquipOnFace(head.id, 4, EQUIP.GATLING, { size: 0.7 });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 0.9 });

  for (const z of [1.4, 0, -1.4]) {
    const rail = a.addBlock(body.id, { pos: [0, 0.1, z] }, 2, {
      size: [3.0, 0.5, 0.7], shape: SHAPE.BEVEL, label: 'RAIL',
    });
    legs(a, rail.id, {
      length: 2.6, gauge: 'mid', thigh: 0.55, foot: [0.6, 0.3, 1.1],
      gain: 1.0, bend: -24, color: 2,
    });
  }
  return a;
}

/** HAULER: a gun platform on a skirt, with everything bolted to the roof. */
export function presetHauler() {
  const a = new Assembly('HAULER');
  const core = a.addCore();
  const hullBlock = hull(a, core, [4.2, 2.0, 5.4], SHAPE.BEVEL, 2, 'HULL');
  const deck = a.addBlockOnFace(hullBlock.id, 2, 1, {
    size: [3.4, 0.6, 4.4], shape: SHAPE.BEVEL, label: 'DECK',
  });
  const skirt = a.addBlockOnFace(hullBlock.id, 3, 2, {
    size: [4.6, 1.0, 5.6], shape: SHAPE.FRUSTUM, label: 'SKIRT',
  });
  a.addEquipOnFace(skirt.id, 3, EQUIP.FLOAT, { size: 1.1 });
  a.addEquipOnFace(hullBlock.id, 5, EQUIP.BOOST, { size: 1.2 });

  // Three turrets down the spine, each on its own ring.
  [1.4, 0, -1.4].forEach((z, i) => {
    const ring = a.addBlock(deck.id, { pos: [0, 0.5, z] }, 1, {
      size: [1.2, 0.4, 1.2], shape: SHAPE.CYLINDER, label: 'RING',
    });
    const turret = a.addBlockOnFace(ring.id, 2, 1, {
      size: [1.0, 0.8, 1.4], shape: SHAPE.HEX, label: 'TURRET',
    });
    a.addEquipOnFace(turret.id, 4, [EQUIP.SNIPER, EQUIP.GATLING, EQUIP.MISSILE][i], { size: 0.6 });
  });
  for (const face of [0, 1]) {
    const sponson = a.addBlockOnFace(hullBlock.id, face, 2, {
      size: [0.9, 1.1, 3.0], shape: SHAPE.BEVEL, label: 'SPONSON',
    });
    a.addEquipOnFace(sponson.id, 2, EQUIP.SPREAD, { size: 0.55 });
  }
  return a;
}

/** WYVERN: wings, thrusters and nothing to stand on. */
export function presetWyvern() {
  const a = new Assembly('WYVERN');
  const core = a.addCore();
  // Narrow and long, so it reads as something that goes forwards.
  const body = hull(a, core, [1.7, 1.5, 5.6], SHAPE.HEX, 9, 'BODY');
  const nose = a.addBlockOnFace(body.id, 4, 1, {
    size: [1.4, 1.2, 2.8], shape: SHAPE.CONE, label: 'NOSE',
  });
  a.addEquipOnFace(nose.id, 4, EQUIP.BEAM, { size: 0.8 });
  a.addEquipOnFace(body.id, 2, EQUIP.FLOAT, { size: 1.0 });
  const spine = a.addBlockOnFace(body.id, 2, 1, {
    size: [1.0, 0.7, 4.2], shape: SHAPE.WEDGE, label: 'SPINE',
  });
  a.addEquipOnFace(spine.id, 2, EQUIP.MISSILE, { size: 0.7 });

  for (const face of [0, 1]) {
    const root = a.addBlockOnFace(body.id, face, 2, {
      size: [0.7, 0.8, 2.6], shape: SHAPE.BEVEL, label: 'WING ROOT',
    });
    // Swept, and dropped below the spine. Flat slabs at mid-height off a
    // fat body read as a table rather than as a thing that flies; the sweep
    // is most of what says which way it is going.
    const wing = a.addBlock(root.id, {
      pos: [(face === 0 ? -1 : 1) * 2.1, -0.15, -0.9],
      rot: new THREE.Quaternion().setFromAxisAngle(UP, (face === 0 ? 1 : -1) * 0.42).toArray(),
    }, 2, { size: [4.2, 0.28, 2.0], shape: SHAPE.WEDGE, label: 'WING' });
    const tip = a.addBlock(wing.id, { pos: [(face === 0 ? -1 : 1) * 1.9, 0.5, 0] }, 2, {
      size: [0.3, 1.2, 1.4], shape: SHAPE.WEDGE, label: 'WINGLET',
    });
    a.addEquipOnFace(tip.id, 2, EQUIP.SHOT, { size: 0.4 });
    a.addEquipOnFace(wing.id, 5, EQUIP.BOOST, { size: 0.8 });
    // A folded claw, so it is not defenceless up close.
    const arm = a.addBoneOnFace(root.id, 3, BONE.ARM, {
      length: 1.6, gauge: 'mid', gain: 1.1,
    });
    a.addBlockOnBone(arm.id, 0.7, 2, { size: [0.5, 1.5, 0.5], shape: SHAPE.CAPSULE });
    const claw = a.addBlockOnBone(arm.id, 1, 5, { size: [0.5, 0.6, 0.9], shape: SHAPE.WEDGE });
    a.addEquipOnFace(claw.id, 4, EQUIP.BLADE, { size: 0.5 });
  }
  thrusters(a, body.id, 4, 1.1, 0.6, -0.4);
  return a;
}

// ============================================================
//  HUGE — twenty-five metres and up. You look up at it from a TITAN.
// ============================================================

/** COLOSSUS: a siege frame. Everything about it is a wall. */
export function presetColossus() {
  const a = new Assembly('COLOSSUS');
  const core = a.addCore();
  const chest = hull(a, core, [6.0, 4.4, 4.6], SHAPE.BEVEL, 1, 'CHEST');
  const shoulders = a.addBlockOnFace(chest.id, 2, 2, {
    size: [7.0, 1.4, 4.0], shape: SHAPE.BEVEL, label: 'SHOULDERS',
  });
  const head = a.addBlockOnFace(shoulders.id, 2, 1, {
    size: [1.8, 1.6, 2.0], shape: SHAPE.HEX, label: 'HEAD',
  });
  a.addBlockOnFace(head.id, 4, 15, { size: [1.3, 0.35, 0.2], shape: SHAPE.DISH });
  const pelvis = a.addBlockOnFace(chest.id, 3, 1, {
    size: [4.0, 2.0, 3.6], shape: SHAPE.BEVEL, label: 'PELVIS',
  });

  arms(a, chest.id, { length: 3.6, gauge: 'thick', thick: 1.7, pauldron: [2.2, 2.8, 3.6] })
    .forEach(({ hand, shoulder }, i) => {
      a.addEquipOnFace(hand.id, 4, i === 0 ? EQUIP.GATLING : EQUIP.SNIPER, { size: 1.3 });
      a.addEquipOnFace(shoulder.id, 2, EQUIP.MISSILE, { size: 1.0 });
    });
  legs(a, pelvis.id, {
    length: 5.4, gauge: 'thick', thigh: 2.2, foot: [2.8, 1.1, 4.4], gain: 0.75,
  });

  a.addEquipOnFace(shoulders.id, 5, EQUIP.BOOST, { size: 1.6 });
  a.addEquipOnFace(chest.id, 0, EQUIP.TANK, { size: 1.2 });
  a.addEquipOnFace(chest.id, 4, EQUIP.SHIELD, { size: 1.0 });
  return a;
}

/** LEVIATHAN: eight legs and a hull you could park a HAULER on. */
export function presetLeviathan() {
  const a = new Assembly('LEVIATHAN');
  const core = a.addCore();
  const body = hull(a, core, [5.4, 2.8, 8.0], SHAPE.HEX, 2, 'BODY');
  const spine = a.addBlockOnFace(body.id, 2, 1, {
    size: [3.6, 1.6, 6.4], shape: SHAPE.DOME, label: 'SPINE',
  });
  const head = a.addBlockOnFace(body.id, 4, 1, {
    size: [2.2, 1.8, 2.2], shape: SHAPE.WEDGE, label: 'HEAD',
  });
  a.addEquipOnFace(head.id, 4, EQUIP.SPREAD, { size: 1.0 });
  a.addEquipOnFace(spine.id, 2, EQUIP.MISSILE, { size: 1.2 });
  a.addEquipOnFace(spine.id, 0, EQUIP.BEAM, { size: 0.9 });
  a.addEquipOnFace(body.id, 5, EQUIP.BOOST, { size: 1.4 });
  a.addEquipOnFace(body.id, 1, EQUIP.TANK, { size: 1.0 });

  for (const z of [2.8, 0.9, -0.9, -2.8]) {
    const rail = a.addBlock(body.id, { pos: [0, 0.2, z] }, 2, {
      size: [5.0, 0.8, 1.1], shape: SHAPE.BEVEL, label: 'RAIL',
    });
    legs(a, rail.id, {
      length: 3.6, gauge: 'thick', thigh: 1.0, foot: [1.1, 0.5, 1.9],
      gain: 0.9, bend: -22, color: 2,
    });
  }
  return a;
}

/** FORTRESS: it does not walk. It arrives, and then it is there. */
export function presetFortress() {
  const a = new Assembly('FORTRESS');
  const core = a.addCore();
  const keep = hull(a, core, [7.0, 4.0, 7.0], SHAPE.BEVEL, 1, 'KEEP');
  const base = a.addBlockOnFace(keep.id, 3, 2, {
    size: [9.0, 2.0, 9.0], shape: SHAPE.FRUSTUM, label: 'BASE',
  });
  a.addEquipOnFace(base.id, 3, EQUIP.FLOAT, { size: 2.0 });
  a.addEquipOnFace(base.id, 3, EQUIP.GRAVITY, { size: 1.4 });

  const roof = a.addBlockOnFace(keep.id, 2, 1, {
    size: [5.4, 1.2, 5.4], shape: SHAPE.BEVEL, label: 'ROOF',
  });
  const mast = a.addBlockOnFace(roof.id, 2, 15, {
    size: [1.0, 3.0, 1.0], shape: SHAPE.CYLINDER, label: 'MAST',
  });
  a.addEquipOnFace(mast.id, 2, EQUIP.BEAM, { size: 1.2 });

  // Four corner batteries, each on a ring so they read as turrets.
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bastion = a.addBlock(keep.id, {
      pos: [Math.cos(t) * 3.6, 0.6, Math.sin(t) * 3.6], rot: spun(t),
    }, 2, { size: [2.2, 2.6, 2.2], shape: SHAPE.HEX, label: 'BASTION' });
    const cap = a.addBlockOnFace(bastion.id, 2, 1, {
      size: [1.6, 0.9, 1.6], shape: SHAPE.DOME, label: 'CUPOLA',
    });
    a.addEquipOnFace(cap.id, 4, [EQUIP.GATLING, EQUIP.MISSILE, EQUIP.SNIPER, EQUIP.SPREAD][i], {
      size: 0.8,
    });
  }
  thrusters(a, base.id, 6, 3.8, 0.9, -0.6);
  return a;
}

/**
 * Whole limbs, lifted off the built-in machines.
 *
 * A machine preset answers "give me something that works" and a bare core
 * answers "let me start clean"; nothing answered "I have a torso, now I need
 * an arm" — which is the part of a build that takes longest and looks worst
 * when done in a hurry. These are ordinary part documents: graft one on and
 * cut it about like anything else.
 */
export function starterParts() {
  const out = [];
  const take = (assembly, label, name) => {
    let found = null;
    assembly.walk((p) => { if (!found && p.label === label) found = p; });
    const doc = found ? assembly.extract(found.id) : null;
    if (doc) out.push({ name, json: doc.toJSON() });
  };
  const biped = presetBiped();
  take(biped, 'PAULDRON', '腕 ARM');
  take(biped, 'HIP', '脚 LEG');
  take(biped, 'HEAD', '頭 HEAD');
  take(biped, 'CHEST', '上半身 UPPER BODY');
  return out;
}

// ============================================================
//  The catalogue.
// ============================================================

/**
 * Everything the game ships, with the one thing about each that the editor
 * and the run both need: how big it is.
 *
 * `size` is a class, not a measurement — the real height comes off the built
 * machine. It is here so a run can escalate by scale rather than only by
 * numbers, and so the preset menu can be read in an order that means
 * something.
 */
export const PRESET_LIST = [
  { id: 'gnat', label: 'GNAT', size: 'tiny', build: presetGnat },
  { id: 'mite', label: 'MITE', size: 'tiny', build: presetMite },
  { id: 'spark', label: 'SPARK', size: 'tiny', build: presetSpark },
  { id: 'tick', label: 'TICK', size: 'tiny', build: presetTick },

  { id: 'hopper', label: 'POGO', size: 'small', build: presetHopper },
  { id: 'dart', label: 'DART', size: 'small', build: presetDart },
  { id: 'scarab', label: 'SCARAB', size: 'small', build: presetScarab },
  { id: 'pip', label: 'PIP', size: 'small', build: presetPip },

  { id: 'biped', label: 'STRIDER', size: 'medium', build: presetBiped },
  { id: 'multileg', label: 'CRAWLER', size: 'medium', build: presetMultileg },
  { id: 'bits', label: 'FUNNEL', size: 'medium', build: presetBits },
  { id: 'lance', label: 'LANCE', size: 'medium', build: presetLance },
  { id: 'turtle', label: 'TURTLE', size: 'medium', build: presetTurtle },

  { id: 'titan', label: 'TITAN', size: 'large', build: presetTitan },
  { id: 'spider', label: 'SPIDER', size: 'large', build: presetSpider },
  { id: 'hauler', label: 'HAULER', size: 'large', build: presetHauler },
  { id: 'wyvern', label: 'WYVERN', size: 'large', build: presetWyvern },

  { id: 'colossus', label: 'COLOSSUS', size: 'huge', build: presetColossus },
  { id: 'leviathan', label: 'LEVIATHAN', size: 'huge', build: presetLeviathan },
  { id: 'fortress', label: 'FORTRESS', size: 'huge', build: presetFortress },
];

/** The size classes, smallest first. */
export const SIZE_CLASSES = ['tiny', 'small', 'medium', 'large', 'huge'];

/** Which machines are in a class. */
export function presetsOfSize(size) {
  return PRESET_LIST.filter((p) => p.size === size).map((p) => p.id);
}

/**
 * Keyed by id, the shape everything already asks for.
 *
 * `core` is not a machine — it is the empty starting point the editor
 * offers, and it belongs in this list because that is where somebody looks
 * for it.
 */
export const PRESETS = Object.fromEntries([
  ...PRESET_LIST.map((p) => [p.id, { label: p.label, size: p.size, build: p.build }]),
  ['core', { label: 'コアのみ', size: 'tiny', build: () => Assembly.createDefault() }],
]);
