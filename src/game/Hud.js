import * as THREE from 'three';

/** Scratch, so drawing the read-out allocates nothing per frame. */
const _right = new THREE.Vector3();
import { clamp01, damp, lerp } from '../zmf/math.js';
import { LOCK_COLOR } from '../core/constants.js';

// ============================================================
//  HUD : the lock-on reticle and the telemetry strip.
//
//  The reticle is deliberately a single thin blue circle. Everything
//  else around it — ticks, lead dot, acquisition ring — is thinner
//  still, so the circle stays the thing you actually read.
// ============================================================

const _ndc = new THREE.Vector3();

/**
 * How far down the run's read-out starts.
 *
 * Clear of the control legend that sits across the top of the field. That
 * legend folds away after a few seconds now, but it can be called back at
 * any moment, and a read-out that hides when you ask for help is no better
 * than one that was hidden all along.
 */
export const MISSION_TOP = 64;

/**
 * Where the run's read-out starts, given how much the control legend is
 * currently taking off the top.
 *
 * A fixed number cannot do this: the legend wraps to more lines in a narrow
 * window, so what clears it at 1440 across is underneath it at 900.
 */
export const missionTop = (inset = 0) => Math.max(MISSION_TOP, inset + 12);
const TAU = Math.PI * 2;

/**
 * When your own condition starts showing, and how loudly.
 *
 * Silent while healthy on purpose. A border that is always red is a border
 * nobody sees any more, and then it cannot tell you anything when it
 * matters.
 */
