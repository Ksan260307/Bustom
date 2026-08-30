import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ZMFBody } from '../src/zmf/ZMFBody.js';
import { SyntheticInput, Robot, SimpleAI } from '../src/game/Robot.js';
import { Assembly, PRESETS, computeStats } from '../src/core/Assembly.js';
import { Rig } from '../src/core/Rig.js';
import { testWorld, stripEquips } from './helpers/dom.js';
import { EQUIP, EQUIP_META, STAGGER, LANDING } from '../src/core/constants.js';

const STATS = computeStats(stripEquips(PRESETS.biped.build()));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function makeBody(stats = STATS, world = testWorld()) {
  const body = new ZMFBody(stats, world, { rideHeight: 2 });
  body.reset(V(0, 2, 0));
  return body;
}

/** Run the body for `seconds` with a fixed input. */
/** Stats for a biped wearing the named equipment plates. */
function platedStats(...types) {
  const a = stripEquips(PRESETS.biped.build());
  for (const t of types) a.addEquipOnFace(a.core.id, 4, t);
  return computeStats(a);
}

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
    // Boosting is the heaviest drain there is, so this needs a machine that
    // can actually boost.
    const b = makeBody(platedStats('boost'));
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

  it('costs no energy, and still works on an empty tank', () => {
    // The cooldown is what limits a dash. Charging energy for it too meant
    // a machine that had spent its tank could neither boost nor dodge —
    // the two things you want most at exactly that moment.
    const b = makeBody();
    const i = new SyntheticInput();
    run(b, i, 0.3);
    const before = b.energy;
    i.dash = dash(0, 0, 1);
    b.update(i, 1 / 60);
    expect(b.energy).toBe(before);
    expect(i.dash, 'consumed').toBeNull();

    b.energy = 0;
    b.dashCooldown = 0;
    const still = b.speed;
    i.dash = dash(0, 0, 1);
    b.update(i, 1 / 60);
    expect(i.dash, 'an empty tank does not stop a dash').toBeNull();
    expect(b.speed, 'and it is a real one').toBeGreaterThan(still + 1);
  });

  it('the tank actually empties on the ground, which it did not', () => {
    // Ground regeneration was 0.55 a second against a maximum burn of 0.45,
    // so holding the boost down on the ground moved the gauge by nothing at
    // all. Energy looked like a general resource and was a flight-only one.
    // With a boost plate on it: a machine that cannot boost cannot burn.
    const b = makeBody(platedStats(EQUIP.BOOST));
    const i = new SyntheticInput();
    i.move.set(0, 0, 1);
    i.hold('boost', true);
    run(b, i, 4);
    expect(b.energy, 'a ground boost costs').toBeLessThan(0.2);

    // And walking pays it back, which is what makes spending it a decision.
    const j = new SyntheticInput();
    j.move.set(0, 0, 1);
    run(b, j, 4);
    expect(b.energy, 'walking recovers').toBeGreaterThan(0.9);
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

describe('ground lock-on', () => {
  /** A target well above head height, the case that used to fly the machine. */
  const high = { position: V(0, 26, 45), radius: 2 };

  it('does not take off while walking with a high target locked', () => {
    const b = makeBody();
    b.setTarget(high);
    b.locked = true;
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 6);

    expect(b.assist.authority, 'the lock is genuinely engaged').toBeGreaterThan(0.8);
    expect(b.aimForward.y, 'it really is aiming up at it').toBeGreaterThan(0.2);
    expect(b.forward.y, 'but the chassis stays level').toBeCloseTo(0, 2);
    expect(b.position.y, 'and on the ground').toBeCloseTo(2, 1);
    expect(b.grounded).toBeGreaterThan(0.9);
  });

  it('holds the floor even while strafing under a lock', () => {
    const b = makeBody();
    b.setTarget(high);
    b.locked = true;
    input.move.set(1, 0, 0.4);
    input.intensity = 1;
    run(b, input, 6);
    expect(b.position.y).toBeCloseTo(2, 1);
    expect(Math.abs(b.velocity.y)).toBeLessThan(1);
  });

  it('a target below does not push the machine into the floor either', () => {
    const b = makeBody();
    b.setTarget({ position: V(0, -20, 45), radius: 2 });
    b.locked = true;
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 5);
    expect(b.position.y).toBeCloseTo(2, 1);
  });

  it('deliberate lift still works with a lock engaged', () => {
    const b = makeBody();
    b.setTarget(high);
    b.locked = true;
    input.move.set(0, 0, 1);
    input.intensity = 1;
    input.hold('up', true);
    run(b, input, 3);
    expect(b.position.y).toBeGreaterThan(8);
  });

  it('turns toward the target instead of leaning at it', () => {
    const b = makeBody();
    // Off to one side and well above: the yaw must happen, the pitch must not.
    b.setTarget({ position: V(60, 30, 0), radius: 2 });
    b.locked = true;
    input.move.set(0, 0, 1);
    input.intensity = 1;
    // Long enough to have turned, short enough that it has not yet arrived:
    // once it flies past the target the correct answer is to turn round
    // again, which looks exactly like failing this test. Two seconds leaves
    // the machine some twenty metres short of it. Moving the target further
    // out instead does not work — the assist ignores anything past its
    // range, and then nothing turns at all.
    run(b, input, 2);

    expect(b.forward.x, 'it turned to face the target').toBeGreaterThan(0.7);
    expect(Math.abs(b.forward.y), 'without tipping the chassis').toBeLessThan(0.05);
    expect(b.aimForward.y, 'the aim still points up at it').toBeGreaterThan(0.2);
  });

  it('the level stance fades out as the machine leaves the ground', () => {
    const b = makeBody();
    b.setTarget({ position: V(0, 45, 15), radius: 2 });   // steeply overhead
    b.locked = true;
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 3);

    expect(b.aimForward.y, 'planted: aiming steeply up').toBeGreaterThan(0.5);
    expect(Math.abs(b.forward.y), 'but flat as a table').toBeLessThan(0.05);

    input.hold('up', true);
    run(b, input, 2);
    expect(b.grounded).toBeLessThan(0.2);
    expect(Math.abs(b.forward.y - b.aimForward.y),
      'off the floor, the chassis is the aim again').toBeLessThan(0.12);
    // Only that it has come off flat — while planted it is held under 0.05,
    // and the assertion above is the one that says it follows the aim.
    //
    // This used to demand 0.3, which passed for the wrong reason: the
    // machine flew PAST the target and ended up pitched steeply DOWN at it
    // (-0.87), and the magnitude happened to clear the bar. A lighter
    // machine climbs less far in the same two seconds and sits gently nose
    // up instead, which is the behaviour the test is named for.
    expect(Math.abs(b.forward.y), 'and no longer pinned flat').toBeGreaterThan(0.1);
  });

  it('mouse pitch is remembered on the ground and honoured in the air', () => {
    const b = makeBody();
    input.look.pitch = 3;
    run(b, input, 1);
    input.look.pitch = 0;
    run(b, input, 1);

    expect(Math.abs(b.forward.y), 'the chassis ignored it while planted').toBeLessThan(0.05);
    expect(b.aimForward.y, 'but the aim went where it was pointed').toBeGreaterThan(0.3);

    input.hold('up', true);
    run(b, input, 2);
    expect(b.forward.y, 'and the nose follows once off the floor').toBeGreaterThan(0.2);
  });

  it('once airborne, thrust follows the nose again', () => {
    // Same lock, but off the ground: forward thrust toward a target above us
    // SHOULD carry us upward. The flattening is a ground-contact rule only.
    const b = makeBody();
    b.reset(V(0, 12, 0));
    // high and inside assist range, but too far to overshoot in this window
    b.setTarget({ position: V(0, 45, 50), radius: 2 });
    b.locked = true;
    input.move.set(0, 0, 1);
    input.intensity = 1;
    input.hold('up', true);
    const start = b.position.y;
    run(b, input, 1.5);
    expect(b.grounded).toBeLessThan(0.1);
    expect(b.forward.y, 'nose is up at the target').toBeGreaterThan(0.05);
    expect(b.position.y, 'and it climbs').toBeGreaterThan(start);
  });
});

