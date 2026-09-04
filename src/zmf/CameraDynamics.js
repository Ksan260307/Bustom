import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep } from './math.js';

// ============================================================
//  ZMF §7 : Camera Dynamics
//    target-leading gaze, G-force tilt, collision-avoidance priority
//    panning, view-residual inertia (camera ghosting).
// ============================================================

const _desired = new THREE.Vector3();
const _gaze = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _boom = new THREE.Vector3();
const _boomUp = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _line = new THREE.Vector3();
const _side = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Steepest the camera boom may tilt, as a sine of the angle from horizontal. */
const BOOM_TILT_CAP = 0.35;

export class CameraDynamics {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(0, 4, -10);
    this.gaze = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);

    this.baseFov = 62;
    this.fov = this.baseFov;
    /**
     * Scope factor. The camera owns the field of view — it pumps it with
     * speed and thrust every frame — so a weapon that wants to zoom has to
     * ask HERE rather than writing cam.fov behind the rig's back, or the two
     * fight and the rig wins on the next frame.
     */
    this.scope = 1;
    this.roll = 0;
    this.shake = new THREE.Vector3();
    this.shakeAmount = 0;
    /**
     * How much of the movement to keep, 0..1.
     *
     * The game is sold on how it moves, which is exactly why there has to
     * be a way down. Set from the options screen, or from the operating
     * system's own reduced-motion setting when the player has not chosen.
     */
    this.motionScale = 1;

    /**
     * Player-driven boom offset, in radians around the machine. Held while
     * the camera modifier is down; while travelling it eases back behind the
     * machine, because a chase cam that stays sideways is a chase cam you
     * cannot drive with. Standing still it holds, so you can look yourself over.
     */
    this.orbit = { yaw: 0, pitch: 0 };
    /** Boom length multiplier. 1 = the distance `fitTo` chose for this build. */
    this.zoom = 1;

    /** Exported to the HUD / post pass. */
    this.vfx = { chroma: 0, speedLines: 0, fovPump: 0 };

    this.config = {
      distance: 7.4,
      height: 2.35,
      shoulder: 0.0,
      /** Camera ghosting half-lives. Position lags more than the gaze. */
      posHalfLife: 0.085,
      gazeHalfLife: 0.055,
      leadDistance: 5.5,
      /** Collision-avoidance gaze split, per §7.2. */
      avoidBias: 0.7,
      /** Limits for the player-driven boom. */
      zoomMin: 0.42,
      zoomMax: 2.8,
      orbitYawLimit: Math.PI,        // all the way around
      orbitPitchLimit: 1.15,         // ~66°, short of straight over the top
      /** How fast the boom eases back behind the machine, per unit of speed. */
      recenterRate: 2.4,
      /**
       * How the camera reframes once there is a fight on.
       *
       * A chase cam is a driving camera: it sits on the tail, looks where
       * the nose is going, and puts the machine dead centre. Every one of
       * those is wrong for a gunfight. The target ends up directly BEHIND
       * the machine on screen, the rounds crossing the gap are seen almost
       * end-on, and the one thing the player needs to read — where the shot
       * went and what is coming back — is the one thing hidden by their own
       * machine.
       *
       * So with a target locked the boom lines itself up along the firing
       * line, steps off it to one side, and lifts. The gap between the two
       * machines opens across the screen instead of into it, and the rounds
       * travel across the frame where they can be seen and dodged.
       */
      combat: {
        /** How far along the line to the target the camera looks. */
        gazeBias: 0.40,
        /** How firmly the boom lines up behind the firing line, 0..1. */
        align: 0.85,
        /** Step off that line, as a fraction of the boom length. */
        shoulder: 0.34,
        /** And up, as a fraction of the boom's own height. */
        lift: 0.60,
        /** Range at which the boom has opened out by `open`. */
        openAt: 45,
        open: 0.5,
        /** How fast the framing changes when a lock comes or goes. */
        halfLife: 0.30,
      },
    };
    /** 0..1, how far into the combat framing we are. */
    this.engage = 0;
    this._framed = false;
  }

  /**
   * Rescale the boom for the size of the machine.
   *
   * This was `4.6 × clamp(extent/2.8, 0.7, 1.8) + 3.4`, which put the camera
   * 10.9 metres behind a machine 19.7 metres tall — barely half its own
   * height, so a siege frame filled the whole frame and you could not see
   * the fight it was in. Three things were wrong: the clamp ran out, the
   * relationship was mostly a constant with a small size term added, and
   * `extent` is a core-relative half-size rather than a height (that same
   * nineteen-metre machine reports 4.6).
   *
   * Proportional to the machine's REAL height, with a floor so small
   * machines are not pushed away from the camera.
   *
   * @param {object} stats
   * @param {number} [height] the built machine's height, when it is known
   */
  fitTo(stats, height = 0) {
    const size = height > 0 ? height : stats.extent * 3.2;
    this.config.distance = clamp(size * 1.55, 6.4, 46);
    this.config.height = clamp(size * 0.34, 1.7, 11);
    this.baseFov = 60 + stats.agility * 8;
  }

  /**
   * Swing the boom around the machine. Arguments are angle deltas in radians
   * for this frame, not rates: the boom tracks the hand rather than being
   * flown, so it must not scale with dt a second time.
   */
  orbitBy(dYaw, dPitch) {
    if (!dYaw && !dPitch) return this;
    const c = this.config;
    this.orbit.yaw = clamp(this.orbit.yaw + dYaw, -c.orbitYawLimit, c.orbitYawLimit);
    this.orbit.pitch = clamp(this.orbit.pitch + dPitch, -c.orbitPitchLimit, c.orbitPitchLimit);
    return this;
  }

  /** Positive pulls the camera out, negative pushes it in. Multiplicative, so
   *  a notch of wheel feels the same at every distance. */
  zoomBy(delta) {
    if (!delta) return this;
    this.zoom = clamp(this.zoom * Math.exp(delta), this.config.zoomMin, this.config.zoomMax);
    return this;
  }

  /** Put the boom straight back behind the machine. */
  recenter() {
    this.orbit.yaw = 0;
    this.orbit.pitch = 0;
    return this;
  }

  /** Put the boom where it belongs right now, with no easing. */
  snap(position, forward) {
    this.engage = 0;
    _tmp.copy(forward).multiplyScalar(-this.config.distance * this.zoom);
    this.position.copy(position).add(_tmp);
    this.position.y += this.config.height;
    this.gaze.copy(position);
    this._framed = true;
  }

  /**
   * @param {object} p
   * @param {THREE.Vector3} p.position     machine position
   * @param {THREE.Vector3} p.forward
   * @param {THREE.Vector3} p.up
   * @param {THREE.Vector3} p.velocity
   * @param {THREE.Vector3} p.accel
   * @param {THREE.Vector3|null} p.aimPoint
   * @param {number} p.jerk
   * @param {number} p.bank
   * @param {{normal:THREE.Vector3}|null} p.avoid   imminent-collision contact
   * @param {number} p.thrust  0..1
   * @param {number} p.grounded 0..1 ground contact
   * @param {boolean} [p.orbiting]  the player is holding the camera modifier
   */
  update(p, dt) {
    if (!this._framed) this.snap(p.position, p.forward);

    const speed = p.velocity.length();
    const speedN = clamp01(speed / 34);
    const cbt = this.config.combat;

    // How much of the combat framing to apply. Driven by whether there IS a
    // target rather than by how hard the assist is pulling: the assist backs
    // off the moment the player looks away by hand, and a camera that
    // reframed every time they did would be unusable.
    this.engage = damp(this.engage, p.aimPoint ? 1 : 0, cbt.halfLife, dt);
    const engage = this.engage;

    // ---------------------------------------------------- gaze
    // Look at the machine, biased toward wherever it is about to be. The
    // nose-lead is a driving aid, so it gives way to the fight.
    _gaze.copy(p.position).addScaledVector(
      p.forward, this.config.leadDistance * (0.35 + speedN * 0.9) * (1 - engage * 0.85),
    );

    if (p.aimPoint && engage > 0.001) {
      // Look down the firing line rather than at either end of it. Short of
      // the middle, so the machine keeps the near half of the frame and the
      // target sits ahead of it with the gap between them on screen.
      _tmp.copy(p.position).lerp(p.aimPoint, cbt.gazeBias);
      _gaze.lerp(_tmp, engage);
    }

    // While planted on the ground the machine must stay in frame. A target
    // high overhead would otherwise drag the gaze off the top of the screen
    // and leave the player flying blind on their own footing.
    if ((p.grounded ?? 0) > 0.5) {
      const ceiling = p.position.y + this.config.distance * 0.9;
      if (_gaze.y > ceiling) _gaze.y = ceiling;
    }

    // §7.2 collision-avoidance priority panning, 7:3 in favour of the escape.
    if (p.avoid) {
      _tmp.copy(p.position).addScaledVector(p.avoid.normal, 9);
      _gaze.lerp(_tmp, this.config.avoidBias * clamp01(p.avoidUrgency ?? 0.6));
    }

    // Swung off the tail, the lead point drifts out of frame — pull the gaze
    // back onto the machine itself in proportion to how far round we are.
    const swing = clamp01(Math.abs(this.orbit.yaw) / 1.2 + Math.abs(this.orbit.pitch) / 1.4);
    if (swing > 0) _gaze.lerp(p.position, swing * 0.85);

    this.gaze.x = damp(this.gaze.x, _gaze.x, this.config.gazeHalfLife, dt);
    this.gaze.y = damp(this.gaze.y, _gaze.y, this.config.gazeHalfLife, dt);
    this.gaze.z = damp(this.gaze.z, _gaze.z, this.config.gazeHalfLife, dt);

    // ---------------------------------------------------- boom position
    // The boom only partly follows pitch. A chase cam welded to the nose ends
    // up directly overhead the moment the machine dives, which is exactly the
    // spatial disorientation the whole model exists to avoid.
    _boom.copy(p.forward);
    _boom.y *= 0.42;
    if (Math.hypot(_boom.x, _boom.z) < 1e-4) _boom.set(0, _boom.y, 1);
    _boom.normalize();

    // Hard cap on how steep the boom may get. Scaling pitch alone is not
    // enough: at a near-vertical dive even 42% of it still swings the camera
    // overhead, and a top-down view is exactly what we are avoiding.
    if (Math.abs(_boom.y) > BOOM_TILT_CAP) {
      const sign = Math.sign(_boom.y);
      const h = Math.hypot(_boom.x, _boom.z) || 1;
      const want = Math.sqrt(1 - BOOM_TILT_CAP * BOOM_TILT_CAP) / h;
      _boom.x *= want;
      _boom.z *= want;
      _boom.y = sign * BOOM_TILT_CAP;
    }

    // Line the boom up behind the FIRING line, not behind the nose. On the
    // ground the two mostly agree — the machine turns to face what it is
    // shooting — but the moment it strafes, or fights something above it,
    // they come apart, and it is the firing line that the player needs to
    // see down.
    let range = 0;
    if (p.aimPoint && engage > 0.001) {
      _line.copy(p.aimPoint).sub(p.position);
      range = _line.length();
      _line.y = 0;
      if (_line.lengthSq() > 1e-6) {
        _line.normalize();
        _boom.lerp(_line, cbt.align * engage);
        if (_boom.lengthSq() < 1e-8) _boom.copy(_line);
        _boom.normalize();
      }
    }

    // The player's own swing goes on AFTER the cap: the cap exists to stop
    // the machine's pitch from throwing the view around, not to overrule a
    // deliberate look.
    if (this.orbit.yaw) _boom.applyAxisAngle(WORLD_UP, this.orbit.yaw);
    if (this.orbit.pitch) {
      _axis.set(_boom.z, 0, -_boom.x);
      if (_axis.lengthSq() > 1e-8) {
        _boom.applyAxisAngle(_axis.normalize(), this.orbit.pitch);
        // Never quite straight over the top: `lookAt` has no answer there.
        if (Math.abs(_boom.y) > 0.94) {
          const sign = Math.sign(_boom.y);
          const h = Math.hypot(_boom.x, _boom.z) || 1;
          const want = Math.sqrt(1 - 0.94 * 0.94) / h;
          _boom.x *= want; _boom.z *= want; _boom.y = sign * 0.94;
        }
      }
    }

    // Ease the swing back behind the machine, at a rate set by how fast we
    // are actually travelling. At a standstill it stays where you put it.
    if (!p.orbiting && (this.orbit.yaw || this.orbit.pitch)) {
      const k = Math.exp(-this.config.recenterRate * speedN * dt);
      this.orbit.yaw *= k;
      this.orbit.pitch *= k;
      if (Math.abs(this.orbit.yaw) < 1e-4) this.orbit.yaw = 0;
      if (Math.abs(this.orbit.pitch) < 1e-4) this.orbit.pitch = 0;
    }

    // Likewise the boom rises along an axis that is mostly world-up, so the
    // horizon stays roughly where the player left it.
    _boomUp.copy(WORLD_UP).lerp(p.up, 0.35).normalize();

    // Open the boom out with the range, so a fight at forty metres has both
    // machines in the frame rather than one of them and a dot.
    const open = 1 + engage * clamp01(range / cbt.openAt) * cbt.open;
    const dist = this.config.distance * this.zoom * (1 + speedN * 0.30) * open;
    _desired.copy(p.position)
      .addScaledVector(_boom, -dist)
      .addScaledVector(_boomUp, this.config.height * (1 + engage * cbt.lift))
      .addScaledVector(p.right ?? WORLD_UP, this.config.shoulder);

    // Step off the firing line. Straight down it the machine sits directly
    // in front of what it is shooting at and hides it; a pace to the side
    // separates the two across the screen and turns the gap between them
    // into something the player can read a round crossing.
    if (engage > 0.001) {
      _side.crossVectors(WORLD_UP, _boom);
      if (_side.lengthSq() > 1e-8) {
        _desired.addScaledVector(_side.normalize(), dist * cbt.shoulder * engage);
      }
    }

    // Pull the boom back along the velocity vector a touch — the machine
    // drifts forward in frame under acceleration, which is where the
    // sensation of being pushed comes from.
    _desired.addScaledVector(p.velocity, -0.055);

    // Never let the camera clip through the floor.
    const floor = (p.groundY ?? 0) + 0.9;
    if (_desired.y < floor) _desired.y = floor;

    // §7 camera ghosting: the boom is a lagged follower, not a rigid arm.
    const hl = this.config.posHalfLife * (1 + speedN * 0.5);
    this.position.x = damp(this.position.x, _desired.x, hl, dt);
    this.position.y = damp(this.position.y, _desired.y, hl * 1.25, dt);
    this.position.z = damp(this.position.z, _desired.z, hl, dt);

    // ---------------------------------------------------- G-force tilt + roll
    _tmp.copy(p.accel);
    const lateralG = _tmp.dot(p.right ?? WORLD_UP);
    const rollTarget = p.bank * 0.55 + clamp(-lateralG * 0.010, -0.22, 0.22);
    this.roll = damp(this.roll, rollTarget, 0.13, dt);

    _up.copy(p.up).lerp(WORLD_UP, 0.55).normalize();
    _tmp2.copy(this.gaze).sub(this.position).normalize();
    _up.applyAxisAngle(_tmp2, this.roll).normalize();
    this.up.lerp(_up, clamp01(dt * 12)).normalize();

    // ---------------------------------------------------- FOV pumping
    const pump = clamp01(p.jerk / 260);
    const fovTarget = (this.baseFov
      + (speedN * 9 + p.thrust * 4.5 + pump * 5.5) * this.motionScale) * this.scope;
    this.fov = damp(this.fov, fovTarget, 0.14, dt);

    // ---------------------------------------------------- shake
    //
    // `motionScale` is 1 normally and 0 when the player has asked for less
    // movement. It multiplies the shake, the FOV pump and the speed lines
    // rather than switching them off in three places, so "reduced" can
    // later mean "a quarter" without touching any of this.
    this.shakeAmount = damp(this.shakeAmount, clamp01(p.jerk / 320) * 0.55 + (p.impact ?? 0), 0.09, dt);
    const a = this.shakeAmount * 0.34 * this.motionScale;
    if (a > 0.0005) {
      const t = performance.now() * 0.001;
      this.shake.set(
        Math.sin(t * 63.1) * a, Math.sin(t * 71.7 + 1.7) * a, Math.sin(t * 55.3 + 3.1) * a,
      );
    } else this.shake.set(0, 0, 0);

    // ---------------------------------------------------- exported VFX
    this.vfx.chroma = damp(this.vfx.chroma,
      clamp01(p.thrust * 0.7 + speedN * 0.5) ** 2 * this.motionScale, 0.12, dt);
    this.vfx.speedLines = damp(this.vfx.speedLines,
      clamp01(pump * 1.3 + smoothstep(0.55, 1, speedN) * 0.7) * this.motionScale, 0.10, dt);
    this.vfx.fovPump = pump * this.motionScale;

    // ---------------------------------------------------- commit
    const cam = this.camera;
    cam.position.copy(this.position).add(this.shake);
    cam.up.copy(this.up);
    cam.lookAt(this.gaze);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    return cam;
  }
}
