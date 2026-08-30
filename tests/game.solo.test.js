import { describe, it, expect } from 'vitest';
import {
  SOLO_STAGES, SOLO_WAVES, SoloRun, SOLO_RULES, OPPONENTS,
  DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, powerAt,
} from '../src/game/SoloRun.js';

// ============================================================
//  The rules of a run, with a paper arena underneath.
//
//  Nothing here builds a machine or a renderer: the run only ever asks the
//  arena for an opponent and is told when something died, so a stand-in with
//  four methods is enough to play a hundred waves in a millisecond.
// ============================================================

/** An arena on paper: it hands out machines and remembers what was asked. */
function paperField() {
  const field = {
    player: {
      alive: true, hp: 100, maxHp: 100, rearmed: 0, shotsLanded: 0,
      weapons: { shotsFired: 0 },
      rearm() { this.rearmed++; },
    },
    spawned: [],
    retired: 0,
    respawned: 0,
    retireEnemies() { this.retired++; },
    respawn() { this.respawned++; this.player.alive = true; this.player.hp = this.player.maxHp; },
    spawnEnemy(spec) {
      const bot = { alive: true, spec, kill: () => { bot.alive = false; } };
      this.spawned.push(bot);
      return bot;
    },
    /** Where the run has been, in order. */
    arenas: [],
    setArena(id) { this.arenas.push(id); },
  };
  return field;
}

/** Run the clock, in the same fixed step the game uses. */
const tick = (run, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) run.update(1 / 60);
  return run;
};

/** Play from the top until wave `n` is on the field. */
function toWave(run, n) {
  for (let guard = 0; guard < 500 && run.wave < n; guard++) {
    tick(run, 0.5);
    if (run.state === 'fighting' && run.wave < n) for (const m of run.members) m.alive = false;
    for (const m of run.members) if (!m.alive) run.onDown(m);
  }
  return run;
}

describe('how hard a run is', () => {
  it('offers five settings, hardest last', () => {
    expect(DIFFICULTY_ORDER).toHaveLength(5);
    const ramps = DIFFICULTY_ORDER.map((id) => DIFFICULTIES[id].ramp);
    for (let i = 1; i < ramps.length; i++) {
      expect(ramps[i], `${DIFFICULTY_ORDER[i]} climbs faster`).toBeGreaterThan(ramps[i - 1]);
    }
    // And every one of them is a real entry with a name.
    for (const id of DIFFICULTY_ORDER) expect(DIFFICULTIES[id].label).toBeTruthy();
  });

  it('the buff climbs with the wave, which is the whole idea', () => {
    for (const id of DIFFICULTY_ORDER) {
      const first = powerAt(id, 1);
      const last = powerAt(id, SOLO_WAVES);
      expect(last, `${id} gets harder as it goes`).toBeGreaterThan(first);
      expect(first, `${id} starts somewhere sane`).toBeGreaterThan(0.5);
    }
  });

  it('and stops climbing, so a late wave is hard rather than long', () => {
    // An uncapped ramp turns into a wall of hit points, and a wall is long,
    // not hard.
    for (const id of DIFFICULTY_ORDER) {
      expect(powerAt(id, 500)).toBe(DIFFICULTIES[id].ceiling);
    }
  });

  it('every setting is harder than the one below it, at every wave', () => {
    for (let n = 1; n <= SOLO_WAVES; n++) {
      for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
        expect(
          powerAt(DIFFICULTY_ORDER[i], n),
          `${DIFFICULTY_ORDER[i]} over ${DIFFICULTY_ORDER[i - 1]} at wave ${n}`,
        ).toBeGreaterThan(powerAt(DIFFICULTY_ORDER[i - 1], n));
      }
    }
  });

  it('moves what they can take AND what they hit for', () => {
    // Only raising hit points would make the fight longer without making it
    // harder; only raising damage would make it end in a second.
    const easy = SoloRun.waveSpecs(10, 'easy')[1];
    const hell = SoloRun.waveSpecs(10, 'hell')[1];
    expect(hell.toughness).toBeGreaterThan(easy.toughness * 2);
    expect(hell.hitting).toBeGreaterThan(easy.hitting);
    // Damage moves LESS than toughness, or a late wave one-shots you.
    expect(hell.hitting).toBeLessThan(hell.toughness);
  });

  it('gives the softer settings more tries and pays them less', () => {
    expect(DIFFICULTIES.easy.lives).toBeGreaterThan(DIFFICULTIES.hell.lives);
    expect(DIFFICULTIES.easy.score).toBeLessThan(DIFFICULTIES.hell.score);
  });

  it('takes its lives from the setting', () => {
    const run = new SoloRun(paperField(), { difficulty: 'hell' });
    run.begin();
    expect(run.lives).toBe(DIFFICULTIES.hell.lives);
  });

  it('a harder run is worth more for the same fight', () => {
    const play = (difficulty) => {
      const field = paperField();
      const run = new SoloRun(field, { difficulty, lives: 9 });
      run.begin();
      toWave(run, 4);
      return run.score;
    };
    expect(play('hell')).toBeGreaterThan(play('easy'));
  });

  it('falls back rather than breaking on a setting that is not there', () => {
    const run = new SoloRun(paperField(), { difficulty: 'nightmare' });
    expect(run.difficulty).toBe(DEFAULT_DIFFICULTY);
    expect(powerAt('nightmare', 5)).toBe(powerAt(DEFAULT_DIFFICULTY, 5));
  });
});