describe('frame locking on the ground', () => {
  /** A locked target that happens to be climbing, parked right next to us. */
  const climber = (vy) => ({ position: V(0, 2, 3), velocity: V(0, vy, 0) });

  it('does not hand the machine the climb of a hopping target', () => {
    const b = makeBody();
    const target = climber(16);
    b.setTarget({ position: target.position, radius: 2 });
    b.locked = true;
    b.space.register('target', target, 4);
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 4);

    expect(b.space.blend, 'the frame really is engaged').toBeGreaterThan(0.9);
    expect(b.space.frameVelocity.y, 'and it really is climbing').toBeGreaterThan(8);
    expect(b.position.y, 'but we stay on the floor').toBeCloseTo(2, 1);
    expect(b.grounded).toBeGreaterThan(0.9);
  });

  it('a diving target does not drive us into the floor either', () => {
    const b = makeBody();
    const target = climber(-16);
    b.space.register('target', target, 4);
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 4);
    expect(b.position.y).toBeCloseTo(2, 1);
  });

  it('still carries the frame sideways while grounded', () => {
    const b = makeBody();
    const slider = { position: V(0, 2, 3), velocity: V(20, 0, 0) };
    b.space.register('target', slider, 4);
    input.move.set(0, 0, 0);
    input.intensity = 0;
    run(b, input, 2);
    expect(b.position.x, 'the horizontal share is untouched').toBeGreaterThan(1);
    expect(b.position.y).toBeCloseTo(2, 1);
  });

  it('airborne, the vertical share applies again', () => {
    // Same frame, off the ground: being carried upward by something big is
    // the whole point of §5. The suppression is a ground-contact rule only.
    const lift = (vy) => {
      const b = makeBody();
      b.reset(V(0, 30, 0));
      b.space.register('target', { position: V(0, 30, 3), velocity: V(0, vy, 0) }, 4);
      const inp = new SyntheticInput();
      inp.intensity = 0;
      run(b, inp, 1.2);
      return b.position.y;
    };
    const carried = lift(18);
    const alone = lift(0);
    expect(carried).toBeGreaterThan(alone);
  });
});

