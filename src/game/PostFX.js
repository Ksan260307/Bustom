import * as THREE from 'three';

// ============================================================
//  ZMF §8.1 (Visual) : bloom, chromatic aberration along the thrust vector,
//  jerk-triggered radial speed lines, and a vignette.
//
//  The scene is drawn once into an HDR target and resolved once to the
//  screen. Between those two, the bright parts are split off and blurred:
//  this game is mostly dark, and almost everything that matters in it —
//  beams, tracers, thruster flames, blade glow, explosions — is a light
//  source. Without bloom those read as flat coloured shapes; with it they
//  read as light.
//
//  Deliberately hand-rolled rather than pulled from three's examples: the
//  whole chain is four small passes, and owning them keeps this file the
//  single place the look is decided. No composer dependency.
// ============================================================

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Keep only what is brighter than the threshold, with a soft knee. */
const BRIGHT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  // Soft knee: a hard cut makes the bloom pop on and off as things drift
  // past the threshold, which reads as flicker.
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float w = max(soft, l - uThreshold) / max(l, 1e-5);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

/**
 * One axis of a Gaussian blur. Separable, so two of these give a 2D blur
 * for a fraction of the samples a single 2D kernel would need.
 */
const BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uStep;          // one texel along the axis being blurred
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
  c += texture2D(tDiffuse, vUv + uStep * 1.3846).rgb * 0.316216;
  c += texture2D(tDiffuse, vUv - uStep * 1.3846).rgb * 0.316216;
  c += texture2D(tDiffuse, vUv + uStep * 3.2308).rgb * 0.070270;
  c += texture2D(tDiffuse, vUv - uStep * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloomA;  // wide, soft halo
uniform sampler2D tBloomB;  // tight core glow
uniform float uBloom;      // 0..1 overall strength
uniform vec2  uDir;        // screen-space thrust direction
uniform float uChroma;     // 0..1
uniform float uLines;      // 0..1  speed-line intensity
uniform float uNoise;      // 0..1  jerk grain
uniform float uFlash;      // 0..1  impact flash
uniform float uTime;
uniform float uVignette;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 c  = uv - 0.5;
  float r = length(c) * 2.0;

  // --- chromatic aberration, biased along the direction of thrust
  vec2 off = (uDir * 0.5 + normalize(c + 1e-5) * 0.5) * uChroma * (0.0008 + r * 0.0024);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + off).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - off).b;

  // --- bloom, two scales at once: a tight glow right around the source
  // and a wide halo well beyond it. One blur radius can be one or the
  // other, never both, and light does both.
  if (uBloom > 0.001) {
    vec3 tight = texture2D(tBloomB, uv).rgb;
    vec3 wide  = texture2D(tBloomA, uv).rgb;
    col += (tight * 0.55 + wide * 0.38) * uBloom;
  }

  // --- radial speed lines: only near the edge, only under jerk
  if (uLines > 0.001) {
    float ang = atan(c.y, c.x);
    float streak = hash(vec2(floor(ang * 190.0), floor(uTime * 14.0)));
    float band = smoothstep(0.80, 1.35, r);
    float line = smoothstep(0.93, 1.0, streak) * band * uLines;
    col += vec3(0.55, 0.78, 1.0) * line * 0.32;
  }

  // --- jerk grain
  if (uNoise > 0.001) {
    float n = hash(uv * 512.0 + uTime * 60.0) - 0.5;
    col += n * uNoise * 0.09;
  }

  // --- impact flash
  col = mix(col, vec3(1.0, 0.94, 0.86), uFlash * 0.42);

  // --- vignette
  col *= 1.0 - uVignette * smoothstep(0.55, 1.35, r);

  gl_FragColor = vec4(col, 1.0);

  // The scene was rendered into a linear HDR target, which skips three's
  // tone mapping and output encoding. This pass is what finally lands on the
  // screen, so it has to do both — without these two chunks the whole game
  // renders as un-encoded linear light, i.e. far too dark.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Half-float colour target, no depth — what every bloom step draws into. */
function bloomTarget(w, h) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  t.texture.generateMipmaps = false;
  return t;
}

