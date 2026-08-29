// ============================================================
//  BLOSTOM : core constants
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
  [BONE.LEG]: {
    label: 'レッグボーン', color: 0x6fe3ff, mass: 1.4, torque: 26,
    blurb: '脚。地面を蹴って進みます。本数が増えるほど接地が安定します',
  },
  [BONE.ARM]: {
    label: 'アームボーン', color: 0xffc861, mass: 1.0, torque: 18,
    blurb: '腕。移動中は歩調と逆に振り、ロックオン中は狙った方を向きます',
  },
  [BONE.FACE]: {
    label: 'フェイスボーン', color: 0xff7ba6, mass: 0.6, torque: 12,
    blurb: '顔。進行方向に傾き、ロックオン中はターゲットを見ます',
  },
  [BONE.CUSTOM]: {
    label: 'カスタムボーン', color: 0xb98cff, mass: 0.9, torque: 15,
    blurb: '自作の動き。軸・波形・速さ・何で駆動するかを自分で決めます',
  },
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
  SNIPER: 'sniper',
  LASER: 'laser',
  SPREAD: 'spread',
  MAGNUM: 'magnum',
  GRENADE: 'grenade',
  SHIELD: 'shield',
  BOOST: 'boost',
  TANK: 'tank',
  GRAVITY: 'gravity',
  ROLLING: 'rolling',
  FLOAT: 'float',
  CIRCLE: 'circle',
};

/** How wide a CIRCLE plate's turning ring can be, in metres. */
export const CIRCLE_RADIUS_MIN = 0.5;
export const CIRCLE_RADIUS_MAX = 6;
export const CIRCLE_RADIUS_STEP = 0.25;
export const CIRCLE_RADIUS_DEFAULT = 2;

export const snapCircleRadius = (v) => Math.min(
  CIRCLE_RADIUS_MAX,
  Math.max(CIRCLE_RADIUS_MIN, Math.round(v / CIRCLE_RADIUS_STEP) * CIRCLE_RADIUS_STEP),
);

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
 *  lead            how much of the intercept a locked shot aims off by, 0..1
 *  colorable       may the player pick the bullet colour?
 *
 * Rounds travel slowly enough to be SEEN, and a lock leads by less than the
 * intercept it can solve. See WEAPON_LEAD below.
 */