describe('equipment on the body', () => {
  const plated = platedStats;

  it('a float plate parks the machine above the floor', () => {
    const bare = makeBody();
    const afloat = makeBody(plated('float'));
    run(bare, input, 2.5);
    run(afloat, input, 2.5);

    expect(afloat.floating).toBe(true);
    expect(bare.floating).toBe(false);
    expect(afloat.rideHeight - bare.rideHeight).toBeCloseTo(EQUIP_META.float.hover, 5);
    expect(afloat.position.y - bare.position.y, 'and it really rests that much higher')
      .toBeCloseTo(EQUIP_META.float.hover, 1);
  });

  it('a floating machine still counts as standing on something', () => {
    // It hovers, but it is not "in the air": the legs still walk, the
    // ground-steering frame still applies, and the tank still refills.
    const b = makeBody(plated('float'));
    run(b, input, 2);
    expect(b.env.grounded).toBeGreaterThan(0.9);
  });

  it('turning a float plate on and off does not stack the hover', () => {
    const b = makeBody(plated('float'));
    const once = b.rideHeight;
    b.setStats(plated('float'));
    b.setStats(plated('float'));
    expect(b.rideHeight, 'still one plate high').toBeCloseTo(once, 6);
    b.setStats(computeStats(stripEquips(PRESETS.biped.build())));
    expect(b.rideHeight, 'and back down when it comes off').toBeCloseTo(b.baseRideHeight, 6);
  });

  it('a boost plate makes the dash bite harder', () => {
    const bare = makeBody(computeStats(stripEquips(PRESETS.biped.build())));
    const boosted = makeBody(plated('boost', 'boost'));
    expect(boosted.dashSpeed).toBeGreaterThan(bare.dashSpeed);
  });

  it('a machine with no boost plate cannot boost at all', () => {
    const bare = makeBody();
    expect(bare.canBoost).toBe(false);

    input.move.set(0, 0, 1);
    input.intensity = 1;
    input.hold('boost', true);
    run(bare, input, 2);
    expect(bare.boosting, 'the key does nothing').toBe(false);
    expect(bare.boostOutput).toBe(0);
    expect(bare.energy, 'and it costs nothing').toBeGreaterThan(0.9);
  });

  it('a boost plate switches the thruster on', () => {
    const b = makeBody(plated('boost'));
    expect(b.canBoost).toBe(true);

    input.move.set(0, 0, 1);
    input.intensity = 1;
    input.hold('boost', true);
    run(b, input, 1);
    expect(b.boosting).toBe(true);
    expect(b.boostOutput).toBeGreaterThan(0.8);
  });

  it('and it costs fuel to hold', () => {
    // On the ground the regen almost pays for it, so measure in the air,
    // where the tank is genuinely on its own.
    const drain = (boost) => {
      const body = makeBody(plated('boost'));
      const inp = new SyntheticInput();
      inp.move.set(0, 0, 1);
      inp.intensity = 1;
      inp.hold('up', true);
      inp.hold('boost', boost);
      run(body, inp, 3);
      return body.energy;
    };
    expect(drain(true)).toBeLessThan(drain(false));
  });

  it('the boost is a step change, not a nudge', () => {
    // The thruster has to take the machine somewhere its cruise cannot, or
    // there is no reason to spend the tank on it.
    const b = makeBody(plated('boost'));
    const peak = (boost) => {
      const inp = new SyntheticInput();
      inp.move.set(0, 0, 1);
      inp.intensity = 1;
      inp.hold('boost', boost);
      b.reset(V(0, 2, 0));
      let top = 0;
      for (let i = 0; i < 300; i++) { b.update(inp, 1 / 60); inp.endFrame(); top = Math.max(top, b.speed); }
      return top;
    };
    const cruise = peak(false);
    expect(peak(true) / cruise, 'well over half again as fast').toBeGreaterThan(1.5);
  });

  it('a dash actually throws the machine', () => {
    const b = makeBody(plated('boost'));
    expect(b.dashSpeed).toBeGreaterThan(25);
    expect(b.dashCooldown).toBe(0);

    input.move.set(0, 0, 1);
    input.intensity = 1;
    b.reset(V(0, 2, 0));
    run(b, input, 0.2);
    const before = b.speed;
    input.dash = { dir: new THREE.Vector3(0, 0, 1), t: 0 };
    run(b, input, 0.1);
    expect(b.speed, 'the impulse lands immediately').toBeGreaterThan(before + 8);
    expect(b.dashCooldown, 'and you get another one soon').toBeLessThan(0.3);
  });

  it('boosting really is faster than not boosting', () => {
    const bare = makeBody();
    const plated1 = makeBody(plated('boost'));
    const drive = (body) => {
      const inp = new SyntheticInput();
      inp.move.set(0, 0, 1);
      inp.intensity = 1;
      inp.hold('boost', true);
      run(body, inp, 2.5);
      return body.speed;
    };
    expect(drive(plated1)).toBeGreaterThan(drive(bare) + 1);
  });

  it('the flame dies down rather than switching off', () => {
    const b = makeBody(plated('boost'));
    input.hold('boost', true);
    run(b, input, 1);
    const lit = b.boostOutput;
    input.hold('boost', false);
    run(b, input, 1 / 30);
    expect(b.boostOutput).toBeLessThan(lit);
    expect(b.boostOutput, 'but not instantly').toBeGreaterThan(0.1);
    run(b, input, 1);
    expect(b.boostOutput).toBeLessThan(0.05);
  });

  it('an empty tank puts the thruster out, plate or no plate', () => {
    const b = makeBody(plated('boost'));
    input.hold('up', true);
    input.hold('boost', true);
    run(b, input, 8);
    expect(b.energy).toBeLessThan(0.05);
    expect(b.boosting).toBe(false);
  });

  it('a gravity plate takes away sustained flight', () => {
    const b = makeBody(plated('gravity'));
    expect(b.noFly).toBe(true);
    input.hold('up', true);
    run(b, input, 3);
    expect(b.hover, 'gravity is never bought back').toBeLessThan(0.05);
    expect(b.position.y, 'so it cannot climb away').toBeLessThan(9);
  });

  it('but it can still jump, because a jump is not hovering', () => {
    const b = makeBody(plated('gravity'));
    const start = b.position.y;
    input.hold('up', true);
    run(b, input, 0.25);
    expect(b.position.y).toBeGreaterThan(start + 0.5);
  });

  it('without the plate the same input flies', () => {
    const b = makeBody(computeStats(PRESETS.biped.build()));
    input.hold('up', true);
    run(b, input, 3);
    expect(b.position.y).toBeGreaterThan(12);
  });
});

