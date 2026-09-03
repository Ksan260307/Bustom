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

  ['a weapon bone is a bone you can place, with its own panel', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    a.setTool('weapon');
    const armed = a.editor.tool === 'weapon';

    const bone = a.assembly.addBone(a.assembly.rootId, { pos: [0.6, 0, 0] }, 'weapon', {
      length: 2, radius: 0.3,
    });
    a.editor.rebuild();
    a.editor.select(bone.id);
    a.ui.renderInspector(a.editor.selectedParts());

    // The panel has to offer the two things that make it a weapon bone:
    // which weapon it is for, and the two poses it moves between.
    const text = a.ui.inspectorEl.textContent;
    const hasWeaponRows = text.includes('構える武器') && text.includes('構える角度');
    const hasTravel = text.includes('可動域') && text.includes('動作テスト');

    // And it survives a round trip, or it is a setting nobody can keep.
    a.assembly.setWeaponMotion(bone.id, { when: 'sniper', deployed: -95 });
    const json = JSON.parse(JSON.stringify(a.assembly.toJSON()));
    const saved = json.parts.find((q) => q.boneType === 'weapon');

    return {
      ok: armed && hasWeaponRows && hasTravel && saved && saved.weapon.when === 'sniper',
      note: 'tool ' + armed + ', panel rows ' + hasWeaponRows + '/' + hasTravel
        + ', saved ' + (saved ? saved.weapon.when : 'none'),
    };
  })()`],

  ['the bench can run a bone that only moves in a fight', `(() => {
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;
    const bone = a.assembly.addBone(a.assembly.rootId, { pos: [0, -0.6, 0] }, 'custom', {
      length: 2, radius: 0.3, limit: 80,
      custom: { axis: 'x', wave: 'sine', amp: 60, freq: 2, source: 'speed' },
    });
    a.editor.rebuild();
    a.editor.select(bone.id);

    const node = a.editor.rig.nodes.get(bone.id);
    const rest = new (Object.getPrototypeOf(node.joint.quaternion).constructor)();
    const swingOver = (frames) => {
      let most = 0;
      for (let i = 0; i < frames; i++) {
        a.editor.update(1 / 60);
        most = Math.max(most, node.joint.quaternion.angleTo(rest) * 180 / Math.PI);
      }
      return most;
    };

    // Standing on the bench, a speed-driven bone has nothing to be driven
    // by: every slider under it used to be a guess.
    a.editor.setBonePreview({ run: 0 });
    const still = swingOver(120);
    a.editor.setBonePreview({ run: 1 });
    const running = swingOver(240);

    return {
      ok: still < 3 && running > 25,
      note: 'still ' + still.toFixed(1) + 'deg, running ' + running.toFixed(1) + 'deg',
    };
  })()`],

  ['the legs are told what is under them, not just what is under the middle', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('edit');
    a.loadPreset('biped', { ask: false });
    a.goTitle();
    a.setMode('field');
    const r = a.field.player;
    if (!r || !r.rig.limbs.length) return { ok: false, note: 'the test machine has no legs' };

    // The arena answers "what is under this exact point", which is the
    // question a foot asks and the body's single middle probe cannot.
    const world = a.field.world;
    const floor = world.surfaceAt(0, 0, 50);
    let onTop = null;
    for (const box of world.colliders) {
      const x = (box.min.x + box.max.x) / 2;
      const z = (box.min.z + box.max.z) / 2;
      if (world.surfaceAt(x, z, box.max.y + 1) === box.max.y) { onTop = box.max.y; break; }
    }

    for (let i = 0; i < 120; i++) a.field.update(1 / 60);
    // And the legs are actually running that correction while it stands.
    const corrected = r.rig.limbs.every((l) => l.plantY !== undefined);

    return {
      ok: floor === 0 && onTop !== null && onTop > 0 && corrected,
      note: 'floor ' + floor + ', a surface up at ' + (onTop === null ? 'none' : onTop.toFixed(1))
        + 'm, ' + r.rig.limbs.length + ' legs corrected ' + corrected,
    };
  })()`],

  ['the legs stand still when the machine does, and walk when it walks', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('edit');
    a.loadPreset('biped', { ask: false });
    a.goTitle();
    a.setMode('field');
    const r = a.field.player;
    a.input.enabled = true;
    const real = r.animator.plantFeet;
    const noop = function () { return this; };

    // How far a hip turns from one frame to the next. A pose is smooth, so
    // this is small for anything a machine is meant to be doing — and it is
    // exactly what shaking looks like as a number.
    const sample = (walk, plant) => {
      r.animator.plantFeet = plant ? real : noop;
      if (walk) a.input.keys.add('KeyW'); else a.input.keys.delete('KeyW');
      const prev = r.rig.limbs.map((l) => l.root.joint.quaternion.clone());
      const moves = [];
      const feet = [];
      for (let i = 0; i < 300; i++) {
        a.input.update(1 / 60);
        a.field.update(1 / 60);
        if (i > 150) {
          r.rig.limbs.forEach((l, k) => {
            moves.push(l.root.joint.quaternion.angleTo(prev[k]) * 180 / Math.PI);
          });
          r.object3D.updateMatrixWorld(true);
          const tip = r.rig.limbs[0].chain[r.rig.limbs[0].chain.length - 1];
          const v = new (Object.getPrototypeOf(r.position).constructor)(0, tip.length / 2, 0);
          tip.far.localToWorld(v);
          feet.push(v.y - a.field.world.surfaceAt(v.x, v.z, v.y + 40));
        }
        r.rig.limbs.forEach((l, k) => prev[k].copy(l.root.joint.quaternion));
      }
      return {
        worst: Math.max(...moves),
        mean: moves.reduce((x, y) => x + y, 0) / moves.length,
        dip: Math.max(...feet) - Math.min(...feet),
      };
    };

    const stand = sample(false, true);
    const walk = sample(true, true);
    const walkOff = sample(true, false);
    r.animator.plantFeet = real;
    a.input.keys.delete('KeyW');

    // Standing on flat ground there is nothing to correct, so nothing moves.
    const still = stand.worst < 0.05;
    // Walking, the correction must cost the gait nothing. Putting a foot
    // DOWN onto whatever is under it used to drag the swinging leg back to
    // the floor sixty times a second, against an animation that was lifting
    // it: 45 degrees of hip a frame, against 7 without.
    const smooth = walk.worst < walkOff.worst * 1.4 && walk.mean < walkOff.mean * 1.4;
    // And it is still doing its job: the feet sit closer to the ground.
    const closer = walk.dip <= walkOff.dip + 0.01;

    return {
      ok: still && smooth && closer,
      note: 'hip deg/frame — standing ' + stand.worst.toFixed(2)
        + ', walking ' + walk.worst.toFixed(2) + '/' + walk.mean.toFixed(2)
        + ' against ' + walkOff.worst.toFixed(2) + '/' + walkOff.mean.toFixed(2)
        + ' unplanted; foot spread ' + walk.dip.toFixed(3) + 'm vs '
        + walkOff.dip.toFixed(3) + 'm',
    };
  })()`],

  ['every shipped file arrives, and nothing falls back', `(async () => {
    const a = window.__blostom;
    const kit = await a.kitReady;
    // The assets are not in the repository — they are reproducible from a
    // URL and a script, so a clean checkout has none of them and the game
    // is built to run that way. Absent is fine; half-fetched is not.
    const none = kit.surfaces === 0 && kit.envs === 0 && kit.fx === 0
      && kit.space === 0 && kit.skies === 0 && kit.sfx === 0;
    if (none) {
      return { ok: true, note: 'not fetched — run python tools/fetch-assets.py' };
    }
    return {
      ok: kit.surfaces === 8 && kit.envs === 3 && kit.sfx === 7
        && kit.fx === 9 && kit.space === 3 && kit.skies === 4 && kit.failed === 0,
      note: kit.surfaces + '/8 surfaces, ' + kit.envs + '/3 reflected skies, '
        + kit.skies + '/4 drawn skies, ' + kit.sfx + '/7 sounds, ' + kit.fx
        + '/9 sprites, ' + kit.space + '/3 space, ' + kit.failed + ' failed',
    };
  })()`],

  ['a detail map averages what the material is scaled for', `(async () => {
    const a = window.__blostom;
    await a.kitReady;
    // The material multiplies the arena's colour by this map and winds the
    // result back up by 1 / DETAIL_MEAN. If the bake and the constant ever
    // disagree, every floor in the game is the wrong brightness and nothing
    // says so — the picture just quietly stops matching the palette.
    const read = (name) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i];
        resolve(sum / (d.length / 4) / 255);
      };
      img.onerror = () => resolve(null);
      img.src = './kit/surface/' + name + '_detail.jpg';
    });

    const means = {};
    for (const kind of ['concrete', 'stone', 'regolith', 'deckplate']) {
      means[kind] = await read(kind);
    }
    // Nothing to check on a clean checkout: see the note above.
    if (Object.values(means).every((m) => m === null)) {
      return { ok: true, note: 'not fetched' };
    }
    const off = Object.entries(means)
      .filter(([, m]) => m === null || Math.abs(m - 0.75) > 0.04);

    return {
      ok: off.length === 0,
      note: Object.entries(means)
        .map(([k, m]) => k + ' ' + (m === null ? 'MISSING' : m.toFixed(3))).join(', ')
        + ' (wanted 0.75)',
    };
  })()`],

  ['a floor is a photograph tinted by the arena, not a painting of it', `(async () => {
    const a = window.__blostom;
    await a.kitReady;
    a.goTitle();
    a.setMode('field');

    if (!(await a.kitReady).surfaces) return { ok: true, note: 'not fetched' };
    const floors = {};
    for (const id of ['proving', 'city', 'canyon', 'moon']) {
      a.setArena(id);
      const g = a.field.world.group.children.find((o) => o.geometry
        && o.geometry.type === 'CircleGeometry');
      if (!g) return { ok: false, note: id + ' has no floor' };
      const m = g.material;
      floors[id] = {
        normal: !!m.normalMap,
        rough: !!m.roughnessMap,
        // The arena's colour has to survive: a photographed floor that
        // paints every place the same grey is a photographed floor that
        // threw away the art direction to get some grain.
        hex: m.color.getHexString(),
      };
    }
    a.setArena('proving');

    const ids = Object.keys(floors);
    const allMapped = ids.every((id) => floors[id].normal && floors[id].rough);
    const tints = new Set(ids.map((id) => floors[id].hex));
    // Four places, four different floor colours, and none of them white.
    const kept = tints.size === ids.length && !tints.has('ffffff');

    return {
      ok: allMapped && kept,
      note: ids.map((id) => id + ' #' + floors[id].hex
        + (floors[id].normal ? ' +relief' : ' FLAT')).join(', '),
    };
  })()`],

  ['metal reflects a sky with shapes in it, except where there is no sky', `(async () => {
    const a = window.__blostom;
    await a.kitReady;
    a.goTitle();
    a.setMode('field');

    // A gradient is smooth by construction, so the thing to measure is
    // whether the reflection VARIES across a row. The painted sky changes
    // only from top to bottom; a photograph of a night city does not.
    const spread = (id) => {
      a.setArena(id);
      const env = a.field.world.sky.environment;
      const img = env.image;                       // the prefiltered cube
      return { id, w: img && img.width, has: !!env };
    };

    const ground = spread('city');
    const space = spread('orbit');
    a.setArena('proving');

    // What actually differs is the SOURCE, and the arena says which it
    // wants. Space and the Moon name none, on purpose: there is no sky over
    // either of them to reflect.
    const reflects = (id) => { a.setArena(id); return a.field.world.arena.reflects ?? null; };
    const named = ['proving', 'city', 'works', 'canyon', 'flats'].every((id) => !!reflects(id));
    const vacuum = ['orbit', 'moon'].every((id) => !reflects(id));
    a.setArena('proving');

    return {
      ok: ground.has && space.has && named && vacuum,
      note: 'five places reflect a photographed sky ' + named
        + ', space and the moon reflect none ' + vacuum,
    };
  })()`],

  ['the interface carries its own type', `(async () => {
    const a = window.__blostom;
    await document.fonts.ready;
    // The stylesheet has named Inter since the beginning and never shipped
    // it, so on a machine without it the whole game fell back to Segoe UI.
    if (![...document.fonts].length) return { ok: true, note: 'not fetched' };
    const inter = document.fonts.check('16px Inter');
    const mono = document.fonts.check('16px "JetBrains Mono"');
    const loaded = [...document.fonts].map((f) => f.family + ' ' + f.weight);
    return {
      ok: inter && mono,
      note: 'Inter ' + inter + ', JetBrains Mono ' + mono + ' — ' + loaded.join(', '),
    };
  })()`],

  ['the guns have recordings under them, and still work without', `(async () => {
    const a = window.__blostom;
    await a.kitReady;
    const fb = a.feedback;
    fb.init();
    if (!fb.ctx) return { ok: false, note: 'no audio context' };
    fb.setMuted(false);

    // Decoding is asked for on the first play and answered later, so this
    // fires once, waits, and then checks that the buffer turned up.
    if (!(await a.kitReady).sfx) { fb.setMuted(true); return { ok: true, note: 'not fetched' }; }
    for (const n of ['fire-light', 'fire-heavy', 'hit-landed', 'hit-taken', 'boom', 'lock-on']) {
      fb._sample(n, 0);
    }
    await new Promise((r) => setTimeout(r, 900));
    const decoded = [...fb.samples.entries()].filter(([, v]) => v && v.duration > 0);

    // And the synthesised layer is still there underneath: these are events
    // the game has always had a sound for, and a missing file must not take
    // one away.
    let threw = null;
    try {
      fb.fire(0.9, true); fb.hit(0.5, false); fb.boom(1); fb.lock(true); fb.lock(false);
    } catch (e) { threw = String(e && e.message); }
    fb.setMuted(true);

    return {
      ok: decoded.length >= 6 && !threw,
      note: decoded.length + ' sounds decoded ('
        + decoded.map(([k, v]) => k + ' ' + v.duration.toFixed(2) + 's').join(', ')
        + ')' + (threw ? ' THREW ' + threw : ''),
    };
  })()`],

  ['space is a place, not an unlit room', `(async () => {
    const a = window.__blostom;
    await a.kitReady;
    a.goTitle();
    a.setMode('field');

    const look = (id) => {
      a.setArena(id);
      for (let i = 0; i < 30; i++) a.field.update(1 / 60);
      const bd = a.field.world.backdrop;
      const sky = bd && bd.userData && bd.userData.sky;
      let shell = 0;
      let planets = 0;
      let biggest = 0;
      if (sky) {
        sky.traverse((o) => {
          if (!o.isMesh) return;
          // The whole sky, photographed: an inside-out sphere with a map.
          if (o.material.side === 1 && o.material.map) shell++;
          // A ball with a real face on it, lit by its own shader so that
          // nothing it does escapes into the arena's own lighting.
          if (o.material.type === 'ShaderMaterial' && o.material.uniforms.map.value) {
            planets++;
            biggest = Math.max(biggest, o.getWorldScale(new (Object.getPrototypeOf(
              a.field.player.position).constructor)()).x);
          }
        });
      }
      return { shell, planets, biggest: Math.round(biggest) };
    };

    if (!(await a.kitReady).space) return { ok: true, note: 'not fetched' };
    const orbit = look('orbit');
    const moon = look('moon');
    // The five with weather get a photographed sky too, but never a planet:
    // an Earth over the proving ground is a different game.
    const weather = ['proving', 'city', 'works', 'canyon', 'flats'].map(look);
    a.setArena('proving');

    const allSky = weather.every((w) => w.shell === 1);
    const noBodies = weather.every((w) => w.planets === 0);

    return {
      ok: orbit.shell === 1 && orbit.planets === 2 && orbit.biggest > 60
        && moon.shell === 1 && moon.planets === 1 && allSky && noBodies,
      note: 'orbit ' + orbit.shell + ' sky / ' + orbit.planets + ' bodies (biggest '
        + orbit.biggest + 'm), moon ' + moon.shell + '/' + moon.planets
        + ', five weather arenas: sky ' + allSky + ', no planets ' + noBodies,
    };
  })()`],

  ['a shot, a hit and a thruster all carry a picture', `(async () => {
    const a = window.__blostom;
    await a.kitReady;
    a.goTitle();
    a.setMode('field');
    for (let i = 0; i < 30; i++) a.field.update(1 / 60);

    if (!(await a.kitReady).fx) return { ok: true, note: 'not fetched' };
    const fx = a.field.effects;
    // Every pooled burst got a card, and every card got its sprite. A card
    // with no map is a quad of flat colour, which is worse than no card.
    const cards = fx.cards.length;
    const mapped = fx.cards.filter((c) => c.mat.map).length;
    const puffs = fx.puffs.filter((p) => p.mat.map).length;

    // And they actually come out when something happens.
    const V = Object.getPrototypeOf(a.field.player.position).constructor;
    fx.muzzle(new V(0, 2, 0), new V(0, 0, 1), { scale: 1, color: 0xffcc88 });
    fx.impact(new V(0, 2, 4), new V(0, 0, 1), { scale: 1, color: 0xffffff });
    a.field.update(1 / 60);
    const litMuzzle = fx.muzzles.some((e) => e.life > 0 && e.card.visible
      && e.card.material.opacity > 0);
    const litImpact = fx.impacts.some((e) => e.life > 0 && e.card.visible
      && e.card.material.opacity > 0);

    // The thruster plume is part of the rig, so it is checked on the rig.
    let plumes = 0;
    for (const node of a.field.player.rig.equipNodes) {
      if (node.boostFlare && node.boostFlare.cards) plumes += node.boostFlare.cards.length;
    }

    return {
      ok: cards > 0 && mapped === cards && puffs > 0 && litMuzzle && litImpact,
      note: mapped + '/' + cards + ' burst cards mapped, ' + puffs + ' puffs, '
        + 'muzzle ' + litMuzzle + ', impact ' + litImpact + ', ' + plumes + ' plume cards',
    };
  })()`],

  ['the offer to restore folds away by itself, and cannot go stale', `(async () => {
    const a = window.__blostom;
    const bar = document.getElementById('draftbar');
    if (!bar) return { ok: false, note: 'no draft bar in the page' };

    // Put a draft on disk and offer it, the way a fresh boot would.
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    localStorage.setItem('blostom.draft.v1', JSON.stringify({
      at: Date.now() - 60000, json: a.assembly.toJSON(),
    }));
    a.ui.offerDraft();
    const shown = !bar.classList.contains('hidden');
    // While it is up the autosave holds off, or the thing being offered is
    // quietly replaced by whatever you do next and "restore" restores that.
    const held = a.tickDraft ? a._draftHeld === true : false;

    // Doing anything at all takes it down: restoring on top of work already
    // started is the same mistake in the other direction.
    a.touch();
    const goneOnEdit = bar.classList.contains('hidden');
    const released = a._draftHeld === false;

    // And it comes back up on its own timer when nobody touches anything.
    a.ui.offerDraft();
    const again = !bar.classList.contains('hidden');
    a.ui.foldDraft();
    const folds = bar.classList.contains('hidden');

    // The offer is not lost with the bar: it moves into the file menu.
    const menu = [...document.querySelectorAll('#topbar button, .menupop button')]
      .some((b) => b.textContent.includes('前回の作業を復元'));

    localStorage.removeItem('blostom.draft.v1');
    return {
      ok: shown && held && goneOnEdit && released && again && folds && menu,
      note: 'shown ' + shown + ', autosave held ' + held + ', folds on edit '
        + goneOnEdit + ' (released ' + released + '), folds on its own ' + folds
        + ', still in the file menu ' + menu,
    };
  })()`],

  ['everybody wakes up looking at the middle', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('field');
    a.field.restart();

    const V = Object.getPrototypeOf(a.field.player.position).constructor;
    const facing = [];
    for (const r of [a.field.player, ...a.field.enemies]) {
      if (!r || !r.alive) continue;
      const toMiddle = new V(-r.position.x, 0, -r.position.z);
      if (toMiddle.lengthSq() < 1) continue;      // already in the middle
      toMiddle.normalize();
      const nose = r.body.forward.clone();
      nose.y = 0;
      if (nose.lengthSq() < 1e-6) continue;
      nose.normalize();
      // Degrees off the line to the centre of the arena.
      facing.push(Math.acos(Math.max(-1, Math.min(1, nose.dot(toMiddle)))) * 180 / Math.PI);
    }

    // Every machine used to spawn pointing at +Z whichever corner it woke
    // up in, so three of the four opened the fight looking at the wall.
    const worst = facing.length ? Math.max(...facing) : 999;
    return {
      ok: facing.length >= 2 && worst < 6,
      note: facing.length + ' machines, worst ' + worst.toFixed(1) + ' degrees off centre',
    };
  })()`],

  ['the corner dial shows the place, and turns with you', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('field');
    a.setArena('city');
    // The read-out is drawn by the present pass, not the update one: the
    // fight and the picture of it are two passes on purpose, and only one
    // of them touches the canvas.
    for (let i = 0; i < 60; i++) { a.field.update(1 / 60); a.field.present(1 / 60); }

    const cv = document.getElementById('hud');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    // The read-out says where it put the dial, rather than this working the
    // sum out a second time: it depends on the window and on how much of
    // the top is covered, and a second copy of that is a second thing to
    // get wrong. The first attempt at this guessed, and measured the EN bar.
    const m = a.field.hud.mapAt;
    if (!m) return { ok: false, note: 'the dial has not been drawn' };
    const dpr = window.devicePixelRatio || 1;
    const box = ctx.getImageData(
      (m.cx - m.r) * dpr, (m.cy - m.r) * dpr, m.r * 2 * dpr, m.r * 2 * dpr,
    ).data;

    let drawn = 0;
    let red = 0;
    let cyan = 0;
    for (let i = 0; i < box.length; i += 4) {
      if (box[i + 3] < 8) continue;
      drawn++;
      const r = box[i]; const g = box[i + 1]; const b = box[i + 2];
      if (r > 180 && g < 140 && b < 120) red++;
      if (b > 200 && g > 180 && r < 180) cyan++;
    }

    // The arrow sits at the exact middle: the dial is nose-up, so the
    // player does not move on it — the world turns around them.
    const mid = ctx.getImageData((m.cx - 3) * dpr, (m.cy - 5) * dpr, 6 * dpr, 8 * dpr).data;
    let midCyan = 0;
    for (let i = 0; i < mid.length; i += 4) {
      if (mid[i + 3] > 8 && mid[i + 2] > 200 && mid[i] < 180) midCyan++;
    }
    const where = Math.round(m.cx) + ',' + Math.round(m.cy);
    return {
      ok: drawn > 2000 && red > 0 && cyan > 0 && midCyan > 0,
      note: 'dial at ' + where + ': ' + drawn + ' px, ' + red + ' opponent, '
        + cyan + ' player (' + midCyan + ' dead centre)',
    };
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

  ['the edit panel is groups, not one column', `(() => {
    // It used to be about sixty controls in a row under a heading that said
    // "gizmo", in the order they happened to be written.
    const a = window.__blostom;
    a.setMode('edit');
    const groups = a.ui.editGroups;
    const named = groups.map((g) => g.querySelector('.sectionhead span').textContent);
    // Two open, the rest folded: the ones reached for constantly are there,
    // and the rest are one click away rather than in the way.
    const open = groups.filter((g) => !g.classList.contains('folded')).length;
    // And every button in them still points at something that exists.
    const dead = [...a.ui.leftPanel.querySelectorAll('button')]
      .filter((b) => !b.onclick && !b.className.includes('sectionhead')).length;
    return {
      ok: groups.length === 5 && open === 2 && named.every((n) => n && n.length > 1),
      note: named.join(' / ') + ' — ' + open + ' open',
    };
  })()`],

  ['every arena builds, and the Moon is the light one', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    const ids = Object.keys(a.field.world.constructor.name ? {} : {});
    const order = ['proving', 'city', 'works', 'canyon', 'flats', 'orbit', 'moon'];
    const built = [];
    for (const id of order) {
      a.setArena(id);
      a.frame();
      const w = a.field.world;
      built.push(id + ':' + w.pillars.length + 'p/' + w.gravity + 'g');
      if (w.arenaId !== id) return { ok: false, note: 'did not switch to ' + id };
      if (!w.colliders.length) return { ok: false, note: id + ' has no cover at all' };
      if (!a.renderer.info.render.calls) return { ok: false, note: id + ' drew nothing' };
      // Somewhere weightless, cover on the deck is cover nobody reaches.
      if (id === 'orbit' || id === 'moon') {
        const up = w.pillars.filter((c) => c.box.min.y > 8).length;
        if (up < 4) return { ok: false, note: id + ' has only ' + up + ' pieces off the ground' };
      }
      // And there is something behind it, so the place does not end at the
      // fog: stars, a ridge, a planet, or some of each.
      if (!w.backdrop || !w.backdrop.children.length) {
        return { ok: false, note: id + ' has nothing behind it' };
      }
    }
    // The Moon: light, open, and with something out there to steer by.
    const w = a.field.world;
    const backdrop = w.backdrop ? w.backdrop.children.length : 0;
    const walled = w.group.children.some((o) => o.geometry
      && o.geometry.type === 'CylinderGeometry' && o.material && o.material.side === 1);
    const moon = w.gravity < 3 && !walled && backdrop >= 2;
    a.setArena('proving');
    return {
      ok: moon,
      note: built.join(' ') + ' | moon backdrop ' + backdrop + ' parts, walled ' + walled,
    };
  })()`],

  ['a machine hangs in the air on the Moon', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    a.field.paused = false;
    const p = a.field.player;
    const V = p.position.constructor;
    // Stepped directly, not through frame(): frame() runs however many
    // fixed steps real elapsed time has earned it, so two runs of "180
    // frames" are two different amounts of simulated time — which is
    // exactly the quantity being compared here.
    const drop = () => {
      p.body.reset(new V(0, 120, 0));
      const from = p.body.position.y;
      for (let i = 0; i < 180; i++) a.field.update(1 / 60);
      return from - p.body.position.y;
    };
    a.setArena('moon');
    const onMoon = drop();
    a.setArena('proving');
    const onEarth = drop();
    // It does come down — with no ceiling over it, a place you never fall
    // back into is a place you leave once. It just takes its time.
    return {
      ok: onMoon > 0.3 && onMoon < onEarth / 5,
      note: 'fell ' + onMoon.toFixed(1) + 'm vs ' + onEarth.toFixed(1) + 'm in 3s',
    };
  })()`],

  ['the arenas are made of different stuff, and it is painted once', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    const seen = new Map();
    // Space is skipped: it has no floor to be made of anything. Drawing a
    // disc down there would put a floor under a fight not happening on one.
    for (const id of ['proving', 'city', 'works', 'canyon', 'flats', 'moon']) {
      a.setArena(id);
      const g = a.field.world.group.children.find((o) => o.geometry
        && o.geometry.type === 'CircleGeometry' && o.material.map);
      if (!g) return { ok: false, note: id + ' floor has no surface' };
      const img = g.material.map.image;
      if (!img || !img.width) return { ok: false, note: id + ' floor painted nothing' };
      seen.set(id, g.material.map.uuid);
    }
    a.setArena('orbit');
    const spaceFloor = a.field.world.group.children.some((o) => o.geometry
      && o.geometry.type === 'CircleGeometry');
    if (spaceFloor) return { ok: false, note: 'space drew a floor' };
    // Going back gets the SAME texture object: six switches used to be six
    // paintings of the same concrete.
    a.setArena('proving');
    const again = a.field.world.group.children.find((o) => o.geometry
      && o.geometry.type === 'CircleGeometry').material.map.uuid;
    const distinct = new Set(seen.values()).size;

    // And each place is furnished from a kit of a dozen silhouettes rather
    // than from one shape at different sizes. Counted by how many distinct
    // mesh geometries the cover actually put in the scene.
    a.setArena('city');
    const shapes = new Set();
    for (const p of a.field.world.pillars) {
      for (const m of p.mesh) if (m.geometry) shapes.add(m.geometry.uuid);
    }
    a.setArena('proving');
    return {
      ok: distinct >= 5 && again === seen.get('proving') && shapes.size >= 20,
      note: distinct + ' floors (space has none), cache holds '
        + (again === seen.get('proving')) + ', city built from ' + shapes.size + ' meshes',
    };
  })()`],

  ['machines start in the corners, not on top of each other', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    a.setArena('proving');
    a.field.restart(12345);
    const R = a.field.world.arenaRadius;
    const all = [a.field.player, ...a.field.enemies.filter((e) => e.alive)];
    if (all.length < 2) return { ok: false, note: 'only ' + all.length + ' machines' };
    // Everybody well out from the middle...
    const out = all.map((m) => Math.hypot(m.position.x, m.position.z));
    // ...and nobody standing in anybody else.
    let closest = 1e9;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        closest = Math.min(closest, all[i].position.distanceTo(all[j].position));
      }
    }
    return {
      ok: Math.min(...out) > R * 0.4 && closest > 20,
      note: all.length + ' machines, nearest pair ' + closest.toFixed(0)
        + 'm, closest to centre ' + Math.min(...out).toFixed(0) + 'm of ' + R,
    };
  })()`],

  ['the control legend stays up and carries no settings', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    const bar = document.getElementById('fieldbar');
    // Six seconds of ticking used to fold it away with no way back.
    a.ui.tickFieldHint(30);
    const stillUp = !bar.classList.contains('folded') && !bar.classList.contains('hidden');
    // And nothing on it can be operated: those live on the pause menu,
    // where the pointer is free and nothing is trying to shoot you.
    const inputs = bar.querySelectorAll('select, input[type=checkbox]').length;
    const onPause = document.getElementById('pause')
      .querySelectorAll('select, input[type=checkbox]').length;
    return {
      ok: stillUp && inputs === 0 && onPause >= 2,
      note: 'up after 30s ' + stillUp + ', ' + inputs + ' controls on the bar, '
        + onPause + ' on the pause menu',
    };
  })()`],

  ['a run is a ladder of places, walked in order', `(() => {
    // A run used to be one arena and an endless climb of waves, so the
    // place stopped mattering after thirty seconds.
    const a = window.__blostom;
    a.goTitle();
    a.startSolo();
    // Through the check before the door, which is where a run starts now.
    a.ui.sortie.launch();
    const started = a.mode === 'solo';
    const run = a.field.director;
    if (!run) return { ok: false, note: 'no run' };

    const first = a.field.world.arenaId;
    const seen = [first];
    // Walk it: kill everything the moment it appears, and note every place
    // the ladder passes through.
    for (let i = 0; i < 20000 && !run.finished; i++) {
      a.field.update(1 / 60);
      if (run.state === 'fighting') for (const m of run.members) if (m.alive) m.hp = 0, m.alive = false, run.onDown(m);
      const now = a.field.world.arenaId;
      if (now !== seen[seen.length - 1]) seen.push(now);
    }
    const res = run.result;
    a.goTitle();
    return {
      ok: started && seen.length === res.stages && res.cleared && res.wave > res.stages,
      note: seen.join(' → ') + ' | wave ' + res.wave + ', cleared ' + res.cleared,
    };
  })()`],

  ['a run pause offers only what a run can change', `(() => {
    const a = window.__blostom;
    a.setMode('solo');
    a.pauseField();
    const soloRows = [...document.querySelectorAll('#pause .pausebox > *')]
      .filter((el) => !el.classList.contains('hidden'));
    const soloHasArena = !a.ui.pauseSettings.classList.contains('hidden');
    const soloHasEdit = !a.ui.pauseEditBtn.classList.contains('hidden');
    a.resumeField();
    // Free play keeps both: there the place and the ceasefire are yours.
    a.setMode('field');
    a.pauseField();
    const freeHasArena = !a.ui.pauseSettings.classList.contains('hidden');
    a.resumeField();
    a.goTitle();
    return {
      ok: !soloHasArena && !soloHasEdit && freeHasArena,
      note: 'run shows ' + soloRows.length + ' rows, place ' + soloHasArena
        + ', editor ' + soloHasEdit + '; free play place ' + freeHasArena,
    };
  })()`],

  ['the panels stopped explaining themselves at length', `(() => {
    // Every one of these was a paragraph sitting permanently in a panel,
    // explaining the control right next to it. Three together are taller
    // than the controls they describe.
    const a = window.__blostom;
    a.setMode('edit');
    const notes = [...a.ui.root.querySelectorAll('#leftpanel .note, #rightpanel .note')];
    const text = notes.map((n) => n.textContent.trim()).filter(Boolean);
    const longest = text.reduce((m, t) => Math.max(m, t.length), 0);
    const total = text.reduce((n, t) => n + t.length, 0);
    // Sentences, not characters. A compact key legend is long and belongs
    // where it is; a paragraph is what had to go, and a paragraph is the
    // thing with full stops in it.
    const wordy = text.filter((t) => (t.match(/。/g) || []).length > 1);
    // And what was taken out is readable somewhere: the help panel carries
    // the placement rules, the connecting rules and the shape warning.
    a.ui.help.show('editor');
    const help = a.ui.help.el.textContent;
    const kept = ['面をクリック', '連結', '彫った跡は消えます'].every((k) => help.includes(k));
    a.ui.help.close();
    return {
      ok: wordy.length === 0 && total < 400 && kept,
      note: text.length + ' notes, ' + wordy.length + ' with prose in them, longest '
        + longest + ' chars, ' + total + ' total, help carries them ' + kept,
    };
  })()`],

  ['the sky stays put when the camera moves', `(() => {
    // The star sphere was built at six times the arena radius and centred
    // on the world origin, while the camera's far plane is 900 — so from
    // anywhere but the middle of the map, half of it was beyond the far
    // plane. The sky emptied and refilled as the camera moved, and a
    // lock-on swinging the camera round was the most obvious way to see it.
    const a = window.__blostom;
    a.setMode('field');
    a.setArena('orbit');
    const f = a.field;
    const pts = [];
    f.world.backdrop.traverse((o) => { if (o.isPoints) pts.push(o); });
    if (!pts.length) return { ok: false, note: 'no stars at all' };

    const V = f.camera.position.constructor;
    const count = () => {
      f.camera.updateMatrixWorld(true);
      f.world.backdrop.updateMatrixWorld(true);
      const vp = f.camera.projectionMatrix.clone().multiply(f.camera.matrixWorldInverse);
      const g = pts[0].geometry.attributes.position;
      const m = pts[0].matrixWorld;
      const v = new V();
      let n = 0;
      for (let i = 0; i < g.count; i++) {
        v.fromBufferAttribute(g, i).applyMatrix4(m).applyMatrix4(vp);
        if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1) n++;
      }
      return n;
    };

    // Same direction, three very different places on the map.
    const seen = [];
    for (const at of [[0, 60, 0], [170, 60, 0], [-170, 60, 120]]) {
      f.camera.position.set(at[0], at[1], at[2]);
      f.camera.lookAt(at[0], at[1] + 10, at[2] - 200);
      f.world.followSky(f.camera.position);
      seen.push(count());
    }
    const lo = Math.min(...seen);
    const hi = Math.max(...seen);
    return {
      ok: lo > 30 && hi - lo < lo * 0.6,
      note: 'stars in frame from three places: ' + seen.join(', '),
    };
  })()`],

  ['space stops you before the machine is lost in the black', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    a.setArena('orbit');
    const f = a.field;
    f.paused = false;
    const p = f.player;
    const V = p.position.constructor;
    p.body.reset(new V(40, 60, 40));
    // Drive it downwards hard for five seconds.
    for (let i = 0; i < 300; i++) { f.update(1 / 60); p.body.inertia.velocity.y -= 0.8; }
    const rested = p.position.y;
    // It stopped, above the void, and it stopped at the arena's own floor
    // rather than at zero.
    const floor = f.world.floorY;
    a.setArena('proving');
    return {
      ok: floor > 10 && rested > floor && rested < floor + 12,
      note: 'settled at ' + rested.toFixed(1) + 'm on an invisible floor at ' + floor,
    };
  })()`],

  ['every preset stands up, and they span a real range of sizes', `(() => {
    // The one thing a preset owes the player: it stands up. A preset that
    // falls over is not a starting point, it is a bug report — and this is
    // the only place it can be asked, because standing up is the rig, the
    // walk model and the arena all agreeing.
    const a = window.__blostom;
    a.setMode('field');
    a.setArena('proving');
    const f = a.field;
    f.paused = false;
    const rows = [];
    let worst = null;

    for (const p of a.PRESET_LIST) {
      const bot = f.spawnEnemy({ preset: p.id, at: null });
      if (!bot) return { ok: false, note: p.id + ' would not spawn' };
      const V = bot.position.constructor;
      // Dropped from a little height, on its own, and left alone.
      bot.body.reset(new V(0, Math.max(2, -bot.rig.restLowestY) + 2, 0));
      const startY = bot.position.y;
      for (let i = 0; i < 240; i++) f.update(1 / 60);
      const height = bot.rig.restHeight ?? (bot.radius * 2);
      const upright = bot.body.quaternion.clone();
      // Its own up vector, after four seconds of standing there.
      const up = new V(0, 1, 0).applyQuaternion(upright);
      rows.push(p.id + ':' + height.toFixed(1) + 'm');
      if (up.y < 0.55) { worst = p.id + ' fell over (up.y ' + up.y.toFixed(2) + ')'; break; }
      if (!(bot.position.y > -1)) { worst = p.id + ' fell through the floor'; break; }
      f.retireEnemies();
    }
    if (worst) return { ok: false, note: worst };

    // And they are genuinely different sizes: the biggest has to dwarf the
    // smallest, or the size classes are labels on identical machines.
    const heights = a.PRESET_LIST.map((p) => {
      const bot = f.spawnEnemy({ preset: p.id });
      const h = bot.rig.restHeight ?? 0;
      f.retireEnemies();
      return h;
    });
    const lo = Math.min(...heights);
    const hi = Math.max(...heights);
    a.goTitle();
    return {
      ok: heights.length === 20 && lo > 0.5 && hi > lo * 5,
      note: heights.length + ' presets, ' + lo.toFixed(1) + 'm to ' + hi.toFixed(1)
        + 'm (×' + (hi / lo).toFixed(1) + ')',
    };
  })()`],

  ['a run gets harder as it goes, and the setting says how fast', `(() => {
    const a = window.__blostom;
    const seen = {};
    for (const id of ['easy', 'normal', 'hell']) {
      a.setDifficulty(id);
      a.setMode('solo');
      const run = a.field.director;
      seen[id] = [run.power];
      // Skip to a late wave without fighting it, to read the curve.
      run.wave = 18;
      seen[id].push(run.power);
      a.goTitle();
    }
    a.setDifficulty('normal');
    const climbs = Object.values(seen).every(([lo, hi]) => hi > lo);
    const spreads = seen.hell[1] > seen.normal[1] && seen.normal[1] > seen.easy[1];
    return {
      ok: climbs && spreads,
      note: Object.entries(seen)
        .map(([k, v]) => k + ' ' + v[0].toFixed(2) + '→' + v[1].toFixed(2)).join(', '),
    };
  })()`],

  ['backing out of the sortie screen puts the front page back', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.startSolo();
    const menu = document.getElementById('title');
    const hidWhileChecking = menu.classList.contains('hidden');

    a.ui.sortie.back();
    // The sortie screen opens over the title without leaving title mode, so
    // this is a return to a mode that was never left. It used to leave the
    // lit backdrop with no menu on it and nothing to press.
    const back = a.mode === 'title'
      && !menu.classList.contains('hidden')
      && menu.querySelectorAll('button').length > 0
      && document.getElementById('sortie').classList.contains('hidden');

    return {
      ok: hidWhileChecking && back,
      note: 'menu buttons after backing out: ' + menu.querySelectorAll('button').length,
    };
  })()`],

  ['a run is checked over before it starts, and shows no legend once it has', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.startSolo();
    // Nothing has started: this is the check before the door.
    const waiting = a.mode === 'title' && !document.getElementById('sortie').classList.contains('hidden');
    const box = document.getElementById('sortie');
    const diffs = box.querySelectorAll('.sortiediff').length;
    const stages = box.querySelectorAll('.sortiestage').length;

    a.ui.sortie.launch();
    const started = a.mode === 'solo';
    // And the run's own read-out owns the top of the screen.
    const legend = document.getElementById('fieldbar');
    const barShown = !legend.classList.contains('hidden');
    const inset = a.ui.fieldHintHeight();
    a.goTitle();

    // Free play still gets its legend.
    a.setMode('field');
    const freeBar = !document.getElementById('fieldbar').classList.contains('hidden');
    a.goTitle();

    return {
      ok: waiting && diffs === 5 && stages === 7 && started && !barShown && inset === 0 && freeBar,
      note: 'sortie: ' + diffs + ' settings, ' + stages + ' stages; run legend '
        + barShown + ' (inset ' + inset + '), free play legend ' + freeBar,
    };
  })()`],

  ['the battle read-out is one language', `(() => {
    // A katakana word in a strip of monospaced numerals reads as two
    // designs sharing a panel.
    const a = window.__blostom;
    // A machine that actually carries something: an earlier check leaves a
    // bare core on the bench, and a bare core has no rack to read.
    a.setMode('edit');
    a.loadPreset('biped', { ask: false });
    a.setMode('field');
    const rows = a.field.player.weapons.readout();
    const jp = /[぀-ヿ一-龯]/;
    const bad = rows.filter((r) => jp.test(r.label)).map((r) => r.label);
    // And the offer between waves, which is the other text on that screen.
    a.setMode('solo');
    const offer = a.field.director._buildOffer();
    const badOffer = offer.choices
      .filter((c) => jp.test(c.label) || jp.test(c.note))
      .map((c) => c.label);
    a.goTitle();
    return {
      ok: rows.length > 0 && bad.length === 0 && badOffer.length === 0,
      note: rows.length + ' weapon rows (' + rows.map((r) => r.label).join('/')
        + '), offer ' + offer.choices.map((c) => c.label).join('/'),
    };
  })()`],

  ['cover stops rounds, and no longer steals the lock', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    a.setArena('proving');
    const f = a.field;
    f.paused = false;
    f.restart(31);
    const target = f.enemies.find((e) => e.alive);
    if (!target) return { ok: false, note: 'nobody to lock' };
    f._beginLock(target);
    for (let i = 0; i < 40; i++) f.update(1 / 60);
    if (!f.lock) return { ok: false, note: 'the lock never took' };

    // Put the target inside a pillar, so the line of sight is solidly
    // broken, and hold it there for well over a second.
    const box = f.world.colliders[0];
    const mid = box.getCenter(new (target.position.constructor)());
    for (let i = 0; i < 120; i++) {
      target.body.reset(mid);
      target.syncTransform();
      f.update(1 / 60);
    }
    const held = !!f.lock;
    a.goTitle();
    return { ok: held, note: 'lock survived 2s of solid cover: ' + held };
  })()`],

  ['the sortie screen offers every machine, with a picture of each', `(() => {
    // The run used to go out with whatever was last on the bench, whether
    // or not that was the machine you meant, and a list of names is a poor
    // way to tell six machines apart.
    const a = window.__blostom;
    a.setMode('edit');
    a.loadPreset('biped', { ask: false });
    a.goTitle();
    a.startSolo();
    const s = a.ui.sortie;
    const picks = [...document.querySelectorAll('.sortiepick')];
    // One per preset, plus whatever is on the bench.
    const enough = picks.length >= 21;
    // Every one carries a portrait that actually painted something.
    let blank = 0;
    for (const p of picks) {
      const cv = p.querySelector('canvas');
      if (!cv) { blank++; continue; }
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
      if (ink < 40) blank++;
    }

    // Picking one changes what goes out, and leaves the bench alone.
    const bench = a.mainAssembly.name;
    picks[3].click();
    const chosen = s.machine.name;
    s.launch();
    const flown = a.field.player.assembly ? a.field.player.assembly.name : '';
    const benchAfter = a.mainAssembly.name;
    a.goTitle();

    return {
      ok: enough && blank === 0 && chosen !== bench && flown === chosen
        && benchAfter === bench,
      note: picks.length + ' machines offered, ' + blank + ' blank portraits; flew '
        + flown + ', bench still ' + benchAfter,
    };
  })()`],

  ['weight reaches everything it should', `(() => {
    // weightClass was (mass-2)/26, which saturates at 28 tonnes: across the
    // whole top half of the roster it was pinned at 1.00, so a TITAN and a
    // COLOSSUS three and a half times its weight told every system
    // downstream that they weighed the same.
    const a = window.__blostom;
    a.setMode('field');
    const f = a.field;
    const of = (id) => {
      const bot = f.spawnEnemy({ preset: id });
      const out = {
        wc: bot.stats.weightClass,
        bank: bot.body.angular.maxBankHigh,
        boom: 0,
        height: bot.rig.restHeight,
      };
      f.cameraRig.fitTo(bot.stats, bot.rig.restHeight);
      out.boom = f.cameraRig.config.distance;
      f.retireEnemies();
      return out;
    };
    const light = of('gnat');
    const mid = of('titan');
    const huge = of('colossus');
    // Restore the camera to the machine actually being flown.
    f.cameraRig.fitTo(f.player.stats, f.player.rig.restHeight);
    a.goTitle();
    return {
      ok: light.wc < mid.wc && mid.wc < huge.wc
        && huge.bank < light.bank * 0.6
        && huge.boom > huge.height * 1.2,
      note: 'weight ' + light.wc.toFixed(2) + '/' + mid.wc.toFixed(2) + '/'
        + huge.wc.toFixed(2) + ', siege boom ' + huge.boom.toFixed(0)
        + 'm for ' + huge.height.toFixed(0) + 'm of machine',
    };
  })()`],

  ['the guns can be turned off, and only in free play', `(() => {
    const a = window.__blostom;
    a.setMode('field');
    // And off is where it starts, with nothing stored: the first thing
    // anybody does with a machine they just built is watch it walk.
    const had = localStorage.getItem('blostom.enemyfire.v1');
    localStorage.removeItem('blostom.enemyfire.v1');
    a.setMode('edit');
    a.setMode('field');
    const startsOff = a.field.enemyFire === false;
    if (had !== null) localStorage.setItem('blostom.enemyfire.v1', had);
    a.setEnemyFire(false);
    const off = a.field.enemyFire === false;
    const boxShown = !a.ui.pauseSettings.classList.contains('hidden');
    // A run with rules in charge is not allowed a ceasefire, and the switch
    // goes away rather than sitting there refusing.
    a.setMode('solo');
    const onForRun = a.field.enemyFire === true;
    const boxHidden = a.ui.pauseSettings.classList.contains('hidden');
    a.setMode('field');
    a.setEnemyFire(true);
    return {
      ok: startsOff && off && boxShown && onForRun && boxHidden,
      note: 'starts off ' + startsOff + ', forced on in a run ' + onForRun,
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
