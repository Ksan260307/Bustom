import { Transport } from './Transport.js';

/**
 * A connection over the internet, through whatever is in the way.
 *
 * The LAN socket works between two machines on the same network and nowhere
 * else: almost every home connection sits behind a router that will not
 * accept an incoming connection, so "just give them your address" stops
 * working the moment the other person is not in the building.
 *
 * WebRTC is the way through. Both ends ask a public STUN server what their
 * address looks like from the outside, then send packets to each other at
 * the same time — the router lets the reply in because it thinks it is the
 * answer to something that went out. Nothing in the middle relays the
 * fight; once it is up, the two computers are talking directly.
 *
 * The part that cannot be done alone is the introduction. Each side has to
 * see the other's description before either can connect, and there is no
 * connection yet to send it over. That is what SIGNALLING is, and this
 * offers two ways to do it:
 *
 *   - By hand. Each side produces a code and pastes in the other's. It is
 *     clumsy — you send it over chat, or read it out — but it needs no
 *     server at all, which means it works today and will still work when
 *     nobody is running one.
 *
 *   - Through a matchmaker. A tiny server that does nothing but pass those
 *     two codes between people waiting for a game. One ships in `tools/`.
 *
 * The fight itself never goes near either. Both are gone by the time the
 * first shot is fired.
 */

/**
 * Public STUN servers: the "what does my address look like from out there"
 * question, and nothing else. They never see the fight.
 */
export const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** How long to wait for the address-gathering to finish, in ms. */
const GATHER_MS = 4000;

/** Is there a WebRTC stack here at all? */
export function rtcAvailable() {
  return typeof RTCPeerConnection !== 'undefined';
}

/**
 * Squeeze a session description into something a person can send.
 *
 * An SDP is a couple of kilobytes of text with newlines in it, which
 * survives neither a chat box nor being read aloud. This is the same thing
 * as JSON, deflated by the browser and written in base64.
 */
export async function packCode(desc) {
  const json = JSON.stringify({ t: desc.type, s: desc.sdp });
  const bytes = new TextEncoder().encode(json);
  const packed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')),
  ).arrayBuffer();
  let bin = '';
  for (const b of new Uint8Array(packed)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '');
}

export async function unpackCode(code) {
  const clean = String(code ?? '').trim().replace(/\s+/g, '');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const json = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
  ).text();
  const o = JSON.parse(json);
  return { type: o.t, sdp: o.s };
}

/**
 * Wait until the connection has finished working out its own addresses.
 *
 * Candidates could be sent one at a time as they turn up, which connects
 * faster — but each one is another thing for a person to copy and paste. So
 * they are all gathered into the one description, and the wait is capped:
 * a stubborn network can spend a very long time looking for a candidate
 * that would not have helped.
 */
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') done();
    });
  });
}

/**
 * One end of a direct connection to somebody on the internet.
 *
 * The same three verbs as every other transport, so nothing above this
 * knows or cares which kind of connection it got.
 */
export class RtcTransport extends Transport {
  constructor(id) {
    super(id);
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.channel = null;
    this.onState = () => {};
    this.pc.addEventListener('connectionstatechange', () => {
      this.onState(this.pc.connectionState);
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        this._deliver('peer', { t: 'bye' });
      }
    });
  }

  _wire(channel) {
    this.channel = channel;
    // Unordered and unreliable would be wrong here. Lockstep needs every
    // frame and needs to know which step each is for; a lost one stops the
    // fight for everybody, so it is worth the retransmit.
    channel.addEventListener('message', (e) => {
      try { this._deliver('peer', JSON.parse(e.data)); } catch { /* not ours */ }
    });
    channel.addEventListener('open', () => this.onState('open'));
    return channel;
  }

  /**
   * Start a game: make a code to give the other person.
   *
   * @returns {{code: string, accept: (theirs: string) => Promise<void>}}
   */
  static async offer(id = 'h') {
    const t = new RtcTransport(id);
    t._wire(t.pc.createDataChannel('fight', { ordered: true }));
    await t.pc.setLocalDescription(await t.pc.createOffer());
    await gathered(t.pc);
    return {
      transport: t,
      code: await packCode(t.pc.localDescription),
      /** Their answer, which finishes the introduction. */
      accept: async (theirs) => {
        await t.pc.setRemoteDescription(await unpackCode(theirs));
      },
    };
  }

  /**
   * Join one: take their code, make the code that answers it.
   */
  static async answer(theirCode, id = 'g') {
    const t = new RtcTransport(id);
    t.pc.addEventListener('datachannel', (e) => t._wire(e.channel));
    await t.pc.setRemoteDescription(await unpackCode(theirCode));
    await t.pc.setLocalDescription(await t.pc.createAnswer());
    await gathered(t.pc);
    return { transport: t, code: await packCode(t.pc.localDescription) };
  }

  /** Wait until the channel is actually carrying, or give up. */
  ready(ms = 15000) {
    if (this.channel?.readyState === 'open') return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      const check = () => {
        if (this.channel?.readyState !== 'open') return;
        clearTimeout(timer);
        resolve(this);
      };
      this.onState = check;
      this.pc.addEventListener('datachannel', () => setTimeout(check, 0));
      check();
    });
  }

  send(msg) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(msg));
    return this;
  }

  close() {
    try { this.channel?.close(); } catch { /* already gone */ }
    try { this.pc.close(); } catch { /* already gone */ }
    return super.close();
  }
}