export const EQUIP_META = {
  [EQUIP.BEAM]: {
    label: 'ビーム', category: 'weapon', plate: 0x2b3a49, accent: 0x7fd4ff,
    colorable: true, bullet: 0x7fd4ff,
    // A rifle: one heavy shot at a time, drawn as a long thin line. The slow
    // interval is the price of the damage, and it is what stops the beam
    // from being the gatling with better numbers.
    // Range brought down to about the width of the arena. At 246 metres it
    // reached further than anything could be, which made the sniper's one
    // advantage over it imaginary.
    ammo: 5, reload: 1.4, interval: 0.55, auto: false,
    shots: 1, spread: 0, speed: 112, damage: 26, life: 1.1, radius: 0.14, mass: 0.55,
    lead: 0.5,
    shape: 'beam', streak: 6,
    blurb: '長く細い一線を撃つビームライフル。連射は効かない',
  },
  [EQUIP.GATLING]: {
    label: 'ガトリング', category: 'weapon', plate: 0x2b3a49, accent: 0xffd166,
    colorable: true, bullet: 0xffd166,
    // 2.4 a round made this the worst weapon in the game by a wide margin:
    // 14 sustained where the next worst was 20 and the best was 56, on the
    // one gun whose whole identity is holding the trigger down. Held fire
    // also loosens the group now, so it was being charged twice for the
    // thing it is for.
    ammo: 30, reload: 3.0, interval: 0.07, auto: true,
    shots: 1, spread: 0.022, speed: 88, damage: 3.6, life: 1.9, radius: 0.13, mass: 0.7,
    lead: 0.3,
    blurb: '押しっぱなしで連射。30発でリロード3秒',
  },
  [EQUIP.SHOT]: {
    label: 'ショット', category: 'weapon', plate: 0x2b3a49, accent: 0xff9f5c,
    colorable: true, bullet: 0xff9f5c,
    // The tight one. It used to be the spread gun with a third of the
    // throughput and a slightly narrower cone, which is not a niche — so
    // the cone came in and the pellets got heavier. Three aimed slugs at
    // middle distance, against nine thrown ones up close.
    ammo: 6, reload: 3.0, interval: 0.42, auto: false,
    shots: 3, spread: 0.10, speed: 62, damage: 11, life: 1.9, radius: 0.2, mass: 0.6,
    lead: 0.25,
    blurb: '3発をまとめて撃つ。中距離向き。6発でリロード3秒',
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
    colorable: false, bullet: 0xe8e2ff,
    // Five small ones thrown wide, each homing back in: the spread is what
    // makes a salvo read as a salvo rather than one fat round.
    ammo: 2, reload: 3.4, interval: 0.5, auto: false,
    shots: 5, spread: 0.34, speed: 30, damage: 9, life: 6, radius: 0.17, mass: 0.9,
    lead: 0.5,                     // the homing does the rest
    turn: 2.6,                     // homing authority, rad/s
    shape: 'missile', trail: 0xffffff, scatter: 0.55,
    blurb: '小型ミサイルを5発ばらまく。白い航跡を引いて追尾する',
  },
  [EQUIP.SNIPER]: {
    label: 'スナイパー', category: 'weapon', plate: 0x2b3a49, accent: 0x9fffe0,
    colorable: true, bullet: 0x9fffe0,
    // The heaviest single round there is. It has to be: everything else it
    // could claim — reach — stopped being a distinction once the arena
    // turned out to be smaller than the shots.
    ammo: 3, reload: 2.6, interval: 1.1, auto: false,
    shots: 1, spread: 0, speed: 180, damage: 68, life: 3.2, radius: 0.1, mass: 0.9,
    lead: 0.6,                     // the aimed shot, and the closest to right
    shape: 'beam', streak: 14, scope: 0.42,      // FOV multiplier while scoped
    blurb: '超長射程の一撃。スコープ（Q）で狙える',
  },
  [EQUIP.LASER]: {
    label: 'レーザー', category: 'weapon', plate: 0x2b3a49, accent: 0xff5ce0,
    colorable: true, bullet: 0xff5ce0,
    // No magazine: it burns a charge while held, and needs to cool down.
    ammo: 0, reload: 2.2, interval: 0, auto: true,
    beam: { dps: 46, range: 90, width: 0.55, drain: 0.42 },
    speed: 0, mass: 1.0,
    blurb: '押している間、太いレーザーを撃ち続ける。撃ち続けると過熱する',
  },
  [EQUIP.SPREAD]: {
    label: 'スプレッド', category: 'weapon', plate: 0x2b3a49, accent: 0xffe066,
    colorable: true, bullet: 0xffe066,
    // The highest sustained damage in the game, so it pays for it in
    // range: the pellets stop existing at fifty metres. Walk in or do
    // nothing.
    ammo: 8, reload: 2.4, interval: 0.5, auto: false,
    shots: 9, spread: 0.30, speed: 54, damage: 5, life: 0.9, radius: 0.16, mass: 0.75,
    lead: 0.25,
    streak: 1.1,                   // pellets, not tracers
    blurb: '9発を大きく拡散。至近距離なら全弾当たるが、遠くには届かない',
  },
  [EQUIP.MAGNUM]: {
    label: 'マグナム', category: 'weapon', plate: 0x2b3a49, accent: 0xff8a3d,
    colorable: true, bullet: 0xff8a3d,
    // Short life is the range limit: the round simply stops existing.
    ammo: 4, reload: 2.0, interval: 0.7, auto: false,
    shots: 1, spread: 0.01, speed: 70, damage: 44, life: 0.5, radius: 0.34, mass: 0.85,
    lead: 0.2,
    streak: 1.6,                   // a fat slug
    blurb: '至近距離用の一撃。射程は短いが非常に重い',
  },
  [EQUIP.GRENADE]: {
    label: 'グレネード', category: 'weapon', plate: 0x2b3a49, accent: 0x8effc9,
    colorable: true, bullet: 0x8effc9,
    ammo: 3, reload: 2.8, interval: 0.8, auto: false,
    shots: 1, spread: 0.02, speed: 40, damage: 16, life: 4, radius: 0.3, mass: 0.95,
    lead: 0.45,
    shape: 'grenade', gravity: 14, blast: { radius: 7, damage: 34 },
    blurb: '山なりに飛ぶ爆弾。着弾点で小爆発を起こす',
  },
  [EQUIP.SHIELD]: {
    label: 'シールド', category: 'weapon', plate: 0x2b3a49, accent: 0x6fb7ff,
    colorable: true, bullet: 0x6fb7ff,
    ammo: 2, reload: 5.0, interval: 1.2, auto: false,
    speed: 0, mass: 1.2,
    shield: { hp: 90, seconds: 7, ram: 26, reach: 1.1 },
    blurb: '機体を覆うバリアを張る。体当たりでダメージ、時間で消える',
  },

  [EQUIP.BOOST]: {
    label: 'ブースト', category: 'system', plate: 0x243a34, accent: 0x8effc9,
    colorable: false,
    dashBonus: 0.14, mass: 0.35,
    blurb: 'ブーストが使えるようになる。ダッシュの効果も小アップ',
  },
  [EQUIP.TANK]: {
    label: 'エナジータンク', category: 'system', plate: 0x243a34, accent: 0xffd166,
    colorable: false,
    /**
     * A bigger tank, and a slower one to fill.
     *
     * Energy is what pays for flight, for the boost and for every dash, and
     * it was one fixed size on every machine — so how long you could stay
     * off the ground was not something anybody could build for.
     *
     * A tank buys ENDURANCE, not free fuel: everything drains as a smaller
     * fraction of a larger tank, and refills as a smaller fraction too. So
     * it suits a machine that wants one long flight, and costs a machine
     * that wants to be topped up between short hops — plus it is heavy,
     * which is felt everywhere else.
     */
    energyBonus: 0.55, mass: 1.3,
    blurb: 'ブーストゲージが増える。長く飛べるが、満タンに戻るのも遅くなる。重い',
  },
  [EQUIP.ROLLING]: {
    label: 'ローリング', category: 'system', plate: 0x24303a, accent: 0x6fe3ff,
    colorable: false, spins: true,
    rpm: 60, mass: 0.5,
    blurb: '貼りついたブロックを回し続ける。向きと速さを選べる',
  },
  [EQUIP.GRAVITY]: {
    label: 'グラビティ', category: 'system', plate: 0x3a2a24, accent: 0xff7043,
    colorable: false, unique: true, conflicts: [EQUIP.FLOAT],
    hpBonus: 0.45, noFly: true, mass: 1.6,
    blurb: '空中浮遊不可、その代わり耐久アップ（1枚のみ）',
  },
  [EQUIP.FLOAT]: {
    label: 'フロート', category: 'system', plate: 0x243044, accent: 0xa8c8ff,
    colorable: false, unique: true, conflicts: [EQUIP.GRAVITY],
    hover: 1.4, mass: 1.1,
    blurb: '常に地面から少し浮く。脚は接地しない（1枚のみ）',
  },
  [EQUIP.CIRCLE]: {
    label: 'サークル', category: 'system', plate: 0x223a34, accent: 0x7fffd4,
    colorable: false, spins: true, ring: true,
    rpm: 40, mass: 0.7,
    blurb: '貼った場所を中心に円線を引き、その線の上のパーツを線に沿って回す',
  },
};

