// ============================================================
//  Where the game happens to be running.
//
//  One build, two homes: a browser tab, and the desktop shell that ships on
//  Steam. The game asks this module rather than sniffing user agents, and
//  everything here answers sensibly in both — so nothing in the game has to
//  carry an `if (electron)` of its own.
//
//  The bridge is read fresh on every call instead of captured at import.
//  That is not a style choice: preload scripts and module evaluation race in
//  ways that differ between the shell and a browser, and a module that
//  latched onto `undefined` at load time would report "browser" forever in
//  the one place it matters.
// ============================================================

/** The shell's bridge, or null when this is a browser. */
export function bridge() {
  return (typeof globalThis !== 'undefined' && globalThis.desktop) || null;
}

/** True when the game owns its window rather than sitting in a tab. */
export function onDesktop() { return bridge() !== null; }

/**
 * Close the game.
 *
 * A tab has a close button and an X in the corner; a shipped game is
 * expected to have a way out on its own front page. In a browser there is
 * nothing sensible to do, so this says so rather than pretending.
 */
export function quitGame() {
  const b = bridge();
  if (!b) return false;
  b.quit();
  return true;
}

/**
 * Fullscreen, by whichever route this platform has.
 *
 * The shell owns its window and can simply do it. A browser has to be asked
 * from inside a user gesture and may still refuse, which is why this
 * resolves to what actually happened rather than to nothing.
 */
export async function toggleFullscreen() {
  const b = bridge();
  if (b) return b.toggleFullscreen();

  if (typeof document === 'undefined') return false;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch (e) {
    // Refused (no gesture, or the browser simply says no). Nothing is
    // broken; the game is just still in a window.
    return false;
  }
}

/**
 * What Steam we are attached to, if any.
 *
 * Always resolves, and always with the same shape, so a caller can render
 * the answer without a special case for "not on Steam" or "not on desktop".
 */
export async function steamStatus() {
  const b = bridge();
  if (!b?.steam) {
    return { available: false, reason: 'not running on the desktop build', appId: 0, playerName: '' };
  }
  try {
    return await b.steam.status();
  } catch (e) {
    return { available: false, reason: e?.message ?? 'the shell did not answer', appId: 0, playerName: '' };
  }
}

/**
 * Mark an achievement as earned.
 *
 * Deliberately fire-and-forget, and safe everywhere: in a browser, on a
 * desktop build with no Steam client, and on Steam with a name that does
 * not exist yet. A run must never be interrupted by the scoreboard.
 */
export function unlockAchievement(id) {
  const b = bridge();
  if (!b?.steam || !id) return false;
  try {
    b.steam.unlock(id);
    return true;
  } catch (e) {
    return false;
  }
}
