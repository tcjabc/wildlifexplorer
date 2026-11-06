// Field Notes storage, per profile.
//   OPFS (the browser's private file system): notes/<profile>/pages/<page>.json and
//   notes/<profile>/photos/<photo>.jpg. Where OPFS can't write files (older Safari, some
//   private modes) the same files go into IndexedDB ("notefiles") instead.
//   IndexedDB "notes": one small index record per page (its animal tags, timestamps), so the
//   binder, a card's notebook and the contents never open every page. Device-only: "notes"
//   and "notefiles" are not in db.js SYNCED, so nothing here ever reaches the outbox.
// Index records: { id, profileId, pageId, tags, createdAt, editedAt, updatedAt, deletedAt }.
// editedAt changes when the page's content or tags change; updatedAt whenever it is written.
// Pages and records from before tags are migrated as they load (js/notes-model.js).
import * as db from './db.js';
import { state } from './store.js';
import { normalisePage, migrateRecord, pagesOf, PAGE_VERSION, PAGE_W, PAGE_H } from './notes-model.js';

const nowIso = () => new Date().toISOString();
export { PAGE_W, PAGE_H };

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

// Every Field Notes file of these explorers in OPFS, when the family is removed from this
// device (cloud/sync.js removeFamily, which removes their "notefiles" and index records).
export async function removeFiles(pids) {
  const root = await opfsRoot();
  if (!root) return;
  for (const pid of pids) {
    try {
      await (await root.getDirectoryHandle('notes')).removeEntry(pid, { recursive: true });
    } catch { /* no files */ }
  }
}

// ---------- the index ----------

// The active profile's pages, oldest first. Records from before tags get theirs here (what
// the page was linked to: its header card, cards it was drawn next to, stamped animals) and
// are written back once; a migrated record is left alone, so an interrupted pass just
// carries on next time.
export async function loadIndex() {
  const pid = state.profile?.id;
  if (!pid) { state.notes = []; return []; }
  const recs = await db.all('notes', pid);
  for (let i = 0; i < recs.length; i++) {
    const next = migrateRecord(recs[i]);
    if (next) { await db.put('notes', next); recs[i] = next; }
  }
  state.notes = recs.filter(r => !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return state.notes;
}

export const pagesFor = cardId => pagesOf(state.notes, cardId);
export const notesCount = cardId => pagesFor(cardId).length;

async function writeIndex(page, existing) {
  const pid = state.profile.id;
  const at = nowIso();
  const rec = {
    id: `${pid}:${page.id}`, profileId: pid, pageId: page.id, tags: [...(page.tags ?? [])],
    createdAt: existing?.createdAt ?? page.createdAt ?? at, editedAt: page.editedAt ?? existing?.editedAt ?? at,
    updatedAt: at, deletedAt: null,
  };
  await db.put('notes', rec);
  state.notes = [...state.notes.filter(r => r.pageId !== page.id), rec].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return rec;
}

// ---------- pages ----------

// A new page, not saved yet: today's date, its animal tags (none: a free page), "Observed".
export function blankPage({ tags = [] } = {}) {
  const at = nowIso();
  return {
    id: db.newId(), version: PAGE_VERSION, w: PAGE_W, h: PAGE_H, paper: 'dots',
    header: { date: at }, tags: [...tags], items: [], createdAt: at, editedAt: at,
  };
}

// A new page, saved.
export async function createPage({ tags = [] } = {}) {
  const page = blankPage({ tags });
  await savePage(page);
  return page;
}

export async function loadPage(pageId) {
  const blob = await getFile(state.profile.id, `pages/${pageId}.json`);
  return blob ? normalisePage(JSON.parse(await blob.text()), state.notes.find(r => r.pageId === pageId)) : null;
}

// edited: the content or tags changed (the default), so editedAt moves on.
export async function savePage(page, { edited = true } = {}) {
  const pid = state.profile.id;
  if (edited) page.editedAt = nowIso();
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

const MAX_PHOTO = 1280; // a page shows a photo at half that; the baseline tablet decodes every one

// A picked image (camera or library) made small enough to keep: { blob, w, h }.
export async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_PHOTO / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
  return { blob, w, h };
}

// Returns { id, w, h }.
export async function keepPhoto({ blob, w, h }) {
  const id = db.newId();
  await putFile(state.profile.id, `photos/${id}.jpg`, blob);
  return { id, w, h };
}

export const savePhoto = async file => keepPhoto(await shrinkPhoto(file));

export const loadPhotoBlob = id => getFile(state.profile.id, `photos/${id}.jpg`);
export const putPhotoBlob = (id, blob) => putFile(state.profile.id, `photos/${id}.jpg`, blob);
export const hasPhoto = async id => Boolean(await loadPhotoBlob(id));

// For export/import: raw page files.
export const putPageFile = (page) => putFile(state.profile.id, `pages/${page.id}.json`, new Blob([JSON.stringify(page)], { type: 'application/json' }));
export { writeIndex as indexPage };
