import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { InertiaCore, SPOOL_PROFILE } from '../src/zmf/InertiaCore.js';
import { VelocityLayerSystem, LAYERS } from '../src/zmf/VelocityLayer.js';
import { AngularDynamics } from '../src/zmf/AngularDynamics.js';
import { AssistController } from '../src/zmf/AssistController.js';
import { RelativeSpaceMapper } from '../src/zmf/RelativeSpace.js';
import { EnvironmentInterference } from '../src/zmf/EnvInterference.js';
import { CameraDynamics } from '../src/zmf/CameraDynamics.js';
import { KineticFeedback } from '../src/zmf/KineticFeedback.js';

const STATS = {
  mass: 12, thrust: 400, weightClass: 0.4, agility: 0.4, extent: 3,
  legs: 2, gait: 'walk',
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ============================================================
//  §6 Velocity Layer
// ============================================================

describe('VelocityLayerSystem', () => {
  it('starts balanced', () => {
    const l = new VelocityLayerSystem();
    expect(l.layer.key).toBe('B');
    expect(l.mass).toBe(1);
  });

  it('A is lighter and sharper than C', () => {
    expect(LAYERS.A.mass).toBeLessThan(LAYERS.B.mass);
    expect(LAYERS.C.mass).toBeGreaterThan(LAYERS.B.mass);
    expect(LAYERS.A.jerk).toBeGreaterThan(LAYERS.C.jerk);
    expect(LAYERS.C.viscosity).toBeGreaterThan(LAYERS.A.viscosity);
  });

  it('blends mass rather than snapping it', () => {
    const l = new VelocityLayerSystem();
    expect(l.set('C')).toBe(true);
    expect(l.mass).toBe(1);              // not yet
    l.update(1 / 60);
    expect(l.mass).toBeGreaterThan(1);
    expect(l.mass).toBeLessThan(LAYERS.C.mass);
    for (let i = 0; i < 200; i++) l.update(1 / 60);
    expect(l.mass).toBeCloseTo(LAYERS.C.mass, 3);
  });

  it('ignores a switch to the layer it is already heading for', () => {
    const l = new VelocityLayerSystem();
    l.set('A');
    expect(l.set('A')).toBe(false);
  });

  it('dropping mass produces a bigger snatch than adding it', () => {
    const down = new VelocityLayerSystem('C');
    down.set('A');
    const up = new VelocityLayerSystem('A');
    up.set('C');
    expect(down.snatch).toBeGreaterThan(up.snatch);
    expect(down.jerkBoost).toBeGreaterThan(1);
  });

  it('cycles through A, B, C and wraps', () => {
    const l = new VelocityLayerSystem('A');
    l.cycle(1); expect(l.pending.key).toBe('B');
    l.cycle(1); expect(l.pending.key).toBe('C');
    l.cycle(1); expect(l.pending.key).toBe('A');
    l.cycle(-1); expect(l.pending.key).toBe('C');
  });

  it('the snatch decays back to nothing', () => {
    const l = new VelocityLayerSystem('C');
    l.set('A');
    for (let i = 0; i < 200; i++) l.update(1 / 60);
    expect(l.snatch).toBeLessThan(0.001);
    expect(l.jerkBoost).toBeCloseTo(1, 2);
  });
});

// ============================================================
//  §3 Inertia Core
// ============================================================

describe('InertiaCore drag', () => {
  let core;
  beforeEach(() => { core = new InertiaCore(STATS); });

  it('keeps a viscous floor at rest for precision work', () => {
    expect(core.computeDrag(0, 0, NaN, 1)).toBeGreaterThan(0.5);
  });

  it('rises with speed once past the knee', () => {
    const slow = core.computeDrag(1, 0, NaN, 1);
    const fast = core.computeDrag(60, 0, NaN, 1);
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  it('a heavier build sits in thicker space', () => {
    const light = new InertiaCore({ ...STATS, weightClass: 0 });
    const heavy = new InertiaCore({ ...STATS, weightClass: 1 });
    expect(heavy.computeDrag(10, 0, NaN, 1)).toBeGreaterThan(light.computeDrag(10, 0, NaN, 1));
  });

  it('relaxes when closing on a nearby target', () => {
    const far = core.computeDrag(20, 0, NaN, 1);
    const closing = core.computeDrag(20, 25, 5, 1);
    expect(closing).toBeLessThan(far);
    expect(core.approachRelief).toBeGreaterThan(0.3);
  });

  it('does not relax when the target is far away or receding', () => {
    core.computeDrag(20, 25, 200, 1);
    expect(core.approachRelief).toBeLessThan(0.05);
    core.computeDrag(20, -25, 5, 1);
    expect(core.approachRelief).toBeLessThan(0.05);
  });

  it('the ABC viscosity scalar multiplies straight through', () => {
    const a = core.computeDrag(3, 0, NaN, 1);
    const b = core.computeDrag(3, 0, NaN, 2);
    expect(b).toBeGreaterThan(a);
  });
});

describe('InertiaCore spool', () => {
  let core;
  beforeEach(() => { core = new InertiaCore(STATS); });

  it('backward spools up slower than forward', () => {
    expect(SPOOL_PROFILE.backward.rise).toBeLessThan(SPOOL_PROFILE.forward.rise);
    expect(SPOOL_PROFILE.backward.aMax).toBeLessThan(SPOOL_PROFILE.forward.aMax);
  });

  it('backward brakes faster than it accelerates', () => {
    expect(SPOOL_PROFILE.backward.fall).toBeGreaterThan(SPOOL_PROFILE.backward.rise);
  });

  it('honours the per-direction ceiling', () => {
    for (let i = 0; i < 400; i++) core.spoolTo(V(1, 1, 1), 1 / 60);
    expect(core.spool.z).toBeCloseTo(SPOOL_PROFILE.forward.aMax, 3);
    expect(core.spool.x).toBeCloseTo(SPOOL_PROFILE.lateral.aMax, 3);
    expect(core.spool.y).toBeCloseTo(SPOOL_PROFILE.vertical.aMax, 3);
  });

  it('reaching full forward thrust takes real time', () => {
    core.spoolTo(V(0, 0, 1), 1 / 60);
    expect(core.spool.z).toBeGreaterThan(0);
    expect(core.spool.z).toBeLessThan(SPOOL_PROFILE.forward.aMax);
  });

  it('releasing the stick decays the spool at the fall rate', () => {
    for (let i = 0; i < 400; i++) core.spoolTo(V(0, 0, 1), 1 / 60);
    const held = core.spool.z;
    core.spoolTo(V(0, 0, 0), 1 / 60);
    const drop = held - core.spool.z;
    expect(drop).toBeGreaterThan(0);
    // The profile, scaled by what the machine weighs. A heavy frame is
    // slower to stop pushing as well as slower to start, which is most of
    // what separates a siege frame from a drone by feel.
    expect(drop).toBeCloseTo(SPOOL_PROFILE.forward.fall * core.spoolScale / 60, 4);
  });

  it('and how fast it spools is what the machine weighs', () => {
    // The profile used to be a fixed constant, so a two-hundred-tonne frame
    // reached full thrust in the same fraction of a second as a four-tonne
    // drone — mass only changed the number it eventually arrived at.
    const light = new InertiaCore({ ...STATS, weightClass: 0 });
    const heavy = new InertiaCore({ ...STATS, weightClass: 1 });
    expect(heavy.spoolScale).toBeLessThan(light.spoolScale * 0.6);

    const upTo = (c, want) => {
      for (let i = 0; i < 600; i++) {
        c.spoolTo(V(0, 0, 1), 1 / 60);
        if (c.spool.z >= want) return i / 60;
      }
      return 99;
    };
    expect(upTo(heavy, 0.9), 'the heavy one takes longer to get going')
      .toBeGreaterThan(upTo(light, 0.9) * 1.5);
  });

  it('reports actual output, not the command', () => {
    core.spoolTo(V(0, 0, 1), 1 / 600);
    expect(core.thrustOutput).toBeGreaterThan(0);
    expect(core.thrustOutput).toBeLessThan(0.2);
  });

  it('a higher jerk scale spools faster', () => {
    const slow = new InertiaCore(STATS);
    const fast = new InertiaCore(STATS);
    slow.spoolTo(V(0, 0, 1), 1 / 60, 0.5);
    fast.spoolTo(V(0, 0, 1), 1 / 60, 2.0);
    expect(fast.spool.z).toBeGreaterThan(slow.spool.z);
  });
});

describe('InertiaCore counter-thruster boost', () => {
  let core;
  beforeEach(() => {
    core = new InertiaCore(STATS);
    core.velocity.set(0, 0, 20);
  });

  it('fires on a hard reversal at speed', () => {
    expect(core.tryCounterBoost(V(0, 0, -1), 1 / 60)).toBe(true);
    expect(core.counterImpulse.z).toBeLessThan(0);
  });

  it('does not fire on a gentle turn', () => {
    expect(core.tryCounterBoost(V(1, 0, 0), 1 / 60)).toBe(false);
  });

  it('does not fire when barely moving', () => {
    core.velocity.set(0, 0, 1);
    expect(core.tryCounterBoost(V(0, 0, -1), 1 / 60)).toBe(false);
  });

  it('is edge triggered: holding the stick cannot farm it', () => {
    expect(core.tryCounterBoost(V(0, 0, -1), 1 / 60)).toBe(true);
    for (let i = 0; i < 30; i++) {
      expect(core.tryCounterBoost(V(0, 0, -1), 1 / 60)).toBe(false);
    }
  });

  it('re-arms once the reversal ends', () => {
    core.tryCounterBoost(V(0, 0, -1), 1 / 60);
    for (let i = 0; i < 20; i++) core.tryCounterBoost(V(0, 0, 1), 1 / 60);
    expect(core.tryCounterBoost(V(0, 0, -1), 1 / 60)).toBe(true);
  });
});

describe('InertiaCore integration', () => {
  it('accelerates along the thrust vector', () => {
    const core = new InertiaCore(STATS);
    const pos = V();
    core.integrate(pos, V(0, 0, 1), V(), 1 / 60, { layerMass: 1, viscosity: 1 });
    expect(core.velocity.z).toBeGreaterThan(0);
    expect(pos.z).toBeGreaterThan(0);
  });

  it('reaches a terminal speed rather than running away', () => {
    const core = new InertiaCore(STATS);
    const pos = V();
    for (let i = 0; i < 2000; i++) {
      core.integrate(pos, V(0, 0, 1), V(), 1 / 120, { layerMass: 1, viscosity: 1 });
    }
    const terminal = core.velocity.z;
    expect(terminal).toBeGreaterThan(1);
    for (let i = 0; i < 200; i++) {
      core.integrate(pos, V(0, 0, 1), V(), 1 / 120, { layerMass: 1, viscosity: 1 });
    }
    expect(core.velocity.z).toBeCloseTo(terminal, 1);
  });

  it('a heavier ABC layer accelerates less for the same thrust', () => {
    const light = new InertiaCore(STATS);
    const heavy = new InertiaCore(STATS);
    light.integrate(V(), V(0, 0, 1), V(), 1 / 60, { layerMass: LAYERS.A.mass, viscosity: 1 });
    heavy.integrate(V(), V(0, 0, 1), V(), 1 / 60, { layerMass: LAYERS.C.mass, viscosity: 1 });
    expect(light.velocity.z).toBeGreaterThan(heavy.velocity.z);
  });

  it('external acceleration bypasses the mass term', () => {
    const a = new InertiaCore(STATS);
    const b = new InertiaCore(STATS);
    a.integrate(V(), V(), V(0, -22, 0), 1 / 60, { layerMass: 1, viscosity: 1 });
    b.integrate(V(), V(), V(0, -22, 0), 1 / 60, { layerMass: 4, viscosity: 1 });
    expect(a.velocity.y).toBeCloseTo(b.velocity.y, 6);
    expect(a.velocity.y).toBeLessThan(0);
  });

  it('produces a finite jerk reading', () => {
    const core = new InertiaCore(STATS);
    const pos = V();
    for (let i = 0; i < 30; i++) {
      core.integrate(pos, V(0, 0, i < 15 ? 1 : 0), V(), 1 / 60, { layerMass: 1, viscosity: 1 });
    }
    expect(Number.isFinite(core.jerkMag)).toBe(true);
    expect(core.jerkMag).toBeGreaterThanOrEqual(0);
  });

  it('reset clears everything', () => {
    const core = new InertiaCore(STATS);
    core.integrate(V(), V(0, 0, 1), V(), 1 / 60, { layerMass: 1, viscosity: 1 });
    core.reset();
    expect(core.velocity.length()).toBe(0);
    expect(core.spool.length()).toBe(0);
    expect(core.jerkMag).toBe(0);
  });
});

// ============================================================
//  §4 Assist Controller
// ============================================================

describe('AssistController', () => {
  const target = (p, r = 1.5) => ({ position: p, radius: r });

  it('does nothing without a target', () => {
    const a = new AssistController();
    a.update(V(), V(), null, 0, 0, 1 / 60);
    expect(a.hasTarget).toBe(false);
    expect(a.command.length()).toBe(0);
  });

  it('measures range and closing rate', () => {
    const a = new AssistController();
    a.update(V(), V(0, 0, 10), target(V(0, 0, 30)), 0, 0, 1 / 60);
    expect(a.range).toBeCloseTo(30, 6);
    expect(a.closingRate).toBeCloseTo(10, 6);
  });

  it('reports a negative closing rate when the target runs away', () => {
    const a = new AssistController();
    a.update(V(), V(0, 0, -10), target(V(0, 0, 30)), 0, 0, 1 / 60);
    expect(a.closingRate).toBeLessThan(0);
  });

  it('estimates target velocity from successive observations', () => {
    const a = new AssistController();
    const p = V(0, 0, 40);
    for (let i = 0; i < 120; i++) {
      p.x += 10 / 60;
      a.update(V(), V(), target(p), 0, i / 60, 1 / 60);
    }
    expect(a.estimator.velocity.x).toBeGreaterThan(8);
    expect(a.estimator.velocity.x).toBeLessThan(12);
  });

  it('leads a crossing target, but never past it', () => {
    const a = new AssistController();
    const p = V(0, 0, 40);
    for (let i = 0; i < 120; i++) {
      p.x += 20 / 60;
      a.update(V(), V(0, 0, 10), target(p), 0, i / 60, 1 / 60);
    }
    const lead = a.aimPoint.distanceTo(a.estimator.position);
    expect(lead).toBeGreaterThan(0.5);
    expect(lead).toBeLessThanOrEqual(a.range * 0.4 + 1e-6);
  });

  it('soft override hands control back as the aim stick moves', () => {
    const a = new AssistController();
    const run = (override) => {
      const c = new AssistController();
      for (let i = 0; i < 120; i++) c.update(V(), V(), target(V(0, 0, 30)), override, i / 60, 1 / 60);
      return c.authority;
    };
    expect(run(0)).toBeGreaterThan(0.9);
    expect(run(1)).toBeLessThan(0.1);
    expect(run(0.5)).toBeLessThan(run(0));
    expect(a.config.overrideThreshold).toBeLessThan(a.config.overrideFull);
  });

  it('drops the assist entirely at silly ranges', () => {
    const a = new AssistController();
    for (let i = 0; i < 120; i++) a.update(V(), V(), target(V(0, 0, 200)), 0, i / 60, 1 / 60);
    expect(a.authority).toBeLessThan(0.05);
  });

  it('limits the turn rate harder as the target fills the view', () => {
    const near = new AssistController();
    const far = new AssistController();
    const pNear = V(4, 0, 4);
    const pFar = V(60, 0, 60);
    for (let i = 0; i < 60; i++) {
      pNear.x += 0.2; pFar.x += 0.2;
      near.update(V(), V(), target(pNear, 3), 0, i / 60, 1 / 60);
      far.update(V(), V(), target(pFar, 3), 0, i / 60, 1 / 60);
    }
    expect(near.turnLimiter).toBeLessThanOrEqual(far.turnLimiter);
  });

  it('clear() wipes the estimate', () => {
    const a = new AssistController();
    a.update(V(), V(), target(V(0, 0, 30)), 0, 0, 1 / 60);
    a.clear();
    expect(a.hasTarget).toBe(false);
    expect(Number.isNaN(a.range)).toBe(true);
    expect(a.estimator.samples.count).toBe(0);
  });

  it('never produces NaN, even for a target on top of us', () => {
    const a = new AssistController();
    for (let i = 0; i < 60; i++) a.update(V(), V(), target(V(0, 0, 0)), 0, i / 60, 1 / 60);
    expect(Number.isFinite(a.command.x)).toBe(true);
    expect(Number.isFinite(a.aimPoint.x)).toBe(true);
  });
});

// ============================================================
//  §3 / §7.1 Angular Dynamics
// ============================================================

describe('AngularDynamics', () => {
  const base = (over = {}) => ({
    look: { yaw: 0, pitch: 0 },
    aimPoint: null,
    assistAuthority: 0,
    position: V(),
    velocity: V(),
    accel: V(),
    layerTurn: 1,
    grounded: 1,
    ...over,
  });

  it('starts looking down +Z with a level horizon', () => {
    const ang = new AngularDynamics(STATS);
    ang.update(base(), 1 / 60);
    expect(ang.forward.z).toBeGreaterThan(0.99);
    expect(ang.up.y).toBeGreaterThan(0.99);
  });

  it('yaw input turns the machine', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 60; i++) ang.update(base({ look: { yaw: 1, pitch: 0 } }), 1 / 60);
    expect(Math.abs(ang.forward.x)).toBeGreaterThan(0.3);
  });

  it('positive pitch raises the nose', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 30; i++) ang.update(base({ look: { yaw: 0, pitch: 1 }, grounded: 0 }), 1 / 60);
    expect(ang.forward.y).toBeGreaterThan(0.1);
  });

  it('refuses to tip past the poles', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 600; i++) ang.update(base({ look: { yaw: 0, pitch: 6 }, grounded: 0 }), 1 / 60);
    expect(Math.abs(ang.forward.y)).toBeLessThan(0.99);
    expect(Number.isFinite(ang.forward.x)).toBe(true);
  });

  it('holds the horizon at walking pace', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 60; i++) {
      ang.update(base({ velocity: V(0, 0, 2), accel: V(30, 0, 0) }), 1 / 60);
    }
    expect(Math.abs(ang.bank)).toBeLessThan(0.02);
  });

  it('banks into a fast lateral turn, within the stated limits', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 120; i++) {
      ang.update(base({ velocity: V(0, 0, 30), accel: V(40, 0, 0), grounded: 0 }), 1 / 60);
    }
    expect(Math.abs(ang.bank)).toBeGreaterThan(2 * Math.PI / 180);
    expect(Math.abs(ang.bank)).toBeLessThanOrEqual(30.001 * Math.PI / 180);
  });

  it('rolls back level when the turn stops', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 120; i++) {
      ang.update(base({ velocity: V(0, 0, 30), accel: V(40, 0, 0), grounded: 0 }), 1 / 60);
    }
    for (let i = 0; i < 300; i++) {
      ang.update(base({ velocity: V(0, 0, 30), accel: V(), grounded: 0 }), 1 / 60);
    }
    expect(Math.abs(ang.bank)).toBeLessThan(0.01);
  });

  it('turns toward the lock when the assist has authority', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 200; i++) {
      ang.update(base({ aimPoint: V(30, 0, 0), assistAuthority: 1, grounded: 0 }), 1 / 60);
    }
    expect(ang.forward.x).toBeGreaterThan(0.8);
  });

  it('keeps the basis orthonormal and right-handed', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 200; i++) {
      ang.update(base({ look: { yaw: 0.7, pitch: 0.4 }, accel: V(20, 3, 5), velocity: V(5, 1, 20), grounded: 0 }), 1 / 60);
    }
    expect(ang.forward.length()).toBeCloseTo(1, 5);
    expect(ang.up.length()).toBeCloseTo(1, 5);
    expect(ang.right.length()).toBeCloseTo(1, 5);
    expect(ang.forward.dot(ang.up)).toBeCloseTo(0, 5);
    const cross = new THREE.Vector3().crossVectors(ang.up, ang.forward);
    expect(cross.dot(ang.right)).toBeCloseTo(1, 4);
  });

  it('reports a finite angular velocity', () => {
    const ang = new AngularDynamics(STATS);
    for (let i = 0; i < 60; i++) ang.update(base({ look: { yaw: 1, pitch: 0 } }), 1 / 60);
    expect(Number.isFinite(ang.turnRate)).toBe(true);
    expect(ang.turnRate).toBeGreaterThan(0);
  });

  it('centripetal assist rotates momentum toward the nose without changing speed', () => {
    const ang = new AngularDynamics(STATS);
    ang.update(base(), 1 / 60);
    ang.turnRate = 2;
    const v = V(6, 0, 8);
    const speed = v.length();
    ang.applyCentripetalAssist(v, 1 / 60, 1);
    expect(v.length()).toBeCloseTo(speed, 5);
    expect(v.z / v.length()).toBeGreaterThan(8 / speed);
  });

  it('centripetal assist never helps a reversal', () => {
    const ang = new AngularDynamics(STATS);
    ang.update(base(), 1 / 60);
    ang.turnRate = 2;
    const v = V(0, 0, -10);
    ang.applyCentripetalAssist(v, 1 / 60, 1);
    expect(v.z).toBeCloseTo(-10, 6);
  });
});

