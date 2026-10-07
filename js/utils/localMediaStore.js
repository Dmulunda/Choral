// Persistent local-folder storage for Projection media (images,
// video, a song-lyrics cache), via the File System Access API --
// the operator picks a real folder on their computer once, and the
// app reads/writes actual files there, genuinely unlimited by
// whatever disk space exists. Chromium-only (Chrome/Edge) -- Firefox
// and Safari have no support for this API at all; isSupported() lets
// every call site degrade to today's in-memory-only behavior rather
// than breaking.
//
// The granted FileSystemDirectoryHandle itself is stored in
// IndexedDB (NOT localStorage -- a directory handle is a structured-
// cloneable object, not a string, and IndexedDB is the documented way
// to persist one of these across reloads). Browsers may still ask to
// re-confirm permission on a later visit (requestPermission()) --
// usually silent in the same browser profile, but never assume it's
// still granted without checking.
const DB_NAME = 'choir-hub-local-media';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const FOLDER_HANDLE_KEY = 'projection-folder';

export function isSupported() {
  return 'showDirectoryPicker' in window;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Asks the operator to pick a folder, remembers it for next time.
// Returns the handle, or null if the picker was dismissed.
export async function requestFolderAccess() {
  if (!isSupported()) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet(FOLDER_HANDLE_KEY, handle);
    return handle;
  } catch {
    return null; // dismissed, or permission denied
  }
}

// Reads back whatever folder was previously granted, re-confirming
// permission if the browser needs that (usually silent). Returns
// null if nothing was ever granted, or permission is now refused.
export async function getFolderHandle() {
  if (!isSupported()) return null;
  const handle = await idbGet(FOLDER_HANDLE_KEY);
  if (!handle) return null;
  try {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return handle;
    const requested = await handle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted' ? handle : null;
  } catch {
    return null; // handle no longer valid (folder moved/deleted, etc.)
  }
}

export async function forgetFolderAccess() {
  await idbSet(FOLDER_HANDLE_KEY, null);
}

// Writes a copy of `file` into the granted folder under its own name
// (overwriting if it already exists -- re-adding the same file is a
// deliberate replace, not an error).
export async function saveFile(folderHandle, file) {
  const fileHandle = await folderHandle.getFileHandle(file.name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return file.name;
}

// Lists every file already in the folder (name + the live File object,
// so a caller can preview/re-use it without a second read), newest
// first isn't tracked by the filesystem itself so this is alphabetical.
export async function listFiles(folderHandle) {
  const files = [];
  for await (const entry of folderHandle.values()) {
    if (entry.kind === 'file') files.push({ name: entry.name, handle: entry });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readFile(folderHandle, name) {
  const fileHandle = await folderHandle.getFileHandle(name);
  return fileHandle.getFile();
}

export async function deleteFile(folderHandle, name) {
  await folderHandle.removeEntry(name);
}

// ---- Small JSON read-through cache, same folder, used by the song
// local-caching feature (projectionControl.js: the first time any
// song is sent live, its lyrics get cached here so a later service
// with no connectivity can still pull them up from disk). ----
const SONGS_CACHE_FILE = 'projection-songs-cache.json';

export async function readSongsCache(folderHandle) {
  try {
    const file = await readFile(folderHandle, SONGS_CACHE_FILE);
    return JSON.parse(await file.text());
  } catch {
    return {}; // file doesn't exist yet, or is corrupt -- start fresh
  }
}

export async function cacheSong(folderHandle, song) {
  const cache = await readSongsCache(folderHandle);
  cache[song.id] = { id: song.id, title: song.title, lyrics: song.lyrics, cachedAt: new Date().toISOString() };
  const fileHandle = await folderHandle.getFileHandle(SONGS_CACHE_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(cache));
  await writable.close();
}
