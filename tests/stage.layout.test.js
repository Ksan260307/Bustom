import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ARENAS, ARENA_ORDER, CELL, GAUGE } from '../src/game/Arenas.js';
import {
  readArena, mirrorsOf, spawnPoints, faults, toSource, snap,
} from '../src/stage/Layout.js';

// ============================================================
//  The stage editor's model.
//
//  The editor itself is a canvas and a panel, which a test cannot say much
//  about. What it can say everything about is the thing underneath: source
//  in, pieces out, source back again, and the five rules the arenas are
//  held to, checked the same way the arena tests check them.
// ============================================================

describe('reading an arena into pieces', () => {
  it('finds everything that is in it, and says what each thing is', () => {
    for (const id of ARENA_ORDER) {
      const layout = readArena(id);
      const arena = ARENAS[id];
      const counts = { pillar: 0, floater: 0, platform: 0 };
      for (const p of layout.pieces) counts[p.kind]++;
      expect(counts.pillar, id).toBe((arena.pillars ?? []).length);
      expect(counts.floater, id).toBe((arena.floaters ?? []).length);
      expect(counts.platform, id).toBe((arena.platforms ?? []).length);
      expect(layout.radius).toBe(arena.radius);
    }
  });

  it('does not know about arenas that do not exist', () => {
    expect(readArena('atlantis')).toBe(null);
  });
});

describe('the partners a piece has', () => {
  it('turns three more out of one, and never a fourth on top of it', () => {
    const p = { kind: 'pillar', x: 16, y: 0, z: 32, r: GAUGE.mid, h: 12 };
    const turned = mirrorsOf(p, 'turn4');
    expect(turned).toHaveLength(3);
    // A quarter turn each: (x,z) -> (-z,x).
    expect(turned[0]).toMatchObject({ x: -32, z: 16 });
    expect(turned[1]).toMatchObject({ x: -16, z: -32 });
    expect(turned[2]).toMatchObject({ x: 32, z: -16 });

    // A piece on the centre is one piece, not four.
    expect(mirrorsOf({ ...p, x: 0, z: 0 }, 'turn4')).toHaveLength(0);
    // And one on an axis has fewer partners when mirrored than turned.
    expect(mirrorsOf({ ...p, z: 0 }, 'mirror4')).toHaveLength(1);
    expect(mirrorsOf(p, 'none')).toHaveLength(0);
  });
});

describe('the rules, as the editor sees them', () => {
  const bare = (over) => ({
    radius: 120, symmetry: 'none', pieces: [], ...over,
  });

  it('says nothing about a layout that is fine', () => {
    const layout = bare({ pieces: [{ kind: 'pillar', x: 0, y: 0, z: 0, r: GAUGE.mid, h: 10 }] });
    expect(faults(layout).size).toBe(0);
  });

  it('catches a piece off the lattice', () => {
    const layout = bare({ pieces: [{ kind: 'pillar', x: 21, y: 0, z: 0, r: GAUGE.mid, h: 10 }] });
    expect([...faults(layout).get(0)]).toContain('offGrid');
  });

  it('catches a width that is not a gauge', () => {
    const layout = bare({ pieces: [{ kind: 'pillar', x: 0, y: 0, z: 0, r: 4.1, h: 10 }] });
    expect([...faults(layout).get(0)]).toContain('offGauge');
  });

  it('catches a piece standing where somebody wakes up', () => {
    const [spawn] = spawnPoints(120);
    const layout = bare({
      pieces: [{ kind: 'pillar', x: snap(spawn.x), y: 0, z: snap(spawn.z), r: GAUGE.mid, h: 10 }],
    });
    expect([...faults(layout).get(0)]).toContain('inSpawn');
  });

  it('catches the crack between two pieces, but not a wall', () => {
    // Two metres apart edge to edge: too narrow to walk down, wide enough
    // to get stuck in. This is the one gap that is never allowed.
    const crack = bare({
      pieces: [
        { kind: 'pillar', x: 0, y: 0, z: 0, r: GAUGE.mass, h: 10 },
        // 16 apart, 8 and 3.6 wide: 4.4 metres of gap. Too narrow to walk
        // down and wide enough to get stuck in.
        { kind: 'pillar', x: 16, y: 0, z: 0, r: GAUGE.mid, h: 10 },
      ],
    });
    expect([...faults(crack).get(0)]).toContain('crack');

    // Shoulder to shoulder is a wall, and a wall is a thing somebody meant.
    const wall = bare({
      pieces: [
        { kind: 'pillar', x: 0, y: 0, z: 0, r: GAUGE.mass, h: 10 },
        { kind: 'pillar', x: 16, y: 0, z: 0, r: GAUGE.mass, h: 10 },
      ],
    });
    expect(faults(wall).size).toBe(0);
  });

  it('catches half a symmetrical family', () => {
    const layout = bare({
      symmetry: 'turn4',
      pieces: [{ kind: 'pillar', x: 16, y: 0, z: 32, r: GAUGE.mid, h: 10 }],
    });
    expect([...faults(layout).get(0)]).toContain('lopsided');
  });

  it('leaves landing pads out of it', () => {
    // A platform is forty metres up and is not cover. Holding it to the
    // rules about widths and lanes reports a fault on every arena that has
    // one, which teaches whoever is using the editor to ignore the panel.
    const [spawn] = spawnPoints(120);
    const layout = bare({
      pieces: [{ kind: 'platform', x: snap(spawn.x), y: 30, z: snap(spawn.z), r: 9, h: 0 }],
    });
    expect(faults(layout).size).toBe(0);
  });

  it('agrees with the arenas the game actually ships', () => {
    // The editor's rules and the arena tests' rules are the same rules. If
    // they drift apart, the editor starts reporting faults on shipped
    // arenas — or worse, stops reporting them on broken ones.
    for (const id of ARENA_ORDER) {
      const found = faults(readArena(id));
      const names = new Set();
      for (const set of found.values()) for (const f of set) names.add(f);
      expect([...names], `${id} is not clean by the editor's rules`).toEqual([]);
    }
  });
});