// ============================================================
//  §5 Relative Space Mapper
// ============================================================

describe('RelativeSpaceMapper', () => {
  const frame = (pos, vel) => ({ position: pos, velocity: vel });

  it('is inert with nothing registered', () => {
    const s = new RelativeSpaceMapper();
    expect(s.update(V(), 1 / 60)).toBe(0);
    expect(s.frameVelocity.length()).toBe(0);
  });

  it('blends in over the specified 0.3-0.5s, never instantly', () => {
    const s = new RelativeSpaceMapper();
    s.register('t', frame(V(), V(0, 0, 10)), 2);
    expect(s.blendDuration).toBeGreaterThanOrEqual(0.3);
    expect(s.blendDuration).toBeLessThanOrEqual(0.5);

    s.update(V(), 1 / 60);
    expect(s.blend).toBeGreaterThan(0);
    expect(s.blend).toBeLessThan(0.2);

    for (let i = 0; i < 60; i++) s.update(V(), 1 / 60);
    expect(s.blend).toBeCloseTo(1, 2);
    expect(s.frameVelocity.z).toBeCloseTo(10, 1);
  });

  it('fades out once the frame is left behind', () => {
    const s = new RelativeSpaceMapper();
    s.register('t', frame(V(), V(0, 0, 10)), 2);
    for (let i = 0; i < 60; i++) s.update(V(), 1 / 60);
    for (let i = 0; i < 60; i++) s.update(V(0, 0, 500), 1 / 60);
    expect(s.blend).toBeCloseTo(0, 3);
  });

  it('picks the strongest frame when several overlap', () => {
    const s = new RelativeSpaceMapper();
    s.register('far', frame(V(0, 0, 8), V()), 2);
    s.register('near', frame(V(0, 0, 1), V()), 2);
    s.update(V(), 1 / 60);
    expect(s.active.id).toBe('near');
  });

  it('toFrame subtracts the carried velocity', () => {
    const s = new RelativeSpaceMapper();
    s.register('t', frame(V(), V(0, 0, 10)), 2);
    for (let i = 0; i < 60; i++) s.update(V(), 1 / 60);
    const rel = s.toFrame(V(0, 0, 15));
    expect(rel.z).toBeLessThan(15);
  });

  it('clear resets everything', () => {
    const s = new RelativeSpaceMapper();
    s.register('t', frame(V(), V(0, 0, 10)), 2);
    for (let i = 0; i < 60; i++) s.update(V(), 1 / 60);
    s.clear();
    expect(s.blend).toBe(0);
    expect(s.frames).toHaveLength(0);
  });
});

