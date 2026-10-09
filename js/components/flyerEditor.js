// The actual flyer editor -- a real Fabric.js canvas (text/image/
// shape objects, move/resize/delete, colors/fonts), not fixed
// templates with text-swap only, per the feature spec's own "move,
// resize or delete elements" requirement. Rendered inline into a
// container (not a modal) so the canvas gets real screen space, same
// pattern as eventsPage.js's own list/detail split.
//
// Fabric loaded on demand (same lazy-import pattern as pdfjs-dist/
// JSZip/qrcode elsewhere in this app) -- nobody pays for it unless
// they actually open the Flyers tab. PNG export is Fabric's own
// native toDataURL(); PDF export reuses window.jspdf, already loaded
// globally for js/components/memberIdCard.js's own PDF export.
import { t } from '../i18n.js';
import { FLYER_SIZES } from '../flyerTemplates.js';

let fabricPromise = null;
function loadFabric() {
  if (!fabricPromise) fabricPromise = import('https://cdn.jsdelivr.net/npm/fabric@6/+esm');
  return fabricPromise;
}

const FONT_FAMILIES = ['Arial, sans-serif', 'Georgia, serif', 'Helvetica, sans-serif', 'Courier New, monospace', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif'];

// Template elements are fractions of the canvas (0-1) so one template
// works at every size preset -- turns each into a real Fabric object.
// `flyerRole` ('title'/'info') is a plain custom property, included in
// canvas.toJSON()'s extra-props list on save, used only to find-and-
// replace text when prefilling from an Event (see applyEventPrefill).
function applyTemplate(fabric, canvas, template, size) {
  canvas.backgroundColor = template.background || '#ffffff';
  (template.elements || []).forEach((el) => {
    if (el.type === 'rect') {
      canvas.add(new fabric.Rect({
        left: el.left * size.width,
        top: el.top * size.height,
        width: el.width * size.width,
        height: (el.height || 0.1) * size.height,
        fill: el.fill,
      }));
    } else if (el.type === 'text') {
      const textbox = new fabric.Textbox(el.text, {
        left: el.left * size.width,
        top: el.top * size.height,
        width: el.width * size.width,
        fontSize: Math.max(8, Math.round(el.fontSize * size.height)),
        fontFamily: el.fontFamily,
        fill: el.fill,
        fontWeight: el.fontWeight || 'normal',
        textAlign: el.textAlign || 'left',
      });
      textbox.flyerRole = el.role || null;
      canvas.add(textbox);
    }
  });
  canvas.renderAll();
}

function applyEventPrefill(canvas, prefill) {
  if (!prefill) return;
  canvas.getObjects().forEach((obj) => {
    if (obj.flyerRole === 'title' && prefill.title) obj.set('text', prefill.title);
    if (obj.flyerRole === 'info' && prefill.infoLine) obj.set('text', prefill.infoLine);
  });
  canvas.renderAll();
}

async function addImageCorner(fabric, canvas, url, size, { corner, widthFraction }) {
  try {
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    const targetWidth = size.width * widthFraction;
    const scale = targetWidth / img.width;
    const margin = size.width * 0.02;
    const left = corner.includes('right') ? size.width - targetWidth - margin : margin;
    const top = corner.includes('bottom') ? size.height - (img.height * scale) - margin : margin;
    img.set({ left, top, scaleX: scale, scaleY: scale });
    canvas.add(img);
  } catch {
    // Logo/QR failed to load (CORS, missing, offline) -- not worth
    // blocking flyer creation over a decorative extra.
  }
}

export async function renderFlyerEditor(container, {
  supabase, tenantId, currentUserId, canManage,
  flyerId, template, sizeKey, logoUrl, eventPrefill,
  onBack, onSaved,
}) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
  const fabric = await loadFabric();

  const workingFlyerId = flyerId || crypto.randomUUID();
  const tenantPrefix = tenantId ? `${tenantId}/` : '';
  let existingCategory = template?.category || null;
  let existingEventId = eventPrefill?.eventId || null;
  let size = sizeKey ? FLYER_SIZES[sizeKey] : null;
  let existingFlyer = null;

  if (flyerId) {
    const { data } = await supabase.from('flyers').select('*').eq('id', flyerId).single();
    existingFlyer = data;
    size = { width: data.canvas_width, height: data.canvas_height };
    existingCategory = data.category;
    existingEventId = data.event_id;
  }
  if (!size) size = FLYER_SIZES.instagram_square;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <button type="button" data-action="back" class="text-sm text-indigo-600 hover:text-indigo-700 font-medium">&larr; ${t('flyers.backToList')}</button>
      <div class="flex items-center gap-2">
        <button type="button" data-action="export-png" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('flyers.exportPng')}</button>
        <button type="button" data-action="export-pdf" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('flyers.exportPdf')}</button>
        ${canManage ? `<button type="button" data-action="save" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('flyers.save')}</button>` : ''}
      </div>
    </div>
    <input type="text" data-el="flyer-title" value="${escapeAttr(existingFlyer?.title || '')}" placeholder="${t('flyers.titlePlaceholder')}"
           class="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-sm mb-3" ${canManage ? '' : 'readonly'} />
    ${canManage ? `
      <div class="flex items-center gap-2 mb-3 flex-wrap border-b border-slate-200 pb-3">
        <button type="button" data-action="add-text" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('flyers.addText')}</button>
        <label class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 cursor-pointer">
          ${t('flyers.addPhoto')}<input type="file" accept="image/*" data-el="photo-input" class="hidden" />
        </label>
        <button type="button" data-action="add-shape" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('flyers.addShape')}</button>
        <button type="button" data-action="bring-front" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('flyers.bringToFront')}</button>
        <button type="button" data-action="duplicate" class="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200">${t('flyers.duplicate')}</button>
        <button type="button" data-action="delete" class="px-2.5 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium hover:bg-rose-200">${t('flyers.delete')}</button>
        <span class="w-px h-5 bg-slate-200"></span>
        <label class="text-xs text-slate-500">${t('flyers.canvasBackground')}</label>
        <input type="color" data-el="bg-color" value="#ffffff" class="w-8 h-7 border border-slate-300 rounded cursor-pointer" />
      </div>
    ` : ''}
    <div class="flex gap-4 items-start">
      <div data-el="canvas-wrap" class="flex-1 border border-slate-300 rounded-lg bg-slate-100 p-4 overflow-auto flex items-center justify-center" style="min-height:420px;">
        <canvas data-el="fabric-canvas"></canvas>
      </div>
      ${canManage ? `<div data-el="properties-panel" class="w-56 shrink-0 border border-slate-200 rounded-lg p-3"><p class="text-xs text-slate-400">${t('flyers.selectHint')}</p></div>` : ''}
    </div>
    <p data-el="status" class="text-sm mt-2"></p>
  `;

  container.querySelector('[data-action="back"]').addEventListener('click', () => onBack());

  const canvasEl = container.querySelector('[data-el="fabric-canvas"]');
  const titleInput = container.querySelector('[data-el="flyer-title"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const propertiesPanelEl = container.querySelector('[data-el="properties-panel"]');

  const canvas = new fabric.Canvas(canvasEl, { width: size.width, height: size.height, backgroundColor: '#ffffff' });
  canvas.selection = canManage;

  function fitToScreen() {
    const wrap = container.querySelector('[data-el="canvas-wrap"]');
    const maxW = Math.max(200, wrap.clientWidth - 32);
    const maxH = Math.min(window.innerHeight * 0.65, 700);
    const scale = Math.min(maxW / size.width, maxH / size.height, 1);
    canvas.setDimensions({ width: size.width * scale, height: size.height * scale });
    canvas.setZoom(scale);
  }

  if (existingFlyer) {
    await canvas.loadFromJSON(existingFlyer.canvas_json);
    canvas.renderAll();
  } else {
    applyTemplate(fabric, canvas, template, size);
    applyEventPrefill(canvas, eventPrefill);
    if (logoUrl) await addImageCorner(fabric, canvas, logoUrl, size, { corner: 'top-right', widthFraction: 0.18 });
    if (eventPrefill?.qrDataUrl) await addImageCorner(fabric, canvas, eventPrefill.qrDataUrl, size, { corner: 'bottom-right', widthFraction: 0.16 });
  }

  if (!canManage) {
    canvas.forEachObject((o) => { o.selectable = false; o.evented = false; });
  }

  fitToScreen();
  window.addEventListener('resize', fitToScreen);

  if (!canManage) return; // read-only viewers get no toolbar/panel wiring below

  const bgColorInput = container.querySelector('[data-el="bg-color"]');
  bgColorInput.addEventListener('input', () => {
    canvas.backgroundColor = bgColorInput.value;
    canvas.renderAll();
  });

  container.querySelector('[data-action="add-text"]').addEventListener('click', () => {
    const tb = new fabric.Textbox(t('flyers.newTextPlaceholder'), {
      left: size.width * 0.1, top: size.height * 0.1, width: size.width * 0.5,
      fontSize: Math.round(size.height * 0.04), fontFamily: 'Arial, sans-serif', fill: '#000000',
    });
    canvas.add(tb);
    canvas.setActiveObject(tb);
    canvas.renderAll();
  });

  container.querySelector('[data-action="add-shape"]').addEventListener('click', () => {
    const rect = new fabric.Rect({
      left: size.width * 0.2, top: size.height * 0.2, width: size.width * 0.3, height: size.height * 0.15, fill: '#4f46e5',
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  });

  container.querySelector('[data-el="photo-input"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    statusEl.className = 'text-sm text-slate-500 mt-2';
    statusEl.textContent = t('common.saving');
    const path = `${tenantPrefix}${workingFlyerId}/photos/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('flyers').upload(path, file, { contentType: file.type });
    if (uploadError) {
      statusEl.className = 'text-sm text-rose-600 mt-2';
      statusEl.textContent = t('flyers.photoUploadFailed', { message: uploadError.message });
      return;
    }
    const { data: urlData } = supabase.storage.from('flyers').getPublicUrl(path);
    const img = await fabric.FabricImage.fromURL(urlData.publicUrl, { crossOrigin: 'anonymous' });
    const maxWidth = size.width * 0.6;
    if (img.width > maxWidth) {
      const scale = maxWidth / img.width;
      img.set({ scaleX: scale, scaleY: scale });
    }
    img.set({ left: size.width * 0.2, top: size.height * 0.2 });
    canvas.add(img);
    canvas.setActiveObject(img);
    canvas.renderAll();
    statusEl.textContent = '';
  });

  container.querySelector('[data-action="bring-front"]').addEventListener('click', () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    canvas.remove(obj);
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.renderAll();
  });

  container.querySelector('[data-action="duplicate"]').addEventListener('click', async () => {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const cloned = await obj.clone();
    cloned.set({ left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
    canvas.add(cloned);
    canvas.setActiveObject(cloned);
    canvas.renderAll();
  });

  container.querySelector('[data-action="delete"]').addEventListener('click', () => {
    canvas.getActiveObjects().forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.renderAll();
  });

  function renderPropertiesPanel(obj) {
    if (!obj) {
      propertiesPanelEl.innerHTML = `<p class="text-xs text-slate-400">${t('flyers.selectHint')}</p>`;
      return;
    }
    const isText = obj.type === 'textbox';
    propertiesPanelEl.innerHTML = `
      ${isText ? `
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('flyers.font')}</label>
        <select data-el="font-family" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs mb-2">
          ${FONT_FAMILIES.map((f) => `<option value="${escapeAttr(f)}" ${obj.fontFamily === f ? 'selected' : ''}>${escapeHtml(f.split(',')[0])}</option>`).join('')}
        </select>
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('flyers.fontSize')}</label>
        <input type="number" data-el="font-size" min="6" value="${Math.round(obj.fontSize || 20)}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs mb-2" />
        <label class="flex items-center gap-1.5 text-xs text-slate-600 mb-2">
          <input type="checkbox" data-el="font-bold" ${obj.fontWeight === 'bold' ? 'checked' : ''} /> ${t('flyers.bold')}
        </label>
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('flyers.textColor')}</label>
        <input type="color" data-el="text-color" value="${toHexColor(obj.fill)}" class="w-full h-8 border border-slate-300 rounded cursor-pointer mb-2" />
      ` : obj.type === 'rect' ? `
        <label class="block text-xs font-medium text-slate-600 mb-1">${t('flyers.shapeColor')}</label>
        <input type="color" data-el="shape-color" value="${toHexColor(obj.fill)}" class="w-full h-8 border border-slate-300 rounded cursor-pointer mb-2" />
      ` : `<p class="text-xs text-slate-400">${t('flyers.imageSelected')}</p>`}
    `;

    propertiesPanelEl.querySelector('[data-el="font-family"]')?.addEventListener('change', (e) => { obj.set('fontFamily', e.target.value); canvas.renderAll(); });
    propertiesPanelEl.querySelector('[data-el="font-size"]')?.addEventListener('input', (e) => { obj.set('fontSize', Number(e.target.value) || 1); canvas.renderAll(); });
    propertiesPanelEl.querySelector('[data-el="font-bold"]')?.addEventListener('change', (e) => { obj.set('fontWeight', e.target.checked ? 'bold' : 'normal'); canvas.renderAll(); });
    propertiesPanelEl.querySelector('[data-el="text-color"]')?.addEventListener('input', (e) => { obj.set('fill', e.target.value); canvas.renderAll(); });
    propertiesPanelEl.querySelector('[data-el="shape-color"]')?.addEventListener('input', (e) => { obj.set('fill', e.target.value); canvas.renderAll(); });
  }

  canvas.on('selection:created', () => renderPropertiesPanel(canvas.getActiveObject()));
  canvas.on('selection:updated', () => renderPropertiesPanel(canvas.getActiveObject()));
  canvas.on('selection:cleared', () => renderPropertiesPanel(null));

  document.addEventListener('keydown', function onKeyDown(e) {
    if (!container.isConnected) { document.removeEventListener('keydown', onKeyDown); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      const active = canvas.getActiveObject();
      if (active && !active.isEditing) {
        canvas.getActiveObjects().forEach((o) => canvas.remove(o));
        canvas.discardActiveObject();
        canvas.renderAll();
      }
    }
  });

  container.querySelector('[data-action="export-png"]').addEventListener('click', () => {
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
    downloadDataUrl(dataUrl, `${titleInput.value.trim() || 'flyer'}.png`);
  });

  container.querySelector('[data-action="export-pdf"]').addEventListener('click', () => {
    if (!window.jspdf) { statusEl.className = 'text-sm text-rose-600 mt-2'; statusEl.textContent = t('flyers.exportUnavailable'); return; }
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 });
    const w = size.width * 2;
    const h = size.height * 2;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
    doc.addImage(dataUrl, 'PNG', 0, 0, w, h);
    doc.save(`${titleInput.value.trim() || 'flyer'}.pdf`);
  });

  container.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      statusEl.className = 'text-sm text-rose-600 mt-2';
      statusEl.textContent = t('flyers.titleRequired');
      return;
    }
    statusEl.className = 'text-sm text-slate-500 mt-2';
    statusEl.textContent = t('common.saving');

    const thumbMultiplier = Math.min(1, 300 / size.width);
    const thumbDataUrl = canvas.toDataURL({ format: 'png', multiplier: thumbMultiplier });
    const thumbBlob = await (await fetch(thumbDataUrl)).blob();
    const thumbPath = `${tenantPrefix}${workingFlyerId}/thumbnail.png`;
    await supabase.storage.from('flyers').upload(thumbPath, thumbBlob, { upsert: true, contentType: 'image/png' });

    const payload = {
      id: workingFlyerId,
      title,
      category: existingCategory,
      canvas_json: canvas.toJSON(['flyerRole']),
      canvas_width: size.width,
      canvas_height: size.height,
      thumbnail_path: thumbPath,
      event_id: existingEventId,
      created_by: currentUserId,
      updated_at: new Date().toISOString(),
    };
    if (tenantId) payload.tenant_id = tenantId;

    const { error } = await supabase.from('flyers').upsert(payload);
    if (error) {
      statusEl.className = 'text-sm text-rose-600 mt-2';
      statusEl.textContent = t('flyers.saveFailed', { message: error.message });
      return;
    }
    statusEl.className = 'text-sm text-emerald-600 mt-2';
    statusEl.textContent = t('flyers.saved');
    onSaved?.(workingFlyerId);
  });
}

function toHexColor(fill) {
  if (typeof fill === 'string' && fill.startsWith('#')) return fill;
  return '#000000';
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
