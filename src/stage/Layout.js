import { ARENAS, CELL, GAUGE } from '../game/Arenas.js';

// ============================================================
//  What a stage layout IS, apart from how it is drawn.
//
//  The game's arenas are source code — `turn4([[16, 16, GAUGE.mid, 15]])`
//  and so on — and that is deliberate: a place that is written down is a
//  place that is the same every time, reviewable in a diff, and impossible
//  to lose. It is also awkward to author, which is what the editor beside
//  this file is for.
//
//  So this module is the bridge and nothing else: source in, a list of
//  pieces out, and source back again. It holds no state and draws nothing.
//
//  Nothing in the game imports it. The editor is a tool that happens to
//  read the game's data; the game must not learn to depend on its tools.
// ============================================================

/** What each rule failure is called, in the order they are worth fixing. */
export const FAULTS = ['offGrid', 'offGauge', 'outside', 'inSpawn', 'crack', 'lopsided'];

/** Which way a layout repeats itself. `none` is allowed while working. */
export const SYMMETRIES = ['turn4', 'mirror4', 'none'];

/** A piece is the same piece if it stands in the same square. */
const key = (x, z, y = 0) => `${x}|${y}|${z}`;

/** Onto the lattice. */
export const snap = (v) => Math.round(v / CELL) * CELL;

/** The nearest gauge to a width, for pulling a hand-written arena into line. */
export function nearestGauge(r) {
  let best = null;
  let gap = Infinity;
  for (const [name, w] of Object.entries(GAUGE)) {
    if (Math.abs(w - r) < gap) { gap = Math.abs(w - r); best = name; }
  }
  return best;
}

/**
 * Every piece of an arena, in one flat list the editor can push around.
 *
 * `kind` says which array it came out of, because the three are not
 * interchangeable: a pillar stands on the floor, a floater hangs in the
 * air, and a platform is something to land on rather than hide behind.
 */
export function readArena(id) {
  const arena = ARENAS[id];
  if (!arena) return null;
  const pieces = [];
  for (const [x, z, r, h] of arena.pillars ?? []) {
    pieces.push({ kind: 'pillar', x, y: 0, z, r, h });
  }
  for (const [x, y, z, r, h] of arena.floaters ?? []) {
    pieces.push({ kind: 'floater', x, y, z, r, h });
  }
  for (const [x, y, z, r] of arena.platforms ?? []) {
    pieces.push({ kind: 'platform', x, y, z, r, h: 0 });
  }
  return {
    id,
    label: arena.label,
    radius: arena.radius,
    ceiling: arena.ceiling,
    symmetry: arena.symmetry ?? 'none',
    accent: arena.accent,
    grid: arena.grid,
    ground: arena.ground,
    pieces,
  };
}

/**
 * The other three quarters of a piece.
 *
 * Returned rather than added, so the caller decides whether it is placing
 * them, removing them, or just drawing where they would go.
 */
