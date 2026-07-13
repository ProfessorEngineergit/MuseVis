import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export const PATTERNS = [
  ['Twin Pulse', 0.08], ['Contour Rings', 0.16], ['Starfield', 0.34], ['Wave Ribbons', 0.24],
  ['Vortex Dust', 0.46], ['Hex Cells', 0.25], ['Double Helix', 0.3], ['Grid Tunnel', 0.56],
  ['Electric Threads', 0.52], ['Constellation', 0.28], ['Shock Rings', 0.49], ['Lissajous Bloom', 0.34],
  ['Particle Floor', 0.45], ['Polar Stripes', 0.39], ['Orbit Nodes', 0.42], ['Nebula Fold', 0.59],
  ['Fracture', 0.79], ['Hyperspace', 0.71], ['Point Sphere', 0.5], ['Moiré Field', 0.36],
  ['Lightning Spokes', 0.69], ['Cube Lattice', 0.63], ['Kaleido Fold', 0.58], ['Ink Current', 0.4],
  ['Spiral Galaxy', 0.65], ['Data Rain', 0.53], ['Supernova', 1], ['Implosion', 0.74],
  ['Whiteout Shards', 0.93], ['Singularity', 0.05],
];

const vertexShader = /* glsl */`
  precision highp float;
  attribute float aIndex;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uModeA;
  uniform float uModeB;
  uniform float uMorph;
  uniform float uRms;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uEnergy;
  uniform float uBeat;
  uniform float uImpact;
  uniform float uOnset;
  uniform float uVisualGain;
  uniform float uPointScale;
  varying vec3 vColor;
  varying float vAlpha;

  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;

  float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  vec3 spherePoint(vec3 seed) {
    float y = seed.y * 2.0 - 1.0;
    float radius = sqrt(max(0.0, 1.0 - y * y));
    float angle = seed.x * TAU;
    return vec3(cos(angle) * radius, y, sin(angle) * radius);
  }

  vec3 pattern(float mode, float id, vec4 s, float t) {
    vec3 p = vec3(0.0);
    float beat = uBeat + uBass * .7;

    if (mode < .5) {
      float side = step(.5, s.x);
      float separation = .78 + .24 * sin(t * .8) + beat * .28;
      vec3 cloud = spherePoint(fract(s.xyz * vec3(1.7, 2.3, 2.9))) * (.23 + .16 * uBass);
      p = cloud + vec3(mix(-separation, separation, side), .04 * sin(t * 1.3 + side * PI), 0.0);
    } else if (mode < 1.5) {
      float ring = floor(s.x * 30.0) / 29.0;
      float angle = s.y * TAU + t * (.08 + ring * .12);
      float radius = .1 + ring * 2.7 + .08 * sin(t * 2.0 + ring * 18.0);
      p = vec3(cos(angle), sin(angle), .05 * sin(angle * 7.0 + t)) * radius;
    } else if (mode < 2.5) {
      float z = mod(s.z * 12.0 + t * (1.0 + uEnergy * 3.5), 12.0) - 7.0;
      float spread = .3 + .17 * (z + 7.0);
      p = vec3((s.x - .5) * spread * 4.0, (s.y - .5) * spread * 2.4, z);
    } else if (mode < 3.5) {
      float x = (s.x - .5) * 7.0;
      float lane = floor(s.y * 13.0) - 6.0;
      float y = lane * .2 + sin(x * (1.6 + uMid * 3.0) + t * (1.1 + lane * .015)) * (.12 + uBass * .46);
      p = vec3(x, y, .24 * sin(x * 1.3 + lane + t));
    } else if (mode < 4.5) {
      float radius = sqrt(s.x) * 3.25;
      float angle = s.y * TAU + log(radius + .12) * 5.0 - t * (1.0 + uBass);
      p = vec3(cos(angle) * radius, sin(angle) * radius, (s.z - .5) * 1.8 + .2 * sin(angle * 3.0));
    } else if (mode < 5.5) {
      float gx = floor(s.x * 34.0) - 17.0;
      float gy = floor(s.y * 22.0) - 11.0;
      gx += mod(gy, 2.0) * .5;
      p = vec3(gx * .19, gy * .2, .2 * sin(gx * .7 + gy * .9 + t) + (s.z - .5) * .08);
    } else if (mode < 6.5) {
      float side = step(.5, s.z);
      float y = (s.x - .5) * 6.2;
      float angle = y * 3.2 + t * (1.1 + uMid) + side * PI;
      p = vec3(cos(angle) * (.58 + .2 * uBass), y, sin(angle) * (.58 + .2 * uBass));
    } else if (mode < 7.5) {
      float z = mod(s.z * 13.0 + t * (1.8 + uEnergy * 5.0), 13.0) - 8.0;
      float angle = s.x * TAU + t * .35;
      float radius = .95 + s.y * .9 + .18 * sin(t * 2.0 + s.x * 18.0);
      p = vec3(cos(angle) * radius, sin(angle) * radius, z);
    } else if (mode < 8.5) {
      float x = (s.x - .5) * 7.0;
      float lane = floor(s.y * 18.0) - 9.0;
      float noise = sin(x * 3.7 + lane * 7.1 + t * 4.0) * sin(x * 8.3 - t * 2.7);
      p = vec3(x, lane * .14 + noise * (.08 + .25 * uHigh), (s.z - .5) * .35);
    } else if (mode < 9.5) {
      float gx = floor(s.x * 24.0) - 12.0;
      float gy = floor(s.y * 15.0) - 7.0;
      vec2 jitter = vec2(hash11(gx * 17.0 + gy), hash11(gx + gy * 31.0)) - .5;
      p = vec3((gx + jitter.x) * .25, (gy + jitter.y) * .25, (s.z - .5) * .8);
    } else if (mode < 10.5) {
      float radius = mod(s.x * 9.0 - t * (1.0 + uBass * 2.0), 1.0) * 3.2;
      float angle = s.y * TAU + .18 * sin(t + radius * 5.0);
      p = vec3(cos(angle), sin(angle), (s.z - .5) * .3) * radius;
    } else if (mode < 11.5) {
      float q = s.x * TAU;
      p = vec3(sin(q * 3.0 + t * .35), sin(q * 4.0 + t * .27), sin(q * 5.0 - t * .2)) * (1.7 + .4 * uBass);
      p += (s.yzw - .5) * .08;
    } else if (mode < 12.5) {
      float z = mod(s.y * 10.0 + t * (1.0 + uBass * 3.0), 10.0) - 6.5;
      p = vec3((s.x - .5) * 8.0, -2.15 + (s.z - .5) * .08, z);
    } else if (mode < 13.5) {
      float radius = sqrt(s.x) * 3.3;
      float segments = 18.0 + floor(uMid * 15.0);
      float angle = floor(s.y * segments) / segments * TAU + t * .18;
      p = vec3(cos(angle) * radius, sin(angle) * radius, .15 * sin(radius * 5.0 - t * 2.0));
    } else if (mode < 14.5) {
      float orbit = floor(s.x * 14.0);
      float angle = s.y * TAU + t * (.22 + orbit * .025) * mix(-1.0, 1.0, mod(orbit, 2.0));
      float radius = .28 + orbit * .19;
      p = vec3(cos(angle) * radius, sin(angle) * radius, .6 * sin(angle * 2.0 + orbit));
    } else if (mode < 15.5) {
      float radius = pow(s.x, .7) * 3.2;
      float angle = s.y * TAU + sin(radius * 2.4 - t * .6) * 1.5;
      float fold = sin(angle * 4.0 + radius * 3.0 + t) * (.25 + uMid * .5);
      p = vec3(cos(angle) * radius, sin(angle) * radius, fold + (s.z - .5) * .7);
      p.xy *= rot(t * .08);
    } else if (mode < 16.5) {
      float angle = floor(s.x * 46.0) / 46.0 * TAU + (s.y - .5) * .08;
      float radius = pow(s.z, .55) * (2.2 + uImpact * 2.3);
      p = vec3(cos(angle) * radius, sin(angle) * radius, (s.w - .5) * radius * .45);
    } else if (mode < 17.5) {
      float angle = s.x * TAU;
      float z = mod(s.y * 14.0 + t * (3.0 + uEnergy * 7.0), 14.0) - 9.0;
      float radius = .08 + (s.z * s.z) * 3.0;
      p = vec3(cos(angle) * radius, sin(angle) * radius, z);
    } else if (mode < 18.5) {
      p = spherePoint(s.xyz) * (2.2 + .3 * sin(t * 1.2 + s.w * TAU) + .35 * uBass);
      p.xz *= rot(t * .3);
      p.yz *= rot(t * .17);
    } else if (mode < 19.5) {
      float x = (s.x - .5) * 7.0;
      float y = (s.y - .5) * 4.3;
      float z = .32 * (sin(length(vec2(x - .8, y)) * (9.0 + 6.0 * uMid)) + sin(length(vec2(x + .8, y)) * (9.4 + 5.0 * uMid)));
      p = vec3(x, y, z);
    } else if (mode < 20.5) {
      float ray = floor(s.x * 48.0) / 48.0 * TAU;
      float radius = pow(s.y, .68) * 3.8;
      float jitter = sin(radius * 11.0 + ray * 41.0 + t * 7.0) * (.03 + .16 * uHigh);
      p = vec3(cos(ray + jitter) * radius, sin(ray + jitter) * radius, (s.z - .5) * .7);
    } else if (mode < 21.5) {
      float gx = floor(s.x * 14.0) - 7.0;
      float gy = floor(s.y * 10.0) - 5.0;
      float gz = floor(s.z * 10.0) - 5.0;
      p = vec3(gx, gy, gz) * .38;
      p.xz *= rot(t * .3);
      p.xy *= rot(t * .17);
    } else if (mode < 22.5) {
      float segment = floor(s.x * 12.0);
      float angle = segment / 12.0 * TAU;
      float local = s.y * PI;
      float radius = (1.1 + .65 * sin(local * 3.0 + t)) * sqrt(s.z) * 1.7;
      p = vec3(cos(angle + local * .12) * radius, sin(angle + local * .12) * radius, cos(local * 2.0 + t) * .7);
    } else if (mode < 23.5) {
      float x = (s.x - .5) * 7.0;
      float band = floor(s.y * 9.0) - 4.0;
      float current = sin(x * 1.4 + t + band) + .45 * sin(x * 4.2 - t * 1.8 + s.z * TAU);
      p = vec3(x, band * .26 + current * .25, current * .45 + (s.z - .5) * .2);
    } else if (mode < 24.5) {
      float arm = floor(s.x * 5.0);
      float radius = pow(s.y, .58) * 3.5;
      float angle = arm / 5.0 * TAU + radius * 1.9 - t * .5 + (s.z - .5) * .35;
      p = vec3(cos(angle) * radius, (s.z - .5) * .45 * (1.0 + radius), sin(angle) * radius);
      p.yz *= rot(.55);
    } else if (mode < 25.5) {
      float column = floor(s.x * 34.0) - 17.0;
      float y = mod(s.y * 8.0 - t * (1.0 + hash11(column) * 3.5), 8.0) - 4.0;
      p = vec3(column * .2, y, (s.z - .5) * 1.2);
    } else if (mode < 26.5) {
      float angle = s.x * TAU;
      float elevation = asin(s.y * 2.0 - 1.0);
      float radius = pow(s.z, .43) * (1.0 + uImpact * 3.8 + uEnergy * 1.7);
      vec3 direction = vec3(cos(elevation) * cos(angle), sin(elevation), cos(elevation) * sin(angle));
      p = direction * radius;
    } else if (mode < 27.5) {
      float radius = mod(s.x * 4.0 + t * (1.0 + uBass * 2.5), 1.0) * 3.5;
      float angle = s.y * TAU - log(radius + .08) * 4.0 + t;
      p = vec3(cos(angle) * radius, sin(angle) * radius, (s.z - .5) * radius * .4);
    } else if (mode < 28.5) {
      float shard = floor(s.x * 64.0);
      float angle = shard / 64.0 * TAU;
      float radius = pow(s.y, .45) * (2.0 + uImpact * 3.0);
      p = vec3(cos(angle) * radius, sin(angle) * radius, (s.z - .5) * radius * .8);
    } else {
      float radius = pow(s.x, 2.8) * (.5 + (1.0 - uEnergy) * .35);
      float angle = s.y * TAU + t * (2.0 + 4.0 * (1.0 - radius));
      p = vec3(cos(angle) * radius, sin(angle) * radius, (s.z - .5) * radius);
    }
    return p;
  }

  void main() {
    vec3 from = pattern(uModeA, aIndex, aSeed, uTime);
    vec3 to = pattern(uModeB, aIndex, aSeed, uTime);
    float morph = uMorph * uMorph * (3.0 - 2.0 * uMorph);
    vec3 transformed = mix(from, to, morph);

    float shake = uImpact * uImpact * .045;
    transformed.xy += vec2(
      sin(aSeed.x * 91.0 + floor(uTime * 36.0)),
      cos(aSeed.y * 87.0 + floor(uTime * 36.0))
    ) * shake;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float mode = mix(uModeA, uModeB, morph);
    vec3 cyan = vec3(.04, .82, 1.18);
    vec3 violet = vec3(.53, .16, 1.12);
    vec3 amber = vec3(1.35, .35, .035);
    vColor = mix(violet, cyan, aSeed.z);
    vColor = mix(vColor, amber, smoothstep(24.0, 28.0, mode) * (.18 + uImpact * .72));
    vColor += vec3(.25, .4, .55) * uHigh * step(.93, aSeed.w);
    vAlpha = (.28 + aSeed.w * .62 + uOnset * .2) * uVisualGain;
    float perspective = 10.0 / max(2.2, -mvPosition.z);
    gl_PointSize = (1.0 + aSeed.w * 1.9) * (1.0 + uHigh * 1.8 + uBeat * .75) * perspective * uPointScale;
  }
`;

