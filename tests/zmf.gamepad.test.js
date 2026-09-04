import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  GamepadReader, stick, PAD_BUTTON, STICK_DEADZONE, LOOK_RATE, TRIGGER_POINT,
} from '../src/zmf/Gamepad.js';

/**
 * The word "gamepad" did not appear in this codebase. What is worth testing
 * is not that a button press registers — it is the two things that are
 * easy to get wrong and invisible when you do:
 *
 *   1. A RADIAL deadzone, not a per-axis one, or the stick is dead in
 *      exactly the diagonal directions people push it.
 *   2. A stick is a RATE, not a delta. The mouse path divides by the frame
 *      time; doing that to a stick makes aiming twice as fast at 30fps.
 */

/** A pad, in the shape `navigator.getGamepads()` returns. */
function fakePad({ axes = [0, 0, 0, 0], buttons = {}, connected = true, index = 0, at = 1 } = {}) {
  const list = [];
  for (let i = 0; i < 16; i++) {
    const v = buttons[i] ?? 0;
    list.push({ pressed: v >= 0.5, touched: v > 0, value: v });
  }
  return {
    index, connected, timestamp: at, mapping: 'standard', axes, buttons: list,
  };
}

function withPads(pads) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => pads },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => withPads([]));

describe('a stick is not a mouse', () => {
  it('ignores a push inside the deadzone', () => {
    expect(stick(0.1, 0).mag).toBe(0);
    expect(stick(0, -0.15).mag).toBe(0);
  });

  it('and takes a DIAGONAL push that no single axis would pass', () => {
    // 0.15 on each axis is 0.212 of real push, which is past the deadzone.
    // A per-axis test throws this away, and the stick feels dead in the
    // four directions people actually use.
    const d = 0.15;
    expect(d, 'each axis alone is inside').toBeLessThan(STICK_DEADZONE);
    expect(Math.hypot(d, d), 'together they are outside').toBeGreaterThan(STICK_DEADZONE);
    expect(stick(d, d).mag).toBeGreaterThan(0);
  });

  it('still reaches full deflection at the rim', () => {
    expect(stick(1, 0).mag).toBeCloseTo(1, 5);
    expect(stick(0, -1).mag).toBeCloseTo(1, 5);
  });

  it('starts from zero at the edge of the deadzone, with no jump', () => {
    const just = stick(STICK_DEADZONE + 1e-6, 0);
    expect(just.mag).toBeLessThan(0.01);
  });

  it('keeps the direction it was pushed', () => {
    const d = stick(0.6, -0.6);
    expect(d.x / -d.y).toBeCloseTo(1, 5);
  });
});

