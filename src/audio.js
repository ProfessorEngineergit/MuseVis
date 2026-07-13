const clamp01 = (value) => Math.min(1, Math.max(0, value));

export class AudioEngine {
  constructor() {
    this.context = null;
    this.analyser = null;
    this.sourceNode = null;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.playsInline = true;

    this.frequency = null;
    this.previousFrequency = null;
    this.waveform = null;
    this.objectUrl = null;
    this.name = '';
    this.features = {
      rms: 0,
      bass: 0,
      mid: 0,
      high: 0,
      energy: 0,
      onset: 0,
      beat: 0,
      impact: 0,
    };
    this.energyAverage = 0.12;
    this.previousEnergy = 0;
    this.lastBeatTime = -1;
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio wird von diesem Browser nicht unterstützt.');
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.46;
      this.analyser.minDecibels = -92;
      this.analyser.maxDecibels = -16;
      this.sourceNode = this.context.createMediaElementSource(this.audio);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.frequency = new Uint8Array(this.analyser.frequencyBinCount);
      this.previousFrequency = new Uint8Array(this.analyser.frequencyBinCount);
      this.waveform = new Uint8Array(this.analyser.fftSize);
    }
    // A real click resumes immediately. Some embedded browsers keep the
    // promise pending until audio actually starts, so do not block file loading.
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  async loadFile(file) {
    if (!file || (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name))) {
      throw new Error('Bitte wähle eine unterstützte Audiodatei.');
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '') || 'Untitled track';
    await this.load(this.objectUrl, name);
  }

  async load(url, name = 'Sample track') {
    await this.ensureContext();
    this.audio.pause();
    this.audio.src = url;
    this.name = name;
    this.resetAnalysis();

    await new Promise((resolve, reject) => {
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Der Track konnte nicht gelesen werden.')); };
      const cleanup = () => {
        this.audio.removeEventListener('loadedmetadata', ready);
        this.audio.removeEventListener('error', failed);
      };
      this.audio.addEventListener('loadedmetadata', ready, { once: true });
      this.audio.addEventListener('error', failed, { once: true });
      if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) ready();
      else this.audio.load();
    });

    try {
      await this.audio.play();
    } catch (error) {
      // Autoplay policy may still require a second explicit press. The track is
      // ready, so expose the player instead of leaving the loading state stuck.
      if (!['NotAllowedError', 'AbortError'].includes(error?.name)) throw error;
    }
  }

  resetAnalysis() {
    Object.keys(this.features).forEach((key) => { this.features[key] = 0; });
    this.energyAverage = 0.12;
    this.previousEnergy = 0;
    this.lastBeatTime = -1;
    this.previousFrequency?.fill(0);
  }

  setMuted(muted) { this.audio.muted = muted; }
  get muted() { return this.audio.muted; }
  get paused() { return this.audio.paused; }
  get duration() { return Number.isFinite(this.audio.duration) ? this.audio.duration : 0; }
  get currentTime() { return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0; }

  async toggle() {
    await this.ensureContext();
    if (this.audio.paused) await this.audio.play();
    else this.audio.pause();
  }

  seek(progress) {
    if (this.duration) this.audio.currentTime = clamp01(progress) * this.duration;
  }

  band(lowHz, highHz) {
    const nyquist = this.context.sampleRate / 2;
    const first = Math.max(0, Math.floor((lowHz / nyquist) * this.frequency.length));
    const last = Math.min(this.frequency.length - 1, Math.ceil((highHz / nyquist) * this.frequency.length));
    let sum = 0;
    for (let i = first; i <= last; i += 1) {
      const value = this.frequency[i] / 255;
      sum += value * value;
    }
    return Math.sqrt(sum / Math.max(1, last - first + 1));
  }

  smooth(current, target, attack = 0.32, release = 0.08) {
    return current + (target - current) * (target > current ? attack : release);
  }

  update() {
    if (!this.analyser || this.audio.paused) {
      for (const key of Object.keys(this.features)) this.features[key] *= key === 'beat' ? 0.82 : 0.94;
      return this.features;
    }

    this.analyser.getByteFrequencyData(this.frequency);
    this.analyser.getByteTimeDomainData(this.waveform);

    let rmsSum = 0;
    for (let i = 0; i < this.waveform.length; i += 1) {
      const sample = (this.waveform[i] - 128) / 128;
      rmsSum += sample * sample;
    }
    const rmsRaw = clamp01(Math.sqrt(rmsSum / this.waveform.length) * 2.7);
    const bassRaw = clamp01(this.band(24, 190) * 1.36);
    const midRaw = clamp01(this.band(190, 2400) * 1.26);
    const highRaw = clamp01(this.band(2400, 14500) * 1.5);

    let flux = 0;
    for (let i = 1; i < this.frequency.length * 0.72; i += 2) {
      flux += Math.max(0, this.frequency[i] - this.previousFrequency[i]);
      this.previousFrequency[i] = this.frequency[i];
    }
    const onsetRaw = clamp01((flux / (this.frequency.length * 0.36)) / 22);
    const energyRaw = clamp01(rmsRaw * 0.32 + bassRaw * 0.36 + midRaw * 0.2 + highRaw * 0.12);
    const rise = Math.max(0, energyRaw - this.previousEnergy);

    this.energyAverage += (energyRaw - this.energyAverage) * 0.018;
    const now = this.currentTime;
    const beatDetected = (
      now - this.lastBeatTime > 0.24
      && bassRaw > 0.16
      && (energyRaw > this.energyAverage * 1.16 || onsetRaw > 0.22)
    );
    if (beatDetected) this.lastBeatTime = now;

    this.features.rms = this.smooth(this.features.rms, rmsRaw, 0.38, 0.09);
    this.features.bass = this.smooth(this.features.bass, bassRaw, 0.46, 0.1);
    this.features.mid = this.smooth(this.features.mid, midRaw, 0.34, 0.09);
    this.features.high = this.smooth(this.features.high, highRaw, 0.29, 0.08);
    this.features.energy = this.smooth(this.features.energy, energyRaw, 0.3, 0.055);
    this.features.onset = Math.max(this.features.onset * 0.76, onsetRaw);
    this.features.beat = Math.max(this.features.beat * 0.83, beatDetected ? 1 : onsetRaw * 0.58);
    this.features.impact = Math.max(this.features.impact * 0.79, clamp01(onsetRaw * 1.25 + rise * 3.2));

    this.previousEnergy = energyRaw;
    return this.features;
  }

  destroy() {
    this.audio.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.sourceNode?.disconnect();
    this.analyser?.disconnect();
    this.context?.close();
  }
}
