// Voice Exercise Hub: pitch scales, arpeggios, and a breathing timer.
// Tones are synthesized client-side (see utils/audioSynth.js) so this
// works with zero hosted audio assets.
import { playMidiSequence, playChime } from '../utils/audioSynth.js';
import { t } from '../i18n.js';

const ROOT_NOTES = [
  { label: 'C3', midi: 48 }, { label: 'D3', midi: 50 }, { label: 'E3', midi: 52 },
  { label: 'F3', midi: 53 }, { label: 'G3', midi: 55 }, { label: 'A3', midi: 57 },
  { label: 'B3', midi: 59 }, { label: 'C4', midi: 60 }, { label: 'D4', midi: 62 },
  { label: 'E4', midi: 64 }, { label: 'F4', midi: 65 }, { label: 'G4', midi: 67 },
  { label: 'A4', midi: 69 }, { label: 'B4', midi: 71 }, { label: 'C5', midi: 72 },
];

const PATTERNS = {
  scale: [0, 2, 4, 5, 7, 9, 11, 12],
  arpeggio: [0, 4, 7, 12],
};

// `id` drives logic (transform direction, chime pitch); its display label
// is looked up separately via t() so it re-renders in the active language.
const BREATHING_PRESETS = {
  box: { labelKey: 'voiceExercises.breathing.box', phases: [
    { id: 'inhale', seconds: 4 }, { id: 'hold', seconds: 4 },
    { id: 'exhale', seconds: 4 }, { id: 'hold', seconds: 4 },
  ] },
  relaxing: { labelKey: 'voiceExercises.breathing.relaxing', phases: [
    { id: 'inhale', seconds: 4 }, { id: 'hold', seconds: 7 }, { id: 'exhale', seconds: 8 },
  ] },
  simple: { labelKey: 'voiceExercises.breathing.simple', phases: [
    { id: 'inhale', seconds: 4 }, { id: 'exhale', seconds: 4 },
  ] },
};

function phaseLabelFor(phaseId) {
  return t(`voiceExercises.phase.${phaseId}`);
}

