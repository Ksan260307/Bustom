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
//  These layouts were written by hand, piece by piece, and it showed. Every
//  block was its own width, nothing lined up with anything, and the four
//  corners the machines start in were furnished differently from each
//  other — so a fight could open with one player behind good cover and
//  another in the open, decided before anybody moved.
//
//  They are built now, not scattered. Five rules, all of them measurable,
//  and all of them checked in tests/game.arenas.test.js so they cannot
//  quietly stop being true:
//
//    1. ONE LATTICE. Every piece stands on an eight-metre grid. Nothing is
//       at 21.4 metres because 21.4 is where somebody's hand stopped.
//    2. FOUR WIDTHS. Cover comes in slim, mid, wide and mass. A place built
//       from four sizes reads as somewhere that was built; one where every
//       piece is its own width reads as rubble.
//    3. THE SAME FROM ALL FOUR CORNERS. Turned or mirrored — the arena says
//       which — so the four machines see the same arena. This is fairness,
//       not decoration.
//    4. THE CORNERS ARE CLEAR. Machines start there. Waking up against a
//       shelf is not an opening move.
//    5. LANES. Two pieces are either touching, which makes a wall, or far
//       enough apart to walk between. The crack in between is the one thing
//       that is never allowed: too narrow to pass, wide enough to stick in.
//
//  Density still varies between places — the yard is dense and the salt
//  flat is nearly bare, and that is what tells them apart. What does not
//  vary any more is the grain inside one place.
//
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
 * @property {'turn4'|'mirror4'} [symmetry] how the layout repeats itself:
 *   turned four ways, or mirrored in both axes. Written down rather than
 *   inferred, because the test that checks it has to know which it is
 * @property {number[][]} pillars   [x, z, half-width, height] — on the floor
 * @property {number[][]} [floaters] [x, y, z, half-width, height] — in the air
 * @property {number[][]} platforms [x, y, z, half-width]
 */

// ------------------------------------------------------------ layout kit
//
//  Everything below stands on a lattice, comes in one of four widths, and
//  is laid out so the place looks the same from all four corners.
//
//  That last one is not decoration. Four machines start at four corners; if
//  the arena is not the same from each of them, one of the four is standing
//  somewhere better and the fight was decided before anybody moved.

/** The lattice everything stands on, in metres. */
export const CELL = 8;

/**
 * The widths cover comes in. Four, not forty.
 *
 * A place built from four sizes reads as somewhere that was built; one
 * where every piece is its own width reads as rubble. This is most of the
 * difference between a stage and a scatter.
 */
export const GAUGE = { slim: 2.4, mid: 3.6, wide: 5.2, mass: 8.0 };

/** Onto the lattice. */
const at = (v) => Math.round(v / CELL) * CELL;

/** A piece is the same piece if it stands in the same square. */
const key = (x, z) => `${at(x)}|${at(z)}`;

/**
 * One quadrant, turned about the centre into four.
 *
 * A pinwheel: what you see ahead of you from your own corner is what the
 * machine opposite sees from theirs, turned. Right for anywhere whose
 * shape is about crossing — a ring of cover, a spread of outcrops.
 */
function turn4(spec) {
  const out = [];
  const seen = new Set();
  for (let q = 0; q < 4; q++) {
    for (const [x, z, r, h] of spec) {
      let px = x;
      let pz = z;
      for (let i = 0; i < q; i++) {
        const t = px;
        px = -pz;
        pz = t;
      }
      // A piece on the centre is one piece, not four.
      const k = key(px, pz);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([at(px), at(pz), r, h]);
    }
  }
  return out;
}

/**
 * One quadrant, mirrored in both axes instead of turned.
 *
 * A grid. Rotation gives a pinwheel, and a pinwheel of shelving is a maze —
 * a yard wants its aisles straight and parallel, all four quarters of it.
 */
function mirror4(spec) {
  const out = [];
  const seen = new Set();
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      for (const [x, z, r, h] of spec) {
        const k = key(x * sx, z * sz);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([at(x * sx), at(z * sz), r, h]);
      }
    }
  }
  return out;
}

/**
 * A straight run of cover, `count` pieces every `step` cells.
 *
 * The thing you fight along. Everything about a lane is that it is straight
 * and that you can see down it.
 */
