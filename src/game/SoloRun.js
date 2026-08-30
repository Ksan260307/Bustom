// ============================================================
//  Solo play : waves of opponents, a score, and a few lives.
//
//  This is the RULES of a run and nothing else. It never touches a mesh, a
//  camera or the DOM — it asks the arena for opponents, is told when
//  something dies, and decides what happens next. Two reasons for the split:
//
//    - it can be tested without a renderer, at a hundred waves a second
//    - the arena stays one thing (a place where machines fight) instead of
//      growing a second job (deciding who wins)
//
//  It runs on the simulation clock, in the fixed step, because everything it
//  decides — when the next wave lands, when the run ends — is part of the
//  fight and must not depend on how fast the screen happens to be.
// ============================================================

/** The opponents a wave is built from, in the order they get mixed in. */
/**
 * Everything a run can send at you, and how each one fights.
 *
 * The ranges are spread on purpose. Ten weapons with ten different reaches
 * mean nothing while every opponent stands at the same twenty-odd metres:
 * one gun answers all of them and the rack is decoration. Something that
 * comes right in cannot be dealt with by a weapon that only works at
 * distance, and something that stays out past forty is out of reach of
 * anything short — so what is in your hand becomes a question with an
 * answer.
 *
 * `size` is the machine's class, and it is what a run escalates ALONG: the
 * first waves are drones, the last are siege frames. Numbers alone make a
 * fight longer; a thing twice your height makes it different.
 */
export const OPPONENTS = [
  // ---- tiny: fast, fragile, and they arrive in numbers
  { preset: 'gnat', size: 'tiny', style: 'flyer', range: 22, habit: 'steady', label: 'GNAT' },
  { preset: 'mite', size: 'tiny', style: 'orbit', range: 16, habit: 'steady', label: 'MITE' },
  { preset: 'spark', size: 'tiny', style: 'flyer', range: 26, habit: 'salvo', label: 'SPARK' },
  { preset: 'tick', size: 'tiny', style: 'rusher', range: 7, habit: 'closer', label: 'TICK' },

  // ---- small
  { preset: 'hopper', size: 'small', style: 'flyer', range: 30, habit: 'peak', label: 'POGO' },
  { preset: 'dart', size: 'small', style: 'flyer', range: 34, habit: 'steady', label: 'DART' },
  { preset: 'scarab', size: 'small', style: 'orbit', range: 18, habit: 'steady', label: 'SCARAB' },
  { preset: 'pip', size: 'small', style: 'orbit', range: 46, habit: 'salvo', label: 'PIP' },

  // ---- medium: the scale everything else is read against
  { preset: 'biped', size: 'medium', style: 'orbit', range: 24, habit: 'steady', label: 'STRIDER' },
  {
    preset: 'multileg', size: 'medium', style: 'rusher', range: 11, habit: 'closer',
    label: 'CRAWLER',
  },
  { preset: 'bits', size: 'medium', style: 'flyer', range: 40, habit: 'salvo', label: 'FUNNEL' },
  { preset: 'lance', size: 'medium', style: 'orbit', range: 52, habit: 'salvo', label: 'LANCE' },
  { preset: 'turtle', size: 'medium', style: 'orbit', range: 15, habit: 'steady', label: 'TURTLE' },

  // ---- large: it looks down at you
  { preset: 'titan', size: 'large', style: 'orbit', range: 26, habit: 'steady', label: 'TITAN' },
  { preset: 'spider', size: 'large', style: 'rusher', range: 14, habit: 'closer', label: 'SPIDER' },
  { preset: 'hauler', size: 'large', style: 'orbit', range: 44, habit: 'salvo', label: 'HAULER' },
  { preset: 'wyvern', size: 'large', style: 'flyer', range: 32, habit: 'peak', label: 'WYVERN' },

  // ---- huge: one of these IS the wave
  {
    preset: 'colossus', size: 'huge', style: 'orbit', range: 28, habit: 'salvo',
    label: 'COLOSSUS',
  },
  {
    preset: 'leviathan', size: 'huge', style: 'rusher', range: 18, habit: 'closer',
    label: 'LEVIATHAN',
  },
  {
    preset: 'fortress', size: 'huge', style: 'orbit', range: 50, habit: 'salvo',
    label: 'FORTRESS',
  },
];