/**
 * Which way a CIRCLE plate's line lies.
 *
 * The plate alone cannot decide this. Stuck on a deck the obvious circle is
 * flat; stuck on a chest the obvious circle is usually still flat, and the
 * plate's own facing would stand it up on edge. Before this was settable,
 * putting the plate on the wrong face drew the line somewhere nothing was
 * standing, and the answer looked like "the gimmick is broken".
 */
export const RING_PLANES = [
  { id: 'face', label: '面に沿う', note: '貼った面と同じ向き（既定）' },
  { id: 'pitch', label: '縦（前後）', note: '面から90°起こす' },
  { id: 'roll', label: '縦（左右）', note: '面から90°倒す' },
];
export const RING_PLANE_IDS = RING_PLANES.map((r) => r.id);
export const RING_PLANE_DEFAULT = 'face';
export const isRingPlane = (v) => RING_PLANE_IDS.includes(v);

/** Rotation limits for a ROLLING plate, in revolutions per minute. */
export const SPIN_RPM_MIN = 5;
export const SPIN_RPM_MAX = 400;

/**
 * How much of a solved intercept a locked shot is allowed to use.
 *
 * A weapon that leads perfectly cannot be dodged: whatever the target does,
 * the round is already on its way to where the target will be, and a lock
 * stops being aim and starts being a guarantee. Aiming SHORT of the
 * intercept is what turns "the shot lands" into "the shot is going THERE —
 * move", which is the only version of this that is worth playing.
 *
 * Per weapon, because the ones you point should be allowed to be right and
 * the ones you spray should not. Together with rounds slow enough to watch
 * cross the gap, sidestepping and dashing become the answer to being shot
 * at, rather than decoration on a fight that was already decided.
 */
