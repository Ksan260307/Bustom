import * as THREE from 'three';
import { ACTION_BITS, LOOK_SCALE } from '../core/constants.js';

/**
 * One player's intent for one step of the simulation, as something that can
 * be put on a wire and read back identically.
 *
 * Lockstep sends inputs, not positions: everybody runs the same fight from
 * the same seed and the same commands. That only works if the commands are
 * the same, and a mouse does not produce the same numbers twice — it
 * produces a double, which travels through JSON and comes back subtly
 * rounded, and a machine that turns 0.0000001 radians further than another
 * one is aiming somewhere else a minute later.
 *
 * So a frame is integers. Buttons are one bit each; look is quantised to a
 * grid before it is used ANYWHERE, including by the player who moved the
 * mouse. That last part is the one that is easy to get wrong and fatal: if
 * the local machine acts on the raw mouse and everybody else acts on the
 * rounded copy, the fight has already forked on the first frame, and no
 * amount of correct networking underneath will put it back together.
 */
export class InputFrame {
  constructor(buttons = 0, yaw = 0, pitch = 0, zoom = 0, dash = 0) {
    /** One bit per action, in ACTION_BITS order. */
    this.buttons = buttons | 0;
    /** Look, in grid units. Signed 16-bit, so it survives any transport. */
    this.yaw = yaw | 0;
    this.pitch = pitch | 0;
    this.zoom = zoom | 0;
    /**
     * A double-tapped direction, or 0.
     * 1..6 for +x, -x, +y, -y, +z, -z — a dash is always one of six, so it
     * costs three bits rather than a vector.
     */
    this.dash = dash | 0;
  }

  /** Nothing pressed, nothing moved. What a dropped frame is filled with. */
  static idle() { return new InputFrame(); }

  /**
   * Read a live input manager into a frame.
   *
   * Quantising happens here, once, and everything downstream — the local
   * machine included — runs off the result.
   */
  static capture(input) {
    let buttons = 0;
    for (let i = 0; i < ACTION_BITS.length; i++) {
      if (input.isDown(ACTION_BITS[i])) buttons |= 1 << i;
    }
    const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * LOOK_SCALE)));
    let dash = 0;
    if (input.dash?.dir) {
      const d = input.dash.dir;
      // Whichever axis it is mostly along. A dash is one of six directions
      // by the time the body reads it anyway.
      const ax = Math.abs(d.x);
      const ay = Math.abs(d.y);
      const az = Math.abs(d.z);
      if (ax >= ay && ax >= az) dash = d.x >= 0 ? 1 : 2;
      else if (ay >= az) dash = d.y >= 0 ? 3 : 4;
      else dash = d.z >= 0 ? 5 : 6;
    }
    return new InputFrame(
      buttons,
      q(input.cameraLook?.yaw ?? 0),
      q(input.cameraLook?.pitch ?? 0),
      q(input.zoomDelta ?? 0),
      dash,
    );
  }

  /** As a plain array, which is the smallest thing JSON will carry. */
  toArray() { return [this.buttons, this.yaw, this.pitch, this.zoom, this.dash]; }

  static fromArray(a) {
    if (!a) return InputFrame.idle();
    return new InputFrame(a[0], a[1], a[2], a[3], a[4]);
  }

  equals(o) {
    return !!o && this.buttons === o.buttons && this.yaw === o.yaw
      && this.pitch === o.pitch && this.zoom === o.zoom && this.dash === o.dash;
  }
}

const DASH_DIRS = [
  null,
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * An input manager's face, driven by frames instead of by a keyboard.
 *
 * The simulation asks an input for the same dozen things whether a person
 * or a wire is on the other end of it, so this answers all of them and the
 * body never learns the difference. Every player in a networked fight is
 * driven by one of these — including the one sitting at the keyboard, for
 * the reason in the note above.
 */
export class FrameInput {
  constructor(profile = {}) {
    this.profile = { invertY: false, invertStrafe: false, ...profile };
    this.move = new THREE.Vector3();
    this.moveRaw = new THREE.Vector3();
    this.intensity = 0;
    this.look = { yaw: 0, pitch: 0 };
    this.cameraLook = { yaw: 0, pitch: 0 };
    this.lookMagnitude = 0;
    this.zoomDelta = 0;
    this.dash = null;
    this.time = 0;
    this.enabled = true;
    this.pointerLocked = true;
    this._bits = 0;
    this._was = 0;
    /** Actions used up this step, so a consume fires once like the real one. */
    this._spent = new Set();
  }

  /** Feed one step. Everything the simulation reads is set from this. */
  apply(frame, dt = 1 / 60) {
    const f = frame ?? InputFrame.idle();
    this.time += dt;
    this._was = this._bits;
    this._bits = f.buttons | 0;
    this._spent.clear();

    const strafe = this.profile.invertStrafe ? -1 : 1;
    const ax = ((this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0)) * strafe;
    const ay = (this.isDown('up') ? 1 : 0) - (this.isDown('down') ? 1 : 0);
    const az = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    this.moveRaw.set(ax, ay, az);
    // Horizontal only, exactly as the live manager does it: diagonal is not
    // a way to move faster, but vertical thrust is its own channel.
    const h = Math.hypot(ax, az);
    if (h > 1) this.move.set(ax / h, ay, az / h);
    else this.move.set(ax, ay, az);
    this.intensity = Math.min(1, Math.hypot(this.move.x, this.move.y, this.move.z));

    this.cameraLook.yaw = f.yaw / LOOK_SCALE;
    this.cameraLook.pitch = f.pitch / LOOK_SCALE;
    this.look.yaw = this.cameraLook.yaw;
    this.look.pitch = this.cameraLook.pitch;
    this.lookMagnitude = Math.min(1, Math.hypot(this.cameraLook.yaw, this.cameraLook.pitch) * 6);
    this.zoomDelta = f.zoom / LOOK_SCALE;

    const dir = DASH_DIRS[f.dash];
    this.dash = dir ? { dir: new THREE.Vector3().fromArray(dir), t: this.time } : null;
    return this;
  }

  _bit(action) {
    const i = ACTION_BITS.indexOf(action);
    return i < 0 ? 0 : 1 << i;
  }

  isDown(action) { return (this._bits & this._bit(action)) !== 0; }

  /** True on the step the key went down, and not after. */
  wasPressed(action) {
    const b = this._bit(action);
    return (this._bits & b) !== 0 && (this._was & b) === 0;
  }

  /**
   * A press, taken once.
   *
   * The live manager buffers these across a short window so a key pressed a
   * frame early still counts. A frame stream has no such slack and needs
   * none — the frame it was pressed on is the frame it is played on, on
   * every machine.
   */
  consume(action) {
    if (this._spent.has(action)) return false;
    if (!this.wasPressed(action)) return false;
    this._spent.add(action);
    return true;
  }

  clearState() {
    this._bits = 0;
    this._was = 0;
    this._spent.clear();
    this.move.set(0, 0, 0);
    this.moveRaw.set(0, 0, 0);
    this.intensity = 0;
    this.cameraLook.yaw = this.cameraLook.pitch = 0;
    this.look.yaw = this.look.pitch = 0;
    this.zoomDelta = 0;
    this.dash = null;
    return this;
  }

  // The live manager owns a pointer and a keyboard; this owns neither, and
  // says so by doing nothing rather than by not having the method.
  setEnabled(on) { this.enabled = !!on; return this; }

  exitPointerLock() { return this; }
}
