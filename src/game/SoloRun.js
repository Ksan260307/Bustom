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
export const OPPONENTS = [
  { preset: 'biped', style: 'orbit', range: 24, label: 'STRIDER' },
  // The ranges are spread on purpose, and further apart than they were.
  //
  // Ten weapons with ten different reaches mean nothing while every
  // opponent stands at the same twenty-odd metres: one gun answers all of
  // them and the rack is decoration. A CRAWLER that comes right in cannot
  // be dealt with by something that only works at distance, and a FUNNEL
  // that stays out past thirty is out of reach of anything short — so what
  // is in your hand starts to be a question with an answer.
  { preset: 'multileg', style: 'rusher', range: 11, label: 'CRAWLER' },
  { preset: 'hopper', style: 'flyer', range: 30, label: 'POGO' },
  { preset: 'bits', style: 'flyer', range: 40, label: 'FUNNEL' },
];

/** Seconds of quiet before the first wave, and between waves. */
const INTRO = 2.4;
const BREAK = 3.4;
/** How long a wreck lies there before you are put back on the field. */
const DOWN_WAIT = 2.6;
/** And how long the last one lies there before the run is called. */
const OVER_WAIT = 2.6;

/**
 * The dials of a run, in one place and exported, so the help screen can
 * state them instead of repeating them by hand and going stale.
 */
export const SOLO_RULES = {
  /** Tries you get before the run is over. */
  lives: 3,
  /** Most opponents on the field at once. Past this it stops being readable. */
  maxAtOnce: 6,
  /** Every Nth wave leads with one that takes real work to put down. */
  aceEvery: 5,
  /** What a tougher-than-standard opponent is worth, as a multiplier. */
  aceScore: 3,
};

const MAX_AT_ONCE = SOLO_RULES.maxAtOnce;
const ACE_EVERY = SOLO_RULES.aceEvery;

export class SoloRun {
  /**
   * @param {object} field the arena: supplies `player`, `spawnEnemy`,
   *   `retireEnemies` and `respawn`. Anything with those four works, which
   *   is what makes this testable without a renderer.
   */
  constructor(field, { lives = SOLO_RULES.lives } = {}) {
    this.field = field;
    this.startingLives = lives;
    this.reset();
  }

  /** Back to the state a fresh run starts in. */
  reset() {
    this.wave = 0;
    this.lives = this.startingLives;
    this.score = 0;
    this.kills = 0;
    this.time = 0;
    /** intro | fighting | break | down | ending | over */
    this.state = 'intro';
    this.timer = INTRO;
    /** The machines this wave is made of, dead ones included. */
    this.members = [];
    this.banner = 'READY';
    this.bannerFor = INTRO;
    return this;
  }

  /** Clear the field and start counting down to the first wave. */
  begin() {
    this.reset();
    this.field.retireEnemies();
    return this;
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
      remaining: this.remaining,
      score: this.score,
      kills: this.kills,
      lives: this.lives,
      time: this.time,
      banner: this.bannerFor > 0 ? this.banner : '',
      bannerFade: Math.min(1, this.bannerFor / 0.6),
    };
  }

  /** The run, as the result screen wants it. */
  get result() {
    return {
      wave: this.wave, score: this.score, kills: this.kills, time: this.time,
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
  static waveSpecs(n) {
    const count = Math.min(MAX_AT_ONCE, 2 + Math.floor(n / 2));
    const toughness = 1 + (n - 1) * 0.16;
    // How hard the wave presses. The first few leave gaps you can move in;
    // by the fifth there is barely a pause. The run used to ramp only in
    // hit points, which makes later waves longer rather than harder — the
    // fight is the same fight, it just takes more rounds.
    const aggression = Math.min(1, 0.25 + (n - 1) * 0.19);
    const specs = [];
    for (let i = 0; i < count; i++) {
      // Offset by the wave number so the mix rotates rather than always
      // leading with the same machine.
      const kind = OPPONENTS[(i + n - 1) % OPPONENTS.length];
      specs.push({ ...kind, toughness, aggression, ace: false });
    }
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
        this._say('のこり ' + this.lives, 1.8);
      }
      return this;
    }

    const i = this.members.indexOf(robot);
    if (i < 0) return this;                 // not one of ours
    this.kills += 1;
    this.score += SoloRun.killScore(this.wave, this.members[i].ace === true);
    return this;
  }

  // ---------------------------------------------------------- internals

  _startWave(n) {
    this.wave = n;
    // Sweep the last wave's wrecks off the field first. They have had their
    // moment, and clearing them is what puts those machines back within
    // reach of the next wave instead of leaving it to build new ones.
    this.field.retireEnemies();
    this.members = SoloRun.waveSpecs(n).map((spec) => {
      const bot = this.field.spawnEnemy(spec);
      // Remembered on the machine so the score knows what it just killed,
      // whichever wave it turns up in.
      if (bot) bot.ace = spec.ace === true;
      return bot;
    }).filter(Boolean);
    this.state = 'fighting';
    this._say('WAVE ' + n, 1.8);
    return this;
  }

  _clearWave() {
    this.score += 300 * this.wave;
    this.state = 'break';
    this.timer = BREAK;
    this._say('WAVE ' + this.wave + ' CLEAR', 2.2);

    // A breather is worth something you can feel: a patch of hull and a
    // full rack. Not a full heal — the run has to wear you down.
    const p = this.field.player;
    if (p && p.alive) {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
      p.rearm?.();
    }
    return this;
  }

  _backOnTheField() {
    this.field.respawn();
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