// ============================================================
//  §5.2 / §6 Environment Interference
// ============================================================

const flatWorld = (colliders = []) => ({
  gravity: 22,
  arenaRadius: 120,
  ceiling: 95,
  colliders,
  groundHeight: () => 0,
});

const box = (cx, cy, cz, sx, sy, sz) => new THREE.Box3(
  V(cx - sx / 2, cy - sy / 2, cz - sz / 2),
  V(cx + sx / 2, cy + sy / 2, cz + sz / 2),
);

describe('EnvironmentInterference', () => {
  it('reports grounded when the feet reach the floor', () => {
    const env = new EnvironmentInterference(flatWorld());
    const pos = V(0, 2, 0);
    for (let i = 0; i < 40; i++) env.probe(pos, V(), V(), 1, 2, 1 / 60);
    expect(env.grounded).toBeCloseTo(1, 2);
    expect(env.groundY).toBe(0);
  });

  it('is airborne with clear space below', () => {
    const env = new EnvironmentInterference(flatWorld());
    const pos = V(0, 20, 0);
    for (let i = 0; i < 40; i++) env.probe(pos, V(), V(), 1, 2, 1 / 60);
    expect(env.grounded).toBeCloseTo(0, 3);
  });

  it('stops a fall and pushes the feet back to the surface', () => {
    const env = new EnvironmentInterference(flatWorld());
    const pos = V(0, 1.5, 0);
    const vel = V(0, -12, 0);
    env.probe(pos, vel, V(), 1, 2, 1 / 60);
    expect(pos.y).toBeCloseTo(2, 6);
    expect(vel.y).toBeGreaterThan(-12);
    expect(env.impactImpulse).toBeGreaterThan(0);
  });

  it('treats the top of a box as ground', () => {
    const env = new EnvironmentInterference(flatWorld([box(0, 5, 0, 8, 10, 8)]));
    const pos = V(0, 12, 0);
    for (let i = 0; i < 40; i++) env.probe(pos, V(), V(), 1, 2, 1 / 60);
    expect(env.groundY).toBe(10);
    expect(env.grounded).toBeCloseTo(1, 2);
  });

  it('pushes back off a wall that is taller than the machine', () => {
    const env = new EnvironmentInterference(flatWorld([box(3, 10, 0, 2, 20, 8)]));
    const pos = V(0.6, 2, 0);
    env.probe(pos, V(), V(), 1.2, 2, 1 / 60);
    expect(env.repulsion.x).toBeLessThan(0);
    expect(env.contact).toBeTruthy();
  });

  it('relieves the push while the player drives INTO the wall', () => {
    const world = flatWorld([box(3, 10, 0, 2, 20, 8)]);
    const into = new EnvironmentInterference(world);
    const away = new EnvironmentInterference(world);
    into.probe(V(0.6, 2, 0), V(), V(1, 0, 0), 1.2, 2, 1 / 60);
    away.probe(V(0.6, 2, 0), V(), V(-1, 0, 0), 1.2, 2, 1 / 60);
    expect(Math.abs(into.repulsion.x)).toBeLessThan(Math.abs(away.repulsion.x));
  });

  it('amplifies the push while the player pulls AWAY', () => {
    const world = flatWorld([box(3, 10, 0, 2, 20, 8)]);
    const neutral = new EnvironmentInterference(world);
    const away = new EnvironmentInterference(world);
    neutral.probe(V(0.6, 2, 0), V(), V(), 1.2, 2, 1 / 60);
    away.probe(V(0.6, 2, 0), V(), V(-1, 0, 0), 1.2, 2, 1 / 60);
    expect(Math.abs(away.repulsion.x)).toBeGreaterThan(Math.abs(neutral.repulsion.x));
  });

  it('keeps the machine inside the arena', () => {
    const env = new EnvironmentInterference(flatWorld());
    const pos = V(200, 5, 0);
    env.probe(pos, V(), V(), 1, 2, 1 / 60);
    expect(Math.hypot(pos.x, pos.z)).toBeLessThanOrEqual(120);
    expect(env.repulsion.x).toBeLessThan(0);
  });

  it('keeps the machine under the ceiling', () => {
    const env = new EnvironmentInterference(flatWorld());
    const vel = V(0, 10, 0);
    env.probe(V(0, 94.5, 0), vel, V(), 1, 2, 1 / 60);
    expect(env.repulsion.y).toBeLessThan(0);
    expect(vel.y).toBeLessThan(0);
  });

  it('ground friction only bites horizontally, and eases off under power', () => {
    const env = new EnvironmentInterference(flatWorld());
    const pos = V(0, 2, 0);
    for (let i = 0; i < 40; i++) env.probe(pos, V(), V(), 1, 2, 1 / 60);

    const coasting = V(10, 5, 0);
    env.applyGroundFriction(coasting, 0, 1, 1 / 60);
    expect(coasting.x).toBeLessThan(10);
    expect(coasting.y).toBe(5);

    const driving = V(10, 0, 0);
    env.applyGroundFriction(driving, 1, 1, 1 / 60);
    expect(driving.x).toBeGreaterThan(coasting.x);
  });

  it('no friction while airborne', () => {
    const env = new EnvironmentInterference(flatWorld());
    const v = V(10, 0, 0);
    env.applyGroundFriction(v, 0, 1, 1 / 60);
    expect(v.x).toBe(10);
  });
});

