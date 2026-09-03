import * as THREE from 'three';
import { makeSky } from './Sky.js';
import { makeBackdrop } from './Backdrop.js';
import { getArena, DEFAULT_ARENA } from './Arenas.js';
import { makeTexture, roughnessFrom } from './Textures.js';
import { surfaceMaps, DETAIL_MEAN } from './Kit.js';
import { buildProp, variantAt } from './Props.js';

// ============================================================
//  The arena, built from a description.
//
//  There used to be exactly one place to fight, with its wall distance, its
//  gravity and its eight pillars written into this file. Everything that
//  varies now comes from `Arenas.js`; what is left here is how to turn one
//  of those into geometry and light.
// ============================================================

const _size = new THREE.Vector3();

/**
 * How a surface takes the light.
 *
 * Not part of the arena description on purpose: "the canyon is made of
 * rock" belongs to the place, and "rock is matte and not metallic" is a
 * fact about rock. Every prop used to be metalness 0.45 whatever it was
 * made of, so a sandstone mesa came out with a chrome highlight down it.
 */
const FEEL = {
  concrete: { metalness: 0.10, roughness: 0.85 },
  asphalt: { metalness: 0.04, roughness: 0.95 },
  stone: { metalness: 0.00, roughness: 0.94 },
  deckplate: { metalness: 0.55, roughness: 0.48 },
  saltpan: { metalness: 0.02, roughness: 0.88 },
  regolith: { metalness: 0.00, roughness: 0.99 },
  panels: { metalness: 0.45, roughness: 0.55 },
  windows: { metalness: 0.30, roughness: 0.60 },
  strata: { metalness: 0.00, roughness: 0.96 },
  rust: { metalness: 0.22, roughness: 0.86 },
};
const feelOf = (kind) => FEEL[kind] ?? { metalness: 0.18, roughness: 0.66 };

/**
 * What to make a surface out of: a photograph if one shipped, else a painting.
 *
 * The arena's colour is the arena's, either way. A photographed surface here
 * is a DETAIL map — greyscale, levelled at the bake — so the place keeps the
 * palette it was designed with and gains the grain that tells you how big
 * everything is. The painted version had to carry both at once, and a
 * painting that has to be its own colour cannot be very detailed.
 *
 * @param {string} kind    which surface
 * @param {number} colour  what this arena wants it to be
 * @param {number} accent  the colour of whatever is lit on it
 * @param {object} opts    passed through to the painter
 */
function surfaceOf(kind, colour, accent, opts) {
  const shot = surfaceMaps(kind, opts.repeat ?? 1);
  if (shot) {
    const tint = new THREE.Color(colour);
    // Wound back up by exactly what the detail map takes off, so swapping a
    // flat fill for a photograph does not darken a whole arena by a third.
    tint.multiplyScalar(1 / DETAIL_MEAN);
    return {
      color: tint,
      map: shot.map,
      roughnessMap: shot.roughnessMap,
      normalMap: shot.normalMap,
      // Gentle on purpose. A floor photographed at a hand's width and then
      // tiled across a two-hundred-metre arena has relief in it that is, at
      // that scale, several metres deep — and every bump of it catches the
      // light, which is what turned a dry canyon floor into wet slate.
      normalScale: shot.normalMap ? new THREE.Vector2(0.35, 0.35) : null,
    };
  }

  const painted = makeTexture(kind, colour, accent, opts);
  return {
    color: new THREE.Color(painted ? 0xffffff : colour),
    map: painted,
    roughnessMap: roughnessFrom(painted),
    normalMap: null,
    normalScale: null,
  };
}

/** Whether a floor is something somebody laid, or something that was there. */
const NATURAL = new Set(['stone', 'saltpan', 'regolith']);

