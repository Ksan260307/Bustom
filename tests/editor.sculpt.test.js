import { describe, it, expect } from 'vitest';
import { VoxelBlock } from '../src/core/VoxelBlock.js';
import {
  lineCells, region, fillRegion, smooth, flatten, drill, solidShare, resetToShape,
} from '../src/editor/Sculpt.js';
import { SHAPE } from '../src/core/Shapes.js';

// 16 is the coarsest real grid. Asking for 8 or 12 quietly gives you 32,
// which is a fine thing for the editor to do and a terrible thing to write
// a test against.
const solid = (n = 16, c = 1) => new VoxelBlock(n, c).fill(c);

describe('a fast drag leaves a stroke, not a row of holes', () => {
  it('walks every cell between one dab and the next', () => {
    // A dab happens where the pointer was when the frame ran. Move quickly
    // and the frames land far apart, so what got drawn was separate holes
    // with the block still solid between them — the faster you worked, the
    // worse it got.
    const cells = lineCells({ x: 0, y: 0, z: 0 }, { x: 6, y: 3, z: 0 });
    expect(cells[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(cells[cells.length - 1]).toEqual({ x: 6, y: 3, z: 0 });
    expect(cells.length, 'as long as the line, not the sum of its parts').toBe(7);
    // And it really is a chain: no two in a row more than one cell apart.
    for (let i = 1; i < cells.length; i++) {
      const step = Math.max(
        Math.abs(cells[i].x - cells[i - 1].x),
        Math.abs(cells[i].y - cells[i - 1].y),
        Math.abs(cells[i].z - cells[i - 1].z),
      );
      expect(step).toBe(1);
    }
  });

  it('is one cell when nothing moved', () => {
    expect(lineCells({ x: 3, y: 3, z: 3 }, { x: 3, y: 3, z: 3 })).toEqual([{ x: 3, y: 3, z: 3 }]);
  });
});

describe('filling in the patch you can see', () => {
  it('takes what is joined to it, not every cell of that shade', () => {
    const v = solid(16, 1);
    // Two patches of the same colour, with nothing between them.
    v.set(0, 0, 0, 3);
    v.set(15, 15, 15, 3);
    expect(region(v, 0, 0, 0).length, 'one cell, on its own').toBe(1);
  });

  it('is six-way joined: a corner touch is not a surface', () => {
    const v = new VoxelBlock(16, 1).clear();
    v.set(1, 1, 1, 2);
    v.set(2, 2, 2, 2);          // diagonal, touching only at a corner
    expect(region(v, 1, 1, 1).length).toBe(1);
  });

  it('repaints the patch in one go', () => {
    const v = solid(16, 1);
    const changed = fillRegion(v, 4, 4, 4, 5);
    expect(changed).toBe(16 ** 3);
    expect(v.get(0, 0, 0)).toBe(6);
  });

  it('will not fill a hole, because that would be a different tool', () => {
    const v = new VoxelBlock(16, 1).clear();
    expect(fillRegion(v, 3, 3, 3, 2)).toBe(0);
  });
});

describe('taking the corners off', () => {
  it('fills a notch and shaves a spike', () => {
    const v = solid(16, 1);
    v.set(6, 6, 6, 0);                       // a one-cell hole, buried
    smooth(v, 6, 6, 6, 3, 0);
    expect(v.get(6, 6, 6), 'surrounded by solid, so it fills in').toBeGreaterThan(0);

    const w = new VoxelBlock(16, 1).clear();
    w.set(6, 6, 6, 2);                       // one cell in mid-air
    smooth(w, 6, 6, 6, 3, 1);
    expect(w.get(6, 6, 6), 'surrounded by nothing, so it goes').toBe(0);
  });

  it('does not run away when it is used again and again', () => {
    // Reading and writing in the same pass would smooth against cells it had
    // already smoothed, and the shape would crawl in whichever direction the
    // scan happened to go.
    const v = solid(16, 1);
    for (let i = 0; i < 6; i++) smooth(v, 6, 6, 6, 3, 0);
    expect(v.solid, 'a solid block stays solid').toBe(16 ** 3);
  });
});

describe('the cuts a brush cannot make', () => {
  it('flattens back to the plane you clicked, on one side only', () => {
    const v = solid(16, 1);
    const before = v.solid;
    flatten(v, 8, 8, 12, 4, 2, 1);
    expect(v.solid).toBeLessThan(before);
    expect(v.get(8, 8, 14), 'proud of the plane, so gone').toBe(0);
    expect(v.get(8, 8, 10), 'behind it, so kept').toBeGreaterThan(0);
  });

  it('drills all the way through, so two holes do not have to be lined up', () => {
    const v = solid(16, 1);
    drill(v, 8, 8, 8, 2, 2);
    for (let z = 0; z < 16; z++) expect(v.get(8, 8, z), `z=${z}`).toBe(0);
    expect(v.get(0, 0, 8), 'and nothing else went with it').toBeGreaterThan(0);
  });
});

describe('getting out of a carve', () => {
  it('puts the block back to the shape it was cut from', () => {
    const v = new VoxelBlock(16, 1);
    v.fillShape(SHAPE.BOX, 0);
    const part = { vox: v, shape: SHAPE.BOX };
    drill(v, 8, 8, 8, 4, 2);
    expect(solidShare(v)).toBeLessThan(1);
    expect(resetToShape(part)).toBe(true);
    expect(solidShare(v), 'whole again').toBe(1);
  });

  it('says how much of the block is left', () => {
    const v = solid(16, 1);
    expect(solidShare(v)).toBe(1);
    drill(v, 4, 4, 4, 2, 0);
    expect(solidShare(v)).toBeLessThan(1);
    expect(solidShare(v)).toBeGreaterThan(0);
  });
});

describe('the brush is one shape, whichever tool is holding it', () => {
  it('paints round when the round brush is on', () => {
    // It used to be a cube always, whatever the tick said — so carving and
    // painting the same stroke left a round cut with a square patch of
    // colour in it, and the tick looked broken.
    const square = solid(16, 1);
    const round = solid(16, 1);
    square.paint(8, 8, 8, 4, 5, false);
    round.paint(8, 8, 8, 4, 5, true);
    const count = (v) => {
      let n = 0;
      for (let i = 0; i < v.total; i++) if (v.data[i] === 6) n++;
      return n;
    };
    expect(count(round), 'a ball fits inside the cube that holds it')
      .toBeLessThan(count(square));
    // The corner of the cube is painted; the corner of the ball is not.
    expect(square.get(4, 4, 4)).toBe(6);
    expect(round.get(4, 4, 4)).not.toBe(6);
    // And the middle is painted either way.
    expect(round.get(8, 8, 8)).toBe(6);
  });

  it('paints a cube when it is off, as it always did', () => {
    const v = solid(16, 1);
    v.paint(8, 8, 8, 2, 5);
    expect(v.get(6, 6, 6), 'the corner of the cube').toBe(6);
  });
});
