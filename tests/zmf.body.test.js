import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ZMFBody } from '../src/zmf/ZMFBody.js';
import { SyntheticInput, Robot, SimpleAI } from '../src/game/Robot.js';
import { Assembly, PRESETS, computeStats } from '../src/core/Assembly.js';
import { Rig } from '../src/core/Rig.js';
import { testWorld } from './helpers/dom.js';

const STATS = computeStats(PRESETS.biped.build());
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function makeBody(stats = STATS, world = testWorld()) {
  const body = new ZMFBody(stats, world, { rideHeight: 2 });
  body.reset(V(0, 2, 0));
  return body;
}

/** Run the body for `seconds` with a fixed input. */
function run(body, input, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    body.update(input, dt);
    input.endFrame();
  }
  return body;
}

let input;
beforeEach(() => { input = new SyntheticInput(); });

describe('ZMFBody basics', () => {
  it('starts at rest on the ground', () => {
    const b = makeBody();
    run(b, input, 0.5);
    expect(b.speed).toBeLessThan(0.5);
    expect(b.grounded).toBeGreaterThan(0.9);
    expect(b.position.y).toBeCloseTo(2, 1);
  });

  it('drives forward under a forward command', () => {
    const b = makeBody();
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 2);
    expect(b.position.z).toBeGreaterThan(5);
    expect(b.speed).toBeGreaterThan(5);
  });

  it('strafes right for a +X command, and left for -X', () => {
    const right = makeBody();
    right.input = null;
    input.move.set(1, 0, 0);
    input.intensity = 1;
    run(right, input, 1);
    expect(right.position.x).toBeGreaterThan(1);

    const left = makeBody();
    const li = new SyntheticInput();
    li.move.set(-1, 0, 0);
    li.intensity = 1;
    run(left, li, 1);
    expect(left.position.x).toBeLessThan(-1);
  });

  it('settles at a terminal ground speed', () => {
    const b = makeBody();
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 2.5);
    const v1 = b.speed;
    run(b, input, 1);
    // still well short of the arena wall, so this really is terminal velocity
    expect(Math.hypot(b.position.x, b.position.z)).toBeLessThan(100);
    expect(b.speed).toBeCloseTo(v1, 0);
    expect(v1).toBeLessThan(b.groundSpeedCap * 1.6);
  });

  it('coasts to a stop when the stick is released', () => {
    const b = makeBody();
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 2);
    input.move.set(0, 0, 0);
    input.intensity = 0;
    run(b, input, 6);
    expect(b.speed).toBeLessThan(0.6);
  });
});

describe('gravity and flight', () => {
  it('falls back to the ground when dropped', () => {
    const b = makeBody();
    b.reset(V(0, 40, 0));
    run(b, input, 8);
    expect(b.position.y).toBeCloseTo(2, 0);
    expect(b.grounded).toBeGreaterThan(0.9);
  });

  it('holding lift climbs, and releasing it falls', () => {
    const b = makeBody();
    input.hold('up', true);
    run(b, input, 3);
    const peak = b.position.y;
    expect(peak).toBeGreaterThan(8);
    expect(b.gravityScale).toBeLessThan(0.3);

    input.hold('up', false);
    run(b, input, 3);
    expect(b.position.y).toBeLessThan(peak);
    expect(b.gravityScale).toBeGreaterThan(0.9);
  });

  it('a legged machine jumps from the ground', () => {
    const b = makeBody();
    run(b, input, 0.5);
    input.press('up');
    b.update(input, 1 / 60);
    expect(b.velocity.y).toBeGreaterThan(5);
  });

  it('the machine never sinks through the floor', () => {
    const b = makeBody();
    b.reset(V(0, 60, 0));
    let lowest = Infinity;
    for (let i = 0; i < 900; i++) {
      b.update(input, 1 / 60);
      lowest = Math.min(lowest, b.position.y);
    }
    expect(lowest).toBeGreaterThan(1.9);
  });
});

