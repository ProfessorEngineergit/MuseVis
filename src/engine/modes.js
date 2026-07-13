// Visual Engine V2 mode catalogue.
//
// Every mode keeps its canonical formation (`form` indexes the 30 pattern
// formulas in shaders/lib.glsl.js) but layers a distinct physical character
// on top of it: spring stiffness toward the formation, curl-noise flow,
// vortex suction, central gravity well (negative = repulsion), drag, and
// audio-driven jitter. `env` selects a raymarched SDF environment
// (-1 = pure void). `flat` collapses the field into a graphic 2D plane.
// `transition` picks how the mode is entered on a beat/impact/section change.
//
// energy: which track intensity the scheduler matches this mode to (0..1).
// trail: afterimage persistence while the mode is active (0..~0.94).

export const TRANSITIONS = {
  MORPH: 0,      // particle-preserving spring morph, velocity carry-over
  BURST: 1,      // outward impulse kick into the new field
  IMPLODE: 2,    // gravity-well collapse, then release into the new field
  DIVE: 3,       // camera dive along z while fields swap
  CUT: 4,        // hard graphic cut: particles snap, one-frame flash
  WHITEOUT: 5,   // controlled whiteout flash, new field revealed underneath
  FLATTEN: 6,    // 3D field flattens to 2D, then re-inflates as the new mode
};

export const ENVS = {
  NONE: -1,
  TUNNEL: 0,     // mirrored tunnel, infinite repetition
  MONOLITH: 1,   // reflective metallic monoliths over a mirror floor
  SPHERE: 2,     // refractive liquid-glass sphere
  FOLD: 3,       // infinite folded kaleidoscopic geometry
  PORTAL: 4,     // luminous portal ring over a reflective floor
  CHAMBER: 5,    // volumetric particle chamber with light shafts
};

const T = TRANSITIONS;
const E = ENVS;

// name, energy, form, {physics + staging}
const M = (name, energy, form, o = {}) => ({
  name,
  energy,
  form,
  spring: o.spring ?? 3.2,
  curl: o.curl ?? 0.5,
  curlScale: o.curlScale ?? 0.55,
  vortex: o.vortex ?? 0,
  well: o.well ?? 0,
  drag: o.drag ?? 3.4,
  jitter: o.jitter ?? 0.2,
  flat: o.flat ?? 0,
  env: o.env ?? E.NONE,
  trail: o.trail ?? 0.55,
  transition: o.transition ?? T.MORPH,
  camera: o.camera ?? 'drift', // drift | orbit | tunnel | still | dive
  fov: o.fov ?? 54,
  dist: o.dist ?? 7.2,
});

