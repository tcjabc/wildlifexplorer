// Field Notes in and out: one page as a picture, a whole profile's notes as a zip backup
// (shared with the Web Share API where the device can, otherwise downloaded), restoring a
// backup (merged: pages already in the notebook are left alone), and, where the browser
// can pick a folder (Chrome, Edge, Android; not iPad Safari), "also save to a folder".
// Manifest version 2 lists each page's animal tags; version 1 backups (from before tags)
// still restore, their pages tagged with what they were linked to (js/notes-model.js).
import { state } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { renderPage } from './notes-render.js';
import { normalisePage } from './notes-model.js';
import { makeZip, readZip } from './zip.js';
import { shareFile } from './dom.js';

const FORMAT = 'wildlife-explorer-field-notes';
const today = () => new Date().toISOString().slice(0, 10);
const safeName = s => (s ?? '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'explorer';
const ID = /^[A-Za-z0-9-]{1,64}$/; // page and photo ids become file names

export async function exportPageImage(page, { assets, headerText, backdrop }) {
  const k = 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * k;
  canvas.height = PAGE_H * k;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  renderPage(ctx, page, { assets, headerText, backdrop });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return shareFile(new File([blob], `field-notes-${today()}.png`, { type: 'image/png' }));
}

async function backupFile() {
  await notes.loadIndex();
  const files = [], pages = [], photos = new Set();
  for (const rec of state.notes) {
    const page = await notes.loadPage(rec.pageId);
    if (!page) continue;
    pages.push({ id: page.id, createdAt: rec.createdAt, editedAt: rec.editedAt, tags: rec.tags });
    files.push({ name: `pages/${page.id}.json`, data: JSON.stringify(page) });
    for (const it of page.items) {
      if (it.t !== 'p' || photos.has(it.id)) continue;
      const blob = await notes.loadPhotoBlob(it.id);
      if (blob) { photos.add(it.id); files.push({ name: `photos/${it.id}.jpg`, data: blob }); }
    }
  }
  files.unshift({
    name: 'manifest.json',
    data: JSON.stringify({ format: FORMAT, version: 2, exportedAt: new Date().toISOString(), profile: state.profile.name, pages }, null, 2),
  });
  return new File([await makeZip(files)], `field-notes-${safeName(state.profile.name)}-${today()}.zip`, { type: 'application/zip' });
}

export async function exportAll() { return shareFile(await backupFile()); }

export const folderSupported = () => typeof window.showDirectoryPicker === 'function';

export async function saveToFolder() {
  const dir = await window.showDirectoryPicker({ id: 'field-notes', mode: 'readwrite' });
  const file = await backupFile();
  const w = await (await dir.getFileHandle(file.name, { create: true })).createWritable();
  await w.write(file);
  await w.close();
}

// A page from a backup, checked before it is kept: known item types only, and tags (from the
// page, the manifest, or for a version 1 backup what the page was linked to).
const strings = v => (Array.isArray(v) ? v.filter(s => typeof s === 'string' && s.length <= 64) : undefined);
export function cleanPage(page, entry = {}) {
  if (!page || !ID.test(page.id) || !Array.isArray(page.items)) return null;
  const items = page.items.filter(it => ['s', 'x', 'm', 'f', 'p', 'w', 'k'].includes(it?.t) && (!['p', 'k'].includes(it.t) || ID.test(it.id)));
  const links = strings(page.links) ?? [];
  return normalisePage({ ...page, items, links, tags: strings(page.tags) },
    { tags: strings(entry.tags), cardIds: strings(entry.cardIds), editedAt: entry.editedAt });
}

// Returns how many pages were added.
export async function importBackup(file) {
  const files = await readZip(file);
  const text = name => (files.get(name) ? new TextDecoder().decode(files.get(name)) : null);
  const manifest = JSON.parse(text('manifest.json') ?? 'null');
  if (manifest?.format !== FORMAT || !Array.isArray(manifest.pages)) throw new Error('Not a Field Notes backup.');
  await notes.loadIndex();
  const have = new Set(state.notes.map(r => r.pageId));
  let added = 0;
  for (const p of manifest.pages) {
    if (!ID.test(p?.id ?? '') || have.has(p.id)) continue; // merge: pages already here stay as they are
    const page = cleanPage(JSON.parse(text(`pages/${p.id}.json`) ?? 'null'), p);
    if (!page) continue;
    for (const it of page.items) {
      if (it.t !== 'p' || await notes.hasPhoto(it.id)) continue;
      const raw = files.get(`photos/${it.id}.jpg`);
      if (raw) await notes.putPhotoBlob(it.id, new Blob([raw], { type: 'image/jpeg' }));
    }
    await notes.putPageFile(page);
    await notes.indexPage({ ...page, createdAt: p.createdAt ?? page.createdAt }, null);
    added++;
  }
  return added;
}
