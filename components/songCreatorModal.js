// Admin "Add Song" modal — manual entry, LRCLIB lyrics lookup, and
// browser speech-to-text dictation into the lyrics field.
import { searchLrclib, extractPlainLyrics } from '../utils/lrclib.js';
import { t, tn, getLang } from '../i18n.js';

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LANG_BY_APP_LANG = { en: 'en-US', fr: 'fr-FR' };

export function createSongCreatorModal({ supabase, onCreated }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('songCreator.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <form data-el="form" class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('songCreator.titleField')}</label>
            <input type="text" name="title" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('songCreator.key')}</label>
            <input type="text" name="key" placeholder="${t('songCreator.keyPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('songCreator.youtubeUrl')}</label>
          <input type="url" name="youtube_url" placeholder="https://www.youtube.com/watch?v=…" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('songCreator.leadTrackUrl')}</label>
          <input type="url" name="audio_lead_track" placeholder="https://…" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('songCreator.partTracksOptional')}</label>
          <div class="grid sm:grid-cols-3 gap-3">
            <input type="url" name="audio_soprano_track" placeholder="${t('songCreator.sopranoTrackPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            <input type="url" name="audio_alto_track" placeholder="${t('songCreator.altoTrackPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            <input type="url" name="audio_tenor_track" placeholder="${t('songCreator.tenorTrackPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
        </div>

        <div class="border border-slate-200 rounded-lg p-3 bg-slate-50">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('songCreator.lrclibLookup')}</label>
          <div class="flex gap-2">
            <input type="text" data-el="lrclib-query" placeholder="${t('songCreator.lrclibPlaceholder')}"
                   class="flex-1 border border-slate-300 rounded-lg px-3 py-2" />
            <button type="button" data-action="lrclib-search"
                    class="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">
              ${t('common.search')}
            </button>
          </div>
          <div data-el="lrclib-results" class="mt-2 space-y-1 max-h-40 overflow-y-auto text-sm"></div>
          <p data-el="lrclib-status" class="text-xs text-slate-500 mt-1"></p>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-slate-600">${t('songCreator.lyrics')}</label>
            <button type="button" data-action="toggle-dictation"
                    class="px-3 py-1 rounded-lg text-sm font-medium ${SpeechRecognitionCtor ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}"
                    ${SpeechRecognitionCtor ? '' : `disabled title="${t('songCreator.dictationUnsupported')}"`}>
              ${t('songCreator.startDictation')}
            </button>
          </div>
          <textarea name="lyrics" rows="8" class="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm"
                    placeholder="${t('songCreator.lyricsPlaceholder')}"></textarea>
        </div>

        <p data-el="form-status" class="text-sm"></p>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="submit" data-el="save-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('songCreator.saveSong')}
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('[data-el="form"]');
  const titleInput = form.elements.title;
  const lyricsInput = form.elements.lyrics;
  const lrclibQueryInput = root.querySelector('[data-el="lrclib-query"]');
  const lrclibResultsEl = root.querySelector('[data-el="lrclib-results"]');
  const lrclibStatusEl = root.querySelector('[data-el="lrclib-status"]');
  const formStatusEl = root.querySelector('[data-el="form-status"]');
  const saveBtn = root.querySelector('[data-el="save-btn"]');
  const dictationBtn = root.querySelector('[data-action="toggle-dictation"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('[data-action="lrclib-search"]').addEventListener('click', handleLrclibSearch);
  form.addEventListener('submit', handleSubmit);

  // ---- Speech-to-text dictation ----
  let recognition = null;
  let isRecording = false;

  if (SpeechRecognitionCtor) {
    recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = SPEECH_LANG_BY_APP_LANG[getLang()] || 'en-US';

    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript.trim() + '\n';
        }
      }
      if (finalTranscript) {
        lyricsInput.value = lyricsInput.value ? `${lyricsInput.value}\n${finalTranscript}` : finalTranscript;
      }
    };

    recognition.onerror = (event) => {
      formStatusEl.textContent = `Dictation error: ${event.error}`;
      formStatusEl.className = 'text-sm text-rose-600';
    };

    recognition.onend = () => {
      isRecording = false;
      updateDictationButton();
    };

    dictationBtn.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
      } else {
        recognition.start();
        isRecording = true;
        updateDictationButton();
      }
    });
  }

  function updateDictationButton() {
    dictationBtn.textContent = isRecording ? t('songCreator.stopDictation') : t('songCreator.startDictation');
  }

  // ---- LRCLIB lookup ----
  async function handleLrclibSearch() {
    const query = lrclibQueryInput.value.trim() || titleInput.value.trim();
    if (!query) {
      lrclibStatusEl.textContent = t('songCreator.enterTitleToSearch');
      return;
    }

    lrclibStatusEl.textContent = t('common.searching');
    lrclibResultsEl.innerHTML = '';

    try {
      const results = await searchLrclib(query);
      if (results.length === 0) {
        lrclibStatusEl.textContent = t('songCreator.noMatchesFound');
        return;
      }

      lrclibStatusEl.textContent = tn('songCreator.matchesFound', results.length);
      lrclibResultsEl.innerHTML = results.slice(0, 8).map((r, i) => `
        <button type="button" data-result-idx="${i}"
                class="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 border border-transparent hover:border-slate-200">
          <span class="font-medium">${escapeHtml(r.trackName || t('songCreator.untitled'))}</span>
          <span class="text-slate-500"> — ${escapeHtml(r.artistName || t('songCreator.unknownArtist'))}</span>
        </button>
      `).join('');

      lrclibResultsEl.querySelectorAll('[data-result-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const result = results[Number(btn.dataset.resultIdx)];
          const plain = extractPlainLyrics(result);
          if (!titleInput.value) titleInput.value = result.trackName || '';
          lyricsInput.value = plain || t('songCreator.noLyricsAvailable');
          lrclibStatusEl.textContent = t('songCreator.loadedLyricsFor', { title: result.trackName });
        });
      });
    } catch (error) {
      lrclibStatusEl.textContent = t('songCreator.searchFailed', { message: error.message });
    }
  }

  // ---- Save ----
  async function handleSubmit(e) {
    e.preventDefault();
    if (isRecording) recognition.stop();

    const payload = {
      title: form.elements.title.value.trim(),
      key: form.elements.key.value.trim() || null,
      youtube_url: form.elements.youtube_url.value.trim() || null,
      audio_lead_track: form.elements.audio_lead_track.value.trim() || null,
      audio_soprano_track: form.elements.audio_soprano_track.value.trim() || null,
      audio_alto_track: form.elements.audio_alto_track.value.trim() || null,
      audio_tenor_track: form.elements.audio_tenor_track.value.trim() || null,
      lyrics: form.elements.lyrics.value.trim() || null,
    };

    if (!payload.title) {
      formStatusEl.textContent = t('songCreator.titleRequired');
      formStatusEl.className = 'text-sm text-rose-600';
      return;
    }

    saveBtn.disabled = true;
    formStatusEl.textContent = t('common.saving');
    formStatusEl.className = 'text-sm text-slate-500';

    const { data, error } = await supabase.from('songs').insert(payload).select().single();

    if (error) {
      formStatusEl.textContent = t('songCreator.failedToSave', { message: error.message });
      formStatusEl.className = 'text-sm text-rose-600';
      saveBtn.disabled = false;
      return;
    }

    saveBtn.disabled = false;
    close();
    onCreated?.(data);
  }

  function open() {
    form.reset();
    lrclibResultsEl.innerHTML = '';
    lrclibStatusEl.textContent = '';
    formStatusEl.textContent = '';
    root.classList.remove('hidden');
    root.classList.add('flex');
  }

  function close() {
    if (isRecording) recognition.stop();
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
