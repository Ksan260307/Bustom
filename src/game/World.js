import * as THREE from 'three';

// ============================================================
//  Debug arena : a flat plane, a ring wall, and a handful of
//  pillars to exercise the environment-interference module.
// ============================================================

export class World {
  constructor(scene) {
    this.scene = scene;
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

    scene.background = new THREE.Color(0x0a0e15);
    scene.fog = new THREE.FogExp2(0x0a0e15, 0.0072);

    // ---- lighting
    const hemi = new THREE.HemisphereLight(0xb4d2ff, 0x39445c, 1.45);
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

    const rim = new THREE.DirectionalLight(0x6fd2ff, 1.0);
    rim.position.set(-30, 18, -40);
    scene.add(rim);

    // ---- ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(this.arenaRadius, 96),
      new THREE.MeshStandardMaterial({ color: 0x252d3b, roughness: 0.94, metalness: 0.06 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const grid = new THREE.GridHelper(this.arenaRadius * 2, 96, 0x3f6f96, 0x1e2a38);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.position.y = 0.012;
    this.group.add(grid);

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
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x323d50, roughness: 0.7, metalness: 0.3 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x2f7fb5, emissive: 0x0d4a70, emissiveIntensity: 1.4, roughness: 0.4, metalness: 0.6,
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
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.scene.remove(this.group);
  }
}
