import * as THREE from 'three';
import { VOX, VOXEL, PALETTE, VOXEL_MASS } from './constants.js';

// ============================================================
//  Voxel grid : the interior of a single block.
//  Stored as VOX^3 bytes. 0 = empty, n>0 = PALETTE[n-1].
// ============================================================

export const voxIndex = (x, y, z) => x + y * VOX + z * VOX * VOX;

export function createVoxels(colorIndex = 1) {
  return new Uint8Array(VOX * VOX * VOX).fill(colorIndex + 1);
}

export function emptyVoxels() {
  return new Uint8Array(VOX * VOX * VOX);
}

export function inBounds(x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < VOX && y < VOX && z < VOX;
}

export function getVoxel(vox, x, y, z) {
  return inBounds(x, y, z) ? vox[voxIndex(x, y, z)] : 0;
}

export function setVoxel(vox, x, y, z, v) {
  if (!inBounds(x, y, z)) return false;
  const i = voxIndex(x, y, z);
  if (vox[i] === v) return false;
  vox[i] = v;
  return true;
}

/** Solid voxel count -> used for mass. */
export function voxelCount(vox) {
  let n = 0;
  for (let i = 0; i < vox.length; i++) if (vox[i]) n++;
  return n;
}

export function voxelMass(vox) {
  return voxelCount(vox) * VOXEL_MASS;
}

/** Centroid of the solid voxels, in block units (0..1 per axis). */
export function voxelCentroid(vox, out = new THREE.Vector3()) {
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (let z = 0; z < VOX; z++)
    for (let y = 0; y < VOX; y++)
      for (let x = 0; x < VOX; x++)
        if (vox[voxIndex(x, y, z)]) { sx += x + 0.5; sy += y + 0.5; sz += z + 0.5; n++; }
  if (!n) return out.set(0.5, 0.5, 0.5);
  return out.set(sx / n / VOX, sy / n / VOX, sz / n / VOX);
}

// ------------------------------------------------------------
//  Greedy mesher
// ------------------------------------------------------------

const _c = new THREE.Color();

/**
 * Merge coplanar same-colour voxel faces into as few quads as possible.
 * Returns a BufferGeometry in block-local space (origin at the block min
 * corner, extent BLOCK per axis), with vertex colours baked in.
 */
export function greedyMesh(vox) {
  const dims = [VOX, VOX, VOX];
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  const get = (x, y, z) => vox[voxIndex(x, y, z)];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;

    const mask = new Int16Array(dims[u] * dims[v]);

    for (x[d] = -1; x[d] < dims[d];) {
      // --- build the mask for this slice
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; ++x[v]) {
        for (x[u] = 0; x[u] < dims[u]; ++x[u], ++n) {
          const a = x[d] >= 0 ? get(x[0], x[1], x[2]) : 0;
          const b = x[d] < dims[d] - 1 ? get(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0;
          // A face exists only where solid meets empty.
          if (!!a === !!b) mask[n] = 0;
          else if (a) mask[n] = a;   // face points toward +d
          else mask[n] = -b;         // face points toward -d
        }
      }
      ++x[d];

      // --- greedily merge the mask into quads
      n = 0;
      for (let j = 0; j < dims[v]; ++j) {
        for (let i = 0; i < dims[u];) {
          const c = mask[n];
          if (c === 0) { ++i; ++n; continue; }

          let w = 1;
          while (i + w < dims[u] && mask[n + w] === c) w++;

          let h = 1;
          outer: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * dims[u]] !== c) break outer;
            }
          }

          x[u] = i; x[v] = j;
          const du = [0, 0, 0]; du[u] = w;
          const dv = [0, 0, 0]; dv[v] = h;
          emitQuad(x, du, dv, d, c > 0, Math.abs(c) - 1);

          for (let l = 0; l < h; l++)
            for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;

          i += w; n += w;
        }
      }
    }
  }

  function emitQuad(base, du, dv, axis, positive, colorIndex) {
    const s = VOXEL;
    const v0 = [base[0] * s, base[1] * s, base[2] * s];
    const v1 = [(base[0] + du[0]) * s, (base[1] + du[1]) * s, (base[2] + du[2]) * s];
    const v2 = [(base[0] + du[0] + dv[0]) * s, (base[1] + du[1] + dv[1]) * s, (base[2] + du[2] + dv[2]) * s];
    const v3 = [(base[0] + dv[0]) * s, (base[1] + dv[1]) * s, (base[2] + dv[2]) * s];

    const nrm = [0, 0, 0];
    nrm[axis] = positive ? 1 : -1;

    const start = positions.length / 3;
    for (const p of [v0, v1, v2, v3]) positions.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) normals.push(nrm[0], nrm[1], nrm[2]);

    // setHex already converts into the renderer's working space when
    // ColorManagement is on (three r152+); converting again would double-darken.
    _c.setHex(PALETTE[colorIndex] ?? PALETTE[0]);
    for (let k = 0; k < 4; k++) colors.push(_c.r, _c.g, _c.b);

    if (positive) indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    else indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// ------------------------------------------------------------
//  Sculpting helpers (advanced editor mode)
// ------------------------------------------------------------

/** Carve or add over a spherical/cubic brush. Returns true if anything changed. */
export function brush(vox, cx, cy, cz, radius, value, spherical = true) {
  let changed = false;
  const r = Math.max(0, radius - 1);
  for (let z = cz - r; z <= cz + r; z++)
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (spherical) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          if (dx * dx + dy * dy + dz * dz > (r + 0.35) * (r + 0.35)) continue;
        }
        if (setVoxel(vox, x, y, z, value)) changed = true;
      }
  return changed;
}

/** Repaint solid voxels under the brush without changing occupancy. */
export function paintBrush(vox, cx, cy, cz, radius, colorIndex) {
  let changed = false;
  const r = Math.max(0, radius - 1);
  for (let z = cz - r; z <= cz + r; z++)
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (!inBounds(x, y, z)) continue;
        const dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > (r + 0.35) * (r + 0.35)) continue;
        const i = voxIndex(x, y, z);
        if (vox[i] && vox[i] !== colorIndex + 1) { vox[i] = colorIndex + 1; changed = true; }
      }
  return changed;
}

/** Chamfer the 8 corners so plain cubes read as machined parts. */
export function bevel(vox, amount = 2) {
  for (let z = 0; z < VOX; z++)
    for (let y = 0; y < VOX; y++)
      for (let x = 0; x < VOX; x++) {
        const dx = Math.min(x, VOX - 1 - x);
        const dy = Math.min(y, VOX - 1 - y);
        const dz = Math.min(z, VOX - 1 - z);
        if (dx + dy + dz < amount) vox[voxIndex(x, y, z)] = 0;
      }
  return vox;
}

// ------------------------------------------------------------
//  Serialisation : run-length encoded to keep saves small
// ------------------------------------------------------------

export function encodeVoxels(vox) {
  const out = [];
  let run = 1;
  for (let i = 1; i <= vox.length; i++) {
    if (i < vox.length && vox[i] === vox[i - 1] && run < 65535) { run++; continue; }
    out.push(vox[i - 1], run);
    run = 1;
  }
  return out;
}

export function decodeVoxels(rle) {
  const vox = emptyVoxels();
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const val = rle[i], run = rle[i + 1];
    for (let k = 0; k < run && p < vox.length; k++) vox[p++] = val;
  }
  return vox;
}
