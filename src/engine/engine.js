import * as THREE from 'three';
import { MODES, PATTERNS, TRANSITIONS, ENVS } from './modes.js';
import { ParticleSim } from './sim.js';
import { RaymarchLayer } from './raymarch.js';
import { PostPipeline } from './post.js';
import { QualityGovernor, TIERS, detectInitialTier } from './quality.js';

export { PATTERNS };

// Particle render: positions come from the simulation texture, colour from
// seed + kinetic heat. Cyan/ultraviolet body, cold-white sparkle on treble,
// amber only at major impacts.
const particleVertex = /* glsl */`
  precision highp float;
  attribute vec2 aUv;
  uniform sampler2D uPosTex;
  uniform sampler2D uVelTex;
  uniform sampler2D uSeedTex;
  uniform float uHigh;
  uniform float uTreble;
  uniform float uBeat;
  uniform float uImpact;
  uniform float uOnset;
  uniform float uVisualGain;
  uniform float uPointScale;
  uniform float uAlphaScale;
  uniform float uAmber;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 pos4 = texture2D(uPosTex, aUv);
    vec4 vel4 = texture2D(uVelTex, aUv);
    vec4 seed = texture2D(uSeedTex, aUv);
    float heat = vel4.w;

    vec4 mvPosition = modelViewMatrix * vec4(pos4.xyz, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vec3 cyan = vec3(.04, .82, 1.18);
    vec3 violet = vec3(.53, .16, 1.12);
    vec3 amber = vec3(1.35, .35, .035);
    vColor = mix(violet, cyan, seed.z);
    vColor = mix(vColor, vec3(1.15, 1.2, 1.3), clamp(heat * .28, 0.0, .45));
    vColor = mix(vColor, amber, uAmber * (.2 + uImpact * .8) * step(.6, seed.y));
    vColor += vec3(.25, .4, .55) * uTreble * step(.93, seed.w);

    float fade = smoothstep(0.0, .25, pos4.w);
    vAlpha = (.26 + seed.w * .6 + uOnset * .2) * uVisualGain * fade * uAlphaScale;
    float perspective = 10.0 / max(2.2, -mvPosition.z);
    gl_PointSize = (1.0 + seed.w * 1.9 + heat * 1.3)
      * (1.0 + uHigh * 1.6 + uBeat * .7) * perspective * uPointScale;
  }
`;

const particleFragment = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - .5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float glow = pow(max(0.0, 1.0 - d), 3.0);
    float core = smoothstep(.3, 0.0, d);
    gl_FragColor = vec4(vColor * (glow + core * 2.0), (glow * .5 + core) * vAlpha);
  }
