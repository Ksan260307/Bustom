import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Robot, SimpleAI } from '../src/game/Robot.js';
import { Projectiles } from '../src/game/Weapons.js';
import { PRESETS, _resetIds } from '../src/core/Assembly.js';
import { Random } from '../src/core/Random.js';
import { EQUIP } from '../src/core/constants.js';
import { testWorld, stripEquips } from './helpers/dom.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const world = testWorld();

/** An opponent carrying one named weapon, standing at `z`. */
function opponent(type = EQUIP.GATLING, { z = 20, opts = {} } = {}) {
  const a = stripEquips(PRESETS.biped.build());
  a.addEquipOnFace(a.core.id, 4, type, { size: 0.7 });
  const bot = new Robot(a, world, { random: new Random(5) });
  bot.body.reset(V(0, bot.body.rideHeight, z));
  bot.syncTransform();
  return { bot, ai: new SimpleAI(bot, { range: 20, ...opts }) };
}

/** The machine it is shooting at. */
function player(z = 0) {
  const p = new Robot(stripEquips(PRESETS.biped.build()), world, { isPlayer: true });
  p.body.reset(V(0, p.body.rideHeight, z));
  p.syncTransform();
  return p;
}

const pool = (max = 32) => new Projectiles(new THREE.Scene(), world, { max });

/**
 * Run the machine for `seconds` and report how many rounds it got off.
 *
 * It is left to turn itself round rather than being pointed by hand. Its
 * own steering is part of what is being tested — a machine that cannot come
 * about is a machine that never fires, however willing its trigger is — and
 * forcing the attitude every frame fights the very thing that would.
 */
function fireFor(ai, target, p, seconds, ctx = {}) {
  const spent = () => ai.robot.weapons.slots.reduce((n, s) => n + (s.meta.ammo - s.ammo), 0);
  const before = spent();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    ai.update(target.position, 1 / 60, {
      target, projectiles: p, targets: [target, ai.robot], ...ctx,
    });
    p.update(1 / 60, []);              // clear the pool so it never fills up
  }
  return spent() - before;
}

describe('an opponent shoots back', () => {
  beforeEach(() => _resetIds(0));

  it('fires when it is facing you and you are in reach', () => {
    // The whole fight used to be one-way. Opponents carried three, four,
    // five weapon plates and never pulled a trigger, because nothing drove
    // their weapon system at all — so the lives counter could not go down
    // and none of the dodging was ever asked a question.
    const { ai } = opponent(EQUIP.GATLING, { z: 18 });
    expect(fireFor(ai, player(), pool(), 5), 'rounds spent').toBeGreaterThan(0);
  });

  it('and not at something behind it', () => {
    // Asked of the rule directly: a machine left to itself turns to face
    // you within a second, which is the answer to a different question.
    const { ai } = opponent(EQUIP.GATLING, { z: 18 });
    const p = pool();
    const target = player();
    ai.firing = true;
    ai.burstTimer = 99;
    const before = ai.robot.weapons.slots[0].ammo;
    for (let i = 0; i < 120; i++) {
      // Over its shoulder: the direction to the target points backwards.
      ai._shoot({ target, projectiles: p, targets: [target] }, 18, V(0, 0, -1), 1 / 60);
    }
    expect(ai.robot.weapons.slots[0].ammo, 'nothing over its shoulder').toBe(before);
  });

  it('nor at something further than the gun can throw', () => {
    // A magnum stops existing after about thirty-five metres, so firing one
    // at ninety is a machine emptying its magazine into the scenery.
    const { ai } = opponent(EQUIP.MAGNUM, { z: 90, opts: { range: 90 } });
    expect(fireFor(ai, player(), pool(), 5)).toBe(0);
  });

  it('never at its own side', () => {
    const { ai } = opponent(EQUIP.GATLING, { z: 14 });
    const friend = new Robot(stripEquips(PRESETS.biped.build()), world);
    friend.body.reset(V(0, friend.body.rideHeight, 7));
    const p = pool();
    const target = player();
    for (let i = 0; i < 60 * 8; i++) {
      ai.update(target.position, 1 / 60, {
        target, projectiles: p, targets: [target, friend, ai.robot],
      });
      p.update(1 / 60, [target, friend, ai.robot]);
    }
    expect(friend.hp, 'stood right in the line of fire, untouched').toBe(friend.maxHp);
    expect(target.hp, 'and the one it was aiming at did not').toBeLessThan(target.maxHp);
  });

  it('a machine with nothing fitted simply does not fire', () => {
    const a = stripEquips(PRESETS.biped.build());
    const bot = new Robot(a, world);
    bot.body.reset(V(0, bot.body.rideHeight, 15));
    const ai = new SimpleAI(bot, { range: 15 });
    const p = pool();
    expect(() => fireFor(ai, player(), p, 2)).not.toThrow();
    expect(p.liveCount).toBe(0);
  });
});

