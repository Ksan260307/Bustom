#!/usr/bin/env node
/**
 * The smallest thing that can introduce two players to each other.
 *
 * It is not a game server. It never sees a fight, never runs a simulation,
 * and has no idea who won — once two people have been introduced their
 * computers talk directly and this could be switched off mid-match without
 * anybody noticing.
 *
 * All it does is hold a queue. Somebody arrives saying what rules they want
 * and how many players; when enough people who want the same thing are
 * waiting, it pairs them up, tells one of them to make an offer, and passes
 * the two codes between them. Then it forgets them.
 *
 * Run it anywhere with a public address:
 *
 *     node tools/matchmaker.js            (port 45080)
 *     node tools/matchmaker.js 8080
 *
 * It speaks the same newline-delimited JSON over TCP that the LAN game
 * does, so the client end is code that already exists and there is no new
 * dependency to install on whatever machine this ends up running on.
 *
 * Put that address into the game's VERSUS screen. There is deliberately
 * no database, no account and no state that outlives the process: a
 * matchmaker that has to be administered is a matchmaker that stops being
 * run.
 */

import net from 'node:net';

const PORT = Number(process.argv[2]) || 45080;

/** key -> [client]. The key is what makes two people want the same game. */
const queues = new Map();
/** matchId -> { members: [client] } */
const rooms = new Map();

let nextId = 1;

const keyOf = (want) => [
  Number(want?.players) || 2,
  Number(want?.rules?.roundSeconds) || 300,
  Number(want?.rules?.wins) || 3,
].join('/');

function send(ws, msg) {
  try { ws.write(`${JSON.stringify(msg)}\n`); } catch { /* gone */ }
}

function dequeue(client) {
  for (const [k, list] of queues) {
    const at = list.indexOf(client);
    if (at >= 0) list.splice(at, 1);
    if (!list.length) queues.delete(k);
  }
}

function tryMatch(key) {
  const list = queues.get(key) ?? [];
  const want = Number(key.split('/')[0]) || 2;
  if (list.length < want) return;
  const members = list.splice(0, want);
  if (!list.length) queues.delete(key);

  const id = `m${nextId++}`;
  rooms.set(id, { members });
  members.forEach((c, i) => {
    c.match = id;
    c.seat = i;
    // Seat zero makes the offers; everybody else answers. Somebody has to,
    // and the rule has to be one both ends work out the same way.
    send(c.ws, {
      t: 'matched',
      match: id,
      seat: i,
      players: members.length,
      offerer: i === 0,
      names: members.map((m) => m.name),
      rules: members[0].want?.rules ?? null,
    });
  });
  console.log(`matched ${id}: ${members.map((m) => m.name).join(' vs ')}`);
}

/** Reads a socket into whole messages, however the packets arrive. */
function reader(onMessage) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) { try { onMessage(JSON.parse(line)); } catch { /* not ours */ } }
      i = buf.indexOf('\n');
    }
    if (buf.length > 1 << 20) buf = '';
  };
}

const server = net.createServer((ws) => {
  ws.setNoDelay(true);
  const client = { ws, name: 'PLAYER', want: null, match: null, seat: -1 };

  ws.on('data', reader((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'queue') {
      client.name = String(msg.name ?? 'PLAYER').slice(0, 16);
      client.want = msg.want ?? {};
      dequeue(client);
      const key = keyOf(client.want);
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(client);
      send(ws, { t: 'queued', waiting: queues.get(key).length, want: Number(key.split('/')[0]) });
      tryMatch(key);
      return;
    }

    if (msg.t === 'cancel') { dequeue(client); send(ws, { t: 'cancelled' }); return; }

    // Signalling. Passed along untouched — it is a description of a network
    // path and means nothing here.
    if (msg.t === 'signal') {
      const room = rooms.get(client.match);
      if (!room) return;
      for (const other of room.members) {
        if (other === client) continue;
        if (msg.to !== undefined && other.seat !== msg.to) continue;
        send(other.ws, { t: 'signal', from: client.seat, code: msg.code, kind: msg.kind });
      }
    }
  }));

  const bye = () => {
    dequeue(client);
    const room = rooms.get(client.match);
    if (!room) return;
    for (const other of room.members) {
      if (other !== client) send(other.ws, { t: 'peerGone', seat: client.seat });
    }
    rooms.delete(client.match);
  };
  ws.on('close', bye);
  ws.on('error', bye);
});

server.listen(PORT, () => {
  console.log(`matchmaker on :${PORT} — introductions only, no fights`);
});
