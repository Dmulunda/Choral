// Song detail view: YouTube player alongside lyrics, plus rehearsal
// audio filtered to the viewer's own voice part.
import { extractYouTubeId, loadYouTubeIframeAPI } from '../utils/youtube.js';
import { t, tn, voicePartLabel } from '../i18n.js';

let playerInstanceCounter = 0;

const PART_TRACK_FIELDS = {
  Soprano: 'audio_soprano_track',
  Alto: 'audio_alto_track',
  Tenor: 'audio_tenor_track',
};

export function renderSongDetail(container, song, { supabase, isAdmin, onBack, onDeleted, viewerVoiceParts }) {
  const playerId = `yt-player-${++playerInstanceCounter}`;
  const videoId = extractYouTubeId(song.youtube_url);

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="back"
              class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">${t('songDetail.back')}</button>
      ${isAdmin ? `
        <button type="button" data-action="delete"
                class="text-sm font-medium text-rose-600 hover:text-rose-800">${t('songDetail.delete')}</button>
      ` : ''}
    </div>

    <div class="flex items-baseline justify-between mb-4">
      <h2 class="text-2xl font-bold">${escapeHtml(song.title)}</h2>
      ${song.key ? `<span class="text-sm text-slate-500">${t('songDetail.key', { key: escapeHtml(song.key) })}</span>` : ''}
    </div>

    <div class="grid md:grid-cols-2 gap-6">
      <div>
        ${videoId
          ? `<div class="aspect-video rounded-xl overflow-hidden bg-black" id="${playerId}"></div>`
          : `<div class="aspect-video rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">${t('songDetail.noVideoLinked')}</div>`
        }
        ${song.audio_lead_track ? `
          <div class="mt-4">
            <div class="text-sm font-medium text-slate-600 mb-1">${t('songDetail.leadTrack')}</div>
            <audio controls class="w-full" src="${escapeAttr(song.audio_lead_track)}"></audio>
          </div>
        ` : ''}
        ${renderPartTracks(song, viewerVoiceParts)}
      </div>

      <div class="bg-white rounded-xl shadow p-5 max-h-[32rem] overflow-y-auto">
        <h3 class="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">${t('songDetail.lyrics')}</h3>
        <pre class="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed">${
          song.lyrics ? escapeHtml(song.lyrics) : t('songDetail.noLyricsYet')
        }</pre>
      </div>
    </div>
  `;

  container.querySelector('[data-action="back"]').addEventListener('click', onBack);

  if (isAdmin) {
    container.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!window.confirm(t('songDetail.confirmDelete', { title: song.title }))) return;

      const { error } = await supabase.from('songs').delete().eq('id', song.id);
      if (error) {
        window.alert(t('songDetail.deleteFailed', { message: error.message }));
        return;
      }
      onDeleted?.();
    });
  }

  if (videoId) {
    loadYouTubeIframeAPI().then((YT) => {
      new YT.Player(playerId, {
        videoId,
        playerVars: { rel: 0 },
      });
    });
  }
}

function renderPartTracks(song, viewerVoiceParts) {
  const voiceParts = viewerVoiceParts || [];

  const ownParts = Object.entries(PART_TRACK_FIELDS)
    .filter(([part]) => voiceParts.includes(part))
    .filter(([, field]) => song[field]);

  const otherParts = Object.entries(PART_TRACK_FIELDS)
    .filter(([part]) => !voiceParts.includes(part))
    .filter(([, field]) => song[field]);

  if (ownParts.length === 0 && otherParts.length === 0) return '';

  const ownTrackHtml = ownParts.map(([part, field]) => `
    <div class="mt-4 p-3 rounded-lg bg-indigo-50 border border-indigo-200">
      <div class="text-sm font-medium text-indigo-700 mb-1">${t('songDetail.yourPartTrack', { part: escapeHtml(voicePartLabel(part)) })}</div>
      <audio controls class="w-full" src="${escapeAttr(song[field])}"></audio>
    </div>
  `).join('');

  const otherPartsHtml = otherParts.length > 0 ? `
    <details class="mt-4">
      <summary class="text-sm font-medium text-slate-600 cursor-pointer">${tn('songDetail.otherPartTracks', otherParts.length)}</summary>
      <div class="mt-2 space-y-3">
        ${otherParts.map(([part, field]) => `
          <div>
            <div class="text-sm font-medium text-slate-600 mb-1">${escapeHtml(voicePartLabel(part))}</div>
            <audio controls class="w-full" src="${escapeAttr(song[field])}"></audio>
          </div>
        `).join('')}
      </div>
    </details>
  ` : '';

  return ownTrackHtml + otherPartsHtml;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