describe('fire discipline', () => {
  beforeEach(() => _resetIds(0));

  it('it fires in bursts, and stops between them', () => {
    // Three machines holding their triggers down put out more than anyone
    // can answer, and worse, they put it out CONSTANTLY — there is no
    // moment in it to move. The gap is where the game is.
    const { ai } = opponent(EQUIP.GATLING, { z: 16 });
    const p = pool(64);
    const target = player();
    const seen = new Set();
    for (let i = 0; i < 60 * 8; i++) {
      ai.update(target.position, 1 / 60, { target, projectiles: p, targets: [target] });
      p.update(1 / 60, []);
      seen.add(ai.firing);
    }
    expect(seen.has(true), 'it shoots').toBe(true);
    expect(seen.has(false), 'and it stops').toBe(true);
  });

  it('a gentler opponent leaves longer gaps, and no weaker rounds', () => {
    // What an early wave gives you is TIME. Softening its damage instead
    // would teach the wrong lesson about what a round costs, and making it
    // miss on purpose teaches nothing at all.
    // Measured as TIME on the trigger, not rounds spent: a machine that
    // rests longer also reloads in the gaps, so it can put MORE rounds
    // downrange over a minute while being far easier to be near.
    const onTrigger = (aggression) => {
      _resetIds(0);
      const { ai } = opponent(EQUIP.GATLING, { z: 16, opts: { aggression } });
      const p = pool(64);
      const target = player();
      let on = 0;
      const steps = 60 * 20;
      for (let i = 0; i < steps; i++) {
        ai.update(target.position, 1 / 60, { target, projectiles: p, targets: [target] });
        p.update(1 / 60, []);
        if (ai.firing) on++;
      }
      return on / steps;
    };
    const gentle = onTrigger(0.15);
    const relentless = onTrigger(1);
    expect(relentless, 'presses harder').toBeGreaterThan(gentle * 1.3);
    expect(gentle, 'but still shoots at you').toBeGreaterThan(0.05);
  });
});

describe('an opponent gets out of the way', () => {
  beforeEach(() => _resetIds(0));

  it('dashes when a round is going to hit it', () => {
    // The player's answer to being shot at is to dash sideways. An opponent
    // that never does it has not been taught the game it is in.
    const { ai, bot } = opponent(EQUIP.GATLING, { z: 20 });
    const shooter = player();
    const p = pool();
    // One round, straight down the middle at it.
    p.spawn({
      position: V(0, bot.position.y, 0), direction: V(0, 0, 1),
      speed: 60, life: 3, damage: 5, radius: 0.2, owner: shooter,
    });
    ai.robot.body.dashCooldown = 0;
    ai.update(shooter.position, 1 / 60, { target: shooter, projectiles: p, targets: [] });
    // The body CONSUMES the dash on the same step it is asked for, so the
    // request itself is gone by now — what is left is the machine moving.
    expect(ai.robot.body.dashFlash, 'it saw it coming and went').toBeGreaterThan(0);
  });

  it('and ignores one that is going nowhere near', () => {
    const { ai, bot } = opponent(EQUIP.GATLING, { z: 20 });
    const shooter = player();
    const p = pool();
    p.spawn({
      position: V(40, bot.position.y, 0), direction: V(0, 0, 1),
      speed: 60, life: 3, damage: 5, radius: 0.2, owner: shooter,
    });
    ai.robot.body.dashFlash = 0;
    ai.update(shooter.position, 1 / 60, { target: shooter, projectiles: p, targets: [] });
    expect(ai.robot.body.dashFlash).toBe(0);
  });

  it('and never dodges its own side’s fire', () => {
    const { ai, bot } = opponent(EQUIP.GATLING, { z: 20 });
    const friend = new Robot(stripEquips(PRESETS.biped.build()), world);
    const p = pool();
    p.spawn({
      position: V(0, bot.position.y, 0), direction: V(0, 0, 1),
      speed: 60, life: 3, damage: 5, radius: 0.2, owner: friend,
    });
    ai.robot.body.dashFlash = 0;
    ai.update(V(0, 0, 0), 1 / 60, { target: player(), projectiles: p, targets: [] });
    expect(ai.robot.body.dashFlash).toBe(0);
  });

  it('backs off once it is hurt', () => {
    // Something a player can watch for and use. A machine that trades to
    // the last hit point is a machine with one behaviour.
    const { ai, bot } = opponent(EQUIP.GATLING, { z: 20 });
    const target = player();
    const drive = () => {
      ai.update(target.position, 1 / 60, { target, projectiles: null, targets: [] });
      return ai.input.move.z;
    };
    bot.body.reset(V(0, bot.body.rideHeight, 20));   // sitting at its liking
    const whole = drive();
    bot.hp = bot.maxHp * 0.1;
    const hurt = drive();
    expect(hurt, 'wants to be further away').toBeLessThan(whole);
  });
});