export function renderVoiceExercises(container) {
  container.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow p-5">
        <h2 class="text-lg font-semibold mb-4">${t('voiceExercises.pitchTitle')}</h2>

        <div class="flex flex-wrap gap-4 mb-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('voiceExercises.rootNote')}</label>
            <select data-el="root-note" class="border border-slate-300 rounded-lg px-3 py-2"></select>
          </div>
          <div class="flex-1 min-w-[10rem]">
            <label class="block text-sm font-medium text-slate-600 mb-1">
              ${t('voiceExercises.tempo')} <span data-el="tempo-label" class="text-slate-400 font-normal"></span>
            </label>
            <input type="range" data-el="tempo" min="200" max="800" step="50" value="350" class="w-full" />
          </div>
        </div>

        <div data-el="note-track" class="flex flex-wrap gap-1.5 mb-4 min-h-[2rem]"></div>

        <div class="flex gap-3">
          <button type="button" data-action="play-scale"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            ${t('voiceExercises.playScale')}
          </button>
          <button type="button" data-action="play-arpeggio"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            ${t('voiceExercises.playArpeggio')}
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow p-5">
        <h2 class="text-lg font-semibold mb-4">${t('voiceExercises.breathingTitle')}</h2>

        <label class="block text-sm font-medium text-slate-600 mb-1">${t('voiceExercises.pattern')}</label>
        <select data-el="breathing-pattern" class="border border-slate-300 rounded-lg px-3 py-2 mb-4 w-full sm:w-auto">
          ${Object.entries(BREATHING_PRESETS).map(([key, p]) => `<option value="${key}">${t(p.labelKey)}</option>`).join('')}
        </select>

        <div class="flex flex-col items-center py-4">
          <div data-el="breath-circle"
               class="w-32 h-32 rounded-full bg-indigo-200 border-4 border-indigo-400 flex items-center justify-center transition-transform ease-in-out"
               style="transform: scale(1);">
            <span data-el="breath-phase" class="text-indigo-800 font-semibold text-sm">${t('voiceExercises.ready')}</span>
          </div>
          <div data-el="breath-countdown" class="mt-3 text-2xl font-bold text-slate-700">—</div>
        </div>

        <div class="flex justify-center">
          <button type="button" data-action="toggle-breathing"
                  class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
            ${t('voiceExercises.start')}
          </button>
        </div>
      </div>
    </div>
  `;

  setupPitchExercises(container);
  setupBreathingTimer(container);
}

function setupPitchExercises(container) {
  const rootSelect = container.querySelector('[data-el="root-note"]');
  const tempoInput = container.querySelector('[data-el="tempo"]');
  const tempoLabel = container.querySelector('[data-el="tempo-label"]');
  const noteTrack = container.querySelector('[data-el="note-track"]');
  const scaleBtn = container.querySelector('[data-action="play-scale"]');
  const arpeggioBtn = container.querySelector('[data-action="play-arpeggio"]');

  rootSelect.innerHTML = ROOT_NOTES.map((n) => `<option value="${n.midi}" ${n.label === 'C4' ? 'selected' : ''}>${n.label}</option>`).join('');

  const updateTempoLabel = () => { tempoLabel.textContent = `${tempoInput.value} ms/note`; };
  tempoInput.addEventListener('input', updateTempoLabel);
  updateTempoLabel();

  let activeController = null;

  function buildFullPattern(intervals) {
    return intervals.concat(intervals.slice(0, -1).reverse());
  }

  function playPattern(intervals, button) {
    if (activeController) {
      activeController.stop();
      activeController = null;
      resetButtons();
      return;
    }

    const rootMidi = Number(rootSelect.value);
    const fullPattern = buildFullPattern(intervals);
    const midiNotes = fullPattern.map((interval) => rootMidi + interval);
    const noteDurationSec = Number(tempoInput.value) / 1000;

    noteTrack.innerHTML = midiNotes.map(() =>
      `<span class="w-6 h-6 rounded-full bg-slate-200 flex-shrink-0"></span>`
    ).join('');
    const bubbles = [...noteTrack.children];

    setButtonPlaying(button);

    activeController = playMidiSequence(midiNotes, noteDurationSec, {
      onNoteStart(i) {
        bubbles.forEach((b, idx) => b.className = `w-6 h-6 rounded-full flex-shrink-0 ${idx === i ? 'bg-indigo-600' : 'bg-slate-200'}`);
        if (i === bubbles.length - 1) {
          setTimeout(() => { activeController = null; resetButtons(); }, noteDurationSec * 1000);
        }
      },
    });
  }

  function setButtonPlaying(activeButton) {
    [scaleBtn, arpeggioBtn].forEach((btn) => {
      if (btn === activeButton) {
        btn.textContent = btn === scaleBtn ? t('voiceExercises.stopScale') : t('voiceExercises.stopArpeggio');
        btn.classList.replace('bg-indigo-600', 'bg-rose-600');
      } else {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      }
    });
  }

  function resetButtons() {
    scaleBtn.textContent = t('voiceExercises.playScale');
    arpeggioBtn.textContent = t('voiceExercises.playArpeggio');
    [scaleBtn, arpeggioBtn].forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
      btn.classList.replace('bg-rose-600', 'bg-indigo-600');
    });
  }

  scaleBtn.addEventListener('click', () => playPattern(PATTERNS.scale, scaleBtn));
  arpeggioBtn.addEventListener('click', () => playPattern(PATTERNS.arpeggio, arpeggioBtn));
}

function setupBreathingTimer(container) {
  const patternSelect = container.querySelector('[data-el="breathing-pattern"]');
  const toggleBtn = container.querySelector('[data-action="toggle-breathing"]');
  const circle = container.querySelector('[data-el="breath-circle"]');
  const phaseLabel = container.querySelector('[data-el="breath-phase"]');
  const countdownEl = container.querySelector('[data-el="breath-countdown"]');

  let intervalHandle = null;
  let phaseIndex = 0;
  let remainingSeconds = 0;
  let isRunning = false;

  function currentPhases() {
    return BREATHING_PRESETS[patternSelect.value].phases;
  }

  function applyPhaseVisual(phase) {
    circle.style.transitionDuration = `${phase.seconds}s`;
    if (phase.id === 'inhale') circle.style.transform = 'scale(1.4)';
    if (phase.id === 'exhale') circle.style.transform = 'scale(1)';
    phaseLabel.textContent = phaseLabelFor(phase.id);
    playChime(phase.id === 'inhale' ? 880 : phase.id === 'exhale' ? 440 : 660, 0.15);
  }

  function tick() {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      const phases = currentPhases();
      phaseIndex = (phaseIndex + 1) % phases.length;
      remainingSeconds = phases[phaseIndex].seconds;
      applyPhaseVisual(phases[phaseIndex]);
    }
    countdownEl.textContent = remainingSeconds;
  }

  function start() {
    const phases = currentPhases();
    phaseIndex = 0;
    remainingSeconds = phases[0].seconds;
    applyPhaseVisual(phases[0]);
    countdownEl.textContent = remainingSeconds;
    intervalHandle = setInterval(tick, 1000);
    isRunning = true;
    toggleBtn.textContent = t('voiceExercises.stop');
    toggleBtn.classList.replace('bg-emerald-600', 'bg-rose-600');
    patternSelect.disabled = true;
  }

  function stop() {
    clearInterval(intervalHandle);
    isRunning = false;
    toggleBtn.textContent = t('voiceExercises.start');
    toggleBtn.classList.replace('bg-rose-600', 'bg-emerald-600');
    patternSelect.disabled = false;
    circle.style.transitionDuration = '0.4s';
    circle.style.transform = 'scale(1)';
    phaseLabel.textContent = t('voiceExercises.ready');
    countdownEl.textContent = '—';
  }

  toggleBtn.addEventListener('click', () => (isRunning ? stop() : start()));
}
