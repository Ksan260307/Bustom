import { SHAPE_DEFAULT } from '../core/Shapes.js';

/**
 * The parts of sculpting that are about voxels rather than about the mouse.
 *
 * Kept out of the editor scene because none of it needs a camera, a ray or
 * a selection — which also means every one of them can be tested by handing
 * it a grid and looking at what came back, rather than by pretending to
 * click on something.
 */

/**
 * Every cell along a line, so a fast drag leaves a stroke rather than a
 * dotted line.
 *
 * A dab happens where the pointer was when the frame ran. Move the mouse
 * quickly and the frames land a long way apart, so what you drew was a row
 * of separate holes with the block still solid between them — and the
 * faster you worked the worse it got, which is the opposite of how a tool
 * should behave.
 *
 * Bresenham in three dimensions: the cells a straight line passes through,
 * in order, including both ends.
 */
export function lineCells(a, b) {
  const out = [];
  let x = a.x;
  let y = a.y;
  let z = a.z;
  const dx = Math.abs(b.x - x);
  const dy = Math.abs(b.y - y);
  const dz = Math.abs(b.z - z);
  const sx = b.x > x ? 1 : -1;
  const sy = b.y > y ? 1 : -1;
  const sz = b.z > z ? 1 : -1;
  const n = Math.max(dx, dy, dz);
  if (n === 0) return [{ x, y, z }];
  // Stepped along the longest axis, so the count is the length of the line
  // and not the sum of its parts.
  let ex = n / 2;
  let ey = n / 2;
  let ez = n / 2;
  out.push({ x, y, z });
  for (let i = 0; i < n; i++) {
    ex -= dx; if (ex < 0) { ex += n; x += sx; }
    ey -= dy; if (ey < 0) { ey += n; y += sy; }
    ez -= dz; if (ez < 0) { ez += n; z += sz; }
    out.push({ x, y, z });
  }
  return out;
}

/**
 * Everything joined to this cell that is the same colour.
 *
 * What "fill this in" means when you are looking at a carved surface: the
 * patch you can see, not every cell of that shade scattered through the
 * block. Six-way joined, because a diagonal touch is not a surface anybody
 * would call connected.
 */
export function region(vox, x, y, z, limit = 200000) {
  const want = vox.get(x, y, z);
  const seen = new Set();
  const out = [];
  const stack = [[x, y, z]];
  while (stack.length && out.length < limit) {
    const [cx, cy, cz] = stack.pop();
    if (!vox.inBounds(cx, cy, cz)) continue;
    const key = vox.index(cx, cy, cz);
    if (seen.has(key)) continue;
    seen.add(key);
    if (vox.get(cx, cy, cz) !== want) continue;
    out.push([cx, cy, cz]);
    stack.push([cx + 1, cy, cz], [cx - 1, cy, cz]);
    stack.push([cx, cy + 1, cz], [cx, cy - 1, cz]);
    stack.push([cx, cy, cz + 1], [cx, cy, cz - 1]);
  }
  return out;
}

/** Paint a joined patch in one go. Returns how many cells changed. */
export function fillRegion(vox, x, y, z, colorIndex) {
  const cells = region(vox, x, y, z);
  if (!cells.length) return 0;
  const to = vox.get(x, y, z) === 0 ? 0 : colorIndex + 1;
  if (to === 0) return 0;                     // filling a hole would be ADD
  let changed = 0;
  for (const [cx, cy, cz] of cells) {
    if (vox.get(cx, cy, cz) === to) continue;
    vox.set(cx, cy, cz, to);
    changed++;
  }
  return changed;
}

/**
 * Take the roughness off a carved surface.
 *
 * A voxel cut is all corners, and the round brush only makes the corners
 * rounder in one place at a time. This looks at every cell in reach and
 * asks how much of what surrounds it is solid: mostly solid fills in,
 * mostly empty clears out, and what is left is the shape with its worst
 * steps taken off.
 *
 * One pass. Repeating it is a decision for whoever is holding the mouse,
 * and doing three passes per dab would melt a shape in a single drag.
 */
