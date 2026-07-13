#!/usr/bin/env python3
"""Build frame-accurate audio features and an energy-aware 30-scene schedule."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft


SCENE_NAMES = [
    "Twin Pulse", "Contour Rings", "Starfield", "Wave Ribbons", "Vortex Dust",
    "Hex Cells", "Mirror Arcs", "Grid Tunnel", "Electric Threads", "Constellation",
    "Shock Rings", "Lissajous Bloom", "Particle Floor", "Polar Stripes", "Orbit Nodes",
    "Nebula Fold", "Fracture", "Hyperspace", "Point Sphere", "Moire Field",
    "Lightning Spokes", "Cube Lattice", "Kaleido Fold", "Ink Current", "Spiral Galaxy",
    "Data Rain", "Supernova", "Implosion", "Whiteout Shards", "Final Singularity",
]

# How naturally intense each renderer is. The scheduler maps these to equally
# ranked track sections while still shuffling close neighbors deterministically.
SCENE_INTENSITY = np.array([
    0.08, 0.15, 0.34, 0.24, 0.46, 0.25, 0.30, 0.55, 0.51, 0.28,
    0.48, 0.33, 0.45, 0.38, 0.42, 0.58, 0.78, 0.70, 0.50, 0.36,
    0.68, 0.62, 0.57, 0.40, 0.64, 0.53, 1.00, 0.72, 0.92, 0.05,
], dtype=np.float32)


def percentile_normalize(x: np.ndarray, low: float = 8, high: float = 96) -> np.ndarray:
    lo, hi = np.percentile(x, [low, high])
    return np.clip((x - lo) / (hi - lo + 1e-9), 0.0, 1.0).astype(np.float32)


def attack_decay(values: np.ndarray, decay: float) -> np.ndarray:
    result = np.zeros_like(values, dtype=np.float32)
    held = 0.0
    for i, value in enumerate(values):
        held = max(float(value), held * decay)
        result[i] = held
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--scenes", type=int, default=30)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    sample_rate, samples = wavfile.read(args.input)
    samples = samples.astype(np.float32)
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    samples /= max(1.0, float(np.max(np.abs(samples))))

    duration = len(samples) / sample_rate
    frame_count = int(np.ceil(duration * args.fps))
    frame_times = np.arange(frame_count, dtype=np.float32) / args.fps

    frequencies, times, spectrum = stft(
        samples,
        fs=sample_rate,
        nperseg=4096,
        noverlap=4096 - 512,
        window="hann",
        boundary=None,
    )
    magnitude = np.abs(spectrum).astype(np.float32)
    power = magnitude * magnitude

    def band(low: float, high: float) -> np.ndarray:
        mask = (frequencies >= low) & (frequencies < high)
        values = np.sqrt(np.mean(power[mask], axis=0) + 1e-12)
        return percentile_normalize(np.log1p(values * 250.0))

    bass_src = band(22, 180)
    mid_src = band(180, 2200)
    high_src = band(2200, 14000)
    rms_src = percentile_normalize(np.sqrt(np.mean(power, axis=0) + 1e-12))

    # Positive spectral flux follows transients far more closely than volume.
    flux_src = np.maximum(0.0, np.diff(magnitude, axis=1, prepend=magnitude[:, :1])).sum(axis=0)
    flux_src = percentile_normalize(flux_src, 40, 99.2)

    def interpolate(values: np.ndarray) -> np.ndarray:
        return np.interp(frame_times, times, values, left=values[0], right=values[-1]).astype(np.float32)

    bass = attack_decay(interpolate(bass_src), 0.84)
    mid = attack_decay(interpolate(mid_src), 0.80)
    high = attack_decay(interpolate(high_src), 0.76)
    rms = attack_decay(interpolate(rms_src), 0.88)
    onset_raw = interpolate(flux_src)
    onset = attack_decay(onset_raw, 0.74)

    bass_jump = np.maximum(0.0, np.diff(bass, prepend=bass[:1]))
    impact_raw = percentile_normalize(0.68 * onset_raw + 2.6 * bass_jump, 45, 99.0)
    impact = attack_decay(impact_raw, 0.68)

    # Tempo analysis of this track lands at ~148 BPM. Anchor the pulse to the
    # first unambiguous orchestral hit, then let actual onset drive microtiming.
    bpm = 148.0
    seconds_per_beat = 60.0 / bpm
    anchor = 26.13
    beat_phase = np.mod(frame_times - anchor, seconds_per_beat) / seconds_per_beat
    beat = np.exp(-beat_phase * 9.0).astype(np.float32)
    beat = np.maximum(beat, onset * 0.88)

    energy = np.clip(0.38 * rms + 0.32 * bass + 0.19 * mid + 0.11 * high, 0, 1).astype(np.float32)

    features = np.stack([rms, bass, mid, high, onset, beat, impact, energy], axis=1).astype("<f4")
    features.tofile(args.out_dir / "features.f32")

    # Put 30 scene changes near strong events while keeping an even visual pace.
    scene_count = args.scenes
    target_boundaries = np.linspace(0, frame_count, scene_count + 1)
    boundaries = [0]
    score = 1.8 * onset_raw + 1.5 * impact_raw + 0.25 * beat + 0.15 * energy
    radius = int(args.fps * 1.15)
    min_scene = int(args.fps * 3.4)
    for target in target_boundaries[1:-1]:
        center = int(round(target))
        lower = max(boundaries[-1] + min_scene, center - radius)
        upper = min(frame_count - min_scene, center + radius)
        if upper <= lower:
            chosen = max(boundaries[-1] + min_scene, min(center, frame_count - min_scene))
        else:
            local = score[lower:upper]
            proximity = 0.16 * (1.0 - np.abs(np.arange(lower, upper) - center) / max(1, radius))
            chosen = lower + int(np.argmax(local + proximity))
        boundaries.append(chosen)
    boundaries.append(frame_count)

    scene_energy = np.array([
        float(np.mean(energy[boundaries[i]:boundaries[i + 1]]))
        for i in range(scene_count)
    ])
    rng = np.random.default_rng(73421)
    mode_rank = np.argsort(SCENE_INTENSITY + rng.uniform(-0.025, 0.025, scene_count))
    slot_rank = np.argsort(scene_energy + rng.uniform(-0.015, 0.015, scene_count))
    modes = np.empty(scene_count, dtype=np.int32)
    modes[slot_rank] = mode_rank

    # Lock the user's requested twin in/out pulse as the opening and the
    # singularity as the ending; swap so every mode still appears exactly once.
    def force_mode(slot: int, mode: int) -> None:
        current_slot = int(np.where(modes == mode)[0][0])
        modes[current_slot], modes[slot] = modes[slot], modes[current_slot]

    force_mode(0, 0)
    force_mode(scene_count - 1, 29)
    force_mode(int(np.argmax(scene_energy)), 26)

    schedule = {
        "fps": args.fps,
        "duration": duration,
        "frameCount": frame_count,
        "featureStride": 8,
        "bpm": bpm,
        "boundaries": boundaries,
        "modes": modes.tolist(),
        "sceneNames": SCENE_NAMES,
        "sceneEnergy": [round(x, 4) for x in scene_energy.tolist()],
    }
    (args.out_dir / "schedule.json").write_text(json.dumps(schedule, indent=2))

    print(f"duration={duration:.3f}s frames={frame_count} fps={args.fps:g}")
    for index, mode in enumerate(modes):
        start, end = boundaries[index] / args.fps, boundaries[index + 1] / args.fps
        print(f"{index + 1:02d} {start:6.2f}-{end:6.2f}  E={scene_energy[index]:.2f}  {mode:02d} {SCENE_NAMES[mode]}")


if __name__ == "__main__":
    main()
