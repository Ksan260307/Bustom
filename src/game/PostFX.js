import * as THREE from 'three';

// ============================================================
//  ZMF §8.1 (Visual) : chromatic aberration along the thrust vector,
//  jerk-triggered radial speed lines, and a vignette.
//
//  One render target, one fullscreen pass. No composer dependency.
// ============================================================

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
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

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
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
    this.target.setSize(Math.floor(w * pr), Math.floor(h * pr));
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
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
