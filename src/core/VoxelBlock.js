import * as THREE from 'three';
import { DEFAULT_VOX, VOX_LEVELS, chunkSizeFor } from './constants.js';
import { shapeMask } from './Shapes.js';

// ============================================================
//  VoxelBlock : the carveable interior of one block.
//
//  The grid is n^3 bytes (0 = empty, k>0 = palette index k-1) where n is
//  the sculpt resolution — 1/16 up to 1/100 of the block edge. At 1/100
//  that is a million cells, so the grid is split into chunks and only the
//  chunks a brush actually touched are re-meshed.
//
//  Geometry is emitted in UNIT-CUBE space (0..1 on each axis). The block's
//  real world size lives on the mesh transform, which means resizing a part
//  never invalidates the mesh.
// ============================================================

const _c = new THREE.Color();

/**
 * The brush is an axis-aligned cube: every cell within `r` on each axis.
 *
 * Round brushes do not survive being sampled onto a grid. A sphere at radius
 * 1 collapses to the centre plus its six face neighbours — a 3D plus sign —
 * and a tetrahedron, while solid, leaves a lopsided wedge that is impossible
 * to aim. A cube gives exactly what the cursor promises: press once, get a
 * (2r+1)^3 block, in line with the grid you are building on.
 *
 * There is no slack term. The radius is whole cells, so the shape is exact
 * and repeatable — the same click always removes the same box.
 */
export function inBrush(dx, dy, dz, r) {
  return Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dz) <= r;
}

export class VoxelBlock {
  /**
   * @param {number} n           sculpt resolution (cells per edge)
   * @param {number} colorIndex  fill colour, or -1 for an empty block
   */
  constructor(n = DEFAULT_VOX, colorIndex = 1) {
    this.setResolution(n, false);
    if (colorIndex >= 0) this.fill(colorIndex);
  }

  // ---------------------------------------------------------- storage

  setResolution(n, resample = true) {
    const next = VOX_LEVELS.includes(n) ? n : DEFAULT_VOX;
    if (this.n === next) return this;

    const old = this.data ? { n: this.n, data: this.data } : null;

    this.n = next;
    this.total = next * next * next;
    this.chunk = chunkSizeFor(next);
    this.cdim = Math.ceil(next / this.chunk);
    this.chunkCount = this.cdim ** 3;
    this.data = new Uint8Array(this.total);
    this.solid = 0;
    this._chunks = new Array(this.chunkCount).fill(null);
    this._dirty = new Uint8Array(this.chunkCount).fill(1);
    this._geometry = null;
    this._paletteVersion = -1;
    this._pristineFor = null;

    if (old && resample) this._resampleFrom(old);
    return this;
  }

  /** Nearest-neighbour rescale, so switching resolution keeps the shape. */
  _resampleFrom({ n: on, data: od }) {
    const n = this.n;
    const s = on / n;
    for (let z = 0; z < n; z++) {
      const oz = Math.min(on - 1, (z * s) | 0);
      for (let y = 0; y < n; y++) {
        const oy = Math.min(on - 1, (y * s) | 0);
        for (let x = 0; x < n; x++) {
          const ox = Math.min(on - 1, (x * s) | 0);
          const v = od[ox + oy * on + oz * on * on];
          if (v) { this.data[x + y * n + z * n * n] = v; this.solid++; }
        }
      }
    }
  }

