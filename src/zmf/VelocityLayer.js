import { damp, clamp01 } from './math.js';

// ============================================================
//  ZMF §6 : Velocity Layer System — mass-varying ABC model
//
//  ABC is NOT an output limiter. It retunes the *simulated mass*,
//  so the same stick deflection produces a different handful of
//  machine depending on the layer you are in.
// ============================================================

export const LAYERS = {
  A: {
    key: 'A', label: 'ACTIVE',
    mass: 0.62,        // lightest -> sharpest
    jerk: 1.38,        // fastest spool
    viscosity: 0.78,   // inertia does not linger
    turn: 1.30,
    color: '#ff7a5c',
  },
  B: {
    key: 'B', label: 'BALANCE',
    mass: 1.0, jerk: 1.0, viscosity: 1.0, turn: 1.0,
    color: '#4fd2ff',
  },
  C: {
    key: 'C', label: 'COOLING',
    mass: 1.58,        // heaviest -> planted
    jerk: 0.72,
    viscosity: 1.72,   // strong spatial viscosity
    turn: 0.78,
    color: '#8effc9',
  },
};

export class VelocityLayerSystem {
  constructor(initial = 'B') {
    this.layer = LAYERS[initial];
    this.pending = this.layer;
    // Blended values — mass must never snap, or the machine "teleports"
    // its own weight and the hands feel it as a glitch.
    this.mass = this.layer.mass;
    this.jerk = this.layer.jerk;
    this.viscosity = this.layer.viscosity;
    this.turn = this.layer.turn;

    /** Acceleration snatch: a brief jerk spike right after a layer change. */
    this.snatch = 0;
    this.transition = 0; // 0..1, how far through a change we are
  }

  set(key) {
    const next = LAYERS[key];
    if (!next || next === this.pending) return false;
    // Dropping mass gives a bigger snatch than adding it.
    this.snatch = clamp01(Math.abs(this.pending.mass - next.mass) * (next.mass < this.pending.mass ? 1.0 : 0.55));
    this.pending = next;
    this.transition = 1;
    return true;
  }

  cycle(dir = 1) {
    const order = ['A', 'B', 'C'];
    const i = order.indexOf(this.pending.key);
    return this.set(order[(i + dir + order.length) % order.length]);
  }

  update(dt) {
    const hl = 0.11; // mass blend half-life, seconds
    this.mass = damp(this.mass, this.pending.mass, hl, dt);
    this.jerk = damp(this.jerk, this.pending.jerk, hl * 0.6, dt);
    this.viscosity = damp(this.viscosity, this.pending.viscosity, hl, dt);
    this.turn = damp(this.turn, this.pending.turn, hl, dt);
    this.layer = this.pending;

    this.snatch = damp(this.snatch, 0, 0.09, dt);
    this.transition = damp(this.transition, 0, 0.14, dt);
  }

  /** Extra jerk headroom granted during the snatch window. */
  get jerkBoost() { return 1 + this.snatch * 1.9; }
}
