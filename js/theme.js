// Night mode. The actual class toggle on first paint happens in an
// inline script in index.html's <head> (has to run before anything
// renders, before this module even loads, to avoid a flash of light
// mode) — this module is just the shared get/set used by the sidebar
// toggle in app.js.
import { supabase } from './supabaseClient.js';

const THEME_KEY = 'choir-hub-theme';

export function getTheme() {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// ---- App-wide color/font theme (sql/047, Super Admin's "Customize
// Menu & Appearance") — distinct from night mode above: this is the
// brand palette itself (primary/accent color, text/background color,
// font), not a light/dark preference.
const FONT_STACKS = {
  inter: { label: 'Inter', family: "'Inter', sans-serif", googleFont: 'Inter:wght@400;500;600;700' },
  roboto: { label: 'Roboto', family: "'Roboto', sans-serif", googleFont: 'Roboto:wght@400;500;700' },
  poppins: { label: 'Poppins', family: "'Poppins', sans-serif", googleFont: 'Poppins:wght@400;500;600;700' },
  montserrat: { label: 'Montserrat', family: "'Montserrat', sans-serif", googleFont: 'Montserrat:wght@400;500;600;700' },
  georgia: { label: 'Georgia', family: "Georgia, 'Times New Roman', serif", googleFont: null },
  times: { label: 'Times New Roman', family: "'Times New Roman', Times, serif", googleFont: null },
};

export function getFontChoices() {
  return [{ value: 'default', label: 'Default' }, ...Object.entries(FONT_STACKS).map(([value, f]) => ({ value, label: f.label }))];
}

export async function loadAppTheme() {
  const { data } = await supabase.from('app_theme').select('primary_color, text_color, background_color, font_family').maybeSingle();
  if (data) applyAppTheme(data);
}

export function applyAppTheme({ primary_color, text_color, background_color, font_family }) {
  const root = document.documentElement;
  if (primary_color) {
    root.style.setProperty('--theme-primary', primary_color);
    root.style.setProperty('--theme-primary-hover', darken(primary_color));
  }
  if (text_color) root.style.setProperty('--theme-text', text_color);
  if (background_color) root.style.setProperty('--theme-bg', background_color);

  const font = FONT_STACKS[font_family];
  if (font) {
    root.style.setProperty('--theme-font', font.family);
    if (font.googleFont) loadGoogleFont(font.googleFont);
  } else {
    root.style.setProperty('--theme-font', 'inherit');
  }
}

function darken(hex) {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = Math.max(0, (num >> 16 & 255) - 30);
  const g = Math.max(0, (num >> 8 & 255) - 30);
  const b = Math.max(0, (num & 255) - 30);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const loadedFonts = new Set();
function loadGoogleFont(spec) {
  if (loadedFonts.has(spec)) return;
  loadedFonts.add(spec);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(link);
}