export const MODES = [
  M('Twin Pulse', 0.08, 0, { spring: 5.5, curl: 0.22, drag: 4.6, env: E.SPHERE, trail: 0.4, camera: 'still', transition: T.MORPH }),
  M('Contour Rings', 0.16, 1, { spring: 4.0, curl: 0.3, flat: 1, trail: 0.62, camera: 'still', transition: T.FLATTEN }),
  M('Starfield', 0.34, 2, { spring: 2.4, curl: 0.35, drag: 2.6, env: E.CHAMBER, trail: 0.7, camera: 'tunnel', transition: T.DIVE }),
  M('Wave Ribbons', 0.24, 3, { spring: 4.5, curl: 0.45, trail: 0.66, camera: 'drift', transition: T.MORPH }),
  M('Vortex Dust', 0.46, 4, { spring: 1.6, curl: 0.85, vortex: 2.6, drag: 2.2, trail: 0.78, camera: 'orbit', transition: T.BURST }),
  M('Hex Cells', 0.25, 5, { spring: 6.5, curl: 0.12, jitter: 0.1, flat: 1, trail: 0.3, camera: 'still', transition: T.CUT }),
  M('Double Helix', 0.3, 6, { spring: 5.0, curl: 0.3, vortex: 0.7, env: E.CHAMBER, trail: 0.6, camera: 'orbit', transition: T.MORPH }),
  M('Grid Tunnel', 0.56, 7, { spring: 3.6, curl: 0.3, drag: 3.0, env: E.TUNNEL, trail: 0.68, camera: 'tunnel', transition: T.DIVE, fov: 62 }),
  M('Electric Threads', 0.52, 8, { spring: 5.5, curl: 0.75, curlScale: 1.4, jitter: 0.6, flat: 1, trail: 0.5, camera: 'still', transition: T.CUT }),
  M('Constellation', 0.28, 9, { spring: 2.8, curl: 0.18, drag: 4.2, env: E.MONOLITH, trail: 0.44, camera: 'drift', transition: T.MORPH }),
  M('Shock Rings', 0.49, 10, { spring: 4.2, curl: 0.2, well: -1.4, flat: 1, trail: 0.6, camera: 'still', transition: T.BURST }),
  M('Lissajous Bloom', 0.34, 11, { spring: 3.0, curl: 0.4, trail: 0.82, camera: 'orbit', transition: T.MORPH }),
  M('Particle Floor', 0.45, 12, { spring: 3.4, curl: 0.34, env: E.MONOLITH, trail: 0.6, camera: 'drift', dist: 6.4, transition: T.DIVE }),
  M('Polar Stripes', 0.39, 13, { spring: 5.2, curl: 0.2, flat: 1, trail: 0.5, camera: 'still', transition: T.FLATTEN }),
  M('Orbit Nodes', 0.42, 14, { spring: 2.2, curl: 0.25, vortex: 1.2, drag: 2.4, env: E.SPHERE, trail: 0.72, camera: 'orbit', transition: T.MORPH }),
  M('Nebula Fold', 0.59, 15, { spring: 1.8, curl: 1.0, curlScale: 0.4, drag: 2.0, env: E.FOLD, trail: 0.84, camera: 'orbit', transition: T.MORPH }),
  M('Fracture', 0.79, 16, { spring: 5.4, curl: 0.6, well: -0.9, jitter: 0.45, trail: 0.42, camera: 'drift', transition: T.BURST }),
  M('Hyperspace', 0.71, 17, { spring: 3.0, curl: 0.25, drag: 2.2, env: E.TUNNEL, trail: 0.86, camera: 'tunnel', transition: T.DIVE, fov: 70 }),
  M('Point Sphere', 0.5, 18, { spring: 4.4, curl: 0.4, env: E.SPHERE, trail: 0.55, camera: 'orbit', transition: T.MORPH }),
  M('Moiré Field', 0.36, 19, { spring: 6.0, curl: 0.15, flat: 1, trail: 0.36, camera: 'still', transition: T.FLATTEN }),
  M('Lightning Spokes', 0.69, 20, { spring: 5.8, curl: 0.7, curlScale: 1.8, jitter: 1.0, flat: 1, trail: 0.55, camera: 'still', transition: T.CUT }),
  M('Cube Lattice', 0.63, 21, { spring: 5.0, curl: 0.25, env: E.FOLD, trail: 0.5, camera: 'orbit', transition: T.MORPH }),
  M('Kaleido Fold', 0.58, 22, { spring: 3.2, curl: 0.55, vortex: 0.8, env: E.FOLD, trail: 0.7, camera: 'orbit', transition: T.MORPH }),
  M('Ink Current', 0.4, 23, { spring: 2.0, curl: 0.95, curlScale: 0.7, drag: 2.0, trail: 0.85, camera: 'drift', transition: T.MORPH }),
  M('Spiral Galaxy', 0.65, 24, { spring: 2.4, curl: 0.45, vortex: 1.8, drag: 2.4, env: E.CHAMBER, trail: 0.78, camera: 'orbit', dist: 8.0, transition: T.MORPH }),
  M('Data Rain', 0.53, 25, { spring: 4.8, curl: 0.2, jitter: 0.3, flat: 1, trail: 0.66, camera: 'still', transition: T.CUT }),
  M('Supernova', 1.0, 26, { spring: 2.6, curl: 0.5, well: -3.4, jitter: 0.7, env: E.PORTAL, trail: 0.6, camera: 'dive', transition: T.WHITEOUT }),
  M('Implosion', 0.74, 27, { spring: 2.8, curl: 0.4, well: 3.2, vortex: 1.4, env: E.PORTAL, trail: 0.74, camera: 'dive', transition: T.IMPLODE }),
  M('Whiteout Shards', 0.93, 28, { spring: 5.6, curl: 0.65, well: -0.8, jitter: 0.5, trail: 0.4, camera: 'drift', transition: T.WHITEOUT }),
  M('Singularity', 0.05, 29, { spring: 3.6, curl: 0.18, well: 1.6, vortex: 0.9, drag: 4.0, env: E.CHAMBER, trail: 0.8, camera: 'still', dist: 5.6, transition: T.IMPLODE }),
];

export const PATTERNS = MODES.map((mode) => [mode.name, mode.energy]);
