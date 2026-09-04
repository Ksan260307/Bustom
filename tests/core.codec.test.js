import { describe, it, expect } from 'vitest';
import {
  packDoc, unpackDoc, isPacked, DOC_PREFIX, DOC_PREFIX_RAW,
  toBase64Url, fromBase64Url, wireSize,
} from '../src/core/Codec.js';
import { Assembly, PRESETS } from '../src/core/Assembly.js';

/**
 * The codec exists because of one measured number: a machine built inside
 * the game's own limits serialised to 1.79 MB, which is over the LAN
 * relay's line cap, over Steam's packet size, and over what a WebRTC data
 * channel will carry. All three dropped it — the LAN one silently, for
 * ever.
 *
 * So the tests that matter are: does it come back the same, does it come
 * back when it was never packed, and is the result actually small.
 */

/** A machine with real sculpting in it, which is the case that broke. */
function carved(res = 16) {
  const a = PRESETS.biped.build();
  a.setVoxResolution(res);
  const parts = [];
  a.walk((p) => { if (p.vox) parts.push(p); });
  for (const q of parts.slice(0, 6)) {
    const n = q.vox.n;
    for (let z = 0; z < n; z += 2) {
      for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 3) q.vox.set(x, y, z, 0);
    }
  }
  return a;
}

describe('a machine, written down small', () => {
  it('comes back exactly as it went in', async () => {
    const doc = PRESETS.biped.build().toJSON();
    const back = await unpackDoc(await packDoc(doc));
    // Compared as JSON, which is what a document IS here. See the negative
    // zero test below for why `toEqual` is the wrong question to ask.
    expect(JSON.stringify(back)).toBe(JSON.stringify(doc));
  });

  it('turns a negative zero into a positive one, and that is fine', async () => {
    // Real: a quaternion built by THREE lands on -0 components regularly,
    // and `JSON.stringify(-0)` is "0". So this is not something the codec
    // could avoid — every JSON document that has ever been saved by this
    // game has done it.
    //
    // It is worth a test because it is worth KNOWING. The simulation cannot
    // tell the two apart (every operation but 1/x treats them alike), and
    // the netcode's state hash already folds them together deliberately —
    // so the one place it could have mattered is the one place it was
    // already handled.
    const back = await unpackDoc(await packDoc({ rot: [0, -0, 1] }));
    expect(Object.is(back.rot[1], -0)).toBe(false);
    expect(back.rot[1]).toBe(0);
  });

  it('and still builds a machine on the other side', async () => {
    const a = carved();
    const back = Assembly.fromJSON(await unpackDoc(await packDoc(a.toJSON())));
    expect(back.name).toBe(a.name);
    expect(back.voxRes).toBe(a.voxRes);

    const count = (asm) => { let n = 0; asm.walk(() => { n++; }); return n; };
    expect(count(back)).toBe(count(a));
  });

  it('is very much smaller, which is the entire point', async () => {
    const a = carved();
    const plain = JSON.stringify(a.toJSON());
    const packed = await packDoc(a.toJSON());
    // Measured on a full-size machine this is 30x. A small one compresses
    // less well, so the assertion is deliberately loose — what it is
    // guarding is a regression to "no compression at all", not a ratio.
    expect(packed.length).toBeLessThan(plain.length / 3);
  });

  it('says what it is, so a stray paste is not mistaken for one', async () => {
    expect(isPacked(await packDoc({ a: 1 }))).toBe(true);
    expect(isPacked('{"a":1}')).toBe(false);
    expect(isPacked('')).toBe(false);
    expect(isPacked(null)).toBe(false);
    expect(isPacked(undefined)).toBe(false);
  });

  it('still reads a document written before it existed', async () => {
    // Every machine already saved is plain JSON with no prefix on it.
    const doc = PRESETS.biped.build().toJSON();
    const back = await unpackDoc(JSON.stringify(doc));
    expect(JSON.stringify(back)).toBe(JSON.stringify(doc));
  });

  it('carries text that is not Latin', async () => {
    const doc = { name: 'ロボット', note: '加工した機体 — 日本語のまま' };
    expect(await unpackDoc(await packDoc(doc))).toEqual(doc);
  });
});

describe('the environment may not have a compressor', () => {
  it('falls back to a form that needs none, and reads it back', async () => {
    const real = globalThis.CompressionStream;
    delete globalThis.CompressionStream;
    const doc = { hello: 'world', n: [1, 2, 3] };
    const packed = await packDoc(doc);
    expect(packed.startsWith(DOC_PREFIX_RAW), 'marked as uncompressed').toBe(true);
    globalThis.CompressionStream = real;

    // And a compressor that IS present still reads what one without wrote.
    expect(await unpackDoc(packed)).toEqual(doc);
  });

  it('a compressed document says so plainly when it cannot be read', async () => {
    const packed = await packDoc({ a: 1 });
    expect(packed.startsWith(DOC_PREFIX)).toBe(true);
    const real = globalThis.DecompressionStream;
    const realC = globalThis.CompressionStream;
    delete globalThis.DecompressionStream;
    delete globalThis.CompressionStream;
    await expect(unpackDoc(packed)).rejects.toThrow();
    globalThis.DecompressionStream = real;
    globalThis.CompressionStream = realC;
  });
});

describe('base64url, which is what makes it storable', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it('uses no character that needs escaping in a URL or a JSON string', async () => {
    const packed = await packDoc(carved().toJSON());
    expect(packed.slice(DOC_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]*$/);
  });

  it('handles a payload far past the argument limit of fromCharCode', () => {
    // The chunking exists because `String.fromCharCode(...a)` on a megabyte
    // of bytes is a megabyte-long argument list, and that throws.
    const big = new Uint8Array(300_000).map((_, i) => i & 255);
    expect(() => toBase64Url(big)).not.toThrow();
    expect(fromBase64Url(toBase64Url(big)).length).toBe(big.length);
  });
});

describe('how big it will be on the wire', () => {
  it('counts bytes, not characters', () => {
    expect(wireSize('abc')).toBe(3);
    expect(wireSize('日本語'), 'three characters, nine bytes').toBe(9);
    expect(wireSize(null)).toBe(0);
  });

  it('a packed machine clears every transport it used to break', async () => {
    const packed = await packDoc(carved(32).toJSON());
    const message = JSON.stringify({ t: 'machine', machine: packed });
    const bytes = wireSize(message);
    expect(bytes, 'the WebRTC data-channel message limit').toBeLessThan(200 * 1024);
    expect(bytes, "Steam's reliable packet").toBeLessThan(1 << 20);
    expect(bytes, "the LAN relay's line cap").toBeLessThan(8 << 20);
  });
});