  /**
   * Re-grid the contents for a box that has grown around them, so the shape
   * stays exactly where it is in space while the block gets bigger.
   *
   * The grid stays n^3 — it always spans the block's own box — so the cells
   * get larger and the old contents occupy a sub-box of the new grid:
   * `keep` is how much of each new axis the old contents cover (0..1), and
   * `offset` is how much empty space comes before them.
   *
   * Each new cell samples the whole range of old cells it now covers and
   * takes any solid one. Nearest-neighbour would drop one-cell details on
   * the way down; "anything solid wins" can only thicken, never erase.
   */
  regrid(keep, offset) {
    const n = this.n;
    const src = this.data;
    const out = new Uint8Array(this.total);
    let solid = 0;

    // Per axis, the old-cell span each new cell covers.
    const span = (axis) => {
      const k = Math.max(1e-6, keep[axis]);
      const o = offset[axis] ?? 0;
      const lo = new Int32Array(n);
      const hi = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const a = ((i / n) - o) / k;
        const b = (((i + 1) / n) - o) / k;
        lo[i] = Math.max(0, Math.ceil(a * n - 1e-6));
        hi[i] = Math.min(n - 1, Math.floor(b * n - 1e-6));
        // A new cell entirely outside the old box samples nothing.
        if (b <= 0 || a >= 1) { lo[i] = 1; hi[i] = 0; }
      }
      return { lo, hi };
    };

