// Field Notes in and out: one page as a picture, a whole profile's notes as a zip backup
// (shared with the Web Share API where the device can, otherwise downloaded), restoring a
// backup (merged: pages already in the notebook are left alone), and, where the browser
// can pick a folder (Chrome, Edge, Android; not iPad Safari), "also save to a folder".
import { state } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { renderPage } from './notes-render.js';
import { makeZip, readZip } from './zip.js';

const FORMAT = 'wildlife-explorer-field-notes';
const today = () => new Date().toISOString().slice(0, 10);
const safeName = s => (s ?? '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'explorer';
const ID = /^[A-Za-z0-9-]{1,64}$/; // page and photo ids become file names

async function share(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

export async function exportPageImage(page, { assets, headerText }) {
  const k = 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * k;
  canvas.height = PAGE_H * k;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  renderPage(ctx, page, { assets, headerText });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return share(new File([blob], `field-notes-${today()}.png`, { type: 'image/png' }));
}

async function backupFile() {
  await notes.loadIndex();
  const files = [], pages = [], photos = new Set();
  for (const rec of state.notes) {
    const page = await notes.loadPage(rec.pageId);
    if (!page) continue;
    pages.push({ id: page.id, createdAt: rec.createdAt, cardIds: rec.cardIds });
    files.push({ name: `pages/${page.id}.json`, data: JSON.stringify(page) });
    for (const it of page.items) {
      if (it.t !== 'p' || photos.has(it.id)) continue;
      const blob = await notes.loadPhotoBlob(it.id);
      if (blob) { photos.add(it.id); files.push({ name: `photos/${it.id}.jpg`, data: blob }); }
    }
  }
  files.unshift({
    name: 'manifest.json',
    data: JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), profile: state.profile.name, pages }, null, 2),
  });
  return new File([await makeZip(files)], `field-notes-${safeName(state.profile.name)}-${today()}.zip`, { type: 'application/zip' });
}

export async function exportAll() { return share(await backupFile()); }

export const folderSupported = () => typeof window.showDirectoryPicker === 'function';

export async function saveToFolder() {
  const dir = await window.showDirectoryPicker({ id: 'field-notes', mode: 'readwrite' });
  const file = await backupFile();
  const w = await (await dir.getFileHandle(file.name, { create: true })).createWritable();
  await w.write(file);
  await w.close();
}

// A page from a backup, checked before it is kept: known item types only.
function cleanPage(page) {
  if (!page || !ID.test(page.id) || !Array.isArray(page.items)) return null;
  const items = page.items.filter(it => ['s', 'x', 'm', 'f', 'p'].includes(it?.t) && (it.t !== 'p' || ID.test(it.id)));
  return { ...page, items, links: Array.isArray(page.links) ? page.links : [] };
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
    const page = cleanPage(JSON.parse(text(`pages/${p.id}.json`) ?? 'null'));
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
