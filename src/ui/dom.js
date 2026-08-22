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
