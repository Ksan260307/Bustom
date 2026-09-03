import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Robot } from '../src/game/Robot.js';
import { Projectiles } from '../src/game/Weapons.js';
import { PRESETS } from '../src/core/Assembly.js';
import { Random } from '../src/core/Random.js';
import { EQUIP, ACTION_BITS } from '../src/core/constants.js';
import { testWorld, stripEquips } from './helpers/dom.js';
import { InputFrame, FrameInput } from '../src/net/InputFrame.js';
import { LoopbackHub } from '../src/net/Transport.js';
import { Session, PHASE, MAX_PLAYERS } from '../src/net/Session.js';
import { Lockstep } from '../src/net/Lockstep.js';
import { hashFight, hex } from '../src/net/StateHash.js';

const bit = (a) => 1 << ACTION_BITS.indexOf(a);

/** Carry whatever is in flight all the way over. */
function playMatchHub(sessions) {
  const hub = sessions[0]._hub;
  hub?.pump(12);
}

/**
 * One player's whole game: their own copy of the fight, and their own view
 * of the network. Nothing is shared between two of these but the hub.
 */
function makeClient(session, seatCount) {
  const world = testWorld();
  const random = new Random(session.seed);
  const build = () => {
    const a = stripEquips(PRESETS.biped.build());
    a.addEquipOnFace(a.core.id, 4, EQUIP.GATLING, { size: 0.7 });
    return a;
  };
  const robots = [];
  const inputs = [];
  for (let i = 0; i < seatCount; i++) {
    const r = new Robot(build(), world, { isPlayer: i === 0, random });
    // Placed off the seat number, not off who is watching: every machine
    // has to put every machine in the same spot.
    const ang = (i / seatCount) * Math.PI * 2;
    r.body.reset(
      new THREE.Vector3(Math.cos(ang) * 20, 6, Math.sin(ang) * 20),
      new THREE.Vector3(-Math.cos(ang), 0, -Math.sin(ang)),
    );
    robots.push(r);
    inputs.push(new FrameInput());
  }
  const projectiles = new Projectiles(new THREE.Scene(), world, { max: 256 });

  /**
   * tick -> fingerprint.
   *
   * Taken inside the step, so it belongs to a step number rather than to a
   * moment. Comparing two machines at the same instant compares one that
   * has run 150 steps against one that has run 148, and calls a connection
   * being four frames behind a desync.
   */
  const marks = new Map();

  const step = (frames, tick) => {
    for (let i = 0; i < robots.length; i++) {
      inputs[i].apply(frames[i], 1 / 60);
      robots[i].update(inputs[i], 1 / 60);
      robots[i].weapons.update({
        firing: inputs[i].isDown('fire'),
        projectiles,
        targets: robots.filter((_, k) => k !== i),
        aimPoint: robots[(i + 1) % robots.length].position,
      }, 1 / 60);
    }
    projectiles.update(1 / 60, robots);
    if (tick % 20 === 0) marks.set(tick, hashFight({ robots, projectiles, random }));
  };

  return {
    robots,
    step,
    marks,
    hash: () => hashFight({ robots, projectiles, random }),
  };
}

/**
 * Do these machines agree about the steps they have both run?
 *
 * Only the steps they have BOTH run. A machine four frames behind is a
 * machine four frames behind, which is what a network is.
 */
function agreeOn(clients) {
  const shared = [...clients[0].marks.keys()]
    .filter((t) => clients.every((c) => c.marks.has(t)));
  const rows = shared.map((t) => ({
    tick: t,
    hashes: clients.map((c) => hex(c.marks.get(t))),
  }));
  return {
    shared: rows.length,
    disagreed: rows.filter((r) => new Set(r.hashes).size > 1),
  };
}

/** A different press pattern per seat, so no two are accidentally alike. */
const scripted = (seat, t) => new InputFrame(
  (seat % 2 ? bit('forward') : bit('back'))
    | ((t + seat * 13) % 80 < 40 ? bit('left') : bit('right'))
    | ((t + seat * 7) % 20 < 5 ? bit('fire') : 0)
    | ((t + seat * 31) % 180 === 0 ? bit('up') : 0),
  Math.round(Math.sin((t + seat * 20) * 0.09) * 220),
  Math.round(Math.cos((t + seat * 11) * 0.06) * 70),
);

