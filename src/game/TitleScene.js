import * as THREE from 'three';
import { Rig } from '../core/Rig.js';
import { makeSky, makeSkyline, FIELD_SKY } from './Sky.js';

// ============================================================
//  The title backdrop: the player's own machine, lit, on a slow turntable.
//
//  Deliberately NOT the arena. The arena carries three opponents, physics,
//  weapons and a HUD, and none of that is doing anything behind a menu — it
//  would be a running fight nobody can see or affect. What this needs is one
//  machine, a floor and a light, so that is all it builds.
//
//  It shows the machine you actually have. A title screen with a stock robot
//  on it is a picture; a title screen with YOUR robot on it is the reason to
//  press the first button.
// ============================================================

/** Seconds for one full turn of the stand. */
const TURN_SECONDS = 26;

export class TitleScene {
  constructor({ renderer, post }) {
    this.renderer = renderer;
    this.post = post;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.time = 0;
    this.active = false;

    /** The machine, on a group that spins so the rig itself stays untouched. */
    this.stand = new THREE.Group();
    this.scene.add(this.stand);
    this.rig = null;

    this._buildStage();
  }

  _buildStage() {
    const scene = this.scene;

    this.sky = makeSky(this.renderer, FIELD_SKY);
    scene.background = this.sky.texture;
    scene.environment = this.sky.environment;
    scene.backgroundIntensity = 0.5;

    // A disc rather than the arena's whole floor, but wide enough that its
    // edge falls outside the frame: a visible rim reads as the world ending
    // a few metres behind the machine.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(70, 72),
      new THREE.MeshStandardMaterial({
        color: 0x0b1119, roughness: 0.62, metalness: 0.15,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 5.7, 96),
      new THREE.MeshBasicMaterial({
        color: 0x4fd2ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
    this.ring = ring;

    // Far enough to read as distance, close enough to stand ON the floor
    // rather than float above its edge.
    this.skyline = makeSkyline(62, { count: 30 });
    scene.add(this.skyline);

    scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x2c3646, 0.55));

    const key = new THREE.DirectionalLight(0xfff2e2, 2.6);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const d = 9;
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x6fc7ff, 1.5);
    rim.position.set(-7, 4, -6);
    scene.add(rim);

    this._owned = [floor.geometry, floor.material, ring.geometry, ring.material];
  }

  /**
   * Show this machine. Called on the way in, so the title always reflects
   * whatever is on the workbench right now.
   */
  load(assembly) {
    this._dropRig();
    this.rig = new Rig(assembly.clone());
    this.stand.add(this.rig.root);
    // Stand it on the floor rather than through it, whatever it is built of.
    this.rig.root.position.y = -this.rig.restLowestY;

    // Frame it by its own size: a four-metre walker and a twelve-metre one
    // should both fill about the same amount of screen.
    const reach = Math.max(2.2, this.rig.boundingRadius);
    this.camDistance = reach * 3.2 + 2.4;
    this.camHeight = Math.max(1.6, this.rig.restHeight * 0.62);
    /**
     * How far the camera looks PAST the machine, which slides the machine
     * across to the right of the frame. The menu sits on the left, and a
     * machine centred behind it is a machine nobody can see.
     */
    this.camPan = reach * 0.62;
    this.ring.scale.setScalar(Math.max(0.75, reach / 3.4));
    return this;
  }

  _dropRig() {
    if (!this.rig) return;
    this.rig.root.removeFromParent();
    this.rig.dispose();
    this.rig = null;
  }

  enter() { this.active = true; return this; }

  exit() { this.active = false; return this; }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Turn the stand and drift the camera. Runs on real elapsed time — there
   * is no fight here to keep honest, only something to look at.
   */
  update(dt) {
    this.time += dt;
    this.stand.rotation.y = (this.time / TURN_SECONDS) * Math.PI * 2;

    const dist = this.camDistance ?? 9;
    const sway = Math.sin(this.time * 0.24) * 0.09;
    this.camera.position.set(
      Math.sin(sway) * dist,
      (this.camHeight ?? 2.4) + Math.sin(this.time * 0.33) * 0.35,
      Math.cos(sway) * dist,
    );
    this.camera.lookAt(-(this.camPan ?? 0), (this.camHeight ?? 2.4) * 0.62, 0);

    if (this.ring) {
      this.ring.material.opacity = 0.32 + Math.sin(this.time * 1.1) * 0.1;
    }
    return this;
  }

  render() {
    this.post.render(this.scene, this.camera);
    return this;
  }

  dispose() {
    this._dropRig();
    for (const item of this._owned) item.dispose?.();
    this.sky.dispose();
    return this;
  }
}
