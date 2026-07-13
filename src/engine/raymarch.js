import * as THREE from 'three';
import { noiseGlsl, audioUniformsGlsl } from './shaders/lib.glsl.js';

// Raymarched SDF environment layer. Rendered at reduced resolution into an
// offscreen target, then composited behind the particle field. Six
// environments share one marcher: mirrored tunnel, monolith field over a
// reflective floor, refractive liquid-glass sphere, infinite folded geometry,
// a luminous portal, and a volumetric particle chamber. Lighting uses a
// procedural environment, Fresnel, one reflection bounce, soft shadows and
// cheap ambient occlusion.

const raymarchFragment = /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform float uTime;
  uniform float uEnvA;
  uniform float uEnvB;
  uniform float uEnvMix;
  uniform float uSteps;
  uniform vec2 uResolution;
  uniform vec3 uCamPos;
  uniform mat3 uCamBasis;
  uniform float uFov;
  ${audioUniformsGlsl}

  ${noiseGlsl}

  const vec3 CYAN = vec3(0.05, 0.85, 1.15);
  const vec3 VIOLET = vec3(0.5, 0.15, 1.1);
  const vec3 AMBER = vec3(1.3, 0.38, 0.05);

  float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xy) - t.x, p.z);
    return length(q) - t.y;
  }

  // env 0: mirrored tunnel
  float mapTunnel(vec3 p) {
    p.z = mod(p.z + uTime * (1.4 + uEnergy * 4.0), 6.0) - 3.0;
    vec2 cell = abs(p.xy);
    float walls = 3.4 - max(cell.x, cell.y);
    float ribs = sdTorus(vec3(p.xy, mod(p.z, 1.5) - 0.75), vec2(3.1, 0.08 + uBass * 0.06));
    return min(walls, ribs);
  }

  // env 1: monoliths on a mirror floor
  float mapMonolith(vec3 p) {
    float floorD = p.y + 2.35;
    vec3 q = p;
    q.x = mod(q.x + 2.0, 8.0) - 4.0;
    q.z = mod(q.z + 2.5, 10.0) - 5.0;
    float h = 2.2 + 1.4 * hash11(floor((p.x + 4.0) / 8.0) * 7.0 + floor((p.z + 5.0) / 10.0) * 13.0);
    float mono = sdBox(q - vec3(0.0, h - 2.35, 0.0), vec3(0.5, h, 0.5)) - 0.02;
    return min(floorD, mono);
  }

  // env 2: refractive liquid-glass sphere
  float mapSphere(vec3 p) {
    float wobble = vnoise(p * 1.6 + uTime * 0.4) * (0.12 + uBass * 0.3);
    return length(p) - (2.9 + 0.25 * sin(uTime * 0.7) + uBass * 0.5) + wobble;
  }

  // env 3: infinite folded geometry (kaleidoscopic IFS)
  float mapFold(vec3 p) {
    p.xz *= rot(uTime * 0.06);
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
      p = abs(p) - vec3(1.35 + uBass * 0.25, 1.05, 1.35);
      p.xy *= rot(0.55 + uMid * 0.35);
      p.yz *= rot(0.35);
      p *= 1.28;
      scale *= 1.28;
    }
    return sdBox(p, vec3(0.9)) / scale - 0.01;
  }

  // env 4: luminous portal over a reflective floor
  float mapPortal(vec3 p) {
    float floorD = p.y + 2.4;
    vec3 q = p - vec3(0.0, 0.4, -3.0);
    float ring = sdTorus(q, vec2(2.5 + uImpact * 0.8, 0.14 + uBeat * 0.08));
    return min(floorD, ring);
  }

  // env 5: volumetric chamber (walls only; the volume glow is added later)
  float mapChamber(vec3 p) {
    return 9.0 - length(p.xz * vec2(0.9, 0.75));
  }

  float mapEnv(float env, vec3 p) {
    if (env < 0.5) return mapTunnel(p);
    if (env < 1.5) return mapMonolith(p);
    if (env < 2.5) return mapSphere(p);
    if (env < 3.5) return mapFold(p);
    if (env < 4.5) return mapPortal(p);
    return mapChamber(p);
  }

  vec3 envNormal(float env, vec3 p) {
    const vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      mapEnv(env, p + e.xyy) - mapEnv(env, p - e.xyy),
      mapEnv(env, p + e.yxy) - mapEnv(env, p - e.yxy),
      mapEnv(env, p + e.yyx) - mapEnv(env, p - e.yyx)
    ));
  }

  // Procedural environment light: cold gradient + moving energy bands.
  vec3 skyLight(vec3 d, float env) {
    float up = d.y * 0.5 + 0.5;
    vec3 base = mix(vec3(0.004, 0.005, 0.012), vec3(0.01, 0.04, 0.07), up);
    float bands = pow(abs(sin(d.x * 4.0 + uTime * 0.4)) * abs(sin(d.z * 3.0 - uTime * 0.3)), 6.0);
    base += mix(VIOLET, CYAN, up) * bands * (0.06 + uEnergy * 0.25);
    base += AMBER * pow(max(0.0, -d.y), 4.0) * uImpact * 0.4;
    return base;
  }

  float softShadow(float env, vec3 origin, vec3 dir) {
    float res = 1.0;
    float t = 0.12;
    for (int i = 0; i < 24; i++) {
      float h = mapEnv(env, origin + dir * t);
      if (h < 0.001) return 0.0;
      res = min(res, 9.0 * h / t);
      t += clamp(h, 0.05, 0.6);
      if (t > 12.0) break;
    }
    return clamp(res, 0.0, 1.0);
  }

  float ambientOcclusion(float env, vec3 p, vec3 n) {
    float occ = 0.0;
    float weight = 0.7;
    for (int i = 1; i <= 4; i++) {
      float h = 0.09 * float(i);
      occ += (h - mapEnv(env, p + n * h)) * weight;
      weight *= 0.62;
    }
    return clamp(1.0 - occ * 1.6, 0.0, 1.0);
  }

  vec3 shade(float env, vec3 p, vec3 n, vec3 rd, float travelled) {
    vec3 keyDir = normalize(vec3(0.5, 0.85, -0.3));
    float rough = env < 2.5 && env > 1.5 ? 0.05 : 0.22;
    float fresnel = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 4.0);

    float diffuse = max(0.0, dot(n, keyDir));
    float shadow = softShadow(env, p + n * 0.03, keyDir);
    float occ = ambientOcclusion(env, p, n);

    vec3 tint = mix(VIOLET, CYAN, clamp(0.5 + 0.5 * sin(p.y * 0.6 + uTime * 0.2), 0.0, 1.0));
    vec3 color = tint * (0.012 + diffuse * shadow * (0.05 + uEnergy * 0.12)) * occ;

    // One reflection bounce against the SDF + environment fallback.
    vec3 refl = reflect(rd, n);
    vec3 reflColor = skyLight(refl, env);
    float t = 0.08;
    for (int i = 0; i < 28; i++) {
      vec3 q = p + n * 0.03 + refl * t;
      float h = mapEnv(env, q);
      if (h < 0.002) {
        vec3 rn = envNormal(env, q);
        float rd2 = max(0.0, dot(rn, keyDir));
        vec3 rTint = mix(VIOLET, CYAN, clamp(0.5 + 0.5 * sin(q.y * 0.6), 0.0, 1.0));
        reflColor = rTint * (0.02 + rd2 * 0.1 + uEnergy * 0.08);
        break;
      }
      t += h;
      if (t > 14.0) break;
    }
    color += reflColor * mix(fresnel, 1.0, 1.0 - rough) * (0.35 + uEnergy * 0.4) * occ;

    // Refraction hint for the glass sphere.
    if (env > 1.5 && env < 2.5) {
      vec3 refr = refract(rd, n, 0.72);
      color += skyLight(refr, env) * (1.0 - fresnel) * 1.4;
      color += CYAN * uBass * 0.12;
    }

    // Portal ring self-emission.
    if (env > 3.5 && env < 4.5 && p.y > -2.3) {
      color += mix(CYAN, AMBER, uImpact) * (0.5 + uBeat * 1.6);
    }

    // Depth fog into the void.
    color *= exp(-travelled * 0.055);
    return color;
  }

  vec3 marchEnv(float env, vec3 ro, vec3 rd) {
    float t = 0.0;
    float glow = 0.0;
    int steps = int(uSteps);
    for (int i = 0; i < 128; i++) {
      if (i >= steps) break;
      vec3 p = ro + rd * t;
      float d = mapEnv(env, p);
      glow += exp(-abs(d) * 3.0) * 0.012;
      if (d < 0.0025 * t + 0.001) {
        vec3 n = envNormal(env, p);
        vec3 c = shade(env, p, n, rd, t);
        return c + mix(VIOLET, CYAN, uEnergy) * glow * (0.25 + uFlux * 0.5);
      }
      t += d * 0.86;
      if (t > 34.0) break;
    }
    vec3 c = skyLight(rd, env);
    // Volumetric shafts for the chamber environment.
    if (env > 4.5) {
      float shaft = 0.0;
      for (int i = 0; i < 20; i++) {
        vec3 p = ro + rd * (float(i) * 0.9 + 0.5);
        float density = vnoise(p * 0.35 + vec3(0.0, uTime * 0.12, 0.0));
        float beam = pow(abs(sin(atan(p.x, p.z) * 6.0 + uTime * 0.2)), 24.0);
        shaft += density * beam * exp(-length(p.xz) * 0.12);
      }
      c += mix(CYAN, VIOLET, 0.4) * shaft * (0.01 + uEnergy * 0.05);
    }
    return c + mix(VIOLET, CYAN, uEnergy) * glow * (0.3 + uFlux * 0.5);
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    ndc.x *= uResolution.x / uResolution.y;
    float focal = 1.0 / tan(uFov * 0.5);
    vec3 rd = normalize(uCamBasis * normalize(vec3(ndc, -focal)));
    vec3 ro = uCamPos;

    vec3 color = marchEnv(uEnvA, ro, rd);
    if (uEnvMix > 0.001) {
      color = mix(color, marchEnv(uEnvB, ro, rd), uEnvMix);
    }
    fragColor = vec4(color, 1.0);
  }
