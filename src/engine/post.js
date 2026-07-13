import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Cinematic post pipeline: temporal trails (afterimage) -> HDR bloom ->
// final grade (tone curve, chromatic aberration, whiteout flash, grain,
// vignette). Restrained by design — the grade supports the geometry.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 1 },
    uGrain: { value: 0.028 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uFlash;
    uniform float uVignette;
    uniform float uGrain;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec2 centered = vUv - 0.5;
      float r2 = dot(centered, centered);
      vec2 shift = centered * r2 * uAberration;

      vec3 color;
      color.r = texture2D(tDiffuse, vUv + shift).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - shift).b;

      // Filmic tone curve: the composer chain runs in HDR, so the shoulder
      // has to land here or dense additive fields blow out to white.
      color *= 0.72;
      color = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);

      // Controlled whiteout used by transitions and major impacts.
      color = mix(color, vec3(1.02, 1.0, 0.96), clamp(uFlash, 0.0, 1.0));

      float vignette = smoothstep(1.35, 0.35, length(centered * vec2(1.5, 1.9)));
      color *= mix(1.0, vignette, uVignette * 0.72);

      float grain = hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5;
      color += grain * uGrain * (0.4 + uFlash);

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export class PostPipeline {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.afterimage = new AfterimagePass(0.55);
    this.composer.addPass(this.afterimage);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.42, 0.24);
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  update(time, features, trail, flash, reducedMotion) {
    this.afterimage.uniforms.damp.value = Math.min(reducedMotion ? 0.4 : 0.76, trail * 0.85);
    this.bloom.strength = 0.6 + features.energy * 0.5 + features.impact * 0.35;
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uAberration.value = (features.impact * 0.9 + flash * 1.4) * (reducedMotion ? 0.3 : 1) * 0.035;
    this.grade.uniforms.uFlash.value = flash;
  }

  setSize(width, height, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render() { this.composer.render(); }
  dispose() { this.composer.dispose(); }
}
