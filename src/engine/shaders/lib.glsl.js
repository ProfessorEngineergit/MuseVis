// Shared GLSL chunks for Engine V2. `patternGlsl` keeps the 30 canonical
// MuseVis formations as attraction targets for the physical simulation, so
// every legacy mode survives as the "skeleton" its particles chase.

export const noiseGlsl = /* glsl */`
  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;

  float hash11(float p) {
    p = fract(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(.1031, .1030, .0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash33(i).x;
    float n100 = hash33(i + vec3(1,0,0)).x;
    float n010 = hash33(i + vec3(0,1,0)).x;
    float n110 = hash33(i + vec3(1,1,0)).x;
    float n001 = hash33(i + vec3(0,0,1)).x;
    float n101 = hash33(i + vec3(1,0,1)).x;
    float n011 = hash33(i + vec3(0,1,1)).x;
    float n111 = hash33(i + vec3(1,1,1)).x;
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }

  vec3 noise3(vec3 p) {
    return vec3(
      vnoise(p),
      vnoise(p + vec3(31.7, 11.3, 74.2)),
      vnoise(p + vec3(-58.1, 27.9, 13.6))
    ) * 2.0 - 1.0;
  }

  // Divergence-free curl of a value-noise potential field.
  vec3 curlNoise(vec3 p) {
    const float e = .11;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    vec3 x0 = noise3(p - dx), x1 = noise3(p + dx);
    vec3 y0 = noise3(p - dy), y1 = noise3(p + dy);
    vec3 z0 = noise3(p - dz), z1 = noise3(p + dz);
    float x = (y1.z - y0.z) - (z1.y - z0.y);
    float y = (z1.x - z0.x) - (x1.z - x0.z);
    float z = (x1.y - x0.y) - (y1.x - y0.x);
    return normalize(vec3(x, y, z) + 1e-5) * .5;
  }
`;

// Requires uniforms: uBass, uMid, uHigh, uEnergy, uBeat, uImpact (floats)
// plus the chunks from noiseGlsl above.
export const patternGlsl = /* glsl */`
  vec3 spherePoint(vec3 seed) {
    float y = seed.y * 2.0 - 1.0;
    float radius = sqrt(max(0.0, 1.0 - y * y));
    float angle = seed.x * TAU;
    return vec3(cos(angle) * radius, y, sin(angle) * radius);
  }

  vec3 pattern(float mode, vec4 s, float t) {
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
      float elevation = asin(clamp(s.y * 2.0 - 1.0, -1.0, 1.0));
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
`;

export const audioUniformsGlsl = /* glsl */`
  uniform float uBass;
  uniform float uSubBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uTreble;
  uniform float uEnergy;
  uniform float uBeat;
  uniform float uImpact;
  uniform float uOnset;
  uniform float uFlux;
`;