export const WEAPON_LEAD_DEFAULT = 0.4;
export const weaponLead = (meta) =>
  Math.min(1, Math.max(0, meta?.lead ?? WEAPON_LEAD_DEFAULT));

/**
 * When a hit is hard enough to rock the machine.
 *
 * Measured against the durability of the machine that took it, so a heavy
 * chassis shrugs off what folds a light one, and accumulated over a short
 * window so a shotgun's nine pellets land as one blow rather than nine
 * unnoticeable ones. A stream of small rounds never reaches the threshold:
 * held fire is supposed to whittle, not to stunlock.
 */
export const STAGGER = {
  /** Damage inside one window that starts a stagger, as a fraction of max HP. */
  threshold: 0.08,
  /** This much again on top of it is a full one. */
  span: 0.22,
  /** How fast the running total of recent damage bleeds away, in seconds. */
  memory: 0.18,
  /** Knockback of a full stagger, in m/s. */
  knockback: 9.5,
  /** How long a full stagger holds the machine, in seconds. */
  seconds: 0.45,
  /** How much of the machine's own thrust a full stagger takes away. */
  authority: 0.85,
  /** Rocked this hard, the trigger stops answering. */
  fireBlock: 0.35,

  /**
   * Past a full stagger, the blow stops rocking the machine and starts
   * THROWING it.
   *
   * A cap at "as rocked as it gets" makes every heavy weapon feel the same
   * once it clears the bar — a magnum and a sniper round through the chest
   * both just wobble you. Letting the figure run past 1 gives the top end
   * somewhere to go: the machine leaves the floor, loses the fight for as
   * long as it is in the air, and has to land before it can do anything.
   *
   * `launchAt` is the blow that starts lifting; `launchFull` is the one that
   * lifts as hard as it gets. Both are in units of "one full stagger", so
   * they scale with the machine that took it.
   */
  launchAt: 1,
  launchFull: 2.2,
  /** Extra shove a full launch adds along the blow, in m/s. */
  launchPush: 15,
  /** And how much of it goes UP — enough to take the feet off the floor. */
  launchLift: 8.5,
  /** How fast a downed machine gets its feet back, once it has landed. */
  riseSeconds: 0.55,
};

