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
  WEAPON: 'weapon',
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
  [BONE.WEAPON]: {
    label: 'ウェポンボーン', color: 0x8effc9, mass: 0.9, torque: 15,
    blurb: '決めた武器を選んでいる間だけ構えます。切り替えた瞬間だけ動きます',
  },
};

/**
 * A weapon bone's two poses, and how it moves between them.
 *
 * Bound to a weapon TYPE rather than to a rack index: an index shifts the
 * moment another plate is fitted, so every bone on the machine would change
 * meaning. "The arm that raises for the sniper" stays that arm for ever.
 */
export const WEAPON_BONE_DEFAULT = {
  when: 'any',        // an EQUIP id, or 'any' for "something is selected"
  axis: 'x',
  stowed: 0,
  deployed: -60,
  speed: 3.2,
  overshoot: 0.18,
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
  pulse: { label: '打つ（鋭く出て、ゆるく戻る）' },
  noise: { label: 'ゆらぎ（不規則）' },
  saw: { label: '回転（ぐるぐる）', spins: true },
};

/**
 * What a bone can listen to.
 *
 * The first six are all about MOVING. Nothing here was about fighting, which
 * is why a machine looked the same whether it was full of holes and out of
 * ammunition or fresh off the bench.
 */
export const CUSTOM_SOURCES = [
  ['time', '常時'], ['stride', '歩調'], ['speed', '速度'],
  ['thrust', '推力'], ['jerk', '衝撃'], ['aim', 'ロックオン'],
  ['boost', 'ブースト'], ['landing', '着地'],
  ['recoil', '発砲'], ['damage', '被弾'],
  ['hp', '損傷'], ['energy', 'EN残量'], ['weapon', '武器切替'],
];

/** Default motion for a freshly placed custom bone. */
export const CUSTOM_DEFAULT = {
  axis: 'x', amp: 30, freq: 1.0, phase: 0, offset: 0, wave: 'sine', source: 'time',
  /**
   * A second wave, added on top of the first.
   *
   * One wave can be slow and wide or quick and small, never both — so
   * "sways heavily while trembling" was not expressible at all. Zero
   * amplitude means it costs nothing and does nothing, which is the default.
   */
  amp2: 0, freq2: 4, wave2: 'sine',
  /**
   * Whether a continuous rotation still respects the joint's travel.
   *
   * `saw` ignores the limit outright, because a propeller that stops at 70°
   * is not a propeller. But that left no way to build a fast, wide SWEEP
   * that still stops — a radar head, a turret ring with end stops.
   */
  bounded: false,
  /** How much the resting angle itself moves with the drive. */
  offsetGain: 0,
};

/**
 * How a bone follows the pose being asked of it.
 *
 * Every joint used to be slerped at one global rate, so a two-tonne arm and
 * a whip aerial settled at exactly the same speed. `damping` under 1 lets a
 * joint overshoot and come back, which is most of what makes a light part
 * read as light.
 */