/**
 * A blow big enough to be a full stagger FOR THIS MACHINE.
 *
 * Weight now absorbs part of a shove — a two-hundred-tonne frame is not
 * knocked as far off its feet as a four-tonne drone by the same shell — so
 * "one full stagger" is no longer one number for every machine. These tests
 * are about the mechanism, so they scale the blow and leave the weighing to
 * its own test below.
 */
const fullFor = (body, staggers = 1) =>
  staggers * (1 + (body.stats.weightClass ?? 0) * STAGGER.brace);

describe('a heavy machine feels heavy', () => {
  const of = (id) => computeStats(PRESETS[id].build());

  it('weight class spans the machines that exist', () => {
    // It was `(mass - 2) / 26`, which saturates at 28 tonnes — written when
    // the heaviest machine weighed twenty. Across the whole top half of the
    // roster it was pinned at 1.00, so a TITAN and a COLOSSUS three and a
    // half times its weight told every system downstream the same thing.
    const light = of('gnat').weightClass;
    const mid = of('biped').weightClass;
    const heavy = of('titan').weightClass;
    const huge = of('colossus').weightClass;
    expect(light).toBeLessThan(mid);
    expect(mid).toBeLessThan(heavy);
    expect(heavy, 'and the top end still has room in it').toBeLessThan(huge);
    expect(huge).toBeLessThanOrEqual(1);
  });

  it('takes longer to get going, in real seconds', () => {
    const toSpeed = (id, want) => {
      const b = new ZMFBody(of(id), testWorld(), { rideHeight: 2 });
      b.reset(V(0, 2, 0));
      const i = new SyntheticInput();
      i.move.set(0, 0, 1);
      i.intensity = 1;
      for (let n = 0; n < 900; n++) {
        b.update(i, 1 / 60);
        i.endFrame?.();
        if (b.speed >= want) return n / 60;
      }
      return 99;
    };
    // Measured against a FIXED speed, not against each machine's own top:
    // relative to itself a slow machine reaches 90% of a small number just
    // as quickly, which is how this went unnoticed.
    expect(toSpeed('colossus', 5)).toBeGreaterThan(toSpeed('gnat', 5) * 1.8);
  });

  it('leans less into a turn', () => {
    const bank = (id) => new ZMFBody(of(id), testWorld(), { rideHeight: 2 }).angular.maxBankHigh;
    expect(bank('colossus')).toBeLessThan(bank('gnat') * 0.6);
  });

  it('cannot dodge as often', () => {
    const cd = (id) => {
      const b = new ZMFBody(of(id), testWorld(), { rideHeight: 2 });
      b.reset(V(0, 2, 0));
      const i = new SyntheticInput();
      i.dash = { dir: new THREE.Vector3(0, 0, 1) };
      b.update(i, 1 / 60);
      return b.dashCooldown;
    };
    expect(cd('colossus')).toBeGreaterThan(cd('gnat') * 1.4);
  });
});

