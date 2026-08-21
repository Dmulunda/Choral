// Shows the signed-in member's personal check-in QR code — just their
// own profile id encoded as plain text, nothing secret — for an usher
// to scan via attendanceManager.js's Scan tab instead of searching for
// their name by hand.
import { t } from '../i18n.js';

export function createMyCheckInCodeModal({ currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-xs p-6 text-center">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">${t('attendance.myCodeTitle')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-sm text-slate-500 mb-4">${t('attendance.myCodeIntro')}</p>
      <div class="flex justify-center">
        <canvas data-el="qr-canvas" class="rounded-lg"></canvas>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const canvasEl = root.querySelector('[data-el="qr-canvas"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    const { default: QRCode } = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm');
    await QRCode.toCanvas(canvasEl, currentUserId, { width: 220, margin: 1 });
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}