/**
 * Run a whole match between `n` people on `n` separate "machines", over a
 * connection with real latency, and see whether they end up in the same
 * fight.
 */
function playMatch(n, { latency = 4, jitter = 0, loss = 0, steps = 240, seedFor = 99 } = {}) {
  const hub = new LoopbackHub({
    latency, jitter, loss, random: loss || jitter ? new Random(7) : null,
  });
  const sessions = [];
  for (let i = 0; i < n; i++) {
    sessions.push(new Session({
      transport: hub.connect(`p${i}`),
      isHost: i === 0,
      name: `P${i + 1}`,
      delay: latency + 2,
    }));
  }
  // Settling a lobby takes several hops — hello, roster, ready, start —
  // and each hop costs the whole latency. Waiting one hop was the mistake
  // that made half these sessions start no fight at all.
  const settle = () => hub.pump((latency + jitter + 1) * 6 + 8);
  settle();

  // The host picks the seed, so the test has to be able to as well.
  const realRandom = Math.random;
  Math.random = () => seedFor / 0xffffffff;
  for (const s of sessions) s.setReady(true);
  settle();
  Math.random = realRandom;
  for (const s of sessions) {
    if (!s.net) throw new Error(`${s.id} never started: ${s.phase}`);
  }

  const clients = sessions.map((s) => makeClient(s, s.order.length));

  for (let t = 0; t < steps; t++) {
    sessions.forEach((s, i) => {
      const seat = s.slotOf(s.id);
      s.pump(scripted(seat, s.net.sendTick), (frames, k) => clients[i].step(frames, k));
    });
    hub.pump(1);
  }
  for (const s2 of sessions) s2._hub = hub;
  return { sessions, clients, hub };
}

// ============================================================
//  A lobby.
// ============================================================

describe('a room fills up before anybody fights', () => {
  it('everybody sees everybody, whoever they connected to', () => {
    const hub = new LoopbackHub();
    const host = new Session({ transport: hub.connect('h'), isHost: true, name: 'HOST' });
    const a = new Session({ transport: hub.connect('a'), name: 'ALPHA' });
    const b = new Session({ transport: hub.connect('b'), name: 'BRAVO' });
    hub.pump(3);
    for (const s of [host, a, b]) {
      expect(s.roster.map((p) => p.name).sort(), s.id).toEqual(['ALPHA', 'BRAVO', 'HOST']);
    }
  });

  it('holds four and no more', () => {
    const hub = new LoopbackHub();
    const host = new Session({ transport: hub.connect('h'), isHost: true });
    for (let i = 0; i < 6; i++) new Session({ transport: hub.connect(`p${i}`) });
    hub.pump(3);
    expect(host.roster.length).toBe(MAX_PLAYERS);
    expect(host.full).toBe(true);
  });

  it('starts only when everybody has said they are', () => {
    const hub = new LoopbackHub();
    const host = new Session({ transport: hub.connect('h'), isHost: true });
    const a = new Session({ transport: hub.connect('a') });
    hub.pump(3);
    host.setReady(true);
    hub.pump(3);
    expect(host.phase, 'one of two is not everybody').toBe(PHASE.LOBBY);
    a.setReady(true);
    hub.pump(3);
    expect(host.phase).toBe(PHASE.FIGHT);
    expect(a.phase).toBe(PHASE.FIGHT);
  });

  it('and everybody starts the same fight, in the same order', () => {
    // The two things that must be settled exactly once. A seed each side
    // picked for itself is two fights that look alike for a second.
    const { sessions } = playMatch(3, { steps: 0 });
    const seeds = new Set(sessions.map((s) => s.seed));
    expect(seeds.size, 'one seed').toBe(1);
    expect([...seeds][0]).toBeGreaterThan(0);
    const orders = new Set(sessions.map((s) => s.order.join(',')));
    expect(orders.size, 'one running order').toBe(1);
    // And each of them knows which machine is theirs.
    expect(sessions.map((s) => s.slotOf(s.id)).sort()).toEqual([0, 1, 2]);
  });
});

// ============================================================
//  The fight itself.
// ============================================================