export function mirrorsOf(piece, symmetry) {
  const out = [];
  if (symmetry === 'turn4') {
    let { x, z } = piece;
    for (let i = 0; i < 3; i++) {
      const t = x;
      x = -z;
      z = t;
      out.push({ ...piece, x, z });
    }
  } else if (symmetry === 'mirror4') {
    for (const [sx, sz] of [[-1, 1], [1, -1], [-1, -1]]) {
      out.push({ ...piece, x: piece.x * sx, z: piece.z * sz });
    }
  }
  /**
   * One partner per square, and never the original.
   *
   * A piece standing on an axis has fewer partners than one off it — the
   * mirror of (16, 0) across z is (16, -0), which is the same square. That
   * has to be filtered against the ones already found as well as against
   * the original, or an axis piece comes back with a duplicate and the
   * editor places two objects in one place.
   */
  const seen = new Set([key(piece.x, piece.z, piece.y)]);
  return out.filter((p) => {
    const k = key(p.x, p.z, p.y);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Where the four machines start: the diagonals, at two thirds out. */
export function spawnPoints(radius) {
  return [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + i * (Math.PI / 2);
    return { x: Math.cos(a) * radius * 0.66, z: Math.sin(a) * radius * 0.66 };
  });
}

/** How much room a spawn needs: the nudge it gets, plus a machine. */
export const spawnClear = (radius) => radius * 0.09 + 8;

/**
 * Check a layout against the five rules, and say which pieces break which.
 *
 * The same rules the arena tests enforce, run live while somebody is
 * dragging things about — which is the whole reason for having an editor
 * rather than a text file and a test run.
 */
export function faults(layout) {
  const { pieces, radius, symmetry } = layout;
  const widths = new Set(Object.values(GAUGE));
  const found = new Map();
  const add = (i, what) => {
    if (!found.has(i)) found.set(i, new Set());
    found.get(i).add(what);
  };

  const spawns = spawnPoints(radius);
  const clear = spawnClear(radius);
  const here = new Set(pieces.map((p) => key(p.x, p.z, p.y)));

  pieces.forEach((p, i) => {
    if (p.x % CELL !== 0 || p.z % CELL !== 0) add(i, 'offGrid');
    if (Math.hypot(p.x, p.z) + p.r > radius) add(i, 'outside');
    /**
     * A platform is not cover.
     *
     * It is something to land on, forty metres up, and the rules about
     * widths and lanes and standing clear of a spawn are all about things
     * you hide behind on the floor. Holding a landing pad to them reports
     * a fault on every arena that has one, which trains whoever is using
     * this to ignore the panel.
     */
    if (p.kind === 'platform') return;
    if (!widths.has(p.r)) add(i, 'offGauge');
    for (const s of spawns) {
      if (Math.hypot(p.x - s.x, p.z - s.z) - p.r <= clear) add(i, 'inSpawn');
    }
    // Turned or mirrored, the piece's partners have to be there too.
    if (symmetry !== 'none') {
      for (const m of mirrorsOf(p, symmetry)) {
        if (!here.has(key(m.x, m.z, m.y))) add(i, 'lopsided');
      }
    }
  });

  // Touching is a wall and allowed; a crack is neither passable nor solid.
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].kind === 'platform') continue;
    for (let j = i + 1; j < pieces.length; j++) {
      if (pieces[j].kind === 'platform') continue;
      const a = pieces[i];
      const b = pieces[j];
      const gap = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - a.r - b.r;
      if (gap > 0.01 && gap < 6) { add(i, 'crack'); add(j, 'crack'); }
    }
  }

  return found;
}

/** The name of a width, for writing it back out as source. */
function gaugeName(r) {
  for (const [name, w] of Object.entries(GAUGE)) if (w === r) return `GAUGE.${name}`;
  return String(r);
}

/**
 * Write the layout back out as the source the game actually reads.
 *
 * Deliberately NOT a save button. The arenas live in Arenas.js as code, and
 * a tool that wrote that file would be a tool that can lose it. This hands
 * back text to paste, which is reviewable in a diff like everything else.
 *
 * Only one quarter is printed when the layout is symmetrical, because that
 * is how it is written by hand: the helper makes the other three.
 */
export function toSource(layout) {
  const { pieces, symmetry } = layout;
  const lines = [];

  const quarter = (kind) => {
    const mine = pieces.filter((p) => p.kind === kind);
    if (symmetry === 'none') return mine;
    // One representative per family: the first of each set of partners.
    const claimed = new Set();
    const out = [];
    for (const p of mine) {
      const k = key(p.x, p.z, p.y);
      if (claimed.has(k)) continue;
      claimed.add(k);
      for (const m of mirrorsOf(p, symmetry)) claimed.add(key(m.x, m.z, m.y));
      out.push(p);
    }
    return out;
  };

  // Indented to match the file it is pasted into. Source that has to be
  // re-indented by hand is source somebody will paste wrong once.
  const indent = (body) => body.split(String.fromCharCode(10))
    .map((l) => '  ' + l).join(String.fromCharCode(10));
  const wrap = (kind, body) => {
    if (symmetry === 'none') return body;
    const turn = kind === 'pillar' ? symmetry : `${symmetry}y`;
    return `...${turn}([\n${indent(body)}\n    ])`;
  };

  const pillars = quarter('pillar');
  if (pillars.length) {
    const body = pillars
      .map((p) => `      [${p.x}, ${p.z}, ${gaugeName(p.r)}, ${p.h}],`).join('\n');
    lines.push(`    pillars: [\n${symmetry === 'none' ? body : `      ${wrap('pillar', body)},`}\n    ],`);
  }

  for (const kind of ['floater', 'platform']) {
    const set = quarter(kind);
    if (!set.length) continue;
    const body = set.map((p) => (kind === 'floater'
      ? `      [${p.x}, ${p.y}, ${p.z}, ${gaugeName(p.r)}, ${p.h}],`
      : `      [${p.x}, ${p.y}, ${p.z}, ${p.r}],`)).join('\n');
    const name = kind === 'floater' ? 'floaters' : 'platforms';
    lines.push(`    ${name}: [\n${symmetry === 'none' ? body : `      ${wrap(kind, body)},`}\n    ],`);
  }

  return [`    symmetry: '${symmetry}',`, ...lines].join('\n');
}