const fragmentShader = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - .5;
    float distanceToCenter = length(p) * 2.0;
    if (distanceToCenter > 1.0) discard;
    float glow = pow(max(0.0, 1.0 - distanceToCenter), 2.2);
    float core = smoothstep(.24, 0.0, distanceToCenter);
    gl_FragColor = vec4(vColor * (glow + core * 1.7), (glow * .72 + core) * vAlpha);
  }
`;

const backgroundVertex = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const backgroundFragment = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uModeA;
  uniform float uModeB;
  uniform float uMorph;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uEnergy;
  uniform float uBeat;
  uniform float uImpact;
  uniform float uAspect;
  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0, amplitude = .52;
    for (int i = 0; i < 5; i++) {
      value += noise(p) * amplitude;
      p = mat2(1.72, -1.03, 1.03, 1.72) * p;
      amplitude *= .47;
    }
    return value;
  }
  float lineGlow(float d, float w) { return w / max(w, abs(d)); }

  vec3 background(float mode, vec2 uv) {
    float family = mod(floor(mode + .5), 10.0);
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    float t = uTime;
    float value = 0.0;
    vec3 cyan = vec3(.015, .35, .48);
    vec3 violet = vec3(.2, .04, .42);
    vec3 color = vec3(0.0);

    if (family < .5) {
      float separation = .24 + .18 * sin(t * .8) + uBeat * .08;
      float d1 = length(uv - vec2(-separation, 0.0));
      float d2 = length(uv - vec2(separation, 0.0));
      value = .015 / max(.008, d1) + .015 / max(.008, d2);
      value += lineGlow(uv.y - .012 * sin(uv.x * 16.0 + t * 2.0), .001) * smoothstep(.7, .05, abs(uv.x));
    } else if (family < 1.5) {
      float warped = r + .025 * sin(a * 8.0 + t) + noise(uv * 8.0 + t * .1) * .025;
      value = smoothstep(.065, 0.0, abs(fract(warped * (10.0 + uMid * 9.0) - t * .25) - .5));
    } else if (family < 2.5) {
      vec2 grid = abs(fract(uv * (8.0 + uMid * 7.0)) - .5);
      value = lineGlow(min(grid.x, grid.y) - .49, .004) * .12;
    } else if (family < 3.5) {
      for (int i = -3; i <= 3; i++) {
        float fi = float(i);
        float y = fi * .13 + sin(uv.x * (3.0 + uMid * 7.0) + t + fi) * (.03 + .11 * uBass);
        value += lineGlow(uv.y - y, .0015) * .1;
      }
    } else if (family < 4.5) {
      value = smoothstep(.14, 0.0, abs(sin(a * (8.0 + floor(uMid * 8.0)) - log(r + .02) * 8.0 + t * 1.6)));
      value *= smoothstep(1.1, .05, r);
    } else if (family < 5.5) {
      vec2 p = uv * (6.0 + uMid * 4.0);
      p.x += floor(p.y) * .5;
      vec2 cell = abs(fract(p) - .5);
      value = lineGlow(max(cell.x, cell.y * .86) - .38, .006) * .13;
    } else if (family < 6.5) {
      value = smoothstep(.08, 0.0, abs(fract(r * (8.0 + uMid * 10.0) - t * (1.0 + uBass)) - .5));
    } else if (family < 7.5) {
      float w1 = sin(length(uv - vec2(.22,0)) * (55.0 + uMid * 30.0));
      float w2 = sin(length(uv + vec2(.22,0)) * (57.0 + uMid * 28.0));
      value = smoothstep(.25, 0.0, abs(w1 + w2));
    } else if (family < 8.5) {
      float sectors = floor((a / TAU + .5) * 38.0);
      float edge = abs(fract((a / TAU + .5) * 38.0) - .5);
      value = smoothstep(.05 + hash(vec2(sectors, floor(t * 3.0))) * .18, 0.0, edge) * smoothstep(1.2, .02, r);
    } else {
      float cloud = fbm(uv * (2.5 + uMid * 2.0) + vec2(t * .1, -t * .07));
      value = pow(abs(sin(cloud * 9.0 + r * 4.0 - t * .5)), 8.0);
    }
    color = mix(violet, cyan, .5 + .5 * sin(a * 2.0 + mode));
    color *= value * (.12 + uEnergy * .58 + uBeat * .16);
    color += vec3(.5, .12, .025) * uImpact * lineGlow(r - (.15 + uImpact * .65), .003) * .18;
    return color;
  }

  void main() {
    vec2 uv = (vUv - .5) * vec2(uAspect, 1.0) * 2.0;
    vec3 a = background(uModeA, uv);
    vec3 b = background(uModeB, uv);
    float morph = uMorph * uMorph * (3.0 - 2.0 * uMorph);
    vec3 color = mix(a, b, morph);
    float vignette = smoothstep(1.25, .15, length(uv * vec2(.62, .9)));
    float grain = hash(gl_FragCoord.xy + floor(uTime * 50.0)) - .5;
    color = color * vignette + grain * .006;
    gl_FragColor = vec4(max(color, 0.0), 1.0);
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

export class Visualizer {
  constructor(container, onPatternChange) {
    this.container = container;
    this.onPatternChange = onPatternChange;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020307);
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.05, 70);
    this.camera.position.set(0, 0, 7.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setClearColor(0x020307, 1);
    container.appendChild(this.renderer.domElement);

    this.uniforms = {
      uTime: { value: 0 }, uModeA: { value: 0 }, uModeB: { value: 0 }, uMorph: { value: 1 },
      uRms: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 },
      uEnergy: { value: 0 }, uBeat: { value: 0 }, uImpact: { value: 0 }, uOnset: { value: 0 },
      uVisualGain: { value: 0.35 }, uPointScale: { value: 1 }, uAspect: { value: 1 },
    };

    this.createBackground();
    this.createParticles();

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.18, 0.72, 0.03);
    this.composer.addPass(this.bloom);

    this.currentMode = 0;
    this.targetMode = 0;
    this.morph = 1;
    this.lastSwitch = 0;
    this.nextInterval = 5;
    this.random = makeRandom(73421);
    this.queue = [];
    this.playing = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.onPatternChange?.(0, PATTERNS[0][0]);
  }

  createBackground() {
    const material = new THREE.ShaderMaterial({
      vertexShader: backgroundVertex,
      fragmentShader: backgroundFragment,
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: false,
    });
    this.background = new THREE.Mesh(new THREE.PlaneGeometry(42, 24), material);
    this.background.position.z = -12;
    this.background.renderOrder = -10;
    this.scene.add(this.background);
  }

  createParticles() {
    const compact = window.matchMedia('(max-width: 700px)').matches;
    const count = compact ? 36000 : 72000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const indices = new Float32Array(count);
    const seeds = new Float32Array(count * 4);
    const random = makeRandom(987654321);
    for (let i = 0; i < count; i += 1) {
      indices[i] = i / count;
      const offset = i * 4;
      seeds[offset] = random();
      seeds[offset + 1] = random();
      seeds[offset + 2] = random();
      seeds[offset + 3] = random();
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.particles = new THREE.Points(geometry, material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  startTrack(seedText) {
    this.random = makeRandom(hashString(seedText || 'MuseVis'));
    this.currentMode = 0;
    this.targetMode = 0;
    this.morph = 1;
    this.lastSwitch = 0;
    this.nextInterval = 4.9;
    this.queue = [];
    this.refillQueue();
    this.playing = true;
    this.uniforms.uModeA.value = 0;
    this.uniforms.uModeB.value = 0;
    this.uniforms.uMorph.value = 1;
    this.onPatternChange?.(0, PATTERNS[0][0]);
  }

  refillQueue() {
    const modes = Array.from({ length: PATTERNS.length }, (_, index) => index)
      .filter((index) => index !== this.targetMode);
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
      const distance = Math.abs(PATTERNS[candidate][1] - energy) + this.random() * 0.08;
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    this.queue.splice(this.queue.indexOf(best), 1);
    return best;
  }

  transition(mode, elapsed, energy) {
    this.currentMode = this.morph > 0.5 ? this.targetMode : this.currentMode;
    this.targetMode = mode;
    this.morph = 0;
    this.lastSwitch = elapsed;
    this.nextInterval = 6.2 - energy * 2.7 + this.random() * 0.9;
    this.uniforms.uModeA.value = this.currentMode;
    this.uniforms.uModeB.value = this.targetMode;
    this.onPatternChange?.(mode, PATTERNS[mode][0]);
  }

  update(delta, elapsed, features, isPlaying) {
    const safeDelta = Math.min(delta, 0.05);
    const time = this.playing ? elapsed : performance.now() / 1000;
    this.uniforms.uTime.value = time;
    this.uniforms.uRms.value = features.rms;
    this.uniforms.uBass.value = features.bass;
    this.uniforms.uMid.value = features.mid;
    this.uniforms.uHigh.value = features.high;
    this.uniforms.uEnergy.value = features.energy;
    this.uniforms.uOnset.value = features.onset;
    this.uniforms.uBeat.value = features.beat;
    this.uniforms.uImpact.value = features.impact;
    this.uniforms.uVisualGain.value = this.playing ? 1 : 0.35;

    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + safeDelta / (this.reducedMotion ? 0.15 : 0.82));
      this.uniforms.uMorph.value = this.morph;
      if (this.morph === 1) this.currentMode = this.targetMode;
    }

    if (this.playing && isPlaying) {
      const sinceSwitch = elapsed - this.lastSwitch;
      const isEvent = features.beat > 0.65 || features.impact > 0.58;
      if (sinceSwitch > this.nextInterval && (isEvent || sinceSwitch > this.nextInterval + 1.15)) {
        this.transition(this.chooseMode(features.energy), elapsed, features.energy);
      }
    }

    const cameraEnergy = this.reducedMotion ? 0.18 : features.energy;
    this.camera.position.x = Math.sin(time * 0.11) * 0.24 * cameraEnergy;
    this.camera.position.y = Math.cos(time * 0.09) * 0.16 * cameraEnergy;
    this.camera.position.z = 7.2 - features.bass * 0.42;
    this.camera.lookAt(0, 0, 0);
    this.particles.position.x = this.playing ? 0 : 1.45;
    this.particles.rotation.z = Math.sin(time * 0.07) * 0.035;
    this.bloom.strength = 1.02 + features.energy * 0.74 + features.impact * 0.45;
    this.composer.render();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.uniforms.uPointScale.value = pixelRatio;
    this.uniforms.uAspect.value = width / height;
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.particles.geometry.dispose();
    this.particles.material.dispose();
    this.background.geometry.dispose();
    this.background.material.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
