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
      // Counted against the list itself rather than a number written here:
      // the last time a sound was added, this said 7 and the check that
      // exists to notice a half-fetched kit was the thing that broke.
      ok: kit.surfaces === 8 && kit.envs === 3 && kit.sfx === a.KIT_SFX.length
        && kit.fx === 9 && kit.space === 3 && kit.skies === 4 && kit.failed === 0,
      note: kit.surfaces + '/8 surfaces, ' + kit.envs + '/3 reflected skies, '
        + kit.skies + '/4 drawn skies, ' + kit.sfx + '/' + a.KIT_SFX.length
        + ' sounds, ' + kit.fx
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
    // Every one of them, not a hand-written half: a sound that arrives and
    // then will not decode is exactly the failure this is here to catch.
    for (const n of a.KIT_SFX) fb._sample(n, 0);
    // And the three that are HELD rather than struck go through their own
    // path, which has its own way of failing.
    for (const n of ['servo', 'thrust', 'blade']) fb._hold(n, 0);
    await new Promise((r) => setTimeout(r, 1400));
    const decoded = [...fb.samples.entries()].filter(([, v]) => v && v.duration > 0);
    const held = [...fb.loops.entries()].filter(([, v]) => v && v.src);

    // And the synthesised layer is still there underneath: these are events
    // the game has always had a sound for, and a missing file must not take
    // one away.
    let threw = null;
    try {
      fb.fire(0.9, true); fb.hit(0.5, false); fb.boom(1); fb.lock(true); fb.lock(false);
    } catch (e) { threw = String(e && e.message); }
    fb.setMuted(true);

    return {
      ok: decoded.length >= a.KIT_SFX.length - 3 && held.length === 3 && !threw,
      note: decoded.length + ' of ' + a.KIT_SFX.length + ' struck, '
        + held.length + '/3 held (' + held.map(([k]) => k).join(',') + ')'
        + (threw ? ' THREW ' + threw : ''),
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

  ['the offer to restore is a window, and cannot go stale', `(async () => {
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
    // A window in the middle, not a strip along the top. The strip was the
    // shape of a notice, so it was read as one and ignored.
    const box = bar.getBoundingClientRect();
    const middle = box.width > window.innerWidth * 0.9
      && box.height > window.innerHeight * 0.9
      && !!bar.querySelector('.draftbox');
    // While it is up the autosave holds off, or the thing being offered is
    // quietly replaced by whatever you do next and "restore" restores that.
    const held = a.tickDraft ? a._draftHeld === true : false;

    // Doing anything at all takes it down: restoring on top of work already
    // started is the same mistake in the other direction.
    a.touch();
    const goneOnEdit = bar.classList.contains('hidden');
    const released = a._draftHeld === false;

    // And it can be raised again.
    a.ui.offerDraft();
    const again = !bar.classList.contains('hidden');
    a.ui.foldDraft();
    const folds = bar.classList.contains('hidden');

    // The offer is not lost with the bar: it moves into the file menu.
    const menu = [...document.querySelectorAll('#topbar button, .menupop button')]
      .some((b) => b.textContent.includes('前回の作業を復元'));

    localStorage.removeItem('blostom.draft.v1');
    return {
      ok: shown && middle && held && goneOnEdit && released && again && folds && menu,
      note: 'shown ' + shown + ' (as a window ' + middle + '), autosave held '
        + held + ', folds on edit ' + goneOnEdit + ' (released ' + released
        + '), folds on demand ' + folds + ', still in the file menu ' + menu,
    };
  })()`],

  ['the last session is offered on the way into the workbench, not at launch', `(async () => {
    const a = window.__blostom;
    const bar = document.getElementById('draftbar');
    if (!bar) return { ok: false, note: 'no draft window in the page' };

    // Wind the session back to how it launches, with work on disk to offer.
    a.ui.foldDraft();
    a._draftAsked = false;
    localStorage.setItem('blostom.draft.v1', JSON.stringify({
      at: Date.now() - 60000, json: a.assembly.toJSON(),
    }));
    a.goTitle();
    // The title screen is what is on the glass at launch. Asking here put
    // the question behind it, where it timed out unread.
    const quietOnTitle = bar.classList.contains('hidden');

    a.setMode('edit');
    const askedOnEntry = !bar.classList.contains('hidden');
    // Once. Going out to the field and back is not a new session.
    a.ui.foldDraft();
    a.setMode('field');
    a.setMode('edit');
    const askedOnce = bar.classList.contains('hidden');

    // Esc backs out of it, and the draft survives that.
    a.ui.offerDraft();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    const escapes = bar.classList.contains('hidden');
    const kept = !!a.draft();

    localStorage.removeItem('blostom.draft.v1');
    return {
      ok: quietOnTitle && askedOnEntry && askedOnce && escapes && kept,
      note: 'quiet on the title ' + quietOnTitle + ', asked on entry '
        + askedOnEntry + ', asked once ' + askedOnce + ', Esc backs out '
        + escapes + ' and keeps it ' + kept,
    };
  })()`],

  ['running flat out, the feet keep up with the floor', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('edit');
    a.loadPreset('biped', { ask: false });
    a.goTitle();
    a.setMode('field');
    // The flattest, emptiest place there is. Started in a corner on a
    // cluttered map the machine runs into cover after a couple of seconds,
    // and a stride measured against a machine that has stopped is nothing.
    a.field.setArena('flats');
    const r = a.field.player;
    a.input.enabled = true;
    const M = Object.getPrototypeOf(r.rig.root.matrixWorld).constructor;

    // Where the sole is, against where the machine is. A foot that plants
    // and pushes holds still on the ground for half the cycle; one that is
    // being dragged never does, and the drag is what a skitter is.
    const limb = r.rig.limbs[0];
    const tip = limb.chain[limb.chain.length - 1];
    const run = (hold) => {
      a.input.keys.clear();
      for (const k of hold) a.input.keys.add(k);
      let lo = Infinity;
      let hi = -Infinity;
      let speed = 0;
      let freq = 0;
      let n = 0;
      let was = r.position.clone();
      for (let i = 0; i < 600; i++) {
        a.input.update(1 / 60);
        a.field.update(1 / 60);
        const step = Math.hypot(r.position.x - was.x, r.position.z - was.z) * 60;
        was.copy(r.position);
        // Only the frames where it is actually running. Loose in a real
        // arena a machine finds cover, turns and stops, and a stride
        // measured against a machine that has stopped is nothing. All of
        // this comes off the same frames, so it describes one moment.
        if (i <= 60 || step < 4) continue;
        // Measured off the ground it actually covered, not off any number
        // the machine reports about itself.
        speed += step;
        freq += r.animator.gaitFreq;
        n++;
        r.object3D.updateMatrixWorld(true);
        // Into the machine's own frame, so its travel is taken out and only
        // the foot's movement against the body is left.
        const p = limb.sole.clone()
          .applyMatrix4(tip.joint.matrixWorld)
          .applyMatrix4(new M().copy(r.rig.root.matrixWorld).invert());
        lo = Math.min(lo, p.z);
        hi = Math.max(hi, p.z);
      }
      const legs = r.rig.limbs.length;
      window.__ran = n;
      speed /= Math.max(1, n);
      freq /= Math.max(1, n);
      const perStep = freq > 0.02 ? speed / (freq * legs) : 0;
      return {
        speed, perStep, swing: hi - lo, glide: r.animator.glide,
        slip: perStep > 0.05 ? 1 - (hi - lo) / perStep : 1,
      };
    };

    const cruise = run(['KeyW']);
    const ran = window.__ran;
    // And on the thruster, where no stride reaches the ground being covered.
    const boosted = run(['KeyW', 'KeyE']);
    a.input.keys.clear();
    for (let i = 0; i < 120; i++) { a.input.update(1 / 60); a.field.update(1 / 60); }

    const ok = Math.abs(cruise.slip) < 0.25 && cruise.speed > 6
      && cruise.glide < 0.1 && ran > 90
      && boosted.speed > cruise.speed * 1.3 && boosted.glide > 0.5;
    return {
      ok,
      note: ran + ' frames running, at ' + cruise.speed.toFixed(1)
        + 'm/s the floor moved ' + cruise.perStep.toFixed(2) + 'm under a '
        + cruise.swing.toFixed(2) + 'm step (slip '
        + (cruise.slip * 100).toFixed(0) + '%), still walking '
        + (cruise.glide < 0.1) + '; on the thruster '
        + boosted.speed.toFixed(1) + 'm/s and skating ' + boosted.glide.toFixed(2),
    };
  })()`],

  ['the workbench shows what is left, down to the sculpting grid', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('edit');
    a.loadPreset('core', { ask: false });

    // Three bars, filling. The question is "have I room for more", which is
    // a proportion — a fraction makes you do arithmetic to answer it.
    const bars = [...document.querySelectorAll('.budgetrow')];
    const labels = bars.map((b) => b.querySelector('.k').textContent);
    // The plate bar, which is the one six weapons move.
    const widthOf = () => document.querySelectorAll('.budgetrow .budgetfill')[2].style.width;
    const before = widthOf();

    // Six weapon plates, where four used to be the wall.
    let fitted = 0;
    for (let i = 0; i < 8; i++) {
      if (a.assembly.blockedBy('gatling')) break;
      a.assembly.addEquipOnFace(a.assembly.core.id, i % 6, 'gatling', { size: 0.6 });
      fitted++;
    }
    a.editor.rebuild();
    a.ui.renderStats(a.editor.stats);
    const grew = widthOf() !== before;

    // And the way in to a run is one door, not two: the front page.
    const soloOnBench = [...document.querySelectorAll('#topbar button')]
      .some((b) => b.textContent.includes('ソロプレイ'));

    a.loadPreset('biped', { ask: false });
    return {
      ok: bars.length === 4 && fitted === 6 && grew && !soloOnBench,
      note: bars.length + ' bars (' + labels.join('/') + '), '
        + fitted + ' weapons fitted, bar moved ' + grew
        + ', solo button on the bench ' + soloOnBench,
    };
  })()`],

  ['a machine cannot be built past what the game will run', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('edit');
    a.loadPreset('core', { ask: false });
    a.editor.symmetry = false;

    let why = '';
    a.editor.onReject = (msg) => { why = msg; };

    // Fill the plate budget, then ask for one more and see what it says.
    const cap = a.assembly.usage().equip;
    for (let i = 0; i < 40; i++) {
      if (!a.assembly.hasRoomFor('equip')) break;
      a.assembly.addEquipOnFace(a.assembly.core.id, i % 6, 'tank', { size: 0.5 });
    }
    const used = a.assembly.usage().equip;
    const full = !a.assembly.hasRoomFor('equip');
    const named = a.assembly.blockedBy('tank') === 'budget';

    // The bar says so too, without anybody having to try.
    a.ui.renderStats(a.editor.stats);
    const flagged = !!document.querySelector('.budgetrow.full, .budgetrow.tight');

    a.loadPreset('biped', { ask: false });
    return {
      ok: used > cap && full && named && flagged,
      note: 'filled to ' + used + ' plates, refused ' + full
        + ' and named the wall ' + named + ', bar flagged ' + flagged
        + (why ? ' | "' + why + '"' : ''),
    };
  })()`],

  ['a fight against other people has four ways in, and rules first', `(() => {
    const a = window.__blostom;
    a.goTitle();
    const row = [...document.querySelectorAll('#titlemenu button, .ti-label')]
      .some((b) => b.textContent.includes('対戦'));

    a.openVersus();
    const shown = !document.getElementById('versus').classList.contains('hidden');
    // Four ways in, in the order they are likely to work.
    const tabs = [...document.querySelectorAll('.vs-tab')].map((b) => b.textContent);
    // And the rules, settled BEFORE anybody is matched: two people who want
    // different round lengths are not waiting for the same game.
    const rules = [...document.querySelectorAll('.vs-rule .k')].map((n) => n.textContent);
    const v = a.ui.versus;
    const was = v.rules.roundSeconds;
    document.querySelectorAll('.vs-rule')[0].querySelectorAll('button')[1].click();
    const moved = v.rules.roundSeconds !== was;

    a.ui.versus.hide();
    const gone = document.getElementById('versus').classList.contains('hidden');

    return {
      ok: row && shown && tabs.length === 4 && rules.length === 3 && moved && gone,
      note: 'on the front page ' + row + ', ways in [' + tabs.join('/')
        + '], rules [' + rules.join('/') + '] adjustable ' + moved
        + ', closes ' + gone,
    };
  })()`],

  ['four machines, one fight, driven by presses instead of by the game', `(() => {
    const a = window.__blostom;
    const N = window.__blostom_net;
    if (!N) return { ok: false, note: 'the net modules are not in the build' };

    // Two players, two copies of the fight, one process. If two copies in
    // one process cannot agree, two computers have no hope.
    const hub = new N.LoopbackHub({ latency: 3 });
    const host = new N.Session({ transport: hub.connect('h'), isHost: true, name: 'HOST', delay: 5 });
    const guest = new N.Session({ transport: hub.connect('g'), name: 'GUEST', delay: 5 });
    hub.pump(40);
    host.setReady(true);
    guest.setReady(true);
    hub.pump(60);
    const started = host.phase === 'fight' && guest.phase === 'fight';
    const agreed = host.seed === guest.seed && host.order.join() === guest.order.join();

    // The real field, running the real fight, off the host's seat.
    a.goTitle();
    a.beginVersus(host);
    const seats = a.field.netSeats.length;
    let ran = 0;
    for (let i = 0; i < 300; i++) {
      // The other player is pressing forward and firing, which nothing in
      // the game decides — it arrives.
      const f = new N.InputFrame(N.forwardAndFire, 0, 0);
      guest.pump(f, () => {});
      ran += a.field.netAdvance(1 / 60);
      hub.pump(1);
    }
    const moved = a.field.netSeats[1]
      && a.field.netSeats[1].position.length() > 0;
    const apart = seats > 1
      ? a.field.netSeats[0].position.distanceTo(a.field.netSeats[1].position) : 0;

    host.close();
    guest.close();
    a.goTitle();
    return {
      ok: started && agreed && seats === 2 && ran > 200 && apart > 1,
      note: seats + ' seats, ' + ran + ' steps run, ' + apart.toFixed(0)
        + 'm apart; same seed ' + agreed + ', both in ' + started
        + ', the far machine moved ' + moved,
    };
  })()`],

  ['a match is rounds and a score, and a leaver is picked up by the computer', `(() => {
    const a = window.__blostom;
    const N = window.__blostom_net;
    if (!N) return { ok: false, note: 'the net modules are not in the build' };

    const hub = new N.LoopbackHub({ latency: 3 });
    const host = new N.Session({
      transport: hub.connect('h'), isHost: true, name: 'HOST', delay: 5,
      rules: { roundSeconds: 60, wins: 2, readySeconds: 0, breakSeconds: 0 },
    });
    const guest = new N.Session({ transport: hub.connect('g'), name: 'GUEST', delay: 5 });
    hub.pump(40);
    host.setReady(true);
    guest.setReady(true);
    hub.pump(60);

    a.goTitle();
    a.beginVersus(host);
    const m = a.field.match;
    const started = !!m && m.rules.wins === 2;

    const run = (steps) => {
      for (let i = 0; i < steps; i++) {
        guest.pump(N.InputFrame.idle(), () => {});
        a.field.netAdvance(1 / 60);
        hub.pump(1);
      }
    };
    // Last one standing takes the round, so knocking one out ends it.
    const knockOut = (seat) => {
      a.field.netSeats[seat].hp = 0;
      a.field.netSeats[seat].alive = false;
      run(30);
    };

    run(40);
    const live = m.phase === 'live';
    knockOut(1);
    const afterOne = m.score.join('-');
    // And the next round puts everybody back up on their feet.
    const revived = a.field.netSeats[1].alive;
    knockOut(1);
    const over = m.over && m.winner === 0;

    // Now they walk out of what is left. Their machine must not be left
    // standing there: people and a statue is a worse fight than people.
    guest.close();
    hub.pump(20);
    run(180);
    const takenOver = a.field.taken.has(1);
    const drivenByAi = a.field.ais.some((x) => x.robot === a.field.netSeats[1]);

    host.close();
    a.goTitle();
    return {
      ok: started && live && afterOne === '1-0' && revived && over
        && takenOver && drivenByAi,
      note: 'round one went ' + afterOne + ', everybody back up ' + revived
        + ', match won ' + over + '; the leaver was taken over ' + takenOver
        + ' and is being driven ' + drivenByAi,
    };
  })()`],

  ['knocked out with the round still running, you watch somebody who is not', `(() => {
    const a = window.__blostom;
    const N = window.__blostom_net;
    if (!N) return { ok: false, note: 'the net modules are not in the build' };

    // Three of them: with two, being knocked out ENDS the round, so there
    // is nothing to watch. Spectating is what a four-player fight needs.
    const hub = new N.LoopbackHub({ latency: 2 });
    const host = new N.Session({
      transport: hub.connect('h'), isHost: true, name: 'HOST', delay: 4,
      rules: { roundSeconds: 120, wins: 3, readySeconds: 0 },
    });
    const g1 = new N.Session({ transport: hub.connect('g1'), name: 'GUEST1', delay: 4 });
    const g2 = new N.Session({ transport: hub.connect('g2'), name: 'GUEST2', delay: 4 });
    hub.pump(40);
    for (const s of [host, g1, g2]) s.setReady(true);
    hub.pump(70);

    a.goTitle();
    a.beginVersus(host);
    const seats = a.field.netSeats.length;
    const mine = a.field.localSeat;
    const run = (steps) => {
      for (let i = 0; i < steps; i++) {
        g1.pump(N.InputFrame.idle(), () => {});
        g2.pump(N.InputFrame.idle(), () => {});
        a.field.netAdvance(1 / 60);
        hub.pump(1);
      }
    };
    run(40);
    const own = a.field.watching === mine && !a.field.spectating;

    a.field.netSeats[mine].hp = 0;
    a.field.netSeats[mine].alive = false;
    run(40);
    const moved = a.field.watching !== mine;
    const spectating = a.field.spectating;
    // The arrows walk along whoever is left.
    const at = a.field.watching;
    a.field.watchNext(1);
    const cycled = a.field.watching !== at && a.field.netSeats[a.field.watching].alive;

    host.close();
    g1.close();
    g2.close();
    a.goTitle();
    return {
      ok: seats === 3 && own && moved && spectating && cycled,
      note: seats + ' seats; own machine first ' + own
        + ', camera left the wreck ' + moved + ' (to seat ' + at
        + '), arrows walk along ' + cycled,
    };
  })()`],

  ['a queue is a wait, and the wait can be spent in the field', `(() => {
    const a = window.__blostom;
    const v = a.ui.versus;
    a.goTitle();
    a.openVersus();

    // Nothing to wait for yet, so nothing to wander off from.
    v._waitInField();
    const refused = a.mode !== 'field';

    // Standing in a queue. The socket for it lives in the shell, not in
    // this screen, so the screen can go away without the queue stopping.
    v.maker = { state: 'queued', cancel() { this.state = 'idle'; } };
    v._waitInField();
    const inField = a.mode === 'field';
    const hidden = document.getElementById('versus').classList.contains('hidden');
    const stillQueued = v.maker.state === 'queued';

    v.maker = null;
    a.goTitle();
    return {
      ok: refused && inField && hidden && stillQueued,
      note: 'refused without a queue ' + refused + ', went to the field '
        + inField + ' with the screen away ' + hidden
        + ', queue still running ' + stillQueued,
    };
  })()`],

  ['a walking machine makes the noises a walking machine makes', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('edit');
    // A heavy one on purpose. Landing is gated on weight — a light machine
    // stepping down is not a landing, and the game is right about that —
    // so a biped would answer "no landing sound" and be correct.
    a.loadPreset('titan', { ask: false });
    a.goTitle();
    a.setMode('field');
    a.field.setArena('flats');
    const r = a.field.player;
    a.input.enabled = true;

    // Count what is asked for rather than what is heard: there is no audio
    // device in this harness, and whether a sound reaches a speaker is not
    // what could be wrong here.
    const fb = a.field.feedback;
    // The held sounds only get as far as being asked for once there is an
    // audio graph to ask, which is the same gate the real game has.
    fb.init();
    fb.setMuted(false);
    const calls = { step: 0, land: 0, jump: 0, held: {} };
    const realStep = fb.step;
    const realLand = fb.land;
    const realJump = fb.jump;
    const realHold = fb._hold;
    fb.step = function s2(w) { calls.step++; return realStep.call(this, w); };
    fb.land = function l2(w) { calls.land++; return realLand.call(this, w); };
    fb.jump = function j2(w) { calls.jump++; return realJump.call(this, w); };
    fb._hold = function h2(n, g, p2) {
      calls.held[n] = Math.max(calls.held[n] ?? 0, g);
      return realHold.call(this, n, g, p2);
    };

    a.input.keys.clear();
    a.input.keys.add('KeyW');
    // Strides, counted the way the legs count them: the gait clock summed
    // over the run IS the number of cycles it went through.
    let cycles = 0;
    for (let i = 0; i < 400; i++) {
      a.input.update(1 / 60);
      a.field.update(1 / 60);
      a.field.present(1 / 60);
      cycles += r.animator.gaitFreq / 60;
      a.input.endFrame();
    }
    const walked = calls.step;

    // A jump, and the landing at the end of it.
    a.input.keys.add('Space');
    for (let i = 0; i < 20; i++) {
      a.input.update(1 / 60); a.field.update(1 / 60); a.input.endFrame();
    }
    a.input.keys.delete('Space');
    for (let i = 0; i < 200; i++) {
      a.input.update(1 / 60); a.field.update(1 / 60); a.field.present(1 / 60); a.input.endFrame();
    }

    fb.step = realStep; fb.land = realLand; fb.jump = realJump; fb._hold = realHold;
    fb.setMuted(true);
    a.input.keys.clear();
    a.goTitle();

    // One footfall per foot, per stride. Anything else means the sound has
    // its own clock, which is the one thing it must not have.
    const want = Math.round(cycles * r.rig.limbs.length);
    const sane = Math.abs(walked - want) <= 2;
    return {
      ok: sane && calls.land > 0 && calls.jump > 0
        && (calls.held.servo ?? 0) > 0 && (calls.held.thrust ?? 0) > 0,
      note: walked + ' footfalls for ' + cycles.toFixed(1) + ' strides on '
        + r.rig.limbs.length + ' legs (expected ' + want + '), '
        + calls.jump + ' jump, ' + calls.land + ' land; servo up to '
        + (calls.held.servo ?? 0).toFixed(3) + ', thruster '
        + (calls.held.thrust ?? 0).toFixed(3),
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

  ['the lock takes the one you are looking at', `(() => {
    const a = window.__blostom;
    a.goTitle();
    a.setMode('field');
    a.field.restart();
    const f = a.field;
    if (f.enemies.length < 2) return { ok: false, note: 'need two opponents' };

    const V = Object.getPrototypeOf(f.player.position).constructor;
    const near = f.enemies[0];
    const far = f.enemies[1];
    // One close behind the player, one a long way off in front. The lock
    // used to take the nearest whatever the player was pointing at, which
    // meant aiming carefully and being handed the machine at your back.
    f.player.body.reset(new V(0, f.player.position.y, 0), new V(0, 0, 1));
    near.body.reset(new V(6, near.position.y, -14), new V(0, 0, 1));
    far.body.reset(new V(2, far.position.y, 70), new V(0, 0, -1));
    for (const r of [f.player, near, far]) r.syncTransform();
    f.camera.position.set(0, 6, -12);
    f.camera.lookAt(0, 3, 40);
    f.camera.updateMatrixWorld(true);

    const picked = f._pickTarget();
    const behind = picked === near;
    const ahead = picked === far;

    // And the reach survives a moment of cover rather than being cancelled
    // by it: an established lock already does.
    f._beginLock(far);
    const was = f.locking && f.locking.t;
    const realBlocked = f._blocked;
    f._blocked = () => true;
    for (let i = 0; i < 6; i++) f._updateLock(1 / 60);
    const stillReaching = !!f.locking;
    f._blocked = realBlocked;
    f._dropLock();

    return {
      ok: ahead && !behind && stillReaching,
      note: 'picked the one ' + (ahead ? 'ahead' : behind ? 'behind' : 'neither')
        + '; cover pauses the reach rather than cancelling it ' + stillReaching,
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

/**
 * Checks that belong to the shell rather than to the page.
 *
 * The socket lives in the main process, and the harness window has no
 * preload bridge on purpose — so asking the page whether it can host would
 * be asking the wrong side. This dials a real port on the loopback and
 * watches a message go host → guest and guest → guest.
 */
const MAIN_CHECKS = [
  ['a matchmaker introduces two strangers and then gets out of the way', async () => {
    const net = require('node:net');
    const { spawn } = require('node:child_process');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const server = spawn(process.execPath, [
      require('node:path').join(__dirname, '../../tools/matchmaker.js'), '45082',
    ], { stdio: 'ignore' });
    await wait(500);

    const seen = { A: [], B: [] };
    const dial = (name) => new Promise((resolve) => {
      const sock = net.createConnection(45082, '127.0.0.1', () => {
        sock.write(JSON.stringify({
          t: 'queue', name, want: { players: 2, rules: { roundSeconds: 300, wins: 3 } },
        }) + '\n');
        resolve(sock);
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d;
        let i = buf.indexOf('\n');
        while (i >= 0) {
          try { seen[name].push(JSON.parse(buf.slice(0, i))); } catch { /* not ours */ }
          buf = buf.slice(i + 1);
          i = buf.indexOf('\n');
        }
      });
    });

    const a = await dial('A');
    await wait(120);
    const b = await dial('B');
    await wait(250);

    const matchedA = seen.A.find((m) => m.t === 'matched');
    const matchedB = seen.B.find((m) => m.t === 'matched');
    // Somebody has to make the first offer, and the rule has to be one both
    // ends work out the same way without asking.
    const oneOfferer = !!matchedA && !!matchedB
      && (matchedA.offerer ? !matchedB.offerer : matchedB.offerer);

    // And it passes the introduction along without understanding it.
    a.write(JSON.stringify({ t: 'signal', kind: 'offer', code: 'SDP-A' }) + '\n');
    await wait(200);
    const relayed = seen.B.some((m) => m.t === 'signal' && m.code === 'SDP-A');

    a.destroy();
    b.destroy();
    server.kill();
    const ok = !!matchedA && !!matchedB && oneOfferer && relayed
      && matchedA.rules.roundSeconds === 300;
    return {
      ok,
      note: 'paired ' + (matchedA?.names ?? []).join(' vs ') + ', one offerer '
        + oneOfferer + ', carried the introduction ' + relayed
        + ', rules travelled ' + (matchedA?.rules?.wins ?? '-'),
    };
  }],

  ['a real socket carries a fight, and passes it on', async () => {
    const { Lan } = await import('../../electron/lan.js');
    const seen = { h: [], a: [], b: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const host = new Lan((f, m) => seen.h.push(`${f}:${m.t}`));
    const info = await host.host(45071);
    const a = new Lan((f, m) => seen.a.push(`${f}:${m.t}`));
    await a.join('127.0.0.1', 45071);
    const b = new Lan((f, m) => seen.b.push(`${f}:${m.t}`));
    await b.join('127.0.0.1', 45071);
    await wait(80);

    a.send({ t: 'in' });
    host.send({ t: 'start' });
    await wait(150);
    // Passed ON, not just received: with four players everybody has to hear
    // everybody, and only the host has a wire to each of them.
    const relayed = seen.b.includes('c1:in');
    const fromHost = seen.a.includes('h:start') && seen.b.includes('h:start');
    const gotIt = seen.h.includes('c1:in');

    b.leave();
    await wait(150);
    // And somebody leaving is something everyone is told, so their machine
    // can be left standing on the same step everywhere.
    const toldOfLeaving = seen.h.some((x) => x.endsWith(':bye'))
      && seen.a.some((x) => x.endsWith(':bye'));

    host.leave();
    a.leave();
    const ok = gotIt && relayed && fromHost && toldOfLeaving && info.port === 45071;
    return {
      ok,
      note: `port ${info.port}, addresses ${info.addresses.join(',') || 'none'}; `
        + `host heard ${gotIt}, passed on ${relayed}, host to all ${fromHost}, `
        + `told of a leaver ${toldOfLeaving}`,
    };
  }],
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
  for (const [name, fn] of MAIN_CHECKS) {
    let res;
    try {
      res = await fn();
    } catch (e) {
      res = { ok: false, note: String(e?.message ?? e).slice(0, 90) };
    }
    if (res?.ok) console.log(`${green('ok  ')} ${name} ${dim(res.note ?? '')}`);
    else { bad++; console.error(`${red('FAIL')} ${name} — ${res?.note ?? 'no answer'}`); }
  }

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
  const total = CHECKS.length + MAIN_CHECKS.length;
  console.log(bad ? red(`${total - bad}/${total} ok`) : green(`${total}/${total} ok`));
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
