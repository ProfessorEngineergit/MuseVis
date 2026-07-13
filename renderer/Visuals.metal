#include <metal_stdlib>
using namespace metal;

constant float PI = 3.14159265358979323846;
constant float TAU = 6.28318530717958647692;

struct Uniforms {
    float time;
    float rms;
    float bass;
    float mid;
    float high;
    float onset;
    float beat;
    float impact;
    float energy;
    uint width;
    uint height;
    uint mode;
    uint nextMode;
    float transition;
    float sceneProgress;
    float seed;
    float padding;
};

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float hash21(float2 p) {
    float3 p3 = fract(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float2 hash22(float2 p) {
    float3 p3 = fract(float3(p.xyx) * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float2 rotate2(float2 p, float a) {
    float c = cos(a), s = sin(a);
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float noise2(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + float2(1, 0)), f.x),
               mix(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), f.x), f.y);
}

float fbm(float2 p) {
    float v = 0.0;
    float a = 0.52;
    for (uint i = 0; i < 5; ++i) {
        v += a * noise2(p);
        p = rotate2(p * 2.03, 0.53);
        a *= 0.48;
    }
    return v;
}

float lineGlow(float d, float width) {
    return width / max(width, abs(d));
}

float ringGlow(float2 p, float radius, float width) {
    return lineGlow(length(p) - radius, width);
}

float3 cyan() { return float3(0.02, 0.82, 1.18); }
float3 violet() { return float3(0.52, 0.14, 1.12); }
float3 amber() { return float3(1.35, 0.38, 0.035); }
float3 ice() { return float3(0.72, 0.92, 1.14); }

float hexDistance(float2 p) {
    p = abs(p);
    return max(dot(p, normalize(float2(1.0, 1.732))), p.x);
}

float voronoiEdge(float2 p, float seed) {
    float2 cell = floor(p);
    float2 local = fract(p);
    float nearest = 10.0;
    float second = 10.0;
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            float2 n = float2(x, y);
            float2 point = n + hash22(cell + n + seed);
            float d = length(point - local);
            if (d < nearest) { second = nearest; nearest = d; }
            else if (d < second) { second = d; }
        }
    }
    return second - nearest;
}

float3 commonDust(float2 uv, Uniforms u, float amount) {
    float2 cell = floor((uv + 2.0) * float2(180.0, 100.0));
    float h = hash21(cell + floor(u.time * 0.7));
    float sparkle = smoothstep(0.995 - 0.018 * u.high, 1.0, h);
    return ice() * sparkle * amount * (0.25 + u.high);
}