describe('writing it back out as source', () => {
  it('prints one quarter of a symmetrical layout, as it is written by hand', () => {
    const layout = readArena('works');
    const src = toSource(layout);
    expect(src).toContain("symmetry: 'mirror4'");
    expect(src).toContain('...mirror4([');
    expect(src).toContain('GAUGE.slim');
    // Forty-eight pieces, twelve written down: the helper makes the rest.
    const rows = src.split('\n').filter((l) => /^\s*\[/.test(l));
    expect(layout.pieces.length).toBe(48);
    expect(rows.length).toBeLessThan(20);
  });

  it('keeps the numbers on the lattice and the widths named', () => {
    // The pillars block only: a floater row is [x, y, z, r, h] and a
    // platform row is [x, y, z, r], so reading the third field as a width
    // across all three reads a coordinate and calls it a fault.
    const src = toSource(readArena('proving'));
    const pillars = src.slice(src.indexOf('pillars: ['), src.indexOf('platforms: ['));
    for (const m of pillars.matchAll(/\[(-?\d+), (-?\d+), ([^,]+),/g)) {
      expect(Number(m[1]) % CELL).toBe(0);
      expect(Number(m[2]) % CELL).toBe(0);
      expect(m[3]).toMatch(/^GAUGE\./);
    }
  });

  it('writes every piece out when there is no symmetry to lean on', () => {
    const layout = { ...readArena('flats'), symmetry: 'none' };
    const rows = toSource(layout).split('\n').filter((l) => /^\s*\[/.test(l));
    expect(rows.length).toBe(layout.pieces.length);
  });
});

describe('the editor stays out of the game', () => {
  const read = (f) => fs.readFileSync(f, 'utf8');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  ));

  it('is never imported by anything the game runs', () => {
    // A tool may depend on the thing it edits. The thing being edited must
    // never learn to depend on its tools — the moment the game imports the
    // editor, the editor is in the game's build and in its start-up path.
    const game = walk('src').filter((f) => !f.includes(`stage${path.sep}`) && f.endsWith('.js'));
    for (const f of game) {
      expect(read(f), `${f} imports the stage editor`).not.toMatch(/from '.*stage\//);
    }
    expect(read('index.html')).not.toContain('stage');
  });

  it('is built on its own, into its own folder', () => {
    const cfg = read('vite.config.js');
    expect(cfg).toContain('dist-stage');
    expect(cfg).toContain("stage.html");
    // And the packaged game does not carry the editor's shell.
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.build.files).toContain('!electron/stage.js');
    expect(pkg.scripts.stage).toBeTruthy();
  });
});
