import { ARENAS, ARENA_ORDER, CELL, GAUGE } from '../game/Arenas.js';
import {
  readArena, mirrorsOf, spawnPoints, spawnClear, faults, toSource, snap, SYMMETRIES,
} from './Layout.js';

// ============================================================
//  BLOSTOM — the stage editor.
//
//  A separate program that happens to read the game's data. It is not
//  reachable from the game, the game does not import it, and it is not in
//  the game's build: a tool is allowed to depend on the thing it edits, and
//  the thing being edited must never learn to depend on its tools.
//
//  A plan view rather than a 3D one, on purpose. Laying out cover is a
//  question about distances and lines of fire — how far apart, what is in
//  the way, where the lanes are — and every one of those is easier to see
//  from directly above than from inside. The game is where you look at it
//  in 3D, and the game is one keypress away.
//
//  The five rules the arenas are held to are checked live, as you drag, and
//  drawn on the offending piece. Finding out from a test run that two
//  crates are four metres apart is finding out in the wrong place.
// ============================================================

/** How the plan is drawn. */
const VIEW = { pad: 40, spawn: '#ffd166', fault: '#ff5c5c', ghost: 'rgba(140,180,220,0.28)' };

/** What a click does. */
const TOOLS = ['place', 'move', 'erase'];

class StageEditor {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#plan');
    this.ctx = this.canvas.getContext('2d');

    this.layout = readArena(ARENA_ORDER[0]);
    this.tool = 'place';
    this.kind = 'pillar';
    this.gauge = 'mid';
    this.height = 16;
    this.airY = 40;
    /** Which piece the pointer is over, and which is being dragged. */
    this.hover = -1;
    this.dragging = -1;
    this.pointer = { x: 0, z: 0 };

    this._buildPanel();
    this._bindCanvas();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------- the panel

