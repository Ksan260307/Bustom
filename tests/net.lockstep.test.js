import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Robot } from '../src/game/Robot.js';
import { Projectiles } from '../src/game/Weapons.js';

import { PRESETS } from '../src/core/Assembly.js';
import { Random } from '../src/core/Random.js';
import { EQUIP, ACTION_BITS, LOOK_SCALE } from '../src/core/constants.js';
import { testWorld, stripEquips } from './helpers/dom.js';
import { InputFrame, FrameInput } from '../src/net/InputFrame.js';
import { Lockstep } from '../src/net/Lockstep.js';
import { Hasher, hashFight, hashRobot, hex } from '../src/net/StateHash.js';

const bit = (a) => 1 << ACTION_BITS.indexOf(a);

/**
 * A fight, run from nothing but a seed and a list of presses.
 *
 * This is the whole premise of lockstep in one function: if two calls with
 * the same arguments do not return the same number, no amount of correct
 * networking will make two machines agree, and the feature is impossible.
 */
function runFight(seed, script, steps = 300) {
  const random = new Random(seed);
  const world = testWorld();
  const build = () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.GATLING, { size: 0.7 });
    a.addEquipOnFace(a.core.id, 2, EQUIP.MISSILE, { size: 0.7 });
    return a;
  };
  const robots = [
    new Robot(build(), world, { isPlayer: true, random }),
    new Robot(build(), world, { name: 'B', random }),
  ];
  robots[0].body.reset(new THREE.Vector3(-14, 6, -14), new THREE.Vector3(1, 0, 1));
  robots[1].body.reset(new THREE.Vector3(14, 6, 14), new THREE.Vector3(-1, 0, -1));
  const projectiles = new Projectiles(new THREE.Scene(), world, { max: 256 });
  const inputs = robots.map(() => new FrameInput());

  for (let t = 0; t < steps; t++) {
    const frames = script(t);
    for (let i = 0; i < robots.length; i++) {
      inputs[i].apply(frames[i], 1 / 60);
      robots[i].update(inputs[i], 1 / 60);
      robots[i].weapons.update({
        firing: inputs[i].isDown('fire'),
        projectiles,
        targets: robots.filter((_, k) => k !== i),
        aimPoint: robots[1 - i].position,
      }, 1 / 60);
    }
    projectiles.update(1 / 60, robots);
  }
  return { hash: hashFight({ robots, projectiles, random }), robots, projectiles };
}

/** A press pattern with enough going on to shake something loose. */
const busy = (t) => {
  const a = new InputFrame(
    bit('forward') | (t % 90 < 45 ? bit('left') : bit('right'))
      | (t % 24 < 6 ? bit('fire') : 0) | (t % 150 === 0 ? bit('up') : 0),
    Math.round(Math.sin(t * 0.11) * 240),
    Math.round(Math.cos(t * 0.07) * 90),
  );
  const b = new InputFrame(
    bit('back') | (t % 70 < 35 ? bit('right') : bit('left'))
      | (t % 31 < 9 ? bit('fire') : 0) | (t % 40 === 0 ? bit('weaponNext') : 0),
    Math.round(Math.cos(t * 0.09) * 200),
    Math.round(Math.sin(t * 0.05) * 60),
  );
  return [a, b];
};

// ============================================================
//  The premise.
// ============================================================

describe('the same seed and the same presses make the same fight', () => {
  it('twice, to the last bit', () => {
    // Not to six decimals. A millimetre of disagreement now is a metre in
    // ten seconds, because the difference feeds back through the physics —
    // which is exactly why the hash is taken off the float bits.
    const a = runFight(4242, busy);
    const b = runFight(4242, busy);
    expect(hex(b.hash), `${hex(a.hash)} against ${hex(b.hash)}`).toBe(hex(a.hash));
    // And something actually happened, or this proves nothing.
    expect(a.robots[0].position.distanceTo(a.robots[1].position)).toBeGreaterThan(1);
    expect(a.projectiles.pool.some((s) => s.life > 0)).toBe(true);
  });

  it('and a different seed does not', () => {
    expect(hex(runFight(4242, busy).hash)).not.toBe(hex(runFight(4243, busy).hash));
  });

  it('and one different press, on one step, does not', () => {
    // The whole safety of the scheme rests on this: a press that could go
    // missing without changing the answer is a fork nobody would notice.
    // One step of thrust — a sixtieth of a second of it — is enough.
    const changed = (t) => {
      const [a, b] = busy(t);
      return [t === 120 ? new InputFrame(a.buttons | bit('up'), a.yaw, a.pitch) : a, b];
    };
    expect(hex(runFight(4242, changed).hash)).not.toBe(hex(runFight(4242, busy).hash));
  });
});

