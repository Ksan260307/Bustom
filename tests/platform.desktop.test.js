import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  bridge, onDesktop, quitGame, toggleFullscreen, steamStatus, unlockAchievement,
} from '../src/platform/desktop.js';

// ============================================================
//  One build, two homes.
//
//  These tests are the contract between the game and whatever it is running
//  inside: in a browser every call has to be harmless, and on the desktop
//  every call has to reach the shell. Nothing in the game should ever have
//  to ask which one it is beyond `onDesktop()`.
// ============================================================

/** A stand-in for the shell's bridge, recording what the game asked for. */
function fakeShell(overrides = {}) {
  const calls = [];
  const shell = {
    platform: 'desktop',
    calls,
    quit: () => calls.push('quit'),
    toggleFullscreen: async () => { calls.push('fullscreen'); return true; },
    isFullscreen: async () => false,
    steam: {
      status: async () => ({ available: true, reason: '', appId: 480, playerName: 'TESTER' }),
      unlock: (id) => calls.push(`unlock:${id}`),
    },
    ...overrides,
  };
  globalThis.desktop = shell;
  return shell;
}

afterEach(() => { delete globalThis.desktop; });

describe('running in a browser', () => {
  beforeEach(() => { delete globalThis.desktop; });

  it('knows there is no shell', () => {
    expect(bridge()).toBe(null);
    expect(onDesktop()).toBe(false);
  });

  it('will not pretend it can quit', () => {
    // A tab has its own close button; the menu asks first and hides the
    // entry when the answer is no.
    expect(quitGame()).toBe(false);
  });

  it('says plainly that there is no Steam, rather than throwing', async () => {
    const s = await steamStatus();
    expect(s.available).toBe(false);
    expect(s.reason.length).toBeGreaterThan(0);
    expect(s.appId).toBe(0);
  });

  it('drops achievements on the floor instead of failing a run', () => {
    expect(unlockAchievement('FIRST_BLOOD')).toBe(false);
  });

  it('falls back to the browser fullscreen API', async () => {
    // Under Node there is no document at all, which is the same shape of
    // problem as a browser that refuses: say what happened, do not throw.
    await expect(toggleFullscreen()).resolves.toBe(false);
  });
});

describe('running on the desktop', () => {
  it('finds the shell', () => {
    fakeShell();
    expect(onDesktop()).toBe(true);
    expect(bridge()).toBeTruthy();
  });

  it('is read fresh, not captured when the module loaded', () => {
    // The preload script and this module race at start-up. A bridge latched
    // at import time would report "browser" for the whole session.
    delete globalThis.desktop;
    expect(onDesktop()).toBe(false);
    fakeShell();
    expect(onDesktop(), 'a shell that turned up later still counts').toBe(true);
  });

  it('passes the verbs through', async () => {
    const shell = fakeShell();
    expect(quitGame()).toBe(true);
    await toggleFullscreen();
    expect(unlockAchievement('WAVE_10')).toBe(true);
    expect(shell.calls).toEqual(['quit', 'fullscreen', 'unlock:WAVE_10']);
  });

  it('reports what Steam said', async () => {
    fakeShell();
    const s = await steamStatus();
    expect(s.available).toBe(true);
    expect(s.appId).toBe(480);
    expect(s.playerName).toBe('TESTER');
  });

  it('survives a shell that answers badly', async () => {
    fakeShell({
      steam: {
        status: async () => { throw new Error('the shell fell over'); },
        unlock: () => { throw new Error('no'); },
      },
    });
    const s = await steamStatus();
    expect(s.available, 'a broken shell reads as no Steam').toBe(false);
    expect(s.reason).toContain('fell over');
    expect(unlockAchievement('ANY'), 'and an achievement never takes the game down')
      .toBe(false);
  });

  it('handles a shell with no Steam half at all', async () => {
    fakeShell({ steam: undefined });
    expect(onDesktop()).toBe(true);
    expect((await steamStatus()).available).toBe(false);
    expect(unlockAchievement('ANY')).toBe(false);
  });

  it('ignores an empty achievement name', () => {
    const shell = fakeShell();
    expect(unlockAchievement('')).toBe(false);
    expect(unlockAchievement(null)).toBe(false);
    expect(shell.calls).toEqual([]);
  });
});