const VITALS = {
  /** Health fraction at which the frame begins to darken. */
  showBelow: 0.6,
  /** ...and at which it starts beating. */
  beatBelow: 0.3,
  /** How far in it reaches, as a fraction of the shorter screen edge. */
  depth: 0.16,
  alpha: 0.5,
};

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0; this.h = 0;
    this.time = 0;

    this.lockProgress = 0;   // 0..1 acquisition animation
    this.lockPulse = 0;
    this.visible = true;

    /** Seconds left on the "you just switched to X" banner. */
    this.weaponFlash = 0;
    this.weaponFlashLabel = '';

    /**
     * Marks for hits that have just landed on somebody else, and arcs for
     * ones that have just landed on us.
     *
     * A hit that only shows up as a number moving on a bar is a hit you do
     * not feel. These are the two halves of knowing it happened: WHERE the
     * one you landed went, and WHICH WAY the one you took came from.
     */
    this.marks = [];
    this.hurts = [];
  }

  /** A round of ours just connected, out there in the world. */
  markHit(world, weight = 0.5, killed = false) {
    if (this.marks.length >= 12) this.marks.shift();
    this.marks.push({ world: world.clone(), t: 0, life: killed ? 0.55 : 0.3, weight, killed });
    return this;
  }

  /** Something just hit US, from over there. */
  markHurt(world, weight = 0.5) {
    // One arc per direction rather than one per pellet: nine of them
    // stacked on the same bearing is a white smear, not a warning.
    for (const h of this.hurts) {
      if (h.world.distanceToSquared(world) < 36) {
        h.t = 0;
        h.weight = Math.min(1, h.weight + weight);
        return this;
      }
    }
    if (this.hurts.length >= 6) this.hurts.shift();
    this.hurts.push({ world: world.clone(), t: 0, life: 1.1, weight });
    return this;
  }

  /** Call it when the player cycles the set: the name pops, then fades. */
  flashWeapon(label) {
    this.weaponFlashLabel = label;
    this.weaponFlash = 1.1;
    return this;
  }

  /**
   * The right-hand diagnostics, as data. Pulled out of the draw call so the
   * contents can be asked about without reading pixels back off a canvas.
   * Takes the same state bag `draw` does, and nothing more: the HUD has
   * never needed the whole machine to say what it is showing.
   */
  debugRows(s) {
    const t = s.telemetry;
    // ZETA, JERK, ASSIST and FRAME are how the motion model is TUNED. They
    // belong on the practice field, where somebody is deliberately looking
    // at how the machine behaves — and nowhere near a run, where they are
    // six rows of numbers that mean nothing and sit where something useful
    // could be.
    const rows = s.diagnostics === false ? [] : [
      ['MASS', `${t.mass.toFixed(2)}`],
      ['ZETA', `${t.zeta.toFixed(2)}`],
      ['JERK', `${t.jerk.toFixed(0)}`],
      ['ASSIST', `${(t.assist * 100).toFixed(0)}%`],
      ['GROUND', `${(t.grounded * 100).toFixed(0)}%`],
      ['FRAME', `${(t.frameLock * 100).toFixed(0)}%`],
    ];
    // The gait is NOT reported. It is a category the code sorts machines
    // into so it knows which legs to swing; put it on screen and it becomes
    // a label the player builds toward. How many legs there are is a fact
    // about the parts, so that is what gets said.
    if ((s.legs ?? 0) > 0) rows.push(['LEGS', `${s.legs}`]);
    return rows;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  project(world, camera) {
    _ndc.copy(world).project(camera);
    return {
      x: (_ndc.x * 0.5 + 0.5) * this.w,
      y: (-_ndc.y * 0.5 + 0.5) * this.h,
      behind: _ndc.z > 1,
    };
  }

  /**
   * @param {object} s
   * @param {THREE.Camera} s.camera
   * @param {import('./Robot.js').Robot} s.player
   * @param {Array} s.targets            candidate robots
   * @param {object|null} s.lock         { robot, aimPoint }
   * @param {object} s.telemetry
   */
  draw(s, dt) {
    const ctx = this.ctx;
    this.time += dt;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.visible) return;

    // While a lock is being reached for, the ring shows how far along it
    // is rather than easing toward nothing: acquisition costs a moment now,
    // and a moment the player cannot see is a moment they think is a bug.
    const want = s.lock ? 1 : clamp01(s.locking ?? 0);
    this.lockProgress = s.locking
      ? want : damp(this.lockProgress, want, s.lock ? 0.07 : 0.05, dt);
    this.lockPulse = (this.lockPulse + dt * 0.35) % 1;
    this.weaponFlash = Math.max(0, this.weaponFlash - dt);

    this._drawSpeedLines(s, ctx);
    this._drawCandidates(s, ctx);
    if (s.lock) this._drawLock(s, ctx);
    this._drawCrosshair(s, ctx);
    this._drawHits(s, ctx, dt);
    this._drawTelemetry(s, ctx);
    this._drawWeapons(s, ctx);
    this._drawThreats(s, ctx);
    if (s.mission) this._drawMission(s.mission, ctx, s.topInset ?? 0);
    if (s.mission?.offer) this._drawOffer(s.mission.offer, ctx, s.player);
    // Last, over everything: how close you are to losing is not a detail to
    // be read past other details.
    this._drawVitals(s, ctx, dt);
  }

  /**
   * Who is shooting at you, and from where.
   *
   * The read-out only ever spoke about the machine that was LOCKED. With
   * six of them on the field the other five announced themselves by hitting
   * you, and the arc that says so arrives after the damage does. These are
   * the ones with a trigger down right now — a short list on purpose,
   * because a marker for every opponent is a ring of markers and says
   * nothing.
   */
  _drawThreats(s, ctx) {
    const list = s.threats;
    if (!list?.length || !s.camera) return;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const edge = Math.min(this.w, this.h) * 0.38;

    ctx.save();
    for (const bot of list) {
      if (bot === s.lock?.robot) continue;      // that one already has an arc
      _ndc.copy(bot.position).project(s.camera);
      let x = (_ndc.x * 0.5 + 0.5) * this.w;
      let y = (-_ndc.y * 0.5 + 0.5) * this.h;
      // Behind the camera comes back mirrored, which would point the marker
      // at exactly the wrong side of the screen.
      if (_ndc.z > 1) { x = this.w - x; y = this.h - y; }
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const at = Math.min(1, edge / d);
      const px = cx + dx * at;
      const py = cy + dy * at;

      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#ff6a5c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const a = Math.atan2(dy, dx);
      ctx.moveTo(px + Math.cos(a) * 7, py + Math.sin(a) * 7);
      ctx.lineTo(px + Math.cos(a + 2.5) * 7, py + Math.sin(a + 2.5) * 7);
      ctx.lineTo(px + Math.cos(a - 2.5) * 7, py + Math.sin(a - 2.5) * 7);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The choice on the table between waves.
   *
   * Number keys, like the title menu: it exists for three seconds and
   * nobody should have to find it in the key settings.
   */
  _drawOffer(offer, ctx, player = null) {
    const y = this.h * 0.62;
    const gap = 168;
    const x0 = this.w / 2 - gap;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9fc4dd';
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('つぎの ウェーブまでに ひとつ', this.w / 2, y - 52);

    // What the hull is at, in a number, and only here.
    //
    // During a fight the edge of the screen is the right way to know how
    // badly you are doing — it is read without looking away. But choosing
    // between armour and ammunition is not a fight, and it cannot be
    // answered by a feeling: it needs the figure.
    if (player?.maxHp) {
      const left = clamp01(player.hp / player.maxHp);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = left > 0.6 ? '#8effc9' : left > 0.3 ? '#ffd166' : '#ff6a5c';
      ctx.font = '700 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`装甲 ${Math.round(player.hp)} / ${player.maxHp}`, this.w / 2, y - 30);
    }

    offer.choices.forEach((c, i) => {
      const x = x0 + i * gap;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#4fd2ff';
      ctx.font = '700 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`${i + 1}`, x, y - 12);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#dff0ff';
      ctx.font = '700 17px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(c.label, x, y + 10);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#9fc4dd';
      ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(c.note, x, y + 26);
    });
    ctx.restore();
  }

  /**
   * Your own health, as the EDGE of the screen rather than a number.
   *
   * There used to be nothing at all — the reticle carried an arc for the
   * target's health and the player's own was nowhere, which was survivable
   * only for as long as nothing could shoot back.
   *
   * A number would be correct and useless: it sits somewhere specific, and
   * the whole point is to know how badly you are doing WITHOUT looking away
   * from the fight. The frame darkening and then beating is read out of the
   * corner of the eye, which is the only attention a fight has spare.
   */
  _drawVitals(s, ctx, dt) {
    const p = s.player;
    if (!p || !p.maxHp) return;
    const left = clamp01(p.hp / p.maxHp);
    // Nothing at all while healthy: a permanent red border is a border you
    // stop seeing, and then it cannot warn you of anything.
    const hurt = 1 - Math.min(1, left / VITALS.showBelow);
    this.vitalPulse = (this.vitalPulse ?? 0) + dt * lerp(2.2, 7.5, 1 - left);
    if (hurt <= 0.001) return;

    const beat = left < VITALS.beatBelow
      ? 0.55 + 0.45 * Math.sin(this.vitalPulse * TAU)
      : 1;
    const depth = Math.min(this.w, this.h) * VITALS.depth;
    const alpha = hurt ** 1.4 * VITALS.alpha * beat;

    for (const [x0, y0, x1, y1] of [
      [0, 0, 0, depth], [0, this.h, 0, this.h - depth],
      [0, 0, depth, 0], [this.w, 0, this.w - depth, 0],
    ]) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(255, 58, 48, ${alpha})`);
      g.addColorStop(1, 'rgba(255, 58, 48, 0)');
      ctx.fillStyle = g;
      if (x0 === x1) ctx.fillRect(0, Math.min(y0, y1), this.w, depth);
      else ctx.fillRect(Math.min(x0, x1), 0, depth, this.h);
    }
  }

  /**
   * Everything that says a hit happened: a mark where ours landed, an arc
   * for where theirs came from.
   *
   * Both are drawn in SCREEN space off a world position, so the mark sits on
   * the machine that took it and the arc points at the machine that fired
   * — and both keep working when the thing in question is off screen or
   * behind you, which is precisely when you need to be told.
   */
  _drawHits(s, ctx, dt) {
    const cam = s.camera;
    if (!cam) return;
    const cx = this.w / 2;
    const cy = this.h / 2;

    // ---- ours, landing on them
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t += dt;
      if (m.t >= m.life) { this.marks.splice(i, 1); continue; }
      const p = this.project(m.world, cam);
      if (p.behind) continue;
      const k = m.t / m.life;
      // Snaps out and fades: the shape carries the weight, the timing
      // carries the impact.
      const r = (7 + m.weight * 13) * (0.35 + k * 0.9);
      ctx.save();
      ctx.globalAlpha = (1 - k) ** 1.5;
      ctx.strokeStyle = m.killed ? '#ff8a6a' : '#ffffff';
      ctx.lineWidth = m.killed ? 2.6 : 1.6 + m.weight * 1.4;
      ctx.lineCap = 'round';
      // Four ticks around the point, angled: a cross reads as a reticle, an
      // X reads as a hit.
      const gap = r * 0.42;
      for (let a = 0; a < 4; a++) {
        const ang = Math.PI / 4 + a * (Math.PI / 2);
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(p.x + dx * gap, p.y + dy * gap);
        ctx.lineTo(p.x + dx * r, p.y + dy * r);
        ctx.stroke();
      }
      if (m.killed) {
        ctx.globalAlpha = (1 - k) ** 2 * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.25, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- theirs, landing on us
    for (let i = this.hurts.length - 1; i >= 0; i--) {
      const hrt = this.hurts[i];
      hrt.t += dt;
      if (hrt.t >= hrt.life) { this.hurts.splice(i, 1); continue; }
      const p = this.project(hrt.world, cam);
      // Behind the camera the projection flips, so the bearing has to be
      // turned back round or you get told to look the wrong way.
      const dx = (p.behind ? -1 : 1) * (p.x - cx);
      const dy = (p.behind ? -1 : 1) * (p.y - cy);
      const ang = Math.atan2(dy, dx);
      const k = hrt.t / hrt.life;
      const radius = Math.min(this.w, this.h) * 0.30;
      const half = 0.34;

      ctx.save();
      ctx.globalAlpha = (1 - k) ** 1.6 * (0.4 + hrt.weight * 0.6);
      ctx.strokeStyle = '#ff6a5c';
      ctx.lineWidth = 3 + hrt.weight * 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (1 + k * 0.12), ang - half, ang + half);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * The run: which wave, how many are left, the score and the lives.
   *
   * All of it lives along the TOP edge, because everything the player reads
   * while actually fighting — speed, energy, the rack — is already along the
   * bottom, and the middle belongs to the reticle.
   */
  _drawMission(m, ctx, inset = 0) {
    // Below the control legend, and all of it in one column.
    //
    // The wave sat top left and the score top right, which put both of them
    // under a panel that spans the screen — and scattered the four things a
    // run IS across two corners. One block, one place to look.
    const pad = 22;
    ctx.save();
    ctx.translate(0, missionTop(inset));

    // ---- wave and what is left of it, top left
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9fc4dd';
    ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('WAVE', pad, pad + 4);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#dff0ff';
    ctx.font = '700 26px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(String(m.wave).padStart(2, '0'), pad, pad + 30);

    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9fc4dd';
    ctx.fillText('のこり', pad + 58, pad + 18);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = m.remaining > 0 ? '#dff0ff' : '#8effc9';
    ctx.font = '700 16px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(String(m.remaining), pad + 58, pad + 34);

    // ---- score and lives, under the wave rather than across the screen
    const rx = pad + 132;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9fc4dd';
    ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('SCORE', rx, pad + 4);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#dff0ff';
    ctx.font = '700 22px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(m.score.toLocaleString('en-US'), rx, pad + 28);

    // Lives are pips rather than a number: how many tries you have left is
    // something to take in at a glance, not to read.
    const pips = Math.max(0, m.lives);
    for (let i = 0; i < Math.max(pips, 3); i++) {
      const on = i < pips;
      ctx.globalAlpha = on ? 0.95 : 0.22;
      ctx.fillStyle = '#4fd2ff';
      ctx.strokeStyle = '#9fc4dd';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(rx - i * 13 - 4, pad + 42, 4, 0, TAU);
      if (on) ctx.fill(); else ctx.stroke();
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ---- the banner: what just happened, briefly, where the eyes are
    if (m.banner) {
      const a = clamp01(m.bannerFade ?? 1);
      ctx.textAlign = 'center';
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = '#dff0ff';
      ctx.font = '700 34px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(m.banner, this.w / 2, this.h * 0.3);
    }

    ctx.restore();
  }

  /**
   * One row per fitted plate: name, magazine, and the reload creeping back.
   * Drawn in each weapon's own bullet colour, so the row you are watching is
   * the one whose tracers you can see.
   */
  _drawWeapons(s, ctx) {
    const list = s.weapons ?? [];
    if (!list.length) return;

    const pad = 22;
    const rowH = 20;
    const x = pad;
    const top = this.h - pad - 96 - list.length * rowH;
    let y = top;

    ctx.save();
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';

    for (const w of list) {
      const css = `#${w.color.toString(16).padStart(6, '0')}`;
      // Only one plate is wired to the trigger; the rest are a menu.
      const on = w.active;
      const fade = on ? 1 : 0.42;

      if (on) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = css;
        ctx.fillRect(x - 5, y - 13, 168, rowH - 2);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = css;
        ctx.fillText('\u25B8', x - 6, y);
      }

      ctx.globalAlpha = 0.9 * fade;
      ctx.fillStyle = css;
      ctx.beginPath();
      ctx.arc(x + 8, y - 3, on ? 3.5 : 2.6, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = (on ? 0.95 : 0.55) * 1;
      ctx.fillStyle = '#dff0ff';
      ctx.fillText(w.label, x + 18, y);

      if (w.melee) {
        ctx.globalAlpha = 0.45 * fade;
        ctx.fillText('接触', x + 100, y);
      } else if (w.reloading) {
        // The bar IS the wait: no number, just the thing filling back up.
        const bw = 62;
        ctx.globalAlpha = 0.2 * fade;
        ctx.fillStyle = '#dff0ff';
        ctx.fillRect(x + 100, y - 7, bw, 5);
        ctx.globalAlpha = 0.9 * fade;
        ctx.fillStyle = css;
        ctx.fillRect(x + 100, y - 7, bw * clamp01(w.reloadFrac), 5);
      } else {
        ctx.globalAlpha = 0.95 * fade;
        ctx.fillStyle = w.ammo > 0 ? '#dff0ff' : '#ff8a5c';
        ctx.fillText(`${w.ammo}`.padStart(2, ' '), x + 100, y);
        ctx.globalAlpha = 0.4 * fade;
        ctx.fillText(`/${w.max}`, x + 116, y);
      }
      y += rowH;
    }

    // ---- the switch banner, over the middle of the screen where the eyes are
    if (this.weaponFlash > 0 && this.weaponFlashLabel) {
      const a = clamp01(this.weaponFlash / 0.5);
      ctx.globalAlpha = a * 0.9;
      ctx.textAlign = 'center';
      ctx.font = '700 15px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#dff0ff';
      ctx.fillText(this.weaponFlashLabel, this.w / 2, this.h * 0.62);
      ctx.globalAlpha = a * 0.4;
      ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('WEAPON', this.w / 2, this.h * 0.62 - 16);
    }

    ctx.restore();
  }

  // ---------------------------------------------------------- reticle

  _drawCandidates(s, ctx) {
    for (const t of s.targets) {
      if (s.lock && t === s.lock.robot) continue;
      const p = this.project(t.position, s.camera);
      if (p.behind) continue;
      const r = this._screenRadius(t, s.camera, p);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = LOCK_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(9, r * 0.55), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  _screenRadius(target, camera, projected) {
    // Project a point offset by the target radius to get an honest size.
    const edge = target.position.clone().addScaledVector(camera.up, target.radius ?? 1.5);
    const pe = this.project(edge, camera);
    return Math.max(14, Math.hypot(pe.x - projected.x, pe.y - projected.y) * 1.45);
  }

  _drawLock(s, ctx) {
    const target = s.lock.robot;
    const p = this.project(target.position, s.camera);
    if (p.behind) { this._drawOffscreenChevron(s, ctx, target); return; }

    const r = this._screenRadius(target, s.camera, p);
    const prog = this.lockProgress;
    const ease = 1 - Math.pow(1 - prog, 3);

    ctx.save();
    ctx.lineCap = 'round';

    // --- acquisition ring: contracts onto the target, then fades out
    if (prog < 0.995) {
      const rr = lerp(r * 2.6, r, ease);
      ctx.globalAlpha = (1 - ease) * 0.85;
      ctx.strokeStyle = LOCK_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, TAU);
      ctx.stroke();
    }

    // --- the circle. Thin, blue, unadorned.
    ctx.globalAlpha = ease;
    ctx.strokeStyle = LOCK_COLOR;
    ctx.lineWidth = 1.35;
    ctx.shadowColor = LOCK_COLOR;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // --- four ticks, slowly counter-rotating
    const spin = this.time * 0.55;
    ctx.lineWidth = 1;
    ctx.globalAlpha = ease * 0.9;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * TAU) / 4;
      const inner = r * 1.16;
      const outer = r * 1.16 + 7;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * inner, p.y + Math.sin(a) * inner);
      ctx.lineTo(p.x + Math.cos(a) * outer, p.y + Math.sin(a) * outer);
      ctx.stroke();
    }

    // --- a sweeping arc: reads as "tracking", costs one stroke
    ctx.globalAlpha = ease * 0.55;
    ctx.lineWidth = 1.8;
    const sweep = this.lockPulse * TAU;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.16, sweep, sweep + 0.9);
    ctx.stroke();

    // --- lead indicator: where the assist actually wants you to shoot
    if (s.lock.aimPoint) {
      const a = this.project(s.lock.aimPoint, s.camera);
      if (!a.behind && Math.hypot(a.x - p.x, a.y - p.y) > 4) {
        ctx.globalAlpha = ease * 0.7;
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(a.x, a.y, 4.5, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = LOCK_COLOR;
        ctx.globalAlpha = ease * 0.35;
        ctx.fill();
      }
    }

    // --- range readout, hung off the circle
    ctx.globalAlpha = ease * 0.85;
    ctx.fillStyle = LOCK_COLOR;
    ctx.font = '500 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    const range = s.telemetry.range;
    if (Number.isFinite(range)) {
      ctx.fillText(`${range.toFixed(1)}m`, p.x + r * 1.16 + 10, p.y - 3);
      const closing = s.telemetry.closing;
      ctx.globalAlpha = ease * 0.5;
      ctx.fillText(`${closing >= 0 ? '-' : '+'}${Math.abs(closing).toFixed(1)}`, p.x + r * 1.16 + 10, p.y + 10);
    }

    // --- health arc on the target
    if (target.maxHp) {
      const frac = clamp01(target.hp / target.maxHp);
      ctx.globalAlpha = ease * 0.8;
      ctx.strokeStyle = frac > 0.35 ? LOCK_COLOR : '#ff6a5c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.3, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * frac);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawOffscreenChevron(s, ctx, target) {
    const v = target.position.clone().sub(s.camera.position);
    const right = _right.crossVectors(s.camera.up, v).normalize();
    const cx = this.w / 2, cy = this.h / 2;
    const side = -Math.sign(right.x) || 1;
    const x = cx + side * this.w * 0.34;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = LOCK_COLOR;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, cy, 13, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - side * 4, cy - 6);
    ctx.lineTo(x + side * 5, cy);
    ctx.lineTo(x - side * 4, cy + 6);
    ctx.stroke();
    ctx.restore();
  }

  _drawCrosshair(s, ctx) {
    const cx = this.w / 2, cy = this.h / 2;
    const t = s.telemetry;
    ctx.save();
    // Drawn dark first, then light on top.
    //
    // A one-pixel pale ring on a pale background is not a reticle, and the
    // background it most often has is the machine's own glowing core, which
    // sits exactly there. The dark ring underneath means the outline holds
    // against anything.
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#04080d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#cfe6ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.2, 0, TAU);
    ctx.stroke();

    // thrust arc around the crosshair — the machine's actual output
    if (t.thrust > 0.02) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = t.layer.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * clamp01(t.thrust));
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawSpeedLines(s, ctx) {
    // The shader owns the real speed lines; this is the horizon tell.
    const t = s.telemetry;
    if (t.speed < 22) return;
    const a = clamp01((t.speed - 22) / 26) * 0.20;
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25, this.w / 2, this.h / 2, this.h * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(120,200,255,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  // ---------------------------------------------------------- telemetry

  _drawTelemetry(s, ctx) {
    const t = s.telemetry;
    const pad = 22;
    const bottom = this.h - pad;

    ctx.save();
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';

    // ---- ABC layer badge
    const bx = pad, by = bottom - 74;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = t.layer.color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx + 0.5, by + 0.5, 40, 40);
    ctx.fillStyle = t.layer.color;
    ctx.globalAlpha = 0.13;
    ctx.fillRect(bx, by, 41, 41);
    ctx.globalAlpha = 1;
    ctx.font = '700 22px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t.layer.key, bx + 20, by + 28);
    ctx.font = '600 8px ui-monospace, Menlo, Consolas, monospace';
    ctx.globalAlpha = 0.65;
    ctx.fillText(t.layer.label, bx + 20, by + 50);

    // ---- speed
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#dff0ff';
    ctx.font = '700 30px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(t.speed.toFixed(1), bx + 56, by + 30);
    ctx.font = '600 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.globalAlpha = 0.5;
    ctx.fillText('m/s', bx + 56 + ctx.measureText(t.speed.toFixed(1)).width * 2.1, by + 30);

    // ---- energy bar
    //
    // As long as the tank is big. A machine carrying tanks holds more, and a
    // gauge that is always the same width says the opposite — it would look
    // like the fuel simply drains more slowly for no reason.
    const ex = bx + 56, ey = by + 40, eh = 5;
    const ew = 172 * Math.min(2, t.energyCapacity ?? 1);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(ex, ey, ew, eh);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = t.energy > 0.3 ? '#6fe3ff' : '#ff8a5c';
    ctx.fillRect(ex, ey, ew * clamp01(t.energy), eh);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#dff0ff';
    ctx.font = '600 8px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText('EN', ex, ey + 15);

    // ---- right-hand diagnostics
    ctx.textAlign = 'right';
    const rx = this.w - pad;
    const rows = this.debugRows(s);
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    rows.forEach(([k, v], i) => {
      const y = bottom - (rows.length - 1 - i) * 15;
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#9fc4dd';
      ctx.fillText(k, rx - 58, y);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#dff0ff';
      ctx.fillText(v, rx, y);
    });

    ctx.restore();
  }
}