describe('separate machines end up in the same fight', () => {
  it('two of them, over a connection with real delay', () => {
    const { clients, sessions } = playMatch(2, { latency: 4, steps: 240 });
    const { shared, disagreed } = agreeOn(clients);
    expect(shared, 'they ran a fight together').toBeGreaterThan(8);
    expect(disagreed, JSON.stringify(disagreed.slice(0, 2))).toEqual([]);
    // And the fight was worth having.
    expect(sessions[0].net.tick).toBeGreaterThan(180);
    expect(clients[0].robots[0].position.distanceTo(clients[0].robots[1].position))
      .toBeGreaterThan(1);
  });

  it('four of them', () => {
    const { clients } = playMatch(4, { latency: 3, steps: 180 });
    const { shared, disagreed } = agreeOn(clients);
    expect(shared).toBeGreaterThan(6);
    expect(disagreed, JSON.stringify(disagreed.slice(0, 2))).toEqual([]);
  });

  it('and over a connection that jitters', () => {
    // Frames arriving late and out of order is the normal case, not the
    // exception. What must not change is the answer.
    const clean = playMatch(2, { latency: 3, steps: 220 });
    const rough = playMatch(2, { latency: 3, jitter: 5, steps: 220 });
    expect(agreeOn(rough.clients).disagreed, 'still agreed').toEqual([]);
    // A worse line is slower, not different — the same fight, further
    // behind. So the steps they BOTH reached must match across the two runs
    // as well, not just within one of them.
    const at = (m, t) => (m.has(t) ? hex(m.get(t)) : null);
    const both = [...clean.clients[0].marks.keys()]
      .filter((t) => rough.clients[0].marks.has(t));
    expect(both.length).toBeGreaterThan(6);
    for (const t of both) {
      expect(at(rough.clients[0].marks, t), `step ${t}`)
        .toBe(at(clean.clients[0].marks, t));
    }
    expect(rough.sessions[0].net.stalled)
      .toBeGreaterThanOrEqual(clean.sessions[0].net.stalled);
  });

  it('nobody runs a step the others have not', () => {
    // The property the whole scheme rests on. Not "they end up close" —
    // no machine is ever ahead of another by more than the delay buys.
    const { sessions } = playMatch(3, { latency: 4, jitter: 3, steps: 150 });
    const ticks = sessions.map((s) => s.net.tick);
    expect(Math.max(...ticks) - Math.min(...ticks), ticks.join(','))
      .toBeLessThanOrEqual(sessions[0].delay);
  });
});

// ============================================================
//  When it goes wrong.
// ============================================================

describe('a fight that has gone wrong stops', () => {
  it('says so the moment two machines disagree', () => {
    const { sessions, clients } = playMatch(2, { latency: 2, steps: 40 });
    // A real divergence starts too small to see and is fatal anyway, so
    // this is what one looks like: one machine, one bit out.
    clients[1].robots[0].body.position.x += 1e-12;
    sessions.forEach((s, i) => s.reportHash(100, clients[i].hash()));
    // The hub still has to carry them to each other.
    sessions[0].transport.send({ t: 'noop' });
    playMatchHub(sessions);
    expect(sessions.every((s) => s.phase === PHASE.BROKEN), 'both of them stopped')
      .toBe(true);
    // And a stopped fight does not quietly carry on running steps.
    expect(sessions[0].pump(InputFrame.idle(), () => {})).toBe(0);
  });

  it('plays on when the only other player leaves, rather than ending', () => {
    // It used to stop, which rewards walking out of a round you are losing.
    // The computer picks the machine up and the match is played to its end,
    // so leaving costs you the match instead of erasing it.
    const { sessions, hub, clients } = playMatch(2, { latency: 2, steps: 60 });
    const was = sessions[0].net.tick;
    sessions[1].close();
    hub.pump(8);
    expect(sessions[0].phase, 'still a fight').toBe(PHASE.FIGHT);
    for (let t = 0; t < 90; t++) {
      sessions[0].pump(scripted(0, t), (f, k) => clients[0].step(f, k));
      hub.pump(1);
    }
    expect(sessions[0].net.tick, 'and it went on').toBeGreaterThan(was + 40);
  });

  it('carries on with three, and leaves the machine standing', () => {
    const { sessions, clients, hub } = playMatch(3, { latency: 2, steps: 90 });
    const seat = sessions[0].slotOf(sessions[2].id);
    const before = clients[0].robots[seat].position.clone();
    const was = sessions[0].net.tick;
    sessions[2].close();
    hub.pump(8);
    for (let t = 0; t < 90; t++) {
      sessions[0].pump(scripted(0, t), (f, k) => clients[0].step(f, k));
      sessions[1].pump(scripted(1, t), (f, k) => clients[1].step(f, k));
      hub.pump(1);
    }
    expect(sessions[0].phase, 'two is still a fight').toBe(PHASE.FIGHT);
    expect(sessions[0].net.tick, 'and it went on').toBeGreaterThan(was + 40);
    // Standing where they were rather than vanishing: every client can
    // apply that rule to the same step without being told which.
    expect(clients[0].robots[seat].position.distanceTo(before)).toBeLessThan(20);
    // And the two who stayed are still running the same fight.
    expect(agreeOn([clients[0], clients[1]]).disagreed).toEqual([]);
  });
});

