// ============================================================
//  The two DOM helpers the whole UI is built out of. They live apart from
//  EditorUI so panels can share them without importing the editor.
// ============================================================

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Put children into an element that already exists, and hand it back. */
export function append(el, ...kids) {
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Labelled slider that reports its own value. */
export function slider(label, { min, max, step, value, unit = '', fixed = 0 }, onInput) {
  const fmt = (v) => `${fixed ? v.toFixed(fixed) : v}${unit}`;
  const val = h('span', { class: 'val' }, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    onInput: (e) => { const v = Number(e.target.value); val.textContent = fmt(v); onInput(v); },
  });
  const wrap = h('div', { class: 'sliderbox' },
    h('label', { class: 'field' }, h('span', {}, label), val), input);
  wrap.set = (v) => { input.value = v; val.textContent = fmt(v); };
  return wrap;
}

/** Three numeric fields in a row — for free positions and rotations. */
export function vectorField(label, value, step, onChange) {
  const inputs = ['X', 'Y', 'Z'].map((axis, i) => h('input', {
    type: 'number', step, value: Number(value[i]).toFixed(2), 'aria-label': `${label} ${axis}`,
    onChange: (e) => {
      const next = inputs.map((el) => Number(el.value) || 0);
      onChange(next);
    },
  }));
  const wrap = h('div', { class: 'vecbox' },
    h('label', { class: 'field' }, h('span', {}, label)),
    h('div', { class: 'vecrow' }, ...inputs),
  );
  wrap.set = (v) => inputs.forEach((el, i) => { el.value = Number(v[i]).toFixed(2); });
  return wrap;
}

/**
 * A titled block that can be folded away. Panels get long fast; anything the
 * player is not using right now should be one click from gone.
 */
export function collapsible(title, body, { open = true } = {}) {
  const caret = h('span', { class: 'caret' }, open ? '▾' : '▸');
  const head = h('button', { class: 'sectionhead' }, h('span', {}, title), caret);
  const wrap = h('div', { class: `section${open ? '' : ' folded'}` }, head, body);
  head.addEventListener('click', () => {
    const folded = wrap.classList.toggle('folded');
    caret.textContent = folded ? '▸' : '▾';
  });
  wrap.setOpen = (on) => {
    wrap.classList.toggle('folded', !on);
    caret.textContent = on ? '▾' : '▸';
  };
  return wrap;
}

/** A titled block the tool selection shows and hides for you. */
export function toolSection(title, body) {
  const wrap = h('div', { class: 'toolopts' }, h('h3', { class: 'inline' }, title), body);
  wrap.setVisible = (on) => wrap.classList.toggle('hidden', !on);
  return wrap;
}

// ============================================================
//  Resizable windows
// ============================================================

const SIZE_STORE = 'blostom.ui.size.v1';
/** What it was called before the rename. Read as a fallback, never written. */
const SIZE_STORE_WAS = 'brostom.ui.size.v1';

function loadSizes() {
  try {
    const raw = localStorage.getItem(SIZE_STORE) ?? localStorage.getItem(SIZE_STORE_WAS);
    return JSON.parse(raw ?? '{}') ?? {};
  } catch { return {}; }
}

function saveSizes(all) {
  try { localStorage.setItem(SIZE_STORE, JSON.stringify(all)); } catch { /* private mode */ }
}

/**
 * Let the player drag a window to the size they want.
 *
 * `edges` picks which grips appear: `e`/`w` drag the width, `s` drags the
 * height, and naming both gives you the corner between them as well. Which
 * horizontal edge you use depends on how the window is anchored — a panel
 * pinned to the right of the screen has to grow leftwards, so it gets `w`.
 *
 * Sizes are remembered per `key`, because a panel you widened once you almost
 * certainly want wide next time too. Double-clicking any grip puts it back.
 */
export function resizable(el, {
  key, edges = 'es', minW = 150, minH = 120, speed = 1,
} = {}) {
  const wantW = edges.includes('e') || edges.includes('w');
  const wantH = edges.includes('s');
  const dirX = edges.includes('w') ? -1 : 1;

  const limits = () => ({
    maxW: Math.max(minW, Math.round(window.innerWidth * 0.6)),
    maxH: Math.max(minH, window.innerHeight - 90),
  });

  const clampW = (w) => Math.min(limits().maxW, Math.max(minW, Math.round(w)));
  const clampH = (hh) => Math.min(limits().maxH, Math.max(minH, Math.round(hh)));

  /**
   * Pointer movement is in screen pixels; widths are in the element's own.
   * Those differ whenever an ancestor is scaled, and mixing them makes the
   * window crawl or bolt away from the pointer.
   */
  const scaleOf = () => {
    const r = el.getBoundingClientRect();
    return el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
  };

  const apply = ({ w, h: hh }, remember = true) => {
    if (w) {
      el.style.width = `${clampW(w)}px`;
    }
    if (hh) {
      const v = clampH(hh);
      // The stylesheet caps these panels; an explicit drag has to win, or the
      // window simply refuses to grow and looks broken.
      el.style.height = `${v}px`;
      el.style.maxHeight = `${v}px`;
    }
    if (!remember) return;
    const all = loadSizes();
    const cur = all[key] ?? {};
    all[key] = {
      w: w ? clampW(w) : cur.w,
      h: hh ? clampH(hh) : cur.h,
    };
    saveSizes(all);
  };

  const reset = () => {
    el.style.width = '';
    el.style.height = '';
    el.style.maxHeight = '';
    const all = loadSizes();
    delete all[key];
    saveSizes(all);
  };

  const grip = (cls, axes) => {
    const g = h('div', { class: `grip ${cls}`, title: 'ドラッグでサイズ変更 / ダブルクリックで戻す' });
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const from = {
        x: e.clientX, y: e.clientY,
        w: el.offsetWidth, h: el.offsetHeight,
        k: scaleOf() || 1,
      };
      // Capture is a nicety, not the mechanism: it throws for a synthetic
      // pointer, and a drag has to survive the cursor leaving the grip
      // either way. The listeners go on the window for exactly that reason.
      try { g.setPointerCapture(e.pointerId); } catch { /* no such pointer */ }
      document.body.classList.add('resizing');

      const move = (ev) => {
        const next = {};
        // A window centred on screen only moves half a pixel of edge per
        // pixel of width, so it needs twice the gain to feel attached to
        // the pointer.
        if (axes.includes('x')) next.w = from.w + ((ev.clientX - from.x) / from.k) * dirX * speed;
        if (axes.includes('y')) next.h = from.h + ((ev.clientY - from.y) / from.k) * speed;
        apply(next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    g.addEventListener('dblclick', (e) => { e.preventDefault(); reset(); });
    return g;
  };

  if (wantW) el.append(grip(edges.includes('w') ? 'grip-w' : 'grip-e', 'x'));
  if (wantH) el.append(grip('grip-s', 'y'));
  if (wantW && wantH) {
    el.append(grip(edges.includes('w') ? 'grip-sw' : 'grip-se', 'xy'));
  }

  const stored = loadSizes()[key];
  if (stored) apply(stored, false);

  // A window sized on a big screen must not spill off a small one.
  const onResize = () => {
    const s = loadSizes()[key];
    if (s) apply(s, false);
  };
  window.addEventListener('resize', onResize);

  el.resizeTo = (w, hh) => apply({ w, h: hh });
  el.resetSize = reset;
  el.disposeResize = () => window.removeEventListener('resize', onResize);
  return el;
}
