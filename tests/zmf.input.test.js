import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager, BINDINGS } from '../src/zmf/InputManager.js';
import { installFakeDom } from './helpers/dom.js';

let dom;
let input;

beforeEach(() => {
  dom = installFakeDom();
  input = new InputManager(dom.el);
  input.setEnabled(true);
});

afterEach(() => {
  input.dispose();
  dom.restore();
});

const key = (code, down = true) => dom.fire(down ? 'keydown' : 'keyup', { code, repeat: false, preventDefault() {} });

describe('bindings', () => {
  it('covers every action the game asks for', () => {
    for (const action of [
      'forward', 'back', 'left', 'right', 'up', 'down',
      'boost', 'brake', 'lock', 'fire', 'layerA', 'layerB', 'layerC', 'reset', 'cycleTarget',
    ]) {
      expect(BINDINGS[action], action).toBeTruthy();
      expect(BINDINGS[action].length).toBeGreaterThan(0);
    }
  });
});

describe('movement axes', () => {
  it('maps W and S onto forward and back', () => {
    key('KeyW');
    input.update(1 / 60);
    expect(input.move.z).toBe(1);

    key('KeyW', false); key('KeyS');
    input.update(1 / 60);
    expect(input.move.z).toBe(-1);
  });

  it('steers A left and D right', () => {
    expect(input.profile.invertStrafe).toBe(false);

    key('KeyA');
    input.update(1 / 60);
    expect(input.move.x, 'A goes left').toBe(-1);

    key('KeyA', false); key('KeyD');
    input.update(1 / 60);
    expect(input.move.x, 'D goes right').toBe(1);
  });

  it('the strafe mapping can be swapped through the profile', () => {
    input.profile.invertStrafe = true;
    key('KeyD');
    input.update(1 / 60);
    expect(input.move.x).toBe(-1);
  });

  it('normalises diagonals in the horizontal plane only', () => {
    key('KeyW'); key('KeyD'); key('Space');
    input.update(1 / 60);
    expect(Math.hypot(input.move.x, input.move.z)).toBeCloseTo(1, 6);
    expect(input.move.y).toBe(1);      // vertical is its own channel
  });

  it('opposing keys cancel', () => {
    key('KeyW'); key('KeyS');
    input.update(1 / 60);
    expect(input.move.z).toBe(0);
    expect(input.intensity).toBe(0);
  });

  it('arrow keys are an alias for WASD', () => {
    key('ArrowUp');
    input.update(1 / 60);
    expect(input.move.z).toBe(1);
  });

  it('goes quiet when disabled', () => {
    key('KeyW');
    input.update(1 / 60);
    input.setEnabled(false);
    input.update(1 / 60);
    expect(input.move.length()).toBe(0);
    expect(input.isDown('forward')).toBe(false);
  });
});

describe('look', () => {
  it('is silent with no mouse movement', () => {
    input.update(1 / 60);
    expect(input.look.yaw).toBe(0);
    expect(input.lookMagnitude).toBe(0);
  });

  it('turns left for rightward movement of the mouse, in rad/s', () => {
    input.mouse.dx = 60;
    input.update(1 / 60);
    expect(input.look.yaw).toBeLessThan(0);
    expect(Math.abs(input.look.yaw)).toBeLessThan(6.001);
  });

  it('produces the same rate at 30fps and 120fps', () => {
    // the same physical mouse speed, sampled at two different rates
    input.mouse.dx = 200;
    input.update(1 / 30);
    const slow = input.look.yaw;

    input.mouse.dx = 50;
    input.update(1 / 120);
    expect(input.look.yaw).toBeCloseTo(slow, 6);
  });

  it('caps the angular rate however hard the mouse is flicked', () => {
    input.mouse.dx = 100000;
    input.update(1 / 60);
    expect(Math.abs(input.look.yaw)).toBeLessThanOrEqual(6.0001);
    expect(input.lookMagnitude).toBe(1);
  });

  it('consumes the delta so it is not applied twice', () => {
    input.mouse.dx = 200;
    input.update(1 / 60);
    input.update(1 / 60);
    expect(input.look.yaw).toBe(0);
  });

  it('honours invertY', () => {
    input.mouse.dy = 200;
    input.update(1 / 60);
    const normal = input.look.pitch;
    input.profile.invertY = true;
    input.mouse.dy = 200;
    input.update(1 / 60);
    expect(Math.sign(input.look.pitch)).toBe(-Math.sign(normal));
  });

  it('scales with the mass sensitivity profile', () => {
    input.mouse.dx = 40;
    input.update(1 / 60);
    const light = Math.abs(input.look.yaw);

    input.profile.massSensitivityScale = 0.4;
    input.mouse.dx = 40;
    input.update(1 / 60);
    expect(Math.abs(input.look.yaw)).toBeLessThan(light);
  });
});