describe('a run is a ladder of places', () => {
  it('starts at the bottom of it', () => {
    const field = paperField();
    const run = new SoloRun(field);
    run.begin();
    expect(run.stage).toBe(0);
    expect(field.arenas.at(-1)).toBe(SOLO_STAGES[0].arena);
  });

  it('moves on when a stage runs out of waves, not when a wave clears', () => {
    const field = paperField();
    const run = new SoloRun(field);
    run.begin();
    const first = SOLO_STAGES[0].waves;

    // Every wave but the last on this rung is an ordinary break.
    toWave(run, first);
    expect(run.stage, 'still on the first rung').toBe(0);
    const before = field.arenas.length;

    // Clearing the last one is a stage clear, and the ground changes.
    for (const m of run.members) m.alive = false;
    for (const m of run.members) run.onDown(m);
    tick(run, 0.1);
    expect(run.state).toBe('stageclear');
    tick(run, 6);
    expect(run.stage).toBe(1);
    expect(field.arenas.length, 'the arena was changed').toBe(before + 1);
    expect(field.arenas.at(-1)).toBe(SOLO_STAGES[1].arena);
  });

  it('keeps climbing the wave count across the change', () => {
    // Otherwise every stage restarts at wave one and the pressure resets
    // with the scenery, which makes the ladder an anthology rather than a
    // run.
    const field = paperField();
    const run = new SoloRun(field);
    run.begin();
    toWave(run, SOLO_STAGES[0].waves + 1);
    expect(run.stage).toBe(1);
    expect(run.wave).toBe(SOLO_STAGES[0].waves + 1);
    expect(run.stageWave).toBe(0);
  });

  it('walks every place, once, in order', () => {
    const field = paperField();
    const run = new SoloRun(field);
    run.begin();
    for (let guard = 0; guard < 4000 && !run.cleared; guard++) {
      tick(run, 0.5);
      if (run.state === 'fighting') for (const m of run.members) m.alive = false;
      for (const m of run.members) if (!m.alive) run.onDown(m);
    }
    expect(run.cleared, 'the ladder was walked to the top').toBe(true);
    expect(field.arenas).toEqual(SOLO_STAGES.map((s) => s.arena));
    expect(run.wave).toBe(SOLO_WAVES);
  });

  it('pays for finishing it, and then the run is over', () => {
    const field = paperField();
    const run = new SoloRun(field);
    run.begin();
    for (let guard = 0; guard < 4000 && !run.finished; guard++) {
      tick(run, 0.5);
      if (run.state === 'fighting') for (const m of run.members) m.alive = false;
      for (const m of run.members) if (!m.alive) run.onDown(m);
    }
    expect(run.finished).toBe(true);
    expect(run.result.cleared).toBe(true);
    expect(run.score).toBeGreaterThan(SOLO_RULES.clearBonus);
  });

  it('a run that ends early did not clear it', () => {
    const field = paperField();
    const run = new SoloRun(field);
    run.begin();
    toWave(run, 2);
    for (let i = 0; i < SOLO_RULES.lives; i++) {
      field.player.alive = false;
      run.onDown(field.player);
      tick(run, 4);
    }
    expect(run.finished).toBe(true);
    expect(run.result.cleared).toBe(false);
  });
});