float3 pattern(uint mode, float2 uv, Uniforms u) {
    float t = u.time;
    float pulse = 0.45 * u.beat + 0.75 * u.bass + 0.9 * u.impact;
    float3 col = float3(0.0);
    float r = length(uv);
    float a = atan2(uv.y, uv.x);

    switch (mode) {
        case 0: { // Twin Pulse: two opposing bodies breathe exactly with the beat.
            float separation = 0.15 + 0.35 * (0.5 + 0.5 * cos(t * 0.82)) + 0.11 * u.beat;
            float radius = 0.055 + 0.055 * u.bass;
            float2 p1 = uv - float2(-separation, 0.025 * sin(t * 1.3));
            float2 p2 = uv - float2( separation, -0.025 * sin(t * 1.3));
            float g1 = radius / max(0.002, length(p1));
            float g2 = radius / max(0.002, length(p2));
            float ring = ringGlow(p1, radius * (2.0 + pulse), 0.0025) + ringGlow(p2, radius * (2.0 + pulse), 0.0025);
            float bridge = lineGlow(uv.y - 0.035 * sin(uv.x * 15.0 + t * 3.0), 0.0015) * smoothstep(separation + 0.08, 0.0, abs(uv.x));
            col += cyan() * g1 * g1 * 0.18 + violet() * g2 * g2 * 0.18;
            col += ice() * ring * (0.08 + 0.30 * u.onset) + cyan() * bridge * 0.15;
            break;
        }
        case 1: { // Contour Rings
            float warped = r + 0.035 * sin(a * 8.0 + t) + 0.018 * noise2(uv * 9.0 + t);
            float rings = abs(fract(warped * (10.0 + 8.0 * u.mid) - t * 0.32) - 0.5);
            float spokes = abs(sin(a * (5.0 + floor(u.mid * 7.0)) + t * 0.2));
            col += cyan() * smoothstep(0.09, 0.0, rings) * (0.3 + pulse);
            col += violet() * smoothstep(0.035, 0.0, spokes) * smoothstep(1.2, 0.1, r) * 0.45;
            break;
        }
        case 2: { // Starfield
            for (uint layer = 0; layer < 14; ++layer) {
                float z = fract(float(layer) / 14.0 + t * (0.075 + 0.08 * u.energy));
                float scale = mix(18.0, 1.2, z);
                float2 p = uv * scale + hash22(float2(layer, layer + 7)) * 9.0;
                float2 q = fract(p) - 0.5;
                float h = hash21(floor(p) + float(layer));
                float star = smoothstep(0.045 + 0.08 * z, 0.0, length(q)) * step(0.78, h);
                col += mix(violet(), cyan(), h) * star * z * (0.08 + 0.55 * u.high);
            }
            break;
        }
        case 3: { // Wave Ribbons
            for (int i = -4; i <= 4; ++i) {
                float fi = float(i);
                float y = fi * 0.12 + sin(uv.x * (3.0 + u.mid * 8.0) + t * (1.2 + fi * 0.07) + fi) * (0.035 + 0.16 * u.bass);
                y += 0.025 * sin(uv.x * 31.0 - t * 4.0) * u.high;
                float glow = lineGlow(uv.y - y, 0.0018 + 0.002 * u.onset);
                col += mix(cyan(), violet(), (fi + 4.0) / 8.0) * glow * 0.08;
            }
            break;
        }
        case 4: { // Vortex Dust
            float spiral = abs(sin(a * (7.0 + floor(u.mid * 4.0)) - log(r + 0.035) * 11.0 + t * 2.5));
            float fleck = hash21(floor(float2(a * 80.0, log(r + 0.04) * 90.0)));
            float dust = smoothstep(0.22 + 0.22 * u.high, 0.0, spiral) * smoothstep(0.77, 1.0, fleck);
            col += mix(violet(), cyan(), r) * dust * (0.8 + pulse);
            col += amber() * pow(0.012 / max(r, 0.012), 1.7) * u.impact;
            break;
        }
        case 5: { // Hex Cells
            float2 p = uv * (5.5 + 6.0 * u.energy);
            p.x += 0.5 * floor(p.y);
            float2 cell = fract(p) - 0.5;
            float hd = abs(hexDistance(cell) - (0.35 + 0.08 * sin(t + hash21(floor(p)) * TAU)));
            float gate = 0.2 + 0.8 * hash21(floor(p));
            col += mix(cyan(), violet(), gate) * lineGlow(hd, 0.008) * gate * (0.12 + 0.35 * pulse);
            break;
        }
        case 6: { // Mirror Arcs
            float2 p = float2(abs(uv.x), uv.y);
            for (uint i = 0; i < 7; ++i) {
                float fi = float(i);
                float2 c = float2(0.08 + fi * 0.105, 0.12 * sin(t * 0.4 + fi));
                float arc = ringGlow(p - c, 0.14 + 0.035 * sin(t + fi), 0.002);
                float mask = smoothstep(0.0, 0.13, p.x) * smoothstep(1.0, 0.1, abs(p.y));
                col += mix(violet(), cyan(), fi / 7.0) * arc * mask * (0.06 + 0.2 * pulse);
            }
            break;
        }
        case 7: { // Grid Tunnel
            float depth = 0.34 / max(0.04, r);
            float rings = abs(fract(depth * 1.6 - t * (1.2 + u.bass)) - 0.5);
            float sectors = abs(sin(a * (8.0 + floor(u.mid * 8.0))));
            col += cyan() * lineGlow(rings, 0.018) * smoothstep(1.1, 0.08, r) * 0.18;
            col += violet() * lineGlow(sectors, 0.018) * smoothstep(1.15, 0.1, r) * (0.12 + 0.3 * u.onset);
            col += ice() * pow(0.009 / max(r, 0.009), 1.5);
            break;
        }
        case 8: { // Electric Threads
            for (uint i = 0; i < 9; ++i) {
                float fi = float(i);
                float y = (fi - 4.0) * 0.115;
                y += (noise2(float2(uv.x * 5.0 + fi * 3.0, t * 2.0)) - 0.5) * (0.12 + 0.22 * u.high);
                y += sin(uv.x * 18.0 - t * 3.0 + fi) * 0.025;
                float g = lineGlow(uv.y - y, 0.0012 + 0.0025 * u.onset);
                col += mix(cyan(), violet(), fract(fi * 0.31)) * g * 0.075;
            }
            break;
        }
        case 9: { // Constellation
            float2 p = uv * 7.0;
            float2 id = floor(p);
            float2 local = fract(p) - 0.5;
            float2 point = hash22(id + floor(t * 0.25)) - 0.5;
            point += 0.14 * sin(float2(t, t * 1.17) + hash22(id) * TAU);
            float node = smoothstep(0.055 + 0.04 * u.high, 0.0, length(local - point));
            float lineA = lineGlow(local.y - point.y - (local.x - point.x) * (hash21(id) - 0.5), 0.006);
            col += ice() * node * (0.7 + pulse) + cyan() * lineA * 0.025 * step(0.52, hash21(id));
            break;
        }
        case 10: { // Shock Rings
            float wave = fract(r * 2.8 - t * (0.85 + 1.8 * u.bass));
            float g = lineGlow(wave - 0.5, 0.008 + 0.018 * u.impact);
            float angular = 0.45 + 0.55 * sin(a * 9.0 + t);
            col += mix(violet(), cyan(), angular) * g * (0.10 + 0.6 * pulse);
            col += amber() * ringGlow(uv, 0.12 + 0.75 * u.impact, 0.004) * u.impact * 0.4;
            break;
        }
        case 11: { // Lissajous Bloom
            float best = 10.0;
            for (uint i = 0; i < 48; ++i) {
                float s = float(i) / 47.0 * TAU;
                float2 p = float2(sin(s * 3.0 + t * 0.35), sin(s * 4.0 + t * 0.27)) * (0.38 + 0.12 * u.bass);
                best = min(best, length(uv - p));
            }
            col += mix(cyan(), violet(), 0.5 + 0.5 * sin(a * 3.0)) * lineGlow(best, 0.004) * (0.08 + 0.38 * pulse);
            break;
        }
        case 12: { // Particle Floor
            float horizon = uv.y + 0.31;
            float z = 0.18 / max(0.015, abs(horizon));
            float x = uv.x * z;
            float2 grid = float2(x * 2.0, z - t * (1.5 + u.bass));
            float2 q = fract(grid) - 0.5;
            float h = hash21(floor(grid));
            float dotv = smoothstep(0.13, 0.0, length(q)) * step(0.38, h) * smoothstep(-0.3, 0.1, horizon);
            col += mix(violet(), cyan(), h) * dotv * (0.25 + 1.1 * u.energy);
            col += cyan() * lineGlow(horizon, 0.002) * 0.12;
            break;
        }
        case 13: { // Polar Stripes
            float stripes = abs(fract((a / TAU + 0.5) * (18.0 + floor(u.mid * 16.0)) + r * 4.0 - t * 0.8) - 0.5);
            float cut = step(hash11(floor(a * 20.0)), 0.45 + u.high * 0.3);
            col += mix(cyan(), violet(), r) * smoothstep(0.18, 0.0, stripes) * cut * (0.25 + pulse);
            break;
        }
        case 14: { // Orbit Nodes
            for (uint i = 0; i < 13; ++i) {
                float fi = float(i);
                float angle = t * (0.25 + 0.03 * fi) * (fmod(fi, 2.0) > 0.5 ? 1.0 : -1.0) + hash11(fi) * TAU;
                float radius = 0.13 + fi * 0.045 + 0.035 * u.bass;
                float2 p = float2(cos(angle), sin(angle)) * radius;
                float node = 0.012 / max(0.006, length(uv - p));
                col += mix(cyan(), violet(), fi / 13.0) * node * node * (0.12 + 0.5 * u.high);
                col += ice() * ringGlow(uv, radius, 0.001) * 0.025;
            }
            break;
        }
        case 15: { // Nebula Fold
            float2 p = rotate2(uv, t * 0.12);
            float n = fbm(p * (2.4 + u.mid * 1.7) + float2(t * 0.16, -t * 0.1));
            float fold = pow(abs(sin(n * 9.0 + r * 5.0 - t)), 9.0);
            col += mix(violet(), cyan(), n) * fold * (0.35 + 1.4 * u.energy);
            col += amber() * pow(max(0.0, n - 0.75), 2.0) * u.impact * 4.0;
            break;
        }
        case 16: { // Fracture
            float2 p = rotate2(uv, t * 0.08) * (5.0 + 4.0 * u.energy);
            float edge = voronoiEdge(p, floor(t * 1.7));
            float cracks = smoothstep(0.055 + 0.08 * u.impact, 0.005, edge);
            float cell = hash21(floor(p));
            col += mix(violet(), cyan(), cell) * cracks * (0.35 + 1.6 * pulse);
            col += ice() * step(0.82, cell) * smoothstep(0.8, 0.0, edge) * u.impact;
            break;
        }
        case 17: { // Hyperspace
            float2 polar = float2(a / TAU + 0.5, log(r + 0.025));
            float id = floor(polar.x * 180.0);
            float h = hash11(id);
            float angular = abs(fract(polar.x * 180.0) - 0.5);
            float streak = smoothstep(0.12 * h + 0.015, 0.0, angular) * step(0.52, h);
            float dash = smoothstep(0.68, 1.0, fract(polar.y * (8.0 + 12.0 * h) - t * (4.0 + 8.0 * u.energy)));
            col += mix(cyan(), violet(), h) * streak * dash * (0.4 + 1.7 * pulse) * smoothstep(1.2, 0.03, r);
            break;
        }
        case 18: { // Point Sphere
            float yaw = t * 0.42;
            for (uint i = 0; i < 72; ++i) {
                float fi = float(i);
                float y = 1.0 - 2.0 * (fi + 0.5) / 72.0;
                float rr = sqrt(max(0.0, 1.0 - y * y));
                float ang = fi * 2.399963 + yaw;
                float3 pos = float3(cos(ang) * rr, y, sin(ang) * rr);
                float perspective = 1.0 / (2.8 - pos.z);
                float2 point = pos.xy * perspective * (1.1 + 0.25 * u.bass);
                float d = length(uv - point);
                float dotv = smoothstep(0.011 + 0.008 * u.high, 0.0, d);
                col += mix(violet(), cyan(), pos.z * 0.5 + 0.5) * dotv * (0.3 + perspective + pulse);
            }
            col += ice() * ringGlow(uv, 0.43 + 0.04 * u.bass, 0.0015) * 0.07;
            break;
        }
        case 19: { // Moire Field
            float2 p1 = rotate2(uv, 0.22 * sin(t * 0.2));
            float2 p2 = rotate2(uv, -0.26 * cos(t * 0.17));
            float w1 = sin(length(p1 - float2(0.28, 0.0)) * (62.0 + 40.0 * u.mid));
            float w2 = sin(length(p2 + float2(0.28, 0.0)) * (64.0 + 38.0 * u.mid));
            float m = abs(w1 + w2);
            col += mix(violet(), cyan(), 0.5 + 0.5 * sin(a * 2.0)) * smoothstep(0.28, 0.0, m) * (0.15 + 0.85 * pulse);
            break;
        }
        case 20: { // Lightning Spokes
            float sectors = floor((a / TAU + 0.5) * 34.0);
            float jitter = (noise2(float2(sectors * 0.7, floor(r * 18.0 - t * 6.0))) - 0.5) * 0.18;
            float spoke = abs(fract((a / TAU + 0.5 + jitter) * 34.0) - 0.5);
            float gate = hash11(sectors + floor(t * 5.0));
            col += mix(cyan(), ice(), gate) * smoothstep(0.08 + 0.12 * u.high, 0.0, spoke) * step(0.58 - u.onset * 0.3, gate) * (0.5 + 1.5 * pulse);
            col += amber() * pow(0.018 / max(r, 0.018), 1.4) * u.impact;
            break;
        }
        case 21: { // Cube Lattice
            for (int z = 0; z < 6; ++z) {
                float depth = fract(float(z) / 6.0 + t * (0.08 + 0.06 * u.energy));
                float scale = mix(7.0, 1.0, depth);
                float2 p = rotate2(uv * scale, t * 0.12 + float(z));
                float2 q = abs(fract(p) - 0.5);
                float box = abs(max(q.x, q.y) - (0.25 + 0.08 * u.bass));
                float h = hash21(floor(p) + float(z));
                col += mix(violet(), cyan(), h) * lineGlow(box, 0.008) * depth * step(0.4, h) * (0.09 + 0.28 * pulse);
            }
            break;
        }
        case 22: { // Kaleido Fold
            float segments = 6.0 + floor(u.mid * 8.0) * 2.0;
            float angle = abs(fract(a / TAU * segments + 0.5) - 0.5) * TAU / segments;
            float2 p = float2(cos(angle), sin(angle)) * r;
            p = rotate2(p, t * 0.16);
            float n = fbm(p * 6.0 + float2(t * 0.35, -t * 0.2));
            float lines = pow(abs(sin(n * 12.0 + r * 15.0)), 12.0);
            col += mix(violet(), cyan(), n) * lines * (0.3 + 1.3 * pulse);
            break;
        }
        case 23: { // Ink Current
            float2 p = uv * (3.2 + u.mid) + float2(t * 0.22, -t * 0.13);
            float n = fbm(p + fbm(p * 1.7));
            float ink = smoothstep(0.045, 0.0, abs(fract(n * 5.0 + t * 0.08) - 0.5));
            col += mix(violet(), cyan(), n) * ink * (0.25 + 0.9 * pulse);
            break;
        }
        case 24: { // Spiral Galaxy
            float arms = abs(sin(a * 5.0 - log(r + 0.025) * 8.0 + t * 1.1));
            float dust = hash21(floor(float2(a * 150.0, r * 160.0 - t * 5.0)));
            float star = smoothstep(0.22 + 0.18 * u.high, 0.0, arms) * step(0.68, dust);
            col += mix(violet(), cyan(), r) * star * smoothstep(1.2, 0.02, r) * (0.55 + 1.5 * pulse);
            col += amber() * pow(0.02 / max(r, 0.02), 1.6) * (0.2 + u.impact);
            break;
        }
        case 25: { // Data Rain
            float2 p = uv * float2(24.0, 13.0);
            float column = floor(p.x);
            float speed = 1.0 + 3.0 * hash11(column);
            float y = floor(p.y + t * speed * (2.0 + u.mid * 2.0));
            float h = hash21(float2(column, y));
            float glyph = step(0.76 - 0.16 * u.high, h) * smoothstep(0.46, 0.28, abs(fract(p.x) - 0.5)) * smoothstep(0.46, 0.25, abs(fract(p.y) - 0.5));
            float head = smoothstep(0.92, 1.0, fract(p.y * 0.08 + t * speed * 0.15));
            col += mix(violet(), cyan(), head) * glyph * (0.35 + 1.3 * pulse);
            break;
        }
        case 26: { // Supernova
            float blast = pow(0.045 / max(r, 0.012), 1.45) * (0.3 + 2.2 * u.impact + u.energy);
            float angular = hash11(floor((a / TAU + 0.5) * 280.0));
            float shellRadius = 0.16 + 0.72 * u.impact + 0.06 * sin(t * 4.0);
            float shell = ringGlow(uv, shellRadius, 0.003 + 0.012 * u.onset);
            float rays = pow(angular, 7.0) * smoothstep(1.1, 0.04, r) / max(0.08, r);
            float debris = step(0.89 - 0.08 * u.high, hash21(floor(float2(a * 170.0, r * 95.0 - t * (8.0 + 8.0 * u.energy))))) * smoothstep(1.2, 0.02, r);
            col += amber() * blast + ice() * shell * (0.25 + u.impact);
            col += mix(violet(), cyan(), angular) * (rays + debris) * (0.55 + 2.2 * pulse);
            break;
        }
        case 27: { // Implosion
            float inward = fract(r * (9.0 + u.mid * 12.0) + t * (2.0 + 3.0 * u.bass));
            float ring = smoothstep(0.12, 0.0, abs(inward - 0.5));
            float suction = pow(0.016 / max(r, 0.016), 1.55);
            float twist = 0.5 + 0.5 * sin(a * 12.0 + log(r + 0.02) * 13.0 - t * 5.0);
            col += mix(violet(), cyan(), twist) * ring * twist * (0.3 + 1.7 * pulse) * smoothstep(1.2, 0.02, r);
            col += ice() * suction * (0.35 + u.impact);
            break;
        }
        case 28: { // Whiteout Shards
            float sector = floor((a / TAU + 0.5) * 42.0);
            float edge = abs(fract((a / TAU + 0.5) * 42.0) - 0.5);
            float h = hash11(sector + floor(t * 4.0));
            float shard = smoothstep(0.28 * h + 0.02, 0.0, edge) * step(r, 0.18 + h * 1.05);
            float whiteout = pow(u.impact, 2.0) * smoothstep(1.2, 0.0, r);
            col += mix(ice(), mix(cyan(), violet(), h), 0.45) * shard * (0.7 + 2.0 * pulse);
            col += float3(1.0) * whiteout * 1.5;
            break;
        }
        default: { // Final Singularity
            float fade = smoothstep(1.0, 0.35, u.sceneProgress);
            float core = pow(0.012 / max(r, 0.006), 1.8) * fade;
            float halo = ringGlow(uv, 0.10 * fade + 0.016, 0.0015) * fade;
            float embers = step(0.992 + 0.006 * u.sceneProgress, hash21(floor(uv * 190.0 + t))) * fade;
            col += ice() * core + amber() * halo * 0.08 + amber() * embers * 0.35;
            break;
        }
    }

    col += commonDust(uv, u, 0.05 + 0.12 * u.energy);
    return col;
}