// ============================================================
//  §7 Camera Dynamics
// ============================================================

describe('CameraDynamics', () => {
  const cam = () => new THREE.PerspectiveCamera(60, 1.6, 0.1, 900);
  const p = (over = {}) => ({
    position: V(), forward: V(0, 0, 1), up: V(0, 1, 0), right: V(1, 0, 0),
    velocity: V(), accel: V(), aimPoint: null, assistAuthority: 0,
    jerk: 0, bank: 0, thrust: 0, groundY: 0, impact: 0, avoid: null,
    ...over,
  });

  it('sits behind and above the machine', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 120; i++) c.update(p(), 1 / 60);
    expect(c.position.z).toBeLessThan(0);
    expect(c.position.y).toBeGreaterThan(0);
  });

  it('scales the boom with the size of the machine', () => {
    const small = new CameraDynamics(cam());
    const big = new CameraDynamics(cam());
    small.fitTo({ ...STATS, extent: 1 });
    big.fitTo({ ...STATS, extent: 6 });
    expect(big.config.distance).toBeGreaterThan(small.config.distance);
  });

  it('does not fly overhead when the machine dives', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    const dive = p({ forward: new THREE.Vector3(0, -0.9, 0.44).normalize(), velocity: V(0, -20, 10) });
    for (let i = 0; i < 200; i++) c.update(dive, 1 / 60);
    // The property that matters: the camera stays BEHIND the machine, so the
    // horizontal offset must still dominate the vertical one.
    const horizontal = Math.hypot(c.position.x, c.position.z);
    expect(horizontal).toBeGreaterThan(c.position.y);
  });

  it('never dips below the floor', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    const climb = p({ forward: new THREE.Vector3(0, 0.95, 0.3).normalize() });
    for (let i = 0; i < 200; i++) c.update(climb, 1 / 60);
    expect(c.position.y).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });

  it('lags behind a teleport rather than snapping', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.update(p(), 1 / 60);
    const before = c.position.clone();
    c.update(p({ position: V(0, 0, 100) }), 1 / 60);
    expect(c.position.distanceTo(before)).toBeLessThan(50);
  });

  it('pumps the FOV with jerk and speed', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 5; i++) c.update(p(), 1 / 60);
    const calm = c.fov;
    for (let i = 0; i < 120; i++) c.update(p({ jerk: 300, velocity: V(0, 0, 30), thrust: 1 }), 1 / 60);
    expect(c.fov).toBeGreaterThan(calm);
  });

  it('exports VFX levels that stay in range', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 200; i++) c.update(p({ jerk: 900, velocity: V(0, 0, 40), thrust: 1 }), 1 / 60);
    for (const v of Object.values(c.vfx)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });

  it('pans toward the escape route when a collision looms', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 60; i++) c.update(p(), 1 / 60);
    const gazeX = c.gaze.x;
    for (let i = 0; i < 60; i++) {
      c.update(p({ avoid: { normal: V(1, 0, 0) }, avoidUrgency: 1 }), 1 / 60);
    }
    expect(c.gaze.x).toBeGreaterThan(gazeX);
  });

  // ---------------------------------------------------------- fighting

  /**
   * Settle the camera on a machine at the origin with a target `range`
   * metres down +Z, and report where it ended up.
   */
  const fightAt = (range, over = {}) => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    const shot = p({
      aimPoint: range === null ? null : V(0, 0, range),
      assistAuthority: 1,
      ...over,
    });
    for (let i = 0; i < 400; i++) c.update(shot, 1 / 60);
    return c;
  };

  it('gets off the firing line so the machine is not standing in the way', () => {
    // Straight down the line the machine sits directly in front of what it
    // is shooting at, and hides both it and every round crossing the gap.
    const c = fightAt(30);
    const off = Math.abs(c.position.x);
    expect(off, 'a pace to the side').toBeGreaterThan(1.5);
    expect(c.position.z, 'still behind the machine').toBeLessThan(0);
    expect(c.position.y, 'and above it').toBeGreaterThan(1.5);
  });

  it('looks down the gap rather than at either end of it', () => {
    const c = fightAt(30);
    expect(c.gaze.z, 'past the machine').toBeGreaterThan(3);
    expect(c.gaze.z, 'but short of the target').toBeLessThan(30 * 0.6);
  });

  it('lines the boom up behind the firing line, not behind the nose', () => {
    // Strafing, the machine's nose and the direction it is shooting come
    // apart — and it is the firing line the player needs to see down.
    const c = fightAt(30, { forward: V(1, 0, 0), velocity: V(12, 0, 0) });
    expect(c.position.z, 'behind the target line').toBeLessThan(-3);
    expect(Math.abs(c.position.z), 'and not off to the side of it')
      .toBeGreaterThan(Math.abs(c.position.x) * 0.8);
  });

  it('opens the boom out as the fight gets longer', () => {
    const near = fightAt(8);
    const far = fightAt(70);
    const out = (c) => Math.hypot(c.position.x, c.position.z);
    expect(out(far)).toBeGreaterThan(out(near) * 1.2);
  });

  it('goes back to being a chase cam when the lock drops', () => {
    const c = fightAt(30);
    expect(c.engage).toBeGreaterThan(0.9);
    const fighting = Math.abs(c.position.x);
    for (let i = 0; i < 400; i++) c.update(p(), 1 / 60);
    expect(c.engage).toBeLessThan(0.05);
    expect(Math.abs(c.position.x), 'back on the tail').toBeLessThan(fighting * 0.4);
    expect(c.position.z).toBeLessThan(0);
  });

  it('the framing does not flicker when the assist lets go', () => {
    // The assist backs off the moment the player looks away by hand. A
    // camera that reframed every time they did would be unusable, so the
    // framing keys off whether there IS a target, not off how hard the
    // assist is pulling on it.
    const c = fightAt(30, { assistAuthority: 0 });
    expect(c.engage).toBeGreaterThan(0.9);
  });

  it('swings the boom round the machine on demand', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 120; i++) c.update(p(), 1 / 60);
    expect(c.position.z, 'starts behind').toBeLessThan(0);

    c.orbitBy(Math.PI, 0);
    for (let i = 0; i < 200; i++) c.update(p({ orbiting: true }), 1 / 60);
    expect(c.position.z, 'ends in front').toBeGreaterThan(0);
    // still the same distance out, just from the other side
    expect(Math.hypot(c.position.x, c.position.z)).toBeGreaterThan(2);
  });

  it('mouse-up lifts the camera and looks down, like the editor orbit', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 120; i++) c.update(p(), 1 / 60);
    const level = c.position.y;
    c.orbitBy(0, 1.0);
    for (let i = 0; i < 200; i++) c.update(p({ orbiting: true }), 1 / 60);
    expect(c.position.y).toBeGreaterThan(level);
  });

  it('clamps the swing so it never goes over the top', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.orbitBy(99, 99);
    expect(c.orbit.yaw).toBeLessThanOrEqual(c.config.orbitYawLimit + 1e-9);
    expect(c.orbit.pitch).toBeLessThanOrEqual(c.config.orbitPitchLimit + 1e-9);
    for (let i = 0; i < 200; i++) c.update(p({ orbiting: true }), 1 / 60);
    // never directly overhead: the horizontal offset survives
    expect(Math.hypot(c.position.x, c.position.z)).toBeGreaterThan(0.5);
  });

  it('holds the swing at a standstill and eases it back when travelling', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.orbitBy(1.4, 0);
    for (let i = 0; i < 200; i++) c.update(p(), 1 / 60);
    expect(c.orbit.yaw, 'parked: it stays where you left it').toBeCloseTo(1.4, 3);

    for (let i = 0; i < 200; i++) c.update(p({ velocity: V(0, 0, 30) }), 1 / 60);
    expect(c.orbit.yaw, 'moving: it comes back behind').toBeLessThan(0.3);
  });

  it('keeps the machine framed while swung round', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.orbitBy(Math.PI, 0);
    // A lead point 5m ahead would sit off-screen from in front; the gaze has
    // to fall back onto the machine itself.
    for (let i = 0; i < 200; i++) {
      c.update(p({ orbiting: true, velocity: V(0, 0, 20) }), 1 / 60);
    }
    expect(Math.abs(c.gaze.z)).toBeLessThan(c.config.leadDistance);
  });

  it('zooms multiplicatively, and clamps at both ends', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 120; i++) c.update(p(), 1 / 60);
    const near0 = c.position.length();

    c.zoomBy(0.5);
    expect(c.zoom).toBeCloseTo(Math.exp(0.5), 6);
    for (let i = 0; i < 200; i++) c.update(p(), 1 / 60);
    expect(c.position.length()).toBeGreaterThan(near0);

    c.zoomBy(99);
    expect(c.zoom).toBe(c.config.zoomMax);
    c.zoomBy(-99);
    expect(c.zoom).toBe(c.config.zoomMin);
  });

  it('a shorter boom really does put the camera closer', () => {
    const near = new CameraDynamics(cam());
    const far = new CameraDynamics(cam());
    near.fitTo(STATS); far.fitTo(STATS);
    near.zoom = 0.5; far.zoom = 2;
    for (let i = 0; i < 200; i++) { near.update(p(), 1 / 60); far.update(p(), 1 / 60); }
    expect(near.position.length()).toBeLessThan(far.position.length());
  });

  it('recenter puts the boom back behind the machine', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.orbitBy(2, 0.8);
    c.recenter();
    expect(c.orbit.yaw).toBe(0);
    expect(c.orbit.pitch).toBe(0);

    c.snap(V(), V(0, 0, 1));
    expect(c.position.z).toBeLessThan(0);
  });

  it('snap leaves the swing alone; recentring is the caller policy', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.orbitBy(1.1, 0);
    c.snap(V(), V(0, 0, 1));
    expect(c.orbit.yaw).toBeCloseTo(1.1, 6);
    // and the lazy first-frame framing does not wipe it either
    c.update(p({ orbiting: true }), 1 / 60);
    expect(c.orbit.yaw).toBeCloseTo(1.1, 6);
  });

  it('zoom carries through a snap, because it is a player preference', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    c.zoom = 2;
    c.snap(V(), V(0, 0, 1));
    expect(c.zoom).toBe(2);
    expect(Math.abs(c.position.z)).toBeCloseTo(c.config.distance * 2, 4);
  });

  it('keeps the machine in frame when locked onto something overhead', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    const overhead = p({ aimPoint: V(0, 40, 10), assistAuthority: 1, grounded: 1 });
    for (let i = 0; i < 200; i++) c.update(overhead, 1 / 60);
    expect(c.gaze.y).toBeLessThanOrEqual(c.config.distance * 0.9 + 0.01);

    // airborne, the gaze is free to follow the target upward
    const flying = p({ aimPoint: V(0, 40, 10), assistAuthority: 1, grounded: 0 });
    for (let i = 0; i < 200; i++) c.update(flying, 1 / 60);
    expect(c.gaze.y).toBeGreaterThan(c.config.distance * 0.9);
  });

  it('frames the midpoint when a lock is engaged', () => {
    const c = new CameraDynamics(cam());
    c.fitTo(STATS);
    for (let i = 0; i < 120; i++) {
      c.update(p({ aimPoint: V(40, 0, 0), assistAuthority: 1 }), 1 / 60);
    }
    expect(c.gaze.x).toBeGreaterThan(4);
  });
});