describe('a solo run', () => {
  it('starts quiet, then puts a wave on the field', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    expect(run.wave, 'nothing yet').toBe(0);
    expect(field.retired, 'the field is cleared first').toBe(1);

    tick(run, 0.5);
    expect(run.wave, 'a moment to read the screen').toBe(0);

    tick(run, 3);
    expect(run.wave).toBe(1);
    expect(run.state).toBe('fighting');
    expect(field.spawned.length, 'wave one is on the field').toBeGreaterThan(0);
    expect(run.remaining).toBe(field.spawned.length);
  });

  it('advances only when the wave is actually cleared', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    const first = run.members.length;

    tick(run, 20);
    expect(run.wave, 'nobody was killed, so nothing moves on').toBe(1);

    run.members[0].alive = false;
    run.onDown(run.members[0]);
    tick(run, 5);
    expect(run.wave, 'one down is not the wave down').toBe(1);

    for (const m of run.members) { m.alive = false; run.onDown(m); }
    tick(run, 0.1);
    expect(run.state, 'a breather, not the next wave straight away').toBe('break');
    tick(run, 4);
    expect(run.wave).toBe(2);
    expect(run.members.length, 'and it grows').toBeGreaterThanOrEqual(first);
  });

  it('pays for a kill, and pays more later on', () => {
    expect(SoloRun.killScore(1)).toBe(100);
    expect(SoloRun.killScore(5)).toBeGreaterThan(SoloRun.killScore(1));
    expect(SoloRun.killScore(3, true), 'a tougher one is worth more')
      .toBe(SoloRun.killScore(3) * SOLO_RULES.aceScore);
  });

  it('only scores the machines that belong to this wave', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    const before = run.score;

    run.onDown({ alive: false });          // something else entirely
    expect(run.score, 'not ours, not scored').toBe(before);
    expect(run.kills).toBe(0);

    const m = run.members[0];
    m.alive = false;
    run.onDown(m);
    expect(run.kills).toBe(1);
    expect(run.score).toBe(before + SoloRun.killScore(run.wave));
  });

  it('hands out a wave bonus, and puts a choice on the table', () => {
    // The break used to be three and a half seconds of banner while the
    // supply came back for free — no moment in a run asked you to give
    // anything up. Now the breather is the decision.
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    field.player.hp = 10;

    for (const m of run.members) { m.alive = false; run.onDown(m); }
    const killScore = run.score;
    tick(run, 0.1);

    expect(run.score, 'clearing is worth something on its own').toBeGreaterThan(killScore);
    expect(run.offer, 'and something to spend the breather on').toBeTruthy();
    expect(run.offer.choices.length).toBe(3);
    expect(field.player.hp, 'nothing is handed over until it is asked for').toBe(10);

    run.choose(0);
    expect(field.player.hp, 'armour, then').toBeGreaterThan(10);
    expect(field.player.hp, 'but never a full heal').toBeLessThan(field.player.maxHp);
    expect(run.offer, 'and the table is cleared').toBe(null);
  });

  it('taking the ammunition is a different answer from taking the armour', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    field.player.hp = 10;
    for (const m of run.members) { m.alive = false; run.onDown(m); }
    tick(run, 0.1);

    run.choose(1);
    expect(field.player.rearmed, 'a full rack').toBe(1);
    expect(field.player.hp, 'and a lot less hull than the armour would have been')
      .toBeLessThan(10 + field.player.maxHp * 0.45);
  });

  it('and holding on buys a life back', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    const lives = run.lives;
    for (const m of run.members) { m.alive = false; run.onDown(m); }
    tick(run, 0.1);
    run.choose(2);
    expect(run.lives).toBe(lives + 1);
  });

  it('saying nothing takes the first, rather than stalling the run', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    field.player.hp = 10;
    for (const m of run.members) { m.alive = false; run.onDown(m); }
    tick(run, 6);                        // straight through the break
    expect(run.wave, 'the next wave came anyway').toBe(2);
    expect(run.offer).toBe(null);
    expect(field.player.hp, 'and something was taken').toBeGreaterThan(10);
  });

  it('a clean, quick wave is worth more than a slow, bloody one', () => {
    // Score used to be kills plus a flat sum for clearing, which measured
    // how long you sat there and nothing else.
    const play = ({ hit, slow }) => {
      const field = paperField();
      const run = new SoloRun(field).begin();
      tick(run, 3);
      if (slow) tick(run, SOLO_RULES.quickWithin + 2);
      if (hit) run.tookHits = true;
      const before = run.score;
      for (const m of run.members) { m.alive = false; run.onDown(m); }
      const kills = run.score - before;
      tick(run, 0.1);
      return { total: run.score - before - kills, bonus: run.lastBonus };
    };
    const best = play({ hit: false, slow: false });
    const worst = play({ hit: true, slow: true });
    expect(best.bonus.clean, 'untouched pays').toBeGreaterThan(0);
    expect(best.bonus.quick, 'and so does being quick about it').toBeGreaterThan(0);
    expect(worst.bonus.clean, 'taking hits does not').toBe(0);
    expect(worst.bonus.quick, 'nor does dragging it out').toBe(0);
    expect(best.total).toBeGreaterThan(worst.total);
  });

  it('aim is worth something, and missing everything is worth nothing', () => {
    const shoot = (fired, landed) => {
      const field = paperField();
      const run = new SoloRun(field).begin();
      tick(run, 3);
      field.player.weapons.shotsFired = fired;
      field.player.shotsLanded = landed;
      for (const m of run.members) { m.alive = false; run.onDown(m); }
      tick(run, 0.1);
      return run.lastBonus.aim;
    };
    expect(shoot(100, 100), 'every round home').toBe(SOLO_RULES.aimBonus);
    expect(shoot(100, 0), 'and none of them').toBe(0);
    expect(shoot(100, 50)).toBeGreaterThan(0);
    expect(shoot(0, 0), 'a blade run is not punished, it just pays nothing').toBe(0);
  });

  it('a life buys a machine, not a fresh one', () => {
    // Being shot down used to restore the hull completely while clearing a
    // wave gave 35% back, so at low health dying was the better move. A
    // life is meant to be the expensive way out of trouble.
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    field.player.hp = 4;
    field.player.alive = false;
    run.onDown(field.player);
    tick(run, 3.5);
    expect(field.player.alive, 'back on the field').toBe(true);
    expect(field.player.hp, 'with less than all of it')
      .toBeLessThan(field.player.maxHp);
    expect(field.player.hp, 'and more than you had').toBeGreaterThan(4);
  });

  it('costs a life when you go down, and puts you back', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);

    field.player.alive = false;
    run.onDown(field.player);
    expect(run.lives).toBe(SOLO_RULES.lives - 1);
    expect(run.state).toBe('down');
    expect(field.respawned, 'not instantly — the wreck is worth seeing').toBe(0);

    tick(run, 3);
    expect(field.respawned).toBe(1);
    expect(run.state, 'straight back into the wave that is still standing').toBe('fighting');
  });

  it('ends when the lives run out, and stops deciding anything after that', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);

    for (let i = 0; i < SOLO_RULES.lives; i++) {
      field.player.alive = false;
      run.onDown(field.player);
      if (run.state === 'down') tick(run, 3);
    }
    expect(run.lives).toBe(0);
    expect(run.state, 'a moment on the wreck first').toBe('ending');
    expect(run.finished).toBe(false);

    tick(run, 3);
    expect(run.finished).toBe(true);

    const frozen = { ...run.result };
    const waves = field.spawned.length;
    tick(run, 30);
    expect(run.result, 'a finished run does not keep playing').toEqual(frozen);
    expect(field.spawned.length, 'and nothing else turns up').toBe(waves);
  });

  it('never asks for more opponents than the screen can hold', () => {
    for (let n = 1; n <= 40; n++) {
      const specs = SoloRun.waveSpecs(n);
      expect(specs.length, `wave ${n}`).toBeGreaterThan(0);
      expect(specs.length, `wave ${n}`).toBeLessThanOrEqual(SOLO_RULES.maxAtOnce);
      for (const s of specs) {
        expect(OPPONENTS.some((o) => o.preset === s.preset), `wave ${n} builds ${s.preset}`).toBe(true);
        expect(s.toughness).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('gets harder in both directions', () => {
    const early = SoloRun.waveSpecs(1);
    const late = SoloRun.waveSpecs(12);
    expect(late.length, 'more of them').toBeGreaterThan(early.length);
    expect(late[late.length - 1].toughness, 'and tougher')
      .toBeGreaterThan(early[0].toughness);
  });

  it('leads every fifth wave with something that takes work', () => {
    for (let n = 1; n <= 20; n++) {
      const specs = SoloRun.waveSpecs(n);
      const aces = specs.filter((s) => s.ace);
      expect(aces.length, `wave ${n}`).toBe(n % SOLO_RULES.aceEvery === 0 ? 1 : 0);
      if (aces.length) {
        expect(aces[0].toughness, `wave ${n} ace`).toBeGreaterThan(specs[1].toughness);
      }
    }
  });

  it('sends every machine it has, somewhere across the ladder', () => {
    const kinds = new Set();
    for (let n = 1; n <= SOLO_WAVES; n++) {
      for (const s of SoloRun.waveSpecs(n)) kinds.add(s.preset);
    }
    expect(kinds.size, 'nothing in the roster goes unused').toBe(OPPONENTS.length);
  });

  it('escalates by size, not only by number', () => {
    // The whole reason there are twenty machines across five size classes.
    // Numbers alone make a fight longer; a thing twice your height makes it
    // a different fight.
    const rank = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4 };
    const biggest = (n) => Math.max(...SoloRun.waveSpecs(n).map((x) => rank[x.size]));

    expect(biggest(1), 'the first wave is drones').toBe(rank.tiny);
    expect(biggest(SOLO_WAVES), 'the last is siege frames').toBe(rank.huge);
    // And it only ever goes up.
    let last = -1;
    for (let n = 1; n <= SOLO_WAVES; n++) {
      const b = biggest(n);
      expect(b, `wave ${n} is not smaller than wave ${n - 1}`).toBeGreaterThanOrEqual(last);
      last = b;
    }
  });

  it('never sends a wave of one machine repeated', () => {
    for (let n = 3; n <= SOLO_WAVES; n++) {
      const specs = SoloRun.waveSpecs(n);
      if (specs.length < 3) continue;
      const kinds = new Set(specs.map((x) => x.preset));
      expect(kinds.size, `wave ${n} has more than one kind in it`).toBeGreaterThan(1);
    }
  });

  it('starting over is a clean sheet', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    toWave(run, 3);
    expect(run.score).toBeGreaterThan(0);

    run.begin();
    expect(run.wave).toBe(0);
    expect(run.score).toBe(0);
    expect(run.kills).toBe(0);
    expect(run.lives).toBe(SOLO_RULES.lives);
    expect(run.state).toBe('intro');
    expect(run.finished).toBe(false);
  });

  it('reports itself for the read-out without being asked twice', () => {
    const field = paperField();
    const run = new SoloRun(field).begin();
    tick(run, 3);
    const r = run.readout;
    expect(r.wave).toBe(1);
    expect(r.lives).toBe(SOLO_RULES.lives);
    expect(r.remaining).toBe(run.members.length);
    expect(r.banner, 'it says which wave, briefly').toContain('WAVE');

    tick(run, 4);
    expect(run.readout.banner, 'and then gets out of the way').toBe('');
  });

  it('runs on the step it is given, not on wall time', () => {
    // Two runs of the same length arrive at the same place, however finely
    // the time is sliced — the run is part of the fight, so it cannot be
    // allowed to depend on the frame rate.
    const play = (step) => {
      const run = new SoloRun(paperField()).begin();
      for (let t = 0; t < 6; t += step) {
        run.update(step);
        if (run.state === 'fighting') for (const m of run.members) { m.alive = false; run.onDown(m); }
      }
      return { wave: run.wave, score: run.score, kills: run.kills };
    };
    expect(play(1 / 120)).toEqual(play(1 / 60));
  });
});
