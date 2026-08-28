import { describe, it, expect } from 'vitest';
import { faceAnchor } from '../src/core/Assembly.js';
import { surfaceAlong, SHAPE } from '../src/core/Shapes.js';
import { VoxelBlock } from '../src/core/VoxelBlock.js';

/** A parent to place things against. */
const block = (size = [1, 1, 1], shape = SHAPE.BOX) => ({ kind: 'block', size, shape });

// Faces are axis * 2 + (positive ? 0 : 1): +X 0, -X 1, +Y 2, -Y 3, +Z 4, -Z 5.
const TOP = 2;
const FRONT = 4;

describe('where a part lands on a face', () => {
  it('still stacks on the middle when nothing says otherwise', () => {
    // Every preset in the game is built by this call, so the answer it gave
    // before has to be the answer it gives now.
    expect(faceAnchor(block(), TOP, [1, 1, 1])).toEqual([0, 1, 0]);
    expect(faceAnchor(block([2, 1, 2]), FRONT, [1, 1, 1])).toEqual([0, 0, 1.5]);
  });

  it('lands where the click did, not in the middle of the face', () => {
    // Placing three across a chest plate used to mean placing one and then
    // dragging the other two off the pile.
    const at = faceAnchor(block([3, 1, 3]), TOP, [1, 1, 1], [1, 0, -0.5]);
    expect(at[0], 'across').toBeCloseTo(1, 5);
    expect(at[2], 'and along').toBeCloseTo(-0.5, 5);
    expect(at[1], 'still flush on top').toBeCloseTo(1, 5);
  });

  it('keeps the whole footprint on the face it is standing on', () => {
    // Half a metre of a one-metre block hanging off a one-metre face is a
    // part balanced on its own corner.
    const at = faceAnchor(block([1, 1, 1]), TOP, [1, 1, 1], [9, 0, -9]);
    expect(at[0]).toBeCloseTo(0, 6);
    expect(at[2]).toBeCloseTo(0, 6);
  });

  it('and a wider parent gives it room to move', () => {
    const at = faceAnchor(block([4, 1, 4]), TOP, [1, 1, 1], [9, 0, 0]);
    expect(at[0], 'out to the edge and no further').toBeCloseTo(1.5, 5);
  });
});

describe('a face that is not flat', () => {
  it('a box reads the same everywhere', () => {
    expect(surfaceAlong(SHAPE.BOX, 1, 1, 0, 0)).toBe(1);
    expect(surfaceAlong(SHAPE.BOX, 1, 1, 0.9, 0.9)).toBe(1);
  });

  it('a sphere falls away from its pole', () => {
    expect(surfaceAlong(SHAPE.SPHERE, 1, 1, 0, 0), 'full height at the top').toBe(1);
    const edge = surfaceAlong(SHAPE.SPHERE, 1, 1, 0.8, 0);
    expect(edge, 'and much less out at the side').toBeLessThan(0.7);
    expect(edge, 'but it is still on the ball').toBeGreaterThan(0);
  });

  it('so a part put near the edge of a dome sits ON the dome', () => {
    // It used to be anchored to the corner of a bounding box nothing can
    // see, which left it hanging in the air beside the parent.
    const mid = faceAnchor(block([2, 2, 2], SHAPE.DOME), TOP, [0.5, 0.5, 0.5], [0, 0, 0]);
    const out = faceAnchor(block([2, 2, 2], SHAPE.DOME), TOP, [0.5, 0.5, 0.5], [0.75, 0, 0]);
    expect(out[1], 'lower, because the dome is lower there').toBeLessThan(mid[1]);
    expect(out[1], 'and not sunk through the middle of it').toBeGreaterThan(0);
  });

  it('a line that misses the shape falls back to the box', () => {
    // Straight down the hole in a tube. Burying the part at the centre of
    // its parent would be a stranger answer than the one we already gave.
    expect(surfaceAlong(SHAPE.TUBE, 1, 1, 0, 0)).toBe(1);
  });
});

describe('reading a block colour back', () => {
  it('says what the block is mostly made of', () => {
    const v = new VoxelBlock(8, 3);
    expect(v.dominantColor()).toBe(3);
  });

  it('and answers for an empty one without pretending', () => {
    const v = new VoxelBlock(8, 3);
    v.clear();
    expect(v.dominantColor()).toBe(-1);
  });

  it('ignores the holes rather than sampling one cell', () => {
    const v = new VoxelBlock(8, 2);
    v.brush(0, 0, 0, 1, 0);              // carve a corner out
    expect(v.dominantColor(), 'still mostly what it was').toBe(2);
  });
});