kernel void visualize(device uchar4 *output [[buffer(0)]],
                      constant Uniforms &u [[buffer(1)]],
                      uint2 gid [[thread_position_in_grid]]) {
    if (gid.x >= u.width || gid.y >= u.height) return;

    float2 resolution = float2(u.width, u.height);
    float2 uv = (float2(gid) + 0.5 - 0.5 * resolution) / resolution.y;

    // Camera shake is reserved for true impacts, not raw volume.
    float shake = u.impact * u.impact * 0.012;
    uv += (hash22(float2(floor(u.time * 45.0), u.seed)) - 0.5) * shake;

    float3 a = pattern(u.mode, uv, u);
    float3 color = a;
    if (u.transition > 0.0001) {
        float3 b = pattern(u.nextMode, uv, u);
        color = mix(a, b, smoothstep(0.0, 1.0, u.transition));
        color += ice() * sin(u.transition * PI) * (0.12 + 0.55 * u.impact);
    }

    // Controlled bloom/tonemap, vignette, chromatic rhythm and fine grain.
    float vignette = smoothstep(1.12, 0.25, length(uv * float2(0.82, 1.0)));
    color *= vignette * (0.76 + 0.54 * u.rms);
    color = 1.0 - exp(-color * (1.25 + 0.7 * u.energy));
    color = pow(max(color, 0.0), float3(0.83));
    float grain = hash21(float2(gid) + floor(u.time * 60.0) * 13.7) - 0.5;
    color += grain * (0.012 + 0.012 * u.high);
    color = clamp(color, 0.0, 1.0);

    output[gid.y * u.width + gid.x] = uchar4(uchar(color.r * 255.0), uchar(color.g * 255.0), uchar(color.b * 255.0), 255);
}
