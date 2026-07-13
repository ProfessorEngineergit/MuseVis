# MuseVis

MuseVis turns a local audio file into a real-time Three.js particle visualization. The selected file is analyzed entirely in the browser and is never uploaded.

## Rendering architecture (Visual Engine V2)

The renderer lives in `src/engine/` and is organised as independent systems:

- **`sim.js` — GPU particle simulation.** Particle state (position + lifetime, velocity + kinetic heat) is stored in two floating-point textures updated through ping-pong WebGL2 MRT framebuffers. Every particle physically chases a formation target while curl-noise flow fields, vortices, gravity wells, springs and audio-driven impulses act on it. Because state persists on the GPU, mode changes are particle-preserving morphs with velocity carry-over. Desktop-high runs 262,144 particles (512² state textures); balanced 65,536; mobile 16,384.
- **`shaders/lib.glsl.js` — shared GLSL.** The 30 canonical MuseVis formations plus noise/curl helpers, shared by the simulation and any pass that needs them.
- **`raymarch.js` — SDF environments.** A raymarched layer rendered at reduced resolution and composited behind the particles: mirrored tunnel, reflective monoliths over a mirror floor, refractive liquid-glass sphere, infinite folded geometry, luminous portal, volumetric chamber. Lighting uses procedural environment light, Fresnel, one reflection bounce against the SDF, soft shadows and cheap ambient occlusion. (This is high-quality raymarching, not hardware ray tracing.)
- **`modes.js` — 30 mode definitions.** Each mode keeps its legacy formation but adds a physics profile (spring/curl/vortex/well/drag), an optional environment, a camera rig, a trail persistence and a transition style (morph, burst, implosion, camera dive, hard cut, controlled whiteout, 2D flatten).
- **`post.js` — cinematic post pipeline.** Temporal trails (afterimage) → HDR bloom → final grade with a filmic tone curve, impact-driven chromatic aberration, whiteout flash, film grain and vignette.
- **`quality.js` — adaptive quality.** Initial tier from device signals, then dynamic resolution and tier promotion/demotion from measured frame time.
- **`engine.js` — orchestrator.** Owns scheduling (beat/impact/section-aware transitions), camera rigs, uniform blending between modes and WebGL context-loss recovery.

Audio analysis (`src/audio.js`) separates sub-bass/bass/low-mid/high-mid/treble, RMS, spectral flux, transient strength, beat pulse, approximate tempo, dynamic range and section-change likelihood. When a track loads, it is additionally decoded once and scanned for section boundaries in a Web Worker — still entirely on-device.

The original single-shader renderer (`src/visualizer.js`) remains as the verified fallback for browsers without WebGL2 float render targets, and can be forced with `?engine=v1`.

## Local development

```sh
npm install
npm run dev
```

## Production build

```sh
npm ci
npm run build
npm run preview
```

The output in `dist/` is fully static. `vite.config.js` uses relative asset URLs so the same build works on a GitHub user page, a custom domain, or a repository project page.

## GitHub Pages

1. Push the repository to a `main` branch on GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy-pages.yml` builds and deploys the site on every push to `main`.

The sample media is intentionally included under `public/` and copied into the Pages artifact during the build.