  _buildPanel() {
    const panel = this.root.querySelector('#panel');
    const el = (tag, attrs = {}, ...kids) => {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'class') n.className = v;
        else n.setAttribute(k, v);
      }
      for (const kid of kids) n.append(kid?.nodeType ? kid : document.createTextNode(String(kid)));
      return n;
    };
    this.el = el;

    const group = (title, ...kids) => el('div', { class: 'group' },
      el('h2', {}, title), el('div', { class: 'row' }, ...kids));

    // ---- which place
    this.arenaSelect = el('select', {
      // `_syncPanel` rather than `draw`: a different place can have a
      // different symmetry, and a highlighted button that disagrees with
      // what the editor is actually doing is worse than no button at all.
      onChange: (e) => { this.layout = readArena(e.target.value); this._syncPanel(); },
    }, ...ARENA_ORDER.map((id) => el('option', { value: id }, `${ARENAS[id].label} (${id})`)));

    // ---- how it repeats
    this.symButtons = SYMMETRIES.map((s) => el('button', {
      onClick: () => { this.layout.symmetry = s; this._syncPanel(); this.draw(); },
    }, s));

    // ---- what a click does
    this.toolButtons = TOOLS.map((t) => el('button', {
      onClick: () => { this.tool = t; this._syncPanel(); },
    }, t));

    // ---- what gets placed
    this.kindButtons = ['pillar', 'floater', 'platform'].map((k) => el('button', {
      onClick: () => { this.kind = k; this._syncPanel(); },
    }, k));
    this.gaugeButtons = Object.keys(GAUGE).map((g) => el('button', {
      onClick: () => { this.gauge = g; this._syncPanel(); },
    }, `${g} ${GAUGE[g]}`));

    this.heightInput = el('input', {
      type: 'range', min: '4', max: '52', step: '1', value: String(this.height),
      onInput: (e) => { this.height = Number(e.target.value); this._syncPanel(); },
    });
    this.airInput = el('input', {
      type: 'range', min: '8', max: '220', step: '4', value: String(this.airY),
      onInput: (e) => { this.airY = Number(e.target.value); this._syncPanel(); },
    });

    this.readout = el('pre', { class: 'source' });
    this.faultList = el('div', { class: 'faults' });

    panel.append(
      el('h1', {}, 'STAGE EDITOR', el('small', {}, 'BLOSTOM')),
      group('place', this.arenaSelect),
      group('symmetry', ...this.symButtons),
      group('tool', ...this.toolButtons),
      group('piece', ...this.kindButtons),
      group('width', ...this.gaugeButtons),
      el('div', { class: 'group' },
        el('h2', {}, 'height'), this.heightInput, el('span', { class: 'val', id: 'hval' }, '')),
      el('div', { class: 'group' },
        el('h2', {}, 'height off the floor'), this.airInput,
        el('span', { class: 'val', id: 'aval' }, '')),
      el('div', { class: 'group' }, el('h2', {}, 'rules'), this.faultList),
      el('div', { class: 'group' },
        el('h2', {}, 'source'),
        el('button', {
          onClick: () => navigator.clipboard?.writeText(this.readout.textContent),
        }, 'copy'),
        this.readout),
      el('p', { class: 'note' },
        'Paste the source into src/game/Arenas.js. Nothing here writes a file: '
        + 'the arenas are code, and a tool that rewrote that file would be a '
        + 'tool that can lose it.'),
    );
    this._syncPanel();
  }

  _syncPanel() {
    const mark = (buttons, values, now) => buttons.forEach((b, i) => {
      b.classList.toggle('on', values[i] === now);
    });
    mark(this.symButtons, SYMMETRIES, this.layout.symmetry);
    mark(this.toolButtons, TOOLS, this.tool);
    mark(this.kindButtons, ['pillar', 'floater', 'platform'], this.kind);
    mark(this.gaugeButtons, Object.keys(GAUGE), this.gauge);
    this.root.querySelector('#hval').textContent = `${this.height} m`;
    this.root.querySelector('#aval').textContent = `${this.airY} m`;
    this.draw();
  }

  // ---------------------------------------------------------- the plan

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(box.width * dpr);
    this.canvas.height = Math.floor(box.height * dpr);
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = box.width;
    this.h = box.height;
    this.draw();
  }

  /** Metres to pixels, and back. The arena always fills the view. */
  get scale() {
    return (Math.min(this.w, this.h) / 2 - VIEW.pad) / this.layout.radius;
  }

  toScreen(x, z) {
    return [this.w / 2 + x * this.scale, this.h / 2 + z * this.scale];
  }

  toWorld(px, py) {
    return { x: (px - this.w / 2) / this.scale, z: (py - this.h / 2) / this.scale };
  }

  _bindCanvas() {
    const at = (e) => {
      const box = this.canvas.getBoundingClientRect();
      return this.toWorld(e.clientX - box.left, e.clientY - box.top);
    };

    this.canvas.addEventListener('pointermove', (e) => {
      const w = at(e);
      this.pointer = { x: snap(w.x), z: snap(w.z) };
      if (this.dragging >= 0) {
        this._moveWithPartners(this.dragging, this.pointer.x, this.pointer.z);
      } else {
        this.hover = this._pick(w.x, w.z);
      }
      this.draw();
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      const w = at(e);
      const hit = this._pick(w.x, w.z);
      if (this.tool === 'erase') {
        if (hit >= 0) this._erase(hit);
      } else if (this.tool === 'move') {
        this.dragging = hit;
        this.canvas.setPointerCapture(e.pointerId);
      } else if (hit < 0) {
        this._place(snap(w.x), snap(w.z));
      }
      this.draw();
    });

    this.canvas.addEventListener('pointerup', (e) => {
      this.dragging = -1;
      this.canvas.releasePointerCapture?.(e.pointerId);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && this.hover >= 0) { this._erase(this.hover); this.draw(); }
      const n = TOOLS.indexOf(e.key);
      if (e.key === '1') { this.tool = 'place'; this._syncPanel(); }
      if (e.key === '2') { this.tool = 'move'; this._syncPanel(); }
      if (e.key === '3') { this.tool = 'erase'; this._syncPanel(); }
      if (n >= 0) { this.tool = TOOLS[n]; this._syncPanel(); }
    });
  }

  /** Which piece is under a point, or -1. */
  _pick(x, z) {
    let best = -1;
    let gap = Infinity;
    this.layout.pieces.forEach((p, i) => {
      const d = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
      if (d <= p.r + 1 && d < gap) { gap = d; best = i; }
    });
    return best;
  }

  /**
   * Put one down, and its partners with it.
   *
   * Placing a single piece in a symmetrical arena would break the symmetry
   * on the spot, so the editor never offers that: what you place is the
   * whole family, and what you erase is the whole family.
   */
  _place(x, z) {
    const piece = {
      kind: this.kind,
      x,
      z,
      y: this.kind === 'pillar' ? 0 : this.airY,
      r: GAUGE[this.gauge],
      h: this.kind === 'platform' ? 0 : this.height,
    };
    const family = [piece, ...mirrorsOf(piece, this.layout.symmetry)];
    for (const p of family) {
      if (this.layout.pieces.some((q) => q.x === p.x && q.z === p.z && q.y === p.y)) continue;
      this.layout.pieces.push(p);
    }
  }

  _familyOf(i) {
    const p = this.layout.pieces[i];
    const want = [p, ...mirrorsOf(p, this.layout.symmetry)];
    const out = [];
    for (const w of want) {
      const at = this.layout.pieces.findIndex(
        (q) => q.x === w.x && q.z === w.z && q.y === w.y && q.kind === w.kind,
      );
      if (at >= 0) out.push(at);
    }
    return out;
  }

  _erase(i) {
    const family = new Set(this._familyOf(i));
    this.layout.pieces = this.layout.pieces.filter((_, k) => !family.has(k));
    this.hover = -1;
  }

  _moveWithPartners(i, x, z) {
    const p = this.layout.pieces[i];
    if (!p || (p.x === x && p.z === z)) return;
    const family = this._familyOf(i);
    // Rebuild the family from the new position rather than nudging each
    // one: a turned partner does not move the same way the original does.
    const kept = new Set(family);
    const moved = { ...p, x, z };
    this.layout.pieces = this.layout.pieces.filter((_, k) => !kept.has(k));
    this.layout.pieces.push(moved, ...mirrorsOf(moved, this.layout.symmetry));
    this.dragging = this.layout.pieces.length - 1 - mirrorsOf(moved, this.layout.symmetry).length;
  }

  // ---------------------------------------------------------- drawing

  draw() {
    const ctx = this.ctx;
    const { radius } = this.layout;
    ctx.clearRect(0, 0, this.w, this.h);

    // ---- the lattice everything stands on
    ctx.strokeStyle = 'rgba(120, 160, 200, 0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = -radius; v <= radius; v += CELL) {
      const [x1, y1] = this.toScreen(v, -radius);
      const [x2, y2] = this.toScreen(v, radius);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      const [x3, y3] = this.toScreen(-radius, v);
      const [x4, y4] = this.toScreen(radius, v);
      ctx.moveTo(x3, y3); ctx.lineTo(x4, y4);
    }
    ctx.stroke();

    // ---- the axes, which is where the avenues usually go
    ctx.strokeStyle = 'rgba(140, 190, 230, 0.28)';
    ctx.beginPath();
    const [ax1, ay1] = this.toScreen(-radius, 0);
    const [ax2, ay2] = this.toScreen(radius, 0);
    const [az1, azy1] = this.toScreen(0, -radius);
    const [az2, azy2] = this.toScreen(0, radius);
    ctx.moveTo(ax1, ay1); ctx.lineTo(ax2, ay2);
    ctx.moveTo(az1, azy1); ctx.lineTo(az2, azy2);
    ctx.stroke();

    // ---- where the ground stops
    const [cx, cy] = this.toScreen(0, 0);
    ctx.strokeStyle = 'rgba(200, 150, 90, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * this.scale, 0, Math.PI * 2);
    ctx.stroke();

    // ---- and where nothing may stand
    const clear = spawnClear(radius);
    ctx.setLineDash([5, 5]);
    for (const s of spawnPoints(radius)) {
      const [sx, sy] = this.toScreen(s.x, s.z);
      ctx.strokeStyle = VIEW.spawn;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, clear * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = VIEW.spawn;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([]);

    // ---- the pieces
    const bad = faults(this.layout);
    this.layout.pieces.forEach((p, i) => {
      const [px, py] = this.toScreen(p.x, p.z);
      const w = p.r * 2 * this.scale;
      const wrong = bad.get(i);
      ctx.lineWidth = wrong ? 2 : 1;
      ctx.strokeStyle = wrong ? VIEW.fault : 'rgba(160, 200, 240, 0.85)';
      // Solid on the floor, hollow in the air, and a platform is a landing
      // pad rather than something to hide behind — three different things
      // that would be three identical squares without this.
      if (p.kind === 'pillar') {
        ctx.fillStyle = i === this.hover ? 'rgba(140,200,255,0.5)' : 'rgba(90, 130, 170, 0.42)';
        ctx.fillRect(px - w / 2, py - w / 2, w, w);
        ctx.strokeRect(px - w / 2, py - w / 2, w, w);
      } else if (p.kind === 'floater') {
        ctx.strokeRect(px - w / 2, py - w / 2, w, w);
        ctx.beginPath();
        ctx.moveTo(px - w / 2, py - w / 2); ctx.lineTo(px + w / 2, py + w / 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, w / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // ---- what the next click would put down, and where its partners land
    if (this.tool === 'place') {
      const ghost = {
        kind: this.kind, x: this.pointer.x, z: this.pointer.z,
        y: this.kind === 'pillar' ? 0 : this.airY, r: GAUGE[this.gauge], h: this.height,
      };
      ctx.fillStyle = VIEW.ghost;
      for (const g of [ghost, ...mirrorsOf(ghost, this.layout.symmetry)]) {
        const [gx, gy] = this.toScreen(g.x, g.z);
        const gw = g.r * 2 * this.scale;
        ctx.fillRect(gx - gw / 2, gy - gw / 2, gw, gw);
      }
    }

    this._report(bad);
  }

  _report(bad) {
    const counts = new Map();
    for (const set of bad.values()) {
      for (const f of set) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    this.faultList.textContent = counts.size
      ? [...counts].map(([f, n]) => `${f} ×${n}`).join('   ')
      : `clean — ${this.layout.pieces.length} pieces`;
    this.faultList.classList.toggle('bad', counts.size > 0);
    this.readout.textContent = toSource(this.layout);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.__stage = new StageEditor(document.body);
  });
}

export { StageEditor };