// ============================================================
//  Somebody leaves, and the computer picks up their machine.
// ============================================================

describe('a machine whose player has gone is taken over', () => {
  it('on the same step on every machine, or not at all', () => {
    // This is the whole difficulty of it. Handing a machine to the computer
    // CHANGES THE FIGHT — the AI draws two numbers out of the fight's own
    // stream the moment it is built, so a client that builds it one step
    // earlier than another has put every later dice roll out of step, and
    // the two are no longer playing the same game.
    //
    // So the step is announced, not decided locally.
    const { sessions } = playMatch(3, { latency: 3, steps: 120 });
    const leaver = sessions[2];
    const who = leaver.id;
    leaver.close();
    sessions[0]._hub.pump(20);

    const ats = sessions.slice(0, 2).map((s) => s.net.dropAt.get(who));
    expect(ats[0], 'both were told a step').toBeGreaterThan(0);
    expect(ats[1], `${ats[0]} against ${ats[1]}`).toBe(ats[0]);
  });

  it('and only one of the survivors gets to say which step', () => {
    // Two clients each choosing their own step would choose differently.
    // The rule is "first in the running order who is still here" — an
    // answer every client works out for itself, from what it already has.
    const { sessions } = playMatch(3, { latency: 2, steps: 60 });
    const gone = sessions[2].id;
    const callers = sessions.slice(0, 2).map((s) => s.callsIt(gone));
    expect(callers.filter(Boolean).length, 'exactly one of them').toBe(1);
    expect(callers[0], 'and it is the first one still here').toBe(true);
  });

  it('and the step is one everybody can actually reach', () => {
    // Not "a few steps from now": everything after the moment they stopped
    // sending is input that is never coming, so a step chosen further out
    // would be a step everybody waits at for ever.
    const { sessions } = playMatch(2, { latency: 3, steps: 90 });
    const a = sessions[0];
    const gone = sessions[1].id;
    const at = a.net.firstMissing(gone);
    expect(at).toBeGreaterThanOrEqual(a.net.tick);
    a.net.drop(gone, at);
    // Everything up to there is in hand, so it can run straight on.
    expect(a.net.ready()).toBe(true);
  });

  it('and their real presses are dropped from that step, not played', () => {
    // One client might have received a frame that another never will. If
    // the one who has it plays it, those two are running different fights.
    const net = new Lockstep({ players: ['a', 'b'], localId: 'a', delay: 2 });
    net.receive('b', 10, new InputFrame(bit('fire')).toArray());
    net.drop('b', 10);
    expect(net.framesFor(10)[1].buttons, 'ignored from the agreed step').toBe(0);
    expect(net.isGone('b', 9)).toBe(false);
    expect(net.isGone('b', 10)).toBe(true);
  });

  it('and two announcements of the same departure agree', () => {
    const net = new Lockstep({ players: ['a', 'b', 'c'], localId: 'a', delay: 2 });
    net.drop('c', 40);
    net.drop('c', 55);
    expect(net.dropAt.get('c'), 'the earlier one stands').toBe(40);
  });
});
