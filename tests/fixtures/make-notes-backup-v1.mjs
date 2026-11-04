// Makes tests/fixtures/notes-backup-v1.zip with the Field Notes export code as it was before
// animal tags (commit 142cd0a, manifest version 1), so tests/notes-backup.test.mjs restores a
// real old backup. Not part of npm test; run it again only to rebuild the fixture:
//   node tests/fixtures/make-notes-backup-v1.mjs
// It copies that commit's js/ into a temporary folder (git show) and runs it in Node with a
// fake IndexedDB: two pages linked to cards, one free page, one photo.
import 'fake-indexeddb/auto';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const OLD = '142cd0a';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const out = fileURLToPath(new URL('./notes-backup-v1.zip', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'notes-v1-'));
try {
  const git = cmd => execSync(`git ${cmd}`, { cwd: repo, maxBuffer: 64 << 20 });
  for (const path of git(`ls-tree -r --name-only ${OLD} js`).toString().split('\n').filter(Boolean)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), git(`show ${OLD}:${path}`));
  }
  const load = path => import(pathToFileURL(join(dir, 'js', path)).href);
  const store = await load('store.js');
  const notes = await load('notes-store.js');
  const io = await load('notes-io.js');
  store.state.profile = { id: 'kid-v1', name: 'Kid' };
  await notes.loadIndex();

  // Two pages linked to cards (one through its header, links and a stamp), one free page.
  const bear = await notes.createPage({ cardId: 'formosan-black-bear' });
  bear.items.push({ t: 's', c: '#3b2a1a', w: 5, p: [100, 300, 0.5, 400, 320, 0.6, 700, 360, 0.5] });
  await notes.savePage(bear);

  const PHOTO = 'photo-0001';
  await notes.putPhotoBlob(PHOTO, new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])], { type: 'image/jpeg' }));
  const magpie = await notes.createPage({ cardId: 'taiwan-blue-magpie' });
  magpie.links = ['formosan-rock-macaque'];
  magpie.items.push({ t: 'p', id: PHOTO, x: 500, y: 700, w: 400, h: 300, r: 0.05 });
  magpie.items.push({ t: 'm', c: '#3b2a1a', card: 'sika-deer', x: 300, y: 1100, s: 180, r: 0 });
  await notes.savePage(magpie);

  const free = await notes.createPage({ cardId: null });
  free.items.push({ t: 'x', c: '#3b2a1a', s: 40, x: 120, y: 400, v: 'Rain today' });
  await notes.savePage(free);

  // The export hands its zip to the Web Share API: catch it there.
  let zip = null;
  globalThis.navigator.canShare = () => true;
  globalThis.navigator.share = async ({ files }) => { zip = files[0]; };
  await io.exportAll();
  writeFileSync(out, Buffer.from(await zip.arrayBuffer()));
  console.log(`wrote ${out} (${zip.size} bytes)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