/**
 * Which sizes a given wave draws from.
 *
 * A run escalates by scale as well as by number. Early waves are drones and
 * the odd walker; by the end a wave can lead with something thirty metres
 * tall. Sizes overlap deliberately — a late wave still contains small fast
 * things, because a wave made entirely of siege frames is one slow problem
 * rather than several.
 */
function sizesForWave(n) {
  if (n <= 2) return ['tiny'];
  if (n <= 4) return ['tiny', 'small'];
  if (n <= 7) return ['tiny', 'small', 'medium'];
  if (n <= 11) return ['small', 'medium'];
  if (n <= 15) return ['small', 'medium', 'large'];
  if (n <= 18) return ['medium', 'large'];
  return ['medium', 'large', 'huge'];
}

/**
 * What the biggest thing in a wave may be.
 *
 * Kept apart from the pool because the LEAD of a wave is what you see first
 * and what decides how the wave reads. It climbs a step ahead of the rest.
 */
function leadSizeForWave(n) {
  if (n <= 3) return 'tiny';
  if (n <= 6) return 'small';
  if (n <= 11) return 'medium';
  if (n <= 16) return 'large';
  return 'huge';
}

/** Everything of a given size, in the order they are listed. */
const OF_SIZE = (size) => OPPONENTS.filter((o) => o.size === size);

/**
 * How hard a run is, and how fast it gets harder.
 *
 * Not five sets of enemy statistics. Every setting fights the SAME machines
 * with the same habits at the same ranges; what changes is a single number
 * that climbs as the run goes on, and how fast it climbs.
 *
 * The reason is that a difficulty which only multiplies hit points at the
 * start is a difficulty you feel for one wave and then forget — the ramp is
 * what everybody actually remembers, because it is the thing that decides
 * whether wave fifteen is a victory lap or a wall. So the settings differ
 * mostly in `ramp`: where they START is nearly the same, and where they END
 * is not remotely.
 *
 *   power = base + ramp × (wave − 1),   capped at `ceiling`
 *
 * That one number multiplies what an opponent can take and what it does to
 * you, and pushes how hard it presses. A cap exists because an uncapped
 * ramp turns into a wall of hit points, and a wall is long rather than
 * hard.
 */
export const DIFFICULTIES = {
  easy: {
    label: 'EASY',
    blurb: '機体を試すため。強くなるのもゆっくり。',
    base: 0.72, ramp: 0.030, ceiling: 1.8,
    press: 0.65, lives: 5, score: 0.6,
  },
  normal: {
    label: 'NORMAL',
    blurb: '基準。20ウェーブでちょうど手に負えなくなる。',
    base: 1.00, ramp: 0.060, ceiling: 2.6,
    press: 1.00, lives: 3, score: 1.0,
  },
  hard: {
    label: 'HARD',
    blurb: '最初から強く、上がり方も速い。',
    base: 1.25, ramp: 0.095, ceiling: 3.6,
    press: 1.20, lives: 3, score: 1.6,
  },
  superhard: {
    label: 'SUPER HARD',
    blurb: '中盤で並の機体は保たない。装備を選ぶこと。',
    base: 1.55, ramp: 0.140, ceiling: 5.0,
    press: 1.40, lives: 2, score: 2.4,
  },
  hell: {
    label: 'HELL',
    blurb: '残機1。終盤の1機は序盤の1ウェーブより硬い。',
    base: 1.90, ramp: 0.200, ceiling: 7.0,
    press: 1.60, lives: 1, score: 4.0,
  },
};

/** The order they are offered in. */
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'superhard', 'hell'];

export const DEFAULT_DIFFICULTY = 'normal';

export function getDifficulty(id) {
  return DIFFICULTIES[id] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}

/**
 * How strong the opposition is on a given wave, at a given setting.
 *
 * One number, so it can be shown to the player — a difficulty you cannot
 * see the effect of is a difficulty you argue with rather than answer.
 */
export function powerAt(difficulty, wave) {
  const d = getDifficulty(difficulty);
  return Math.min(d.ceiling, d.base + d.ramp * Math.max(0, wave - 1));
}

/** Seconds of quiet before the first wave, and between waves. */
const INTRO = 2.4;
const BREAK = 3.4;
/** How long a wreck lies there before you are put back on the field. */
const DOWN_WAIT = 2.6;
/** And how long the last one lies there before the run is called. */
const OVER_WAIT = 2.6;
/**
 * How long the ground stays still between one place and the next.
 *
 * Longer than an ordinary break on purpose: the arena is about to be torn
 * down and rebuilt around you, and arriving somewhere new with a wave
 * already walking at you is disorienting rather than exciting.
 */