export const BONE_FOLLOW_DEFAULT = {
  /** Half-life towards the target, in seconds. 0 uses the global rate. */
  ease: 0,
  /** 1 = settles straight onto it, below 1 = overshoots and returns. */
  damping: 1,
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

/**
 * How far a chained bone takes of what its root is doing.
 *
 * Hard-wired at 0.55 per link, which puts a third link at 0.166 — fine for
 * a forearm and useless for a tentacle, where every segment should take
 * nearly all of it.
 */
export const CHAIN_FALLOFF_DEFAULT = 0.55;

/**
 * What happens when a bone is asked for more travel than it has.
 *
 * It always stopped. A joint that stops dead is right for a hard end stop
 * and wrong for a sprung one, and there was no way to ask for the other.
 */
export const LIMIT_MODES = [
  ['clamp', '止まる'], ['bounce', '跳ね返る'], ['wrap', '回り込む'],
];

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
    label: 'ビーム', en: 'BEAM', category: 'weapon', plate: 0x2b3a49, accent: 0x7fd4ff,
    colorable: true, bullet: 0x7fd4ff,
    // A rifle: one heavy shot at a time, drawn as a long thin line. The slow
    // interval is the price of the damage, and it is what stops the beam
    // from being the gatling with better numbers.
    // Range brought down to about the width of the arena. At 246 metres it
    // reached further than anything could be, which made the sniper's one
    // advantage over it imaginary.
    ammo: 5, reload: 1.4, interval: 0.55, auto: false,
    shots: 1, spread: 0, speed: 112, damage: 26, life: 1.1, radius: 0.14, mass: 0.55,
    lead: 0.95,   // aimed, and fast enough that the dodge is tight
    shape: 'beam', streak: 6,
    blurb: '長く細い一線を撃つビームライフル。連射は効かない',
  },
  [EQUIP.GATLING]: {
    label: 'ガトリング', en: 'GATLING', category: 'weapon', plate: 0x2b3a49, accent: 0xffd166,
    colorable: true, bullet: 0xffd166,
    // 2.4 a round made this the worst weapon in the game by a wide margin:
    // 14 sustained where the next worst was 20 and the best was 56, on the
    // one gun whose whole identity is holding the trigger down. Held fire
    // also loosens the group now, so it was being charged twice for the
    // thing it is for.
    // Still bottom of the table on both measures after the last pass — 21.2
    // sustained and 4 a trigger — with no advantage anywhere else to show
    // for it. A gun whose whole idea is holding the trigger down should not
    // be the worst gun for holding the trigger down.
    ammo: 30, reload: 2.6, interval: 0.07, auto: true,
    shots: 1, spread: 0.022, speed: 88, damage: 4.4, life: 1.9, radius: 0.13, mass: 0.7,
    lead: 0.95,   // a stream: what it needs is to be pointed right
    blurb: '押しっぱなしで連射。30発でリロード3秒',
  },
  [EQUIP.SHOT]: {
    label: 'ショット', en: 'SHOT', category: 'weapon', plate: 0x2b3a49, accent: 0xff9f5c,
    colorable: true, bullet: 0xff9f5c,
    // The tight one. It used to be the spread gun with a third of the
    // throughput and a slightly narrower cone, which is not a niche — so
    // the cone came in and the pellets got heavier. Three aimed slugs at
    // middle distance, against nine thrown ones up close.
    ammo: 6, reload: 3.0, interval: 0.42, auto: false,
    shots: 3, spread: 0.10, speed: 62, damage: 11, life: 1.9, radius: 0.2, mass: 0.6,
    lead: 0.95,
    blurb: '3発をまとめて撃つ。中距離向き。6発でリロード3秒',
  },
  [EQUIP.BLADE]: {
    label: 'ブレード', en: 'BLADE', category: 'weapon', plate: 0x2b3a49, accent: 0xff5c7a,
    colorable: false, bullet: 0xff5c7a,
    ammo: 0, reload: 0, interval: 0, auto: true,
    dps: 42, reach: 1.35, mass: 0.5,
    /**
     * What holding it lit costs, as a fraction of the tank per second.
     *
     * It had no magazine, no reload and no heat, so it was the one weapon
     * with no price at all: hold it down for the whole fight and never
     * think about it. Energy is the price a blade should pay — the same
     * tank that flies the machine — so keeping it lit is a decision against
     * staying in the air, which is exactly the trade a melee weapon ought
     * to force.
     */
    drain: 0.34,
    blurb: '押している間ブロックが光り、触れた敵にダメージ。ENを消費する',
  },
  [EQUIP.MISSILE]: {
    label: 'ミサイル', en: 'MISSILE', category: 'weapon', plate: 0x2b3a49, accent: 0xb98cff,
    colorable: false, bullet: 0xe8e2ff,
    // Five small ones thrown wide, each homing back in: the spread is what
    // makes a salvo read as a salvo rather than one fat round.
    ammo: 2, reload: 3.4, interval: 0.5, auto: false,
    shots: 5, spread: 0.34, speed: 30, damage: 9, life: 6, radius: 0.17, mass: 0.9,
    lead: 0.85,   // it homes; being roughly right is enough
    turn: 2.6,                     // homing authority, rad/s
    shape: 'missile', trail: 0xffffff, scatter: 0.55,
    blurb: '小型ミサイルを5発ばらまく。白い航跡を引いて追尾する',
  },
  [EQUIP.SNIPER]: {
    label: 'スナイパー', en: 'SNIPER', category: 'weapon', plate: 0x2b3a49, accent: 0x9fffe0,
    colorable: true, bullet: 0x9fffe0,
    // The heaviest single round there is. It has to be: everything else it
    // could claim — reach — stopped being a distinction once the arena
    // turned out to be smaller than the shots.
    // Rebuilt around the one thing it is for: the shot that lands.
    //
    // On paper it was already competitive — thirty-five sustained, the same
    // as a SHOT plate. In a fight it was not, and the reason was that every
    // part of it punished a miss: 1.1s between shots, a third of the
    // magazine gone, a round slow enough (180 m/s) that a moving target had
    // a second to not be there, and an aim assist told to lead only 60% of
    // the intercept. Four separate taxes on the same event.
    //
    // So: a faster round, a better lead, a shorter gate between shots, and
    // a hit that is worth having waited for. The commitment stays — three
    // rounds, a long reload — because that IS the weapon.
    //
    // Two limits are NOT crossed, and the suite holds both:
    //
    //   - 25m must take more than a tenth of a second, or the round cannot
    //     be seen crossing the gap, let alone avoided. That caps the speed
    //     at 250 and it sits at 240.
    //   - lead must stay under 1, or the lock solves the intercept exactly
    //     and the shot goes where the target is going to be whatever the
    //     target does. 0.9 is as close as it is allowed to get, and it is a
    //     long way from the 0.6 it had.
    /*
     * Slower than it was, and that is the whole fix.
     *
     * Measured over a full magazine and reload, the sniper was doing 51.4
     * sustained against the beam's 31.3 — while ALSO hitting for 96 a shot
     * against 26, at 240 m/s against 112, with no spread against none. It
     * was not a trade, it was a strictly better gun, and with six weapon
     * slots the best loadout was six of them.
     *
     * The identity is "one shot, and it hurts". So the shot stays exactly
     * as heavy and the gap between shots is what pays for it: 28.8
     * sustained now, comfortably under the beam.
     *
     * ---- and then the range itself was measured
     *
     * 240 m/s for 3.2s is 768 metres. The widest arena in the game is 380
     * across and most are between 176 and 300, so THE ONE THING THIS
     * WEAPON IS FOR could not be experienced: there was nowhere far enough
     * away to shoot from. Worse, the note further up says the rifle's range
     * was cut specifically to make the sniper's range advantage real — an
     * advantage that had never been reachable, so that change only made the
     * rifle worse.
     *
     * A long range is not a feature if every fight happens inside it. So
     * the range now DOES something: the further a round travels, the harder
     * it lands. See `rangeGain` below.
     */
    ammo: 3, reload: 4.0, interval: 2.0, auto: false,
    /*
     * 900 m/s, and 0.5s of it — 450 metres, which is just past the widest
     * arena instead of twice it.
     *
     * The old speed was capped at 250 by a rule the suite holds: a round
     * must take more than a tenth of a second to cross 25 metres, or it
     * cannot be seen, let alone avoided. That rule was right, and the
     * falloff below is what lets this cross it — a round that arrives
     * instantly at 25 metres now does a THIRD of its damage, and the
     * distance where it does full damage (125m) still takes 0.14s to
     * reach. The rule has not been dropped; it has been moved to where it
     * matters, which is where the shot hurts.
     */
    shots: 1, spread: 0, speed: 900, damage: 70, life: 0.5, radius: 0.14, mass: 0.9,
    /**
     * Damage by how far the round flew.
     *
     * Weak in your face, enormous across the arena. `near` and `far` are
     * metres, `min` and `max` multiply the damage, and it is linear
     * between them and clamped outside.
     *
     * The numbers are chosen against the ARENAS rather than in the
     * abstract, which is the whole point of the change:
     *
     *     廃工場  176m across  ->  reaches x1.3   (92 damage)
     *     演習場  240m         ->  x1.7          (117)
     *     塩湖    300m         ->  x2.1          (145)
     *     宇宙    380m         ->  x2.2, capped  (154)
     *
     * So WHERE you fight now decides what this weapon is worth, and a
     * sniper in a scrapyard is a bad choice rather than a free one.
     */
    rangeGain: { near: 20, far: 320, min: 0.35, max: 2.2 },
    lead: 0.95,                     // the best-aimed shot there is, still dodgeable
    shape: 'beam', streak: 20,
    blurb: '距離で威力が変わる。至近で1/3、遠いほど重い。弾速は最速',
  },
  [EQUIP.LASER]: {
    label: 'レーザー', en: 'LASER', category: 'weapon', plate: 0x2b3a49, accent: 0xff5ce0,
    colorable: true, bullet: 0xff5ce0,
    // No magazine: it burns a charge while held, and needs to cool down.
    ammo: 0, reload: 2.2, interval: 0, auto: true,
    beam: { dps: 46, range: 90, width: 0.55, drain: 0.42 },
    speed: 0, mass: 1.0,
    blurb: '押している間、太いレーザーを撃ち続ける。撃ち続けると過熱する',
  },
  [EQUIP.SPREAD]: {
    label: 'スプレッド', en: 'SPREAD', category: 'weapon', plate: 0x2b3a49, accent: 0xffe066,
    colorable: true, bullet: 0xffe066,
    // The highest sustained damage in the game, so it pays for it in
    // range: the pellets stop existing at fifty metres. Walk in or do
    // nothing.
    ammo: 8, reload: 2.4, interval: 0.5, auto: false,
    shots: 9, spread: 0.30, speed: 54, damage: 5, life: 0.9, radius: 0.16, mass: 0.75,
    lead: 0.95,   // nine pellets, and they all want the same answer
    streak: 1.1,                   // pellets, not tracers
    blurb: '9発を大きく拡散。至近距離なら全弾当たるが、遠くには届かない',
  },
  [EQUIP.MAGNUM]: {
    label: 'マグナム', en: 'MAGNUM', category: 'weapon', plate: 0x2b3a49, accent: 0xff8a3d,
    colorable: true, bullet: 0xff8a3d,
    // Short life is the range limit: the round simply stops existing.
    ammo: 4, reload: 2.0, interval: 0.7, auto: false,
    shots: 1, spread: 0.01, speed: 70, damage: 44, life: 0.5, radius: 0.34, mass: 0.85,
    lead: 0.95,   // one heavy round, and it should land
    streak: 1.6,                   // a fat slug
    blurb: '至近距離用の一撃。射程は短いが非常に重い',
  },
  [EQUIP.GRENADE]: {
    label: 'グレネード', en: 'GRENADE', category: 'weapon', plate: 0x2b3a49, accent: 0x8effc9,
    colorable: true, bullet: 0x8effc9,
    ammo: 3, reload: 2.8, interval: 0.8, auto: false,
    shots: 1, spread: 0.02, speed: 40, damage: 16, life: 4, radius: 0.3, mass: 0.95,
    lead: 0.88,   // a seven-metre blast forgives the rest
    shape: 'grenade', gravity: 14, blast: { radius: 7, damage: 34 },
    blurb: '山なりに飛ぶ爆弾。着弾点で小爆発を起こす',
  },
  [EQUIP.SHIELD]: {
    label: 'シールド', en: 'SHIELD', category: 'weapon', plate: 0x2b3a49, accent: 0x6fb7ff,
    colorable: true, bullet: 0x6fb7ff,
    ammo: 2, reload: 5.0, interval: 1.2, auto: false,
    speed: 0, mass: 1.2,
    shield: { hp: 90, seconds: 7, ram: 26, reach: 1.1 },
    blurb: '機体を覆うバリアを張る。体当たりでダメージ、時間で消える',
  },

  [EQUIP.BOOST]: {
    label: 'ブースト', en: 'BOOST', category: 'system', plate: 0x243a34, accent: 0x8effc9,
    colorable: false,
    dashBonus: 0.14, mass: 0.35,
    blurb: 'ブーストが使えるようになる。ダッシュの効果も小アップ',
  },
  [EQUIP.TANK]: {
    label: 'エナジータンク', en: 'E-TANK', category: 'system', plate: 0x243a34, accent: 0xffd166,
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
    label: 'ローリング', en: 'ROLL', category: 'system', plate: 0x24303a, accent: 0x6fe3ff,
    colorable: false, spins: true,
    rpm: 60, mass: 0.5,
    blurb: '貼りついたブロックを回し続ける。向きと速さを選べる',
  },
  [EQUIP.GRAVITY]: {
    label: 'グラビティ', en: 'GRAVITY', category: 'system', plate: 0x3a2a24, accent: 0xff7043,
    colorable: false, unique: true, conflicts: [EQUIP.FLOAT],
    hpBonus: 0.45, noFly: true, mass: 1.6,
    blurb: '空中浮遊不可、その代わり耐久アップ（1枚のみ）',
  },
  [EQUIP.FLOAT]: {
    label: 'フロート', en: 'FLOAT', category: 'system', plate: 0x243044, accent: 0xa8c8ff,
    colorable: false, unique: true, conflicts: [EQUIP.GRAVITY],
    hover: 1.4, mass: 1.1,
    blurb: '常に地面から少し浮く。脚は接地しない（1枚のみ）',
  },
  [EQUIP.CIRCLE]: {
    label: 'サークル', en: 'CIRCLE', category: 'system', plate: 0x223a34, accent: 0x7fffd4,
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
 * ---- how short, exactly
 *
 * These were 0.2 to 0.5, chosen by feel, and the feel was wrong. Worked out
 * rather than guessed, against a machine crossing at fifteen metres a
 * second — which is a walk, not a sprint:
 *
 *     weapon    aimed short by
 *     gatling   2.9m at 30m,  8.6m at 60m
 *     shot      4.4m at 30m, 13.1m at 60m
 *     magnum    4.1m at 30m
 *     missile   6.0m at 30m
 *
 * A machine is three to six metres across. Missing by nine is not the
 * target dodging — it is the gun pointing somewhere else, at a target
 * walking in a straight line, with a lock on it. That is the whole of the
 * complaint that rounds do not connect.
 *
 * The first fix aimed short by about the width of a machine. That was still
 * wrong, and wrong in a way worth writing down: a FRACTION of the intercept
 * is an error PROPORTIONAL TO RANGE, and the target does not get bigger with
 * range. Whatever fraction is chosen, there is a distance past which every
 * shot misses a target walking in a straight line — measured, a gatling at
 * 0.72 hit 7% of its rounds against a steady target at thirty-five metres.
 *
 * So the aim is allowed to be right, and the DODGE IS THE FLIGHT TIME. A
 * gatling round takes two thirds of a second to cross sixty metres; the
 * solution was computed for the course the target was on when it left the
 * barrel, and a target that changes course inside that time is not there any
 * more. That is dodging, and it is a decision the player makes rather than
 * an error the gun makes for them.
 *
 * Held just under one so that a target which is merely turning — rather than
 * reversing — is still clipped rather than cleanly missed.
 */
export const WEAPON_LEAD_DEFAULT = 0.95;
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
  /**
   * How much of a blow a machine's own weight absorbs.
   *
   * The same shell knocked a two-hundred-tonne siege frame exactly as far
   * off its feet as a four-tonne drone. Weight is what a blow has to move.
   */
  brace: 1.6,
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
/**
 * How a machine settles where there is no gravity to settle it.
 *
 * Every other arena stops a machine with the floor. Weightless, nothing is
 * in the way, so a tap of the thruster is a one-way trip to the ceiling
 * unless the machine holds itself steady when nobody is asking it to move.
 * This is per second, applied as a fraction of the velocity.
 */
export const DRIFT = {
  /** Hands off the controls: it comes to a stop in a couple of seconds. */
  idle: 1.15,
  /** Under thrust: almost none, so a burn still goes somewhere. */
  thrusting: 0.16,
};

/**
 * What the air does to a machine that is not flying through it.
 *
 * The drag model is tuned for thrust, and applied to a free drop it pinned
 * the descent at 13.5 m/s — a twenty-metre machine took eight seconds to
 * come down off a rooftop and never once looked like it was falling.
 */
export const FALL = {
  /**
   * Below this the drag model has it, and nothing here applies.
   *
   * Measured at 12: the drag settles a machine at about 14 m/s, and the
   * ramp had only reached 3% of its strength by then — so the counter to
   * the drag was, at exactly the speed the drag mattered, worth 0.8 m/s²
   * against a gravity of 22. A jump ended with the machine drifting down.
   */
  softFrom: 8,
  /** Where the extra pull is at full strength. */
  terminal: 26,
  /** How hard, in m/s². Enough to feel, not enough to be a second gravity. */
  pull: 26,
};

/**
 * How much of its sideways push a machine keeps once its feet are off the
 * ground.
 *
 * Uncapped, strafing while hovering reached 20.8 m/s against 9.9 running —
 * flying sideways was twice as good at everything and the floor became a
 * place you left and never came back to.
 */
export const AIR = {
  lateral: 0.45,
};

/**
 * How firmly a hovering machine holds its own position.
 *
 * With its feet off the ground there is no friction, so a light hover build
 * took 2.1 seconds to come to rest — LONGER than a two-hundred-tonne frame
 * on its feet, which is exactly backwards. Thrusters that can hold a machine
 * up can hold it still; per second, and only while nothing is being asked
 * of them, so a deliberate drift still drifts.
 */
export const HOVER = {
  hold: 2.6,
};

/**
 * Giving ground with a target held.
 *
 * The retreat borrowed the sideways skate to begin with, and it was wrong
 * in a way you could see: that pose cants the legs onto whichever side the
 * machine is being carried toward, and a machine going straight backwards
 * has no side. The tiny left-right jitter in its lateral speed decided the
 * lean, so the legs flicked between canting left and canting right.
 *
 * A retreat is a shape of its own. The feet are held out AHEAD — the floor
 * keeping them where they were while the body is taken back — and the body
 * leans into the direction it came from. Nothing in it is left or right.
 */
export const RETREAT = {
  /** On fast, off slowly: the same reasoning as the skate. */
  riseHalfLife: 0.05,
  fallHalfLife: 0.16,
  /** How far the legs reach out in front, in degrees. */
  plant: 26,
  /** How much the knee gives under it, in degrees. */
  knee: 18,
  /** How much of the plant each joint further down the leg takes. */
  taper: 0.55,
  /**
   * How much the two legs disagree about the plant, as a fraction of it.
   * Both legs reaching out by exactly the same amount is a machine standing
   * to attention while it slides; one foot ahead of the other is a stance.
   */
  stagger: 0.4,
  /** Body pitch into the retreat, in radians. */
  lean: 0.1,
};

/**
 * How the walk turns into a run, and where it gives out.
 *
 * The gait used to pick its stride length out of a formula — leg count and
 * machine size — and its swing out of a second, unrelated one. The two
 * disagreed. The clock was counting steps 2.16m long while the legs were
 * swinging 0.9m, so more than half of every step was the planted foot being
 * dragged across the floor. That drag is what a skitter IS: the machine
 * moving three times faster than its feet.
 *
 * So the step comes from the leg now, and the swing is solved for the
 * ground rather than chosen. What is left over is the interesting part —
 * above the speed the legs can honestly carry, there is no stride that
 * works, and pretending otherwise is where the skittering came from.
 */
export const RUN = {
  /** The widest a hip swings from centre, in degrees. */
  swing: 46,
  /**
   * The shortest step, as a fraction of the longest.
   *
   * Below this the machine keeps its stride and slows its feet, which is
   * what walking slowly is. Above it the stride opens instead.
   */
  minStep: 0.3,
  /**
   * Where the stride is fully open, as a fraction of the machine's own
   * ground speed. Under that it lengthens its step; over it, it can only
   * take them faster.
   */
  openAt: 0.5,
  /**
   * The fastest the legs will cycle, in strides per second.
   *
   * Not a taste: past about this the joint slew cannot deliver the swing
   * being asked for, so the pose gets quietly smaller the harder it is
   * driven. A cadence nobody can reach is the same as no cadence.
   *
   * Set where the fastest thing a machine can do UNDER ITS OWN POWER is
   * still a run. Measured in the arena: a two-legger holding forward
   * settles around 21 m/s, and a cap that gave up below that would have
   * handed normal running to the skate — which is the opposite of the
   * point. Above it is a dash or a boost, and nothing else.
   */
  cadence: 4.0,
  /**
   * How far the slew compensation may push a commanded swing.
   *
   * A joint stops at 70 degrees, and a swing driven past that arrives with
   * its peaks cut flat — which is its own kind of wrong. So the legs were
   * given a faster slew instead (LEG_SLEW), and what is left to make up
   * fits inside the stops.
   */
  maxDrive: 1.9,
  /**
   * How far a machine may step sideways, as a multiple of how wide it
   * stands.
   *
   * A side-step is not a stride turned ninety degrees. The stride is as
   * long as the leg reaches, and reaching that far sideways swings the leg
   * straight through the other one: a TITAN was taking 4.8m steps across a
   * stance 2.75m wide, which is two metres of leg passing through leg. It
   * opened wide, shut, and looked wrong, because it was.
   */
  sideStep: 1.0,
  /** Rise and fall half-lives of the forward skate. Snaps on, eases off. */
  riseHalfLife: 0.03,
  fallHalfLife: 0.14,
  /** How far past the honest top speed the skate takes over completely. */
  overrun: 0.3,
};

/**
 * How hard a leg joint chases its pose, as a multiple of the standard slew.
 *
 * Shared between the slew itself and the gait's compensation for it: the
 * gait has to know exactly how much of its swing the filter is going to
 * eat, and two copies of this number would drift apart.
 */
export const LEG_SLEW = 3.0;

/**
 * The two axes a shoulder and a hip were not using.
 *
 * Measured on a walking machine: hips swung 88 degrees fore and aft and
 * exactly ZERO about the other two. A shoulder and a hip are ball joints,
 * and the rig was working them as hinges — which is what "stiff" is. Not a
 * small swing; a swing in one flat plane, like a pendulum on a pin.
 *
 * The fix is not more of the same axis. It is a second one, driven from the
 * SAME gait phase a quarter of a cycle later — because two sines a quarter
 * apart trace an ELLIPSE, and a limb whose tip goes round a closed curve
 * reads as a joint rather than as a hinge. That phase offset is the whole
 * idea; the amplitudes below are small on purpose.
 */
export const BALL = {
  /** Hip: how far the leg opens away from the body, in degrees. */
  hipSplay: 9,
  /** Hip: how far the thigh rolls, in degrees. */
  hipTwist: 8,
  /** Shoulder: how far the arm swings away from the ribs. */
  armSplay: 9,
  /** Shoulder: how far the upper arm rolls. */
  armTwist: 7,
  /** Where the second axis sits against the first, in cycles. */
  splayPhase: 0.25,
  twistPhase: 0.5,
  /**
   * How much each link further down a chain lags the one above it, in
   * cycles.
   *
   * A forearm that moves at the same instant as the upper arm is one rigid
   * piece with a bend in it. Lagging it slightly gives the whip that says
   * the arm is being carried rather than aimed. Per-bone `lag` still wins
   * where somebody has set one — this is only the default.
   */
  chainLag: 0.06,
  /** How far the chest counter-turns against the hips, in radians. */
  waist: 0.09,
};

export const LANDING = {
  /**
   * How much of its speed a hard landing takes.
   *
   * A machine used to touch down at any speed and carry all of it through,
   * which made a drop from a rooftop a free way to cross ground: the
   * landing played and none of it was true.
   */
  scrub: 0.55,
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
 * a question anybody had to answer. Six leaves room for a close weapon, a
 * long one and a spread of opinions, and is still a rack somebody picked
 * rather than the whole shop.
 */
export const WEAPON_SLOTS = 6;

/**
 * The most of ANY ONE weapon that may be carried.
 *
 * The rack has six slots and, until this, no rule about what went in them —
 * so the strongest loadout was always six of whatever the strongest gun
 * was, and every choice in the weapon table was a choice between one right
 * answer and eight wrong ones. Three of a kind still lets somebody commit
 * to a plan; it just stops the plan being "take six".
 *
 * Set beside WEAPON_SLOTS rather than per weapon, because it is a rule
 * about the rack, not about any one gun.
 */
export const WEAPON_SAME_MAX = 3;

/**
 * What one machine is allowed to be made of.
 *
 * Everything on a machine costs something every frame — a block is a mesh
 * to draw and a body to test against, a bone is a joint to pose and slew,
 * a plate is a weapon or a system to run — and four machines are on the
 * field at once. Left open, one build could make the fight stutter for
 * everybody in it.
 *
 * Set above the largest machine that ships (the LEVIATHAN, at 48 blocks
 * and 16 bones), with room to design past it. A limit that the shipped
 * examples already break is not a limit, it is a bug.
 */
export const BUDGET = {
  block: 80,
  bone: 32,
  equip: 16,
  /**
   * Cells of sculpting grid across the whole machine.
   *
   * Counting blocks is not enough. A block holds the same grid however
   * large it is made, but the RESOLUTION multiplies every block at once —
   * and rebuilding a machine costs about what its cell count says it will.
   * Measured, on the shipped machines:
   *
   *     0.2M cells   0.18s      1.6M cells   0.42s
   *     6.0M cells   1.33s      48M cells    8.06s
   *
   * That rebuild runs every time a block is placed. Eight seconds is not a
   * setting anybody would want and half a second is already a hitch, so the
   * ceiling sits where the worst case is under a second.
   *
   * It leaves the standard grid unaffected — at 32 cells the block limit is
   * reached first — and turns the higher ones into a trade: a finely
   * carved machine is a smaller one.
   */
  voxel: 4000000,
};

/** What each budget is called where a player will read it. */
export const BUDGET_LABEL = {
  block: 'ブロック',
  bone: 'ボーン',
  equip: 'プレート',
  voxel: '細かさ',
};

/**
 * Which actions travel on the wire, and in what order.
 *
 * The order IS the format: bit 0 is the first entry, and changing the order
 * changes what every frame in flight means. Append, never insert.
 *
 * Not every action is here. `reset` respawns and `camera` swings the view —
 * neither is part of the fight, and a networked fight only carries what the
 * simulation reads.
 */
/**
 * The size of one simulation step, in seconds.
 *
 * Fixed, and the same everywhere. It lives down here rather than beside the
 * game loop because it is not a fact about the loop — it is the unit the
 * whole simulation is measured in, and a match clock counting ticks has to
 * read the same one the physics does.
 */
export const STEP = 1 / 60;

export const ACTION_BITS = [
  'forward', 'back', 'left', 'right', 'up', 'down',
  'boost', 'fire', 'weaponNext', 'weaponPrev',
  'lock', 'cycleTarget', 'lockLeft', 'lockRight',
  'layerA', 'layerB', 'layerC',
];

/**
 * How finely a look is measured before it is sent, in units per radian.
 *
 * A mouse produces a double, and a double does not survive a round trip
 * through a wire unchanged. So it is rounded to a grid FIRST, and everybody
 * — the player who moved the mouse included — turns by the rounded amount.
 * At this scale one unit is about a thousandth of a degree, which nobody
 * can feel and every machine agrees on.
 */
export const LOOK_SCALE = 16384;

/**
 * Which recording each weapon speaks with.
 *
 * Two buckets — light and heavy — was most of why the guns sounded alike:
 * a shotgun, a sniper rifle and a magnum all came out of the same file at
 * slightly different pitches, which the ear reads as one gun with a knob on
 * it. These are five separate firearms, recorded outdoors.
 *
 * Anything not named here falls back to the light one, so adding a weapon
 * cannot silence it.
 */
export const WEAPON_VOICE = {
  [EQUIP.GATLING]: 'fire-light',
  // A beam has no field recording anywhere, so it borrows the driest
  // report in the library and lets the synthesised zap on top do the rest.
  [EQUIP.BEAM]: 'fire-pistol',
  [EQUIP.SHOT]: 'fire-shot',
  [EQUIP.SPREAD]: 'fire-shot',
  [EQUIP.SNIPER]: 'fire-sniper',
  [EQUIP.MAGNUM]: 'fire-heavy',
  [EQUIP.MISSILE]: 'fire-heavy',
  [EQUIP.GRENADE]: 'fire-heavy',
  // A held beam and a deployed shield are not reports either, but both do
  // something on the frame they start, and silence there reads as the
  // button not working.
  [EQUIP.LASER]: 'fire-pistol',
  [EQUIP.SHIELD]: 'swap',
};

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