/**
 * Sliding: what a two-legged machine does when it is going sideways faster
 * than it could ever step.
 *
 * Past its own dash speed there is no gait left to run — the legs cannot
 * reach that far that fast — so the machine stops pretending to walk. It
 * plants both legs on the trailing side, leans into the direction it is
 * carried, and skates. That is what the numbers were already saying; it was
 * just still animating a stride.
 */
export const SLIDE = {
  /**
   * A slide begins where the machine's own legs give out — its ground
   * speed cap — and is complete at its dash speed.
   *
   * Both figures come from the machine, so this is not a number anyone
   * picked: below the cap it can walk that fast, so it walks. Above it, it
   * is being carried, and the only thing that gets it there sideways is a
   * dash — an impulse rather than a thrust. So a lateral dash starts fully
   * sideways and skates out of it as the speed bleeds back down to a walk,
   * and nothing a machine does under its own power ever slides.
   */
  /**
   * Rise and fall half-lives: it snaps on, and eases off.
   *
   * The rise is very short because the speed it is tracking is not: a dash
   * is an impulse and the drag above the walking cap eats it in about a
   * fifth of a second, so anything slower to react never sees the peak.
   */
  riseHalfLife: 0.015,
  fallHalfLife: 0.12,
  /** How far the legs cant over, in degrees. */
  tilt: 42,
  /** How much of the tilt each joint further down the leg takes. */
  taper: 0.6,
  /** Extra body lean into the slide, in radians. */
  lean: 0.16,
};

/**
 * When coming down off something counts as a LANDING rather than a step.
 *
 * A machine that drops out of the sky and carries on running as if nothing
 * happened weighs nothing, whatever the numbers say. Planting itself — a
 * brace, a ring of dust, a moment of settling — is where the weight is
 * actually felt.
 *
 * Gated on the machine's own weight, because that is the whole point: a
 * light frame touches down and a heavy one arrives. A skirmisher that
 * braced every time it hopped would just feel sluggish.
 */
export const LANDING = {
  /** Below this weight class a machine only ever touches down... */
  weight: 0.22,
  /** ...and at this one it plants itself as hard as it gets. */
  full: 0.58,
  /** Downward speed, m/s, at which a landing starts to count... */
  speed: 8,
  /**
   * ...and at which it is as planted as it gets.
   *
   * Well under what free-fall would reach, because the machine never does:
   * drag settles a long drop at about thirteen metres a second, and a
   * ceiling nothing can touch is a ceiling that does nothing.
   */
  hard: 17,
  /** How long the brace holds, in seconds. */
  seconds: 0.42,
};

export const EQUIP_TYPES = Object.keys(EQUIP_META);
/**
 * How many weapon plates one machine may carry.
 *
 * There was no limit, and plate mass is under a tenth of what a machine
 * weighs — so bolting on all ten and cycling through them was strictly
 * better than choosing, and the ten different cost structures never became
 * a question anybody had to answer. Four is enough for a close weapon, a
 * long one and two opinions.
 */
export const WEAPON_SLOTS = 4;

export const WEAPON_TYPES = EQUIP_TYPES.filter((t) => EQUIP_META[t].category === 'weapon');
export const SYSTEM_TYPES = EQUIP_TYPES.filter((t) => EQUIP_META[t].category === 'system');

/** Round plate for a weapon, square plate for a system. */
export const equipShape = (type) =>
  (EQUIP_META[type]?.category === 'weapon' ? 'round' : 'square');

/** Lock-on accent colour, used by HUD + world reticle. */
export const LOCK_COLOR = '#4fd2ff';

/**
 * Gait keys.
 *
 * Internal only, and deliberately unlabelled. Naming the categories on
 * screen — "one leg", "two legs", "many" — turns a machine you BUILT into a
 * machine that belongs to a class, and invites the player to build toward
 * the label rather than toward the shape they wanted. The leg count is
 * shown, because it is a fact about the parts; what the count implies is
 * left to the machine's own behaviour.
 */
export const GAITS = ['hover', 'hop', 'walk', 'multileg'];