const STAGE_WAIT = 4.2;

/**
 * The dials of a run, in one place and exported, so the help screen can
 * state them instead of repeating them by hand and going stale.
 */
/**
 * The run, as a ladder of places.
 *
 * A run used to be one arena and an endless climb of waves — which meant
 * the place stopped mattering after the first thirty seconds, and the only
 * thing that changed for the next twenty minutes was the size of the crowd.
 *
 * Now it walks the arenas in order, a few waves each. Every stage changes
 * the ground under the fight: what cover there is, how far you can see, and
 * on the last two, whether you fall at all. Lives and score carry across;
 * the wave count does not restart, so the pressure keeps climbing while the
 * ground keeps changing.
 *
 * Ordered so the strange ones are the reward for getting there.
 */
export const SOLO_STAGES = [
  { arena: 'proving', waves: 2 },
  { arena: 'city', waves: 3 },
  { arena: 'works', waves: 3 },
  { arena: 'canyon', waves: 3 },
  { arena: 'flats', waves: 3 },
  { arena: 'moon', waves: 3 },
  { arena: 'orbit', waves: 3 },
];

/** How many waves the whole ladder is. */
export const SOLO_WAVES = SOLO_STAGES.reduce((n, s) => n + s.waves, 0);

export const SOLO_RULES = {
  /** Tries you get before the run is over. */
  lives: 3,
  /** Most opponents on the field at once. Past this it stops being readable. */
  maxAtOnce: 6,
  /** Every Nth wave leads with one that takes real work to put down. */
  aceEvery: 5,
  /** What a tougher-than-standard opponent is worth, as a multiplier. */
  aceScore: 3,
  /**
   * How much machine you get back when a life is spent.
   *
   * It used to be all of it, while clearing a wave repaired 35% — so at
   * low health, being shot down was BETTER than surviving. A life is meant
   * to be the expensive way out.
   */
  reviveHp: 0.6,
  /**
   * What a wave pays for being fought well, before the wave multiplier.
   *
   * Flat, these were meaningful in wave one (950 against 800) and noise by
   * wave twenty (950 against 9,450) — the skill component evaporated exactly
   * where skill starts to matter. They scale with the wave now, like
   * everything else on the scoreboard.
   */
  cleanBonus: 400,
  quickBonus: 300,
  aimBonus: 250,
  /**
   * How long a wave may take before the speed bonus is gone.
   *
   * Grows with the wave, because a later wave is a bigger wave: a fixed
   * forty-five seconds became unreachable around wave seven and then sat
   * there being unreachable, which is worse than not offering it.
   */
  quickWithin: 45,
  quickPerWave: 8,
  /** What finishing the whole ladder is worth, on top of everything else. */
  clearBonus: 20000,
};

const MAX_AT_ONCE = SOLO_RULES.maxAtOnce;
const ACE_EVERY = SOLO_RULES.aceEvery;

export class SoloRun {
  /**
   * @param {object} field the arena: supplies `player`, `spawnEnemy`,
   *   `retireEnemies` and `respawn`. Anything with those four works, which
   *   is what makes this testable without a renderer.
   */
  constructor(field, { lives = null, difficulty = DEFAULT_DIFFICULTY } = {}) {
    this.field = field;
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : DEFAULT_DIFFICULTY;
    // Lives come from the setting unless somebody insists, which is what
    // lets a test pin them without also pinning the difficulty.
    this.startingLives = lives ?? getDifficulty(this.difficulty).lives;
    this.reset();
  }

  /** The setting's own numbers. */
  get rules() { return getDifficulty(this.difficulty); }

  /** How strong the opposition is right now. Shown to the player. */
  get power() { return powerAt(this.difficulty, Math.max(1, this.wave)); }

