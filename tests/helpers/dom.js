/**
 * The smallest window/document that InputManager needs in order to bind.
 * Headless by design: we drive the manager by pushing synthetic events
 * through the captured listeners rather than by faking a whole DOM.
 */
export function installFakeDom() {
  const listeners = new Map();

  const target = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };

  const doc = {
    ...target,
    pointerLockElement: null,
    exitPointerLock() { doc.pointerLockElement = null; },
  };

  const prev = { window: globalThis.window, document: globalThis.document };
  globalThis.window = target;
  globalThis.document = doc;

  const el = {
    requestPointerLock() { doc.pointerLockElement = el; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: target.addEventListener,
    removeEventListener: target.removeEventListener,
  };

  return {
    el,
    document: doc,
    /** Fire an event at every listener registered for `type`. */
    fire(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    restore() {
      globalThis.window = prev.window;
      globalThis.document = prev.document;
      listeners.clear();
    },
  };
}

/** A minimal flat world, matching the interface EnvironmentInterference wants. */
export function testWorld(colliders = []) {
  return {
    gravity: 22,
    arenaRadius: 120,
    ceiling: 95,
    colliders,
    groundHeight: () => 0,
  };
}
