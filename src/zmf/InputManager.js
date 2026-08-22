import * as THREE from 'three';
import { deadzone, expoCurve, clamp } from './math.js';

// ============================================================
//  ZMF §8 : Input Management
//  Normalised profiles, sensitivity curve correction, input buffering.
//  Nothing downstream ever reads a raw key or a raw mouse delta.
// ============================================================

/** Radians of yaw per pixel of mouse travel, before the rate conversion. */
const PX_TO_RATE = 0.0011;
/** Angular rate treated as full stick deflection, rad/s. */
const RATE_REF = 6.0;
/**
 * Radians the CAMERA boom swings per pixel of mouse travel. Unlike the aim
 * stick this is a direct angle, not a rate fed through expo: a camera that
 * does not track your hand 1:1 feels broken, however good the curve is.
 */
const PX_TO_ORBIT = 0.0034;

/**
 * The factory layout. Everything downstream asks for an ACTION, never a key,
 * so the whole scheme can be rebound at runtime without anything else caring.
 */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['ShiftLeft', 'ShiftRight'],
  boost: ['KeyE'],
  fire: ['Mouse0'],
  weaponNext: ['KeyC'],
  weaponPrev: ['KeyX'],
  lock: ['KeyF'],
  cycleTarget: ['Tab'],
  layerA: ['Digit1'],
  layerB: ['Digit2'],
  layerC: ['Digit3'],
  reset: ['KeyR'],
  /** Held: the mouse swings the CAMERA instead of the machine. */
  camera: ['Mouse2', 'AltLeft', 'AltRight'],
};

/** How the key-config screen groups and names them. */
export const ACTION_GROUPS = [
  { label: '移動', actions: ['forward', 'back', 'left', 'right', 'up', 'down', 'boost'] },
  { label: '戦闘', actions: ['fire', 'weaponNext', 'weaponPrev', 'lock', 'cycleTarget'] },
  { label: 'カメラ', actions: ['camera'] },
  { label: 'システム', actions: ['layerA', 'layerB', 'layerC', 'reset'] },
];

export const ACTION_LABEL = {
  forward: '前進',
  back: '後退',
  left: '左移動',
  right: '右移動',
  up: '上昇 / ジャンプ',
  down: '下降',
  boost: 'ブースト',
  fire: '武器を撃つ',
  weaponNext: '武器を次に切替',
  weaponPrev: '武器を前に切替',
  lock: 'ロックオン',
  cycleTarget: 'ターゲット切替',
  camera: 'カメラを回す (押しながら)',
  layerA: 'レイヤー A',
  layerB: 'レイヤー B',
  layerC: 'レイヤー C',
  reset: 'リスポーン',
};

export const ACTIONS = Object.keys(DEFAULT_BINDINGS);

const KEY_NAMES = {
  Space: 'Space',
  ShiftLeft: '左Shift', ShiftRight: '右Shift',
  ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
  AltLeft: '左Alt', AltRight: '右Alt',
  Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'BS',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
  Comma: ',', Period: '.', Slash: '/',
};

const MOUSE_NAMES = ['左クリック', 'ホイール押し', '右クリック'];

/** A key code as a human would say it. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) {
    const n = Number(code.slice(5));
    return MOUSE_NAMES[n] ?? `マウス${n + 1}`;
  }
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `テンキー${code.slice(6)}`;
  return code;
}

/** Drop unknown actions and empty rows, so a stale save cannot break input. */
function sanitiseBindings(raw) {
  const out = {};
  for (const action of ACTIONS) {
    const codes = Array.isArray(raw?.[action]) ? raw[action].filter((c) => typeof c === 'string') : null;
    out[action] = codes?.length ? [...new Set(codes)] : [...DEFAULT_BINDINGS[action]];
  }
  return out;
}