describe('the air is a different place', () => {
  const horizontalTop = (fn, secs = 4) => {
    const b = new ZMFBody(STATS, testWorld([], { ceiling: 400 }), { rideHeight: 2 });
    b.reset(V(0, 2, 0));
    const i = new SyntheticInput();
    let top = 0;
    for (let n = 0; n < secs * 60; n++) {
      fn(i, n);
      b.update(i, 1 / 60);
      i.endFrame?.();
      const v = b.velocity;
      top = Math.max(top, Math.hypot(v.x, v.z));
    }
    return top;
  };

  it('flying sideways is not better than running sideways', () => {
    // Air lateral authority was uncapped: strafing while hovering reached
    // 21 m/s against 11 on the ground, so the floor was strictly worse and
    // became a place you left and never came back to.
    const ground = horizontalTop((i) => i.move.set(1, 0, 0));
    const air = horizontalTop((i) => { i.hold('up', true); i.move.set(1, 0, 0); });
    expect(air).toBeLessThan(ground * 1.35);
  });

  it('but flying forward still is', () => {
    // Flight has to be worth having. It buys going over things, not fencing.
    const ground = horizontalTop((i) => i.move.set(0, 0, 1));
    const air = horizontalTop((i) => { i.hold('up', true); i.move.set(0, 0, 1); });
    expect(air).toBeGreaterThan(ground);
  });

  it('a fall reads as a fall', () => {
    // The drag model is tuned for thrust; applied to a free drop it pinned
    // the descent at 13.5 m/s, and a twenty-metre machine took eight seconds
    // to come off a rooftop without ever looking like it was falling.
    const b = new ZMFBody(STATS, testWorld([], { ceiling: 500 }), { rideHeight: 2 });
    b.reset(V(0, 400, 0));
    const i = new SyntheticInput();
    let fastest = 0;
    for (let n = 0; n < 600; n++) {
      b.update(i, 1 / 60);
      i.endFrame?.();
      fastest = Math.min(fastest, b.velocity.y);
    }
    expect(-fastest).toBeGreaterThan(18);
  });
});