`;

// Background quad: raymarched environment texture when the mode has one,
// otherwise a near-black void with a faint energy field so flat modes keep
// their graphic identity.
const backgroundFragment = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uEnvTex;
  uniform float uEnvAmount;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uBeat;
  uniform float uAspect;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = (vUv - .5) * vec2(uAspect, 1.0) * 2.0;
    float r = length(uv);
    vec3 voidColor = mix(vec3(.004, .006, .014), vec3(.002, .003, .008), r);
    float halo = exp(-r * r * 2.2) * (0.02 + uEnergy * 0.05 + uBeat * 0.02);
    voidColor += mix(vec3(.2, .04, .42), vec3(.015, .35, .48), .5 + .5 * sin(uTime * .1)) * halo;
    vec3 env = texture2D(uEnvTex, vUv).rgb;
    vec3 color = mix(voidColor, env, uEnvAmount);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export class EngineV2 {
  constructor(container, onPatternChange) {
    this.container = container;
    this.onPatternChange = onPatternChange;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    if (!this.renderer.capabilities.isWebGL2 || !gl.getExtension('EXT_color_buffer_float')) {
      this.renderer.dispose();
      const error = new Error('Engine V2 requires WebGL2 with float render targets.');
      error.engineUnsupported = true;
      throw error;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setClearColor(0x020307, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020307);
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.05, 90);
    this.camera.position.set(0, 0, 7.2);

    // One shared set of audio uniform objects across sim/raymarch/particles.
    this.audioUniforms = {
      uBass: { value: 0 }, uSubBass: { value: 0 }, uMid: { value: 0 },
      uHigh: { value: 0 }, uTreble: { value: 0 }, uEnergy: { value: 0 },
      uBeat: { value: 0 }, uImpact: { value: 0 }, uOnset: { value: 0 },
      uFlux: { value: 0 },
    };

    this.governor = new QualityGovernor(detectInitialTier(), () => this.applyTier());
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.raymarch = new RaymarchLayer(this.renderer, this.audioUniforms);
    this.buildBackground();
    this.buildParticles(TIERS[this.governor.tierIndex].simSize);
    this.post = new PostPipeline(this.renderer, this.scene, this.camera);

    // Scheduling state.
    this.modeA = 0;
    this.modeB = 0;
    this.morph = 1;
    this.lastSwitch = 0;
    this.nextInterval = 5;
    this.random = makeRandom(73421);
    this.queue = [];
    this.playing = false;
    this.flash = 0;
    this.burst = 0;
    this.snapFrames = 0;
    this.diveOffset = 0;
    this.envMixTarget = 0;
    this.cameraPhase = Math.random() * 100;
    this.smoothFov = 54;
    this.smoothDist = 7.2;
    this.contextLost = false;

    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.sim.seedState();
      this.resize();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.onPatternChange?.(0, MODES[0].name);
  }

  buildBackground() {
    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: backgroundFragment,
      uniforms: {
        uEnvTex: { value: this.raymarch.target.texture },
        uEnvAmount: { value: 0 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uEnergy: this.audioUniforms.uEnergy,
        uBeat: this.audioUniforms.uBeat,
      },
      depthWrite: false,
      depthTest: false,
    });
    this.background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.background.renderOrder = -10;
    this.background.frustumCulled = false;
    // Fullscreen in clip space regardless of camera.
    this.background.material.vertexShader = /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }
    `;
    this.scene.add(this.background);
  }

  buildParticles(simSize) {
    this.sim = new ParticleSim(this.renderer, simSize, this.audioUniforms);
    const count = simSize * simSize;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      uvs[i * 2] = ((i % simSize) + 0.5) / simSize;
      uvs[i * 2 + 1] = (Math.floor(i / simSize) + 0.5) / simSize;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));

    this.particleUniforms = {
      uPosTex: { value: null },
      uVelTex: { value: null },
      uSeedTex: { value: this.sim.seedTexture },
      uVisualGain: { value: 0.35 },
      uPointScale: { value: 1 },
      // Keep total additive energy comparable to the 72k legacy field.
      uAlphaScale: { value: Math.min(1, Math.sqrt(30000 / count)) },
      uAmber: { value: 0 },
      uHigh: this.audioUniforms.uHigh,
      uTreble: this.audioUniforms.uTreble,
      uBeat: this.audioUniforms.uBeat,
      uImpact: this.audioUniforms.uImpact,
      uOnset: this.audioUniforms.uOnset,
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: this.particleUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.particles = new THREE.Points(geometry, material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  applyTier() {
    const tier = this.governor.tier;
    if (this.sim.size !== tier.simSize) {
      const oldUniforms = this.sim.uniforms;
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      this.particles.material.dispose();
      this.sim.dispose();
      this.buildParticles(tier.simSize);
      // Carry mode/physics state into the rebuilt simulation.
      ['uModeA', 'uModeB', 'uMorph', 'uSpring', 'uCurl', 'uCurlScale', 'uVortex',
        'uWell', 'uDrag', 'uJitter', 'uFlatten'].forEach((key) => {
        this.sim.uniforms[key].value = oldUniforms[key].value;
      });
      this.sim.seedState();
    }
    this.raymarch.scale = tier.raymarchScale;
    this.raymarch.uniforms.uSteps.value = tier.steps;
    this.resize();
  }

  startTrack(seedText) {
    this.random = makeRandom(hashString(seedText || 'MuseVis'));
    this.modeA = 0;
    this.modeB = 0;
    this.morph = 1;
    this.lastSwitch = 0;
    this.nextInterval = 4.9;
    this.queue = [];
    this.refillQueue();
    this.playing = true;
    this.flash = 0;
    this.burst = 0;
    this.sim.uniforms.uModeA.value = MODES[0].form;
    this.sim.uniforms.uModeB.value = MODES[0].form;
    this.sim.uniforms.uMorph.value = 1;
    this.onPatternChange?.(0, MODES[0].name);
  }

  refillQueue() {
    const modes = Array.from({ length: MODES.length }, (_, index) => index)
      .filter((index) => index !== this.modeB);
    for (let i = modes.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [modes[i], modes[j]] = [modes[j], modes[i]];
    }
    this.queue.push(...modes);
  }

  chooseMode(energy) {
    if (this.queue.length < 1) this.refillQueue();
    const candidates = this.queue.slice(0, Math.min(7, this.queue.length));
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = Math.abs(MODES[candidate].energy - energy) + this.random() * 0.08;
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    this.queue.splice(this.queue.indexOf(best), 1);
    return best;
  }

  transition(mode, elapsed, energy) {
    this.modeA = this.morph > 0.5 ? this.modeB : this.modeA;
    this.modeB = mode;
    this.morph = 0;
    this.lastSwitch = elapsed;
    this.nextInterval = 6.2 - energy * 2.7 + this.random() * 0.9;
    this.sim.uniforms.uModeA.value = MODES[this.modeA].form;
    this.sim.uniforms.uModeB.value = MODES[mode].form;

    const kind = MODES[mode].transition;
    const strength = this.reducedMotion ? 0.35 : 1;
    if (kind === TRANSITIONS.BURST) this.burst = 6.5 * strength;
    else if (kind === TRANSITIONS.IMPLODE) this.burst = -7.5 * strength;
    else if (kind === TRANSITIONS.WHITEOUT) { this.flash = Math.max(this.flash, 0.85 * strength); this.burst = 5 * strength; }
    else if (kind === TRANSITIONS.CUT) { this.snapFrames = 1; this.flash = Math.max(this.flash, 0.22 * strength); }
    else if (kind === TRANSITIONS.DIVE) this.diveOffset = 4.5 * strength;
    else if (kind === TRANSITIONS.FLATTEN) this.burst = 1.2 * strength;

    this.onPatternChange?.(mode, MODES[mode].name);
  }

  update(delta, elapsed, features, isPlaying) {
    if (this.contextLost) return;
    const safeDelta = Math.min(delta, 0.05);
    const time = this.playing ? elapsed : performance.now() / 1000;
    this.governor.update(safeDelta);

    const audio = this.audioUniforms;
    audio.uBass.value = features.bass;
    audio.uSubBass.value = features.subBass ?? features.bass;
    audio.uMid.value = features.mid;
    audio.uHigh.value = features.high;
    audio.uTreble.value = features.treble ?? features.high;
    audio.uEnergy.value = features.energy;
    audio.uBeat.value = features.beat;
    audio.uImpact.value = features.impact;
    audio.uOnset.value = features.onset;
    audio.uFlux.value = features.flux ?? features.onset;

    // Morph progression + physics blending between the two active modes.
    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + safeDelta / (this.reducedMotion ? 0.15 : 0.9));
      if (this.morph === 1) this.modeA = this.modeB;
    }
    const a = MODES[this.modeA];
    const b = MODES[this.modeB];
    const m = this.morph * this.morph * (3 - 2 * this.morph);
    const blend = (key) => a[key] + (b[key] - a[key]) * m;

    const sim = this.sim.uniforms;
    sim.uMorph.value = this.morph;
    sim.uSpring.value = blend('spring');
    sim.uCurl.value = blend('curl');
    sim.uCurlScale.value = blend('curlScale');
    sim.uVortex.value = blend('vortex');
    sim.uWell.value = blend('well');
    sim.uDrag.value = blend('drag');
    sim.uJitter.value = blend('jitter');
    sim.uFlatten.value = blend('flat');
    sim.uBurst.value = this.burst;
    sim.uSnap.value = this.snapFrames > 0 ? 1 : 0;
    if (this.snapFrames > 0) this.snapFrames -= 1;
    this.burst *= Math.exp(-safeDelta * 9);
    if (Math.abs(this.burst) < 0.05) this.burst = 0;
    this.flash = Math.max(0, this.flash - safeDelta * 1.7);
    this.diveOffset *= Math.exp(-safeDelta * 2.4);

    // Impact-driven amber accent for the climax modes.
    const amberTarget = (b.name === 'Supernova' || b.name === 'Whiteout Shards' || b.name === 'Implosion') ? 1 : 0;
    this.particleUniforms.uAmber.value += (amberTarget - this.particleUniforms.uAmber.value) * safeDelta * 3;
    this.particleUniforms.uVisualGain.value = this.playing ? 1 : 0.35;
    this.particles.position.x = this.playing ? 0 : 1.45;
    this.particles.rotation.z = Math.sin(time * 0.07) * 0.035;

    // Transition scheduling: beats, impacts, and pre-analysed section changes.
    if (this.playing && isPlaying) {
      const sinceSwitch = elapsed - this.lastSwitch;
      const section = features.section ?? 0;
      const isEvent = features.beat > 0.65 || features.impact > 0.58 || section > 0.7;
      const readiness = section > 0.7 ? this.nextInterval * 0.55 : this.nextInterval;
      if (sinceSwitch > readiness && (isEvent || sinceSwitch > this.nextInterval + 1.15)) {
        this.transition(this.chooseMode(features.energy), elapsed, features.energy);
      }
    }

    // Advance the simulation (fixed logical time, real delta).
    this.sim.step(safeDelta, time);
    this.particleUniforms.uPosTex.value = this.sim.positionTexture;
    this.particleUniforms.uVelTex.value = this.sim.velocityTexture;

    this.updateCamera(time, features, safeDelta);

    // Raymarched environment for the active mode(s).
    const tier = this.governor.tier;
    const envB = b.env;
    const envA = a.env;
    const wantsEnv = tier.raymarch && (envA !== ENVS.NONE || envB !== ENVS.NONE);
    const envAmountTarget = wantsEnv ? (envB !== ENVS.NONE ? m : 1 - m) : 0;
    this.envMixTarget += (envAmountTarget - this.envMixTarget) * Math.min(1, safeDelta * 2.2);
    if (wantsEnv && this.envMixTarget > 0.01) {
      const primary = envB !== ENVS.NONE ? envB : envA;
      const secondary = envA !== ENVS.NONE ? envA : envB;
      const crossfade = envA !== ENVS.NONE && envB !== ENVS.NONE && envA !== envB ? 1 - m : 0;
      this.raymarch.render(this.camera, time, primary, secondary, crossfade);
    }
    this.background.material.uniforms.uEnvAmount.value = this.envMixTarget * (this.playing ? 1 : 0);
    this.background.material.uniforms.uTime.value = time;

    this.post.update(time, features, blend('trail'), this.flash + Math.max(0, features.impact - 0.9) * 0.4, this.reducedMotion);
    this.post.render();
  }

  updateCamera(time, features, delta) {
    const b = MODES[this.modeB];
    const energy = this.reducedMotion ? 0.18 : features.energy;
    this.smoothFov += (b.fov - this.smoothFov) * Math.min(1, delta * 1.4);
    this.smoothDist += (b.dist - this.smoothDist) * Math.min(1, delta * 1.2);
    if (Math.abs(this.camera.fov - this.smoothFov) > 0.05) {
      this.camera.fov = this.smoothFov;
      this.camera.updateProjectionMatrix();
    }

    const t = time * (this.reducedMotion ? 0.4 : 1) + this.cameraPhase;
    let x = 0; let y = 0; let z = this.smoothDist;
    let roll = 0;
    switch (b.camera) {
      case 'orbit': {
        const angle = t * 0.09;
        x = Math.sin(angle) * this.smoothDist * 0.42;
        z = Math.cos(angle * 0.7) * 0.2 + this.smoothDist;
        y = Math.sin(t * 0.06) * 0.9;
        break;
      }
      case 'tunnel':
        x = Math.sin(t * 0.5) * 0.25 * energy;
        y = Math.cos(t * 0.4) * 0.2 * energy;
        z = this.smoothDist - features.bass * 0.9;
        roll = Math.sin(t * 0.12) * 0.1;
        break;
      case 'still':
        z = this.smoothDist - features.bass * 0.25;
        break;
      case 'dive':
        z = this.smoothDist - features.impact * 2.4 - features.bass * 0.7;
        y = Math.sin(t * 0.07) * 0.4;
        break;
      default: // drift
        x = Math.sin(t * 0.11) * 0.24 * energy;
        y = Math.cos(t * 0.09) * 0.16 * energy;
        z = this.smoothDist - features.bass * 0.42;
    }
    z += this.diveOffset;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
    this.camera.rotation.z += roll + Math.sin(t * 0.07) * 0.03;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const tier = this.governor.tier;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, tier.pixelRatio) * this.governor.resolutionScale;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height, pixelRatio);
    this.raymarch.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.particleUniforms.uPointScale.value = pixelRatio;
    this.background.material.uniforms.uAspect.value = width / height;
  }

  get stats() {
    return {
      tier: this.governor.tier.name,
      particles: this.sim.count,
      resolutionScale: this.governor.resolutionScale,
    };
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.sim.dispose();
    this.raymarch.dispose();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
    this.background.geometry.dispose();
    this.background.material.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
