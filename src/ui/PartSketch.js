// ============================================================
//  A little picture of a saved part.
//
//  The shelf used to be a list of names, and a name is a poor way to tell
//  four arms apart six months after you built them. This draws the part flat
//  on a small canvas — no renderer, no lights, no scene: the boxes projected
//  side-on and filled with their own colours, which is enough to recognise
//  something you made yourself.
// ============================================================

/** Blocks that carry a size are drawn; bones are drawn as their shaft. */
function boxes(json) {
  const byId = new Map(json.parts.map((p) => [p.id, p]));
  const out = [];
  for (const part of json.parts) {
    // Where it sits, walked up through its parents. Rotations are ignored:
    // this is a sign, not a render, and a sign that takes a frame to draw
    // would be the wrong trade for a shelf of twenty.
    let x = 0;
    let y = 0;
    let z = 0;
    for (let p = part; p; p = byId.get(p.parent)) {
      const m = p.mount?.pos;
      if (!m) break;
      x += m[0]; y += m[1]; z += m[2];
    }
    const s = part.kind === 'bone'
      ? [(part.radius ?? 0.1) * 2, part.length ?? 0.5, (part.radius ?? 0.1) * 2]
      : Array.isArray(part.size) ? part.size
        : [part.size ?? 0.4, part.size ?? 0.4, 0.08];
    out.push({ x, y, z, w: s[0], h: s[1], color: part.color ?? 0, kind: part.kind });
  }
  return out;
}

/**
 * @param {object} json a stored part document
 * @param {number} px how big the picture should be
 * @returns {HTMLCanvasElement}
 */
export function partSketch(json, px = 40) {
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  cv.className = 'libsketch';
  const g = cv.getContext('2d');
  if (!g || !json?.parts?.length) return cv;

  const items = boxes(json);
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  for (const b of items) {
    minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, b.y - b.h / 2); maxY = Math.max(maxY, b.y + b.h / 2);
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.001);
  const pad = px * 0.12;
  const k = (px - pad * 2) / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const colors = json.palette?.colors ?? json.palette ?? [];
  const hex = (i) => {
    const c = Array.isArray(colors) ? colors[i] : undefined;
    return typeof c === 'number' ? `#${c.toString(16).padStart(6, '0')}` : '#8a94a6';
  };

  // Far parts first, so the near ones sit on top the way they would in life.
  items.sort((a, b) => a.z - b.z);
  for (const b of items) {
    const w = Math.max(1.5, b.w * k);
    const h = Math.max(1.5, b.h * k);
    g.fillStyle = b.kind === 'bone' ? '#5c6473' : hex(b.color);
    g.globalAlpha = b.kind === 'bone' ? 0.7 : 1;
    g.fillRect(
      px / 2 + (b.x - cx) * k - w / 2,
      px / 2 - (b.y - cy) * k - h / 2,          // screen y grows downwards
      w, h,
    );
  }
  g.globalAlpha = 1;
  return cv;
}
