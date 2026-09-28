// Minimal canvas-based signature capture — freehand drawing via
// Pointer Events (covers mouse, touch, and pen with one code path).
// Deliberately hand-rolled rather than pulling in a signature library:
// the actual drawing logic is short enough that a new dependency
// wasn't worth it. Used by myProfileModal.js (a member's own
// signature) and userEditModal.js (the pastor's — see sql/084's
// signature_data column, reused on every card once set).
export function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0B1F3A';

  let drawing = false;
  let hasStroke = false;
  let lastX = 0;
  let lastY = 0;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function start(e) {
    drawing = true;
    hasStroke = true;
    const p = pos(e);
    lastX = p.x;
    lastY = p.y;
    canvas.setPointerCapture(e.pointerId);
  }

  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
  }

  function end() {
    drawing = false;
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);

  function clear() {
    // Transparent, not filled -- kept that way deliberately so whatever
    // displays a saved signature can recolor/recompose it against its own
    // background (e.g. memberIdCard.js recolors the ink to white for its
    // navy card back; a white-background context like a printed letter
    // can just use the navy ink as drawn, unmodified).
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStroke = false;
  }

  function isEmpty() {
    return !hasStroke;
  }

  function toDataUrl() {
    return canvas.toDataURL('image/png');
  }

  // Loads a previously-saved signature onto the canvas (e.g. so
  // editing shows what's already saved rather than a blank pad) —
  // counts as a stroke already present, since re-saving without
  // touching the pad should keep it, not silently clear it.
  function loadFromDataUrl(dataUrl) {
    if (!dataUrl) return;
    // Set synchronously, not inside onload below -- isEmpty() can be
    // checked (on form submit) before the async image decode finishes,
    // and a data URL was already given, so "empty" is already wrong the
    // instant this is called, not just once the pixels are drawn.
    hasStroke = true;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = dataUrl;
  }

  return { clear, isEmpty, toDataUrl, loadFromDataUrl };
}
