import * as THREE from 'three';
import { clamp01 } from '../zmf/math.js';

// ============================================================
//  Debris : what is left when a machine loses.
//
//  The pieces are the machine's own parts — same geometry, same colours,
//  caught at the transform they were wearing when it died. A generic puff
//  of cubes would throw away the one thing this game has: the player can
//  see their own build coming apart.
//
//  Nothing here owns the part geometry, so the rig must outlive the burst.
//  FieldScene clears the debris whenever it disposes a machine.
// ============================================================

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const rand = (a, b) => a + Math.random() * (b - a);

function randomAxis(out) {
  return out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
}

export class Debris {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./World.js').World} world
   */
  constructor(scene, world, { maxPieces = 120, blasts = 6 } = {}) {
    this.scene = scene;
    this.world = world;
    this.maxPieces = maxPieces;

    this.group = new THREE.Group();
    this.group.name = 'debris';
    scene.add(this.group);

    /** @type {Array<object>} live chunks and sparks */
    this.pieces = [];
    /** Cloned, fade-capable copies of the rig's materials, by source. */
    this._materials = new Map();
    this._owned = [];

    // ---- shared assets for the blast itself
    this.sparkGeo = new THREE.BoxGeometry(1, 1, 1);
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffd7a0, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.flashGeo = new THREE.IcosahedronGeometry(1, 2);
    this.ringGeo = new THREE.TorusGeometry(1, 0.045, 8, 48);
    this.ringGeo.rotateX(-Math.PI / 2);

    this.blasts = [];
    for (let i = 0; i < blasts; i++) this.blasts.push(this._makeBlast());
  }

  _makeBlast() {
    const mk = (geo, color, side) => {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, side,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this._owned.push(mat);
      return mesh;
    };
    return {
      life: 0,
      maxLife: 1,
      scale: 1,
      core: mk(this.flashGeo, 0xffffff, THREE.FrontSide),
      shell: mk(this.flashGeo, 0xff9a4c, THREE.BackSide),
      ring: mk(this.ringGeo, 0xffd7a0, THREE.DoubleSide),
    };
  }

  /** A fading copy of a rig material, made once per source per session. */
  _fadeMaterial(src) {
    if (this._materials.has(src)) return this._materials.get(src);
    const m = src.clone();
    m.transparent = true;
    m.opacity = 1;
    m.depthWrite = true;
    this._materials.set(src, m);
    this._owned.push(m);
    return m;
  }

  // ---------------------------------------------------------- the burst

  /**
   * Blow a machine apart. The caller is expected to hide the machine itself
   * on the same frame — this only produces the wreckage.
   *
   * @param {import('./Robot.js').Robot} robot
   * @param {{power?: number, sparks?: number}} [opts]
   */
  burst(robot, { power = 1, sparks = 18 } = {}) {
    robot.object3D.updateMatrixWorld(true);
    const centre = _v.copy(robot.position).clone();
    // Half the machine's extent: a fireball measured off the full bounding
    // radius came out the size of the arena.
    const scale = Math.max(0.6, (robot.stats?.extent ?? 2) * 0.5);

    this._blast(centre, scale * power);

    // ---- the parts themselves
    const sources = robot.rig?.pickables ?? [];
    for (const src of sources) {
      if (this.pieces.length >= this.maxPieces) break;
      if (!src.geometry || !src.material) continue;
      src.updateWorldMatrix(true, false);

      const mesh = new THREE.Mesh(src.geometry, this._fadeMaterial(src.material));
      src.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);

      // Outward from the core, with a lift so the wreck opens up rather
      // than collapsing straight down into the floor.
      _v.copy(mesh.position).sub(centre);
      const d = _v.length();
      if (d < 1e-3) randomAxis(_v); else _v.divideScalar(d);

      const vel = _v.clone()
        .multiplyScalar(rand(3.5, 9) * power)
        .addScaledVector(UP, rand(2.5, 7) * power)
        .addScaledVector(robot.velocity ?? UP.clone().set(0, 0, 0), 0.35);

      this.pieces.push({
        mesh,
        vel,
        axis: randomAxis(new THREE.Vector3()),
        spin: rand(3, 11) * (Math.random() < 0.5 ? -1 : 1),
        life: rand(3.2, 4.6),
        fade: 1.1,
        spark: false,
      });
    }

