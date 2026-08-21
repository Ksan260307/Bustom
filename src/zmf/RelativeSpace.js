import * as THREE from 'three';
import { clamp01, smoothstep } from './math.js';

// ============================================================
//  ZMF §5 : Relative Space Mapper
//    transition-blended frame locking.
//
//  Near a large moving object the machine stops being measured against
//  the world and starts being measured against that object. The 0.3-0.5s
//  blend is the whole trick: snapping frames is a teleport, blending them
//  is the sensation of being caught by something big.
// ============================================================

const _tmp = new THREE.Vector3();

export class RelativeSpaceMapper {
  constructor() {
    /** @type {Array<{id:string, object:{position:THREE.Vector3, velocity:THREE.Vector3}, radius:number, influence:number}>} */
    this.frames = [];
    this.active = null;
    this.blend = 0;
    /** Velocity carried by the currently blended reference frame. */
    this.frameVelocity = new THREE.Vector3();
    this.blendDuration = 0.42; // within the specified 0.3-0.5s window
  }

  register(id, object, radius, influence = radius * 2.6) {
    this.frames.push({ id, object, radius, influence });
  }

  clear() { this.frames.length = 0; this.active = null; this.blend = 0; this.frameVelocity.set(0, 0, 0); }

  /**
   * Pick the dominant frame and slide the blend toward it.
   * @returns {number} blend weight, 0..1
   */
  update(selfPos, dt) {
    let best = null;
    let bestWeight = 0;

    for (const f of this.frames) {
      const d = _tmp.copy(f.object.position).sub(selfPos).length();
      const w = 1 - smoothstep(f.radius * 1.05, f.influence, d);
      if (w > bestWeight) { bestWeight = w; best = f; }
    }

    if (best !== this.active) {
      // Any change of frame restarts the blend from where it currently is,
      // so rapid entry/exit never produces a discontinuity.
      this.active = best;
    }

    const step = dt / this.blendDuration;
    const target = best ? bestWeight : 0;
    this.blend += Math.sign(target - this.blend) * Math.min(step, Math.abs(target - this.blend));
    this.blend = clamp01(this.blend);

    if (this.active && this.blend > 0) {
      this.frameVelocity.copy(this.active.object.velocity ?? _tmp.set(0, 0, 0)).multiplyScalar(this.blend);
    } else {
      this.frameVelocity.multiplyScalar(Math.pow(0.05, dt));
    }

    return this.blend;
  }

  /** Convert a world velocity into the blended reference frame. */
  toFrame(velocity, out = new THREE.Vector3()) {
    return out.copy(velocity).sub(this.frameVelocity);
  }
}
