import * as THREE from 'three';
import { makeSky, makeSkyline, FIELD_SKY } from './Sky.js';

// ============================================================
//  Debug arena : a flat plane, a ring wall, and a handful of
//  pillars to exercise the environment-interference module.
// ============================================================

export class World {
  constructor(scene, renderer = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.gravity = 22;
    this.arenaRadius = 120;
    this.ceiling = 95;
    /** @type {THREE.Box3[]} */
    this.colliders = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._build();
  }

  groundHeight() { return 0; }

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
    key.position.set(38, 62, 24);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const d = 46;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.camera.far = 190;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.03;
    scene.add(key);
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

      this.colliders.push(new THREE.Box3().setFromObject(m));
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