`;

export class RaymarchLayer {
  constructor(renderer, audioUniforms) {
    this.renderer = renderer;
    this.enabled = true;
    this.scale = 0.5;

    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.uniforms = {
      uTime: { value: 0 },
      uEnvA: { value: 0 },
      uEnvB: { value: 0 },
      uEnvMix: { value: 0 },
      uSteps: { value: 96 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCamPos: { value: new THREE.Vector3() },
      uCamBasis: { value: new THREE.Matrix3() },
      uFov: { value: 0.9 },
      ...audioUniforms,
    };

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */`
        out vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: raymarchFragment,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.quad = quad;
  }

  setSize(width, height) {
    const w = Math.max(2, Math.round(width * this.scale));
    const h = Math.max(2, Math.round(height * this.scale));
    this.target.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  render(camera, time, envA, envB, envMix) {
    this.uniforms.uTime.value = time;
    this.uniforms.uEnvA.value = envA;
    this.uniforms.uEnvB.value = envB;
    this.uniforms.uEnvMix.value = envMix;
    this.uniforms.uCamPos.value.copy(camera.position);
    this.uniforms.uCamBasis.value.setFromMatrix4(camera.matrixWorld);
    this.uniforms.uFov.value = THREE.MathUtils.degToRad(camera.fov);

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
