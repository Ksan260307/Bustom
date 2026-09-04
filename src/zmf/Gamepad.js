// ============================================================
//  A controller.
//
//  The word "gamepad" did not appear anywhere in this codebase. A robot
//  game, built for Steam, playable only from a keyboard — and Steam Deck is
//  a keyboard-less Steam machine, so that is not a preference, it is a
//  platform.
//
//  This produces the SAME channels the keyboard and mouse already produce,
//  so nothing downstream learns what a controller is: a movement vector, a
//  look rate, and a set of held actions. InputManager merges the two, which
//  also means both work at once — put the pad down mid-fight and the
//  keyboard is still there.
//
//  ONE REAL DIFFERENCE, and it is the one that gets this wrong everywhere:
//  a mouse reports a DISTANCE MOVED and a stick reports a POSITION HELD.
//  Turning a mouse delta into a rate means dividing by the frame time;
//  turning a stick into a rate means multiplying by it. Treat a stick like
//  a mouse and the aim speed doubles when the frame rate halves.
// ============================================================

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The standard mapping, as the browser reports it.
 *
 * Every pad that identifies as `standard` — Xbox, DualSense, Switch Pro,
 * the Deck's own controls — lays its buttons out this way, so this table is
 * the whole of the hardware knowledge in this file.
 */
export const PAD_BUTTON = {
  SOUTH: 0,   // A / Cross
  EAST: 1,    // B / Circle
  WEST: 2,    // X / Square
  NORTH: 3,   // Y / Triangle
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

/**
 * Which button does which job.
 *
 * Named for the ACTION, exactly as the key bindings are, so the rest of the
 * game cannot tell where a press came from. The shape follows what a player
 * coming from any third-person shooter already expects: triggers shoot and
 * boost, bumpers change weapon, sticks click for the lock.
 */
export const PAD_BINDINGS = {
  fire: [PAD_BUTTON.R2],
  boost: [PAD_BUTTON.L2],
  up: [PAD_BUTTON.SOUTH],
  down: [PAD_BUTTON.EAST],
  weaponNext: [PAD_BUTTON.R1],
  weaponPrev: [PAD_BUTTON.L1],
  lock: [PAD_BUTTON.L3],
  cycleTarget: [PAD_BUTTON.R3],
  lockLeft: [PAD_BUTTON.LEFT],
  lockRight: [PAD_BUTTON.RIGHT],
  reset: [PAD_BUTTON.NORTH],
  camera: [PAD_BUTTON.SELECT],
};

/** How far a stick must move before it counts as moved at all. */
export const STICK_DEADZONE = 0.18;

/** How far a trigger must be pulled to read as a press. */
export const TRIGGER_POINT = 0.4;

/**
 * How fast the right stick turns the machine, in radians per second at full
 * deflection.
 *
 * Sensitivity multiplies this. It is a rate rather than a per-frame amount
 * for the reason in the header, and it is deliberately lower than a mouse
 * can reach — a stick that matches a mouse's top speed is a stick that
 * cannot be aimed at all in the middle of its travel.
 */
export const LOOK_RATE = 3.2;

/**
 * Radial deadzone, then a curve.
 *
 * Applied to the PAIR rather than to each axis, because a per-axis deadzone
 * makes a square hole: pushing diagonally at 0.2 on each axis is a real
 * push of 0.28 that a per-axis test throws away, and the stick feels dead
 * in exactly the directions people use most.
 */
export function stick(x, y, dead = STICK_DEADZONE, expo = 0.5) {
  const mag = Math.hypot(x, y);
  if (mag <= dead) return { x: 0, y: 0, mag: 0 };
  // Rescale so the edge of the deadzone is 0 and the rim is still 1.
  const scaled = Math.min(1, (mag - dead) / (1 - dead));
  const curved = scaled * ((1 - expo) + expo * scaled * scaled);
  const k = curved / mag;
  return { x: x * k, y: y * k, mag: curved };
}

export class GamepadReader {
  constructor({ bindings = PAD_BINDINGS } = {}) {
    this.bindings = bindings;
    /** Index of the pad being used, or -1. */
    this.index = -1;
    /** Actions held down this frame. */
    this.held = new Set();
    /** Actions that went down this frame. */
    this.pressed = new Set();
    this._wasHeld = new Set();
    /** -1..1 each: x is strafe, y is vertical, z is forward. */
    this.move = { x: 0, y: 0, z: 0 };
    /** Radians per second. */
    this.look = { yaw: 0, pitch: 0 };
    /** 0..1, how far the aim stick is pushed. Drives the soft-override. */
    this.lookMagnitude = 0;
    /** True on any frame a pad has been touched. */
    this.active = false;
  }

  /** Whether the platform offers gamepads at all. */
  static get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  _pads() {
    try {
      return navigator.getGamepads?.() ?? [];
    } catch {
      return [];
    }
  }

  /**
   * The pad to listen to.
   *
   * Whichever one is connected and has been touched most recently, rather
   * than index 0: a wireless pad that has gone to sleep still occupies its
   * slot, and a player who picks up a second one means to use it.
   */
  _pick(pads) {
    let best = null;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      if (best === null || pad.timestamp > best.timestamp) best = pad;
    }
    return best;
  }

  /**
   * Read the pad, once per frame.
   *
   * @param {object} profile  the same profile the mouse uses
   * @returns {boolean} whether a pad answered
   */
  poll(profile = {}) {
    this.pressed.clear();
    const pad = this._pick(this._pads());
    if (!pad) {
      this.index = -1;
      this.active = false;
      this.held.clear();
      this._wasHeld.clear();
      this.move.x = 0; this.move.y = 0; this.move.z = 0;
      this.look.yaw = 0; this.look.pitch = 0;
      this.lookMagnitude = 0;
      return false;
    }
    this.index = pad.index;

    // ---- buttons
    const down = (i) => {
      const b = pad.buttons?.[i];
      if (!b) return false;
      // A trigger is an axis wearing a button's clothes: `pressed` is true
      // only at the very end of its travel on some pads, so the value is
      // what decides.
      if (i === PAD_BUTTON.L2 || i === PAD_BUTTON.R2) return (b.value ?? 0) > TRIGGER_POINT;
      return !!b.pressed || (b.value ?? 0) > 0.5;
    };

    this.held.clear();
    for (const [action, list] of Object.entries(this.bindings)) {
      if (list.some(down)) this.held.add(action);
    }
    for (const action of this.held) {
      if (!this._wasHeld.has(action)) this.pressed.add(action);
    }
    this._wasHeld = new Set(this.held);

    // ---- sticks
    const ax = pad.axes ?? [];
    const left = stick(ax[0] ?? 0, ax[1] ?? 0);
    const right = stick(ax[2] ?? 0, ax[3] ?? 0);

    const strafeSign = profile.invertStrafe ? -1 : 1;
    this.move.x = left.x * strafeSign;
    // A stick pushed forward reports NEGATIVE y, and forward is +z here.
    this.move.z = -left.y;
    this.move.y = (this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0);

    const sens = (profile.lookSensitivity ?? 1) * (profile.massSensitivityScale ?? 1);
    const rate = LOOK_RATE * sens;
    this.look.yaw = -right.x * rate;
    this.look.pitch = -right.y * rate * (profile.invertY ? -1 : 1);
    this.lookMagnitude = right.mag;

    this.active = left.mag > 0 || right.mag > 0 || this.held.size > 0;
    return true;
  }

  /** Is this action held on the pad? */
  isDown(action) { return this.held.has(action); }

  /** Did it go down this frame? */
  wasPressed(action) { return this.pressed.has(action); }
}

export { clamp };