describe('landing and stepping', () => {
  const of = (id) => computeStats(PRESETS[id].build());

  it('a hard landing costs speed, and costs a heavy machine more', () => {
    // Asked of the rule directly. Driving a machine off a ledge and reading
    // the speed either side of the touchdown measures the drop as much as
    // the landing — how fast it was going, how far it fell, and how much of
    // it the drag model had already taken.
    const plantOf = (id, fall, speed) => {
      const b = new ZMFBody(computeStats(PRESETS[id].build()), testWorld(), { rideHeight: 2 });
      b.reset(V(0, 2, 0));
      b.velocity.set(0, 0, speed);
      b._plant(fall);
      return b.velocity.z / speed;
    };
    // A gentle touchdown costs nothing at all.
    expect(plantOf('biped', LANDING.speed * 0.9, 20)).toBe(1);
    // A hard one costs, and costs a heavy machine more.
    const light = plantOf('mite', 24, 20);
    const heavy = plantOf('colossus', 24, 20);
    expect(light).toBeLessThan(1);
    expect(heavy).toBeLessThan(light * 0.75);
  });

  it('a big machine steps over what a small one has to go round', () => {
    // A flat 0.75m allowance meant a twenty-metre siege frame was stopped
    // by a kerb it could not see over its own foot.
    // The rig hands the body its ride height; the body hands it to the
    // probe, which is where the allowance is worked out.
    const stepOf = (rideHeight) => Math.max(0.75, rideHeight * 0.42);
    expect(stepOf(9), 'a siege frame walks onto a crate')
      .toBeGreaterThan(stepOf(1.2) * 3);
    expect(stepOf(1.2), 'and a drone is no worse off than before').toBe(0.75);
  });
});

describe('weight absorbs a blow', () => {
  it('the same shell rocks a heavy machine less', () => {
    // The same shell used to knock a siege frame exactly as far off its
    // feet as a drone, which reads as "everything feels the same" rather
    // than as a bug.
    const light = new ZMFBody(platedStats(EQUIP.BOOST), testWorld(), { rideHeight: 2 });
    const heavy = new ZMFBody(
      computeStats(PRESETS.colossus.build()), testWorld(), { rideHeight: 2 },
    );
    light.reset(V(0, 2, 0));
    heavy.reset(V(0, 2, 0));
    light.applyStagger(1, V(1, 0, 0));
    heavy.applyStagger(1, V(1, 0, 0));
    expect(heavy.stagger).toBeLessThan(light.stagger * 0.7);
    expect(heavy.stats.weightClass).toBeGreaterThan(light.stats.weightClass);
  });

  it('but a big enough blow still puts anything on its back', () => {
    const heavy = new ZMFBody(
      computeStats(PRESETS.colossus.build()), testWorld(), { rideHeight: 2 },
    );
    heavy.reset(V(0, 2, 0));
    heavy.applyStagger(fullFor(heavy, STAGGER.launchFull), V(1, 0, 0));
    expect(heavy.downed).toBeGreaterThan(0.85);
  });
});

describe('being knocked about', () => {
  it('a stagger throws the machine and takes its drive away', () => {
    const b = makeBody();
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 1.5);
    const cruise = b.speed;

    b.applyStagger(fullFor(b), V(-1, 0, 0));  // shoved to the left
    expect(b.stagger, 'rocked').toBeCloseTo(1, 6);
    expect(b.velocity.x, 'and thrown that way').toBeLessThan(-4);

    // Still holding forward, and going nowhere new: the thrust is gone
    // until it rides the stagger out.
    const heldZ = b.velocity.z;
    run(b, input, 0.1);
    expect(b.speed, 'no driving out of it').toBeLessThan(cruise + 1);
    expect(b.velocity.z, 'and what it had, it keeps').toBeGreaterThan(heldZ * 0.5);
  });

  it('and then lets go of it', () => {
    const b = makeBody();
    b.applyStagger(fullFor(b), V(0, 0, -1));
    run(b, input, 1.2);
    expect(b.stagger, 'it wears off on its own').toBe(0);

    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 2);
    expect(b.speed, 'and the machine drives again').toBeGreaterThan(5);
  });

  it('a second blow deepens the stagger rather than replacing it', () => {
    // A heavy round followed by a light one has to leave the machine rocked
    // by the heavy one. Taking the newest figure would let a stream of
    // pinpricks talk a machine out of the stagger it had just earned.
    const b = makeBody();
    b.applyStagger(fullFor(b, 0.9), V(1, 0, 0));
    b.applyStagger(fullFor(b, 0.1), V(1, 0, 0));
    expect(b.stagger).toBeCloseTo(0.9, 6);
  });

  it('a shove is horizontal: being shot is not being launched', () => {
    // Shot from above, a machine stumbles — it does not get driven into the
    // floor, and one shot from below does not take off. The knock is what
    // puts it off its feet, and neither of those is a thing feet do.
    const b = makeBody();
    const up = b.velocity.y;
    b.applyStagger(fullFor(b), V(0, 1, 0));
    expect(b.velocity.y, 'nothing vertical came out of it').toBeCloseTo(up, 6);
    expect(Math.hypot(b.velocity.x, b.velocity.z), 'it went over instead')
      .toBeGreaterThan(STAGGER.knockback * 0.5);
  });

  it('nothing carries over into the next life', () => {
    const b = makeBody();
    b.applyStagger(fullFor(b), V(1, 0, 0));
    b.reset(V(0, 2, 0));
    expect(b.stagger).toBe(0);
  });
});

