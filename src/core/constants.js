// ============================================================
//  BroStom : core constants
// ============================================================

/** The nominal block edge, in world units. Parts scale freely around it. */
export const BLOCK = 1.0;

/**
 * Sculpt resolutions: how many cuts a block edge is divided into.
 * 1/100 is the finest the format allows; it costs 1MB per block, so the
 * default sits at 1/32 and the builder raises it only where detail is wanted.
 */
export const VOX_LEVELS = [16, 32, 50, 100];
export const DEFAULT_VOX = 32;

/** Chunk edge used for incremental re-meshing at each resolution. */
export function chunkSizeFor(n) {
  if (n <= 16) return 8;
  if (n <= 32) return 8;
  if (n <= 50) return 10;
  return 20;
}

/** Free part sizing, quantised so blocks still bite together cleanly. */
export const SIZE_STEP = 0.25;
export const SIZE_MIN = 0.25;
export const SIZE_MAX = 4.0;

export const snapSize = (v) =>
  Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v / SIZE_STEP) * SIZE_STEP));

/** Free bone geometry. */
export const BONE_LENGTH_MIN = 0.5;
export const BONE_LENGTH_MAX = 12;
export const BONE_RADIUS_MIN = 0.04;
export const BONE_RADIUS_MAX = 0.6;

/** Free mount nudge, in world units, on top of the socket position. */
export const OFFSET_LIMIT = 1.5;

/** Face indices. Order matters: it is baked into serialized data. */
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

/** Unit normal per face index. */
export const FACE_NORMAL = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Which size component a face normal runs along. */
export const FACE_AXIS = [0, 0, 1, 1, 2, 2];

export const FACE_NAME = ['+X (右)', '-X (左)', '+Y (上)', '-Y (下)', '+Z (前)', '-Z (後)'];

/** Opposite face lookup. */
export const FACE_OPPOSITE = [1, 0, 3, 2, 5, 4];

/**
 * The core block's local +Z is FORWARD (Object3D.lookAt aligns +Z),
 * +Y is UP. Everything downstream relies on this.
 */
export const FORWARD_AXIS = [0, 0, 1];
export const UP_AXIS = [0, 1, 0];

/** Bone attributes. */
export const BONE = {
  LEG: 'leg',
  ARM: 'arm',
  FACE: 'face',
  CUSTOM: 'custom',
};

export const BONE_META = {
  [BONE.LEG]:    { label: 'レッグボーン', color: 0x6fe3ff, mass: 1.4, torque: 26 },
  [BONE.ARM]:    { label: 'アームボーン', color: 0xffc861, mass: 1.0, torque: 18 },
  [BONE.FACE]:   { label: 'フェイスボーン', color: 0xff7ba6, mass: 0.6, torque: 12 },
  [BONE.CUSTOM]: { label: 'カスタムボーン', color: 0xb98cff, mass: 0.9, torque: 15 },
};

/**
 * Custom-bone waveforms. `saw` is the odd one out: it is a continuous
 * rotation rather than a swing, so it ignores both the amplitude and the
 * joint limit — a propeller that stops at 70° is not a propeller.
 */
export const CUSTOM_WAVES = {
  sine: { label: '波（なめらか）' },
  tri: { label: '往復（一定速）' },
  square: { label: 'パタパタ' },
  saw: { label: '回転（ぐるぐる）', spins: true },
};

export const CUSTOM_SOURCES = [
  ['time', '常時'], ['stride', '歩調'], ['speed', '速度'],
  ['thrust', '推力'], ['jerk', '衝撃'], ['aim', 'ロックオン'],
];

/** Default motion for a freshly placed custom bone. */
export const CUSTOM_DEFAULT = {
  axis: 'x', amp: 30, freq: 1.0, phase: 0, offset: 0, wave: 'sine', source: 'time',
};

/**
 * Every bone carries these two, whatever its attribute. Together they turn
 * the four bone types into the joints a robot actually has:
 *
 *   肩       an ARM bone at the root of an arm chain, gain ~0.4
 *   股関節   the LEG bone at the root of a leg chain, gain to taste
 *   腰       a CUSTOM bone twisting on Y, driven by the stride
 *
 * `gain` scales whatever motion the bone's attribute gives it; `lag` slides
 * it round the gait cycle so a chain ripples instead of swinging as one
 * rigid stick.
 */
export const BONE_GAIN_MAX = 2;
export const BONE_LAG_MAX = 1;
export const BONE_MOTION_DEFAULT = { gain: 1, lag: 0 };

/** Named thickness presets. The radius itself stays freely adjustable. */
export const BONE_GAUGE = {
  thin:  { radius: 0.10, label: '細' },
  mid:   { radius: 0.16, label: '中' },
  thick: { radius: 0.22, label: '太' },
};

// ============================================================
//  Equipment : flat "sticker" parts stuck onto the build.
//
//  Every equip shares one silhouette — a thin plate — so a machine reads
//  as "armour with kit on it" rather than as a pile of gun models. Round
//  plates are weapons, square plates are systems.
// ============================================================

export const EQUIP = {
  BEAM: 'beam',
  GATLING: 'gatling',
  SHOT: 'shot',
  BLADE: 'blade',
  MISSILE: 'missile',
  BOOST: 'boost',
  GRAVITY: 'gravity',
  ROLLING: 'rolling',
};