// ============================================================
//  §8 Kinetic Feedback
// ============================================================

describe('KineticFeedback', () => {
  it('drives the visual channel without any audio context', () => {
    const f = new KineticFeedback();
    for (let i = 0; i < 60; i++) {
      f.update({ thrust: 1, jerk: 300, speed: 30, impact: 0, strain: 0 }, 1 / 60);
    }
    expect(f.visual.chroma).toBeGreaterThan(0.5);
    expect(f.visual.noise).toBeGreaterThan(0.5);
    expect(f.rumble).toBeGreaterThan(0);
  });

  it('settles back to silence', () => {
    const f = new KineticFeedback();
    for (let i = 0; i < 60; i++) f.update({ thrust: 1, jerk: 300, speed: 30 }, 1 / 60);
    for (let i = 0; i < 300; i++) f.update({ thrust: 0, jerk: 0, speed: 0 }, 1 / 60);
    expect(f.visual.chroma).toBeLessThan(0.01);
    expect(f.rumble).toBeLessThan(0.01);
  });

  it('promotes energy strain into rumble', () => {
    const calm = new KineticFeedback();
    const strained = new KineticFeedback();
    for (let i = 0; i < 60; i++) {
      calm.update({ thrust: 0, jerk: 0, speed: 0, strain: 0 }, 1 / 60);
      strained.update({ thrust: 0, jerk: 0, speed: 0, strain: 1 }, 1 / 60);
    }
    expect(strained.rumble).toBeGreaterThan(calm.rumble);
  });

  it('clamps every channel to 0..1', () => {
    const f = new KineticFeedback();
    for (let i = 0; i < 120; i++) {
      f.update({ thrust: 9, jerk: 9999, speed: 999, impact: 9, strain: 9 }, 1 / 60);
    }
    for (const v of Object.values(f.visual)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
    expect(f.rumble).toBeLessThanOrEqual(1.0001);
  });

  it('mute and suspend are safe without audio', () => {
    const f = new KineticFeedback();
    expect(() => { f.setMuted(true); f.resume(); f.suspend(); }).not.toThrow();
  });
});