export class World {
  constructor(scene, renderer = null, arenaId = DEFAULT_ARENA) {
    this.scene = scene;
    this.renderer = renderer;
    this.arenaId = arenaId;
    const arena = getArena(arenaId);
    this.arena = arena;
    /**
     * How hard things fall here.
     *
     * It varies by a factor of twenty across the arenas, and everything
     * that reads it — the machines, the debris, the dust — has to keep
     * working at both ends of that. A very small number is a real setting,
     * not a broken one: on the Moon it is 1.62.
     */
    this.gravity = arena.gravity;
    this.arenaRadius = arena.radius;
    this.ceiling = arena.ceiling;
    this.floorY = arena.floorY ?? 0;
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

  /**
   * How low a machine can go.
   *
   * Zero nearly everywhere, because that is where the floor is drawn. In
   * space it is not: there is no floor to draw, and a machine that keeps
   * descending ends up alone in the black with no structure anywhere near
   * it and the camera a long way off — it stops being findable on its own
   * screen. The stop is invisible, which is the honest thing to be when
   * there is nothing there.
   */
  groundHeight() { return this.floorY; }

  /**
   * The top of whatever is under this point, at or below `fromY`.
   *
   * The floor unless a box is in the way. Used by the legs to find what they
   * are actually standing on: the body is held up by one probe at the middle
   * of the machine, so on a step or a crate one foot is in the concrete and
   * the other is in the air, and neither of them knew.
   */
  surfaceAt(x, z, fromY) {
    let y = this.floorY;
    for (const box of this.colliders) {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      if (box.max.y > y && box.max.y <= fromY) y = box.max.y;
    }
    return y;
  }

  /** Is there anything pulling things down here? */
  get weightless() { return this.gravity <= 0; }

  /**
   * Tear this arena down and put a different one up.
   *
   * Everything the build made lives in one group and one sky, so a swap is
   * a removal and a rebuild — no hunting through the scene for lights left
   * behind by the last place.
   *
   * @param {string} arenaId
   */
  /**
   * Put the same place up again.
   *
   * `setArena` refuses to rebuild somewhere you are already standing, which
   * is right nearly always and wrong exactly once: the files the arena is
   * made of arrive after the boot, and the arena that was standing when
   * they landed was built without them.
   */
  rebuild() {
    const id = this.arenaId;
    this.arenaId = null;
    this.setArena(id);
    return this;
  }

  setArena(arenaId) {
    if (arenaId === this.arenaId) return this;
    this._teardown();
    this.arenaId = arenaId;
    const arena = getArena(arenaId);
    this.arena = arena;
    this.gravity = arena.gravity;
    this.arenaRadius = arena.radius;
    this.ceiling = arena.ceiling;
    this.floorY = arena.floorY ?? 0;
    this.colliders = [];
    this.pillars = [];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this._build();
    return this;
  }

  _teardown() {
    this.backdrop?.userData.dispose?.();
    this.backdrop = null;
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of [o.material].flat()) m.dispose();
      }
    });
    this.sky?.dispose();
    this.sky = null;
    this.keyLight = null;
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.remove(this.group);
    return this;
  }

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
  /**
   * Keep the sky centred on the camera.
   *
   * Stars and a planet are meant to be infinitely far away: they must not
   * slide past as the machine crosses the arena, and they must never fall
   * outside the camera's far plane. Both come free from riding along.
   *
   * Output only, like the shadows. Called once a frame.
   */
  followSky(at) {
    const sky = this.backdrop?.userData?.sky;
    if (sky && at) sky.position.copy(at);
    return this;
  }

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
    const arena = this.arena;
    if (this.renderer) {
      // Space and the Moon pass nothing: there is no sky over either of
      // them to reflect, and giving them one would be a mistake dressed up
      // as a feature.
      this.sky = makeSky(this.renderer, arena.sky, arena.reflects ?? null);
      scene.background = this.sky.texture;
      scene.environment = this.sky.environment;
      // The sky is there to be reflected, not to light the frame: shown at
      // full strength it turns every dark corner into grey haze.
      scene.backgroundIntensity = 0.45;
    } else {
      scene.background = new THREE.Color(arena.fogColor);
    }
    // Fog matched to the horizon band, so distance dissolves into the sky
    // rather than into a flat wall of colour. How thick it is decides how
    // much of the arena is a place and how much is a rumour.
    scene.fog = new THREE.FogExp2(arena.fogColor, arena.fog);

    // ---- lighting
    // Halved now that an environment map supplies the ambient — leaving
    // both at full strength double-lights everything and flattens it.
    // Airless places light differently, and it is not a style choice.
    //
    // Ambient light is scattered light, and scattering needs something to
    // scatter off. In space and on the Moon there is nothing, so the sun is
    // hard and the shadows are black — which is also the only way structure
    // reads there at all: with a soft fill and a near-black sky to reflect,
    // a station module is a dark grey shape on a dark grey background and
    // you cannot see it until it is lit trim.
    const hemi = new THREE.HemisphereLight(
      0xb4d2ff, 0x39445c, arena.ambient ?? 0.62,
    );
    this.group.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2df, arena.key ?? 2.25);
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
    this.group.add(key);
    this.group.add(key.target);
    this.keyLight = key;

    // Two rims rather than one: a cold one behind and a warm one low to the
    // side. A single rim only ever separates the silhouette from one angle,
    // and the camera in this game is always moving.
    const rim = new THREE.DirectionalLight(0x6fd2ff, 1.25);
    rim.position.set(-30, 18, -40);
    this.group.add(rim);

    // Kept faint and barely warm. Any more and it stops reading as a rim
    // and starts reading as a dirty floor.
    const warm = new THREE.DirectionalLight(0xffc9a8, 0.18);
    warm.position.set(-44, 8, 34);
    this.group.add(warm);

    // ---- ground
    // The floor is a surface, not a colour.
    //
    // A flat fill has no scale: standing on it, a machine could be two
    // metres tall or twenty and nothing in the picture would say which.
    const floor = surfaceOf(arena.floor, arena.ground, arena.accent, {
      size: 512, repeat: arena.floorScale ?? 24, seed: 0x10ad,
    });
    // Somewhere with no floor draws none.
    //
    // Space has a collision plane at zero because the bounds code wants
    // one, but drawing a disc and a lit rim around it puts a floor under a
    // fight that is not happening on one — and worse, tells the player
    // there is somewhere down there to stand.
    if (arena.floorless) {
      this.backdrop = makeBackdrop(arena);
      this.group.add(this.backdrop);
      this._buildProps(arena);
      return;
    }

    const floorFeel = feelOf(arena.floor);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(this.arenaRadius, 96),
      new THREE.MeshStandardMaterial({
        color: floor.color,
        map: floor.map,
        roughnessMap: floor.roughnessMap,
        normalMap: floor.normalMap,
        ...(floor.normalScale ? { normalScale: floor.normalScale } : {}),
        roughness: floorFeel.roughness,
        metalness: floorFeel.metalness,
        envMapIntensity: 0.55,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Faint, now that the floor has a surface of its own: at the old
    // strength the grid WAS the floor, and every arena had the same one.
    // Nowhere natural gets one. A survey grid across a canyon floor or a
    // crater field is a diagram drawn over a place, and it was the single
    // strongest thing in frame in both.
    const laid = !NATURAL.has(arena.floor);
    if (laid) {
      const grid = new THREE.GridHelper(this.arenaRadius * 2, 96, arena.grid, 0x1e2a38);
      grid.material.transparent = true;
      grid.material.opacity = floor.map ? 0.16 : 0.55;
      grid.position.y = 0.012;
      this.group.add(grid);
    }

    // A lit ring at the arena edge: it tells you where the floor ends from
    // any distance, and it is the one line the bloom really wants.
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(this.arenaRadius - 1.1, this.arenaRadius, 128),
      new THREE.MeshBasicMaterial({
        color: arena.accent, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.05;
    this.group.add(edge);

    // finer grid near the origin, so slow precision work is readable
    if (laid) {
      const fine = new THREE.GridHelper(40, 80, arena.grid, 0x223142);
      fine.material.transparent = true;
      fine.material.opacity = floor.map ? 0.12 : 0.35;
      fine.position.y = 0.018;
      this.group.add(fine);
    }

    // ---- boundary ring.
    //
    // Not everywhere has one. Somewhere open the sky is supposed to go on:
    // a translucent cylinder round the horizon says "you are indoors", and
    // on the Moon that is the opposite of the point.
    if (!arena.open) this._buildWall(arena);

    // ---- cover
    this._buildProps(arena);

    // ---- and what is behind all of it.
    //
    // Every arena used to end at its own boundary: past the wall there was
    // fog, and past the fog the flat colour of the sky. That reads as "the
    // level stopped", and it made every place feel like the same box with
    // different furniture in it, because the box was all you could see.
    this.backdrop = makeBackdrop(arena);
    this.group.add(this.backdrop);
  }

  /** The soft cylinder that says where the arena stops. */
  _buildWall(arena) {
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(this.arenaRadius, this.arenaRadius, 26, 96, 1, true),
      new THREE.MeshBasicMaterial({
        // The accent, taken well down toward the fog.
        //
        // At full strength this is a wall of saturated colour across the top
        // half of every frame: it covers the whole horizon, it is unlit so
        // tone mapping does not touch it, and the bright pass then picks the
        // whole thing up. It has to say "the arena ends here" and nothing else.
        color: new THREE.Color(arena.accent).lerp(new THREE.Color(arena.fogColor), 0.62),
        transparent: true, opacity: 0.13, side: THREE.BackSide,
      }),
    );
    wall.position.y = 13;
    this.group.add(wall);
    return this;
  }

  /**
   * The things you hide behind, in whatever shape this place makes them.
   *
   * Every arena used to build the same grey box at different sizes, so a
   * forty-metre tower and a two-metre crate were the same object — and the
   * places were told apart only by how many there were.
   */
  _buildProps(arena) {
    const skin = surfaceOf(arena.skin, arena.skinColor ?? 0x2b3646, arena.accent, {
      size: 512, repeat: 1, seed: 0x5c1f,
    });
    const skinFeel = feelOf(arena.skin);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: skin.color,
      map: skin.map,
      roughnessMap: skin.roughnessMap,
      normalMap: skin.normalMap,
      ...(skin.normalScale ? { normalScale: skin.normalScale } : {}),
      roughness: skinFeel.roughness,
      metalness: skinFeel.metalness,
      envMapIntensity: 0.9,
    });
    // Pushed past 1 on purpose: this is what the bright pass picks up, and
    // a strip lamp that does not spill light is not a lamp.
    //
    // But scaled by how bright the colour already is. A deep blue at 2.1
    // reads as a lit strip; a near-white at 2.1 is a floodlight, and on the
    // Moon — where the accent is nearly white by design — every platform
    // came out as a blown-out rectangle with no edges in it.
    const lum = (() => {
      const c = new THREE.Color(arena.accent);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    })();
    const accentMat = new THREE.MeshStandardMaterial({
      color: arena.accent, emissive: arena.accent,
      emissiveIntensity: THREE.MathUtils.lerp(2.3, 0.75, lum),
      roughness: 0.35, metalness: 0.6,
    });

    // Cover standing on the floor, and cover floating in the volume.
    //
    // A weightless arena furnished only from the floor is furnished in the
    // one place nobody goes: with nothing pulling you down, the fight
    // happens through the whole height of the map and the deck is just the
    // far wall. A floater is the same object, built at a height.
    const standing = arena.pillars.map(([x, z, r, h]) => [x, 0, z, r, h]);
    const floating = arena.floaters ?? [];
    for (const [x, y, z, r, h] of [...standing, ...floating]) {
      // Which silhouette this one gets, decided by where it stands. Every
      // piece of cover in a place used to be the same object at a different
      // size, which reads as a repeating pattern rather than as a place —
      // and leaves nowhere you can name to somebody else.
      const parts = buildProp(
        arena.prop, variantAt(x, z + y, arena.propSalt ?? 0), r, h, pillarMat, accentMat,
      );
      for (const m of parts) {
        m.position.x += x;
        m.position.y += y;
        m.position.z += z;
        this.group.add(m);
      }
      // The BODY decides the collider, not the trim: a lit rim overhanging
      // the block it sits on would let a round stop in mid-air beside it.
      const box = new THREE.Box3().setFromObject(parts[0]);
      this.colliders.push(box);
      // Bigger pillars stand up to more. A wall you can chew through in a
      // second is not cover, it is scenery with extra steps.
      box.getSize(_size);
      const bulk = _size.x * _size.z * h;
      this.pillars.push({
        mesh: parts, box, hp: 60 + bulk * 2.4, maxHp: 60 + bulk * 2.4,
      });
    }

    // ---- floating platforms, so air combat has something to relate to.
    // Weightless arenas lean on these: with nothing pulling you down, the
    // floor stops being where the fight is.
    for (const [x, y, z, s] of arena.platforms) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s * 2, 1.2, s * 2), pillarMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      // A lit RIM, not a lit lid.
      //
      // Sat on top, this is a solid glowing square the width of the whole
      // platform — on a fourteen-metre landing pad that is a twenty-eight
      // metre lamp pointed at the camera. Dropped just under the lip it
      // shows as a band around the edge, which is what says "the platform
      // ends here" and is the only thing it was ever meant to say.
      const edge = new THREE.Mesh(new THREE.BoxGeometry(s * 2.12, 0.22, s * 2.12), accentMat);
      edge.position.set(x, y + 0.34, z);
      this.group.add(edge);
      this.colliders.push(new THREE.Box3().setFromObject(m));
    }
    return this;
  }

  dispose() {
    this._teardown();
  }
}
