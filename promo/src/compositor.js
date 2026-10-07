// GPU compositor for the 2D layers: accumulates sub-frames for motion blur in
// float targets, blooms the light layer, adds it to the picture and finishes
// with a gentle vignette. No grain (the reference is clean), so type stays crisp.

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const vert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createCompositor(canvas, base, glow, { width = 1920, height = 1080, preserve = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.autoClear = false;
  const W = base.width;
  const H = base.height;
  const texOpts = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace; // display values, composited as-is
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  };
  const baseTex = texOpts(base);
  const glowTex = texOpts(glow);
  const rt = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
  const accBase = rt();
  const accGlow = rt();

  const add = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uW: { value: 1 } },
      vertexShader: vert,
      fragmentShader: /* glsl */ `uniform sampler2D tSrc; uniform float uW; varying vec2 vUv;
        void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uW, 1.0); }`,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1.0, 0.75, 0.0);

  const final = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tBase: { value: accBase.texture },
        tGlow: { value: accGlow.texture },
        uGlow: { value: 1 },
        uFlash: { value: 0 },
        uVignette: { value: 0.35 },
        uFade: { value: 1 },
      },
      vertexShader: vert,
      fragmentShader: /* glsl */ `uniform sampler2D tBase; uniform sampler2D tGlow; uniform float uGlow; uniform float uFlash; uniform float uVignette; uniform float uFade;
        varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tBase, vUv).rgb;
          vec3 l = texture2D(tGlow, vUv).rgb;
          // light adds like a screen: bright cores never clip harshly
          c = 1.0 - (1.0 - c) * (1.0 - clamp(l * uGlow, 0.0, 1.0));
          c += vec3(0.25, 0.42, 1.0) * uFlash;
          vec2 d = vUv - 0.5;
          c *= 1.0 - uVignette * smoothstep(0.3, 0.95, length(d * vec2(1.0, 0.85)) * 1.3);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0) * uFade, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const black = new THREE.Color(0, 0, 0);

  /** draw(k) paints sub-frame k into the 2D canvases; returns post settings for the frame. */
  function frame(samples, draw) {
    renderer.setClearColor(black, 1);
    renderer.setRenderTarget(accBase);
    renderer.clear();
    renderer.setRenderTarget(accGlow);
    renderer.clear();
    let post = {};
    for (let k = 0; k < samples; k++) {
      post = draw(k) || post;
      baseTex.needsUpdate = true;
      glowTex.needsUpdate = true;
      add.material.uniforms.uW.value = 1 / samples;
      add.material.uniforms.tSrc.value = baseTex;
      renderer.setRenderTarget(accBase);
      add.render(renderer);
      add.material.uniforms.tSrc.value = glowTex;
      renderer.setRenderTarget(accGlow);
      add.render(renderer);
    }
    bloom.strength = post.bloom ?? 0.75;
    bloom.radius = post.bloomRadius ?? 0.75;
    bloom.render(renderer, null, accGlow, 0, false);
    const u = final.material.uniforms;
    u.uGlow.value = post.glow ?? 1;
    u.uFlash.value = post.flash ?? 0;
    u.uVignette.value = post.vignette ?? 0.35;
    u.uFade.value = post.fade ?? 1;
    renderer.setRenderTarget(null);
    renderer.clear();
    final.render(renderer);
  }

  return { frame, renderer };
}
