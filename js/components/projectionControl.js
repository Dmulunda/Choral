// Media & Tech's live projection operator panel — picks a Bible verse,
// a song's lyrics, a background image, or a video (YouTube or a local
// file) and pushes it to whichever browser window has projector.html
// open. Sync happens over a BroadcastChannel, not the network — the
// operator and the projector only ever work as two windows on the
// SAME computer in real use (one laptop, HDMI out to the projector),
// so there's no reason this needs the internet at all. See
// js/utils/projection.js.
//
// Image/video/background are local files, picked straight from this
// computer, never uploaded anywhere — no Supabase Storage, no cost,
// and it works with no internet connection. The real trade-off: they
// only exist for the current session (nothing persists after a
// reload, and there's no cross-device "Library" to reuse from), and
// they can't be pre-picked into the Schedule days in advance the way
// a Bible verse or song can, since a local file only exists in this
// tab's memory at the moment you pick it, not as a stable link.
//
// Verse/song advance is deliberately "live on click", not stage-then-
// go — Next/Previous immediately re-broadcast, matching how an
// operator actually runs a service (there's no useful distinction
// between "preview" and "live" for a single-projector setup). A grid
// of jump-anywhere targets (Bible's Preview button, Song's slide grid,
// Image/Video's Preview button) stages into the Preview box first
// instead, since those are easier to mis-click — only the shared
// "Send to Live" arrow (or a double-click on a song slide) actually
// puts it on screen.
import { t } from '../i18n.js';
import { createProjectionChannel } from '../utils/projection.js';
import { extractYouTubeId } from '../utils/youtube.js';

