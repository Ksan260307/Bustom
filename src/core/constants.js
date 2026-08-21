// ============================================================
//  BroStom : core constants
// ============================================================

/** The nominal block edge, in world units. Parts scale freely around it. */
export const BLOCK = 1.0;

/**
 * Sculpt resolutions: how many cuts a block edge is divided into.
 * 1/100 is the finest the format allows; it costs 1MB per block, so the
 * default sits at 1/32 and the builder raises it only where detail is wanted.
 */
export const VOX_LEVELS = [16, 32, 50, 100];
export const DEFAULT_VOX = 32;

/** Chunk edge used for incremental re-meshing at each resolution. */
export function chunkSizeFor(n) {
  if (n <= 16) return 8;
  if (n <= 32) return 8;
  if (n <= 50) return 10;
  return 20;
}

/** Free part sizing, quantised so blocks still bite together cleanly. */
export const SIZE_STEP = 0.25;
export const SIZE_MIN = 0.25;
export const SIZE_MAX = 4.0;

export const snapSize = (v) =>
  Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(v / SIZE_STEP) * SIZE_STEP));

/** Free bone geometry. */
export const BONE_LENGTH_MIN = 0.5;
export const BONE_LENGTH_MAX = 12;
export const BONE_RADIUS_MIN = 0.04;
export const BONE_RADIUS_MAX = 0.6;

/** Free mount nudge, in world units, on top of the socket position. */
export const OFFSET_LIMIT = 1.5;

/** Face indices. Order matters: it is baked into serialized data. */
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

/** Unit normal per face index. */
export const FACE_NORMAL = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Which size component a face normal runs along. */
export const FACE_AXIS = [0, 0, 1, 1, 2, 2];

export const FACE_NAME = ['+X (右)', '-X (左)', '+Y (上)', '-Y (下)', '+Z (前)', '-Z (後)'];

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

/** Named thickness presets. The radius itself stays freely adjustable. */
export const BONE_GAUGE = {
  thin:  { radius: 0.10, label: '細' },
  mid:   { radius: 0.16, label: '中' },
  thick: { radius: 0.22, label: '太' },
};

/** Lock-on accent colour, used by HUD + world reticle. */
export const LOCK_COLOR = '#4fd2ff';

/** Gait keys, and how they read in the UI. */
export const GAIT_LABEL = {
  hover: 'ホバー',
  hop: 'ぴょんぴょん',
  walk: '二足歩行',
  multileg: '多脚',
};
