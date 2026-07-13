import * as THREE from 'three';
import { noiseGlsl, patternGlsl, audioUniformsGlsl } from './shaders/lib.glsl.js';

// Stateful GPU particle simulation. Particle state lives in two float
// textures (position+life, velocity+heat) updated through ping-pong MRT
// framebuffers each frame. Every particle chases a formation target computed
// from the canonical MuseVis patterns while curl noise, vortices, gravity
// wells and audio impulses act on it physically — so mode changes are true
// particle-preserving morphs with velocity carry-over.

const simVertex = /* glsl */`
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const simFragment = /* glsl */`
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 outPos;
  layout(location = 1) out vec4 outVel;

  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform sampler2D uSeedTex;
  uniform float uTime;
  uniform float uDelta;
  uniform float uModeA;
  uniform float uModeB;
  uniform float uMorph;
  ${audioUniformsGlsl}
  // Physics parameters, already blended between outgoing/incoming mode on CPU.
  uniform float uSpring;
  uniform float uCurl;
  uniform float uCurlScale;
  uniform float uVortex;
  uniform float uWell;
  uniform float uDrag;
  uniform float uJitter;
  uniform float uFlatten;
  uniform float uBurst;     // transition impulse: >0 explode, <0 implode
  uniform float uSnap;      // 1 on hard cuts: teleport to target

  ${noiseGlsl}
  ${patternGlsl}

  void main() {
    vec4 seed = texture(uSeedTex, vUv);
    vec4 pos4 = texture(uPosTex, vUv);
    vec4 vel4 = texture(uVelTex, vUv);
    vec3 pos = pos4.xyz;
    float life = pos4.w;
    vec3 vel = vel4.xyz;

    float dt = clamp(uDelta, 0.001, 0.033);
    float morph = uMorph * uMorph * (3.0 - 2.0 * uMorph);
    vec3 target = mix(pattern(uModeA, seed, uTime), pattern(uModeB, seed, uTime), morph);
    target.z *= 1.0 - uFlatten * 0.94;

    // Spring toward the formation. Per-particle stiffness variation keeps
    // the body of the swarm alive instead of moving as a rigid shell.
    float stiffness = uSpring * (0.55 + seed.w * 0.9);
    vec3 force = (target - pos) * stiffness;

    // Curl-noise flow field, energised by mids and treble.
    float flow = uCurl * (0.45 + uMid * 0.9 + uTreble * 0.6);
    if (flow > 0.001) {
      force += curlNoise(pos * uCurlScale + vec3(0.0, uTime * 0.07, uTime * 0.05)) * flow * 1.3;
    }

    // Vortex suction around the y axis, pumped by bass.
    if (abs(uVortex) > 0.001) {
      vec2 radial = pos.xz;
      float r = max(0.2, length(radial));
      vec2 tangent = vec2(-radial.y, radial.x) / r;
      force.xz += tangent * uVortex * (0.8 + uBass * 1.4);
      force.xz -= radial / (r * r) * uVortex * 0.35;
    }

    // Central gravity well (positive pulls in, negative repels).
    if (abs(uWell) > 0.001) {
      float r = max(0.25, length(pos));
      force -= pos / (r * r) * uWell * (0.7 + uSubBass * 1.6);
    }

    // Beat transients kick the swarm outward along its local normal.
    vec3 outward = normalize(pos + vec3(0.0, 1e-4, 0.0));
    force += outward * uBeat * uBeat * (1.2 + uSubBass * 3.0) * (0.4 + seed.z);

    // High-frequency sparkle jitter.
    force += (hash33(pos * 37.0 + uTime) - 0.5) * uJitter * (uHigh * 3.5 + uImpact * 3.0);

    // Transition impulse (explosion / implosion), then normal integration.
    if (abs(uBurst) > 0.001) {
      vel += outward * uBurst * (0.6 + seed.y * 0.9);
    }

    vel = (vel + force * dt) * exp(-uDrag * dt);
    pos += vel * dt;
    pos.z = mix(pos.z, pos.z * (1.0 - uFlatten * 0.9), clamp(uFlatten, 0.0, 1.0) * dt * 6.0);

    // Lifetime + respawn: lost particles rejoin the formation quietly.
    life -= dt * (0.04 + seed.x * 0.05);
    if (life <= 0.0 || length(pos) > 24.0) {
      pos = target + (hash33(seed.xyz * 91.0 + uTime) - 0.5) * 0.2;
      vel *= 0.1;
      life = 0.6 + seed.y;
    }

    if (uSnap > 0.5) {
      pos = target + (hash33(seed.wzy * 53.0) - 0.5) * 0.05;
      vel *= 0.05;
    }

    // Heat tracks kinetic energy for colour grading in the render pass.
    float heat = mix(vel4.w, clamp(length(vel) * 0.34, 0.0, 1.6), 0.12);

    outPos = vec4(pos, life);
    outVel = vec4(vel, heat);
  }
`;

export class ParticleSim {
  constructor(renderer, size, audioUniforms) {
    this.renderer = renderer;
    this.size = size;
    this.count = size * size;

    const makeTarget = () => {
      const target = new THREE.WebGLRenderTarget(size, size, {
        count: 2,
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      return target;
    };
    this.targets = [makeTarget(), makeTarget()];
    this.index = 0;

    this.seedTexture = this.createSeedTexture(size);

    this.uniforms = {
      uPosTex: { value: null },
      uVelTex: { value: null },
      uSeedTex: { value: this.seedTexture },
      uTime: { value: 0 },
      uDelta: { value: 0.016 },
      uModeA: { value: 0 },
      uModeB: { value: 0 },
      uMorph: { value: 1 },
      uSpring: { value: 4 },
      uCurl: { value: 0.3 },
      uCurlScale: { value: 0.55 },
      uVortex: { value: 0 },
      uWell: { value: 0 },
      uDrag: { value: 3.4 },
      uJitter: { value: 0.2 },
      uFlatten: { value: 0 },
      uBurst: { value: 0 },
      uSnap: { value: 0 },
      ...audioUniforms,
    };

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: simVertex,
      fragmentShader: simFragment,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.seedState();
  }

  createSeedTexture(size) {
    const data = new Float32Array(size * size * 4);
    let state = 22695477;
    const random = () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    for (let i = 0; i < data.length; i += 1) data[i] = random();
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
  }

  // Initialise both ping-pong buffers by running a snap step.
  seedState() {
    const previousSnap = this.uniforms.uSnap.value;
    this.uniforms.uSnap.value = 1;
    this.step(0.016, 0);
    this.step(0.016, 0.016);
    this.uniforms.uSnap.value = previousSnap;
  }

  step(delta, time) {
    const read = this.targets[this.index];
    const write = this.targets[1 - this.index];
    this.uniforms.uPosTex.value = read.textures[0];
    this.uniforms.uVelTex.value = read.textures[1];
    this.uniforms.uDelta.value = delta;
    this.uniforms.uTime.value = time;

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
    this.index = 1 - this.index;
  }

  get positionTexture() { return this.targets[this.index].textures[0]; }
  get velocityTexture() { return this.targets[this.index].textures[1]; }

  dispose() {
    this.targets.forEach((target) => target.dispose());
    this.seedTexture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
