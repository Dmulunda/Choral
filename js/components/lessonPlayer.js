// Renders one lesson's video (uploaded file, YouTube, or Vimeo — all
// three send playhead progress to update_watch_progress()), PDF link,
// and quiz (or a "Mark Complete" button when there's no quiz). The
// quiz/mark-complete control only reveals once 90% watched — enforced
// again server-side by submit_quiz_attempt()/mark_lesson_viewed(), this
// is just the matching UI behavior.
import { renderQuizPlayer } from './quizPlayer.js';
import { t } from '../i18n.js';

const WATCH_THRESHOLD = 0.9;
// Avoids spamming the RPC on every timeupdate/interval tick — only
// sends when the ratchet has moved meaningfully or just crossed 90%.
const SEND_STEP = 0.02;

export function renderLessonPlayer(container, { supabase, lesson, onCompleted }) {
  let maxRatio = 0;
  let lastSentRatio = -1;
  let unlocked = false;
  let stopTracking = null;
  let quizAreaEl = null;
  let markBtnEl = null;

  load();

  async function load() {
    stopTracking?.();
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: progress }, { data: quiz }] = await Promise.all([
      supabase.from('lesson_progress').select('watched_ratio, completed').eq('lesson_id', lesson.id).maybeSingle(),
      supabase.from('quizzes').select('id').eq('lesson_id', lesson.id).maybeSingle(),
    ]);

    maxRatio = progress?.watched_ratio || 0;
    lastSentRatio = maxRatio;
    unlocked = !lesson.video_source || maxRatio >= WATCH_THRESHOLD;

    render(progress?.completed || false, !!quiz);
  }

  function render(completed, hasQuiz) {
    container.innerHTML = `
      <h3 class="text-lg font-semibold mb-3">${escapeHtml(lesson.title)}</h3>
      <div data-el="video-wrap" class="mb-4"></div>
      ${lesson.pdf_storage_path ? `
        <button type="button" data-action="open-pdf" class="mb-4 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">
          ${t('courses.openPdf')}
        </button>
      ` : ''}
      <div data-el="quiz-area"></div>
      ${completed ? `<p class="text-emerald-600 font-medium text-sm mt-2">${t('courses.lessonComplete')}</p>` : ''}
    `;

    if (lesson.pdf_storage_path) {
      container.querySelector('[data-action="open-pdf"]').addEventListener('click', openPdf);
    }

    quizAreaEl = container.querySelector('[data-el="quiz-area"]');
    setupVideo(container.querySelector('[data-el="video-wrap"]'), hasQuiz);

    if (!completed) {
      if (hasQuiz) {
        renderQuizArea();
      } else {
        quizAreaEl.innerHTML = `
          <button type="button" data-action="mark-viewed" class="hidden px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            ${t('courses.markComplete')}
          </button>
          <p data-el="watch-hint" class="text-sm text-amber-600 ${unlocked ? 'hidden' : ''}">${t('courses.watchToUnlock')}</p>
        `;
        markBtnEl = quizAreaEl.querySelector('[data-action="mark-viewed"]');
        markBtnEl.classList.toggle('hidden', !unlocked);
        markBtnEl.addEventListener('click', markViewed);
      }
    }
  }

  function renderQuizArea() {
    if (unlocked) {
      renderQuizPlayer(quizAreaEl, { supabase, lessonId: lesson.id, onPassed: () => { onCompleted?.(); load(); } });
    } else {
      quizAreaEl.innerHTML = `<p class="text-sm text-amber-600">${t('courses.watchToUnlockQuiz')}</p>`;
    }
  }

  // Called on every ratio update — reveals the quiz/mark-complete
  // control the moment 90% is first crossed, without touching the
  // (still-playing) video element.
  function checkUnlock(hasQuiz) {
    if (unlocked) return;
    if (maxRatio < WATCH_THRESHOLD) return;
    unlocked = true;
    if (hasQuiz) {
      renderQuizArea();
    } else {
      markBtnEl?.classList.remove('hidden');
      quizAreaEl?.querySelector('[data-el="watch-hint"]')?.classList.add('hidden');
    }
  }

  async function reportRatio(ratio, hasQuiz) {
    if (ratio > maxRatio) maxRatio = ratio;
    if (maxRatio - lastSentRatio >= SEND_STEP || (maxRatio >= WATCH_THRESHOLD && lastSentRatio < WATCH_THRESHOLD)) {
      lastSentRatio = maxRatio;
      await supabase.rpc('update_watch_progress', { p_lesson_id: lesson.id, p_ratio: maxRatio });
    }
    checkUnlock(hasQuiz);
  }

  function setupVideo(wrapEl, hasQuiz) {
    if (!lesson.video_source) return;
    if (lesson.video_source === 'upload') {
      setupUploadedVideo(wrapEl, hasQuiz);
    } else {
      setupExternalVideo(wrapEl, hasQuiz);
    }
  }

  async function setupUploadedVideo(wrapEl, hasQuiz) {
    const { data, error } = await supabase.storage.from('course-videos').createSignedUrl(lesson.video_storage_path, 3600);
    if (error || !data) {
      wrapEl.innerHTML = `<p class="text-sm text-rose-600">${t('courses.videoLoadFailed', { message: error?.message || '' })}</p>`;
      return;
    }

    const videoEl = document.createElement('video');
    videoEl.src = data.signedUrl;
    videoEl.controls = true;
    videoEl.className = 'w-full rounded-lg bg-black';
    wrapEl.appendChild(videoEl);

    let raf = null;
    const onTick = () => {
      if (videoEl.duration) reportRatio(videoEl.currentTime / videoEl.duration, hasQuiz);
    };
    videoEl.addEventListener('timeupdate', onTick);
    videoEl.addEventListener('pause', onTick);
    videoEl.addEventListener('ended', onTick);
    stopTracking = () => {
      videoEl.removeEventListener('timeupdate', onTick);
      if (raf) cancelAnimationFrame(raf);
    };
  }

  function setupExternalVideo(wrapEl, hasQuiz) {
    const parsed = parseVideoUrl(lesson.video_url);
    if (!parsed) {
      wrapEl.innerHTML = `<a href="${escapeAttr(lesson.video_url)}" target="_blank" rel="noopener" class="text-indigo-600 hover:underline text-sm">${escapeHtml(lesson.video_url)}</a>`;
      return;
    }

    const frameId = `video-frame-${Math.random().toString(36).slice(2)}`;
    const frameHolder = document.createElement('div');
    frameHolder.id = frameId;
    frameHolder.className = 'aspect-video';
    wrapEl.appendChild(frameHolder);

    if (parsed.platform === 'youtube') {
      loadScriptOnce('https://www.youtube.com/iframe_api', () => window.YT?.Player).then((YT) => {
        let player;
        let interval;
        player = new YT.Player(frameId, {
          videoId: parsed.id,
          width: '100%',
          height: '100%',
          events: {
            onReady: () => {
              interval = setInterval(() => {
                const duration = player.getDuration?.();
                const current = player.getCurrentTime?.();
                if (duration) reportRatio(current / duration, hasQuiz);
              }, 2000);
            },
          },
        });
        stopTracking = () => { if (interval) clearInterval(interval); };
      });
    } else if (parsed.platform === 'vimeo') {
      const iframe = document.createElement('iframe');
      iframe.src = `https://player.vimeo.com/video/${parsed.id}`;
      iframe.width = '100%';
      iframe.height = '100%';
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.frameBorder = '0';
      frameHolder.appendChild(iframe);

      loadScriptOnce('https://player.vimeo.com/api/player.js', () => window.Vimeo?.Player).then((VimeoPlayerCtor) => {
        const player = new VimeoPlayerCtor(iframe);
        const onTimeUpdate = (data) => reportRatio(data.percent, hasQuiz);
        player.on('timeupdate', onTimeUpdate);
        stopTracking = () => player.off('timeupdate', onTimeUpdate);
      });
    }
  }

  async function openPdf() {
    const { data, error } = await supabase.storage.from('course-pdfs').createSignedUrl(lesson.pdf_storage_path, 300);
    if (error || !data) {
      window.alert(t('courses.pdfOpenFailed', { message: error?.message || '' }));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function markViewed() {
    const { error } = await supabase.rpc('mark_lesson_viewed', { p_lesson_id: lesson.id });
    if (error) {
      window.alert(t('courses.markCompleteFailed', { message: error.message }));
      return;
    }
    onCompleted?.();
    load();
  }
}

function parseVideoUrl(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { platform: 'youtube', id: yt[1] };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { platform: 'vimeo', id: vimeo[1] };
  return null;
}

const loadedScripts = new Map();
function loadScriptOnce(src, checkReady) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const promise = new Promise((resolve) => {
    const existing = checkReady();
    if (existing) { resolve(existing); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      // YouTube's API signals readiness via a global callback rather
      // than the script's own onload; poll briefly either way since
      // both APIs attach their global object asynchronously.
      const interval = setInterval(() => {
        const ready = checkReady();
        if (ready) { clearInterval(interval); resolve(ready); }
      }, 100);
    };
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
