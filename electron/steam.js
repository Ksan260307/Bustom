import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
//  Steam, optionally.
//
//  Everything here is written so the game runs identically with no Steam at
//  all: no client installed, no App ID, no native module built. That is not
//  politeness — it is the only way the game stays runnable during
//  development, in tests, and for anyone who did not buy it on Steam.
//
//  So: initialising Steam is a THING WE TRY, and every call past it is a
//  no-op when it did not work. The one thing this must never do is stop the
//  game from starting.
//
//  What Steam gives us for doing this at all:
//    - the in-game overlay (Shift+Tab), which needs the API to be live
//    - playtime, which Steam only counts for a process it launched and
//      recognises
//    - achievements and stats, once there are any
// ============================================================

const require = createRequire(import.meta.url);

/**
 * Steam identifies the game by a number it issues when the store page is
 * made. Until there is one, 480 (Spacewar, Valve's public test app) lets the
 * whole path be exercised end to end with a real client.
 */
const PLACEHOLDER_APP_ID = 480;

function readAppId() {
  const fromEnv = Number(process.env.BLOSTOM_STEAM_APP_ID);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  // Steam itself looks for this file next to the executable when the game is
  // started outside the client, so it is the natural place to keep the id.
  for (const dir of [process.cwd(), path.dirname(process.execPath)]) {
    try {
      const raw = fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8');
      const id = Number(raw.trim());
      if (Number.isFinite(id) && id > 0) return id;
    } catch (e) { /* not there: fine, try the next one */ }
  }
  return PLACEHOLDER_APP_ID;
}

/** A Steam that is not there, with the same shape as one that is. */
function noSteam(reason) {
  return {
    available: false,
    reason,
    appId: 0,
    playerName: '',
    /** The live binding, for anything that needs more than these verbs. */
    client: null,
    unlock() { return false; },
    shutdown() { },
  };
}

/**
 * Connect to a running Steam client, or hand back a stub that does nothing.
 *
 * The native module is loaded by name at run time rather than imported, so
 * that not having it installed is an ordinary outcome instead of a build
 * error. `steamworks.js` is the binding this expects; see the README for
 * what installing it involves.
 */
export function openSteam() {
  let steamworks;
  try {
    steamworks = require('steamworks.js');
  } catch (e) {
    return noSteam('the Steam binding is not installed');
  }

  const appId = readAppId();
  try {
    const client = steamworks.init(appId);
    const playerName = client.localplayer.getName();
    return {
      available: true,
      reason: '',
      appId,
      playerName,
      /*
       * The binding itself.
       *
       * Everything above went through this file's own verbs so that a
       * missing Steam was a no-op rather than a crash. Lobbies and P2P are
       * a large enough surface that wrapping every call the same way would
       * be a second copy of the Steamworks API — so the client is handed
       * over, and whoever takes it checks first (see steamNetSupport).
       */
      client,
      unlock(id) {
        try {
          const a = client.achievement;
          if (a.isActivated(id)) return true;
          return a.activate(id);
        } catch (e) {
          // A name that does not exist on the app is a mistake worth
          // seeing, but never worth interrupting a run for.
          console.warn('achievement could not be unlocked:', id, e.message);
          return false;
        }
      },
      shutdown() {
        try { steamworks.shutdown?.(); } catch (e) { /* already gone */ }
      },
    };
  } catch (e) {
    // The usual cause is simply that Steam is not running.
    return noSteam(e.message ?? 'Steam did not answer');
  }
}