describe('command buffer', () => {
  it('remembers a press for a short window', () => {
    key('Space');
    input.update(1 / 60);
    expect(input.consume('up')).toBe(true);
    expect(input.consume('up')).toBe(false);   // consumed once
  });

  it('forgets a press that is too old', () => {
    key('KeyF');
    for (let i = 0; i < 60; i++) input.update(1 / 60);
    expect(input.consume('lock', 0.28)).toBe(false);
  });

  it('expires the buffer entirely after a second', () => {
    key('KeyF');
    for (let i = 0; i < 120; i++) input.update(1 / 60);
    expect(input.buffer).toHaveLength(0);
  });

  it('reports edge presses for exactly one frame', () => {
    key('Digit1');
    expect(input.wasPressed('layerA')).toBe(true);
    input.endFrame();
    expect(input.wasPressed('layerA')).toBe(false);
    expect(input.isDown('layerA')).toBe(true);   // still held
  });
});

describe('double tap dash', () => {
  it('fires on a quick double tap of a direction', () => {
    key('KeyW'); key('KeyW', false);
    input.update(1 / 60);
    key('KeyW');
    input.update(1 / 60);
    expect(input.dash).toBeTruthy();
    expect(input.dash.dir.z).toBe(1);
  });

  it('dashes backwards too', () => {
    key('KeyS'); key('KeyS', false);
    input.update(1 / 60);
    key('KeyS');
    input.update(1 / 60);
    expect(input.dash).toBeTruthy();
    expect(input.dash.dir.z).toBe(-1);
  });

  it('the sideways dash follows the strafe mapping', () => {
    key('KeyA'); key('KeyA', false);
    input.update(1 / 60);
    key('KeyA');
    input.update(1 / 60);
    expect(input.dash.dir.x, 'A dashes left').toBe(-1);

    input.profile.invertStrafe = true;
    key('KeyD'); key('KeyD', false);
    input.update(1 / 60);
    key('KeyD');
    input.update(1 / 60);
    expect(input.dash.dir.x, 'swapped: D dashes left').toBe(-1);
  });

  it('does not fire on a slow double tap', () => {
    key('KeyW'); key('KeyW', false);
    for (let i = 0; i < 40; i++) input.update(1 / 60);
    key('KeyW');
    input.update(1 / 60);
    expect(input.dash).toBeNull();
  });

  it('expires shortly after firing', () => {
    key('KeyA'); key('KeyA', false);
    input.update(1 / 60);
    key('KeyA');
    input.update(1 / 60);
    expect(input.dash).toBeTruthy();
    for (let i = 0; i < 20; i++) input.update(1 / 60);
    expect(input.dash).toBeNull();
  });
});

describe('mouse buttons and pointer lock', () => {
  it('tracks the fire button', () => {
    dom.fire('mousedown', { button: 0 });
    expect(input.isDown('fire')).toBe(true);
    dom.fire('mouseup', { button: 0 });
    expect(input.isDown('fire')).toBe(false);
  });

  it('only accepts mouse movement while locked', () => {
    dom.fire('mousemove', { movementX: 100, movementY: 0 });
    expect(input.mouse.dx).toBe(0);

    input.requestPointerLock();
    dom.fire('pointerlockchange', {});
    expect(input.pointerLocked).toBe(true);

    dom.fire('mousemove', { movementX: 100, movementY: 0 });
    expect(input.mouse.dx).toBe(100);
  });

  it('drops every held key when the window loses focus', () => {
    key('KeyW');
    dom.fire('blur', {});
    input.update(1 / 60);
    expect(input.move.z).toBe(0);
  });
});
