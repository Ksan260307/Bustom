import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Robot, SyntheticInput } from '../src/game/Robot.js';
import { PRESETS, computeStats, _resetIds } from '../src/core/Assembly.js';
import { EQUIP, EQUIP_META } from '../src/core/constants.js';
import { testWorld, stripEquips } from './helpers/dom.js';

// ============================================================
//  The energy tank.
//
//  Energy is what pays for flight, for the boost and for every dash, and it
//  was one fixed size on every machine — so how long a machine could stay
//  off the ground was not something anybody could build for.
//
//  A tank buys ENDURANCE rather than free fuel: every spend is a smaller
//  share of a bigger tank, and so is every second of recharging.
// ============================================================

const world = testWorld();

/** A machine with `n` tanks fitted, and a thruster so it can spend anything. */
function machine(n = 0) {
  const a = stripEquips(PRESETS.biped.build());
  a.addEquipOnFace(a.core.id, 2, EQUIP.BOOST, { size: 0.7 });
  for (let i = 0; i < n; i++) a.addEquipOnFace(a.core.id, i === 0 ? 4 : 5, EQUIP.TANK, { size: 0.7 });
  const bot = new Robot(a, world);
  bot.body.reset(new THREE.Vector3(0, bot.body.rideHeight, 0));
  return bot;
}

/** Hold a key for `seconds` and report what is left in the tank. */
function spend(bot, action, seconds) {
  const input = new SyntheticInput();
  input.hold(action, true);
  for (let i = 0; i < Math.round(seconds * 60); i++) bot.body.update(input, 1 / 60);
  return bot.body.energy;
}

describe('the energy tank', () => {
  beforeEach(() => _resetIds(0));

  it('is a real part with a real weight', () => {
    const meta = EQUIP_META[EQUIP.TANK];
    expect(meta.category).toBe('system');
    expect(meta.energyBonus).toBeGreaterThan(0);
    // Heavier than the thruster it feeds, and heavier than a barrier plate:
    // endurance is not supposed to be free.
    expect(meta.mass).toBeGreaterThan(EQUIP_META[EQUIP.BOOST].mass * 3);
    expect(meta.mass).toBeGreaterThan(EQUIP_META[EQUIP.FLOAT].mass);
  });

  it('shows up in the machine it is bolted to', () => {
    const bare = computeStats(stripEquips(PRESETS.biped.build()));
    const one = computeStats(machine(1).assembly);
    expect(one.tankPlates).toBe(1);
    expect(one.energyCapacity).toBeGreaterThan(1);
    expect(one.mass, 'and it is felt in the weight').toBeGreaterThan(bare.mass);
  });

  it('and they stack', () => {
    expect(computeStats(machine(2).assembly).energyCapacity)
      .toBeGreaterThan(computeStats(machine(1).assembly).energyCapacity);
  });

  it('a machine with one stays up longer', () => {
    const plain = machine(0);
    const tanked = machine(1);
    expect(tanked.body.energyCapacity).toBeGreaterThan(plain.body.energyCapacity);
    // Four seconds of holding it off the ground. Boosting while STANDING on
    // the floor costs nothing net — the ground recharges faster than the
    // thruster drinks — so the tank only means anything in the air, which
    // is where it is supposed to mean something.
    const left = spend(plain, 'up', 4);
    const leftWithTank = spend(tanked, 'up', 4);
    expect(left, 'it costs something either way').toBeLessThan(0.9);
    expect(leftWithTank, 'but less of a bigger tank').toBeGreaterThan(left);
  });

  it('and takes longer to fill back up', () => {
    // The other half of the trade, and the reason it is a choice rather
    // than a bonus: a machine that wants to be topped up between short hops
    // is worse off carrying one.
    const refill = (n) => {
      const bot = machine(n);
      bot.body.energy = 0.1;
      const input = new SyntheticInput();
      for (let i = 0; i < 30; i++) bot.body.update(input, 1 / 60);
      return bot.body.energy - 0.1;
    };
    expect(refill(1), 'a bigger tank comes back slower').toBeLessThan(refill(0));
    expect(refill(1), 'but it does come back').toBeGreaterThan(0);
  });

  it('a dash is free, tank or no tank', () => {
    // It used to cost a bite of the tank, which meant a machine that had
    // spent its energy could neither boost nor dodge. The cooldown is the
    // limit; a bigger tank buys endurance, not more dodges.
    const take = (n) => {
      const bot = machine(n);
      bot.body.energy = 1;
      bot.body.dashCooldown = 0;
      const input = new SyntheticInput();
      input.dash = { dir: new THREE.Vector3(1, 0, 0) };
      bot.body.update(input, 1 / 60);
      return 1 - bot.body.energy;
    };
    expect(take(0)).toBe(0);
    expect(take(1)).toBe(0);
  });

  it('does not stop a machine flying, or make it fly for free', () => {
    const bot = machine(2);
    expect(bot.body.noFly).toBe(false);
    // Long enough that even two tanks run out: endurance, not perpetual motion.
    expect(spend(bot, 'up', 12)).toBeLessThan(0.5);
  });
});
