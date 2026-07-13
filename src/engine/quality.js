// Adaptive quality management. Picks an initial tier from device signals,
// then walks up or down based on measured frame time. Dynamic resolution is
// adjusted separately and continuously within the active tier.

export const TIERS = [
  { name: 'mobile', simSize: 128, pixelRatio: 1, raymarch: false, raymarchScale: 0.35, steps: 44 },
  { name: 'balanced', simSize: 256, pixelRatio: 1.25, raymarch: true, raymarchScale: 0.42, steps: 64 },
  { name: 'high', simSize: 512, pixelRatio: 1.5, raymarch: true, raymarchScale: 0.5, steps: 96 },
];

export function detectInitialTier() {
  const compact = window.matchMedia('(max-width: 700px)').matches;
  const memory = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (compact || memory <= 4 || cores <= 4) return 0;
  if (memory <= 6 || cores <= 6) return 1;
  return 2;
}

export class QualityGovernor {
  constructor(tierIndex, onTierChange) {
    this.tierIndex = tierIndex;
    this.onTierChange = onTierChange;
    this.samples = [];
    this.cooldown = 0;
    this.resolutionScale = 1;
  }

  get tier() { return TIERS[this.tierIndex]; }

  update(delta) {
    this.samples.push(delta);
    if (this.samples.length > 90) this.samples.shift();
    if (this.cooldown > 0) { this.cooldown -= delta; return; }
    if (this.samples.length < 60) return;

    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;

    // First lever: dynamic resolution inside the tier.
    if (avg > 1 / 45 && this.resolutionScale > 0.6) {
      this.resolutionScale = Math.max(0.6, this.resolutionScale - 0.1);
      this.cooldown = 1.5;
      this.onTierChange?.(this.tierIndex, this.resolutionScale);
      return;
    }
    if (avg < 1 / 58 && this.resolutionScale < 1) {
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.1);
      this.cooldown = 2.5;
      this.onTierChange?.(this.tierIndex, this.resolutionScale);
      return;
    }

    // Second lever: drop or raise the whole tier.
    if (avg > 1 / 30 && this.resolutionScale <= 0.6 && this.tierIndex > 0) {
      this.tierIndex -= 1;
      this.resolutionScale = 1;
      this.samples.length = 0;
      this.cooldown = 4;
      this.onTierChange?.(this.tierIndex, this.resolutionScale);
    } else if (avg < 1 / 59 && this.resolutionScale >= 1 && this.tierIndex < TIERS.length - 1) {
      this.tierIndex += 1;
      this.samples.length = 0;
      this.cooldown = 6;
      this.onTierChange?.(this.tierIndex, this.resolutionScale);
    }
  }
}
