# MuseVis product instructions

These rules apply to the entire repository.

## Product

- MuseVis is a static, browser-based music visualizer intended for GitHub Pages.
- A visitor selects a local audio file and immediately gets an audio-reactive Three.js experience.
- The visual identity is cinematic and restrained: near-black space, electric cyan, ultraviolet, cold white, and rare amber at major impacts.
- The experience should alternate clearly between spatial 3D particle systems and graphic 2D patterns.
- Maintain roughly 30 distinct visual modes. Their order may be deterministic-random, but selection and transitions must respond to track energy, beats, and impacts.
- The included Court Scheme render is the canonical sample output. Keep it accessible from the interface without making it the primary experience.

## Technical constraints

- Everything must build and run as static files on GitHub Pages. Do not introduce a backend, database, server function, required API key, or runtime CDN dependency.
- Audio files selected by visitors stay on their device. Do not upload, persist, log, fingerprint, or transmit their contents or metadata.
- Preserve GitHub project-page compatibility: built asset and media URLs must work below a repository subpath.
- Keep audio analysis and animation in real time. Prefer GPU-side particle transforms and avoid per-frame CPU geometry reconstruction.
- Support current desktop and mobile browsers with WebGL and the Web Audio API. Require an explicit user gesture before audio playback.
- Keep controls keyboard-accessible, readable over changing visuals, and usable on narrow screens.
- Respect reduced-motion preferences without removing the core audio-reactive experience.
- Do not add analytics, trackers, advertising, cookie banners, accounts, social feeds, or unrelated product features.

## Content and maintenance

- Keep interface copy short and direct. Do not mention implementation history, AI-generated imagery, internal tools, or this conversation in the product UI.
- Do not replace the visualizer with stock footage, pre-rendered loops, generic equalizer bars, or decorative placeholders.
- Treat `public/sample-track.m4a` and `public/sample-output.mp4` as intentional demo assets. Optimize them for web delivery before replacing them.
- Before shipping, run the production build and test the built site through a local HTTP server, including local-file upload, sample playback, responsive layout, and the sample-output dialog.