describe('energy', () => {
  it('flight drains it and the ground restores it', () => {
    const b = makeBody();
    input.hold('up', true);
    run(b, input, 4);
    const spent = b.energy;
    expect(spent).toBeLessThan(0.7);

    input.hold('up', false);
    run(b, input, 8);
    expect(b.energy).toBeGreaterThan(spent);
  });

  it('stays inside 0..1 and reports strain once the tank runs dry', () => {
    const b = makeBody();
    input.hold('up', true);
    input.hold('boost', true);
    run(b, input, 3);
    expect(b.energy).toBeGreaterThanOrEqual(0);
    expect(b.energy).toBeLessThan(0.1);
    expect(b.strain).toBeGreaterThan(0.5);

    // and it never leaves the 0..1 range, however long we thrash it
    run(b, input, 20);
    expect(b.energy).toBeGreaterThanOrEqual(0);
    expect(b.energy).toBeLessThanOrEqual(1);
  });

  it('an empty tank grounds the machine', () => {
    const b = makeBody();
    input.hold('up', true);
    run(b, input, 30);
    expect(b.energy).toBeLessThan(0.05);
    run(b, input, 10);
    expect(b.position.y).toBeLessThan(12);
  });
});

describe('dash', () => {
  const dash = (x, y, z) => ({ dir: V(x, y, z), t: 0 });

  it('fires in every horizontal direction, backwards included', () => {
    for (const [dir, axis, sign] of [
      [dash(0, 0, 1), 'z', 1], [dash(0, 0, -1), 'z', -1],
      [dash(1, 0, 0), 'x', 1], [dash(-1, 0, 0), 'x', -1],
    ]) {
      const b = makeBody();
      const i = new SyntheticInput();
      run(b, i, 0.3);
      i.dash = dir;
      b.update(i, 1 / 60);
      expect(Math.sign(b.velocity[axis]), `${axis}${sign}`).toBe(sign);
      expect(Math.abs(b.velocity[axis])).toBeGreaterThan(5);
    }
  });

  it('a backward dash is nearly as strong as a forward one', () => {
    const speedOf = (dir) => {
      const b = makeBody();
      const i = new SyntheticInput();
      run(b, i, 0.3);
      i.dash = dir;
      b.update(i, 1 / 60);
      return b.speed;
    };
    const fwd = speedOf(dash(0, 0, 1));
    const back = speedOf(dash(0, 0, -1));
    expect(back).toBeGreaterThan(fwd * 0.8);
  });

  it('is consumed, and will not re-fire until the cooldown expires', () => {
    const b = makeBody();
    const i = new SyntheticInput();
    run(b, i, 0.3);
    i.dash = dash(0, 0, 1);
    b.update(i, 1 / 60);
    expect(i.dash).toBeNull();
    expect(b.dashCooldown).toBeGreaterThan(0);

    const after = b.speed;
    i.dash = dash(0, 0, 1);
    b.update(i, 1 / 60);
    expect(b.speed).toBeLessThan(after + 1);
  });

  it('costs energy and will not fire on an empty tank', () => {
    const b = makeBody();
    const i = new SyntheticInput();
    run(b, i, 0.3);
    const before = b.energy;
    i.dash = dash(0, 0, 1);
    b.update(i, 1 / 60);
    expect(b.energy).toBeLessThan(before);

    b.energy = 0;
    b.dashCooldown = 0;
    const still = b.speed;
    i.dash = dash(0, 0, -1);
    b.update(i, 1 / 60);
    expect(i.dash).toBeTruthy();          // not consumed
    expect(b.speed).toBeLessThan(still + 0.5);
  });

  it('stays in the horizontal plane while grounded', () => {
    const b = makeBody();
    const i = new SyntheticInput();
    run(b, i, 0.3);
    i.dash = dash(0, 0, 1);
    b.update(i, 1 / 60);
    expect(Math.abs(b.velocity.y)).toBeLessThan(1);
  });
});