export function smooth(vox, cx, cy, cz, r, colorIndex) {
  const n = vox.n;
  const lo = Math.max(0, Math.min(cx, cy, cz) - r);
  const reads = [];
  for (let z = Math.max(0, cz - r); z <= Math.min(n - 1, cz + r); z++) {
    for (let y = Math.max(0, cy - r); y <= Math.min(n - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(n - 1, cx + r); x++) {
        // Round, so smoothing a corner does not square it off again.
        const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
        if (d > r * r) continue;
        let solid = 0;
        let seen = 0;
        for (let k = -1; k <= 1; k++) {
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              if (!i && !j && !k) continue;
              if (!vox.inBounds(x + i, y + j, z + k)) continue;
              seen++;
              if (vox.get(x + i, y + j, z + k)) solid++;
            }
          }
        }
        if (!seen) continue;
        const share = solid / seen;
        const here = vox.get(x, y, z);
        // Two thirds and one third, not a half: a threshold at the middle
        // flips every surface cell every pass and the shape crawls.
        if (!here && share > 0.66) reads.push([x, y, z, colorIndex + 1]);
        else if (here && share < 0.34) reads.push([x, y, z, 0]);
      }
    }
  }
  // Written after every read, or the pass would smooth against cells it had
  // already smoothed and run away in whichever direction it happened to scan.
  for (const [x, y, z, v] of reads) vox.set(x, y, z, v);
  return reads.length + (lo < 0 ? 0 : 0);
}

/**
 * Cut a flat face, rather than a round scoop.
 *
 * The one thing a brush cannot do: a straight cut. Everything from the
 * clicked cell outwards along one axis goes, so a lumpy carved surface can
 * be squared off in a stroke.
 */
export function flatten(vox, cx, cy, cz, r, axis, dir) {
  const n = vox.n;
  let changed = 0;
  const along = (x, y, z) => [x, y, z][axis];
  const start = along(cx, cy, cz);
  for (let z = Math.max(0, cz - r); z <= Math.min(n - 1, cz + r); z++) {
    for (let y = Math.max(0, cy - r); y <= Math.min(n - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(n - 1, cx + r); x++) {
        // Round in the plane of the cut; the depth is the whole point and
        // is not tapered.
        const p = [x, y, z];
        let d = 0;
        for (let i = 0; i < 3; i++) if (i !== axis) d += (p[i] - [cx, cy, cz][i]) ** 2;
        if (d > r * r) continue;
        const at = along(x, y, z);
        // Only what stands proud of the plane, on the side the face is on.
        if (dir > 0 ? at < start : at > start) continue;
        if (!vox.get(x, y, z)) continue;
        vox.set(x, y, z, 0);
        changed++;
      }
    }
  }
  return changed;
}

/**
 * A hole all the way through, along one axis.
 *
 * Drilling through a block by carving from both sides and hoping they meet
 * is the sort of work a tool should do for you.
 */
export function drill(vox, cx, cy, cz, r, axis) {
  const n = vox.n;
  let changed = 0;
  const c = [cx, cy, cz];
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p = [x, y, z];
        let d = 0;
        for (let i = 0; i < 3; i++) if (i !== axis) d += (p[i] - c[i]) ** 2;
        if (d > r * r) continue;
        if (!vox.get(x, y, z)) continue;
        vox.set(x, y, z, 0);
        changed++;
      }
    }
  }
  return changed;
}

/** How much of the block is still there, 0..1. */
export function solidShare(vox) {
  return vox.total ? vox.solid / vox.total : 0;
}

/**
 * Put a block back to the shape it was cut from.
 *
 * Undo walks back one step at a time, so getting out of ten minutes of
 * carving meant ten minutes of Ctrl+Z or throwing the block away and
 * placing it again — which loses where it was and what was hanging off it.
 */
export function resetToShape(part) {
  if (!part?.vox) return false;
  const shape = part.shape ?? SHAPE_DEFAULT;
  const colour = part.vox.mainColor();
  part.vox.fillShape(shape, colour);
  return true;
}
