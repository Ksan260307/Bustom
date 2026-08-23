import { describe, it, expect } from 'vitest';
import { VoxelBlock, inBrush } from '../src/core/VoxelBlock.js';
import { Palette } from '../src/core/Palette.js';
import { VOX_LEVELS } from '../src/core/constants.js';

const palette = new Palette();

/** Count distinct quads by counting triangles: the mesher emits 2 per quad. */
const quadCount = (geo) => geo.getAttribute('position').count / 6;

describe('VoxelBlock storage', () => {
  it('fills solid on construction and tracks the count', () => {
    const b = new VoxelBlock(16, 3);
    expect(b.n).toBe(16);
    expect(b.total).toBe(16 ** 3);
    expect(b.solid).toBe(b.total);
    expect(b.get(0, 0, 0)).toBe(4); // colour index + 1
  });

  it('can start empty', () => {
    const b = new VoxelBlock(16, -1);
    expect(b.solid).toBe(0);
  });

  it('keeps the solid count exact through sets', () => {
    const b = new VoxelBlock(16, -1);
    expect(b.set(1, 2, 3, 5)).toBe(true);
    expect(b.solid).toBe(1);
    expect(b.set(1, 2, 3, 5)).toBe(false);   // no change
    expect(b.solid).toBe(1);
    expect(b.set(1, 2, 3, 7)).toBe(true);    // recolour, still solid
    expect(b.solid).toBe(1);
    expect(b.set(1, 2, 3, 0)).toBe(true);    // erase
    expect(b.solid).toBe(0);
  });

  it('ignores out-of-bounds writes and reads them as empty', () => {
    const b = new VoxelBlock(16, 1);
    expect(b.set(-1, 0, 0, 2)).toBe(false);
    expect(b.set(16, 0, 0, 2)).toBe(false);
    expect(b.get(-1, 0, 0)).toBe(0);
    expect(b.get(0, 99, 0)).toBe(0);
  });

  it('fill and clear are total', () => {
    const b = new VoxelBlock(16, 1);
    b.clear();
    expect(b.solid).toBe(0);
    b.fill(6);
    expect(b.solid).toBe(b.total);
    expect(b.get(8, 8, 8)).toBe(7);
  });
});

describe('VoxelBlock sculpting', () => {
  it('carves a hole in the middle', () => {
    const b = new VoxelBlock(16, 1);
    const before = b.solid;
    expect(b.brush(8, 8, 8, 3, 0)).toBe(true);
    expect(b.solid).toBeLessThan(before);
    expect(b.get(8, 8, 8)).toBe(0);
    expect(b.get(0, 0, 0)).not.toBe(0);       // corners untouched
  });

  it('adds material with the same brush', () => {
    const b = new VoxelBlock(16, -1);
    expect(b.brush(8, 8, 8, 2, 5)).toBe(true);
    expect(b.solid).toBeGreaterThan(0);
    expect(b.get(8, 8, 8)).toBe(5);
  });

  it('paint recolours without changing occupancy', () => {
    const b = new VoxelBlock(16, 1);
    const before = b.solid;
    expect(b.paint(8, 8, 8, 3, 4)).toBe(true);
    expect(b.solid).toBe(before);
    expect(b.get(8, 8, 8)).toBe(5);
  });

  it('paint does nothing where there is nothing', () => {
    const b = new VoxelBlock(16, -1);
    expect(b.paint(8, 8, 8, 3, 4)).toBe(false);
  });

  it('repaint recolours everything solid', () => {
    const b = new VoxelBlock(16, 1);
    b.brush(8, 8, 8, 3, 0);
    const before = b.solid;
    expect(b.repaint(9)).toBe(true);
    expect(b.solid).toBe(before);
    expect(b.get(0, 0, 0)).toBe(10);
    expect(b.get(8, 8, 8)).toBe(0);
    expect(b.repaint(9)).toBe(false);   // already that colour
  });

  it('bevel removes the eight corners only', () => {
    const b = new VoxelBlock(16, 1);
    b.bevel(0.22);
    expect(b.get(0, 0, 0)).toBe(0);
    expect(b.get(15, 15, 15)).toBe(0);
    expect(b.get(8, 8, 8)).not.toBe(0);
    expect(b.solid).toBeLessThan(b.total);
  });

  it('brush is clipped at the grid edge without wrapping', () => {
    const b = new VoxelBlock(16, 1);
    b.brush(0, 0, 0, 4, 0);
    expect(b.get(0, 0, 0)).toBe(0);
    expect(b.get(15, 15, 15)).not.toBe(0);
  });
});

