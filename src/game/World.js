import * as THREE from 'three';
import { makeSky, makeSkyline, FIELD_SKY } from './Sky.js';

// ============================================================
//  Debug arena : a flat plane, a ring wall, and a handful of
//  pillars to exercise the environment-interference module.
// ============================================================

const _size = new THREE.Vector3();

export class World {
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.gravity = 22;
    this.arenaRadius = 120;
    this.ceiling = 95;
    /** @type {THREE.Box3[]} */
    this.colliders = [];
    /**
     * The pillars, as things that can be worn down.
     *
     * Cover that can never be taken away is a place to stand and win from;
     * cover that runs out is a decision about when to leave it.
     * @type {{mesh: THREE.Object3D[], box: THREE.Box3, hp: number, maxHp: number}[]}
     */
    this.pillars = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._build();
  }

  groundHeight() { return 0; }

  /**
   * Wear down whatever piece of cover contains `point`.
   *
   * Returns the pillar that broke, or null. Everything that decides the
   * fight lives here rather than in the round that hit it, so the same
   * arena answers the same way in a replay.
   */
  damageCover(point, amount) {
    for (const pillar of this.pillars) {
      if (pillar.hp <= 0 || !pillar.box.containsPoint(point)) continue;
      pillar.hp -= amount;
      if (pillar.hp > 0) return null;
      for (const m of pillar.mesh) m.visible = false;
      const at = this.colliders.indexOf(pillar.box);
      if (at >= 0) this.colliders.splice(at, 1);
      return pillar;
    }
    return null;
  }

  /** Is this point inside a piece of cover that is still standing? */
  blocksAt(point) {
    for (const box of this.colliders) if (box.containsPoint(point)) return true;
    return false;
  }

  /** Put every pillar back. A new match is a new arena. */
  resetCover() {
    for (const pillar of this.pillars) {
      if (pillar.hp > 0) continue;
      pillar.hp = pillar.maxHp;
      for (const m of pillar.mesh) m.visible = true;
      if (!this.colliders.includes(pillar.box)) this.colliders.push(pillar.box);
    }
    return this;
  }

  /**
   * Point the shadow box at `at`.
   *
   * Called every frame with wherever the fight is. The box is a fraction of
   * the arena, so this is the difference between shadows near the middle
   * and shadows everywhere — and it buys sharper ones at the same cost,
   * since the same shadow map now covers a much smaller patch of floor.
   *
   * Output only: shadows have never decided anything.
   */
  focusShadows(at) {
    const key = this.keyLight;
    if (!key || !at) return this;
    key.position.copy(at).add(this.keyOffset);
    key.target.position.copy(at);
    key.target.updateMatrixWorld();
    return this;
  }

  _build() {
    const scene = this.scene;

    // ---- sky and the light it casts
    // The gradient is both what you see behind the arena and what every
    // metal surface reflects, so the two can never disagree.
    if (this.renderer) {
      this.sky = makeSky(this.renderer, FIELD_SKY);
      scene.background = this.sky.texture;
      scene.environment = this.sky.environment;
      // The sky is there to be reflected, not to light the frame: shown at
      // full strength it turns every dark corner into grey haze.
      scene.backgroundIntensity = 0.45;
    } else {
      scene.background = new THREE.Color(0x0a0e15);
    }
    // Fog matched to the horizon band, so distance dissolves into the sky
    // rather than into a flat wall of colour.
    scene.fog = new THREE.FogExp2(0x0b1521, 0.0062);

    // ---- lighting
    // Halved now that an environment map supplies the ambient — leaving
    // both at full strength double-lights everything and flattens it.
    const hemi = new THREE.HemisphereLight(0xb4d2ff, 0x39445c, 0.62);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2df, 2.25);
    /**
     * The light's offset from whatever it is lighting. Held fixed while the
     * light is moved around, so following the fight changes WHERE the
     * shadows are cast, never which way — a key light that swings as the
     * player walks makes the whole arena appear to rotate.
     */
    this.keyOffset = new THREE.Vector3(38, 62, 24);
    key.position.copy(this.keyOffset);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    /**
     * The shadow box. Small, because it follows: a box wide enough to cover
     * a 120m arena from a fixed origin spends its 2048 pixels on empty
     * floor, and everything more than forty metres out casts no shadow at
     * all — which is what "the machines have no shadows" actually was.
     */
    const d = 30;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 190;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.03;
    scene.add(key);
    scene.add(key.target);
    this.keyLight = key;

    // Two rims rather than one: a cold one behind and a warm one low to the
    // side. A single rim only ever separates the silhouette from one angle,
    // and the camera in this game is always moving.
    const rim = new THREE.DirectionalLight(0x6fd2ff, 1.25);
    rim.position.set(-30, 18, -40);
    scene.add(rim);

    // Kept faint and barely warm. Any more and it stops reading as a rim
    // and starts reading as a dirty floor.
    const warm = new THREE.DirectionalLight(0xffc9a8, 0.18);
    warm.position.set(-44, 8, 34);
    scene.add(warm);

    // ---- ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(this.arenaRadius, 96),
      new THREE.MeshStandardMaterial({
        color: 0x19212e, roughness: 0.66, metalness: 0.18, envMapIntensity: 0.55,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const grid = new THREE.GridHelper(this.arenaRadius * 2, 96, 0x4f9fd0, 0x1e2a38);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.position.y = 0.012;
    this.group.add(grid);

    // A lit ring at the arena edge: it tells you where the floor ends from
    // any distance, and it is the one line the bloom really wants.
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(this.arenaRadius - 1.1, this.arenaRadius, 128),
      new THREE.MeshBasicMaterial({
        color: 0x5fc8ff, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.05;
    this.group.add(edge);

    // finer grid near the origin, so slow precision work is readable
    const fine = new THREE.GridHelper(40, 80, 0x2a4a63, 0x223142);
    fine.material.transparent = true;
    fine.material.opacity = 0.35;
    fine.position.y = 0.018;
    this.group.add(fine);

    // ---- boundary ring
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.arenaRadius, this.arenaRadius, 26, 96, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x2c6c9a, transparent: true, opacity: 0.13, side: THREE.BackSide,
      }),
    );
    wall.position.y = 13;
    this.group.add(wall);

    // ---- pillars: obstacles for the repulsion / sliding tests
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x2b3646, roughness: 0.55, metalness: 0.45, envMapIntensity: 0.9,
    });
    // Pushed well past 1 on purpose: this is what the bright pass picks up,
    // and a strip lamp that does not spill light is not a lamp.
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x3fa0dd, emissive: 0x2b9ce0, emissiveIntensity: 2.1, roughness: 0.35, metalness: 0.6,
    });

    const layout = [
      [22, 0, 3.2, 16], [-26, 14, 2.6, 22], [8, -30, 3.8, 12],
      [-14, -22, 2.2, 26], [34, 26, 4.4, 18], [-38, -34, 3.0, 20],
      [0, 44, 5.0, 14], [46, -18, 2.4, 24],
    ];

    for (const [x, z, r, h] of layout) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, h, r * 2), pillarMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 2.25, 0.4, r * 2.25), accentMat);
      cap.position.set(x, h + 0.2, z);
      this.group.add(cap);

      const box = new THREE.Box3().setFromObject(m);
      this.colliders.push(box);
      // Bigger pillars stand up to more. A wall you can chew through in a
      // second is not cover, it is scenery with extra steps.
      box.getSize(_size);
      const bulk = _size.x * _size.z * h;
      this.pillars.push({
        mesh: [m, cap], box, hp: 60 + bulk * 2.4, maxHp: 60 + bulk * 2.4,
      });
    }

    // ---- floating platforms, so air combat has something to relate to
    for (const [x, y, z, s] of [[-18, 22, 30, 7], [30, 34, -22, 9], [4, 46, 8, 6]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s * 2, 1.2, s * 2), pillarMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(s * 2.1, 0.16, s * 2.1), accentMat);
      edge.position.set(x, y + 0.68, z);
      this.group.add(edge);
      this.colliders.push(new THREE.Box3().setFromObject(m));
    }

    // ---- distant skyline, so the horizon is a place rather than an edge
    this.skyline = makeSkyline(this.arenaRadius);
    this.group.add(this.skyline);
  }

  dispose() {
    this.skyline?.userData.dispose?.();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.sky?.dispose();
    this.scene.environment = null;
    this.scene.remove(this.group);
  }
}
