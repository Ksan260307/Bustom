import { clamp, clamp01, damp } from './math.js';

// ============================================================
//  ZMF §8 : Kinetic Feedback — Synesthesia Link
//    real-output-driven audio, jerk-driven rumble and visual noise.
//
//  Every channel is fed from the SAME two numbers the physics produced:
//  actual thrust output, and jerk. Nothing here is triggered by an event.
// ============================================================

export class KineticFeedback {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.nodes = null;
    this.muted = false;

    /** Visual channel, read by the renderer / HUD each frame. */
    this.visual = { chroma: 0, noise: 0, flash: 0 };
    this.rumble = 0;
  }

  /** Must be called from inside a user gesture. */
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // --- thruster: two detuned saws through a moving low-pass
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscB.detune.value = 11;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 3.2;

    const thrustGain = ctx.createGain();
    thrustGain.gain.value = 0;

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(thrustGain);
    thrustGain.connect(master);
    oscA.start();
    oscB.start();

    // --- strain: filtered noise that rises with jerk
    const bufferSize = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 900;
    noiseFilter.Q.value = 0.8;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    this.master = master;
    this.nodes = { oscA, oscB, filter, thrustGain, noiseFilter, noiseGain };
    this.enabled = true;
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.22;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.master && !this.muted) this.master.gain.value = 0.22;
  }

  suspend() {
    if (this.master) this.master.gain.value = 0;
  }

  /**
   * @param {object} s
   * @param {number} s.thrust  actual spool output, 0..1  (NOT the input)
   * @param {number} s.jerk    |d(accel)/dt|
   * @param {number} s.speed
   * @param {number} s.impact  0..1 one-shot
   * @param {number} s.strain  0..1 energy-limit proximity
   */
  update(s, dt) {
    const jerkN = clamp01(s.jerk / 300);

    // --- visual channel
    // Every input is clamped on the way in: these values are wired straight
    // into shader uniforms, so an out-of-range impact must not leak through.
    const impact = clamp01(s.impact ?? 0);
    const strain = clamp01(s.strain ?? 0);
    this.visual.chroma = damp(this.visual.chroma, clamp01(s.thrust * 0.85), 0.11, dt);
    this.visual.noise = damp(this.visual.noise, jerkN, 0.07, dt);
    this.visual.flash = damp(this.visual.flash, impact, 0.05, dt);
    // Haptics: jitter near the energy limit is promoted to a heavy rumble.
    this.rumble = damp(this.rumble, clamp01(jerkN * 0.7 + strain * 0.8 + impact), 0.08, dt);

    if (!this.enabled || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.nodes;

    // --- audio pitch bound directly to output: the machine tells you its load
    const base = 52 + s.thrust * 128 + clamp(s.speed, 0, 40) * 2.4;
    n.oscA.frequency.setTargetAtTime(base, t, 0.05);
    n.oscB.frequency.setTargetAtTime(base * 1.503, t, 0.05);
    n.filter.frequency.setTargetAtTime(320 + s.thrust * 2200 + s.speed * 42, t, 0.06);
    n.thrustGain.gain.setTargetAtTime(0.03 + s.thrust * 0.30, t, 0.05);

    n.noiseFilter.frequency.setTargetAtTime(600 + jerkN * 3400, t, 0.04);
    n.noiseGain.gain.setTargetAtTime(jerkN * 0.14 + impact * 0.35, t, 0.03);
  }
}
