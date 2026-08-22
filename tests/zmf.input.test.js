import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InputManager, BINDINGS, DEFAULT_BINDINGS, ACTIONS, ACTION_GROUPS, ACTION_LABEL, keyLabel,
} from '../src/zmf/InputManager.js';
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
      'boost', 'lock', 'fire', 'layerA', 'layerB', 'layerC', 'reset', 'cycleTarget',
      'camera', 'weaponNext', 'weaponPrev',
    ]) {
      expect(BINDINGS[action], action).toBeTruthy();
      expect(BINDINGS[action].length).toBeGreaterThan(0);
    }
  });
});

describe('key config', () => {
  it('every action is named and lives in exactly one group', () => {
    const grouped = ACTION_GROUPS.flatMap((g) => g.actions);
    expect(grouped.sort()).toEqual([...ACTIONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const a of ACTIONS) expect(ACTION_LABEL[a], a).toBeTruthy();
  });

  it('reads keys back the way a person says them', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('ShiftLeft')).toBe('左Shift');
    expect(keyLabel('Mouse0')).toBe('左クリック');
    expect(keyLabel('Mouse2')).toBe('右クリック');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel(null)).toBe('—');
  });

  it('starts on the factory layout', () => {
    expect(input.keysFor('forward')).toEqual(DEFAULT_BINDINGS.forward);
    expect(input.describe('forward')).toBe('W / ↑');
    expect(input.primary('forward')).toBe('W');
  });

  it('rebinding actually changes what the key does', () => {
    input.setBinding('forward', ['KeyI']);
    key('KeyW');
    input.update(1 / 60);
    expect(input.move.z, 'the old key is dead').toBe(0);

    key('KeyW', false);
    key('KeyI');
    input.update(1 / 60);
    expect(input.move.z, 'and the new one drives').toBe(1);
  });

  it('one key does one job: assigning it takes it off the old owner', () => {
    expect(input.bind('boost', 'KeyW')).toBe('forward');
    expect(input.keysFor('boost')).toContain('KeyW');
    expect(input.keysFor('forward')).not.toContain('KeyW');
    expect(input.actionFor('KeyW')).toBe('boost');
  });

  it('rebinding to a key the action already has is a no-op', () => {
    expect(input.bind('boost', 'KeyE')).toBeNull();
    expect(input.keysFor('boost')).toEqual(['KeyE']);
  });

  it('an action may hold several keys, but never zero', () => {
    input.bind('boost', 'KeyH');
    expect(input.keysFor('boost')).toEqual(['KeyE', 'KeyH']);
    expect(input.unbind('boost', 'KeyE')).toBe(true);
    expect(input.unbind('boost', 'KeyH'), 'the last one stays').toBe(false);
    expect(input.keysFor('boost')).toEqual(['KeyH']);
  });

  it('refuses to bind an action it has never heard of', () => {
    expect(input.bind('teleport', 'KeyT')).toBeNull();
    expect(input.setBinding('teleport', ['KeyT'])).toBe(false);
    expect(input.setBinding('boost', [])).toBe(false);
  });

  it('fires a change hook, so the UI can follow along', () => {
    let n = 0;
    input.onBindingsChanged = () => { n++; };
    input.bind('boost', 'KeyH');
    input.unbind('boost', 'KeyH');
    input.resetBindings();
    expect(n).toBe(3);
  });

  it('reset puts the whole scheme back', () => {
    input.setBinding('forward', ['KeyI']);
    input.setBinding('fire', ['KeyJ']);
    input.resetBindings();
    for (const a of ACTIONS) expect(input.keysFor(a), a).toEqual(DEFAULT_BINDINGS[a]);
  });

  it('saves only what the player changed', () => {
    expect(input.bindingsToJSON()).toEqual({});
    input.setBinding('fire', ['KeyJ']);
    expect(input.bindingsToJSON()).toEqual({ fire: ['KeyJ'] });
  });

  it('loads a saved scheme, and survives a corrupt one', () => {
    input.loadBindings({ fire: ['KeyJ'] });
    expect(input.keysFor('fire')).toEqual(['KeyJ']);
    expect(input.keysFor('forward'), 'untouched rows keep the defaults')
      .toEqual(DEFAULT_BINDINGS.forward);

    input.loadBindings({ fire: [], nonsense: ['KeyQ'], forward: [42, 'KeyI'] });
    expect(input.keysFor('fire'), 'an empty row falls back').toEqual(DEFAULT_BINDINGS.fire);
    expect(input.keysFor('forward'), 'junk entries are dropped').toEqual(['KeyI']);
    expect(input.bindings.nonsense).toBe(undefined);
  });

  it('a scheme handed in at construction is honoured', () => {
    const custom = new InputManager(dom.el, { bindings: { fire: ['KeyJ'] } });
    expect(custom.keysFor('fire')).toEqual(['KeyJ']);
    custom.dispose();
  });

  it('describes an action with nothing bound', () => {
    input.bind('boost', 'Space');           // steals it off `up`
    expect(input.keysFor('up')).toEqual([]);
    expect(input.describe('up')).toBe('未設定');
    expect(input.isDown('up')).toBe(false);
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

  it('steers A right and D left, as configured', () => {
    expect(input.profile.invertStrafe).toBe(true);

    key('KeyA');
    input.update(1 / 60);
    expect(input.move.x, 'A goes right').toBe(1);

    key('KeyA', false); key('KeyD');
    input.update(1 / 60);
    expect(input.move.x, 'D goes left').toBe(-1);
  });

  it('the strafe mapping can be swapped back through the profile', () => {
    input.profile.invertStrafe = false;
    key('KeyD');
    input.update(1 / 60);
    expect(input.move.x).toBe(1);
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

describe('camera stick', () => {
  const holdCamera = (on = true) => dom.fire(on ? 'mousedown' : 'mouseup', { button: 2 });

  it('is silent until the modifier is held', () => {
    input.mouse.dx = 200;
    input.update(1 / 60);
    expect(input.cameraLook.yaw).toBe(0);
    expect(input.look.yaw).not.toBe(0);
  });

  it('steals the stick from the machine while held', () => {
    holdCamera();
    input.mouse.dx = 200;
    input.mouse.dy = 120;
    input.update(1 / 60);

    expect(input.cameraLook.yaw).not.toBe(0);
    expect(input.cameraLook.pitch).not.toBe(0);
    expect(input.look.yaw, 'the machine does not turn').toBe(0);
    expect(input.look.pitch).toBe(0);
  });

  it('does not read as aim deflection, so it cannot break a lock', () => {
    holdCamera();
    input.mouse.dx = 100000;
    input.update(1 / 60);
    expect(input.lookMagnitude).toBe(0);
  });

  it('gives back the stick on release', () => {
    holdCamera();
    input.mouse.dx = 200;
    input.update(1 / 60);
    holdCamera(false);
    input.mouse.dx = 200;
    input.update(1 / 60);
    expect(input.cameraLook.yaw).toBe(0);
    expect(input.look.yaw).not.toBe(0);
  });

  it('turns left for rightward mouse travel, like the aim stick', () => {
    holdCamera();
    input.mouse.dx = 200;
    input.update(1 / 60);
    expect(input.cameraLook.yaw).toBeLessThan(0);
  });

  it('is an angle per pixel, not a rate: dt does not change it', () => {
    holdCamera();
    input.mouse.dx = 200;
    input.update(1 / 30);
    const slow = input.cameraLook.yaw;
    input.mouse.dx = 200;
    input.update(1 / 240);
    expect(input.cameraLook.yaw).toBeCloseTo(slow, 9);
  });

  it('is proportional to how far the mouse moved', () => {
    holdCamera();
    input.mouse.dx = 100;
    input.update(1 / 60);
    const one = input.cameraLook.yaw;
    input.mouse.dx = 300;
    input.update(1 / 60);
    expect(input.cameraLook.yaw).toBeCloseTo(one * 3, 9);
  });

  it('scales with look sensitivity and honours invertY', () => {
    holdCamera();
    input.mouse.dy = 100;
    input.update(1 / 60);
    const normal = input.cameraLook.pitch;

    input.profile.invertY = true;
    input.mouse.dy = 100;
    input.update(1 / 60);
    expect(Math.sign(input.cameraLook.pitch)).toBe(-Math.sign(normal));
    input.profile.invertY = false;

    input.profile.lookSensitivity = 2;
    input.mouse.dy = 100;
    input.update(1 / 60);
    expect(input.cameraLook.pitch).toBeCloseTo(normal * 2, 9);
  });

  it('Alt works as the keyboard stand-in for the right button', () => {
    key('AltLeft');
    input.mouse.dx = 200;
    input.update(1 / 60);
    expect(input.cameraLook.yaw).not.toBe(0);
    expect(input.look.yaw).toBe(0);
  });
});

describe('zoom', () => {
  it('reports the wheel travel for the frame', () => {
    dom.fire('wheel', { deltaY: 100 });
    dom.fire('wheel', { deltaY: 50 });
    input.update(1 / 60);
    expect(input.zoomDelta).toBe(150);
  });

  it('is cleared at the end of the frame, so a notch counts once', () => {
    dom.fire('wheel', { deltaY: 100 });
    input.update(1 / 60);
    input.endFrame();
    input.update(1 / 60);
    expect(input.zoomDelta).toBe(0);
  });

  it('suppresses the context menu while locked, so right-drag can orbit', () => {
    let prevented = false;
    const ev = { preventDefault() { prevented = true; } };
    dom.fire('contextmenu', ev);
    expect(prevented, 'a plain page keeps its menu').toBe(false);

    input.requestPointerLock();
    dom.fire('pointerlockchange', {});
    dom.fire('contextmenu', ev);
    expect(prevented).toBe(true);
  });

  it('ignores the wheel while input is off', () => {
    input.setEnabled(false);
    dom.fire('wheel', { deltaY: 100 });
    input.setEnabled(true);
    input.update(1 / 60);
    expect(input.zoomDelta).toBe(0);
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
    expect(input.dash.dir.x, 'A dashes right').toBe(1);

    input.profile.invertStrafe = false;
    key('KeyD'); key('KeyD', false);
    input.update(1 / 60);
    key('KeyD');
    input.update(1 / 60);
    expect(input.dash.dir.x, 'swapped back: D dashes right').toBe(1);
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