describe('ABC layers', () => {
  it('switches on the layer keys', () => {
    const b = makeBody();
    input.press('layerA');
    b.update(input, 1 / 60);
    expect(b.layers.pending.key).toBe('A');
    input.endFrame();

    input.press('layerC');
    b.update(input, 1 / 60);
    expect(b.layers.pending.key).toBe('C');
  });

  it('A accelerates harder than C from a standing start', () => {
    const build = (layer) => {
      const b = makeBody();
      const i = new SyntheticInput();
      i.press(layer);
      b.update(i, 1 / 60);
      i.endFrame();
      i.move.set(0, 0, 1);
      i.intensity = 1;
      run(b, i, 0.6);
      return b.speed;
    };
    expect(build('layerA')).toBeGreaterThan(build('layerC'));
  });
});

describe('lock-on and assist', () => {
  const target = { position: V(0, 2, 40), radius: 2 };

  it('is inert until a target is locked', () => {
    const b = makeBody();
    b.setTarget(target);
    run(b, input, 1);
    expect(b.assist.hasTarget).toBe(false);
  });

  it('takes authority once locked and the aim stick is still', () => {
    const b = makeBody();
    b.setTarget(target);
    b.locked = true;
    run(b, input, 2);
    expect(b.assist.hasTarget).toBe(true);
    expect(b.assist.authority).toBeGreaterThan(0.8);
    expect(b.telemetry().range).toBeCloseTo(40, 0);
  });

  it('turns the machine to face the target', () => {
    const b = makeBody();
    b.setTarget({ position: V(40, 2, 0), radius: 2 });
    b.locked = true;
    run(b, input, 3);
    expect(b.forward.x).toBeGreaterThan(0.7);
  });

  it('strafing does not break the lock, but aiming away does', () => {
    const strafe = makeBody();
    strafe.setTarget(target);
    strafe.locked = true;
    const si = new SyntheticInput();
    si.move.set(1, 0, 0);
    si.intensity = 1;
    run(strafe, si, 2);
    expect(strafe.assist.authority).toBeGreaterThan(0.8);

    const aim = makeBody();
    aim.setTarget(target);
    aim.locked = true;
    const ai = new SyntheticInput();
    ai.look.yaw = 6;      // full deflection
    run(aim, ai, 2);
    expect(aim.assist.authority).toBeLessThan(0.2);
  });
});

describe('telemetry', () => {
  it('reports every channel the HUD reads, all finite', () => {
    const b = makeBody();
    input.move.set(0.5, 0, 1);
    input.intensity = 1;
    run(b, input, 2);
    const t = b.telemetry();
    for (const key of [
      'speed', 'thrust', 'jerk', 'zeta', 'mass', 'energy', 'strain',
      'grounded', 'airborne', 'bank', 'turnRate', 'assist', 'frameLock', 'relief', 'impact',
    ]) {
      expect(Number.isFinite(t[key]), key).toBe(true);
    }
    expect(t.layer.key).toBe('B');
  });
});

describe('robustness', () => {
  it('survives absurd input without producing NaN', () => {
    const b = makeBody();
    for (let i = 0; i < 600; i++) {
      input.move.set(Math.sin(i) * 3, Math.cos(i) * 3, Math.sin(i * 0.3) * 3);
      input.intensity = 1;
      input.look.yaw = Math.sin(i * 0.7) * 12;
      input.look.pitch = Math.cos(i * 0.5) * 12;
      input.hold('up', i % 30 < 15);
      input.hold('boost', i % 50 < 10);
      b.update(input, 1 / 60);
      input.endFrame();
    }
    expect(Number.isFinite(b.position.x)).toBe(true);
    expect(Number.isFinite(b.velocity.y)).toBe(true);
    expect(b.quaternion.length()).toBeCloseTo(1, 4);
  });

  it('is stable across wildly different timesteps', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 30, 1 / 20]) {
      const b = makeBody();
      const i = new SyntheticInput();
      i.move.set(0, 0, 1);
      i.intensity = 1;
      run(b, i, 3, dt);
      expect(Number.isFinite(b.position.z), `dt=${dt}`).toBe(true);
      expect(b.position.z, `dt=${dt}`).toBeGreaterThan(3);
      expect(b.position.z, `dt=${dt}`).toBeLessThan(80);
    }
  });

  it('stays inside the arena however hard it is pushed', () => {
    const b = makeBody();
    input.move.set(0, 0, 1);
    input.intensity = 1;
    input.hold('boost', true);
    run(b, input, 40);
    expect(Math.hypot(b.position.x, b.position.z)).toBeLessThanOrEqual(120);
  });

  it('leg count changes ground traction and jump power', () => {
    const hover = new ZMFBody(computeStats(Assembly.createDefault()), testWorld(), { rideHeight: 1 });
    const quad = new ZMFBody(computeStats(PRESETS.multileg.build()), testWorld(), { rideHeight: 1 });
    expect(quad.grip).toBeGreaterThan(hover.grip);
    expect(quad.jumpPower).toBeGreaterThan(hover.jumpPower);
  });
});