/** Plate thickness. Fixed: this is what makes every equip read as a sticker. */
export const EQUIP_THICKNESS = 0.09;
export const EQUIP_SIZE_MIN = 0.3;
export const EQUIP_SIZE_MAX = 1.6;
export const EQUIP_SIZE_STEP = 0.1;
export const EQUIP_SIZE_DEFAULT = 0.7;

export const snapEquipSize = (v) => Math.min(
  EQUIP_SIZE_MAX,
  Math.max(EQUIP_SIZE_MIN, Math.round(v / EQUIP_SIZE_STEP) * EQUIP_SIZE_STEP),
);

/**
 * One row per equip. `category` decides the silhouette (weapon = round,
 * system = square) and everything downstream reads its numbers from here,
 * so balance lives in exactly one table.
 *
 *  ammo / reload   magazine size and the pause once it runs dry, in seconds
 *  interval        minimum seconds between shots from one plate
 *  auto            true = held trigger keeps firing; false = one per press
 *  shots / spread  pellets per trigger pull, and their half-angle in radians
 *  speed           projectile speed, m/s
 *  colorable       may the player pick the bullet colour?
 */
export const EQUIP_META = {
  [EQUIP.BEAM]: {
    label: 'ビーム', category: 'weapon', plate: 0x2b3a49, accent: 0x7fd4ff,
    colorable: true, bullet: 0x7fd4ff,
    ammo: 6, reload: 1.0, interval: 0.24, auto: false,
    shots: 1, spread: 0, speed: 145, damage: 15, life: 2.2, radius: 0.28, mass: 0.55,
    blurb: '単発のビーム。6発でリロード1秒',
  },
  [EQUIP.GATLING]: {
    label: 'ガトリング', category: 'weapon', plate: 0x2b3a49, accent: 0xffd166,
    colorable: true, bullet: 0xffd166,
    ammo: 30, reload: 3.0, interval: 0.07, auto: true,
    shots: 1, spread: 0.022, speed: 175, damage: 2.4, life: 1.6, radius: 0.13, mass: 0.7,
    blurb: '押しっぱなしで連射。30発でリロード3秒',
  },
  [EQUIP.SHOT]: {
    label: 'ショット', category: 'weapon', plate: 0x2b3a49, accent: 0xff9f5c,
    colorable: true, bullet: 0xff9f5c,
    ammo: 6, reload: 3.0, interval: 0.42, auto: false,
    shots: 3, spread: 0.14, speed: 110, damage: 7, life: 1.1, radius: 0.2, mass: 0.6,
    blurb: '3方向へ拡散。6発でリロード3秒',
  },
  [EQUIP.BLADE]: {
    label: 'ブレード', category: 'weapon', plate: 0x2b3a49, accent: 0xff5c7a,
    colorable: false, bullet: 0xff5c7a,
    ammo: 0, reload: 0, interval: 0, auto: true,
    dps: 42, reach: 1.35, mass: 0.5,
    blurb: '押している間ブロックが光り、触れた敵にダメージ',
  },
  [EQUIP.MISSILE]: {
    label: 'ミサイル', category: 'weapon', plate: 0x2b3a49, accent: 0xb98cff,
    colorable: false, bullet: 0xffd8a8,
    ammo: 3, reload: 3.0, interval: 0.4, auto: false,
    shots: 1, spread: 0.05, speed: 34, damage: 30, life: 6, radius: 0.3, mass: 0.9,
    turn: 3.1,                     // homing authority, rad/s
    blurb: '単発の誘導ミサイル。3発でリロード3秒',
  },
  [EQUIP.BOOST]: {
    label: 'ブースト', category: 'system', plate: 0x243a34, accent: 0x8effc9,
    colorable: false,
    dashBonus: 0.14, mass: 0.35,
    blurb: 'ブーストが使えるようになる。ダッシュの効果も小アップ',
  },
  [EQUIP.ROLLING]: {
    label: 'ローリング', category: 'system', plate: 0x24303a, accent: 0x6fe3ff,
    colorable: false, spins: true,
    rpm: 60, mass: 0.5,
    blurb: '貼りついたブロックを回し続ける。向きと速さを選べる',
  },
  [EQUIP.GRAVITY]: {
    label: 'グラビティ', category: 'system', plate: 0x3a2a24, accent: 0xff7043,
    colorable: false, unique: true,
    hpBonus: 0.45, noFly: true, mass: 1.6,
    blurb: '空中浮遊不可、その代わり耐久アップ（1枚のみ）',
  },
};

/** Rotation limits for a ROLLING plate, in revolutions per minute. */
export const SPIN_RPM_MIN = 5;
export const SPIN_RPM_MAX = 400;

export const EQUIP_TYPES = Object.keys(EQUIP_META);
export const WEAPON_TYPES = EQUIP_TYPES.filter((t) => EQUIP_META[t].category === 'weapon');
export const SYSTEM_TYPES = EQUIP_TYPES.filter((t) => EQUIP_META[t].category === 'system');

/** Round plate for a weapon, square plate for a system. */
export const equipShape = (type) =>
  (EQUIP_META[type]?.category === 'weapon' ? 'round' : 'square');

/** Lock-on accent colour, used by HUD + world reticle. */
export const LOCK_COLOR = '#4fd2ff';

/** Gait keys, and how they read in the UI. */
export const GAIT_LABEL = {
  hover: 'ホバー',
  hop: '単脚',
  walk: '二足歩行',
  multileg: '多脚',
};
