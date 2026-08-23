// ============================================================
//  Block shapes.
//
//  A shape is NOT a different kind of geometry. Every block is still the
//  same voxel grid it always was; a shape is just the pattern that grid is
//  filled with. That single decision is what makes 20 of them affordable:
//
//    - carving, adding and painting keep working on every shape
//    - the greedy mesher, save/load, share codes and collision are untouched
//    - mass falls out for free, because it already counts solid cells
//      (a sphere weighs about half what the same box would)
//
//  The cost is that a sphere is a voxel sphere, with steps on its silhouette.
//  In a game built out of voxel blocks that is the right side of the trade —
//  a smooth sphere would be the thing that looked out of place.
//
//  Masks are evaluated in NORMALISED space: x, y, z each run -1..1 across the
//  block's own box, whatever its dimensions. So a sphere in a 2 x 0.5 x 1
//  block is a squashed ellipsoid, which is what anyone stretching a sphere
//  expects to get.
// ============================================================

export const SHAPE = {
  BOX: 'box',
  SPHERE: 'sphere',
  CYLINDER: 'cylinder',
  CAPSULE: 'capsule',
  HEX: 'hex',

  DOME: 'dome',
  CONE: 'cone',
  FRUSTUM: 'frustum',
  PYRAMID: 'pyramid',
  OCTA: 'octa',

  TETRA: 'tetra',
  BEVEL: 'bevel',
  WEDGE: 'wedge',
  PRISM: 'prism',
  STAIR: 'stair',

  TUBE: 'tube',
  TORUS: 'torus',
  ARCH: 'arch',
  CROSS: 'cross',
  DISH: 'dish',
};

export const SHAPE_DEFAULT = SHAPE.BOX;

/** Height from the bottom of the box, 0..1. */
const up = (y) => (y + 1) * 0.5;

const SQ3_2 = Math.sqrt(3) / 2;

/**
 * The chamfer that the core has always worn. `bevel(0.22)` cuts cells whose
 * summed distance to the three nearest faces is under 22% of the edge, which
 * works out to this half-space at the default 1/32 resolution.
 */
const BEVEL_CUT = 2.47;

/**
 * One row per shape.
 *
 *  group   which block of five it belongs to in the picker
 *  label   what the button says
 *  mask    is this point inside the shape? x, y, z each -1..1
 */
export const SHAPES = {
  // ---- 基本: things you build a body out of
  [SHAPE.BOX]: {
    group: '基本', label: '立方体',
    mask: () => true,
  },
  [SHAPE.SPHERE]: {
    group: '基本', label: '球',
    mask: (x, y, z) => x * x + y * y + z * z <= 1,
  },
  [SHAPE.CYLINDER]: {
    group: '基本', label: '円柱',
    mask: (x, y, z) => x * x + z * z <= 1,
  },
  [SHAPE.CAPSULE]: {
    group: '基本', label: 'カプセル',
    mask: (x, y, z) => {
      // Straight through the middle half, rounded off over the rest.
      const k = Math.max(0, Math.abs(y) - 0.5) * 2;
      return x * x + z * z <= 1 - k * k;
    },
  },
  [SHAPE.HEX]: {
    group: '基本', label: '六角柱',
    mask: (x, y, z) => Math.abs(z) <= 1 && Math.abs(z) * 0.5 + Math.abs(x) * SQ3_2 <= 1,
  },

  // ---- 先細り: anything that narrows toward one end
  [SHAPE.DOME]: {
    group: '先細り', label: 'ドーム',
    mask: (x, y, z) => { const h = up(y); return x * x + z * z <= 1 - h * h; },
  },
  [SHAPE.CONE]: {
    group: '先細り', label: '円錐',
    mask: (x, y, z) => { const t = 1 - up(y); return x * x + z * z <= t * t; },
  },
  [SHAPE.FRUSTUM]: {
    group: '先細り', label: '円錐台',
    mask: (x, y, z) => { const t = 1 - up(y) * 0.5; return x * x + z * z <= t * t; },
  },
  [SHAPE.PYRAMID]: {
    group: '先細り', label: '四角錐',
    mask: (x, y, z) => Math.max(Math.abs(x), Math.abs(z)) <= 1 - up(y),
  },
  [SHAPE.OCTA]: {
    group: '先細り', label: '八面体',
    mask: (x, y, z) => Math.abs(x) + Math.abs(y) + Math.abs(z) <= 1,
  },

  // ---- 角: flat faces and hard edges
  [SHAPE.TETRA]: {
    group: '角', label: '四面体',
    mask: (x, y, z) => (x + y + z) <= 1 && (x - y - z) <= 1
      && (-x + y - z) <= 1 && (-x - y + z) <= 1,
  },
  [SHAPE.BEVEL]: {
    group: '角', label: '面取り',
    mask: (x, y, z) => Math.abs(x) + Math.abs(y) + Math.abs(z) <= BEVEL_CUT,
  },
  [SHAPE.WEDGE]: {
    group: '角', label: '斜面',
    mask: (x, y, z) => up(y) <= up(z),
  },
  [SHAPE.PRISM]: {
    group: '角', label: '三角柱',
    mask: (x, y) => up(y) <= 1 - Math.abs(x),
  },
  [SHAPE.STAIR]: {
    group: '角', label: '階段',
    mask: (x, y, z) => up(y) <= Math.min(1, (Math.floor(up(z) * 4) + 1) / 4),
  },

  // ---- 抜き: shapes with a hole in them
  [SHAPE.TUBE]: {
    group: '抜き', label: '筒',
    mask: (x, y, z) => { const r = x * x + z * z; return r <= 1 && r >= 0.25; },
  },
  [SHAPE.TORUS]: {
    group: '抜き', label: '輪',
    mask: (x, y, z) => {
      // Outer radius has to be 1 to fill the box, so the ring is only as
      // open as the tube is thin. 0.28 leaves a hole you can see through,
      // which is the whole reason to pick a ring over a cylinder.
      const d = Math.hypot(x, z) - 0.72;
      return (d * d) / (0.28 * 0.28) + y * y <= 1;
    },
  },
  [SHAPE.ARCH]: {
    group: '抜き', label: 'アーチ',
    mask: (x, y) => !(Math.abs(x) <= 0.55 && (y <= 0 || x * x + y * y <= 0.3025)),
  },
  [SHAPE.CROSS]: {
    group: '抜き', label: '十字',
    mask: (x, y, z) => {
      const a = Math.abs(x) <= 0.35, b = Math.abs(y) <= 0.35, c = Math.abs(z) <= 0.35;
      return (a && b) || (b && c) || (a && c);
    },
  },
  [SHAPE.DISH]: {
    group: '抜き', label: '皿',
    mask: (x, y, z) => {
      const r = x * x + y * y + z * z;
      return r <= 1 && r >= 0.38 && y <= 0.35;
    },
  },
};

export const SHAPE_IDS = Object.keys(SHAPES);

/** The picker's rows, in table order. */
export const SHAPE_GROUPS = SHAPE_IDS.reduce((rows, id) => {
  const g = SHAPES[id].group;
  const row = rows.find((r) => r.group === g);
  if (row) row.ids.push(id);
  else rows.push({ group: g, ids: [id] });
  return rows;
}, []);

export const isShape = (id) => Object.prototype.hasOwnProperty.call(SHAPES, id);

/** The mask for a shape id, falling back to a solid box for anything unknown. */
export function shapeMask(id) {
  return (SHAPES[id] ?? SHAPES[SHAPE.BOX]).mask;
}

export function shapeLabel(id) {
  return (SHAPES[id] ?? SHAPES[SHAPE.BOX]).label;
}