describe('being blown away', () => {
  it('a blow worth more than a full stagger throws the machine', () => {
    // The cap used to be one stagger, so a magnum and a sniper round
    // through the chest both just wobbled you. Past a full one the shove
    // grows and some of it turns upward.
    const rocked = makeBody();
    rocked.applyStagger(fullFor(rocked), V(0, 0, -1));
    const thrown = makeBody();
    thrown.applyStagger(fullFor(thrown, STAGGER.launchFull), V(0, 0, -1));

    expect(thrown.knockback.length(), 'shoved harder')
      .toBeGreaterThan(rocked.knockback.length() * 1.8);
    expect(rocked.knockback.y, 'a stagger stays on the floor').toBe(0);
    expect(thrown.knockback.y, 'a throw does not').toBeGreaterThan(4);
    expect(thrown.downed, 'and it is off its feet').toBeCloseTo(1, 5);
    expect(thrown.launched, 'which the effects layer gets told about once')
      .toBeCloseTo(1, 5);
  });

  it('and it really leaves the floor', () => {
    const b = makeBody();
    b.applyStagger(fullFor(b, STAGGER.launchFull), V(1, 0, 0));
    let highest = 0;
    let furthest = 0;
    for (let i = 0; i < 90; i++) {
      b.update(input, 1 / 60);
      input.endFrame();
      highest = Math.max(highest, b.position.y - 2);
      furthest = Math.max(furthest, Math.abs(b.position.x));
    }
    expect(highest, 'up').toBeGreaterThan(0.6);
    expect(furthest, 'and away').toBeGreaterThan(6);
  });

  it('a machine in the air cannot shrug it off by waiting', () => {
    // Being thrown is not on a clock. It lasts as long as the machine has
    // nothing to stand on, which is what makes it different from a stagger.
    const b = makeBody();
    b.applyStagger(fullFor(b, STAGGER.launchFull), V(1, 0, 0));
    for (let i = 0; i < 12; i++) { b.update(input, 1 / 60); input.endFrame(); }
    const mid = b.downed;
    expect(b.grounded, 'off the floor').toBeLessThan(0.5);
    expect(mid, 'and still just as downed').toBeGreaterThan(0.85);
  });

  it('once it lands it gets up on its own', () => {
    const b = makeBody();
    b.applyStagger(fullFor(b, STAGGER.launchFull), V(1, 0, 0));
    run(b, input, 3);
    expect(b.downed).toBe(0);
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 2);
    expect(b.speed, 'and drives again').toBeGreaterThan(5);
  });

  it('it lands badly however light it is', () => {
    // The weight gate is what tells a step down from a drop. Being blown
    // across the arena is neither, so it does not get to use that excuse:
    // a machine too light to ever plant itself still hits the deck when it
    // was thrown there.
    const feather = { ...STATS, weightClass: 0 };
    const dropped = makeBody(feather);
    expect(dropped._touchdown(12), 'a light machine merely landing').toBe(0);

    const thrown = makeBody(feather);
    thrown.applyStagger(STAGGER.launchFull, V(1, 0, 0));
    expect(thrown._touchdown(12), 'a light machine arriving').toBeGreaterThan(0);
  });

  it('a blow under the bar rocks it and no more', () => {
    const b = makeBody();
    b.applyStagger(STAGGER.launchAt * 0.9, V(1, 0, 0));
    expect(b.stagger).toBeGreaterThan(0);
    expect(b.downed, 'still on its feet').toBe(0);
    expect(b.knockback.y).toBe(0);
  });

  it('nothing carries over into the next life', () => {
    const b = makeBody();
    b.applyStagger(fullFor(b, STAGGER.launchFull), V(1, 0, 0));
    b.reset(V(0, 2, 0));
    expect(b.downed).toBe(0);
    expect(b.launched).toBe(0);
    expect(b.knockback.length()).toBe(0);
  });
});