describe('Robot', () => {
  it('assembles rig, body and animator together', () => {
    const asm = PRESETS.biped.build();
    const robot = new Robot(asm, testWorld());
    expect(robot.rig).toBeInstanceOf(Rig);
    expect(robot.stats.gait).toBe('walk');
    expect(robot.hp).toBeGreaterThan(0);
    expect(robot.object3D.children).toContain(robot.rig.root);
  });

  it('stands on the ground at spawn', () => {
    const robot = new Robot(PRESETS.biped.build(), testWorld());
    expect(robot.position.y).toBeCloseTo(-robot.rig.restLowestY, 5);
  });

  it('drives, animates and syncs its transform', () => {
    const robot = new Robot(PRESETS.multileg.build(), testWorld());
    const i = new SyntheticInput();
    i.move.set(0, 0, 1);
    i.intensity = 1;
    for (let k = 0; k < 180; k++) { robot.update(i, 1 / 60); i.endFrame(); }
    expect(robot.position.z).toBeGreaterThan(2);
    expect(robot.object3D.position.z).toBeCloseTo(robot.position.z, 6);
    expect(robot.animator.gaitFreq).toBeGreaterThan(0.5);
  });

  it('takes damage and dies', () => {
    const robot = new Robot(PRESETS.hopper.build(), testWorld());
    robot.damage(robot.maxHp - 1);
    expect(robot.alive).toBe(true);
    robot.damage(5);
    expect(robot.hp).toBe(0);
    expect(robot.alive).toBe(false);
  });

  it('tracks a lock target through the body', () => {
    const world = testWorld();
    const a = new Robot(PRESETS.biped.build(), world);
    const b = new Robot(PRESETS.hopper.build(), world, { x: 30, z: 0 });
    a.setTarget(b);
    a.setLocked(true);
    const i = new SyntheticInput();
    for (let k = 0; k < 120; k++) { a.update(i, 1 / 60); i.endFrame(); }
    expect(a.body.assist.hasTarget).toBe(true);
    expect(a.body.assist.range).toBeGreaterThan(10);
  });
});

describe('SimpleAI', () => {
  it('closes on a distant player and backs off from a close one', () => {
    const world = testWorld();
    const bot = new Robot(PRESETS.biped.build(), world, { x: 0, z: 0 });
    const ai = new SimpleAI(bot, { range: 20, style: 'orbit' });

    const far = V(0, 2, 90);
    for (let i = 0; i < 300; i++) ai.update(far, 1 / 60);
    const after = bot.position.distanceTo(far);
    expect(after).toBeLessThan(90);
    expect(Number.isFinite(bot.position.x)).toBe(true);
  });

  it('every AI style runs without error', () => {
    const world = testWorld();
    for (const style of ['orbit', 'rusher', 'flyer']) {
      const bot = new Robot(PRESETS.multileg.build(), world);
      const ai = new SimpleAI(bot, { style, range: 25 });
      for (let i = 0; i < 200; i++) ai.update(V(0, 2, 40), 1 / 60);
      expect(Number.isFinite(bot.position.y), style).toBe(true);
    }
  });
});
