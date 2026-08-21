import * as THREE from 'three';
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
const TAU = Math.PI * 2;

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

    this.lockProgress = damp(this.lockProgress, s.lock ? 1 : 0, s.lock ? 0.07 : 0.05, dt);
    this.lockPulse = (this.lockPulse + dt * 0.35) % 1;

    this._drawSpeedLines(s, ctx);
    this._drawCandidates(s, ctx);
    if (s.lock) this._drawLock(s, ctx);
    this._drawCrosshair(s, ctx);
    this._drawTelemetry(s, ctx);
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
    const right = new THREE.Vector3().crossVectors(s.camera.up, v).normalize();
    const cx = this.w / 2, cy = this.h / 2;
    const side = -Math.sign(right.dot(new THREE.Vector3(1, 0, 0))) || 1;
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
    ctx.globalAlpha = 0.5;
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
    const ex = bx + 56, ey = by + 40, ew = 172, eh = 5;
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
    const rows = [
      ['MASS', `${t.mass.toFixed(2)}`],
      ['ZETA', `${t.zeta.toFixed(2)}`],
      ['JERK', `${t.jerk.toFixed(0)}`],
      ['ASSIST', `${(t.assist * 100).toFixed(0)}%`],
      ['GROUND', `${(t.grounded * 100).toFixed(0)}%`],
      ['FRAME', `${(t.frameLock * 100).toFixed(0)}%`],
      ['GAIT', s.gait.toUpperCase()],
    ];
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