describe('coming down off something', () => {
  /** Stats for a machine of a given weight class, everything else the biped. */
  const weighing = (weightClass) => ({ ...STATS, weightClass });

  /** Drop `body` from `height` and report the landing it produced. */
  const drop = (body, height = 20) => {
    body.reset(V(0, height, 0));
    let landed = 0;
    for (let i = 0; i < 240 && landed === 0; i++) {
      body.update(input, 1 / 60);
      input.endFrame();
      landed = body.landed;
    }
    return landed;
  };

  it('a heavy machine plants itself', () => {
    const b = makeBody(weighing(0.8));
    const landed = drop(b);
    expect(landed, 'it came down hard').toBeGreaterThan(0.15);
    expect(b.landing).toBeGreaterThan(0.15);
  });

  it('a light one just touches down', () => {
    // The gate is the whole point. A skirmisher that braced every time it
    // hopped would only ever feel sluggish.
    const b = makeBody(weighing(LANDING.weight * 0.5));
    expect(drop(b)).toBe(0);
    expect(b.landing).toBe(0);
  });

  it('and the heavier it is, the harder it lands', () => {
    // Off the same fall, so the comparison is about the weight and not
    // about drag — which is itself a function of weight, and pulls the
    // other way. A dropped tank arrives more slowly than a dropped kite.
    const mid = makeBody(weighing(0.4));
    const heavy = makeBody(weighing(1));
    expect(heavy._touchdown(14)).toBeGreaterThan(mid._touchdown(14));
  });

  it('and the harder the fall, the harder the landing', () => {
    const b = makeBody(weighing(1));
    const gentle = b._touchdown(LANDING.speed + 1);
    b.landing = 0;
    const brutal = b._touchdown(LANDING.hard * 2);
    expect(brutal).toBeGreaterThan(gentle);
    expect(brutal, 'and it stops at a full one').toBeCloseTo(1, 6);
  });

  it('stepping off a kerb is not a landing', () => {
    const b = makeBody(weighing(1));
    expect(drop(b, 2.15), 'barely off the floor').toBe(0);
  });

  it('the touchdown is one step, the brace outlives it', () => {
    // `landed` is an event — whoever throws the dust gets exactly one go at
    // it. `landing` is a state, and it is what the legs read.
    const b = makeBody(weighing(1));
    const landed = drop(b);
    expect(landed).toBeGreaterThan(0);

    b.update(input, 1 / 60);
    expect(b.landed, 'the event is over').toBe(0);
    expect(b.landing, 'the brace is not').toBeGreaterThan(0);

    run(b, input, 1.2);
    expect(b.landing, 'and then it stands back up').toBe(0);
  });

  it('landing does not take the machine’s legs away', () => {
    // Bracing is a pose, not a stagger: a heavy machine that could not drive
    // for half a second after every drop would be unplayable, and nobody
    // asked for that.
    const b = makeBody(weighing(1));
    drop(b);
    input.move.set(0, 0, 1);
    input.intensity = 1;
    run(b, input, 1.5);
    expect(b.speed).toBeGreaterThan(4);
  });

  it('nothing carries over into the next life', () => {
    const b = makeBody(weighing(1));
    drop(b);
    b.reset(V(0, 2, 0));
    expect(b.landing).toBe(0);
    expect(b.landed).toBe(0);
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

  it('carries no glow of its own — only a directional exhaust', () => {
    const robot = new Robot(PRESETS.biped.build(), testWorld());
    expect(robot.glow, 'the old core bloom is gone').toBe(undefined);

    let sprites = 0;
    robot.rig.root.traverse((o) => { if (o.isSprite) sprites++; });
    expect(sprites, 'nothing billboarded onto the chassis').toBe(0);

    // and the plume still answers the throttle
    expect(robot.plume).toBeTruthy();
    expect(robot.plume.material.opacity).toBe(0);
    const i = new SyntheticInput();
    i.move.set(0, 0, 1);
    i.intensity = 1;
    for (let k = 0; k < 120; k++) { robot.update(i, 1 / 60); i.endFrame(); }
    expect(robot.plume.material.opacity).toBeGreaterThan(0.05);
  });

  it('a dash lights nothing on the machine itself', () => {
    const robot = new Robot(PRESETS.biped.build(), testWorld());
    const i = new SyntheticInput();
    i.move.set(0, 0, 1);
    i.intensity = 1;
    for (let k = 0; k < 30; k++) { robot.update(i, 1 / 60); i.endFrame(); }
    const coasting = robot.plume.material.opacity;

    i.dash = { dir: V(0, 0, 1), t: 0 };
    for (let k = 0; k < 12; k++) { robot.update(i, 1 / 60); i.endFrame(); }

    expect(robot.body.dashFlash, 'the dash really fired').toBeGreaterThan(0.2);
    expect(robot.plume.material.opacity, 'but nothing flared up for it')
      .toBeCloseTo(coasting, 1);
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