export function renderProjectionControl(container, { supabase }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 class="text-lg font-semibold">${t('projection.title')}</h2>
        <div class="flex items-center gap-2">
          <button type="button" data-action="open-screen" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            ${t('projection.openScreen')}
          </button>
          <button type="button" data-action="blank" class="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300">
            ${t('projection.blankScreen')}
          </button>
        </div>
      </div>

      <div class="mb-4 pb-4 border-b border-slate-100">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">${t('projection.textSize')}</label>
            <input type="range" data-el="font-scale" min="50" max="600" step="10" value="100" class="w-32" />
            <span data-el="font-scale-value" class="text-sm text-slate-500 w-12">100%</span>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-sm text-slate-600">${t('projection.background')}</label>
            <img data-el="backdrop-thumb" class="hidden w-10 h-10 object-cover rounded border border-slate-200" alt="" />
            <label class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 cursor-pointer">
              ${t('projection.uploadBackground')}
              <input type="file" accept="image/*" data-el="backdrop-input" class="hidden" />
            </label>
            <button type="button" data-action="clear-backdrop" data-el="clear-backdrop-btn" class="hidden px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">
              ${t('projection.clearBackground')}
            </button>
          </div>
        </div>
      </div>

      <div class="flex gap-2 mb-4 border-b border-slate-200 flex-wrap">
        <button type="button" data-mode-tab="bible" class="px-3 py-2 text-sm font-medium border-b-2 border-indigo-600 text-indigo-700">${t('projection.bibleTab')}</button>
        <button type="button" data-mode-tab="song" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.songTab')}</button>
        <button type="button" data-mode-tab="image" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.imageTab')}</button>
        <button type="button" data-mode-tab="video" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.videoTab')}</button>
        <button type="button" data-mode-tab="schedule" class="px-3 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700">${t('projection.scheduleTab')}</button>
      </div>

      <div data-el="bible-panel">
        <div class="relative mb-2">
          <input type="text" data-el="book-search" placeholder="${t('projection.bookSearchPlaceholder')}" autocomplete="off"
                 class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          <div data-el="book-suggestions" class="hidden absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"></div>
        </div>
        <div class="grid sm:grid-cols-4 gap-3 mb-3">
          <select data-el="translation-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="lsg">${t('projection.translationLsg')}</option>
            <option value="web">${t('projection.translationWeb')}</option>
          </select>
          <select data-el="book-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm sm:col-span-2"></select>
          <select data-el="chapter-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
        </div>
        <div class="flex items-center gap-2 mb-3">
          <select data-el="verse-select" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1"></select>
          <button type="button" data-action="project-verse" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('projection.preview')}
          </button>
          <button type="button" data-action="schedule-verse" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">
            ${t('projection.addToSchedule')}
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="prev-verse" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">&larr; ${t('projection.previous')}</button>
          <button type="button" data-action="next-verse" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50">${t('projection.next')} &rarr;</button>
        </div>
      </div>

      <div data-el="song-panel" class="hidden">
        <input type="text" data-el="song-search" placeholder="${t('projection.searchSongPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
        <div data-el="song-list" class="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-44 overflow-y-auto mb-3"></div>
        <div class="flex items-center gap-2 mb-2">
          <p data-el="song-selected" class="text-sm text-slate-600 flex-1"></p>
          <button type="button" data-action="schedule-song" class="hidden px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
            ${t('projection.addToSchedule')}
          </button>
        </div>
        <div data-el="slide-grid" class="flex flex-wrap gap-1.5 mb-3"></div>
        <div class="flex items-center gap-2">
          <button type="button" data-action="prev-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>&larr; ${t('projection.previous')}</button>
          <button type="button" data-action="next-slide" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>${t('projection.next')} &rarr;</button>
          <span data-el="slide-position" class="text-sm text-slate-500"></span>
        </div>
      </div>

      <div data-el="image-panel" class="hidden">
        <label class="inline-block px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 cursor-pointer mb-3">
          ${t('projection.uploadImage')}
          <input type="file" accept="image/*" data-el="image-input" class="hidden" />
        </label>
        <p class="text-xs text-slate-400 mb-3">${t('projection.localFileHint')}</p>
        <div class="mb-3">
          <img data-el="image-preview" class="hidden max-h-40 rounded-lg border border-slate-200" alt="" />
        </div>
        <button type="button" data-action="project-image" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50" disabled>
          ${t('projection.preview')}
        </button>
      </div>

      <div data-el="video-panel" class="hidden">
        <div class="flex items-center gap-2 mb-2">
          <input type="text" data-el="youtube-input" placeholder="${t('projection.youtubeUrlPlaceholder')}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" data-action="load-youtube" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">
            ${t('projection.load')}
          </button>
        </div>
        <label class="inline-block px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 cursor-pointer mb-1">
          ${t('projection.uploadVideo')}
          <input type="file" accept="video/*" data-el="video-input" class="hidden" />
        </label>
        <p class="text-xs text-slate-400 mb-3">${t('projection.localFileHint')}</p>
        <p data-el="video-selected" class="text-sm text-slate-600 mb-3"></p>
        <div class="flex items-center gap-2">
          <button type="button" data-action="project-video" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50" disabled>
            ${t('projection.preview')}
          </button>
          <button type="button" data-action="toggle-video" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50" disabled>
            ${t('projection.pause')}
          </button>
        </div>
      </div>

      <div data-el="schedule-panel" class="hidden">
        <div class="flex items-center gap-2 mb-3">
          <input type="date" data-el="schedule-date" class="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <p class="text-xs text-slate-400 mb-3">${t('projection.scheduleLocalHint')}</p>
        <div data-el="schedule-list" class="space-y-1.5"></div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100">
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('projection.preview')}</p>
            <div data-el="preview-box" class="rounded-lg bg-slate-600 text-white p-4 min-h-[4.5rem] flex flex-col items-center justify-center text-center">
              <p class="text-slate-300 text-sm">${t('projection.nothingStaged')}</p>
            </div>
          </div>
          <button type="button" data-action="send-staged" title="${t('projection.sendToLive')}"
                  class="justify-self-center shrink-0 w-10 h-10 rounded-full bg-indigo-600 text-white text-lg font-bold hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center" disabled>
            &rarr;
          </button>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('projection.nowShowing')}</p>
            <div data-el="now-showing" class="rounded-lg bg-slate-900 text-white p-4 min-h-[4.5rem] flex flex-col items-center justify-center text-center">
              <p class="text-slate-400 text-sm">${t('projection.nothingLive')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const translationSelectEl = container.querySelector('[data-el="translation-select"]');
  const bookSearchEl = container.querySelector('[data-el="book-search"]');
  const bookSuggestionsEl = container.querySelector('[data-el="book-suggestions"]');
  const bookSelectEl = container.querySelector('[data-el="book-select"]');
  const chapterSelectEl = container.querySelector('[data-el="chapter-select"]');
  const verseSelectEl = container.querySelector('[data-el="verse-select"]');
  const prevVerseBtn = container.querySelector('[data-action="prev-verse"]');
  const nextVerseBtn = container.querySelector('[data-action="next-verse"]');
  const projectVerseBtn = container.querySelector('[data-action="project-verse"]');
  const scheduleVerseBtn = container.querySelector('[data-action="schedule-verse"]');

  const songSearchEl = container.querySelector('[data-el="song-search"]');
  const songListEl = container.querySelector('[data-el="song-list"]');
  const songSelectedEl = container.querySelector('[data-el="song-selected"]');
  const scheduleSongBtn = container.querySelector('[data-action="schedule-song"]');
  const slideGridEl = container.querySelector('[data-el="slide-grid"]');
  const prevSlideBtn = container.querySelector('[data-action="prev-slide"]');
  const nextSlideBtn = container.querySelector('[data-action="next-slide"]');
  const slidePositionEl = container.querySelector('[data-el="slide-position"]');

  const imageInputEl = container.querySelector('[data-el="image-input"]');
  const imagePreviewEl = container.querySelector('[data-el="image-preview"]');
  const projectImageBtn = container.querySelector('[data-action="project-image"]');

  const youtubeInputEl = container.querySelector('[data-el="youtube-input"]');
  const videoInputEl = container.querySelector('[data-el="video-input"]');
  const videoSelectedEl = container.querySelector('[data-el="video-selected"]');
  const projectVideoBtn = container.querySelector('[data-action="project-video"]');
  const toggleVideoBtn = container.querySelector('[data-action="toggle-video"]');

  const scheduleDateEl = container.querySelector('[data-el="schedule-date"]');
  const scheduleListEl = container.querySelector('[data-el="schedule-list"]');

  const fontScaleEl = container.querySelector('[data-el="font-scale"]');
  const fontScaleValueEl = container.querySelector('[data-el="font-scale-value"]');
  const backdropThumbEl = container.querySelector('[data-el="backdrop-thumb"]');
  const backdropInputEl = container.querySelector('[data-el="backdrop-input"]');
  const clearBackdropBtn = container.querySelector('[data-el="clear-backdrop-btn"]');

  const nowShowingEl = container.querySelector('[data-el="now-showing"]');
  const previewBoxEl = container.querySelector('[data-el="preview-box"]');
  const sendStagedBtn = container.querySelector('[data-action="send-staged"]');
  const modeTabs = container.querySelectorAll('[data-mode-tab]');
  const panels = {
    bible: container.querySelector('[data-el="bible-panel"]'),
    song: container.querySelector('[data-el="song-panel"]'),
    image: container.querySelector('[data-el="image-panel"]'),
    video: container.querySelector('[data-el="video-panel"]'),
    schedule: container.querySelector('[data-el="schedule-panel"]'),
  };

  let books = [];
  let bookVerses = []; // [{chapter, verse, text}] for the selected book+translation, ordered
  let verseIndex = -1;

  let allSongs = []; // [{id, title}], loaded once
  let songSlides = []; // [[line, line, ...], ...]
  let songTitle = '';
  let selectedSongId = null;
  let slideIndex = -1; // which slide is actually LIVE

  // Shared across all four tabs — only one thing can be "next in line"
  // at a time, matching the single shared Preview box/arrow.
  let stagedKind = null; // 'bible' | 'song' | 'image' | 'video' | null
  let stagedPayload = null; // exactly what gets sent, plus whatever contentPreviewHtml needs to render it
  let stagedBibleIndex = -1; // into bookVerses, when stagedKind === 'bible'
  let stagedSlideIndex = -1; // into songSlides, when stagedKind === 'song'

  let pendingImageBlob = null;
  let pendingImageObjectUrl = null; // this tab's own preview only — never sent over the channel

  let pendingVideo = null; // { source: 'youtube', videoId } or { source: 'file' } (the file itself is pendingVideoBlob)
  let pendingVideoBlob = null;
  let videoLoaded = false;
  let videoPlaying = false;

  let currentFontScale = 1;
  let currentBackdropBlob = null;
  let currentBackdropObjectUrl = null; // this tab's own toolbar thumbnail only

  let currentPayload = null;
  let projectorWindowRef = null;
  let liveScheduleItemId = null; // which schedule item (if any) is currently live — for the LIVE/NEXT badges

  // BroadcastChannel, not Supabase Realtime — see js/utils/projection.js.
  // Works only between windows on this same computer/browser, which is
  // exactly the real setup (laptop -> HDMI -> projector), and means
  // none of this needs an internet connection once the page has loaded.
  const channel = createProjectionChannel();
  channel.onmessage = (e) => {
    if (e.data?.event !== 'hello') return;
    // The projector just (re)connected — resend both what's live and
    // the current backdrop, since it has no other way to know either.
    channel.postMessage({ event: 'show', payload: currentPayload || { kind: 'blank' } });
    channel.postMessage({ event: 'backdrop', blob: currentBackdropBlob });
  };

  container.querySelector('[data-action="open-screen"]').addEventListener('click', async () => {
    // The Window Management API (getScreenDetails) only exists in
    // Chromium browsers — everywhere else this just opens the page
    // normally, same as before, and the operator drags it to the
    // right display and clicks fullscreen there themselves.
    if ('getScreenDetails' in window && window.isSecureContext) {
      try {
        const screenDetails = await window.getScreenDetails();
        if (screenDetails.screens.length > 1) {
          const chosen = await pickScreen(screenDetails.screens);
          if (!chosen) return; // picker cancelled
          projectorWindowRef = window.open(
            `projector.html?sl=${chosen.left}&st=${chosen.top}`,
            '_blank',
            `left=${chosen.left},top=${chosen.top},width=${chosen.width},height=${chosen.height}`,
          );
          return;
        }
      } catch {
        // Permission denied — fall through to a plain open below.
      }
    }
    projectorWindowRef = window.open('projector.html', '_blank');
  });

  container.querySelector('[data-action="blank"]').addEventListener('click', () => {
    videoPlaying = false;
    videoLoaded = false;
    toggleVideoBtn.disabled = true;
    toggleVideoBtn.textContent = t('projection.pause');
    send({ kind: 'blank' });
  });

  modeTabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.modeTab)));

  function setMode(mode) {
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle('hidden', key !== mode));
    modeTabs.forEach((tab) => {
      const active = tab.dataset.modeTab === mode;
      tab.className = `px-3 py-2 text-sm font-medium border-b-2 ${active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`;
    });
  }

  function send(payload) {
    if (payload.kind === 'bible' || payload.kind === 'song') {
      payload = { ...payload, fontScale: currentFontScale };
    }
    currentPayload = payload;
    channel.postMessage({ event: 'show', payload });
    renderNowShowing(payload);

    // Cleared by default on every send(); runScheduleItem re-marks
    // itself live right after this returns (send() is synchronous), so
    // a plain Bible/Song/Image/Video action outside the schedule
    // correctly un-highlights whatever schedule item was live before.
    if (liveScheduleItemId !== null) {
      liveScheduleItemId = null;
      renderScheduleList();
    }
  }

  // "Now Showing" — a preview of the actual live content right in the
  // operator panel, since the operator can't always see the physical
  // projector screen from where they're running the laptop.
  function contentPreviewHtml(payload, staged) {
    if (payload.kind === 'bible' || payload.kind === 'song') {
      return `
        <p class="text-sm leading-snug">${payload.lines.map((l) => escapeHtml(l)).join('<br>')}</p>
        ${payload.reference ? `<p class="text-xs text-slate-300 mt-2">${escapeHtml(payload.reference)}</p>` : ''}
      `;
    }
    if (payload.kind === 'image') {
      // Fine to mint a fresh object URL per render here — this tab's
      // own preview only, images are shown far less often than
      // verses/songs, and it's all released anyway the moment this
      // page reloads or closes.
      return `<img src="${escapeAttr(URL.createObjectURL(payload.blob))}" class="max-h-24 rounded" alt="" />`;
    }
    if (payload.kind === 'video') {
      // A staged video hasn't actually started playing yet — only the
      // live "Now Showing" copy of this reflects real playback state.
      const state = staged ? t('projection.videoStagedLabel') : (payload.action === 'pause' ? t('projection.videoPaused') : t('projection.videoPlaying'));
      return `<p class="text-sm">🎬 ${escapeHtml(state)}</p>`;
    }
    return '';
  }

  function renderNowShowing(payload) {
    nowShowingEl.innerHTML = (!payload || payload.kind === 'blank')
      ? `<p class="text-slate-400 text-sm">${t('projection.nothingLive')}</p>`
      : contentPreviewHtml(payload, false);
  }

  function renderStagePreview(payload) {
    previewBoxEl.innerHTML = !payload
      ? `<p class="text-slate-300 text-sm">${t('projection.nothingStaged')}</p>`
      : contentPreviewHtml(payload, true);
    sendStagedBtn.disabled = !payload;
  }

  // --- Text size / backdrop ---

  fontScaleEl.addEventListener('input', () => {
    currentFontScale = Number(fontScaleEl.value) / 100;
    fontScaleValueEl.textContent = `${fontScaleEl.value}%`;
    if (currentPayload?.kind === 'bible' || currentPayload?.kind === 'song') send(currentPayload);
  });

  // A local file, picked straight from this computer — never uploaded
  // anywhere. Applies immediately (own toolbar thumbnail + sent to the
  // projector right away) and lasts for this session only; nothing
  // persists across a reload, unlike the old cloud-backed backdrop.
  function setBackdropBlob(blob) {
    if (currentBackdropObjectUrl) URL.revokeObjectURL(currentBackdropObjectUrl);
    currentBackdropBlob = blob;
    currentBackdropObjectUrl = blob ? URL.createObjectURL(blob) : null;
    backdropThumbEl.classList.toggle('hidden', !currentBackdropObjectUrl);
    clearBackdropBtn.classList.toggle('hidden', !currentBackdropBlob);
    if (currentBackdropObjectUrl) backdropThumbEl.src = currentBackdropObjectUrl;
    channel.postMessage({ event: 'backdrop', blob: currentBackdropBlob });
  }

  backdropInputEl.addEventListener('change', () => {
    const file = backdropInputEl.files[0];
    if (file) setBackdropBlob(file);
  });

  clearBackdropBtn.addEventListener('click', () => setBackdropBlob(null));

  // --- Bible panel ---

  async function loadBooks() {
    const { data } = await supabase.from('bible_books').select('number, name_en, name_fr').order('number');
    books = data || [];
    renderBookOptions();
  }

  function renderBookOptions() {
    const isFrench = translationSelectEl.value === 'lsg';
    bookSelectEl.innerHTML = books.map((b) => `<option value="${b.number}">${escapeHtml(isFrench ? b.name_fr : b.name_en)}</option>`).join('');
  }

  // Matches on the book name with French accents stripped either way
  // (so "esaie" finds "Ésaïe") and, separately, on the name with any
  // leading "1 "/"2 "/"3 " stripped (so typing "s" finds "1 Samuel"
  // and "2 Samuel" alongside "Sophonie", not just names that literally
  // start with S).
  function bookMatchesQuery(name, query) {
    const normName = stripAccents(name).toLowerCase();
    const normQuery = stripAccents(query).toLowerCase().trim();
    if (!normQuery) return false;
    if (normName.startsWith(normQuery)) return true;
    return normName.replace(/^\d+\s+/, '').startsWith(normQuery);
  }

  function renderBookSuggestions(query) {
    const isFrench = translationSelectEl.value === 'lsg';
    const matches = query.trim() ? books.filter((b) => bookMatchesQuery(isFrench ? b.name_fr : b.name_en, query)) : [];

    if (matches.length === 0) {
      bookSuggestionsEl.classList.add('hidden');
      bookSuggestionsEl.innerHTML = '';
      return;
    }

    bookSuggestionsEl.classList.remove('hidden');
    bookSuggestionsEl.innerHTML = matches.map((b) => `<button type="button" data-book-number="${b.number}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">${escapeHtml(isFrench ? b.name_fr : b.name_en)}</button>`).join('');
    bookSuggestionsEl.querySelectorAll('[data-book-number]').forEach((btn) => {
      btn.addEventListener('click', () => pickBook(Number(btn.dataset.bookNumber)));
    });
  }

  function pickBook(bookNumber) {
    bookSelectEl.value = String(bookNumber);
    bookSearchEl.value = '';
    bookSuggestionsEl.classList.add('hidden');
    loadBook();
  }

  bookSearchEl.addEventListener('input', () => renderBookSuggestions(bookSearchEl.value));
  bookSearchEl.addEventListener('focus', () => { if (bookSearchEl.value) renderBookSuggestions(bookSearchEl.value); });
  // On document, not just the input, so clicking anywhere outside
  // closes the suggestion list — removed again in destroy() below, so
  // repeated visits to this panel (it's rebuilt fresh every time) don't
  // stack up one of these forever.
  function closeSuggestionsOnOutsideClick(e) {
    if (!bookSearchEl.contains(e.target) && !bookSuggestionsEl.contains(e.target)) bookSuggestionsEl.classList.add('hidden');
  }
  document.addEventListener('click', closeSuggestionsOnOutsideClick);

  async function loadBook() {
    const bookNumber = Number(bookSelectEl.value);
    if (!bookNumber) return;
    verseSelectEl.disabled = true;
    projectVerseBtn.disabled = true;

    const { data, error } = await supabase
      .from('bible_verses')
      .select('chapter, verse, text')
      .eq('translation', translationSelectEl.value)
      .eq('book_number', bookNumber)
      .order('chapter')
      .order('verse');

    if (error || !data || data.length === 0) {
      bookVerses = [];
      chapterSelectEl.innerHTML = '';
      verseSelectEl.innerHTML = `<option>${t('projection.bibleNotImported')}</option>`;
      return;
    }

    bookVerses = data;
    const chapters = [...new Set(bookVerses.map((v) => v.chapter))];
    chapterSelectEl.innerHTML = chapters.map((c) => `<option value="${c}">${t('projection.chapterN', { n: c })}</option>`).join('');
    renderVerseOptions();
    projectVerseBtn.disabled = false;
  }

  function renderVerseOptions() {
    const chapter = Number(chapterSelectEl.value);
    const verses = bookVerses.filter((v) => v.chapter === chapter);
    verseSelectEl.disabled = false;
    verseSelectEl.innerHTML = verses.map((v) => `<option value="${v.verse}">${t('projection.verseN', { n: v.verse })}</option>`).join('');
  }

  // "Project" now stages, same as everywhere else — Next/Previous stay
  // immediate, since they're a deliberate step through an already-live
  // passage, not a fresh jump.
  function stageSelectedVerse() {
    const chapter = Number(chapterSelectEl.value);
    const verse = Number(verseSelectEl.value);
    const idx = bookVerses.findIndex((v) => v.chapter === chapter && v.verse === verse);
    if (idx === -1) return;
    const v = bookVerses[idx];
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    stagedKind = 'bible';
    stagedBibleIndex = idx;
    stagedPayload = { kind: 'bible', reference: `${bookLabel} ${v.chapter}:${v.verse}`, lines: [v.text] };
    renderStagePreview(stagedPayload);
  }

  function projectVerseAt(idx) {
    if (idx < 0 || idx >= bookVerses.length) return;
    verseIndex = idx;
    const v = bookVerses[idx];
    chapterSelectEl.value = String(v.chapter);
    renderVerseOptions();
    verseSelectEl.value = String(v.verse);
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    send({ kind: 'bible', reference: `${bookLabel} ${v.chapter}:${v.verse}`, lines: [v.text] });
  }

  translationSelectEl.addEventListener('change', () => { renderBookOptions(); loadBook(); });
  bookSelectEl.addEventListener('change', loadBook);
  chapterSelectEl.addEventListener('change', renderVerseOptions);
  projectVerseBtn.addEventListener('click', stageSelectedVerse);
  prevVerseBtn.addEventListener('click', () => projectVerseAt(verseIndex - 1));
  nextVerseBtn.addEventListener('click', () => projectVerseAt(verseIndex + 1));

  // --- Song panel ---
  // Full list loaded once and filtered client-side (rather than a
  // search-only results dropdown) so the whole repertoire is always
  // browsable, and every stanza renders as its own jump-to button (not
  // just Next/Previous) so the operator can snap straight back to
  // verse 1 when the choir repeats it, without stepping through
  // everything in between.

  async function loadSongList() {
    const { data } = await supabase.from('songs').select('id, title').order('title');
    allSongs = data || [];
    renderSongList(allSongs);
  }

  function renderSongList(rows) {
    if (rows.length === 0) {
      songListEl.innerHTML = `<p class="text-sm text-slate-400 px-3 py-2">${t('projection.noSongsYet')}</p>`;
      return;
    }
    songListEl.innerHTML = rows.map((r) => `<button type="button" data-song-id="${r.id}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50">${escapeHtml(r.title)}</button>`).join('');
    songListEl.querySelectorAll('[data-song-id]').forEach((btn) => {
      btn.addEventListener('click', () => selectSong(btn.dataset.songId, rows.find((r) => r.id === btn.dataset.songId).title));
    });
  }

  songSearchEl.addEventListener('input', () => {
    const query = songSearchEl.value.trim().toLowerCase();
    renderSongList(query ? allSongs.filter((s) => s.title.toLowerCase().includes(query)) : allSongs);
  });

  async function selectSong(songId, title) {
    const { data } = await supabase.from('songs').select('lyrics').eq('id', songId).single();
    songTitle = title;
    selectedSongId = songId;
    songSlides = (data?.lyrics || '')
      .split(/\n\s*\n/)
      .map((stanza) => stanza.split('\n').map((l) => l.trim()).filter(Boolean))
      .filter((lines) => lines.length > 0);

    songSelectedEl.textContent = t('projection.selectedSong', { title });
    scheduleSongBtn.classList.remove('hidden');
    slideIndex = -1;
    // A stanza staged from the previous song no longer means anything
    // once the song itself changes.
    if (stagedKind === 'song') clearStaged();
    renderSlideGrid();

    const hasSlides = songSlides.length > 0;
    prevSlideBtn.disabled = true;
    nextSlideBtn.disabled = !hasSlides;
    slidePositionEl.textContent = hasSlides ? '' : t('projection.songHasNoLyrics');
  }

  // A grid of jump-anywhere targets is easy to mis-click mid-service —
  // a single click only STAGES a slide into the Preview box (so you
  // can read it before it's in front of the congregation); it only
  // goes live via the "Send to Live" button, or a double-click as a
  // one-step shortcut once you trust the click. Next/Previous stay
  // immediate — they're a much more deliberate, linear action.
  function renderSlideGrid() {
    slideGridEl.innerHTML = songSlides.map((lines, idx) => `
      <button type="button" data-slide-idx="${idx}" title="${escapeHtml(lines[0] || '')}"
              class="w-9 h-9 rounded-lg text-sm font-medium border ${
                idx === slideIndex ? 'bg-emerald-600 text-white border-emerald-600'
                : idx === stagedSlideIndex ? 'bg-indigo-100 text-indigo-700 border-indigo-400'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }">
        ${idx + 1}
      </button>
    `).join('');
    slideGridEl.querySelectorAll('[data-slide-idx]').forEach((btn) => {
      const idx = Number(btn.dataset.slideIdx);
      btn.addEventListener('click', () => stageSlideAt(idx));
      btn.addEventListener('dblclick', () => { stageSlideAt(idx); sendStaged(); });
    });
  }

  function clearStaged() {
    stagedKind = null;
    stagedPayload = null;
    stagedBibleIndex = -1;
    stagedSlideIndex = -1;
    renderStagePreview(null);
  }

  function stageSlideAt(idx) {
    if (idx < 0 || idx >= songSlides.length) return;
    stagedKind = 'song';
    stagedSlideIndex = idx;
    stagedPayload = { kind: 'song', reference: songTitle, lines: songSlides[idx] };
    renderSlideGrid();
    renderStagePreview(stagedPayload);
  }

  // The one action behind the arrow between Preview and Now Showing —
  // routes to whichever tab actually staged something, since Bible and
  // Song need their own dropdowns/grid re-synced (not just a broadcast),
  // while Image/Video go out close to as-is.
  function sendStaged() {
    if (!stagedPayload) return;

    if (stagedKind === 'bible') {
      projectVerseAt(stagedBibleIndex);
    } else if (stagedKind === 'song') {
      projectSlideAt(stagedSlideIndex);
    } else if (stagedKind === 'image') {
      send({ kind: 'image', blob: stagedPayload.blob });
    } else if (stagedKind === 'video') {
      videoLoaded = true;
      videoPlaying = true;
      projectVideoBtn.disabled = false;
      toggleVideoBtn.disabled = false;
      toggleVideoBtn.textContent = t('projection.pause');
      send(buildVideoPlayPayload());
    }

    clearStaged();
    renderSlideGrid();
  }

  sendStagedBtn.addEventListener('click', sendStaged);

  function projectSlideAt(idx) {
    if (idx < 0 || idx >= songSlides.length) return;
    slideIndex = idx;
    renderSlideGrid();
    prevSlideBtn.disabled = idx === 0;
    nextSlideBtn.disabled = idx === songSlides.length - 1;
    slidePositionEl.textContent = t('projection.slideOf', { current: idx + 1, total: songSlides.length });
    send({ kind: 'song', reference: songTitle, lines: songSlides[idx] });
  }

  prevSlideBtn.addEventListener('click', () => projectSlideAt(slideIndex - 1));
  nextSlideBtn.addEventListener('click', () => projectSlideAt(slideIndex + 1));

  // --- Image panel ---
  // A local file, read straight from this computer — never uploaded.
  // Sent to the projector as the actual file (a Blob, structured-
  // cloned over the BroadcastChannel), which mints its own local
  // preview from it; nothing here ever becomes a URL on any server.

  imageInputEl.addEventListener('change', () => {
    const file = imageInputEl.files[0];
    if (!file) return;
    if (pendingImageObjectUrl) URL.revokeObjectURL(pendingImageObjectUrl);
    pendingImageBlob = file;
    pendingImageObjectUrl = URL.createObjectURL(file);
    imagePreviewEl.src = pendingImageObjectUrl;
    imagePreviewEl.classList.remove('hidden');
    projectImageBtn.disabled = false;
  });

  projectImageBtn.addEventListener('click', () => {
    if (!pendingImageBlob) return;
    stagedKind = 'image';
    stagedPayload = { kind: 'image', blob: pendingImageBlob };
    renderStagePreview(stagedPayload);
  });

  // --- Video panel ---

  container.querySelector('[data-action="load-youtube"]').addEventListener('click', () => {
    const videoId = extractYouTubeId(youtubeInputEl.value.trim());
    if (!videoId) { window.alert(t('projection.invalidYoutubeUrl')); return; }
    pendingVideo = { source: 'youtube', videoId };
    pendingVideoBlob = null;
    videoSelectedEl.textContent = t('projection.videoReady');
    projectVideoBtn.disabled = false;
  });

  videoInputEl.addEventListener('change', () => {
    const file = videoInputEl.files[0];
    if (!file) return;
    pendingVideo = { source: 'file' };
    pendingVideoBlob = file;
    videoSelectedEl.textContent = `${t('projection.videoReady')} (${file.name})`;
    projectVideoBtn.disabled = false;
  });

  function buildVideoPlayPayload() {
    if (pendingVideo.source === 'youtube') return { kind: 'video', action: 'play', source: 'youtube', videoId: pendingVideo.videoId };
    return { kind: 'video', action: 'play', source: 'file', blob: pendingVideoBlob };
  }

  projectVideoBtn.addEventListener('click', () => {
    if (!pendingVideo) return;
    stagedKind = 'video';
    stagedPayload = buildVideoPlayPayload();
    renderStagePreview(stagedPayload);
  });

  toggleVideoBtn.addEventListener('click', () => {
    if (!videoLoaded) return;
    videoPlaying = !videoPlaying;
    toggleVideoBtn.textContent = videoPlaying ? t('projection.pause') : t('projection.resume');
    // No blob needed here — the projector already has the video
    // loaded locally, a pause/resume is just an instruction, not new
    // content to hand over.
    send({ kind: 'video', action: videoPlaying ? 'resume' : 'pause', source: pendingVideo.source, videoId: pendingVideo.videoId });
  });

  // --- Schedule ---
  // Plan a service's Bible verses/songs in advance (via each tab's "+
  // Add to Schedule" button), then during the live service just click
  // down the list. Image/Video aren't schedulable — a local file only
  // exists in this tab's memory at the moment it's picked, so there's
  // no stable link to store days ahead the way a verse reference or a
  // song id is. One schedule per calendar date (sql/077); nothing is
  // saved to the DB until the first item is actually added, so just
  // browsing dates doesn't litter the table with empty rows.

  let currentScheduleId = null;
  let scheduleItems = []; // [{id, position, kind, label, payload}], ordered

  function todayLocalDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  scheduleDateEl.value = todayLocalDate();
  scheduleDateEl.addEventListener('change', () => loadSchedule(scheduleDateEl.value));

  async function loadSchedule(date) {
    scheduleListEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: existing } = await supabase.from('projection_schedules').select('id').eq('service_date', date).maybeSingle();
    if (!existing) {
      currentScheduleId = null;
      scheduleItems = [];
      renderScheduleList();
      return;
    }

    currentScheduleId = existing.id;
    const { data } = await supabase.from('projection_schedule_items').select('id, position, kind, label, payload').eq('schedule_id', existing.id).order('position');
    scheduleItems = data || [];
    renderScheduleList();
  }

  async function ensureScheduleId() {
    if (currentScheduleId) return currentScheduleId;
    const { data, error } = await supabase.from('projection_schedules')
      .upsert({ service_date: scheduleDateEl.value, updated_at: new Date().toISOString() }, { onConflict: 'service_date' })
      .select('id')
      .single();
    if (error) { window.alert(t('projection.scheduleSaveFailed', { message: error.message })); return null; }
    currentScheduleId = data.id;
    return currentScheduleId;
  }

  async function addToSchedule(kind, label, payload) {
    const scheduleId = await ensureScheduleId();
    if (!scheduleId) return;
    const position = scheduleItems.length > 0 ? Math.max(...scheduleItems.map((i) => i.position)) + 1 : 0;
    const { data, error } = await supabase.from('projection_schedule_items')
      .insert({ schedule_id: scheduleId, position, kind, label, payload })
      .select('id, position, kind, label, payload')
      .single();
    if (error) { window.alert(t('projection.scheduleSaveFailed', { message: error.message })); return; }
    scheduleItems.push(data);
    renderScheduleList();
  }

  async function removeScheduleItem(id) {
    const { error } = await supabase.from('projection_schedule_items').delete().eq('id', id);
    if (error) { window.alert(t('projection.scheduleSaveFailed', { message: error.message })); return; }
    scheduleItems = scheduleItems.filter((i) => i.id !== id);
    renderScheduleList();
  }

  async function moveScheduleItem(id, direction) {
    const idx = scheduleItems.findIndex((i) => i.id === id);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= scheduleItems.length) return;

    const a = scheduleItems[idx];
    const b = scheduleItems[swapIdx];
    const [aPos, bPos] = [a.position, b.position];

    const [{ error: err1 }, { error: err2 }] = await Promise.all([
      supabase.from('projection_schedule_items').update({ position: bPos }).eq('id', a.id),
      supabase.from('projection_schedule_items').update({ position: aPos }).eq('id', b.id),
    ]);
    if (err1 || err2) { window.alert(t('projection.scheduleSaveFailed', { message: (err1 || err2).message })); return; }

    a.position = bPos;
    b.position = aPos;
    scheduleItems.sort((x, y) => x.position - y.position);
    renderScheduleList();
  }

  const SCHEDULE_ICONS = { bible: '📖', song: '🎵' };

  function renderScheduleList() {
    if (scheduleItems.length === 0) {
      scheduleListEl.innerHTML = `<p class="text-sm text-slate-400">${t('projection.scheduleEmpty')}</p>`;
      return;
    }
    const liveIdx = scheduleItems.findIndex((i) => i.id === liveScheduleItemId);
    scheduleListEl.innerHTML = scheduleItems.map((item, idx) => `
      <div class="flex items-center gap-2 border rounded-lg px-3 py-2 ${idx === liveIdx ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}" data-item-id="${item.id}">
        <button type="button" data-action="run-item" class="flex-1 text-left text-sm hover:text-indigo-700">
          ${SCHEDULE_ICONS[item.kind] || ''} ${escapeHtml(item.label)}
          ${idx === liveIdx ? `<span class="ml-2 text-xs font-semibold text-emerald-700">${t('projection.live')}</span>` : ''}
          ${idx === liveIdx + 1 ? `<span class="ml-2 text-xs font-semibold text-indigo-500">${t('projection.next')}</span>` : ''}
        </button>
        <button type="button" data-action="move-up" class="text-slate-400 hover:text-slate-700 disabled:opacity-30" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" data-action="move-down" class="text-slate-400 hover:text-slate-700 disabled:opacity-30" ${idx === scheduleItems.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button type="button" data-action="remove-item" class="text-rose-400 hover:text-rose-600">&times;</button>
      </div>
    `).join('');

    scheduleListEl.querySelectorAll('[data-item-id]').forEach((row) => {
      const id = row.dataset.itemId;
      const item = scheduleItems.find((i) => i.id === id);
      row.querySelector('[data-action="run-item"]').addEventListener('click', () => runScheduleItem(item));
      row.querySelector('[data-action="move-up"]').addEventListener('click', () => moveScheduleItem(id, -1));
      row.querySelector('[data-action="move-down"]').addEventListener('click', () => moveScheduleItem(id, 1));
      row.querySelector('[data-action="remove-item"]').addEventListener('click', () => removeScheduleItem(id));
    });
  }

  async function runScheduleItem(item) {
    if (item.kind === 'bible') {
      setMode('bible');
      const p = item.payload;
      if (translationSelectEl.value !== p.translation || Number(bookSelectEl.value) !== p.bookNumber) {
        translationSelectEl.value = p.translation;
        renderBookOptions();
        bookSelectEl.value = String(p.bookNumber);
        await loadBook();
      }
      const idx = bookVerses.findIndex((v) => v.chapter === p.chapter && v.verse === p.verse);
      if (idx !== -1) projectVerseAt(idx);
    } else if (item.kind === 'song') {
      setMode('song');
      await selectSong(item.payload.songId, item.label);
      if (songSlides.length > 0) projectSlideAt(0);
    }

    // send() (called above, synchronously, however we got here)
    // always clears this first — re-mark it live now that we know the
    // schedule item actually is what went out, so the list can show
    // LIVE/NEXT badges.
    liveScheduleItemId = item.id;
    renderScheduleList();
  }

  scheduleVerseBtn.addEventListener('click', async () => {
    const chapter = Number(chapterSelectEl.value);
    const verse = Number(verseSelectEl.value);
    if (!chapter || !verse) return;
    const bookLabel = bookSelectEl.options[bookSelectEl.selectedIndex]?.textContent || '';
    await addToSchedule('bible', `${bookLabel} ${chapter}:${verse}`, {
      translation: translationSelectEl.value,
      bookNumber: Number(bookSelectEl.value),
      chapter,
      verse,
    });
  });

  scheduleSongBtn.addEventListener('click', async () => {
    if (!selectedSongId) return;
    await addToSchedule('song', songTitle, { songId: selectedSongId });
  });

  loadBooks().then(loadBook);
  loadSongList();
  loadSchedule(scheduleDateEl.value);

  return {
    destroy() {
      channel.close();
      document.removeEventListener('click', closeSuggestionsOnOutsideClick);
      if (pendingImageObjectUrl) URL.revokeObjectURL(pendingImageObjectUrl);
      if (currentBackdropObjectUrl) URL.revokeObjectURL(currentBackdropObjectUrl);
    },
    // "Live" for the leave-guard means either actual content is on
    // screen, or the projector window itself is still open — an
    // operator who's set a background and gone fullscreen but hasn't
    // clicked Project on anything yet still considers that "a
    // projection" and shouldn't get silently switched away from it.
    isLive() {
      return !!(currentPayload && currentPayload.kind !== 'blank') || !!(projectorWindowRef && !projectorWindowRef.closed);
    },
  };
}

// One-off screen picker for the "Open Projector Screen" button —
// not reused elsewhere, so it's a plain function rather than a
// separate component module. Resolves the chosen ScreenDetailed
// object, or null if dismissed.
function pickScreen(screens) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    root.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-4">${t('projection.chooseScreen')}</h2>
        <div class="space-y-2">
          ${screens.map((s, i) => `
            <button type="button" data-screen-idx="${i}" class="block w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50">
              ${escapeHtml(s.label || t('projection.screenN', { n: i + 1, width: s.width, height: s.height }))}${s.isPrimary ? ` — ${t('projection.thisScreen')}` : ''}
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(root);

    function finish(result) {
      document.body.removeChild(root);
      resolve(result);
    }

    root.querySelectorAll('[data-screen-idx]').forEach((btn) => {
      btn.addEventListener('click', () => finish(screens[Number(btn.dataset.screenIdx)]));
    });
    root.addEventListener('click', (e) => { if (e.target === root) finish(null); });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