export class InputManager {
  constructor(domElement, { bindings = null } = {}) {
    this.dom = domElement;
    /** action -> key codes. Rebindable; nothing else in the game reads keys. */
    this.bindings = sanitiseBindings(bindings);
    /** Bumped whenever the scheme changes, so UI can re-render on it. */
    this.onBindingsChanged = () => {};
    this.keys = new Set();
    this.pressed = new Set();     // edge: went down this frame
    this.released = new Set();
    this.buffer = [];             // { action, t } — command buffer
    this.bufferWindow = 0.28;     // seconds a buffered command stays live
    this.mouse = { dx: 0, dy: 0, wheel: 0 };
    this.pointerLocked = false;
    this.enabled = false;
    this.time = 0;

    /** Normalised profile — every consumer works in 0..1 space. */
    this.profile = {
      lookSensitivity: 1.0,
      expo: 0.42,
      deadzone: 0.06,
      invertY: false,
      /**
       * Strafe mapping. true = A steers right, D steers left (the requested
       * layout); set false for the conventional A=left / D=right.
       */
      invertStrafe: true,
      /** Filled in from the build's stats: heavier machines get slower look. */
      massSensitivityScale: 1.0,
    };

    this.move = new THREE.Vector3();      // local: x=right, y=up, z=forward
    this.moveRaw = new THREE.Vector3();
    this.look = { yaw: 0, pitch: 0 };
    /** Radians to swing the camera boom THIS frame, while orbiting. */
    this.cameraLook = { yaw: 0, pitch: 0 };
    /** Wheel travel for this frame, consumed by the camera as zoom. */
    this.zoomDelta = 0;
    this.intensity = 0;                   // |move|, used for soft-override
    this._lastTap = new Map();
    this.dash = null;                     // { dir: Vector3, t } on double-tap

    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      if (e.code === 'Tab') e.preventDefault();
      // Alt is the keyboard stand-in for the right button; letting it through
      // hands focus to the browser's menu bar mid-fight.
      if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this._pushBuffer(e.code);
      this._checkDoubleTap(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this._onMouseMove = (e) => {
      if (!this.enabled || !this.pointerLocked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(`Mouse${e.button}`);
      this.pressed.add(`Mouse${e.button}`);
      this._pushBuffer(`Mouse${e.button}`);
    };
    this._onMouseUp = (e) => {
      this.keys.delete(`Mouse${e.button}`);
      this.released.add(`Mouse${e.button}`);
    };
    this._onWheel = (e) => { if (this.enabled) this.mouse.wheel += e.deltaY; };
    // Right-drag is the orbit gesture, so it must not raise a context menu.
    this._onContextMenu = (e) => { if (this.enabled && this.pointerLocked) e.preventDefault(); };
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    };
    this._onBlur = () => { this.keys.clear(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.move.set(0, 0, 0);
      this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
      this.cameraLook.yaw = this.cameraLook.pitch = 0;
      this.zoomDelta = 0;
    }
  }

  requestPointerLock() {
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------- buffering

  _pushBuffer(code) {
    for (const [action, codes] of Object.entries(this.bindings)) {
      if (codes.includes(code)) this.buffer.push({ action, t: this.time });
    }
  }

  /**
   * Consume a buffered command. Late presses still land, which is what makes
   * chained inputs feel responsive rather than dropped.
   */
  consume(action, window = this.bufferWindow) {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const e = this.buffer[i];
      if (e.action === action && this.time - e.t <= window) {
        this.buffer.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  _checkDoubleTap(code) {
    // Dash works in all four directions, including straight backwards.
    const sx = this.profile.invertStrafe ? -1 : 1;
    const dirs = {
      forward: [0, 0, 1], back: [0, 0, -1],
      left: [-sx, 0, 0], right: [sx, 0, 0],
    };
    for (const [action, codes] of Object.entries(this.bindings)) {
      if (!codes.includes(code) || !dirs[action]) continue;
      const prev = this._lastTap.get(action) ?? -99;
      if (this.time - prev < 0.26) {
        this.dash = { dir: new THREE.Vector3().fromArray(dirs[action]), t: this.time };
      }
      this._lastTap.set(action, this.time);
    }
  }

  // ---------------------------------------------------------- per-frame

  isDown(action) { return (this.bindings[action] ?? []).some((c) => this.keys.has(c)); }
  wasPressed(action) { return (this.bindings[action] ?? []).some((c) => this.pressed.has(c)); }

  // ---------------------------------------------------------- key config

  /** The codes currently bound to an action. */
  keysFor(action) { return [...(this.bindings[action] ?? [])]; }

  /** The first key bound to an action, for a hint line with no room to spare. */
  primary(action) { return keyLabel(this.bindings[action]?.[0]); }

  /** How an action reads in full: "W / ↑". */
  describe(action) {
    const codes = this.bindings[action];
    return codes?.length ? codes.map(keyLabel).join(' / ') : '未設定';
  }

  /** Which action, if any, currently owns a key code. */
  actionFor(code) {
    for (const [action, codes] of Object.entries(this.bindings)) {
      if (codes.includes(code)) return action;
    }
    return null;
  }

  /**
   * Give a key to an action, taking it off whatever held it before: one key,
   * one job. Returns the action it was stolen from, or null.
   */
  bind(action, code) {
    if (!this.bindings[action] || !code) return null;
    const previous = this.actionFor(code);
    if (previous === action) return null;
    if (previous) {
      this.bindings[previous] = this.bindings[previous].filter((c) => c !== code);
    }
    this.bindings[action] = [...this.bindings[action], code];
    this.onBindingsChanged(this.bindings);
    return previous;
  }

  /** Take one key off an action. The last key may not be removed. */
  unbind(action, code) {
    const codes = this.bindings[action];
    if (!codes || codes.length <= 1 || !codes.includes(code)) return false;
    this.bindings[action] = codes.filter((c) => c !== code);
    this.onBindingsChanged(this.bindings);
    return true;
  }

  /** Replace one action's whole row. */
  setBinding(action, codes) {
    if (!this.bindings[action]) return false;
    const list = [...new Set((codes ?? []).filter((c) => typeof c === 'string'))];
    if (!list.length) return false;
    for (const code of list) {
      const previous = this.actionFor(code);
      if (previous && previous !== action) {
        this.bindings[previous] = this.bindings[previous].filter((c) => c !== code);
      }
    }
    this.bindings[action] = list;
    this.onBindingsChanged(this.bindings);
    return true;
  }

  resetBindings() {
    this.bindings = sanitiseBindings(null);
    this.onBindingsChanged(this.bindings);
    return this;
  }

  /** Only the rows that differ from the factory layout are worth saving. */
  bindingsToJSON() {
    const out = {};
    for (const action of ACTIONS) {
      const codes = this.bindings[action];
      const base = DEFAULT_BINDINGS[action];
      if (codes.length !== base.length || codes.some((c, i) => c !== base[i])) out[action] = codes;
    }
    return out;
  }

  loadBindings(raw) {
    this.bindings = sanitiseBindings({ ...DEFAULT_BINDINGS, ...(raw ?? {}) });
    this.onBindingsChanged(this.bindings);
    return this;
  }

  /** Call once per frame, before anything reads the input state. */
  update(dt) {
    this.time += dt;

    const strafeSign = this.profile.invertStrafe ? -1 : 1;
    const ax = ((this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0)) * strafeSign;
    const ay = (this.isDown('up') ? 1 : 0) - (this.isDown('down') ? 1 : 0);
    const az = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);

    this.moveRaw.set(ax, ay, az);
    // Normalise the horizontal plane only — vertical thrust is its own channel.
    const h = Math.hypot(ax, az);
    if (h > 1) { this.move.set(ax / h, ay, az / h); } else { this.move.set(ax, ay, az); }
    this.intensity = Math.min(1, Math.hypot(this.move.x, this.move.y, this.move.z));

    // --- look: pixels -> angular RATE, then deadzone -> expo -> profile.
    // Working in rad/s rather than rad/frame is what keeps the feel identical
    // at 30fps and at 240fps; everything downstream just multiplies by dt.
    const s = this.profile.lookSensitivity * this.profile.massSensitivityScale;
    const invDt = 1 / Math.max(dt, 1e-4);
    const rawYaw = -this.mouse.dx * PX_TO_RATE * s * invDt;
    const rawPitch = -this.mouse.dy * PX_TO_RATE * s * invDt * (this.profile.invertY ? -1 : 1);

    const nx = clamp(rawYaw / RATE_REF, -1, 1);
    const ny = clamp(rawPitch / RATE_REF, -1, 1);

    const yawRate = expoCurve(deadzone(nx, this.profile.deadzone), this.profile.expo) * RATE_REF;
    const pitchRate = expoCurve(deadzone(ny, this.profile.deadzone), this.profile.expo) * RATE_REF;

    // While the camera modifier is held the stick drives the boom, not the
    // machine — and, crucially, it does NOT count as aim deflection, so
    // looking around never soft-overrides the lock you are holding.
    if (this.isDown('camera')) {
      const g = PX_TO_ORBIT * this.profile.lookSensitivity;
      this.cameraLook.yaw = -this.mouse.dx * g;
      this.cameraLook.pitch = -this.mouse.dy * g * (this.profile.invertY ? -1 : 1);
      this.look.yaw = 0;
      this.look.pitch = 0;
      this.lookMagnitude = 0;
    } else {
      this.cameraLook.yaw = 0;
      this.cameraLook.pitch = 0;
      this.look.yaw = yawRate;
      this.look.pitch = pitchRate;
      /** 0..1 normalised aim deflection — this is what soft-override reads. */
      this.lookMagnitude = Math.min(1, Math.hypot(nx, ny));
    }

    this.zoomDelta = this.mouse.wheel;

    this.mouse.dx = 0;
    this.mouse.dy = 0;

    // expire the command buffer
    const cutoff = this.time - 1.0;
    while (this.buffer.length && this.buffer[0].t < cutoff) this.buffer.shift();
    if (this.dash && this.time - this.dash.t > 0.12) this.dash = null;
  }

  /** Call at the very end of the frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.wheel = 0;
  }
}

/** Back-compat alias: the factory layout, before any rebinding. */
export { DEFAULT_BINDINGS as BINDINGS };