    // ---- sparks: fast, weightless, gone before the chunks land
    for (let i = 0; i < sparks; i++) {
      if (this.pieces.length >= this.maxPieces) break;
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      mesh.position.copy(centre);
      mesh.frustumCulled = false;
      const k = rand(0.06, 0.16) * scale;
      mesh.scale.set(k, k, k * rand(3, 9));
      this.group.add(mesh);

      const dir = randomAxis(new THREE.Vector3());
      dir.y = Math.abs(dir.y) * 0.6 + 0.15;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

      this.pieces.push({
        mesh,
        vel: dir.clone().multiplyScalar(rand(14, 34) * power),
        axis: UP.clone(),
        spin: 0,
        life: rand(0.25, 0.6),
        fade: 0.6,
        spark: true,
      });
    }
    return this;
  }

  /**
   * A flash on its own, with no wreck behind it — what a grenade leaves.
   * Same effect the destruction burst uses, so explosions all read alike.
   */
  blast(at, scale = 1) { return this._blast(at, scale); }

  _blast(at, scale) {
    const b = this.blasts.find((x) => x.life <= 0) ?? this.blasts[0];
    b.life = 0.55;
    b.maxLife = 0.55;
    b.scale = scale;
    for (const mesh of [b.core, b.shell, b.ring]) {
      mesh.position.copy(at);
      mesh.visible = true;
    }
    b.ring.position.y = (this.world?.groundHeight?.(at.x, at.z) ?? 0) + 0.12;
    return b;
  }

  // ---------------------------------------------------------- per frame

  update(dt) {
    const g = this.world?.gravity ?? 22;

    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        this.pieces.splice(i, 1);
        continue;
      }

      if (!p.spark) {
        p.vel.y -= g * dt;
        if (p.spin) {
          _axis.copy(p.axis);
          p.mesh.quaternion.premultiply(_q.setFromAxisAngle(_axis, p.spin * dt));
        }
      }
      p.mesh.position.addScaledVector(p.vel, dt);

      if (!p.spark) {
        // Settle on the floor rather than sinking through it.
        const floor = (this.world?.groundHeight?.(p.mesh.position.x, p.mesh.position.z) ?? 0) + 0.12;
        if (p.mesh.position.y < floor) {
          p.mesh.position.y = floor;
          p.vel.y = Math.abs(p.vel.y) * 0.32;
          p.vel.x *= 0.66;
          p.vel.z *= 0.66;
          p.spin *= 0.55;
          if (Math.abs(p.vel.y) < 0.6) p.vel.y = 0;
        }
      }

      // Sparks share one material, so their fade is driven by the youngest.
      const a = clamp01(p.life / p.fade);
      if (!p.spark) p.mesh.material.opacity = a;
    }

    // one shared spark material: fade it with whatever is still burning
    let sparkAlpha = 0;
    for (const p of this.pieces) {
      if (p.spark) sparkAlpha = Math.max(sparkAlpha, clamp01(p.life / p.fade));
    }
    this.sparkMat.opacity = sparkAlpha;

    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = 1 - clamp01(b.life / b.maxLife);
      if (b.life <= 0) {
        for (const mesh of [b.core, b.shell, b.ring]) mesh.visible = false;
        continue;
      }
      // The core snaps out and dies; the shell and the ring keep going.
      const core = clamp01(t / 0.22);
      b.core.scale.setScalar(b.scale * (0.4 + core * 1.4));
      b.core.material.opacity = (1 - core) ** 1.6;

      b.shell.scale.setScalar(b.scale * (0.7 + t * 1.7));
      b.shell.material.opacity = (1 - t) ** 2.2 * 0.5;

      // The shockwave outruns the fireball, which is what sells the scale.
      b.ring.scale.setScalar(b.scale * (0.5 + t * 2.8));
      b.ring.material.opacity = (1 - t) ** 2 * 0.85;
    }
    return this;
  }

  get pieceCount() { return this.pieces.length; }
  get blastCount() { return this.blasts.filter((b) => b.life > 0).length; }
  get active() { return this.pieceCount > 0 || this.blastCount > 0; }

  clear() {
    for (const p of this.pieces) this.group.remove(p.mesh);
    this.pieces.length = 0;
    for (const b of this.blasts) {
      b.life = 0;
      for (const mesh of [b.core, b.shell, b.ring]) mesh.visible = false;
    }
    return this;
  }

  dispose() {
    this.clear();
    for (const m of this._owned) m.dispose();
    this._materials.clear();
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
    this.flashGeo.dispose();
    this.ringGeo.dispose();
    this.group.removeFromParent();
  }
}