describe('reading a controller', () => {
  it('says nothing when there is no pad', () => {
    const g = new GamepadReader();
    expect(g.poll()).toBe(false);
    expect(g.active).toBe(false);
    expect(g.move).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('and nothing when the pad is there but disconnected', () => {
    withPads([fakePad({ connected: false })]);
    expect(new GamepadReader().poll()).toBe(false);
  });

  it('takes the pad that was touched most recently, not the first slot', () => {
    withPads([
      fakePad({ index: 0, at: 10 }),
      fakePad({ index: 1, at: 99 }),
    ]);
    const g = new GamepadReader();
    g.poll();
    expect(g.index).toBe(1);
  });

  it('pushing the left stick forward is forward', () => {
    // A stick pushed away from you reports NEGATIVE y, and forward is +z.
    withPads([fakePad({ axes: [0, -1, 0, 0] })]);
    const g = new GamepadReader();
    g.poll();
    expect(g.move.z).toBeCloseTo(1, 5);
    expect(g.move.x).toBe(0);
  });

  it('and the invert-strafe setting reaches it', () => {
    withPads([fakePad({ axes: [1, 0, 0, 0] })]);
    const g = new GamepadReader();
    g.poll({ invertStrafe: false });
    expect(g.move.x).toBeCloseTo(1, 5);
    g.poll({ invertStrafe: true });
    expect(g.move.x).toBeCloseTo(-1, 5);
  });

  it('the right stick is a turn RATE, in radians a second', () => {
    withPads([fakePad({ axes: [0, 0, -1, 0] })]);
    const g = new GamepadReader();
    g.poll({ lookSensitivity: 1 });
    // Full deflection, so full rate — and it does not depend on dt, which
    // is the whole point.
    expect(Math.abs(g.look.yaw)).toBeCloseTo(LOOK_RATE, 4);
  });

  it('sensitivity scales it', () => {
    withPads([fakePad({ axes: [0, 0, 1, 0] })]);
    const g = new GamepadReader();
    g.poll({ lookSensitivity: 2 });
    expect(Math.abs(g.look.yaw)).toBeCloseTo(LOOK_RATE * 2, 4);
  });

  it('and invert-Y flips the pitch, not the yaw', () => {
    withPads([fakePad({ axes: [0, 0, 0, 1] })]);
    const g = new GamepadReader();
    g.poll({ invertY: false });
    const up = g.look.pitch;
    g.poll({ invertY: true });
    expect(g.look.pitch).toBeCloseTo(-up, 6);
  });
});

describe('buttons, named for what they do', () => {
  it('a trigger reads from how far it is pulled, not from `pressed`', () => {
    // Some pads only set `pressed` at the very end of the travel, so a
    // half-pulled trigger has to count.
    withPads([fakePad({ buttons: { [PAD_BUTTON.R2]: TRIGGER_POINT + 0.1 } })]);
    const g = new GamepadReader();
    g.poll();
    expect(g.isDown('fire')).toBe(true);

    withPads([fakePad({ buttons: { [PAD_BUTTON.R2]: TRIGGER_POINT - 0.1 } })]);
    g.poll();
    expect(g.isDown('fire')).toBe(false);
  });

  it('reports a press once, on the frame it happened', () => {
    const g = new GamepadReader();
    withPads([fakePad({ buttons: { [PAD_BUTTON.R1]: 1 } })]);
    g.poll();
    expect(g.wasPressed('weaponNext')).toBe(true);
    g.poll();
    expect(g.wasPressed('weaponNext'), 'still held is not pressed again').toBe(false);
    expect(g.isDown('weaponNext')).toBe(true);
  });

  it('and again after it has been let go', () => {
    const g = new GamepadReader();
    withPads([fakePad({ buttons: { [PAD_BUTTON.R1]: 1 } })]);
    g.poll();
    withPads([fakePad()]);
    g.poll();
    withPads([fakePad({ buttons: { [PAD_BUTTON.R1]: 1 } })]);
    g.poll();
    expect(g.wasPressed('weaponNext')).toBe(true);
  });

  it('forgets everything when the pad is unplugged mid-press', () => {
    const g = new GamepadReader();
    withPads([fakePad({ buttons: { [PAD_BUTTON.R2]: 1 } })]);
    g.poll();
    expect(g.isDown('fire')).toBe(true);
    withPads([]);
    g.poll();
    expect(g.isDown('fire'), 'a held trigger must not stay held').toBe(false);
  });

  it('the face buttons rise and fall the machine', () => {
    withPads([fakePad({ buttons: { [PAD_BUTTON.SOUTH]: 1 } })]);
    const g = new GamepadReader();
    g.poll();
    expect(g.move.y).toBe(1);
    withPads([fakePad({ buttons: { [PAD_BUTTON.EAST]: 1 } })]);
    g.poll();
    expect(g.move.y).toBe(-1);
  });

  it('survives a browser that has no gamepads at all', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {}, configurable: true, writable: true,
    });
    expect(GamepadReader.supported).toBe(false);
    expect(() => new GamepadReader().poll()).not.toThrow();
  });

  it('and one whose getGamepads throws', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { getGamepads() { throw new Error('no'); } },
      configurable: true,
      writable: true,
    });
    expect(() => new GamepadReader().poll()).not.toThrow();
  });
});
