import {
  describe, it, expect, vi,
} from 'vitest';
import { SteamNet, steamNetSupport } from '../electron/steamnet.js';

/**
 * A Steam that behaves like Steam, in one process.
 *
 * There is no Steam client here, no App ID and no native binding, and there
 * will not be one on a build machine either — so the choice is between
 * testing this against a stand-in and not testing it at all. The stand-in
 * copies the shape of the calls and the ONE thing about Steam that shapes
 * the code above it: packets are not delivered, they are queued, and
 * somebody has to come and ask for them.
 */
function fakeSteam() {
  const lobbies = new Map();
  let nextLobby = 1;

  const makeLobby = (id, owner, limit) => {
    const members = [owner];
    const data = new Map();
    return {
      id,
      members,
      getOwner: () => ({ steamId64: owner }),
      getMembers: () => members.map((m) => ({ steamId64: m })),
      memberCount: () => members.length,
      memberLimit: () => limit,
      setData: (k, v) => data.set(k, v),
      getData: (k) => data.get(k),
      leave: () => {},
    };
  };

  /** steamId -> queued packets */
  const inbox = new Map();

  const clientFor = (me) => ({
    localplayer: { getSteamId: () => ({ steamId64: me }), getName: () => me },
    matchmaking: {
      LobbyType: { Public: 2 },
      createLobby: async (type, limit) => {
        const id = `L${nextLobby++}`;
        const l = makeLobby(id, me, limit);
        lobbies.set(id, l);
        return l;
      },
      joinLobby: async (id) => {
        const l = lobbies.get(id);
        if (!l) throw new Error('no such lobby');
        if (l.members.length >= l.memberLimit()) throw new Error('full');
        if (!l.members.includes(me)) l.members.push(me);
        return l;
      },
      getLobbies: async () => [...lobbies.values()],
    },
    networking: {
      SendType: { Reliable: 2 },
      sendP2PPacket: (to, type, data) => {
        const id = String(to.steamId64 ?? to);
        if (!inbox.has(id)) inbox.set(id, []);
        inbox.get(id).push({ steamId: { steamId64: me }, data });
      },
      getP2PPacketSize: () => (inbox.get(me)?.length ? inbox.get(me)[0].data.length : 0),
      readP2PPacket: () => inbox.get(me)?.shift() ?? null,
    },
  });

  return { clientFor, lobbies, inbox };
}

describe('what this build needs from Steam, checked rather than assumed', () => {
  it('says plainly when it is not there', () => {
    expect(steamNetSupport(null).ok).toBe(false);
    expect(steamNetSupport(null).reason).toContain('Steam');
  });

  it('and when the binding is too old for one half of it', () => {
    // These calls have grown into `steamworks.js` over time. A build with an
    // older one should say so, not throw halfway through hosting a game.
    expect(steamNetSupport({ networking: { sendP2PPacket() {} } }).reason).toContain('ロビー');
    expect(steamNetSupport({ matchmaking: { createLobby() {} } }).reason).toContain('P2P');
  });

  it('and when it is all there', () => {
    const steam = fakeSteam();
    expect(steamNetSupport(steam.clientFor('a')).ok).toBe(true);
  });
});

describe('a Steam lobby is a room, and its packets are the fight', () => {
  it('opens a room, and it turns up in the list with what it is', () => {
    const steam = fakeSteam();
    const host = new SteamNet(steam.clientFor('alice'), () => {});
    return host.host(2).then(async (info) => {
      expect(info.owner).toBe(true);
      host.describe('ALICE', { roundSeconds: 300, wins: 3 });
      const seen = await host.list();
      expect(seen.length).toBe(1);
      expect(seen[0].name).toBe('ALICE');
      // The rules go on the door, so somebody can see what they are joining
      // before they join it.
      expect(seen[0].rules).toEqual({ roundSeconds: 300, wins: 3 });
      expect(seen[0].limit).toBe(2);
      host.leave();
    });
  });

  it('carries a message from one member to another', async () => {
    vi.useFakeTimers();
    const steam = fakeSteam();
    const heard = [];
    const host = new SteamNet(steam.clientFor('alice'), (from, m) => heard.push([from, m.t]));
    const info = await host.host(4);
    const guest = new SteamNet(steam.clientFor('bob'), () => {});
    await guest.join(info.lobby);

    guest.send({ t: 'in', k: 7 });
    // Steam has no "a packet arrived" callback, so the poll is the delivery.
    vi.advanceTimersByTime(20);
    expect(heard).toEqual([['bob', 'in']]);
    host.leave();
    guest.leave();
    vi.useRealTimers();
  });

  it('never sends a message back to whoever sent it', async () => {
    vi.useFakeTimers();
    const steam = fakeSteam();
    const heard = [];
    const host = new SteamNet(steam.clientFor('alice'), (f, m) => heard.push([f, m.t]));
    const info = await host.host(4);
    const guest = new SteamNet(steam.clientFor('bob'), () => {});
    await guest.join(info.lobby);
    host.send({ t: 'start' });
    vi.advanceTimersByTime(20);
    expect(heard, 'the sender is not a recipient').toEqual([]);
    host.leave();
    guest.leave();
    vi.useRealTimers();
  });

  it('drains everything waiting, not one packet a tick', async () => {
    // A frame that sat in the queue for four polls is four steps of the
    // fight that nobody could take.
    vi.useFakeTimers();
    const steam = fakeSteam();
    const heard = [];
    const host = new SteamNet(steam.clientFor('alice'), (f, m) => heard.push(m.k));
    const info = await host.host(4);
    const guest = new SteamNet(steam.clientFor('bob'), () => {});
    await guest.join(info.lobby);
    for (let i = 0; i < 12; i++) guest.send({ t: 'in', k: i });
    vi.advanceTimersByTime(10);
    expect(heard.length, 'all of them, in one poll').toBe(12);
    expect(heard[0]).toBe(0);
    expect(heard[11], 'and in the order they were sent').toBe(11);
    host.leave();
    guest.leave();
    vi.useRealTimers();
  });

  it('stops asking once the room is left', async () => {
    vi.useFakeTimers();
    const steam = fakeSteam();
    const heard = [];
    const host = new SteamNet(steam.clientFor('alice'), (f, m) => heard.push(m.t));
    const info = await host.host(4);
    const guest = new SteamNet(steam.clientFor('bob'), () => {});
    await guest.join(info.lobby);
    host.leave();
    guest.send({ t: 'in' });
    vi.advanceTimersByTime(50);
    expect(heard).toEqual([]);
    guest.leave();
    vi.useRealTimers();
  });

  it('will not open a room without a Steam that can', async () => {
    const net = new SteamNet(null, () => {});
    await expect(net.host(2)).rejects.toThrow();
  });
});
