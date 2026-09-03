/**
 * A fingerprint of the fight, exact to the last bit.
 *
 * Lockstep play does not send positions. Every machine runs the same
 * simulation from the same seed and the same inputs, and trusts that it
 * arrives at the same answer — which is only true if the simulation really
 * is deterministic. This is how that trust gets checked: each side hashes
 * its own state every so often and sends the hash, and the moment two
 * differ the fight is already wrong and everybody needs to be told.
 *
 * So it hashes the FLOAT BITS, not the rounded value. Rounding to six
 * decimals would hide exactly the divergence this exists to catch — two
 * machines a millimetre apart are two machines that will be a metre apart
 * in ten seconds, because the difference feeds back through the physics.
 *
 * Two exceptions, both about numbers that mean the same thing in two
 * spellings: negative zero is folded onto zero, and every NaN is folded
 * onto one pattern. Neither can change what the simulation does next, so
 * neither is a divergence — flagging them would be crying wolf.
 */

const _bits = new ArrayBuffer(8);
const _f64 = new Float64Array(_bits);
const _u32 = new Uint32Array(_bits);

/** FNV-1a, 32 bits, fed a word at a time. */
export class Hasher {
  constructor(seed = 0x811c9dc5) {
    this.h = seed >>> 0;
  }

  u32(v) {
    this.h ^= v >>> 0;
    // Math.imul, because a plain multiply goes through a double and loses
    // the low bits it is the whole point of this to keep.
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
    return this;
  }

  num(v) {
    // -0 and 0 drive the simulation identically, and so does one NaN as
    // another. Nothing else is normalised: everything else is a real value
    // and a real difference.
    let n = v;
    if (n === 0) n = 0;
    else if (Number.isNaN(n)) n = Number.NaN;
    _f64[0] = n;
    return this.u32(_u32[0]).u32(_u32[1]);
  }

  bool(v) { return this.u32(v ? 1 : 0); }

  vec3(v) {
    if (!v) return this.u32(0);
    return this.num(v.x).num(v.y).num(v.z);
  }

  quat(q) {
    if (!q) return this.u32(0);
    return this.num(q.x).num(q.y).num(q.z).num(q.w);
  }

  str(s) {
    const t = String(s ?? '');
    for (let i = 0; i < t.length; i++) this.u32(t.charCodeAt(i));
    return this;
  }

  get value() { return this.h >>> 0; }
}

/**
 * One machine, as far as the fight is concerned.
 *
 * Only what feeds back into the next step. The pose is left out on purpose:
 * it is an OUTPUT of the body, so hashing it would report the same
 * divergence twice, and a machine's animation is allowed to be a frame
 * behind on a slow client without the fight being wrong.
 */
export function hashRobot(r, into = new Hasher()) {
  const b = r.body;
  into.bool(r.alive).num(r.hp);
  if (b) {
    into.vec3(b.position).vec3(b.inertia?.velocity).quat(b.quaternion);
    into.num(b.energy).num(b.hover ?? 0).num(b.retreat ?? 0);
    into.bool(b.locked).num(b.env?.grounded ?? 0);
  }
  const w = r.weapons;
  if (w) {
    into.u32(w.activeIndex ?? 0);
    for (const s of w.slots ?? []) into.num(s.ammo).num(s.reloadT).num(s.heat ?? 0).num(s.cool ?? 0);
  }
  return into;
}

/**
 * Every round in the air.
 *
 * Order matters and is not sorted: a pool that hands out slots in a
 * different order on two machines IS a divergence, and sorting the hash
 * would paper over it.
 */
export function hashProjectiles(pool, into = new Hasher()) {
  for (const s of pool?.pool ?? []) {
    if (!(s.life > 0)) { into.u32(0); continue; }
    into.num(s.life).vec3(s.mesh?.position).vec3(s.vel);
  }
  return into;
}

/**
 * The whole fight, in one number.
 *
 * The number streams go in too. Two machines whose dice have drifted apart
 * agree about everything on screen right up until the next shot spreads,
 * and finding that out then is finding out far too late.
 */
export function hashFight({ robots = [], projectiles = null, random = null } = {}) {
  const h = new Hasher();
  for (const r of robots) hashRobot(r, h);
  if (projectiles) hashProjectiles(projectiles, h);
  if (random) h.u32(random.state ?? 0);
  return h.value;
}

/** As eight hex digits, which is what a log line wants. */
export function hex(v) {
  return (v >>> 0).toString(16).padStart(8, '0');
}
