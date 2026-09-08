// Digital Member ID Card — a two-sided official-style card (front:
// photo, name, sex, member_code, function, parish, issue/expiration
// dates, QR; back: birth info, join date, address, signatures) in this
// app's own navy/gold branding — modeled on a reference design the
// user provided, with our own colors/logo rather than copying its
// color scheme.
//
// member_code (sql/083) is used instead of the raw profile UUID since
// this gets printed/shared. sex/parish/member_title/card_issued_at/
// card_revoked_at/signature_data/birth_country/birth_city are sql/084.
//
// member_title is one of exactly three functions: pastor_principal,
// department_head, member.
//
// Expiration is never stored — it's always computed as card_issued_at
// + 2 years, so the "2 years from issue" rule can't drift from what's
// actually displayed. A revoked card (card_revoked_at set) shows a
// clear stamp and skips the QR entirely, rather than continuing to
// display a scannable code for a card that's no longer valid.
//
// Signatures: a member's own signature_data (self-set in
// myProfileModal.js) renders as their line on the back; the pastor's
// line always pulls from whichever single profile currently has
// member_title = 'pastor_principal' (set once via userEditModal.js),
// so the pastor never has to sign more than once for it to appear on
// every member's card.
//
// Renders as live DOM (not a popup window like certificate.js) so
// html2canvas/jsPDF — loaded via CDN in index.html — can rasterize it
// into an actual PNG/PDF file, not just a browser print-to-PDF.
import { t } from '../i18n.js';
// The `qrcode` npm package ships no browser <script> bundle (only
// bundler-ready CommonJS source) — jsdelivr's "+esm" endpoint converts
// it on the fly, same convention already used for @supabase/supabase-js
// elsewhere in this app.
import { toCanvas as qrToCanvas } from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm';

const CARD_WIDTH = 400;
const CARD_HEIGHT = 252;
const NAVY = '#0B1F3A';
const GOLD = '#D4AF37';
const CARD_VALID_YEARS = 2;

function functionLabel(memberTitle) {
  return memberTitle ? t(`memberCard.function.${memberTitle}`) : '—';
}

