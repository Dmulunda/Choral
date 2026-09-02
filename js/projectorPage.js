// Standalone projection display (projector.html) — meant to be opened
// in its own window/tab and dragged onto whichever screen is
// connected to the physical projector, while the operator keeps
// working from the main app on their own screen. Pure Realtime
// broadcast listener: no auth, no DB reads, just whatever the operator
// panel (js/components/projectionControl.js) last sent. See
// js/utils/projection.js for the shared channel name/payload shape.
import { supabase } from './supabaseClient.js';
import { PROJECTION_CHANNEL } from './utils/projection.js';
import { loadYouTubeIframeAPI } from './utils/youtube.js';

const backdropEl = document.getElementById('backdrop');
const linesEl = document.getElementById('lines');
const referenceEl = document.getElementById('reference');
const imageEl = document.getElementById('image-slide');
const videoContainerEl = document.getElementById('video-container');
const idleEl = document.getElementById('idle');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');

// Enters fullscreen immediately on load — no "click to enter" prompt,
// since that's one more distraction/manual step during a live
// service. Fullscreen normally requires a user gesture, but a window
// opened via window.open() from a genuine click (the operator's "Open
// Projector Screen" button) inherits that activation in every browser
// that matters here, so calling this straight from page load works.
// If it's ever denied (e.g. the page was opened by typing the URL
// directly, with no click behind it), the page still works — just
// with browser chrome visible — rather than getting stuck.
async function enterFullscreen() {
  const params = new URLSearchParams(location.search);
  const targetLeft = params.get('sl');
  const targetTop = params.get('st');

  if (targetLeft !== null && targetTop !== null && 'getScreenDetails' in window) {
    try {
      const screenDetails = await window.getScreenDetails();
      const target = screenDetails.screens.find((s) => String(s.left) === targetLeft && String(s.top) === targetTop);
      if (target) {
        await document.documentElement.requestFullscreen({ screen: target });
        return;
      }
    } catch {
      // Permission not granted or API not actually usable here — fall
      // through to a plain fullscreen on whichever screen this window
      // already sits on.
    }
  }

  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Denied — leave it non-fullscreen rather than stuck with no content.
  }
}

enterFullscreen();
exitFullscreenBtn.addEventListener('click', () => document.exitFullscreen?.());
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
  showControlsBriefly();
});

// The exit button/cursor only auto-hide after the mouse has been
// still for a bit (video-player style) — never permanently, so
// there's always a way back out just by moving the mouse. Esc also
// exits fullscreen on its own (that's the browser's doing, not this
// page's), but not everyone remembers that, hence the visible button.
let controlsIdleTimer = null;
function showControlsBriefly() {
  document.body.classList.remove('controls-idle');
  clearTimeout(controlsIdleTimer);
  controlsIdleTimer = setTimeout(() => document.body.classList.add('controls-idle'), 3000);
}
document.addEventListener('mousemove', showControlsBriefly);
showControlsBriefly();

let youtubePlayer = null; // current YT.Player instance, if a YouTube video is loaded
let fileVideoEl = null; // current <video> element, if an uploaded file is loaded
let currentVideoKind = null; // 'youtube' | 'file' | null — which of the two is active

// Deliberately NOT content-dependent — an earlier version auto-shrank
// long lines/many-line stanzas, which meant the "same" size setting
// looked different from one song's part to the next and had to be
// re-adjusted constantly. The slider is the only thing that changes
// this now: pick a size once and it stays that size for every verse
// and every song part until changed again. A stanza too long for the
// chosen size clips (see #lines' max-height/overflow in projector.html)
// rather than silently shrinking to fit.
function fontSizeFor(scale) {
  return `${4 * (scale || 1)}vw`;
}

function stopVideo() {
  // Hiding the container isn't enough — an unpaused <video> or YT
  // player keeps playing (and its audio keeps going) even while
  // display:none, so switching away from a video has to actually tear
  // it down, not just visually hide it.
  youtubePlayer?.destroy?.();
  youtubePlayer = null;
  fileVideoEl?.pause();
  fileVideoEl = null;
  currentVideoKind = null;
  videoContainerEl.innerHTML = '';
}