describe('the brush is a cube', () => {
  /** Every cell the brush would touch at this radius, centred on the origin. */
  const cells = (r) => {
    const out = [];
    const n = Math.ceil(r) + 1;
    for (let z = -n; z <= n; z++) {
      for (let y = -n; y <= n; y++) {
        for (let x = -n; x <= n; x++) if (inBrush(x, y, z, r)) out.push([x, y, z]);
      }
    }
    return out;
  };

  it('is exactly (2r+1) cells on a side', () => {
    expect(cells(0)).toEqual([[0, 0, 0]]);
    expect(cells(1)).toHaveLength(27);
    expect(cells(2)).toHaveLength(125);
    expect(cells(3)).toHaveLength(343);
  });

  it('keeps all eight corners and nothing beyond', () => {
    const at = cells(1).map((c) => c.join(','));
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) expect(at, `${x},${y},${z}`).toContain(`${x},${y},${z}`);
      }
    }
    expect(at, 'and it does not reach past the radius').not.toContain('2,0,0');
  });

  it('is square from every direction, not a wedge', () => {
    // The old tetrahedron gave a different silhouette per axis, which is what
    // made a single click look lopsided instead of like a block.
    for (const r of [1, 2, 3]) {
      const c = cells(r);
      for (const axis of [0, 1, 2]) {
        const span = new Set(c.map((v) => v[axis]));
        expect(span.size, `r=${r} axis=${axis}`).toBe(2 * r + 1);
      }
    }
  });

  it('carves a real cube out of a block', () => {
    const b = new VoxelBlock(16, 1);
    const before = b.solid;
    b.brush(8, 8, 8, 1, 0);
    expect(before - b.solid, 'twenty-seven cells and no more').toBe(27);
    for (const [dx, dy, dz] of [[1, 1, 1], [-1, -1, -1], [1, -1, 0]]) {
      expect(b.get(8 + dx, 8 + dy, 8 + dz), `${dx},${dy},${dz}`).toBe(0);
    }
    expect(b.get(6, 8, 8), 'the next cell out is untouched').not.toBe(0);
  });

  it('is what carving and painting both use', () => {
    const carved = new VoxelBlock(16, 1);
    carved.brush(8, 8, 8, 2, 0);
    const painted = new VoxelBlock(16, 1);
    painted.paint(8, 8, 8, 2, 4);

    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const hollow = carved.get(x, y, z) === 0;
          const recoloured = painted.get(x, y, z) === 5;
          expect(recoloured, `${x},${y},${z}`).toBe(hollow);
        }
      }
    }
  });
});

describe('VoxelBlock colours', () => {
  it('reports which palette indices are in use', () => {
    const b = new VoxelBlock(16, 1);
    b.brush(4, 4, 4, 2, 8);
    expect([...b.usedColors()].sort((x, y) => x - y)).toEqual([1, 7]);
  });

  it('remaps indices after a palette prune', () => {
    const b = new VoxelBlock(16, 5);
    b.remapColors(new Map([[5, 2]]));
    expect(b.get(0, 0, 0)).toBe(3);
    expect([...b.usedColors()]).toEqual([2]);
  });
});

describe('VoxelBlock resolution', () => {
  it('resamples the shape when the resolution changes', () => {
    const b = new VoxelBlock(16, 1);
    b.brush(8, 8, 8, 4, 0);              // hollow the middle
    const fracBefore = b.solid / b.total;

    b.setResolution(50, true);
    expect(b.n).toBe(50);
    expect(b.total).toBe(50 ** 3);
    // the carved fraction survives the rescale, roughly
    expect(b.solid / b.total).toBeCloseTo(fracBefore, 1);
    expect(b.get(25, 25, 25)).toBe(0);
    expect(b.get(0, 0, 0)).not.toBe(0);
  });

  it('is a no-op when set to the same resolution', () => {
    const b = new VoxelBlock(32, 1);
    const data = b.data;
    b.setResolution(32, true);
    expect(b.data).toBe(data);
  });

  it('rejects resolutions outside the offered list', () => {
    const b = new VoxelBlock(16, 1);
    b.setResolution(7, true);
    expect(VOX_LEVELS).toContain(b.n);
  });
});

