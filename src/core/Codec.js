// ============================================================
//  One machine, written down small.
//
//  A machine built inside the game's OWN limits — eighty blocks, four
//  million voxels — serialises to 1.79 MB of JSON, because the voxel grid
//  is run-length encoded and then those runs are written out as decimal
//  numbers inside a JSON array. Nine hundred thousand of them.
//
//  That one number was breaking four things at once:
//
//    - the save wrote 1.79 MB into localStorage on every Ctrl+S
//    - undo cost 62 ms, because a snapshot is the same document
//    - the LAN relay drops any line over 1 MB, so a machine that size
//      never reached the other player and never would
//    - Steam's reliable P2P packet has about the same ceiling
//
//  And `Share.js` had had a deflate in it the whole time, used only for QR
//  codes.
//
//  MEASURED, in the shell the game ships in, on that same 1.79 MB machine:
//
//      as it was, JSON                 1830 KB   31 ms
//      RLE as a base64 typed array     4677 KB  225 ms   ← 2.5x BIGGER
//      deflate                           45 KB   30 ms   ← 40x smaller
//      both                             110 KB   47 ms
//
//  The obvious clever answer is the wrong one twice over. Packing the runs
//  into a Uint32Array spends four bytes on a value whose maximum is 16, and
//  then base64 adds a third on top of that; and running base64 BEFORE
//  deflate destroys exactly the byte patterns deflate lives on, which is
//  why "both" is worse than deflate alone. Plain JSON, deflated, is 40x
//  smaller than what shipped and no slower to produce.
//
//  45 KB clears the LAN cap, the Steam packet limit and the WebRTC message
//  size with two orders of magnitude to spare.
// ============================================================

/** Deflated, base64url. */
export const DOC_PREFIX = 'BLOZ1:';
/** Not deflated — for an environment with no CompressionStream. */
export const DOC_PREFIX_RAW = 'BLOZ0:';

export const hasCompression = () => typeof CompressionStream !== 'undefined'
  && typeof DecompressionStream !== 'undefined';

// ---------------------------------------------------------- bytes <-> text

export function toBase64Url(bytes) {
  let bin = '';
  // In chunks, because `String.fromCharCode(...a)` on a megabyte of bytes
  // is an argument list a megabyte long and blows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

export async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// ---------------------------------------------------------- documents

/** Is this one of ours, rather than plain JSON or somebody's clipboard? */
export function isPacked(text) {
  return typeof text === 'string'
    && (text.startsWith(DOC_PREFIX) || text.startsWith(DOC_PREFIX_RAW));
}

/**
 * Any JSON-able document, as one short string.
 *
 * @param {object} doc
 * @returns {Promise<string>}
 */
export async function packDoc(doc) {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  if (!hasCompression()) return DOC_PREFIX_RAW + toBase64Url(bytes);
  return DOC_PREFIX + toBase64Url(await deflate(bytes));
}

/**
 * Back again.
 *
 * Also accepts plain JSON, so every machine saved before this existed still
 * opens: the prefix says which it is and there is no version to guess at.
 *
 * @param {string} text
 * @returns {Promise<object>}
 */
export async function unpackDoc(text) {
  const s = String(text ?? '');
  if (!isPacked(s)) return JSON.parse(s);

  const raw = s.startsWith(DOC_PREFIX_RAW);
  const bytes = fromBase64Url(s.slice(DOC_PREFIX.length));
  if (raw) return JSON.parse(new TextDecoder().decode(bytes));
  if (!hasCompression()) throw new Error('この環境では圧縮データを読めません');
  return JSON.parse(new TextDecoder().decode(await inflate(bytes)));
}

/**
 * How big this would be on the wire, without building it.
 *
 * Used by the transports to say something useful when a message is refused,
 * rather than dropping it the way the LAN relay used to.
 */
export function wireSize(text) {
  return typeof text === 'string' ? new TextEncoder().encode(text).length : 0;
}