export async function renderMemberIdCard(container, { supabase, userId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const [{ data: profile, error }, { data: pastorRow }] = await Promise.all([
    supabase
      .from('profiles')
      .select(`
        full_name, member_code, photo_path, address, sex, member_title, parish,
        birth_country, birth_city, global_role, created_at,
        card_issued_at, card_revoked_at, signature_data
      `)
      .eq('id', userId)
      .single(),
    supabase.from('profiles').select('signature_data').eq('member_title', 'pastor_principal').limit(1).maybeSingle(),
  ]);

  if (error || !profile) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('memberCard.loadFailed', { message: error?.message || '' })}</p>`;
    return;
  }

  let photoUrl = null;
  if (profile.photo_path) {
    const { data: signed } = await supabase.storage.from('member-photos').createSignedUrl(profile.photo_path, 3600);
    photoUrl = signed?.signedUrl || null;
  }

  const isRevoked = !!profile.card_revoked_at;

  const dateFmt = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const issuedDate = profile.card_issued_at || new Date().toISOString().slice(0, 10);
  const expirationDate = new Date(issuedDate);
  expirationDate.setFullYear(expirationDate.getFullYear() + CARD_VALID_YEARS);
  const joinedDate = dateFmt(profile.created_at);
  const birthLine = [profile.birth_city, profile.birth_country].filter(Boolean).join(', ') || '—';
  const sexLabel = profile.sex === 'M' ? t('memberCard.male') : profile.sex === 'F' ? t('memberCard.female') : '—';
  const logoUrl = `${window.location.origin}/img/vpd-logo.png`;

  container.innerHTML = `
    <div data-el="cards-wrap">
      <div data-el="card-front" style="${cardOuterStyle()}position:relative;">
        ${headerBar(logoUrl, true)}
        <div style="display:flex;gap:12px;padding:12px 16px;flex:1;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;">
            <div style="width:84px;height:104px;border-radius:6px;background:#1e2f4d;border:2px solid ${GOLD};overflow:hidden;display:flex;align-items:center;justify-content:center;">
              ${photoUrl ? `<img src="${photoUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : `<span style="font-size:10px;color:#93a5c4;text-align:center;">${escapeHtml(t('memberCard.noPhoto'))}</span>`}
            </div>
            <div style="font-size:9px;font-weight:700;color:${GOLD};">${escapeHtml(t('memberCard.numberShort'))} ${escapeHtml(profile.member_code || '')}</div>
          </div>
          <div style="flex:1;font-size:11px;line-height:1.55;">
            ${fieldRow(t('memberCard.fullName'), profile.full_name)}
            ${fieldRow(t('memberCard.sex'), sexLabel)}
            ${fieldRow(t('memberCard.matricule'), profile.member_code)}
            ${fieldRow(t('memberCard.function'), functionLabel(profile.member_title))}
            ${fieldRow(t('memberCard.parish'), profile.parish || '—')}
            ${fieldRow(t('memberCard.issuedOn'), dateFmt(issuedDate))}
            ${fieldRow(t('memberCard.expiresOn'), dateFmt(expirationDate))}
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;">
            ${isRevoked || !profile.member_code
              ? `<div style="width:60px;height:60px;background:#1e2f4d;border:2px solid #93a5c4;border-radius:4px;display:flex;align-items:center;justify-content:center;text-align:center;"><span style="font-size:8px;color:#93a5c4;">${escapeHtml(t('memberCard.qrUnavailable'))}</span></div>`
              : `<canvas data-el="qr" width="60" height="60" style="width:60px;height:60px;background:white;border:2px solid ${GOLD};border-radius:4px;"></canvas>`}
          </div>
        </div>
        ${isRevoked ? revokedStamp() : ''}
      </div>

      <div data-el="card-back" style="${cardOuterStyle()}margin-top:14px;position:relative;">
        ${headerBar(logoUrl, false)}
        <div style="padding:12px 16px;flex:1;font-size:11px;line-height:1.55;">
          ${fieldRow(t('memberCard.birthInfo'), birthLine)}
          ${fieldRow(t('memberCard.joinedOn'), joinedDate)}
          ${fieldRow(t('memberCard.address'), profile.address || '—')}
          <div style="display:flex;gap:24px;margin-top:12px;">
            ${signatureBlock(t('memberCard.memberSignature'), profile.signature_data)}
            ${signatureBlock(t('memberCard.pastorSignature'), pastorRow?.signature_data)}
          </div>
        </div>
        <div style="background:${GOLD};color:${NAVY};font-size:10px;font-weight:700;text-align:center;padding:5px;letter-spacing:0.5px;">
          ${escapeHtml(t('memberCard.churchFullName'))}
        </div>
        ${isRevoked ? revokedStamp() : ''}
      </div>
    </div>
    <div class="mt-3 flex gap-2">
      <button type="button" data-action="download-png" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">${t('memberCard.downloadPng')}</button>
      <button type="button" data-action="download-pdf" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">${t('memberCard.downloadPdf')}</button>
    </div>
    <p data-el="status" class="text-sm text-slate-500 mt-2"></p>
  `;

  const wrapEl = container.querySelector('[data-el="cards-wrap"]');
  const qrEl = container.querySelector('[data-el="qr"]');
  const statusEl = container.querySelector('[data-el="status"]');

  if (qrEl && profile.member_code) {
    try { await qrToCanvas(qrEl, profile.member_code, { width: 60, margin: 0 }); } catch { /* QR is a nice-to-have, not worth failing the whole card over */ }
  }

  container.querySelector('[data-action="download-png"]').addEventListener('click', () => downloadPng(wrapEl, statusEl));
  container.querySelector('[data-action="download-pdf"]').addEventListener('click', () => downloadPdf(container, statusEl));
}

function cardOuterStyle() {
  return `width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;background:${NAVY};color:white;border-radius:14px;overflow:hidden;font-family:system-ui,sans-serif;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,0.3);`;
}

function headerBar(logoUrl, isFront) {
  // The logo file is a wide lockup (seal + full church name text), not
  // a square mark — showing it at its natural aspect ratio here rather
  // than clipped into a small circle (which used to squash it into an
  // illegible sliver). It already carries the church name, so there's
  // no separate name text here — just the card-label subtitle.
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 14px;border-bottom:2px solid ${GOLD};background:white;">
      <img src="${logoUrl}" alt="" style="height:32px;width:auto;flex-shrink:0;" />
      <div style="flex:1;line-height:1.2;text-align:right;">
        <div style="font-size:9px;letter-spacing:0.5px;color:${NAVY};font-weight:700;">${escapeHtml(t('memberCard.cardLabel'))}</div>
      </div>
      ${isFront ? `<span style="font-size:16px;" aria-hidden="true">📷</span>` : ''}
    </div>
  `;
}

function fieldRow(label, value) {
  return `<div style="display:flex;gap:6px;"><span style="color:#93a5c4;min-width:98px;">${escapeHtml(label)}</span><span style="font-weight:600;color:white;">${escapeHtml(value ?? '—')}</span></div>`;
}

function signatureBlock(label, signatureDataUrl) {
  return `
    <div style="flex:1;">
      <div style="border-bottom:1px solid #93a5c4;height:32px;display:flex;align-items:flex-end;justify-content:center;">
        ${signatureDataUrl ? `<img src="${signatureDataUrl}" alt="" style="max-height:30px;max-width:100%;" />` : ''}
      </div>
      <div style="font-size:9px;color:#93a5c4;margin-top:3px;">${escapeHtml(label)}</div>
    </div>
  `;
}

function revokedStamp() {
  return `
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
      <div style="transform:rotate(-18deg);border:4px solid #dc2626;color:#dc2626;font-size:28px;font-weight:800;letter-spacing:3px;padding:4px 18px;border-radius:8px;background:rgba(11,31,58,0.55);">
        ${escapeHtml(t('memberCard.revokedStamp'))}
      </div>
    </div>
  `;
}

async function downloadPng(wrapEl, statusEl) {
  if (!window.html2canvas) { statusEl.textContent = t('memberCard.exportUnavailable'); return; }
  statusEl.textContent = t('common.loading');
  const canvas = await window.html2canvas(wrapEl, { backgroundColor: '#ffffff', scale: 2 });
  const link = document.createElement('a');
  link.download = 'member-id-card.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  statusEl.textContent = '';
}

async function downloadPdf(container, statusEl) {
  if (!window.html2canvas || !window.jspdf) { statusEl.textContent = t('memberCard.exportUnavailable'); return; }
  statusEl.textContent = t('common.loading');
  const frontEl = container.querySelector('[data-el="card-front"]');
  const backEl = container.querySelector('[data-el="card-back"]');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [CARD_WIDTH, CARD_HEIGHT] });

  const frontCanvas = await window.html2canvas(frontEl, { backgroundColor: '#ffffff', scale: 2 });
  doc.addImage(frontCanvas.toDataURL('image/png'), 'PNG', 0, 0, CARD_WIDTH, CARD_HEIGHT);

  doc.addPage([CARD_WIDTH, CARD_HEIGHT], 'landscape');
  const backCanvas = await window.html2canvas(backEl, { backgroundColor: '#ffffff', scale: 2 });
  doc.addImage(backCanvas.toDataURL('image/png'), 'PNG', 0, 0, CARD_WIDTH, CARD_HEIGHT);

  doc.save('member-id-card.pdf');
  statusEl.textContent = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