describe('VoxelBlock meshing', () => {
  it('a solid block is exactly a cube', () => {
    const b = new VoxelBlock(16, 1);
    const geo = b.geometry(palette);
    // Chunked greedy meshing merges within a chunk, not across, so a solid
    // block yields one quad per chunk face rather than 6 overall.
    const chunksPerFace = (16 / b.chunk) ** 2;
    expect(quadCount(geo)).toBe(6 * chunksPerFace);

    geo.computeBoundingBox();
    expect(geo.boundingBox.min.toArray()).toEqual([0, 0, 0]);
    expect(geo.boundingBox.max.toArray()).toEqual([1, 1, 1]);
  });

  it('an empty block produces no geometry', () => {
    const b = new VoxelBlock(16, -1);
    expect(quadCount(b.geometry(palette))).toBe(0);
  });

  it('a single voxel produces exactly six quads', () => {
    const b = new VoxelBlock(16, -1);
    b.set(8, 8, 8, 1);
    expect(quadCount(b.geometry(palette))).toBe(6);
  });

  it('two voxels sharing a face hide it, and merge the sides', () => {
    const b = new VoxelBlock(16, -1);
    b.set(8, 8, 8, 1);
    b.set(9, 8, 8, 1);
    // 2 end caps + 4 side faces, each side merged across both cells
    expect(quadCount(b.geometry(palette))).toBe(6);
  });

  it('never double-emits a face across a chunk boundary', () => {
    const b = new VoxelBlock(16, -1);
    const cs = b.chunk;
    // straddle the boundary: last cell of one chunk, first of the next
    b.set(cs - 1, 4, 4, 1);
    b.set(cs, 4, 4, 1);
    // The shared face is still hidden exactly once; the four side faces can
    // no longer merge because they live in different chunks.
    expect(quadCount(b.geometry(palette))).toBe(10);
  });

  it('normals point outward on a single voxel', () => {
    const b = new VoxelBlock(16, -1);
    b.set(8, 8, 8, 1);
    const geo = b.geometry(palette);
    const nrm = geo.getAttribute('normal');
    const seen = new Set();
    for (let i = 0; i < nrm.count; i++) {
      seen.add(`${nrm.getX(i)},${nrm.getY(i)},${nrm.getZ(i)}`);
    }
    expect(seen.size).toBe(6);
  });

  it('bakes the palette colour into the vertices', () => {
    const b = new VoxelBlock(16, -1);
    b.set(8, 8, 8, 5); // palette index 4 = red
    const col = b.geometry(palette).getAttribute('color');
    expect(col.getX(0)).toBeGreaterThan(col.getY(0));
    expect(col.getX(0)).toBeGreaterThan(col.getZ(0));
  });

  it('caches the geometry until something is touched', () => {
    const b = new VoxelBlock(16, 1);
    const g1 = b.geometry(palette);
    expect(b.geometry(palette)).toBe(g1);
    b.set(8, 8, 8, 0);
    expect(b.geometry(palette)).not.toBe(g1);
  });

  it('re-meshes when the palette grows', () => {
    const p = new Palette();
    const b = new VoxelBlock(16, 1);
    const g1 = b.geometry(p);
    p.ensure(0x112233);
    expect(b.geometry(p)).not.toBe(g1);
  });

  it('meshes a full 1/100 block in reasonable time', () => {
    const b = new VoxelBlock(100, 1);
    const t0 = Date.now();
    const geo = b.geometry(palette);
    expect(quadCount(geo)).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('only re-meshes the touched chunks after a small edit', () => {
    const b = new VoxelBlock(50, 1);
    b.geometry(palette);
    b.set(2, 2, 2, 0);
    const dirty = [...b._dirty].filter(Boolean).length;
    expect(dirty).toBeGreaterThan(0);
    expect(dirty).toBeLessThan(b.chunkCount);
  });
});

describe('VoxelBlock serialisation', () => {
  it('round-trips through run-length encoding', () => {
    const b = new VoxelBlock(32, 1);
    b.brush(16, 16, 16, 5, 0);
    b.paint(4, 4, 4, 3, 6);
    const copy = VoxelBlock.decode(32, b.encode());
    expect(copy.n).toBe(b.n);
    expect(copy.solid).toBe(b.solid);
    expect(Array.from(copy.data)).toEqual(Array.from(b.data));
  });

  it('encodes a solid block compactly', () => {
    const b = new VoxelBlock(100, 1);
    // 1e6 cells of one value -> a handful of run pairs
    expect(b.encode().length).toBeLessThan(64);
  });

  it('clone is a deep copy', () => {
    const b = new VoxelBlock(16, 1);
    const c = b.clone();
    c.set(0, 0, 0, 0);
    expect(b.get(0, 0, 0)).not.toBe(0);
    expect(c.solid).toBe(b.solid - 1);
  });
});
