import './style.css';
import { AudioEngine } from './audio.js';
import { PATTERNS, Visualizer } from './visualizer.js';
import { EngineV2 } from './engine/engine.js';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const fileInput = $('#file-input');
const uploadButton = $('#upload-button');
const replaceButton = $('#replace-button');
const sampleButton = $('#sample-button');
const playButton = $('#play-button');
const soundToggle = $('#sound-toggle');
const player = $('#player');
const trackName = $('#track-name');
const timeline = $('#timeline');
const elapsedLabel = $('#elapsed');
const durationLabel = $('#duration');
const patternCount = $('#pattern-count');
const patternName = $('#pattern-name');
const status = $('#status');
const sampleOutputButton = $('#sample-output-button');
const sampleModal = $('#sample-modal');
const closeModalButton = $('#close-modal');
const sampleVideo = $('#sample-video');

const silentFeatures = { rms: 0, bass: 0, mid: 0, high: 0, energy: 0, onset: 0, beat: 0, impact: 0 };
const audio = new AudioEngine();
let visualizer;
let statusTimer;
let dragDepth = 0;
let userSeeking = false;
let lastFrame = performance.now();
let lastUiUpdate = 0;

function showStatus(message, timeout = 4200) {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  status.classList.add('visible');
  if (timeout) statusTimer = window.setTimeout(() => status.classList.remove('visible'), timeout);
}

function hideStatus() {
  window.clearTimeout(statusTimer);
  status.classList.remove('visible');
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function updatePattern(index, name) {
  patternCount.textContent = `${String(index + 1).padStart(2, '0')} / ${PATTERNS.length}`;
  patternName.textContent = name;
}

// Engine V2 (stateful GPU simulation + raymarched environments) is the
// primary renderer; the original visualizer remains the verified fallback
// for browsers without WebGL2 float render targets.
const forceLegacy = new URLSearchParams(window.location.search).get('engine') === 'v1';
try {
  if (forceLegacy) throw Object.assign(new Error('Legacy engine requested.'), { engineUnsupported: true });
  visualizer = new EngineV2($('#visual-stage'), updatePattern);
} catch (engineError) {
  console.warn('Engine V2 unavailable, using fallback renderer.', engineError);
  try {
    visualizer = new Visualizer($('#visual-stage'), updatePattern);
  } catch (error) {
    showStatus('WebGL konnte nicht gestartet werden. Bitte öffne MuseVis in einem aktuellen Browser.', 0);
    throw error;
  }
}
window.__musevis = { visualizer, audio };

function setPlayingUi(playing) {
  playButton.classList.toggle('paused', !playing);
  playButton.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
}

function activatePlayer() {
  app.classList.add('is-playing');
  player.hidden = false;
  soundToggle.hidden = false;
  trackName.textContent = audio.name;
  durationLabel.textContent = formatTime(audio.duration);
  setPlayingUi(!audio.paused);
}

async function loadTrack(loader) {
  showStatus('Track wird lokal analysiert …', 0);
  try {
    await loader();
    visualizer.startTrack(`${audio.name}:${audio.duration.toFixed(2)}`);
    activatePlayer();
    hideStatus();
  } catch (error) {
    showStatus(error?.message || 'Der Track konnte nicht gestartet werden.');
  }
}

async function loadFile(file) {
  if (!file) return;
  await loadTrack(() => audio.loadFile(file));
  fileInput.value = '';
}

uploadButton.addEventListener('click', () => fileInput.click());
replaceButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => loadFile(fileInput.files?.[0]));

sampleButton.addEventListener('click', () => {
  const sampleUrl = `${import.meta.env.BASE_URL}sample-track.m4a`;
  loadTrack(() => audio.load(sampleUrl, 'Court Scheme — Roberto Prado'));
});

playButton.addEventListener('click', async () => {
  try { await audio.toggle(); }
  catch { showStatus('Die Wiedergabe konnte nicht gestartet werden.'); }
});

soundToggle.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  soundToggle.classList.toggle('muted', audio.muted);
  soundToggle.setAttribute('aria-label', audio.muted ? 'Ton einschalten' : 'Ton stummschalten');
});

audio.audio.addEventListener('play', () => setPlayingUi(true));
audio.audio.addEventListener('pause', () => setPlayingUi(false));
audio.audio.addEventListener('ended', () => setPlayingUi(false));

timeline.addEventListener('pointerdown', () => { userSeeking = true; });
timeline.addEventListener('input', () => {
  const progress = Number(timeline.value) / 1000;
  timeline.style.setProperty('--progress', `${progress * 100}%`);
  elapsedLabel.textContent = formatTime(progress * audio.duration);
});
timeline.addEventListener('change', () => {
  audio.seek(Number(timeline.value) / 1000);
  userSeeking = false;
});
timeline.addEventListener('pointerup', () => { userSeeking = false; });

for (const eventName of ['dragenter', 'dragover']) {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === 'dragenter') dragDepth += 1;
    app.classList.add('dragging');
  });
}
window.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) app.classList.remove('dragging');
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  app.classList.remove('dragging');
  loadFile(event.dataTransfer?.files?.[0]);
});

sampleOutputButton.addEventListener('click', () => {
  if (!audio.paused) audio.audio.pause();
  sampleModal.showModal();
});
closeModalButton.addEventListener('click', () => sampleModal.close());
sampleModal.addEventListener('click', (event) => {
  if (event.target === sampleModal) sampleModal.close();
});
sampleModal.addEventListener('close', () => {
  sampleVideo.pause();
  sampleVideo.currentTime = 0;
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || sampleModal.open || !app.classList.contains('is-playing')) return;
  if (['INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
  event.preventDefault();
  audio.toggle().catch(() => showStatus('Die Wiedergabe konnte nicht gestartet werden.'));
});

function frame(now) {
  const delta = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const features = audio.update() || silentFeatures;
  visualizer.update(delta, audio.currentTime, features, !audio.paused);

  if (now - lastUiUpdate > 100 && app.classList.contains('is-playing')) {
    lastUiUpdate = now;
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    if (!userSeeking) {
      timeline.value = String(Math.round(progress * 1000));
      timeline.style.setProperty('--progress', `${progress * 100}%`);
      elapsedLabel.textContent = formatTime(audio.currentTime);
    }
    durationLabel.textContent = formatTime(audio.duration);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => {
  audio.destroy();
  visualizer.destroy();
});
