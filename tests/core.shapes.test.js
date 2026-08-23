import { describe, it, expect } from 'vitest';
import {
  SHAPE, SHAPES, SHAPE_IDS, SHAPE_GROUPS, SHAPE_DEFAULT,
  isShape, shapeMask, shapeLabel,
} from '../src/core/Shapes.js';
import { VoxelBlock } from '../src/core/VoxelBlock.js';
import { VOX_LEVELS } from '../src/core/constants.js';

/** Fraction of the grid a shape fills at this resolution. */
const ratio = (id, n = 32) => {
  const v = new VoxelBlock(n, 1).fillShape(id, 1);
  return v.solid / v.total;
};

/** Is that cell solid, in -1..1 coordinates? */
const at = (vox, x, y, z) => {
  const n = vox.n;
  const idx = (c) => Math.min(n - 1, Math.max(0, Math.floor(((c + 1) / 2) * n)));
  return vox.get(idx(x), idx(y), idx(z)) !== 0;
};

const cut = (id, n = 32) => new VoxelBlock(n, 1).fillShape(id, 1);

describe('the shape table', () => {
  it('offers twenty shapes', () => {
    expect(SHAPE_IDS).toHaveLength(20);
    expect(new Set(SHAPE_IDS).size, 'no duplicate ids').toBe(20);
    expect(Object.values(SHAPE)).toHaveLength(20);
  });

  it('lays them out four rows of five', () => {
    expect(SHAPE_GROUPS).toHaveLength(4);
    for (const row of SHAPE_GROUPS) expect(row.ids, row.group).toHaveLength(5);
  });

  it('every shape has a label and a mask', () => {
    for (const id of SHAPE_IDS) {
      expect(typeof SHAPES[id].label, id).toBe('string');
      expect(SHAPES[id].label.length, id).toBeGreaterThan(0);
      expect(typeof SHAPES[id].mask, id).toBe('function');
      expect(typeof SHAPES[id].mask(0, 0, 0), id).toBe('boolean');
    }
  });

  it('every shape is visible at every resolution the game offers', () => {
    // A mask too fine for the grid would leave an invisible block, which is
    // the one outcome nobody could debug from the editor.
    for (const n of VOX_LEVELS) {
      for (const id of SHAPE_IDS) {
        expect(ratio(id, n), `${id} at 1/${n}`).toBeGreaterThan(0.05);
      }
    }
  });

  it('only the box fills its whole bounding box', () => {
    expect(ratio(SHAPE.BOX)).toBe(1);
    for (const id of SHAPE_IDS) {
      if (id === SHAPE.BOX) continue;
      expect(ratio(id), id).toBeLessThan(1);
    }
  });

  it('unknown ids fall back to a solid box rather than throwing', () => {
    expect(isShape(SHAPE.SPHERE)).toBe(true);
    expect(isShape('banana')).toBe(false);
    expect(shapeMask('banana')(0.9, 0.9, 0.9)).toBe(true);
    expect(shapeLabel('banana')).toBe(SHAPES[SHAPE_DEFAULT].label);
  });
});