function line(x, z, dx, dz, count, r, h, step = 2) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push([x + dx * i * step * CELL, z + dz * i * step * CELL, r, h]);
  }
  return out;
}

/** A rectangular bank: `cols` by `rows`, on the lattice. */
function bank(x, z, cols, rows, r, h, step = 2) {
  const out = [];
  for (let c = 0; c < cols; c++) {
    for (let d = 0; d < rows; d++) {
      out.push([x + c * step * CELL, z + d * step * CELL, r, h]);
    }
  }
  return out;
}

/** One piece, where it was put. */
const one = (x, z, r, h) => [[at(x), at(z), r, h]];

/**
 * The same four ways up, for things that sit in the air.
 *
 * Platforms and floaters carry a height as well, and it has to survive the
 * turn — a staircase that spirals is a staircase; one whose steps land at
 * random heights is scaffolding.
 */
function turn4y(spec) {
  const out = [];
  const seen = new Set();
  for (let q = 0; q < 4; q++) {
    for (const [x, y, z, ...rest] of spec) {
      let px = x;
      let pz = z;
      for (let i = 0; i < q; i++) {
        const t = px;
        px = -pz;
        pz = t;
      }
      const k = `${key(px, pz)}|${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([at(px), y, at(pz), ...rest]);
    }
  }
  return out;
}

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
    // What the metal reflects. The painted sky above is what the camera
    // sees; a gradient has no shapes in it, and a reflection is shapes.
    reflects: 'dikhololo_night',
    fog: 0.0062,
    fogColor: 0x0b1521,
    ground: 0x19212e,
    grid: 0x4f9fd0,
    accent: 0x3fa0dd,
    backdrop: {
      // The sky, photographed. Tinted to this arena's own gradient, so
      // the place keeps the colour it was designed with and gains the
      // cloud and depth a gradient cannot have.
      sky: 'kloppenheim_02_puresky',
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
    // Concentric squares, turned four ways: an inner knot worth holding, a
    // broken ring to fight through, and four masses on the axes that say
    // which way you are facing from anywhere on the map.
    symmetry: 'turn4',
    pillars: [
      ...turn4([
        [16, 16, GAUGE.mid, 15],
        [48, 0, GAUGE.slim, 11],
        [24, 48, GAUGE.mid, 13],
        [80, 48, GAUGE.wide, 17],
        [88, 0, GAUGE.mass, 27],
        [24, 96, GAUGE.slim, 13],
        [96, 24, GAUGE.slim, 13],
      ]),
    ],
    platforms: [...turn4y([[32, 24, 32, 7], [72, 34, 8, 8]])],
  },

  // ---- tight, tall, and you cannot see anybody coming
  city: {
    label: '市街地',
    blurb: '高い建物が密に立つ。撃ち合いは短く、角の取り合いになる。',
    gravity: 22,
    radius: 96,
    ceiling: 110,
    sky: { top: '#050710', horizon: '#101a2e', glow: '#2a4a6e', bottom: '#080a12' },
    // What the metal reflects. The painted sky above is what the camera
    // sees; a gradient has no shapes in it, and a reflection is shapes.
    reflects: 'modern_buildings_night',
    fog: 0.0088,
    fogColor: 0x101a2c,
    ground: 0x1b1f27,
    grid: 0x5a7fa8,
    accent: 0xe0a64a,
    backdrop: {
      // The sky, photographed. Tinted to this arena's own gradient, so
      // the place keeps the colour it was designed with and gains the
      // cloud and depth a gradient cannot have.
      sky: 'kloppenheim_07_puresky',
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
    // A street grid: four-tower blocks on a lattice with the avenues left
    // open along both axes, and one tower on the crossing itself. Mirrored
    // rather than turned — a city's streets run straight, and a pinwheel of
    // them is a spiral nobody can navigate.
    symmetry: 'mirror4',
    pillars: [
      ...mirror4([
        // Four blocks to a quarter, set off the crossing so both avenues
        // stay open all the way through.
        [24, 8, GAUGE.mid, 34], [8, 24, GAUGE.mid, 30],
        [40, 24, GAUGE.mid, 28], [24, 40, GAUGE.mid, 38],
        // Two out on the ring roads.
        [72, 8, GAUGE.mid, 26], [8, 72, GAUGE.mid, 26],
        // And a pair of high ones, well off the diagonals the machines
        // arrive on.
        [80, 32, GAUGE.wide, 44], [32, 80, GAUGE.wide, 40],
      ]),
      ...one(0, 0, GAUGE.wide, 52),
    ],
    platforms: [...turn4y([[24, 38, 24, 8], [0, 52, 56, 7]])],
  },

  // ---- dense low cover: everything is a corner, nothing is safe for long
  works: {
    label: '廃工場',
    blurb: '低い遮蔽が一面に散る。しゃがんで撃ち、すぐ移る場所。',
    gravity: 22,
    radius: 88,
    ceiling: 70,
    sky: { top: '#080a0b', horizon: '#1a221f', glow: '#3c5248', bottom: '#0a0d0c' },
    // What the metal reflects. The painted sky above is what the camera
    // sees; a gradient has no shapes in it, and a reflection is shapes.
    reflects: 'modern_buildings_night',
    fog: 0.0088,
    fogColor: 0x181f1c,
    ground: 0x2a302c,
    grid: 0x6f9f88,
    accent: 0xffb347,
    backdrop: {
      // The sky, photographed. Tinted to this arena's own gradient, so
      // the place keeps the colour it was designed with and gains the
      // cloud and depth a gradient cannot have.
      sky: 'kloppenheim_07_puresky',
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
    // A yard: four rows of stacked goods with straight aisles between them,
    // and an apron in the middle where the loading happened. The aisles are
    // the place — they are what you fight along, so they run the same way
    // in all four quarters rather than pinwheeling.
    symmetry: 'mirror4',
    pillars: [
      ...mirror4([
        // Two aisles to a quarter, five deep. They stop short of the
        // diagonal on purpose: that is where the machines come in, and a
        // shelf you wake up against is not an opening move.
        ...line(16, 8, 1, 0, 5, GAUGE.slim, 8),
        ...line(16, 24, 1, 0, 5, GAUGE.slim, 6),
      ]),
    ],
    platforms: [...turn4y([[24, 16, 24, 6], [0, 24, 56, 7]])],
  },

  // ---- open, and the only cover is where the ground itself rises
  canyon: {
    label: '峡谷',
    blurb: '遮蔽は少なく、距離が出る。長射程が効き、逃げ場は限られる。',
    gravity: 22,
    radius: 140,
    ceiling: 80,
    sky: { top: '#0a0710', horizon: '#2e1a18', glow: '#7a3a22', bottom: '#120a08' },
    // What the metal reflects. The painted sky above is what the camera
    // sees; a gradient has no shapes in it, and a reflection is shapes.
    reflects: 'moonless_golf',
    fog: 0.0044,
    fogColor: 0x2a1712,
    ground: 0x2e2018,
    grid: 0xa8642f,
    accent: 0xff8a3c,
    backdrop: {
      // The sky, photographed. Tinted to this arena's own gradient, so
      // the place keeps the colour it was designed with and gains the
      // cloud and depth a gradient cannot have.
      sky: 'qwantani_dusk_1_puresky',
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
    // Four ridges, each running clear of the corner behind it, turned into
    // a pinwheel: the gaps between them are the four ways across, and the
    // mass in the middle is the only real cover out there.
    symmetry: 'turn4',
    pillars: [
      // A ridge across each side, built of masses standing shoulder to
      // shoulder — this is a wall, and a wall with gaps in it is a fence.
      // The four corners are left open, and those are the ways in.
      ...turn4([...line(-40, 96, 1, 0, 6, GAUGE.mass, 30)]),
      // Rubble between the wall and the middle.
      ...turn4([[32, 32, GAUGE.wide, 12]]),
      // And the one piece of real cover in the open ground.
      ...one(0, 0, GAUGE.mass, 26),
    ],
    platforms: [[0, 26, 0, 10], ...turn4y([[48, 22, 48, 7]])],
  },

  // ---- nothing to hide behind at all
  flats: {
    label: '塩湖',
    blurb: '遮蔽がほぼない。撃たれたら避けるしかない、機動力の試験場。',
    gravity: 22,
    radius: 150,
    ceiling: 100,
    sky: { top: '#04080c', horizon: '#123040', glow: '#2f7f9e', bottom: '#071016' },
    // What the metal reflects. The painted sky above is what the camera
    // sees; a gradient has no shapes in it, and a reflection is shapes.
    reflects: 'dikhololo_night',
    fog: 0.0030,
    fogColor: 0x143040,
    ground: 0x243642,
    grid: 0x7fd8f0,
    accent: 0x8ae8ff,
    backdrop: {
      // The sky, photographed. Tinted to this arena's own gradient, so
      // the place keeps the colour it was designed with and gains the
      // cloud and depth a gradient cannot have.
      sky: 'qwantani_moon_noon_puresky',
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
    // Four outcrops on the axes and four further out on the diagonals, and
    // a low knot in the middle. On a plain this bare, the only thing that
    // matters is that every one of them is worth crossing open ground for —
    // and that the four corners see the same number of them.
    symmetry: 'turn4',
    pillars: [
      ...turn4([
        [56, 0, GAUGE.wide, 10],
        [24, 24, GAUGE.slim, 6],
        [96, 96, GAUGE.mid, 8],
        [120, 24, GAUGE.slim, 6],
      ]),
      ...one(0, 0, GAUGE.wide, 11),
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
      // The whole sky, photographed. Held well down: this is a picture of a
      // dark sky and the arena is darker still, and a bright band across it
      // would light the fight from nowhere.
      sky: 'milkyway',
      skyBrightness: 0.55,
      // Earth, large and low, with the sun off to one side of it. On a map
      // with no walls it is the only thing telling you which way you face.
      planet: {
        map: 'earth', halo: 0x5f9bff, at: [-0.5, 0.14, -0.86], size: 0.30,
        // The sun well off to one side, so there is a terminator to see.
        // Lit square-on, a planet is a poster of a planet.
        spin: 2.1, sun: [-0.75, 0.28, 0.6],
      },
      // And the Moon, small and far the other way, so there are two.
      planet2: {
        map: 'moon', halo: 0x8a8f9c, at: [0.72, 0.42, 0.55], size: 0.055,
        spin: 0.6, sun: [-0.8, 0.2, -0.5],
      },
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
    symmetry: 'turn4',
    floaters: [
      // A column through the middle of the volume: the vertical thread the
      // whole fight hangs off.
      [0, 60, 0, GAUGE.mass, 26], [0, 130, 0, GAUGE.wide, 22],
      [0, 200, 0, GAUGE.mass, 24],
      // And a shell round it at three heights, each turned four ways, so
      // there is somewhere to make for whichever way you are drifting.
      ...turn4y([
        [88, 48, 48, GAUGE.mass, 26],
        [96, 120, 48, GAUGE.wide, 22],
        [136, 190, 32, GAUGE.mass, 26],
      ]),
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
      sky: 'milkyway',
      // Dimmer than in orbit: there is ground under you here, lit hard, and
      // the sky has to stay behind it rather than compete.
      skyBrightness: 0.34,
      ridge: 'craterWall', ridgeColor: 0x59564f,
      ridgeCount: 30, ridgeSpread: 1.45, ridgeOpacity: 0.85,
      // Earthrise. Half-lit, low over the crater wall, and the one thing on
      // this map that says where you are.
      planet: {
        map: 'earth', halo: 0x6fa8ff, at: [-0.55, 0.26, -0.78], size: 0.16,
        spin: 3.4, sun: [-0.7, 0.35, 0.62],
      },
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
    symmetry: 'turn4',
    pillars: [
      ...turn4([
        [32, 32, GAUGE.wide, 9],
        [72, 8, GAUGE.mid, 7],
        [8, 104, GAUGE.mid, 11],
        [104, 72, GAUGE.slim, 6],
      ]),
      ...one(0, 0, GAUGE.mass, 6),
    ],
    platforms: [[0, 12, 0, 14], ...turn4y([[48, 28, 16, 9]])],
    // A one-sixth-gee jump clears a building, so there has to be something
    // up there to clear.
    floaters: [...turn4y([[40, 36, 88, GAUGE.mid, 7], [88, 52, 24, GAUGE.wide, 9]])],
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