  /** Back to the state a fresh run starts in. */
  reset() {
    this.wave = 0;
    /** Which rung of the ladder, from 0. */
    this.stage = 0;
    /** Waves cleared on this rung. */
    this.stageWave = 0;
    this.lives = this.startingLives;
    this.score = 0;
    this.kills = 0;
    this.time = 0;
    /** intro | fighting | break | stageclear | down | ending | over */
    this.state = 'intro';
    this.timer = INTRO;
    /** The machines this wave is made of, dead ones included. */
    this.members = [];
    /**
     * What the last wave was worth beyond the kills, and how it was earned.
     *
     * The score was kills plus a flat sum for clearing, which measured how
     * long you sat there and nothing else. These are the three things a
     * player can actually get better at.
     */
    this.waveStarted = 0;
    this.tookHits = false;
    this.lastBonus = null;
    /** Offered during the break; see `offers`. */
    this.offer = null;
    this.banner = 'READY';
    this.bannerFor = INTRO;
    return this;
  }

  /** Clear the field and start counting down to the first wave. */
  begin() {
    this.reset();
    this.field.retireEnemies();
    // The first rung. Set explicitly rather than assumed, so restarting a
    // run from the last stage puts you back at the bottom of the ladder.
    this.field.setArena?.(SOLO_STAGES[0].arena);
    this._say(this._stageBanner(), INTRO);
    return this;
  }

  /** The place this rung of the ladder happens in. */
  get stageSpec() { return SOLO_STAGES[Math.min(this.stage, SOLO_STAGES.length - 1)]; }

  /** True when the ladder has been walked to the top. */
  get cleared() { return this.stage >= SOLO_STAGES.length; }

  _stageBanner() {
    return `STAGE ${this.stage + 1} / ${SOLO_STAGES.length}`;
  }

  /** True once the run is finished and the result is worth showing. */
  get finished() { return this.state === 'over'; }

  /** Opponents from this wave still standing. */
  get remaining() {
    let n = 0;
    for (const m of this.members) if (m.alive) n++;
    return n;
  }

  /** What the read-out shows. Output only — nothing here decides anything. */
  get readout() {
    return {
      wave: this.wave,
      stage: this.stage + 1,
      stages: SOLO_STAGES.length,
      difficulty: this.rules.label,
      power: this.power,
      remaining: this.remaining,
      score: this.score,
      kills: this.kills,
      lives: this.lives,
      time: this.time,
      banner: this.bannerFor > 0 ? this.banner : '',
      bannerFade: Math.min(1, this.bannerFor / 0.6),
      offer: this.offer,
      bonus: this.lastBonus,
    };
  }

  /** The run, as the result screen wants it. */
  get result() {
    return {
      wave: this.wave, score: this.score, kills: this.kills, time: this.time,
      difficulty: this.difficulty,
      difficultyLabel: this.rules.label,
      stage: Math.min(this.stage + 1, SOLO_STAGES.length),
      stages: SOLO_STAGES.length,
      cleared: this.cleared,
    };
  }

  // ---------------------------------------------------------- the wave table

  /**
   * What wave `n` is made of.
   *
   * It grows in two directions at once — more of them, and each one tougher
   * — because either alone runs out of road: numbers alone turn into a
   * crowd you cannot see through, and toughness alone turns into one long
   * unchanging fight.
   */
  static waveSpecs(n, difficulty = DEFAULT_DIFFICULTY) {
    const d = getDifficulty(difficulty);
    // One number, climbing. See DIFFICULTIES.
    const power = powerAt(difficulty, n);
    const count = Math.min(MAX_AT_ONCE, 2 + Math.floor(n / 2));
    // Hit points climb gently. At 0.16 a wave, wave twenty was five thousand
    // hit points on the field — about three minutes of unbroken hitting at
    // what a good weapon actually does. Toughness makes a fight LONGER, and
    // length is not difficulty; the numbers and the pressure do that.
    // The climb IS the difficulty's climb.
    //
    // There used to be a ramp here as well, and multiplying the two gave
    // fifteen times the hit points by wave twenty on the middle setting —
    // the same climb counted twice. One curve, chosen by the player, and
    // the wave only decides where along it we are.
    const toughness = power;
    // How hard the wave presses. The first few leave gaps you can move in;
    // by the fifth there is barely a pause. The run used to ramp only in
    // hit points, which makes later waves longer rather than harder — the
    // fight is the same fight, it just takes more rounds.
    const aggression = Math.min(1, (0.25 + (n - 1) * 0.19) * d.press);
    // What this wave is drawn from, and what leads it.
    const pool = sizesForWave(n).flatMap(OF_SIZE);
    const leads = OF_SIZE(leadSizeForWave(n));

    const specs = [];
    for (let i = 0; i < count; i++) {
      // Offset by the wave number so the mix rotates rather than always
      // leading with the same machine.
      const kind = pool[(i + n - 1) % pool.length];
      specs.push({
        // What it hits for. Held under the toughness on purpose: a run
        // where opponents take three times as long to kill is a slog, and
        // one where they hit three times as hard is over in a second.
        hitting: 1 + (power - 1) * 0.55, ...kind, toughness, aggression, ace: false,
      });
    }
    // The one at the front is a size up, and every fifth wave it is also
    // properly hard: something that takes real work rather than more time.
    specs[0] = { ...specs[0], ...leads[(n - 1) % leads.length] };
    if (n % ACE_EVERY === 0) {
      specs[0] = { ...specs[0], toughness: toughness * 2.4, aggression: 1, ace: true };
    }
    return specs;
  }