// ============================================================
//  What goes on the wire.
// ============================================================

describe('an input frame survives the trip', () => {
  it('comes back the same through an array and JSON', () => {
    const f = new InputFrame(bit('fire') | bit('forward'), -1234, 567, 8, 5);
    expect(InputFrame.fromArray(f.toArray()).equals(f)).toBe(true);
    expect(InputFrame.fromArray(JSON.parse(JSON.stringify(f.toArray()))).equals(f)).toBe(true);
  });

  it('rounds the look BEFORE anybody acts on it', () => {
    // The trap this exists to avoid: the player at the keyboard turning by
    // the raw mouse delta while everybody else turns by the rounded copy.
    // Then the fight has forked on frame one and the networking below it is
    // irrelevant.
    const live = {
      isDown: () => false,
      cameraLook: { yaw: 0.123456789012345, pitch: -0.98765432109 },
      zoomDelta: 0,
      dash: null,
    };
    const f = InputFrame.capture(live);
    expect(Number.isInteger(f.yaw)).toBe(true);
    const here = new FrameInput().apply(f);
    const there = new FrameInput().apply(InputFrame.fromArray(JSON.parse(JSON.stringify(f.toArray()))));
    expect(there.cameraLook.yaw).toBe(here.cameraLook.yaw);
    expect(here.cameraLook.yaw).not.toBe(live.cameraLook.yaw);
    // And close enough that nobody can feel the rounding.
    expect(Math.abs(here.cameraLook.yaw - live.cameraLook.yaw)).toBeLessThan(1 / LOOK_SCALE);
  });

  it('moves a machine the way a keyboard does', () => {
    const i = new FrameInput().apply(new InputFrame(bit('forward') | bit('right')));
    expect(i.move.z).toBeCloseTo(Math.SQRT1_2, 6);
    expect(i.move.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(i.intensity).toBeCloseTo(1, 6);
  });

  it('fires a tap once, however long the key is held', () => {
    const i = new FrameInput();
    const held = new InputFrame(bit('weaponNext'));
    i.apply(held);
    expect(i.consume('weaponNext')).toBe(true);
    expect(i.consume('weaponNext'), 'not twice on the same step').toBe(false);
    i.apply(held);
    expect(i.consume('weaponNext'), 'not again while it is still down').toBe(false);
    i.apply(InputFrame.idle());
    i.apply(held);
    expect(i.consume('weaponNext'), 'and again once it is pressed again').toBe(true);
  });
});

// ============================================================
//  Taking the step together.
// ============================================================

describe('nobody takes a step alone', () => {
  const two = () => new Lockstep({ players: ['a', 'b'], localId: 'a', delay: 3 });

  it('runs the opening steps without waiting for anybody', () => {
    // Those steps were scheduled before the fight started. Waiting for
    // input nobody could have sent would hang every game on its first frame.
    const net = two();
    const ran = [];
    net.advance((frames, t) => ran.push(t));
    expect(ran).toEqual([0, 1, 2]);
  });

  /** Drive it the way a session does: press, then run what can be run. */
  const pump = (net, steps = 1, onTick = () => {}) => {
    let ran = 0;
    for (let i = 0; i < steps; i++) {
      net.submitLocal(InputFrame.idle());
      ran += net.advance(onTick);
    }
    return ran;
  };

  it('and stops dead at the first step somebody is missing', () => {
    const net = two();
    // Three presses put our own frames on steps 3, 4 and 5 — the delay
    // buying exactly that much time for theirs to arrive. Theirs never do.
    pump(net, 3);
    expect(net.tick, 'only the opening steps ran').toBe(3);
    const ran = pump(net, 1);
    expect(ran, 'a step is not half-run').toBe(0);
    expect(net.waitingOn()).toEqual(['b']);
    expect(net.stalled).toBeGreaterThan(0);
  });

  it('and goes again the moment the late one lands', () => {
    const net = two();
    pump(net, 4);
    expect(net.tick).toBe(3);
    net.receive('b', 3, InputFrame.idle().toArray());
    expect(net.advance(() => {})).toBe(1);
    expect(net.tick).toBe(4);
  });

  it('schedules a press into the future, not for now', () => {
    // The delay is the whole trade: a press has that many steps to cross
    // the network before anybody is waiting on it.
    //
    // Which is a fact about a press made on a step, so it is measured that
    // way: press, run what can be run, press again. Running first and then
    // pressing once measures a machine that skipped three steps of input,
    // and would answer that the delay is zero.
    const net = two();
    const first = net.submitLocal(new InputFrame(bit('fire')));
    expect(first.tick, 'three steps of road').toBe(net.tick + 3);
    net.advance(() => {});
    expect(net.tick).toBe(3);
    const next = net.submitLocal(new InputFrame(bit('fire')));
    expect(next.tick, 'and the next one is the next step along').toBe(4);
    // The steps already run were decided before any of this was pressed.
    expect(net.framesFor(2)[0].buttons).toBe(0);
  });

  it('will not let one machine sprint ahead of the others', () => {
    // After a hiccup there can be a backlog. Running all of it in one frame
    // drops the frame it was catching up FOR, so the catching up is spread.
    const net = two();
    for (let t = 0; t < 40; t++) {
      net.receive('a', t, InputFrame.idle().toArray());
      net.receive('b', t, InputFrame.idle().toArray());
    }
    expect(net.advance(() => {}, 8), 'catching up has a ceiling').toBe(8);
    expect(net.advance(() => {}, 8), 'and carries on next frame').toBe(8);
  });

  it('ignores a frame for a step already played', () => {
    const net = two();
    net.advance(() => {});
    expect(net.receive('b', 0, InputFrame.idle().toArray())).toBe(false);
  });

  it('will not let a frame be taken back', () => {
    const net = two();
    net.receive('b', 5, new InputFrame(bit('fire')).toArray());
    net.receive('b', 5, InputFrame.idle().toArray());
    expect(net.frames.get(5).get('b').buttons, 'the first one stands')
      .toBe(bit('fire'));
  });

  it('carries on without somebody who has gone', () => {
    // Standing still from an agreed step, rather than vanishing: every
    // client can apply that rule to the same tick without being told which.
    const net = two();
    pump(net, 4);
    expect(net.ready(), 'held up by the one who left').toBe(false);
    net.drop('b');
    expect(net.ready()).toBe(true);
    // Everything we had already scheduled for ourselves can run at once,
    // because the only thing that was holding it was them.
    expect(net.advance(() => {})).toBeGreaterThan(0);
    // And they are still pressing nothing, rather than gone.
    expect(net.framesFor(net.tick - 1).length).toBe(2);
  });
});

// ============================================================
//  Noticing a fork.
// ============================================================

describe('a forked fight says so', () => {
  const net = () => new Lockstep({ players: ['a', 'b'], localId: 'a', checkEvery: 30 });

  it('says nothing while everybody agrees', () => {
    const n = net();
    expect(n.reportHash('a', 30, 0xabcd1234)).toBe(null);
    expect(n.reportHash('b', 30, 0xabcd1234)).toBe(null);
    expect(n.desync).toBe(null);
  });

  it('names the step and the two who disagree', () => {
    const n = net();
    n.reportHash('a', 30, 0xabcd1234);
    const bad = n.reportHash('b', 30, 0xabcd1235);
    expect(bad.tick).toBe(30);
    expect(bad.between).toEqual(['a', 'b']);
    expect(bad.hashes).toEqual(['abcd1234', 'abcd1235']);
  });

  it('reports the FIRST fork and then shuts up', () => {
    // After it, the two are different fights and every later step differs
    // too. Repeating that says nothing new.
    const n = net();
    n.reportHash('a', 30, 1);
    n.reportHash('b', 30, 2);
    n.reportHash('a', 60, 3);
    expect(n.reportHash('b', 60, 4).tick).toBe(30);
  });

  it('stops the fight rather than playing on past a fork', () => {
    const n = net();
    n.reportHash('a', 0, 1);
    n.reportHash('b', 0, 2);
    expect(n.advance(() => {}), 'a fight that has forked does not continue')
      .toBe(0);
  });

  it('catches a fork the size of one bit', () => {
    // Which is the size real ones start at.
    const a = new Hasher().num(1.0000000000000002).value;
    const b = new Hasher().num(1).value;
    expect(a).not.toBe(b);
  });

  it('does not cry wolf over a negative zero', () => {
    // -0 and 0 drive the simulation identically. Reporting them as a fork
    // would stop a fight that was perfectly fine.
    expect(new Hasher().num(-0).value).toBe(new Hasher().num(0).value);
  });

  it('hashes what feeds back, and ignores what only shows', () => {
    const world = testWorld();
    const r = new Robot(PRESETS.biped.build(), world, { isPlayer: true });
    const before = hashRobot(r).value;
    // A pose is an output of the body. A client a frame behind on its
    // animation is not a client running a different fight.
    r.animator.gaitPhase = 0.37;
    r.animator.slide = 0.5;
    expect(hashRobot(r).value).toBe(before);
    // Where it is, is the fight.
    r.body.position.x += 1e-9;
    expect(hashRobot(r).value).not.toBe(before);
  });
});
