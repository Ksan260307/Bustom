import { clamp, clamp01, damp } from './math.js';
import { sfxBytes } from '../game/Kit.js';

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

    /**
     * Recorded one-shots, decoded on first use.
     *
     * The synthesised version stays underneath every one of these and is
     * what plays if a file is missing — the oscillators are the sound of
     * this game, and a sample is a body put on them. A shot is a click of
     * filtered noise plus a recording of a shot; either alone is thinner
     * than both.
     */
    this.samples = new Map();
    this.sampleGain = null;
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

    // A second bus for the things that HAPPEN. The drone above is driven
    // by numbers the physics produced and never starts or stops; an event
    // is the opposite of that, and mixing the two into one gain leaves no
    // way to hear a shot over your own engine.
    const events = ctx.createGain();
    events.gain.value = 0.9;
    events.connect(master);
    this.events = events;

    // Recorded one-shots go through their own trim, because they were
    // mastered by somebody else and arrive far hotter than the oscillators
    // this game builds for itself.
    const samples = ctx.createGain();
    samples.gain.value = 0.42;
    samples.connect(master);
    this.sampleGain = samples;
    this.noiseBuffer = buf;

    this.master = master;
    this.nodes = { oscA, oscB, filter, thrustGain, noiseFilter, noiseGain };
    this.enabled = true;
    return true;
  }

  // ---------------------------------------------------------- one-shots
  //
  //  Synthesised, not sampled. A shot is a noise burst through a filter
  //  that falls; an impact is the same burst, shorter and higher; an
  //  explosion is a long one with a sine thump under it. Three shapes cover
  //  a whole game's worth of events, they weigh nothing, and there is no
  //  audio file anywhere to go missing.
  //
  //  Every one of these is DECORATION: they read the fight and never touch
  //  it. Called with the sound off, or before the player has clicked
  //  anything, they return immediately.

  /** Is there anywhere for a sound to go right now? */
  get audible() { return !!(this.enabled && this.ctx && !this.muted); }

  /**
   * One burst of filtered noise.
   *
   * @param {object} o
   * @param {number} o.gain    peak, before the event bus
   * @param {number} o.from    filter cutoff at the attack, Hz
   * @param {number} o.to      ...and where it falls to
   * @param {number} o.life    seconds
   * @param {number} [o.q]     how tight the band is
   */
  _burst({ gain, from, to, life, q = 1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    // Start somewhere random in the buffer, or every shot is the same shot.
    const offset = Math.random() * (this.noiseBuffer.duration - life - 0.01);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + life);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + life);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.events);
    src.start(t, Math.max(0, offset));
    src.stop(t + life + 0.02);
    // Nothing is kept: the graph is collected once the source has stopped.
    src.onended = () => { g.disconnect(); filter.disconnect(); };
    return { t, g };
  }

  /** A sine that drops — the body under an explosion, or a heavy hit. */
  _thump({ gain, from, to, life }) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + life);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + life);

    osc.connect(g);
    g.connect(this.events);
    osc.start(t);
    osc.stop(t + life + 0.02);
    osc.onended = () => { g.disconnect(); };
  }

  /**
   * Something left a barrel.
   * @param {number} weight 0..1 — a pellet or a cannon
   * @param {boolean} mine  ours is brighter and louder; theirs sits behind it
   */
  fire(weight = 0.5, mine = true) {
    if (!this.audible) return;
    const w = clamp01(weight);
    this._burst({
      gain: (mine ? 0.20 : 0.10) * (0.55 + w * 0.7),
      from: 2600 - w * 1200,
      to: 320 - w * 160,
      life: 0.05 + w * 0.09,
      q: 0.7,
    });
    if (w > 0.5) this._thump({ gain: 0.14 * w, from: 160, to: 55, life: 0.10 + w * 0.1 });
    // A cannon gets the bang; a gatling gets the crack, pitched up so a
    // stream of them does not turn into a drum roll.
    this._sample(
      w > 0.5 ? 'fire-heavy' : 'fire-light',
      (mine ? 0.5 : 0.26) * (0.5 + w * 0.6),
      w > 0.5 ? 0.9 + w * 0.2 : 1.25 - w * 0.3,
    );
  }

  /** Something arrived. `mine` is a hit WE landed — the one worth hearing. */
  hit(weight = 0.5, mine = true) {
    if (!this.audible) return;
    const w = clamp01(weight);
    this._burst({
      gain: (mine ? 0.16 : 0.22) * (0.5 + w),
      from: 5200,
      to: 900 - w * 400,
      life: 0.035 + w * 0.05,
      q: 1.6,
    });
    // Being hit gets a body to it, so it is never mistaken for landing one.
    if (!mine) this._thump({ gain: 0.12 + w * 0.16, from: 220, to: 60, life: 0.16 });
    // Which end of it you are on is the thing worth hearing, so the two are
    // different recordings rather than the same one at two volumes.
    this._sample(
      mine ? 'hit-landed' : 'hit-taken',
      (mine ? 0.38 : 0.5) * (0.5 + w * 0.6),
      1.15 - w * 0.35,
    );
  }

  /** A machine came apart. */
  boom(size = 1) {
    if (!this.audible) return;
    const w = clamp01(size);
    this._burst({ gain: 0.26 * (0.6 + w), from: 1800, to: 90, life: 0.5 + w * 0.4, q: 0.5 });
    this._thump({ gain: 0.30 * (0.5 + w), from: 120, to: 28, life: 0.6 + w * 0.4 });
    // Bigger machines come apart lower down.
    this._sample('boom', 0.55 * (0.6 + w * 0.5), 1.15 - w * 0.35);
  }

  /**
   * Play a recorded one-shot, if one shipped for this event.
   *
   * Decoded the first time it is asked for rather than at boot: the bytes
   * arrive long before an AudioContext exists, because a context cannot be
   * made until the player has clicked something.
   *
   * The pitch wanders slightly on every play. Ten identical shots in two
   * seconds is the single most obvious way a sampled gun gives itself away,
   * and this is presentation — nothing here is replayed, so it is allowed
   * to differ between two runs of the same fight.
   *
   * @param {string} name   which file
   * @param {number} gain   0..1
   * @param {number} pitch  centre playback rate
   */
  _sample(name, gain, pitch = 1) {
    if (!this.audible || !this.sampleGain) return false;
    const ctx = this.ctx;

    let entry = this.samples.get(name);
    if (entry === undefined) {
      const bytes = sfxBytes(name);
      if (!bytes) { this.samples.set(name, null); return false; }
      // Decoding takes a copy: decodeAudioData is entitled to detach the
      // buffer it is given, and these bytes are wanted again next time.
      entry = null;
      this.samples.set(name, null);
      ctx.decodeAudioData(bytes.slice(0)).then((buf) => {
        this.samples.set(name, buf);
      }).catch(() => { this.samples.set(name, null); });
      return false;
    }
    if (!entry) return false;

    const src = ctx.createBufferSource();
    src.buffer = entry;
    src.playbackRate.value = pitch * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain();
    g.gain.value = clamp01(gain);
    src.connect(g);
    g.connect(this.sampleGain);
    src.start();
    src.onended = () => { g.disconnect(); };
    return true;
  }

  /** A target was acquired, or lost. Two notes, one order or the other. */
  lock(on = true) {
    if (!this.audible) return;
    if (this._sample(on ? 'lock-on' : 'lock-off', 0.32)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [i, f] of (on ? [880, 1320] : [1320, 660]).entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.055);
      g.gain.exponentialRampToValueAtTime(0.045, t + i * 0.055 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.055 + 0.07);
      osc.connect(g);
      g.connect(this.events);
      osc.start(t + i * 0.055);
      osc.stop(t + i * 0.055 + 0.09);
      osc.onended = () => { g.disconnect(); };
    }
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