function hideAllContent() {
  linesEl.innerHTML = '';
  referenceEl.textContent = '';
  imageEl.style.display = 'none';
  imageEl.src = '';
  videoContainerEl.style.display = 'none';
  stopVideo();
}

function setBackdrop(url) {
  backdropEl.style.backgroundImage = url ? `url("${url}")` : '';
}

function showText(payload) {
  hideAllContent();
  idleEl.style.display = 'none';
  setBackdrop(payload.backdrop);
  const fontSize = fontSizeFor(payload.fontScale);
  linesEl.style.fontSize = fontSize;
  linesEl.innerHTML = payload.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  referenceEl.textContent = payload.reference || '';
}

function showImage(payload) {
  hideAllContent();
  idleEl.style.display = 'none';
  setBackdrop(null);
  imageEl.src = payload.url;
  imageEl.style.display = 'block';
}

async function handleVideo(payload) {
  // A pause/resume with nothing actually loaded means this page just
  // (re)connected — e.g. mid-video network blip — with no player to
  // pause/resume. Load it fresh instead of silently doing nothing;
  // falling through to the 'play' branch below.
  const nothingLoaded = currentVideoKind === null;

  if (payload.action === 'pause' && !nothingLoaded) {
    if (currentVideoKind === 'youtube') youtubePlayer?.pauseVideo();
    else if (currentVideoKind === 'file') fileVideoEl?.pause();
    return;
  }
  if (payload.action === 'resume' && !nothingLoaded) {
    if (currentVideoKind === 'youtube') youtubePlayer?.playVideo();
    else if (currentVideoKind === 'file') fileVideoEl?.play();
    return;
  }

  // action === 'play' — load fresh.
  hideAllContent();
  idleEl.style.display = 'none';
  setBackdrop(null);
  videoContainerEl.style.display = 'block';
  videoContainerEl.innerHTML = '';
  youtubePlayer = null;
  fileVideoEl = null;

  if (payload.source === 'youtube') {
    currentVideoKind = 'youtube';
    const mount = document.createElement('div');
    mount.id = 'yt-projector-player';
    videoContainerEl.appendChild(mount);
    const YT = await loadYouTubeIframeAPI();
    youtubePlayer = new YT.Player('yt-projector-player', {
      videoId: payload.videoId,
      playerVars: { autoplay: 1, rel: 0, controls: 0 },
      events: { onReady: (e) => e.target.playVideo() },
    });
  } else {
    currentVideoKind = 'file';
    fileVideoEl = document.createElement('video');
    fileVideoEl.src = payload.url;
    fileVideoEl.autoplay = true;
    fileVideoEl.controls = false;
    videoContainerEl.appendChild(fileVideoEl);
  }
}

let lastShownKey = null;

function show(payload) {
  // A "hello" resend (this page reconnecting after a network blip,
  // sleep, etc.) re-delivers whatever's currently live even when
  // nothing actually changed — without this, that would still tear
  // down and rebuild the DOM (a visible flash) for identical content.
  // Video pause/resume/play actions are exempt: those are deliberate
  // operator actions and must always go through, even if the rest of
  // the payload looks unchanged.
  const key = JSON.stringify(payload || { kind: 'blank' });
  if (key === lastShownKey && payload?.kind !== 'video') return;
  lastShownKey = key;

  if (!payload || payload.kind === 'blank') {
    hideAllContent();
    setBackdrop(null);
    idleEl.style.display = 'block';
    return;
  }

  if (payload.kind === 'bible' || payload.kind === 'song') showText(payload);
  else if (payload.kind === 'image') showImage(payload);
  else if (payload.kind === 'video') handleVideo(payload);
}

show(null);

const channel = supabase.channel(PROJECTION_CHANNEL);
channel
  .on('broadcast', { event: 'show' }, ({ payload }) => show(payload))
  .subscribe((status) => {
    // Ask whoever's operating the panel to resend whatever's currently
    // live — this page may have just opened, or reconnected after the
    // laptop went to sleep mid-service.
    if (status === 'SUBSCRIBED') channel.send({ type: 'broadcast', event: 'hello', payload: {} });
  });

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
