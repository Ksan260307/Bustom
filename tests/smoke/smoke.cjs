// ============================================================
//  The smoke test: does the real app come up, and do the four things
//  Node cannot reach still work?
//
//  The browser suite is gone — four hundred and forty seven tests that took
//  between two and twenty minutes and sometimes took the renderer with
//  them. What it covered that Vitest cannot is a much shorter list:
//
//    1. WebGL actually draws                 (a real context, real frames)
//    2. The 2D canvas the HUD is painted on
//    3. Real pointer events reaching the editor
//    4. The editor's DOM being built at all
//
//  So this checks those four, in the shell the game actually ships in, and
//  nothing else. Everything with a rule in it belongs in Vitest, where it
//  runs in twenty seconds and cannot crash a compositor.
//
//    npm run smoke
//
//  Exits non-zero on the first thing that is not true.
// ============================================================

const path = require('path');
const { app, BrowserWindow } = require('electron');

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT ?? 90_000);
const root = path.resolve(__dirname, '..', '..');

const tty = process.stdout.isTTY;
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

/**
 * What to ask of the running app.
 *
 * Each one runs in the page and returns `{ ok, note }`. Kept as strings
 * rather than functions because they cross a process boundary.
 */
const CHECKS = [
  ['the app boots', `(() => {
    const a = window.__blostom;
    return { ok: !!a && !!a.editor && !!a.field, note: a ? a.mode : 'no app' };
  })()`],

  ['WebGL draws a frame', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.renderer.info.autoReset = false;
    a.renderer.info.reset();
    a.frame();
    const calls = a.renderer.info.render.calls;
    const tris = a.renderer.info.render.triangles;
    a.renderer.info.autoReset = true;
    return { ok: calls > 0 && tris > 0, note: calls + ' draw calls, ' + tris + ' triangles' };
  })()`],

  ['the post chain resolves into the canvas', `(() => {
    const a = window.__blostom;
    const gl = a.renderer.getContext();
    const ok = !!a.post && a.post.target.width > 0
      && gl.drawingBufferWidth > 0 && gl.drawingBufferHeight > 0;
    return { ok, note: gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight };
  })()`],

  ['the HUD paints on its 2D canvas', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    a.field.paused = false;
    const before = a.hudCanvas.toDataURL();
    for (let i = 0; i < 8; i++) a.frame();
    a.field.player.hp = Math.round(a.field.player.maxHp * 0.2);
    a.frame();
    const after = a.hudCanvas.toDataURL();
    a.field.player.hp = a.field.player.maxHp;
    return { ok: after !== before && after.length > 1000, note: 'canvas changed' };
  })()`],

  ['the editor DOM is built', `(() => {
    const want = ['topbar', 'leftpanel', 'rightpanel', 'hint', 'fieldbar', 'pause', 'toast'];
    const missing = want.filter((id) => !document.getElementById(id));
    return { ok: missing.length === 0, note: missing.length ? 'missing ' + missing : want.length + ' panels' };
  })()`],

  ['a real pointer event places a part', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.setTool('block');
    a.editor.symmetry = false;
    const before = a.assembly.parts.size;
    const c = a.editor.canvas;
    const r = c.getBoundingClientRect();
    const at = {
      clientX: r.left + c.clientWidth / 2,
      clientY: r.top + c.clientHeight / 2,
      button: 0, bubbles: true,
    };
    c.dispatchEvent(new PointerEvent('pointermove', at));
    const ghost = a.editor.ghost.visible;
    c.dispatchEvent(new PointerEvent('pointerdown', at));
    window.dispatchEvent(new PointerEvent('pointerup', at));
    return {
      ok: ghost && a.assembly.parts.size === before + 1,
      note: 'ghost ' + ghost + ', parts ' + before + '->' + a.assembly.parts.size,
    };
  })()`],

  ['scaling a selection keeps each part its own shape', `(() => {
    // The sliders set ONE size on all of them, which flattened an arm into a
    // row of identical cuboids. This is the thing people actually mean.
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    const one = a.assembly.addBlock(a.assembly.rootId, { pos: [0, 1, 0] }, 2, { size: [1, 0.5, 2] });
    const two = a.assembly.addBlock(a.assembly.rootId, { pos: [2, 1, 0] }, 2, { size: [0.5, 0.5, 0.5] });
    a.editor.rebuild();
    a.editor.select([one.id, two.id]);
    a.editor.scaleSelected(2);
    const ok = one.size.join() === '2,1,4' && two.size.join() === '1,1,1';
    return { ok, note: one.size.join('x') + ' and ' + two.size.join('x') };
  })()`],

  ['a limb comes out in one go', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    a.editor.select(a.assembly.rootId);
    const made = a.editor.addLimb('leg', { segments: 2 });
    const kinds = made.map((id) => a.assembly.get(id).kind).join(',');
    return { ok: kinds === 'bone,bone,block', note: kinds };
  })()`],

  ['pointing at the new parent re-hangs the part', `(() => {
    // Re-hanging used to need the id of the target, which is the one thing
    // the builder can see perfectly well by looking at the machine.
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    const host = a.assembly.addBlock(a.assembly.rootId, { pos: [3, 0, 0] }, 2, { size: [1, 1, 1] });
    const kid = a.assembly.addBlock(a.assembly.rootId, { pos: [0, 3, 0] }, 2, { size: [0.5, 0.5, 0.5] });
    a.editor.rebuild();
    a.editor.select(kid.id);
    a.editor.beginReparent();
    const armed = !!a.editor._awaitParent;

    // Look straight at the host, so the middle of the canvas is over it.
    const node = a.editor.rig.nodes.get(host.id);
    a.editor.rig.root.updateMatrixWorld(true);
    const target = node.group.getWorldPosition(a.editor.camera.position.clone());
    a.editor.camera.position.set(target.x, target.y, target.z + 6);
    a.editor.camera.lookAt(target);
    a.editor.camera.updateMatrixWorld(true);

    const c = a.editor.canvas;
    const r = c.getBoundingClientRect();
    const at = {
      clientX: r.left + c.clientWidth / 2,
      clientY: r.top + c.clientHeight / 2,
      button: 0, bubbles: true,
    };
    c.dispatchEvent(new PointerEvent('pointermove', at));
    c.dispatchEvent(new PointerEvent('pointerdown', at));
    window.dispatchEvent(new PointerEvent('pointerup', at));
    const now = a.assembly.get(kid.id).parent;
    return { ok: armed && now === host.id, note: 'armed ' + armed + ', parent ' + now };
  })()`],

  ['the shelf starts with usable parts on it', `(() => {
    const a = window.__blostom;
    const items = a.library.list();
    const built = items.filter((i) => i.builtin);
    const whole = built.every((i) => i.json && i.json.parts.length > 1);
    // And the picture drawn from one is not a blank square.
    const cv = document.querySelector('.libsketch');
    let ink = 0;
    if (cv) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
    }
    return {
      ok: built.length >= 3 && whole && ink > 20,
      note: built.length + ' starter parts, ' + ink + ' painted pixels',
    };
  })()`],

  ['the machine can be cut open and seen through', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('biped', { ask: false });
    const mats = () => a.editor.rig._ownedMaterials;
    a.editor.setSection('z', 0);
    const cut = mats().every((m) => (m.clippingPlanes || []).length === 1);
    const clipOn = a.renderer.localClippingEnabled;
    a.editor.setSeeThrough(true);
    const glass = mats().every((m) => m.transparent && m.opacity <= 0.34);
    // And a rebuild makes new materials, so the view has to survive one.
    a.editor.rebuild();
    const kept = mats().every((m) => m.opacity <= 0.34 && (m.clippingPlanes || []).length === 1);
    a.editor.setSeeThrough(false);
    a.editor.setSection(null);
    const back = mats().every((m) => m.opacity === m.userData.solidOpacity && !m.clippingPlanes);
    return {
      ok: cut && clipOn && glass && kept && back,
      note: 'cut ' + cut + ', glass ' + glass + ', survives rebuild ' + kept + ', restores ' + back,
    };
  })()`],

  ['a free placement lines up with the part beside it', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    a.editor.snap = true;
    // A neighbour whose right-hand face sits at an awkward number, nowhere
    // near the quarter-metre grid.
    const near = a.assembly.addBlock(a.assembly.rootId, { pos: [1.37, 2, 0] }, 2, { size: [1, 1, 1] });
    a.editor.rebuild();
    a.editor.rig.root.updateMatrixWorld(true);
    // Aiming just past its right face: the grid would say 2.0, the neighbour
    // says 2.37 — flush against it.
    const want = 1.37 + 0.5 + 0.25;              // flush against its right face
    const snapped = a.editor._snapToNeighbour([want + 0.06, 2, 0], [0.5, 0.5, 0.5]);
    // And out of reach it leaves the aim alone, so the grid still governs.
    const far = a.editor._snapToNeighbour([want + 0.4, 2, 0], [0.5, 0.5, 0.5]);
    return {
      ok: Math.abs(snapped.pos[0] - want) < 1e-6
        && Math.abs(far.pos[0] - (want + 0.4)) < 1e-6,
      note: 'x ' + snapped.pos[0].toFixed(3) + ' from ' + (want + 0.06).toFixed(3)
        + ', out of reach left at ' + far.pos[0].toFixed(3),
    };
  })()`],

  ['buried blocks can be found', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    const big = a.assembly.addBlock(a.assembly.rootId, { pos: [0, 3, 0] }, 2, { size: [2, 2, 2] });
    const inside = a.assembly.addBlock(big.id, { pos: [0, 0, 0] }, 3, { size: [0.4, 0.4, 0.4] });
    a.assembly.addBlock(a.assembly.rootId, { pos: [4, 3, 0] }, 3, { size: [0.4, 0.4, 0.4] });
    a.editor.rebuild();
    const found = a.editor.findBuried();
    // The one inside, and nothing else: a part swallowed by armour still
    // costs its weight and can still be shot.
    return {
      ok: found.length === 1 && found[0] === inside.id,
      note: found.length + ' found',
    };
  })()`],

  ['a part can be moved to another face without being rebuilt', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    const host = a.assembly.get(a.assembly.rootId);
    const kid = a.assembly.addBlockOnFace(host.id, 2, 3, { size: [0.5, 0.5, 0.5] });
    // Carve something into it, so "it kept what was in it" means something.
    kid.vox.brush(8, 8, 8, 3, 0);
    const carved = kid.vox.solid;
    a.editor.rebuild();
    a.editor.select(kid.id);
    a.editor.moveToFace(4);
    const now = a.assembly.get(kid.id);
    return {
      ok: now.mount.face === 4 && now.vox.solid === carved && now.mount.pos[2] > 0,
      note: 'face ' + now.mount.face + ', carving kept ' + (now.vox.solid === carved),
    };
  })()`],

  ['the gizmo can use the part own axes', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    // A part hung at an angle: on world axes its arrows point nowhere useful.
    const tilted = a.assembly.addBlock(a.assembly.rootId, { pos: [0, 2, 0] }, 2, {
      size: [1, 0.4, 0.4],
    });
    tilted.mount.rot = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
    a.editor.rebuild();
    a.editor.select(tilted.id);
    a.editor.setGizmoSpace('local');
    const local = a.editor.pivot.quaternion.clone();
    a.editor.setGizmoSpace('world');
    const world = a.editor.pivot.quaternion.clone();
    return {
      ok: Math.abs(local.z) > 0.3 && Math.abs(world.z) < 1e-6,
      note: 'local z ' + local.z.toFixed(3) + ', world z ' + world.z.toFixed(3),
    };
  })()`],

  ['carving follows the cursor and can be rounded off', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    const block = a.assembly.addBlock(a.assembly.rootId, { pos: [0, 2, 0] }, 2, { size: [1, 1, 1] });
    a.editor.rebuild();
    const vox = block.vox;
    const n = vox.n;
    const before = vox.solid;
    a.editor.brushRound = true;
    // The ordinary brush cuts cubes; a round cut takes strictly less.
    const r = 2;
    const mid = Math.floor(n / 2);
    vox.ball(mid, mid, mid, r, 0);
    const removed = before - vox.solid;

    // And the selection follows the cursor onto whatever block is under it,
    // so crossing onto the next one carves that one instead of nothing.
    const other = a.assembly.addBlock(a.assembly.rootId, { pos: [3, 2, 0] }, 2, { size: [1, 1, 1] });
    a.editor.rebuild();
    a.editor.select(block.id);
    a.setTool('carve');
    const node = a.editor.rig.nodes.get(other.id);
    a.editor.rig.root.updateMatrixWorld(true);
    const target = node.group.getWorldPosition(a.editor.camera.position.clone());
    a.editor.camera.position.set(target.x, target.y, target.z + 6);
    a.editor.camera.lookAt(target);
    a.editor.camera.updateMatrixWorld(true);
    const c = a.editor.canvas;
    const rect = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', {
      clientX: rect.left + c.clientWidth / 2,
      clientY: rect.top + c.clientHeight / 2,
      bubbles: true,
    }));
    const followed = a.editor.selected === other.id;

    return {
      ok: removed > 0 && removed < (2 * r + 1) ** 3 && followed,
      note: removed + ' cells removed, followed ' + followed,
    };
  })()`],

  ['leaving a paused fight does not leave the menu behind', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    a.pauseField();
    const paused = !document.getElementById('pause').classList.contains('hidden');
    a.goTitle();
    const stuck = !document.getElementById('pause').classList.contains('hidden');
    return { ok: paused && !stuck, note: 'shown ' + paused + ', stuck after title ' + stuck };
  })()`],
];

async function main() {
  const { preview } = await import('vite');
  const server = await preview({ root, preview: { port: 0, open: false }, logLevel: 'warn' });
  const base = server.resolvedUrls?.local?.[0] ?? '';
  const win = new BrowserWindow({
    show: false, width: 1280, height: 720, webPreferences: { backgroundThrottling: false },
  });

  const deadline = setTimeout(() => {
    console.error(red(`smoke: nothing finished within ${TIMEOUT_MS / 1000}s`));
    app.exit(1);
  }, TIMEOUT_MS);

  await win.loadURL(base);
  // The app boots on DOMContentLoaded; give it the frame it needs.
  await new Promise((r) => setTimeout(r, 1200));

  let bad = 0;
  for (const [name, js] of CHECKS) {
    let res;
    try {
      res = await win.webContents.executeJavaScript(js);
    } catch (e) {
      res = { ok: false, note: String(e?.message ?? e).slice(0, 90) };
    }
    if (res?.ok) console.log(`${green('ok  ')} ${name} ${dim(res.note ?? '')}`);
    else { bad++; console.error(`${red('FAIL')} ${name} — ${res?.note ?? 'no answer'}`); }
  }

  clearTimeout(deadline);
  console.log(bad ? red(`${CHECKS.length - bad}/${CHECKS.length} ok`)
    : green(`${CHECKS.length}/${CHECKS.length} ok`));
  await server.close();
  win.destroy();
  app.exit(bad ? 1 : 0);
}

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(() => main().catch((e) => {
  console.error(red(String(e?.stack ?? e)));
  app.exit(1);
}));

app.on('window-all-closed', () => {});
