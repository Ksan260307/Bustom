import { describe, it, expect, beforeEach } from 'vitest';
import { History } from '../src/editor/History.js';
import { PartLibrary } from '../src/editor/PartLibrary.js';
import { starterParts } from '../src/core/Assembly.js';
import { Assembly, PRESETS, _resetIds } from '../src/core/Assembly.js';

// ============================================================
//  Undo / redo
// ============================================================

describe('History', () => {
  let h;
  beforeEach(() => { h = new History(); });

  it('starts empty', () => {
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBeNull();
    expect(h.undo('now')).toBeNull();
    expect(h.redo('now')).toBeNull();
  });

  it('returns the state as it was before the change', () => {
    h.push('配置', 'A');
    expect(h.canUndo).toBe(true);
    expect(h.undoLabel).toBe('配置');

    const entry = h.undo('B');
    expect(entry.snapshot).toBe('A');
    expect(entry.label).toBe('配置');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
  });

  it('redo puts it back', () => {
    h.push('配置', 'A');
    h.undo('B');
    const entry = h.redo('A');
    expect(entry.snapshot).toBe('B');
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('walks back through several steps in order', () => {
    h.push('one', 'S0');
    h.push('two', 'S1');
    h.push('three', 'S2');
    expect(h.undo('S3').snapshot).toBe('S2');
    expect(h.undo('S2').snapshot).toBe('S1');
    expect(h.undo('S1').snapshot).toBe('S0');
    expect(h.canUndo).toBe(false);
  });

  it('a new change abandons the redo branch', () => {
    h.push('one', 'S0');
    h.push('two', 'S1');
    h.undo('S2');
    expect(h.canRedo).toBe(true);
    h.push('other', 'S1b');
    expect(h.canRedo).toBe(false);
  });

  it('drops the oldest entries past the limit', () => {
    const small = new History({ limit: 3 });
    for (let i = 0; i < 10; i++) small.push(`step${i}`, `S${i}`);
    expect(small.past).toHaveLength(3);
    expect(small.past[0].label).toBe('step7');
  });

  it('drops entries once the byte budget is blown', () => {
    const tiny = new History({ limit: 100, byteLimit: 40 });
    for (let i = 0; i < 10; i++) tiny.push(`s${i}`, 'x'.repeat(15));
    expect(tiny.past.length).toBeLessThan(5);
    expect(tiny.bytes).toBeLessThanOrEqual(40 + 15);
  });

  it('clear wipes both directions', () => {
    h.push('one', 'S0');
    h.undo('S1');
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.bytes).toBe(0);
  });

  it('round-trips a real assembly snapshot', () => {
    const asm = PRESETS.biped.build();
    const before = JSON.stringify(asm.toJSON());
    h.push('削除', before);

    const arm = [...asm.parts.values()].find((p) => p.boneType === 'arm');
    asm.remove(arm.id);
    const after = JSON.stringify(asm.toJSON());
    expect(after).not.toBe(before);

    const restored = Assembly.fromJSON(JSON.parse(h.undo(after).snapshot));
    expect(restored.size).toBe(JSON.parse(before).parts.length);
    expect(restored.get(arm.id)).toBeTruthy();
  });
});

// ============================================================
//  Part library
// ============================================================

/** A localStorage stand-in, so tests never touch the real one. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe('PartLibrary', () => {
  let store;
  let lib;
  beforeEach(() => {
    _resetIds(0);
    store = fakeStorage();
    lib = new PartLibrary(store);
  });

  const part = (name = 'ARM POD') => {
    const a = Assembly.createPart(name);
    a.addBlockOnFace(a.rootId, 2, 5, { size: [0.5, 0.5, 0.5] });
    return a;
  };

  it('starts empty', () => {
    expect(lib.size).toBe(0);
    expect(lib.list()).toEqual([]);
  });

  describe('starter parts', () => {
    it('puts whole limbs on an empty shelf', () => {
      const added = lib.seed(1, starterParts());
      expect(added).toBeGreaterThanOrEqual(3);
      // Each one has to be a real sub-assembly, not a lone block: a shelf of
      // single cubes would teach nobody anything about building a limb.
      for (const item of lib.list()) {
        expect(item.builtin).toBe(true);
        expect(item.json.parts.length).toBeGreaterThan(1);
      }
    });

    it('is offered once, so deleting one does not bring it back', () => {
      lib.seed(1, starterParts());
      const first = lib.list()[0];
      lib.remove(first.id);
      const again = new PartLibrary(store);
      expect(again.seed(1, starterParts())).toBe(0);
      expect(again.find(first.name)).toBeNull();
    });

    it('a later batch can still add to a shelf that was already seeded', () => {
      lib.seed(1, starterParts());
      const before = lib.size;
      expect(lib.seed(2, [{ name: 'NEW BIT', json: part().toJSON() }])).toBe(1);
      expect(lib.size).toBe(before + 1);
    });

    it('grafts back into a machine like anything else', () => {
      lib.seed(1, starterParts());
      const arm = lib.open(lib.list()[0].id);
      const machine = Assembly.createDefault();
      const before = machine.size;
      machine.graft(arm, machine.rootId, { pos: [0, 1, 0], rot: [0, 0, 0, 1] });
      expect(machine.size).toBeGreaterThan(before + 1);
    });
  });

  it('stores a part and gives it an id', () => {
    const entry = lib.put('ARM POD', part());
    expect(entry.id).toBeTruthy();
    expect(entry.name).toBe('ARM POD');
    expect(lib.size).toBe(1);
    expect(lib.list()[0].name).toBe('ARM POD');
  });

  it('saving under the same name overwrites rather than duplicating', () => {
    lib.put('POD', part());
    const bigger = part();
    bigger.addBlockOnFace(bigger.rootId, 0, 4);
    lib.put('POD', bigger);
    expect(lib.size).toBe(1);
    expect(lib.open(lib.list()[0].id).size).toBe(3);
  });

  it('trims and defaults the name', () => {
    expect(lib.put('   ', part()).name).toBe('PART');
    expect(lib.put('  SHIELD  ', part()).name).toBe('SHIELD');
  });

  it('open returns an independent document', () => {
    const entry = lib.put('POD', part());
    const a = lib.open(entry.id);
    const b = lib.open(entry.id);
    expect(a).not.toBe(b);
    a.core.vox.clear();
    expect(b.core.vox.solid).toBeGreaterThan(0);
    // and the stored copy is untouched
    expect(lib.open(entry.id).core.vox.solid).toBeGreaterThan(0);
  });

  it('open returns null for an unknown id', () => {
    expect(lib.open('nope')).toBeNull();
  });

  it('renames and deletes', () => {
    const entry = lib.put('POD', part());
    expect(lib.rename(entry.id, 'SHIELD')).toBe(true);
    expect(lib.list()[0].name).toBe('SHIELD');
    expect(lib.open(entry.id).name).toBe('SHIELD');
    expect(lib.rename(entry.id, '   ')).toBe(false);

    expect(lib.remove(entry.id)).toBe(true);
    expect(lib.size).toBe(0);
    expect(lib.remove(entry.id)).toBe(false);
  });

  it('persists through storage', () => {
    lib.put('POD', part());
    const reopened = new PartLibrary(store);
    expect(reopened.size).toBe(1);
    expect(reopened.list()[0].name).toBe('POD');
    expect(reopened.open(reopened.list()[0].id).size).toBe(2);
  });

  it('survives a corrupt store', () => {
    store.setItem('blostom.parts.v1', '{not json');
    expect(() => new PartLibrary(store)).not.toThrow();
    expect(new PartLibrary(store).size).toBe(0);
  });

  it('works with no storage at all', () => {
    const mem = new PartLibrary(null);
    mem.put('POD', part());
    expect(mem.size).toBe(1);
    expect(mem.save()).toBe(false);
  });

  it('reports a write failure instead of pretending', () => {
    const full = fakeStorage();
    full.setItem = () => { throw new Error('QuotaExceededError'); };
    const l = new PartLibrary(full);
    l.items.push({ id: 'x', name: 'X', json: {}, updatedAt: 0 });
    expect(l.save()).toBe(false);
  });
});