  /** What putting one down is worth, later waves being worth more. */
  static killScore(wave, ace = false) {
    return Math.round(100 * (1 + 0.25 * Math.max(0, wave - 1))
      * (ace ? SOLO_RULES.aceScore : 1));
  }

  // ---------------------------------------------------------- the run

  update(dt) {
    if (this.state === 'over') return this;
    this.time += dt;
    this.timer -= dt;
    this.bannerFor = Math.max(0, this.bannerFor - dt);

    switch (this.state) {
      case 'intro':
      case 'break':
        if (this.timer <= 0) this._startWave(this.wave + 1);
        break;
      case 'fighting':
        if (this.remaining === 0) this._clearWave();
        break;
      case 'stageclear':
        if (this.timer <= 0) this._nextStage();
        break;
      case 'down':
        if (this.timer <= 0) this._backOnTheField();
        break;
      case 'ending':
        if (this.timer <= 0) { this.state = 'over'; this._say('', 0); }
        break;
      default:
        break;
    }
    return this;
  }

  /**
   * Told by the arena that a machine has just come apart.
   *
   * The arena still does the wreck and the shake; all that is decided here
   * is what it MEANS — a point, a life, or the end of the run.
   */
  onDown(robot) {
    if (robot === this.field.player) {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.lives = 0;
        this.state = 'ending';
        this.timer = OVER_WAIT;
        this._say('GAME OVER', OVER_WAIT);
      } else {
        this.state = 'down';
        this.timer = DOWN_WAIT;
        this._say(this.lives + ' LEFT', 1.8);
      }
      return this;
    }