describe('what the shapes actually look like', () => {
  it('a sphere keeps the middle and loses the corners', () => {
    const v = cut(SHAPE.SPHERE);
    expect(at(v, 0, 0, 0)).toBe(true);
    expect(at(v, 0.9, 0.9, 0.9)).toBe(false);
    expect(at(v, 0.9, 0, 0), 'but reaches the face centres').toBe(true);
    expect(ratio(SHAPE.SPHERE)).toBeCloseTo(Math.PI / 6, 1);
  });

  it('a cylinder is round in XZ and straight in Y', () => {
    const v = cut(SHAPE.CYLINDER);
    expect(at(v, 0, 0.95, 0), 'full height').toBe(true);
    expect(at(v, 0, -0.95, 0)).toBe(true);
    expect(at(v, 0.9, 0, 0.9), 'corners cut').toBe(false);
  });

  it('the tapered ones are wide at the bottom and narrow at the top', () => {
    for (const id of [SHAPE.CONE, SHAPE.PYRAMID, SHAPE.DOME, SHAPE.FRUSTUM]) {
      const v = cut(id);
      expect(at(v, 0, -0.95, 0), `${id} bottom`).toBe(true);
      expect(at(v, 0.8, -0.95, 0), `${id} wide at the bottom`).toBe(true);
      expect(at(v, 0.8, 0.95, 0), `${id} narrow at the top`).toBe(false);
    }
  });

  it('a cone comes to a point but a frustum does not', () => {
    expect(at(cut(SHAPE.CONE), 0.3, 0.9, 0)).toBe(false);
    expect(at(cut(SHAPE.FRUSTUM), 0.3, 0.9, 0), 'the top is still flat').toBe(true);
  });

  it('a wedge is a ramp along Z', () => {
    const v = cut(SHAPE.WEDGE);
    expect(at(v, 0, 0.9, 0.9), 'high at the far end').toBe(true);
    expect(at(v, 0, 0.9, -0.9), 'nothing up there at the near end').toBe(false);
    expect(at(v, 0, -0.9, -0.9), 'but the floor runs all the way').toBe(true);
  });

  it('the open shapes really have a hole through them', () => {
    // The centre line is empty on all of these, which is the whole point.
    expect(at(cut(SHAPE.TUBE), 0, 0, 0)).toBe(false);
    expect(at(cut(SHAPE.TORUS), 0, 0, 0)).toBe(false);
    expect(at(cut(SHAPE.ARCH), 0, -0.5, 0)).toBe(false);
    expect(at(cut(SHAPE.DISH), 0, 0, 0)).toBe(false);
    // ...and the walls around it are not.
    expect(at(cut(SHAPE.TUBE), 0.9, 0, 0)).toBe(true);
    expect(at(cut(SHAPE.TORUS), 0.9, 0, 0)).toBe(true);
    expect(at(cut(SHAPE.ARCH), 0.9, -0.5, 0)).toBe(true);
  });

  it('a cross is bars, not a block', () => {
    const v = cut(SHAPE.CROSS);
    expect(at(v, 0.9, 0, 0), 'arms reach the faces').toBe(true);
    expect(at(v, 0, 0.9, 0)).toBe(true);
    expect(at(v, 0, 0, 0.9)).toBe(true);
    expect(at(v, 0.9, 0.9, 0.9), 'corners are empty').toBe(false);
  });

  it('a tetrahedron keeps four alternating corners', () => {
    const v = cut(SHAPE.TETRA);
    expect(at(v, -0.9, -0.9, -0.9)).toBe(true);
    expect(at(v, 0.9, 0.9, 0.9)).toBe(false);
  });

  it('the chamfer is exactly the one the core has always worn', () => {
    // The core used to be cut by bevel(0.22). Switching it to a shape must
    // not have changed how anybody's machine looks.
    const old = new VoxelBlock(32, 0).bevel(0.22);
    const now = new VoxelBlock(32, 0).fillShape(SHAPE.BEVEL, 0);
    expect(now.solid).toBe(old.solid);
    for (let i = 0; i < old.data.length; i++) {
      if (!!old.data[i] !== !!now.data[i]) throw new Error(`cell ${i} differs`);
    }
  });
});

describe('shapes and the block they live in', () => {
  it('cutting a shape replaces whatever was there', () => {
    const v = new VoxelBlock(16, 1);
    v.brush(8, 8, 8, 3, 0);
    const carved = v.solid;
    v.fillShape(SHAPE.SPHERE, 1);
    expect(v.solid).not.toBe(carved);
    expect(v.solid).toBe(new VoxelBlock(16, 1).fillShape(SHAPE.SPHERE, 1).solid);
  });

  it('cutting keeps the colour it was told to use', () => {
    const v = new VoxelBlock(16, 1).fillShape(SHAPE.SPHERE, 6);
    expect([...v.usedColors()]).toEqual([6]);
    expect(v.mainColor()).toBe(6);
  });

  it('reports which colour a block is mostly made of', () => {
    const v = new VoxelBlock(16, 3);
    v.paint(8, 8, 8, 1, 9);            // a small patch of another colour
    expect(v.mainColor()).toBe(3);
  });

  it('knows whether a block is still the shape it was cut to', () => {
    const v = new VoxelBlock(16, 1).fillShape(SHAPE.SPHERE, 1);
    expect(v.isPristine(SHAPE.SPHERE)).toBe(true);
    expect(v.isPristine(SHAPE.BOX), 'and which shape it is not').toBe(false);

    v.repaint(7);
    expect(v.isPristine(SHAPE.SPHERE), 'repainting is not sculpting').toBe(true);

    v.brush(8, 8, 8, 2, 0);
    expect(v.isPristine(SHAPE.SPHERE), 'carving is').toBe(false);
  });
});
