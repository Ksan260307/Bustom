import { Assembly, isAssemblyFormat } from './Assembly.js';
import {
  toBase64Url, fromBase64Url, deflate, inflate, hasCompression,
} from './Codec.js';
import { t } from '../ui/i18n.js';

// ============================================================
//  Share codes : one build, one string.
//
//  A machine is a few kilobytes of JSON, which is far too much for a QR
//  code — so the payload is deflated and base64url'd, which takes a biped
//  from 4.9kB to about 1kB and leaves plenty of room inside a QR.
//
//  The prefix is the version marker: everything downstream can tell a
//  share code from a stray clipboard paste, and a future format change
//  gets a new one instead of a silent misread.
// ============================================================

export const SHARE_PREFIX = 'BLO1:';
/** Uncompressed fallback, for environments with no CompressionStream. */
export const SHARE_PREFIX_RAW = 'BLO0:';
/**
 * What the codes were stamped with before the game was renamed.
 *
 * Read, never written. A code somebody has already shared — printed, pasted
 * into a message, saved as a QR — has to keep working, and the format on
 * the other side of the prefix never changed.
 */
export const SHARE_PREFIX_WAS = 'BRO1:';
export const SHARE_PREFIX_RAW_WAS = 'BRO0:';

/** The most a QR code can carry in byte mode (version 40, ECC L). */
export const QR_BYTE_LIMIT = 2953;

// ---------------------------------------------------------- api

/** Does this look like one of our codes at all? */
export function isShareCode(text) {
  const code = String(text ?? '').trim();
  return code.startsWith(SHARE_PREFIX) || code.startsWith(SHARE_PREFIX_RAW)
    || code.startsWith(SHARE_PREFIX_WAS) || code.startsWith(SHARE_PREFIX_RAW_WAS);
}

/**
 * Pack a build into a single shareable string.
 * @param {Assembly} assembly
 * @returns {Promise<string>}
 */
export async function encodeShare(assembly) {
  const json = JSON.stringify(assembly.toJSON());
  const bytes = new TextEncoder().encode(json);
  if (!hasCompression()) return SHARE_PREFIX_RAW + toBase64Url(bytes);
  return SHARE_PREFIX + toBase64Url(await deflate(bytes));
}

/**
 * Unpack one. Throws with something a person can act on rather than a
 * decoder's own complaint about byte 37.
 * @returns {Promise<Assembly>}
 */
export async function decodeShare(text) {
  const code = String(text ?? '').trim();
  if (!isShareCode(code)) throw new Error(t('BLOSTOM の共有コードではありません'));

  // The prefix is four characters either way, and only ONE bit of it
  // matters: whether the payload behind it was compressed.
  const raw = code.startsWith(SHARE_PREFIX_RAW) || code.startsWith(SHARE_PREFIX_RAW_WAS);
  const body = code.slice(SHARE_PREFIX.length).replace(/\s+/g, '');

  let bytes;
  try {
    bytes = fromBase64Url(body);
  } catch {
    throw new Error(t('共有コードが壊れています'));
  }
  if (!raw) {
    if (!hasCompression()) throw new Error(t('この環境では圧縮コードを読めません'));
    try {
      bytes = await inflate(bytes);
    } catch {
      throw new Error(t('共有コードが壊れています'));
    }
  }

  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(t('共有コードが壊れています'));
  }
  if (!isAssemblyFormat(data?.format)) throw new Error(t('BLOSTOM のデータではありません'));

  return Assembly.fromJSON(data);
}

/**
 * What a code would cost, without building one. The UI needs this to say
 * "this build is too detailed for a QR" before it tries and fails.
 */
export async function measureShare(assembly) {
  const code = await encodeShare(assembly);
  return {
    code,
    bytes: code.length,
    fitsQR: code.length <= QR_BYTE_LIMIT,
    isPart: assembly.isPart,
    name: assembly.name,
  };
}
