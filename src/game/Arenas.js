// ============================================================
//  The places a fight happens.
//
//  There used to be one arena, built into World and named after what it was
//  for — a debug plane with pillars on it. Everything about a fight that is
//  not the machines is decided here: how far the walls are, how much cover
//  there is and where, what the light is like, and whether things fall.
//
//  An arena is DATA. The world builds whatever it is handed, so adding a
//  place is adding an entry, and the fight stays reproducible from its seed
//  because the layout is written down rather than drawn at random.
//
//  ---- on where the cover goes
//
//  These layouts were scattered by hand and it showed: cover in a heap at
//  one end and nothing at the other, pieces standing a metre apart with no
//  lane between them, and the four corners the machines start in furnished
//  as densely as the middle. They are now built from a small number of
//  deliberate ideas — a ring, a spine, a cluster, a scatter with a hole in
//  it — so every place has somewhere to cross, somewhere to hold, and a
//  route round the outside that is not a straight line.
//
//  Three rules the helpers below exist to keep:
//
//    1. THE MIDDLE IS CONTESTED. Whatever is at the centre is worth having
//       and worth leaving: cover you can hold from and be flanked in.
//    2. THE CORNERS ARE CLEAR. Machines start there. Waking up inside a
//       wall is not an opening move.
//    3. NOTHING IS EVENLY SPREAD. An even scatter is the same everywhere,
//       which means nowhere is anywhere. Density has to vary.
// ============================================================

/**
 * @typedef {object} Arena
 * @property {string} label      what the player picks it by
 * @property {string} blurb      one line on what fighting here is like
 * @property {number} gravity    metres per second squared
 * @property {number} radius     how far the wall is
 * @property {number} ceiling    how high the ceiling is
 * @property {boolean} [open]    no boundary wall drawn: the sky goes on
 * @property {boolean} [floorless] and no ground drawn either — see World._build
 * @property {number} [floorY]  how low a machine may go; 0 where a floor is drawn
 * @property {object} sky        the gradient behind it, and in its reflections
 * @property {number} fog        density; thicker hides the far side
 * @property {number} fogColor
 * @property {number} ground
 * @property {number} grid       the floor grid's line colour
 * @property {number} accent     the strip-lights, and the ring at the edge
 * @property {number} [key]      sun strength; airless places want it hard
 * @property {number} [ambient]  and their fill near zero, for want of air
 * @property {object} [backdrop] what is behind the arena; see Backdrop.js
 * @property {string} floor      which surface the ground is made of
 * @property {number} floorScale how many times that surface tiles across it
 * @property {string} skin       which surface the cover is made of
 * @property {number} skinColor  and what colour that surface is mostly
 * @property {string} prop       which kit the cover is built from; see Props.js
 * @property {number} [propSalt] shifts which silhouette lands where
 * @property {number[][]} pillars   [x, z, half-width, height] — on the floor
 * @property {number[][]} [floaters] [x, y, z, half-width, height] — in the air
 * @property {number[][]} platforms [x, y, z, half-width]
 */

// ------------------------------------------------------------ layout kit

/** Evenly round a circle. The plainest idea there is, and the most useful. */
function ring(count, radius, r, h, turn = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * Math.PI * 2;
    out.push([
      Math.round(Math.cos(a) * radius * 100) / 100,
      Math.round(Math.sin(a) * radius * 100) / 100,
      r, h,
    ]);
  }
  return out;
}

/**
 * A ring with pieces missing.
 *
 * A complete ring is a wall, and a wall you cannot get through turns the
 * middle into a room. The gaps are the doors, and where they are is the
 * whole point of the shape.
 *
 * @param {number[]} skip which indices to leave out
 */
function arc(count, radius, r, h, turn = 0, skip = []) {
  return ring(count, radius, r, h, turn).filter((_, i) => !skip.includes(i));
}

/**
 * A line of cover running one way across the map.
 *
 * This is what gives a place a grain. Approaching along the spine is safe
 * and slow; crossing it is quick and exposed, and that trade is the fight.
 */
function spine(count, from, to, r, h) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push([
      Math.round((from[0] + (to[0] - from[0]) * t) * 100) / 100,
      Math.round((from[1] + (to[1] - from[1]) * t) * 100) / 100,
      r, h,
    ]);
  }
  return out;
}

