// ============================================================
//  BroStom : core constants
// ============================================================

/** 1 block = 1.0 world unit. */
export const BLOCK = 1.0;

/** Voxel resolution inside one block (VOX^3 voxels per block). */
export const VOX = 8;

/** Size of a single voxel in world units. */
export const VOXEL = BLOCK / VOX;

/** Face indices. Order matters: it is baked into serialized data. */
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

/** Unit normal per face index. */
export const FACE_NORMAL = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

export const FACE_NAME = ['+X (right)', '-X (left)', '+Y (up)', '-Y (down)', '+Z (front)', '-Z (back)'];

/** Opposite face lookup. */
export const FACE_OPPOSITE = [1, 0, 3, 2, 5, 4];

/**
 * The core block's local +Z is FORWARD (Object3D.lookAt aligns +Z),
 * +Y is UP. Everything downstream relies on this.
 */
export const FORWARD_AXIS = [0, 0, 1];
export const UP_AXIS = [0, 1, 0];

/** Bone attributes. */
export const BONE = {
  LEG: 'leg',
  ARM: 'arm',
  FACE: 'face',
  CUSTOM: 'custom',
};

export const BONE_META = {
  [BONE.LEG]:    { label: 'レッグボーン', color: 0x6fe3ff, mass: 1.4, torque: 26 },
  [BONE.ARM]:    { label: 'アームボーン', color: 0xffc861, mass: 1.0, torque: 18 },
  [BONE.FACE]:   { label: 'フェイスボーン', color: 0xff7ba6, mass: 0.6, torque: 12 },
  [BONE.CUSTOM]: { label: 'カスタムボーン', color: 0xb98cff, mass: 0.9, torque: 15 },
};

/** Bone silhouettes: THIN is a needle, THICK is a strut. */
export const BONE_GAUGE = {
  thin:  { radius: 0.11, massScale: 0.7, label: '細' },
  thick: { radius: 0.19, massScale: 1.0, label: '太' },
};

/** Shared 16-colour palette. Index 0 is reserved for "core silver". */
export const PALETTE = [
  0xc9d2dc, // 0 core silver
  0x2b303a, // 1 gunmetal
  0x5a6472, // 2 steel
  0xe6ebf2, // 3 white
  0xd8463c, // 4 red
  0xf07a2a, // 5 orange
  0xf2c53d, // 6 yellow
  0x62b558, // 7 green
  0x2f9e8f, // 8 teal
  0x3d7ede, // 9 blue
  0x5b4fd6, // 10 indigo
  0x9a52c9, // 11 violet
  0xdb5f9a, // 12 pink
  0x8a6244, // 13 brown
  0x1a1d24, // 14 black
  0x00e5ff, // 15 glow cyan
];

/** Mass of a single solid voxel (tuned so a 1-block cube ~= 1.0). */
export const VOXEL_MASS = 1 / (VOX * VOX * VOX);

/** Lock-on accent colour, used by HUD + world reticle. */
export const LOCK_COLOR = '#4fd2ff';
