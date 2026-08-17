// Tiny Web Audio synth used by the Voice Exercise Hub.
// Warm-up tones are generated in-browser (sine oscillators) rather than
// streamed from hosted audio files — no assets to host, works offline,
// and the pitch/tempo/root note are all adjustable at runtime.
let audioContext = null;

export function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Schedules one note with a short attack/release envelope so notes don't click.
function scheduleNote(ctx, frequency, startTime, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  const attack = 0.02;
  const release = Math.min(0.08, duration * 0.3);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.3, startTime + attack);
  gain.gain.setValueAtTime(0.3, startTime + duration - release);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
  return osc;
}

// Plays a sequence of MIDI note numbers back to back.
// Returns a controller with stop() to cancel anything not yet played,
// and onNoteStart(index) fired (best-effort, via setTimeout) as each note begins.
export function playMidiSequence(midiNotes, noteDurationSec, { onNoteStart } = {}) {
  const ctx = getAudioContext();
  const startTime = ctx.currentTime + 0.05;
  const oscillators = [];
  const timeouts = [];

  midiNotes.forEach((midi, i) => {
    const noteStart = startTime + i * noteDurationSec;
    oscillators.push(scheduleNote(ctx, midiToFrequency(midi), noteStart, noteDurationSec * 0.9));

    if (onNoteStart) {
      const delayMs = Math.max(0, (noteStart - ctx.currentTime) * 1000);
      timeouts.push(setTimeout(() => onNoteStart(i), delayMs));
    }
  });

  const totalDurationMs = midiNotes.length * noteDurationSec * 1000;
  let finished = false;
  const doneTimeout = setTimeout(() => { finished = true; }, totalDurationMs);

  return {
    stop() {
      if (finished) return;
      finished = true;
      oscillators.forEach((osc) => { try { osc.stop(); } catch { /* already stopped */ } });
      timeouts.forEach(clearTimeout);
      clearTimeout(doneTimeout);
    },
    get isFinished() { return finished; },
  };
}

// Short chime used to mark breathing-timer phase changes.
export function playChime(frequency = 660, duration = 0.2) {
  const ctx = getAudioContext();
  scheduleNote(ctx, frequency, ctx.currentTime, duration);
}