/**
 * A knot of cover around one spot.
 *
 * Somewhere to fight over, as opposed to somewhere to fight in. The offsets
 * are written out rather than drawn, so the same knot appears every time.
 */
function cluster(x, z, spec) {
  return spec.map(([dx, dz, r, h]) => [x + dx, z + dz, r, h]);
}

/** One piece, on its own, a long way from anything. A landmark. */
const lone = (x, z, r, h) => [[x, z, r, h]];

// ------------------------------------------------------------ the places

export const ARENAS = {
  // ---- the one everything else is measured against
  proving: {
    label: '演習場',
    blurb: '広くて見通しがよく、遮蔽もひと通りある。基準になる場所。',
    gravity: 22,
    radius: 120,
    ceiling: 95,
    sky: { top: '#03050a', horizon: '#0a1220', glow: '#183246', bottom: '#05070c' },
    fog: 0.0062,
    fogColor: 0x0b1521,
    ground: 0x19212e,
    grid: 0x4f9fd0,
    accent: 0x3fa0dd,
    backdrop: {
      ridge: 'compound', ridgeColor: 0x2c5f8a, ridgeCount: 34, ridgeOpacity: 0.42,
    },
    floor: 'concrete',
    floorScale: 30,
    skin: 'panels',
    skinColor: 0x2b3646,
    prop: 'block',
    // A knot in the middle worth holding, a broken ring at mid-distance to
    // fight your way through, and two long stacks that give the place a
    // direction. Corners left clear.
    pillars: [
      ...cluster(0, 0, [
        [-7, -6, 3.2, 15], [8, -4, 2.6, 19], [-2, 9, 3.6, 11], [10, 10, 2.2, 23],
      ]),
      ...arc(12, 46, 3.0, 17, 0.26, [1, 4, 7, 10]),
      // Two lanes running east–west, well clear of the four corners the
      // machines start in. On the diagonals they were exactly where
      // somebody wakes up.
      ...spine(5, [-44, -74], [44, -74], 3.4, 13),
      ...spine(5, [-44, 74], [44, 74], 3.4, 13),
      ...lone(-92, 0, 5.0, 27),
      ...lone(92, 0, 5.0, 27),
    ],
    platforms: [[-18, 22, 30, 7], [30, 34, -22, 9], [4, 46, 8, 6]],
  },

  // ---- tight, tall, and you cannot see anybody coming
  city: {
    label: '市街地',
    blurb: '高い建物が密に立つ。撃ち合いは短く、角の取り合いになる。',
    gravity: 22,
    radius: 96,
    ceiling: 110,
    sky: { top: '#050710', horizon: '#101a2e', glow: '#2a4a6e', bottom: '#080a12' },
    fog: 0.0088,
    fogColor: 0x101a2c,
    ground: 0x1b1f27,
    grid: 0x5a7fa8,
    accent: 0xe0a64a,
    backdrop: {
      ridge: 'city', ridgeColor: 0x24406a, ridgeCount: 54, ridgeOpacity: 0.55,
    },
    floor: 'asphalt',
    floorScale: 34,
    skin: 'windows',
    skinColor: 0x1a212e,
    prop: 'tower',
    // City blocks, not a forest. Two avenues cross at the middle and the
    // rest is built up either side of them, which is what gives a city its
    // corners — the thing you actually fight over here.
    pillars: [
      // Inner blocks, on the diagonals but well inside the ring the
      // machines start on.
      ...cluster(21, 21, [
        [-9, -9, 4.5, 38], [9, -7, 3.6, 28], [-7, 10, 3.8, 44], [10, 10, 4.2, 32],
      ]),
      ...cluster(-21, 21, [
        [-9, -9, 3.8, 30], [10, -8, 4.4, 42], [-8, 10, 4.0, 26], [9, 10, 3.4, 36],
      ]),
      ...cluster(-21, -21, [
        [-10, -8, 4.2, 34], [8, -10, 3.6, 46], [-8, 9, 4.6, 28], [10, 9, 3.8, 40],
      ]),
      ...cluster(21, -21, [
        [-8, -10, 3.4, 44], [10, -8, 4.0, 30], [-10, 8, 3.8, 36], [8, 10, 4.4, 24],
      ]),
      // Outer blocks square-on to the avenues, so the two roads out of the
      // middle stay open and everything else is built up.
      ...cluster(0, 64, [[-13, 0, 4.0, 30], [13, 5, 3.4, 40]]),
      ...cluster(0, -64, [[-13, 0, 3.4, 42], [13, -5, 4.0, 28]]),
      ...cluster(64, 0, [[0, -13, 3.8, 34], [5, 13, 4.2, 26]]),
      ...cluster(-64, 0, [[0, -13, 4.2, 26], [-5, 13, 3.8, 38]]),
      // And the far corners, outside where anybody starts.
      ...lone(60, 60, 4.4, 34),
      ...lone(-60, 60, 4.4, 28),
      ...lone(-60, -60, 4.4, 38),
      ...lone(60, -60, 4.4, 30),
      // One tower on the crossing itself: the whole map can see it, and
      // anybody at the foot of it cannot be seen at all.
      ...lone(0, 0, 5.0, 52),
    ],
    platforms: [[-24, 38, 24, 8], [26, 44, -20, 8], [0, 52, 40, 7], [-40, 30, -36, 9]],
  },

  // ---- dense low cover: everything is a corner, nothing is safe for long
  works: {
    label: '廃工場',
    blurb: '低い遮蔽が一面に散る。しゃがんで撃ち、すぐ移る場所。',
    gravity: 22,
    radius: 88,
    ceiling: 70,
    sky: { top: '#080a0b', horizon: '#1a221f', glow: '#3c5248', bottom: '#0a0d0c' },
    fog: 0.0088,
    fogColor: 0x181f1c,
    ground: 0x2a302c,
    grid: 0x6f9f88,
    accent: 0xffb347,
    backdrop: {
      ridge: 'industry', ridgeColor: 0x3f6a58, ridgeCount: 40, ridgeOpacity: 0.45,
    },
    floor: 'deckplate',
    floorScale: 22,
    skin: 'rust',
    skinColor: 0x4a5148,
    prop: 'crate',
    // A yard: rows of stacked goods with aisles between them, a clear apron
    // in the middle where the loading happened, and heaps in two corners.
    // The aisles are the whole place — they are what you fight along.
    pillars: [
      ...spine(6, [-58, -26], [-14, -26], 2.6, 8),
      ...spine(6, [-58, -12], [-14, -12], 2.6, 6),
      ...spine(6, [-58, 12], [-14, 12], 2.6, 9),
      ...spine(6, [-58, 26], [-14, 26], 2.6, 7),
      ...spine(4, [16, -30], [46, -30], 3.0, 7),
      ...spine(5, [16, -14], [56, -14], 3.0, 9),
      ...spine(5, [16, 14], [56, 14], 3.0, 6),
      ...spine(4, [16, 30], [46, 30], 3.0, 8),
      // The apron: four pieces round an open square, not filling it.
      ...cluster(0, 0, [[-9, -9, 3.4, 11], [9, 9, 3.4, 11]]),
      ...lone(0, -58, 4.4, 13),
      ...lone(0, 58, 4.4, 13),
    ],
    platforms: [[-20, 16, 20, 6], [22, 18, -18, 6], [0, 24, -34, 7]],
  },

  // ---- open, and the only cover is where the ground itself rises
  canyon: {
    label: '峡谷',
    blurb: '遮蔽は少なく、距離が出る。長射程が効き、逃げ場は限られる。',
    gravity: 22,
    radius: 140,
    ceiling: 80,
    sky: { top: '#0a0710', horizon: '#2e1a18', glow: '#7a3a22', bottom: '#120a08' },
    fog: 0.0044,
    fogColor: 0x2a1712,
    ground: 0x2e2018,
    grid: 0xa8642f,
    accent: 0xff8a3c,
    backdrop: {
      ridge: 'mesas', ridgeColor: 0x6a3520, ridgeCount: 30,
      ridgeSpread: 1.35, ridgeOpacity: 0.7,
    },
    floor: 'stone',
    floorScale: 26,
    skin: 'strata',
    skinColor: 0x4a3225,
    prop: 'rock',
    // Two walls of rock running the length of the map with a floor between
    // them: that is what a canyon is. Crossing from one wall to the other
    // is the exposed move, and there are two ways through.
    pillars: [
      ...spine(6, [-96, -70], [-40, 76], 10.0, 32),
      ...spine(6, [96, -76], [40, 70], 10.0, 32),
      // Rubble on the floor between them, in two loose heaps, so the run
      // across is not a completely bare one.
      ...cluster(-16, -34, [[0, 0, 5.0, 14], [13, -9, 3.5, 9], [-11, 10, 4.0, 11]]),
      ...cluster(20, 40, [[0, 0, 5.5, 16], [-14, -8, 4.0, 10], [12, 11, 3.5, 8]]),
      // And one big one in the middle, which is the only real cover out
      // there and therefore the thing everybody wants.
      ...lone(0, 0, 9.0, 26),
    ],
    platforms: [[0, 26, 0, 10]],
  },

  // ---- nothing to hide behind at all
  flats: {
    label: '塩湖',
    blurb: '遮蔽がほぼない。撃たれたら避けるしかない、機動力の試験場。',
    gravity: 22,
    radius: 150,
    ceiling: 100,
    sky: { top: '#04080c', horizon: '#123040', glow: '#2f7f9e', bottom: '#071016' },
    fog: 0.0030,
    fogColor: 0x143040,
    ground: 0x243642,
    grid: 0x7fd8f0,
    accent: 0x8ae8ff,
    backdrop: {
      ridge: 'mountains', ridgeColor: 0x2f6a86, ridgeCount: 36,
      ridgeSpread: 2.1, ridgeOpacity: 0.4,
    },
    floor: 'saltpan',
    floorScale: 24,
    skin: 'stone',
    skinColor: 0x8ea3ad,
    prop: 'rock',
    // Almost nothing, and what there is stands alone.
    //
    // Scattering fifteen outcrops evenly would have made a sparse forest;
    // three isolated landmarks and one cluster make a plain with features
    // in it, and every one of them is worth crossing open ground for.
    pillars: [
      ...cluster(0, 0, [[-6, -5, 5.0, 10], [7, 6, 3.5, 6]]),
      ...lone(-64, 48, 4.5, 9),
      ...lone(70, -34, 4.0, 8),
      ...lone(24, 96, 3.5, 7),
      ...lone(-96, -62, 5.0, 11),
      ...lone(108, 54, 3.0, 5),
      ...lone(-30, -104, 3.5, 6),
    ],
    platforms: [],
  },

  // ---- nothing underfoot, and nothing pulling you towards it
  orbit: {
    label: '宇宙',
    blurb: '足場のない広い空間。落ちない代わりに、止まるのも自分の噴射しだい。',
    // Nothing. The drift damping in the machines is what makes this
    // controllable — a thruster tap with nothing to stop it is a one-way
    // trip, so a machine holds itself steady when nobody is asking it to
    // move, and stops doing that the instant anybody does.
    gravity: 0,
    radius: 190,
    ceiling: 260,
    open: true,
    // No wall, and no floor either. The bounds still exist as a backstop,
    // but nothing is drawn at zero: a lit disc down there would put a floor
    // under a fight that is not happening on one, and tell the player there
    // is somewhere to stand.
    floorless: true,
    // And the bottom is where the structure is, not where the maths puts
    // zero. Below this there is nothing at all — no floor, no cover, no
    // light on anything — and a machine down there is a dark speck in black
    // with the camera fifty metres off. You simply stop, invisibly.
    floorY: 34,
    // Void, not night. There is no horizon out here to light, so the
    // gradient is almost flat and almost black; what you see is the stars.
    sky: { top: '#000002', horizon: '#010206', glow: '#050a16', bottom: '#000103' },
    fog: 0.0006,
    fogColor: 0x010206,
    ground: 0x0a0d14,
    grid: 0x2f4a72,
    accent: 0x74c9ff,
    // Unfiltered sun, and no air to soften what it misses.
    key: 3.4,
    ambient: 0.14,
    backdrop: {
      stars: 2200,
      starColor: 0xe6ecff,
      nebula: 0x2f4c96,
      planet: { color: 0x3a6ab0, halo: 0x5f9bff, at: [-0.5, 0.18, -0.86], size: 0.16 },
    },
    floor: 'deckplate',
    floorScale: 30,
    skin: 'panels',
    skinColor: 0x6a7284,
    prop: 'station',
    propSalt: 5,
    // NOTHING on the floor, and no platforms at all.
    //
    // There is no floor here worth the name: with no gravity, anything on
    // the deck is furniture in a room nobody enters, and a platform is a
    // place to stand for a machine that has no reason to stand. What is
    // left is structure hanging in the volume, spaced far enough apart that
    // crossing between two pieces is a decision rather than a step.
    pillars: [],
    platforms: [],
    floaters: [
      // A loose column through the middle of the volume, so there is a
      // vertical thread to fight along.
      [0, 60, 0, 6.0, 26], [0, 130, 0, 5.0, 22], [0, 200, 0, 5.5, 24],
      // And six well-separated masses out around it, at different heights.
      [-86, 46, 62, 5.5, 24], [92, 74, -54, 6.0, 26],
      [70, 150, 78, 5.0, 22], [-96, 168, -70, 5.5, 24],
      [-58, 108, -110, 5.0, 20], [64, 96, 118, 5.5, 22],
      // Two more, further out still, as things to make for.
      [-140, 84, -12, 6.5, 28], [136, 190, 30, 6.0, 26],
    ],
  },

  // ---- open ground, and you come down slowly
  moon: {
    label: '月',
    blurb: '重力がほとんどない。一跳びで建物を越え、落ちてくるまでが長い。',
    // The Moon's own, near enough. Not zero: this is open ground with no
    // ceiling over it, and with nothing pulling you back a single thruster
    // burn would be a one-way trip off the top of the map. At a fourteenth
    // of a gee you still come down — you just have a long time in the air
    // to decide what to do on the way, which is the whole point of it.
    gravity: 1.62,
    radius: 165,
    ceiling: 420,
    open: true,
    sky: { top: '#01030a', horizon: '#070e22', glow: '#1a3a68', bottom: '#020409' },
    fog: 0.0012,
    fogColor: 0x02040a,
    ground: 0x6b6862,
    grid: 0x8f8d86,
    accent: 0xdfe6f2,
    key: 3.1,
    ambient: 0.20,
    backdrop: {
      stars: 1500,
      starColor: 0xf0f4ff,
      nebula: 0x1c2f5c,
      ridge: 'craterWall', ridgeColor: 0x59564f,
      ridgeCount: 30, ridgeSpread: 1.45, ridgeOpacity: 0.85,
      planet: { color: 0x4d7fc4, halo: 0x6fa8ff, at: [-0.55, 0.30, -0.78], size: 0.13 },
    },
    floor: 'regolith',
    // Big tiles: at forty repeats a crater is a metre across and the whole
    // floor reads as gravel with a visible repeat in it. At sixteen the
    // craters are the size craters are, and the pattern stops announcing
    // itself.
    floorScale: 16,
    skin: 'panels',
    skinColor: 0x625f59,
    prop: 'lunar',
    propSalt: 3,
    // A station in the middle and craters around it, with a long clear run
    // between them — a sixth-gee jump crosses eighty metres, so cover has
    // to be further apart here than anywhere else to mean anything.
    pillars: [
      ...cluster(0, 0, [
        [-12, -8, 5.0, 6], [14, -6, 4.0, 5], [-4, 14, 4.5, 7], [16, 14, 3.5, 5],
      ]),
      ...arc(9, 62, 8.0, 6, 0.35, [2, 6]),
      ...lone(-118, 40, 10.0, 8),
      ...lone(104, -76, 9.0, 7),
      ...lone(-40, -122, 8.0, 6),
      ...lone(60, 118, 9.0, 7),
    ],
    platforms: [[0, 12, 0, 14], [-40, 26, 30, 9], [42, 30, -28, 9], [0, 44, -56, 8]],
    // A one-sixth-gee jump clears a building, so there has to be something
    // up there to clear.
    floaters: [
      [26, 34, -44, 4.0, 7], [-56, 40, 48, 4.5, 8],
      [78, 48, 34, 4.0, 7], [-34, 58, -78, 5.0, 9],
    ],
  },
};

/** The order they are offered in: gentlest first, strangest last. */
export const ARENA_ORDER = [
  'proving', 'city', 'works', 'canyon', 'flats', 'orbit', 'moon',
];

export const DEFAULT_ARENA = 'proving';

export function getArena(id) {
  return ARENAS[id] ?? ARENAS[DEFAULT_ARENA];
}
