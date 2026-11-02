// Field Notes storage, per profile.
//   OPFS (the browser's private file system): notes/<profile>/pages/<page>.json and
//   notes/<profile>/photos/<photo>.jpg. Where OPFS can't write files (older Safari, some
//   private modes) the same files go into IndexedDB ("notefiles") instead.
//   IndexedDB "notes": one small index record per page (which cards it is linked to,
//   timestamps), so the binder can show a card's notes without opening every page.
// Index records carry createdAt / updatedAt / deletedAt like every other record, for sync.
import * as db from './db.js';
import { state } from './store.js';

const nowIso = () => new Date().toISOString();
export const PAGE_W = 1000;
export const PAGE_H = 1400;

// ---------- files ----------

let opfs; // Promise<FileSystemDirectoryHandle | null>
function opfsRoot() {
  opfs ??= (async () => {
    try {
      if (!navigator.storage?.getDirectory || !('createWritable' in (globalThis.FileSystemFileHandle?.prototype ?? {}))) return null;
      return await navigator.storage.getDirectory();
    } catch { return null; }
  })();
  return opfs;
}

async function dirFor(root, parts, create) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

// path: "pages/<id>.json" or "photos/<id>.jpg", inside the profile's folder.
async function putFile(pid, path, blob) {
  const root = await opfsRoot();
  if (root) {
    try {
      const parts = ['notes', pid, ...path.split('/')];
      const name = parts.pop();
      const dir = await dirFor(root, parts, true);
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch { /* fall back below */ }
  }
  await db.put('notefiles', { id: `${pid}/${path}`, profileId: pid, blob });
}

async function getFile(pid, path) {
  const root = await opfsRoot();
  if (root) {
    try {
      const parts = ['notes', pid, ...path.split('/')];
      const name = parts.pop();
      const dir = await dirFor(root, parts, false);
      return await (await dir.getFileHandle(name)).getFile();
    } catch { /* not there: maybe in IndexedDB */ }
  }
  return (await db.get('notefiles', `${pid}/${path}`))?.blob ?? null;
}

// ---------- the index ----------

// The active profile's pages, oldest first (the notebook's order).
export async function loadIndex() {
  const pid = state.profile?.id;
  if (!pid) { state.notes = []; return []; }
  state.notes = (await db.all('notes', pid)).filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return state.notes;
}

export const pagesFor = cardId => state.notes.filter(r => r.cardIds.includes(cardId));
export const notesCount = cardId => pagesFor(cardId).length;

// The cards a page is linked to: the one in its header, ones it was opened next to, and
// every animal stamped on it.
export function cardIdsOf(page) {
  return [...new Set([page.header?.cardId, ...(page.links ?? []), ...page.items.filter(i => i.t === 'm').map(i => i.card)].filter(Boolean))];
}

async function writeIndex(page, existing) {
  const pid = state.profile.id;
  const at = nowIso();
  const rec = {
    id: `${pid}:${page.id}`, profileId: pid, pageId: page.id, cardIds: cardIdsOf(page),
    createdAt: existing?.createdAt ?? page.createdAt ?? at, updatedAt: at, deletedAt: null,
  };
  await db.put('notes', rec);
  state.notes = [...state.notes.filter(r => r.pageId !== page.id), rec].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return rec;
}

// ---------- pages ----------

// A new page, auto-stamped: today's date, the animal it is about (if any), "Observed".
export async function createPage({ cardId = null } = {}) {
  const at = nowIso();
  const page = {
    id: db.newId(), version: 1, w: PAGE_W, h: PAGE_H, paper: 'dots',
    header: { date: at, cardId }, links: [], items: [], createdAt: at,
  };
  await savePage(page);
  return page;
}

export async function loadPage(pageId) {
  const blob = await getFile(state.profile.id, `pages/${pageId}.json`);
  return blob ? JSON.parse(await blob.text()) : null;
}

export async function savePage(page) {
  const pid = state.profile.id;
  await putFile(pid, `pages/${page.id}.json`, new Blob([JSON.stringify(page)], { type: 'application/json' }));
  return writeIndex(page, state.notes.find(r => r.pageId === page.id));
}

// Kept as a deleted index record (for syncing later); the files stay until a clean-up.
export async function deletePage(pageId) {
  const rec = state.notes.find(r => r.pageId === pageId);
  if (!rec) return;
  await db.put('notes', { ...rec, deletedAt: nowIso(), updatedAt: nowIso() });
  state.notes = state.notes.filter(r => r.pageId !== pageId);
}

// ---------- photos ----------

const MAX_PHOTO = 2048;

// Shrink a picked image (camera or library) and keep it. Returns { id, w, h }.
export async function savePhoto(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_PHOTO / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  const id = db.newId();
  await putFile(state.profile.id, `photos/${id}.jpg`, blob);
  return { id, w, h };
}

export const loadPhotoBlob = id => getFile(state.profile.id, `photos/${id}.jpg`);
export const putPhotoBlob = (id, blob) => putFile(state.profile.id, `photos/${id}.jpg`, blob);
export const hasPhoto = async id => Boolean(await loadPhotoBlob(id));

// For export/import: raw page files.
export const putPageFile = (page) => putFile(state.profile.id, `pages/${page.id}.json`, new Blob([JSON.stringify(page)], { type: 'application/json' }));
export { writeIndex as indexPage };
