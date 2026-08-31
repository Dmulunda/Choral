// Embedded voice/video meetings via Jitsi Meet's public server
// (meet.jit.si) — free, no account or API key needed, so nothing to
// configure server-side. Loads Jitsi's IFrame API script on first use
// and reuses it after. Two callers: deptDashboard.js/dashboard.js for
// a department's recurring group room ('choir-app-dept-<department
// id>' — the id is already an unguessable UUID, so that alone is the
// room's privacy), and pastorMeetingRequests.js for a one-to-one
// pastoral call using the random room sql/068 generates on confirm.
import { t } from '../i18n.js';

let apiScriptPromise = null;

function loadJitsiScript() {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (apiScriptPromise) return apiScriptPromise;
  apiScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://meet.jit.si/external_api.js';
    script.onload = () => resolve();
    script.onerror = () => { apiScriptPromise = null; reject(new Error('load failed')); };
    document.head.appendChild(script);
  });
  return apiScriptPromise;
}

export async function openVideoMeeting({ roomName, displayName, title }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-[200] bg-black flex flex-col';
  root.innerHTML = `
    <div class="flex items-center justify-between px-4 py-2.5 bg-slate-900 text-white shrink-0">
      <span class="font-medium text-sm">${escapeHtml(title || t('meeting.title'))}</span>
      <button type="button" data-action="close" class="text-white text-2xl leading-none hover:text-slate-300">&times;</button>
    </div>
    <div data-el="jitsi-container" class="flex-1"></div>
  `;
  document.body.appendChild(root);

  let api = null;
  function close() {
    api?.dispose();
    root.remove();
  }
  root.querySelector('[data-action="close"]').addEventListener('click', close);

  try {
    await loadJitsiScript();
  } catch {
    root.querySelector('[data-el="jitsi-container"]').innerHTML =
      `<p class="text-white text-center mt-10 px-4">${t('meeting.loadFailed')}</p>`;
    return;
  }

  api = new window.JitsiMeetExternalAPI('meet.jit.si', {
    roomName,
    parentNode: root.querySelector('[data-el="jitsi-container"]'),
    userInfo: { displayName },
    configOverwrite: { prejoinPageEnabled: false },
  });

  api.addEventListener('readyToClose', close);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