export class PostFX {
  constructor(renderer, { bloom = 0.85 } = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.bloomStrength = bloom;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      // MSAA on the offscreen target. `antialias: true` on the canvas does
      // nothing once the scene is drawn into a target instead, which is why
      // every edge in the game used to be a staircase.
      samples: 4,
    });

    // ---- bloom chain, three sizes deep.
    //
    // The bright pass runs at HALF resolution and the blurs at a quarter and
    // an eighth. Bright-passing straight into a quarter would skip texels and
    // make thin bright things — a beam, a tracer — sparkle as they move; one
    // clean halving first is what stops that. The blurs then work on a
    // sixteenth of the pixels, which is where the cost goes.
    this.bright = bloomTarget(size.x / 2, size.y / 2);
    this.bloomA = [bloomTarget(size.x / 4, size.y / 4), bloomTarget(size.x / 4, size.y / 4)];
    this.bloomB = [bloomTarget(size.x / 8, size.y / 8), bloomTarget(size.x / 8, size.y / 8)];

    this.brightUniforms = {
      tDiffuse: { value: this.target.texture },
      uThreshold: { value: 1.05 },
      uKnee: { value: 0.35 },
    };
    this.brightMaterial = new THREE.ShaderMaterial({
      uniforms: this.brightUniforms,
      vertexShader: VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.blurUniforms = {
      tDiffuse: { value: null },
      uStep: { value: new THREE.Vector2() },
    };
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: this.blurUniforms,
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      tBloomA: { value: this.bloomB[0].texture },   // wide halo, 1/8
      tBloomB: { value: this.bloomA[0].texture },   // tight glow, 1/4
      uBloom: { value: bloom },
      uDir: { value: new THREE.Vector2(0, 0) },
      uChroma: { value: 0 },
      uLines: { value: 0 },
      uNoise: { value: 0 },
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uVignette: { value: 0.30 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    const dw = Math.max(1, Math.floor(w * pr));
    const dh = Math.max(1, Math.floor(h * pr));
    this.target.setSize(dw, dh);
    this.bright.setSize(Math.max(1, dw >> 1), Math.max(1, dh >> 1));
    for (const t of this.bloomA) t.setSize(Math.max(1, dw >> 2), Math.max(1, dh >> 2));
    for (const t of this.bloomB) t.setSize(Math.max(1, dw >> 3), Math.max(1, dh >> 3));
  }

  /** How much light spills. 0 turns the whole chain off, cost included. */
  setBloom(amount) {
    this.bloomStrength = Math.max(0, amount);
    this.uniforms.uBloom.value = this.bloomStrength;
    return this;
  }

  /** Draw the fullscreen quad with `material` into `target` (null = screen). */
  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Bright-pass the frame, then blur it twice at two scales. Both blurs are
   * separable — horizontal into one buffer, vertical back into the other —
   * so the whole chain is five small draws over a quarter of the pixels.
   */
  _bloom() {
    if (this.bloomStrength <= 0) return;
    const blur = (src, pair, radius) => {
      const w = pair[0].width;
      const h = pair[0].height;
      this.blurUniforms.tDiffuse.value = src;
      this.blurUniforms.uStep.value.set(radius / w, 0);
      this._pass(this.blurMaterial, pair[1]);
      this.blurUniforms.tDiffuse.value = pair[1].texture;
      this.blurUniforms.uStep.value.set(0, radius / h);
      this._pass(this.blurMaterial, pair[0]);
    };

    this.brightUniforms.tDiffuse.value = this.target.texture;
    this._pass(this.brightMaterial, this.bright);
    blur(this.bright.texture, this.bloomA, 1.0);
    blur(this.bloomA[0].texture, this.bloomB, 1.4);
  }

  /** @param {{chroma:number, lines:number, noise:number, flash:number, dir:THREE.Vector2}} v */
  set(v, time) {
    this.uniforms.uChroma.value = v.chroma ?? 0;
    this.uniforms.uLines.value = v.lines ?? 0;
    this.uniforms.uNoise.value = v.noise ?? 0;
    this.uniforms.uFlash.value = v.flash ?? 0;
    this.uniforms.uTime.value = time;
    if (v.dir) this.uniforms.uDir.value.copy(v.dir);
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);

    this._bloom();

    this.quad.material = this.material;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.bright.dispose();
    for (const t of [...this.bloomA, ...this.bloomB]) t.dispose();
    this.material.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.quad.geometry.dispose();
  }
}