    const sx = span(0);
    const sy = span(1);
    const sz = span(2);

    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let v = 0;
          for (let oz = sz.lo[z]; oz <= sz.hi[z] && !v; oz++) {
            for (let oy = sy.lo[y]; oy <= sy.hi[y] && !v; oy++) {
              const row = oy * n + oz * n * n;
              for (let ox = sx.lo[x]; ox <= sx.hi[x]; ox++) {
                const c = src[ox + row];
                if (c) { v = c; break; }
              }
            }
          }
          if (v) { out[x + y * n + z * n * n] = v; solid++; }
        }
      }
    }

    this.data = out;
    this.solid = solid;
    this.markAllDirty();
    return this;
  }

  index(x, y, z) { return x + y * this.n + z * this.n * this.n; }

  inBounds(x, y, z) {
    const n = this.n;
    return x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n;
  }

  get(x, y, z) {
    return this.inBounds(x, y, z) ? this.data[this.index(x, y, z)] : 0;
  }

  set(x, y, z, v) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    const prev = this.data[i];
    if (prev === v) return false;
    this.data[i] = v;
    if (prev && !v) this.solid--;
    else if (!prev && v) this.solid++;
    this._touch(x, y, z);
    return true;
  }

  /** Mark the chunk containing this cell — and its neighbours across faces. */
  _touch(x, y, z) {
    const cs = this.chunk;
    const d = this.cdim;
    const cx = (x / cs) | 0, cy = (y / cs) | 0, cz = (z / cs) | 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          // only face-adjacent chunks can gain or lose a face
          if (Math.abs(i) + Math.abs(j) + Math.abs(k) > 1) continue;
          const ax = cx + i, ay = cy + j, az = cz + k;
          if (ax < 0 || ay < 0 || az < 0 || ax >= d || ay >= d || az >= d) continue;
          this._dirty[ax + ay * d + az * d * d] = 1;
        }
      }
    }
    this._geometry = null;
    this._pristineFor = null;
  }

  markAllDirty() {
    this._dirty.fill(1);
    this._geometry = null;
    this._pristineFor = null;
  }

  // ---------------------------------------------------------- bulk ops

  fill(colorIndex) {
    this.data.fill(colorIndex + 1);
    this.solid = this.total;
    this.markAllDirty();
    return this;
  }

  clear() {
    this.data.fill(0);
    this.solid = 0;
    this.markAllDirty();
    return this;
  }

  /**
   * Recolour every solid cell without touching what is or is not solid.
   *
   * `fill` sets the whole grid solid, which is right for a fresh block and
   * destroys the shape of a carved one. This is what "make it that colour"
   * actually means.
   */
  repaintAll(colorIndex) {
    const v = colorIndex + 1;
    let changed = false;
    for (let i = 0; i < this.data.length; i++) {
      if (!this.data[i] || this.data[i] === v) continue;
      this.data[i] = v;
      changed = true;
    }
    if (changed) this.markAllDirty();
    return changed;
  }

  /**
   * A round brush: the same reach, cut as a ball rather than a cube.
   *
   * The ordinary brush is square — `inBrush` measures the longest side, not
   * the distance — so every cut anybody made had hard corners in it, and a
   * curved recess or a drilled hole was not available at all.
   */
  ball(x, y, z, r, value) {
    let changed = false;
    const rr = r * r;
    const lo = (v) => Math.max(0, Math.ceil(v - r));
    const hi = (v) => Math.min(this.n - 1, Math.floor(v + r));
    for (let pz = lo(z); pz <= hi(z); pz++) {
      for (let py = lo(y); py <= hi(y); py++) {
        for (let px = lo(x); px <= hi(x); px++) {
          const dx = px - x;
          const dy = py - y;
          const dz = pz - z;
          if (dx * dx + dy * dy + dz * dz > rr) continue;
          if (this.set(px, py, pz, value)) changed = true;
        }
      }
    }
    if (changed) this.markAllDirty();
    return changed;
  }

  /**
   * A square brush, stated explicitly rather than inherited from `inBrush`.
   *
   * `brush` happens to cut cubes today; this says so, so the round one has
   * something to be the opposite of.
   */
  box(x, y, z, r, value) {
    let changed = false;
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx;
          const py = y + dy;
          const pz = z + dz;
          if (!this.inBounds(px, py, pz)) continue;
          const i = this.index(px, py, pz);
          if (this.data[i] === value) continue;
          if (this.data[i]) this.solid--;
          if (value) this.solid++;
          this.data[i] = value;
          changed = true;
        }
      }
    }
    if (changed) this.markAllDirty();
    return changed;
  }

  /**
   * How much of the block's own box is solid, 0..1.
   *
   * Carving is invisible from the outside once the outside is closed again,
   * so "have I hollowed this out or not" was a question with no answer.
   *
   * Named for the ratio rather than the verb: `fill()` already means
   * "make every cell this colour", and a getter of the same name quietly
   * replaced it.
   */
  get fillRatio() { return this.solid / Math.max(1, this.total); }

  /**
   * Has this block been carved away from the shape it was cut to?
   *
   * Asked before anything is about to overwrite the grid.
   */
  isCarved(shape) {
    if (!shape) return this.solid !== this.total;
    const probe = new VoxelBlock(this.n, 0).fillShape(shape, 0);
    return probe.solid !== this.solid;
  }

  /**
   * Swap one colour for another throughout this block.
   *
   * @returns {boolean} whether anything actually changed
   */
  recolor(from, to) {
    const a = from + 1;
    const b = to + 1;
    let hit = false;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== a) continue;
      this.data[i] = b;
      hit = true;
    }
    if (hit) this.markAllDirty();
    return hit;
  }

  /**
   * The colour most of this block is made of, or -1 when it is empty.
   *
   * A whole-grid count rather than a sample of one cell: the cell at the
   * centre of a carved-out block is as likely to be a hole as to be the
   * colour anybody would say the block is.
   */
  dominantColor() {
    const seen = new Map();
    let best = 0;
    let bestN = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      if (!v) continue;
      const n = (seen.get(v) ?? 0) + 1;
      seen.set(v, n);
      if (n > bestN) { bestN = n; best = v; }
    }
    return best - 1;
  }

  /**
   * Cut the grid to a named shape. Coordinates handed to the mask run -1..1
   * on every axis, so the shape always fills the block's box however the box
   * has been stretched.
   *
   * Whatever was sculpted here is gone: a shape IS the contents, not a
   * modifier on top of them.
   */
  fillShape(shape, colorIndex = 0) {
    const mask = shapeMask(shape);
    const n = this.n;
    const v = colorIndex + 1;
    const step = 2 / n;
    let solid = 0;
    for (let z = 0; z < n; z++) {
      const cz = (z + 0.5) * step - 1;
      for (let y = 0; y < n; y++) {
        const cy = (y + 0.5) * step - 1;
        for (let x = 0; x < n; x++) {
          const cx = (x + 0.5) * step - 1;
          const on = mask(cx, cy, cz) ? 1 : 0;
          this.data[x + y * n + z * n * n] = on ? v : 0;
          solid += on;
        }
      }
    }
    // A shape too fine for the grid would leave an invisible block, which is
    // a worse answer than ignoring the request.
    if (solid === 0) return this.fill(colorIndex);
    this.solid = solid;
    this.markAllDirty();
    return this;
  }

  /**
   * Is this grid still exactly the shape it was cut to, untouched by hand?
   *
   * Colour is ignored: repainting a sphere leaves it a sphere. Only which
   * cells are solid decides.
   *
   * The answer is CACHED, because saving asks this about every block and a
   * save happens on every edit (that is what the undo stack is made of). The
   * cache is thrown away wherever the grid is marked dirty — which is every
   * path that writes a cell, since that is also how the mesh knows to
   * rebuild. Tying it to the existing dirty flags rather than to a flag of
   * its own is what makes it impossible to answer "untouched" about a grid
   * somebody has touched.
   */
  isPristine(shape) {
    if (this._pristineFor === shape) return this._pristineValue;
    const answer = this._scanPristine(shape);
    this._pristineFor = shape;
    this._pristineValue = answer;
    return answer;
  }

  _scanPristine(shape) {
    const mask = shapeMask(shape);
    const n = this.n;
    const step = 2 / n;
    for (let z = 0; z < n; z++) {
      const cz = (z + 0.5) * step - 1;
      for (let y = 0; y < n; y++) {
        const cy = (y + 0.5) * step - 1;
        for (let x = 0; x < n; x++) {
          const cx = (x + 0.5) * step - 1;
          const want = mask(cx, cy, cz);
          if (want !== !!this.data[x + y * n + z * n * n]) return false;
        }
      }
    }
    return true;
  }

  /** The palette index most of this block is made of. */
  mainColor() {
    const tally = new Map();
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    let best = 1, bestN = 0;
    for (const [v, count] of tally) if (count > bestN) { best = v; bestN = count; }
    return best - 1;
  }

  /**
   * Spherical brush. `radius` is in cells, so it means the same fraction of
   * the block at every resolution once the UI scales it.
   */
  brush(cx, cy, cz, radius, value) {
    let changed = false;
    const r = Math.max(0, radius);
    const lo = (v) => Math.max(0, Math.ceil(v - r));
    const hi = (v) => Math.min(this.n - 1, Math.floor(v + r));
    for (let z = lo(cz); z <= hi(cz); z++) {
      for (let y = lo(cy); y <= hi(cy); y++) {
        for (let x = lo(cx); x <= hi(cx); x++) {
          if (!inBrush(x - cx, y - cy, z - cz, r)) continue;
          if (this.set(x, y, z, value)) changed = true;
        }
      }
    }
    return changed;
  }

  /** Recolour solid cells under the brush without changing occupancy. */
  paint(cx, cy, cz, radius, colorIndex) {
    let changed = false;
    const v = colorIndex + 1;
    const r = Math.max(0, radius);
    const lo = (a) => Math.max(0, Math.ceil(a - r));
    const hi = (a) => Math.min(this.n - 1, Math.floor(a + r));
    for (let z = lo(cz); z <= hi(cz); z++) {
      for (let y = lo(cy); y <= hi(cy); y++) {
        for (let x = lo(cx); x <= hi(cx); x++) {
          if (!inBrush(x - cx, y - cy, z - cz, r)) continue;
          const i = this.index(x, y, z);
          if (this.data[i] && this.data[i] !== v) {
            this.data[i] = v;
            this._touch(x, y, z);
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  /** Recolour every solid cell. */
  repaint(colorIndex) {
    const v = colorIndex + 1;
    let changed = false;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] && this.data[i] !== v) { this.data[i] = v; changed = true; }
    }
    if (changed) this.markAllDirty();
    return changed;
  }

  /** Chamfer the 8 corners. `frac` is the cut depth as a fraction of the edge. */
  bevel(frac = 0.22) {
    const n = this.n;
    const amount = Math.max(1, Math.round(n * frac));
    for (let z = 0; z < n; z++) {
      const dz = Math.min(z, n - 1 - z);
      for (let y = 0; y < n; y++) {
        const dy = Math.min(y, n - 1 - y);
        for (let x = 0; x < n; x++) {
          const dx = Math.min(x, n - 1 - x);
          if (dx + dy + dz < amount) {
            const i = this.index(x, y, z);
            if (this.data[i]) { this.data[i] = 0; this.solid--; }
          }
        }
      }
    }
    this.markAllDirty();
    return this;
  }

  /** Palette indices currently in use. */
  usedColors() {
    const seen = new Set();
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i]) seen.add(this.data[i] - 1);
    }
    return seen;
  }

  /** Remap palette indices after a prune. */
  remapColors(remap) {
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i];
      if (!v) continue;
      const next = remap.get(v - 1);
      if (next !== undefined) this.data[i] = next + 1;
    }
    this.markAllDirty();
  }

  // ---------------------------------------------------------- meshing

  /**
   * Merged geometry for the whole block, in unit-cube space.
   * Only chunks touched since the last call are re-meshed.
   */
  geometry(palette) {
    if (this._geometry && this._paletteVersion === palette.version) return this._geometry;

    for (let i = 0; i < this.chunkCount; i++) {
      if (!this._dirty[i] && this._chunks[i] && this._paletteVersion === palette.version) continue;
      this._chunks[i] = this._meshChunk(i, palette);
      this._dirty[i] = 0;
    }
    this._paletteVersion = palette.version;

    let verts = 0;
    for (const c of this._chunks) if (c) verts += c.count;

    const positions = new Float32Array(verts * 3);
    const normals = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    let o = 0;
    for (const c of this._chunks) {
      if (!c || !c.count) continue;
      positions.set(c.positions, o * 3);
      normals.set(c.normals, o * 3);
      colors.set(c.colors, o * 3);
      o += c.count;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this._geometry = geo;
    return geo;
  }

  /**
   * Greedy-mesh one chunk, sampling neighbours across the chunk boundary so
   * interior chunks correctly produce nothing at all.
   *
   * Face ownership rule: the chunk holding the SOLID cell emits the face.
   * That is what keeps adjacent chunks from emitting it twice.
   */
  _meshChunk(ci, palette) {
    const n = this.n;
    const cs = this.chunk;
    const cd = this.cdim;
    const cpos = [ci % cd, ((ci / cd) | 0) % cd, (ci / (cd * cd)) | 0];
    const lo = [cpos[0] * cs, cpos[1] * cs, cpos[2] * cs];
    const hi = [
      Math.min(n, lo[0] + cs), Math.min(n, lo[1] + cs), Math.min(n, lo[2] + cs),
    ];

    const positions = [];
    const normals = [];
    const colors = [];
    const inv = 1 / n;
    const data = this.data;
    const at = (x, y, z) => (
      x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n ? 0 : data[x + y * n + z * n * n]
    );

    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3;
      const v = (d + 2) % 3;
      const du = hi[u] - lo[u];
      const dv = hi[v] - lo[v];
      if (du <= 0 || dv <= 0) continue;

      const mask = new Int16Array(du * dv);
      const x = [0, 0, 0];
      const q = [0, 0, 0];
      q[d] = 1;

      for (let k = lo[d] - 1; k < hi[d]; k++) {
        const aOwned = k >= lo[d] && k < hi[d];
        const bOwned = k + 1 >= lo[d] && k + 1 < hi[d];

        let m = 0;
        for (let j = lo[v]; j < hi[v]; j++) {
          for (let i = lo[u]; i < hi[u]; i++, m++) {
            x[d] = k; x[u] = i; x[v] = j;
            const a = k >= 0 ? at(x[0], x[1], x[2]) : 0;
            const b = at(x[0] + q[0], x[1] + q[1], x[2] + q[2]);
            if (!!a === !!b) mask[m] = 0;
            else if (a) mask[m] = aOwned ? a : 0;      // face points +d
            else mask[m] = bOwned ? -b : 0;            // face points -d
          }
        }

        // greedy merge over the chunk's (u,v) slab
        m = 0;
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du;) {
            const c = mask[m];
            if (c === 0) { i++; m++; continue; }

            let w = 1;
            while (i + w < du && mask[m + w] === c) w++;

            let h = 1;
            outer: for (; j + h < dv; h++) {
              for (let t = 0; t < w; t++) {
                if (mask[m + t + h * du] !== c) break outer;
              }
            }

            const base = [0, 0, 0];
            base[d] = k + 1;
            base[u] = lo[u] + i;
            base[v] = lo[v] + j;
            const su = [0, 0, 0]; su[u] = w;
            const sv = [0, 0, 0]; sv[v] = h;
            emit(base, su, sv, d, c > 0, Math.abs(c) - 1);

            for (let l = 0; l < h; l++) {
              for (let t = 0; t < w; t++) mask[m + t + l * du] = 0;
            }
            i += w; m += w;
          }
        }
      }
    }

    function emit(base, su, sv, axis, positive, colorIndex) {
      const p0 = [base[0] * inv, base[1] * inv, base[2] * inv];
      const p1 = [(base[0] + su[0]) * inv, (base[1] + su[1]) * inv, (base[2] + su[2]) * inv];
      const p2 = [
        (base[0] + su[0] + sv[0]) * inv,
        (base[1] + su[1] + sv[1]) * inv,
        (base[2] + su[2] + sv[2]) * inv,
      ];
      const p3 = [(base[0] + sv[0]) * inv, (base[1] + sv[1]) * inv, (base[2] + sv[2]) * inv];

      const nrm = [0, 0, 0];
      nrm[axis] = positive ? 1 : -1;

      // setHex already lands in the renderer's working space (three r152+).
      _c.setHex(palette.get(colorIndex));

      const tri = positive ? [p0, p1, p2, p0, p2, p3] : [p0, p2, p1, p0, p3, p2];
      for (const p of tri) {
        positions.push(p[0], p[1], p[2]);
        normals.push(nrm[0], nrm[1], nrm[2]);
        colors.push(_c.r, _c.g, _c.b);
      }
    }

    return {
      count: positions.length / 3,
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
    };
  }

  disposeGeometry() {
    if (this._geometry) { this._geometry.dispose(); this._geometry = null; }
  }

  // ---------------------------------------------------------- serialisation

  /** Run-length encoded; a solid block costs a handful of numbers. */
  encode() {
    const out = [];
    const d = this.data;
    let run = 1;
    for (let i = 1; i <= d.length; i++) {
      if (i < d.length && d[i] === d[i - 1] && run < 65535) { run++; continue; }
      out.push(d[i - 1], run);
      run = 1;
    }
    return out;
  }

  static decode(n, rle) {
    const b = new VoxelBlock(n, -1);
    let p = 0;
    let solid = 0;
    for (let i = 0; i < rle.length; i += 2) {
      const val = rle[i];
      const run = rle[i + 1];
      for (let k = 0; k < run && p < b.data.length; k++) {
        b.data[p++] = val;
        if (val) solid++;
      }
    }
    b.solid = solid;
    b.markAllDirty();
    return b;
  }

  clone() {
    const b = new VoxelBlock(this.n, -1);
    b.data.set(this.data);
    b.solid = this.solid;
    b.markAllDirty();
    return b;
  }
}