    const i = this.members.indexOf(robot);
    if (i < 0) return this;                 // not one of ours
    this.kills += 1;
    this.score += Math.round(
      SoloRun.killScore(this.wave, this.members[i].ace === true) * this.rules.score,
    );
    return this;
  }

  // ---------------------------------------------------------- internals

  _startWave(n) {
    this.wave = n;
    // Sweep the last wave's wrecks off the field first. They have had their
    // moment, and clearing them is what puts those machines back within
    // reach of the next wave instead of leaving it to build new ones.
    this.field.retireEnemies();
    this.members = SoloRun.waveSpecs(n, this.difficulty).map((spec) => {
      const bot = this.field.spawnEnemy(spec);
      // Remembered on the machine so the score knows what it just killed,
      // whichever wave it turns up in.
      if (bot) bot.ace = spec.ace === true;
      return bot;
    }).filter(Boolean);
    this.state = 'fighting';
    // Whatever was on the table is off it now.
    if (this.offer) { this.choose(0); }
    this.waveStarted = this.time;
    this.tookHits = false;
    const p = this.field.player;
    if (p?.weapons) p.weapons.shotsFired = 0;
    if (p) p.shotsLanded = 0;
    this._say('WAVE ' + n, 1.8);
    return this;
  }

  _clearWave() {
    // Everything a wave pays is worth what the setting asked for it. A
    // scoreboard where HELL and EASY pay the same is a scoreboard that says
    // the choice did not matter.
    this.score += Math.round((300 * this.wave + this._payBonus()) * this.rules.score);
    this.stageWave += 1;

    // Still more to do here, so it is an ordinary break: a breath, and
    // something to choose from.
    if (this.stageWave < this.stageSpec.waves) {
      this.state = 'break';
      this.timer = BREAK;
      this._say('WAVE ' + this.wave + ' CLEAR', 2.2);
      this.offer = this._buildOffer();
      return this;
    }

    // The rung is done. Which is worth saying with a different word, and
    // worth a longer pause: the ground is about to change under you, and
    // arriving somewhere new mid-sentence is disorienting.
    this.state = 'stageclear';
    this.timer = STAGE_WAIT;
    this._say(this._stageBanner() + ' CLEAR', STAGE_WAIT);
    this.offer = this._buildOffer();
    return this;
  }

  /**
   * Move the run to the next place.
   *
   * The arena swap takes the wrecks, the rounds and the debris with it, and
   * puts the player back on their feet somewhere in the new one — so this
   * only has to decide whether there IS a next place.
   */
  _nextStage() {
    // Whatever was on the table is off it: it was offered for the last
    // place, and the offer is not carried across.
    if (this.offer) this.choose(0);
    this.stage += 1;
    this.stageWave = 0;

    if (this.cleared) {
      this.score += Math.round(SOLO_RULES.clearBonus * this.rules.score);
      this.state = 'ending';
      this.timer = OVER_WAIT;
      this._say('ALL CLEAR', OVER_WAIT);
      return this;
    }

    this.field.retireEnemies();
    this.field.setArena?.(this.stageSpec.arena);
    this.state = 'intro';
    this.timer = INTRO;
    this._say(this._stageBanner(), INTRO);
    return this;
  }

  /**
   * What the wave paid beyond the kills.
   *
   * Three things you can get better at, rather than one you can only wait
   * out. Nothing here is a multiplier on damage — the fight is the fight;
   * this is what the RUN thinks of how you had it.
   */
  _payBonus() {
    // The same multiplier the kills use, so being good at a late wave is
    // worth what a late wave is worth.
    const scale = 1 + 0.25 * Math.max(0, this.wave - 1);
    const within = SOLO_RULES.quickWithin + SOLO_RULES.quickPerWave * (this.wave - 1);
    const took = Math.max(0.001, this.time - this.waveStarted);
    const clean = this.tookHits ? 0 : Math.round(SOLO_RULES.cleanBonus * scale);
    const quick = Math.round(
      SOLO_RULES.quickBonus * scale * Math.max(0, 1 - took / within),
    );
    const shots = this.field.player?.weapons?.shotsFired ?? 0;
    const landed = this.field.player?.shotsLanded ?? 0;
    const aim = shots > 0
      ? Math.round(SOLO_RULES.aimBonus * scale * Math.min(1, landed / shots)) : 0;
    this.lastBonus = { clean, quick, aim, within, total: clean + quick + aim };
    return this.lastBonus.total;
  }

  /**
   * What the break is FOR.
   *
   * Three and a half seconds of banner and nothing else, while the supply
   * came back for free: no moment in the run asked you to give anything up.
   * Now it does, and if you say nothing the first one is taken — a run
   * should never stall on a menu.
   */
  _buildOffer() {
    const p = this.field.player;
    if (!p) return null;
    return {
      pick: 0,
      choices: [
        {
          id: 'repair',
          label: 'REPAIR',
          note: '+45% HULL',
          apply: () => { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.45); },
        },
        {
          id: 'rearm',
          label: 'REARM',
          note: 'FULL AMMO +15% HULL',
          apply: () => {
            p.rearm?.();
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15);
          },
        },
        {
          id: 'hold',
          label: 'RESERVE',
          note: '+1 LIFE',
          apply: () => { this.lives += 1; },
        },
      ],
    };
  }

  /**
   * Take one of the offers. Anything out of range is ignored rather than
   * throwing: this is driven by a key the player pressed.
   */
  choose(i) {
    const offer = this.offer;
    if (!offer) return null;
    const choice = offer.choices[i];
    if (!choice) return null;
    choice.apply();
    this.offer = null;
    this._say(choice.label, 1.2);
    return choice.id;
  }

  _backOnTheField() {
    this.field.respawn();
    // A life buys you a machine, not a fresh one. Coming back whole made
    // being shot down the better option whenever the hull was low, which is
    // exactly backwards.
    const p = this.field.player;
    if (p) p.hp = Math.max(1, Math.round(p.maxHp * SOLO_RULES.reviveHp));
    this.state = this.remaining > 0 ? 'fighting' : 'break';
    if (this.state === 'break') this.timer = BREAK;
    return this;
  }

  _say(text, seconds) {
    this.banner = text;
    this.bannerFor = seconds;
    return this;
  }
}
