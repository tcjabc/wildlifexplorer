// Field Notes: a researcher's notebook. Kraft cover, dotted (or grid) paper, one page at a
// time; swipe to turn pages. Tools: pencil (pressure), eraser (whole marks), coloured
// pencils, text, creature stamps, footprint roller, taped-in photos (move / resize / turn),
// undo and redo.
//
// Pen and fingers: in "finger" mode fingers draw; in "pen" mode only a pen (or mouse) draws
// and fingers turn pages. The first time a pen draws, the notebook switches to pen mode
// (palm rejection); the toggle in the toolbar switches back at any time. Remembered per
// profile. While a pen is touching the page, other touches never draw.
//
// notebook({ cardId, beside, onMaximise, onClose }):
//   cardId: show only that animal's pages (with "All pages" one tap away)
//   beside: the notebook is open next to that card, so pages drawn on link to it
import { h, mount, reducedMotion } from './dom.js';
import { bi, t, tx, label, plain, getMode, dateText } from './i18n.js';
import { state, updateProfile, isCollected, groupById } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { renderPage, renderItem, drawStroke, hitItem, boundsOf, PENCILS, pencilColour } from './notes-render.js';
import { exportPageImage, exportAll, importBackup, saveToFolder, folderSupported } from './notes-io.js';
import { haptic, clamp } from './gesture.js';

const TOOLS = [
  ['pencil', '✏️'], ['eraser', '🧽'], ['text', '🔤'], ['stamp', '🐾'], ['roller', '👣'], ['move', '✋'],
];
const FEET = [['paw', '🐈'], ['hoof', '🦌'], ['bird', '🐦'], ['bear', '🐻']];
const SIZES = { thin: 5, thick: 12 };
const TEXT_SIZE = 40;
const STAMP_SIZE = 180;
const ERASE_R = 14;

// The card's name and dates in the profile's language, for text drawn on the canvas.
const inLang = pair => {
  if (!pair) return '';
  const m = getMode();
  return m === 'en' ? pair.en || pair.zh : m === 'zh' ? pair.zh || pair.en : [pair.en, pair.zh].filter(Boolean).join('  ');
};

export function notebook({ cardId = null, beside = false, onMaximise = null, onClose = null } = {}) {
  const nb = {
    filter: cardId, showAll: !cardId, ids: [], pos: 0, page: null,
    tool: 'pencil', colour: 'graphite', size: 'thin', foot: 'paw', stampCard: null,
    undo: [], redo: [], selected: -1, saveTimer: 0,
    assets: { photos: new Map(), stamps: new Map() },
  };
  const input = () => state.profile.notesInput ?? 'finger';

  // ---------- DOM ----------
  const base = h('canvas', { class: 'nb__base' });
  const live = h('canvas', { class: 'nb__live' });
  const overlay = h('div', { class: 'nb__overlay' });
  const sheet = h('div', { class: 'nb__sheet' }, base, live, overlay);
  const emptyText = h('p');
  const empty = h('div', { class: 'nb__empty', hidden: true },
    emptyText,
    h('button', { class: 'btn btn--accent btn--big', type: 'button', onclick: () => newPage() }, h('span', { 'aria-hidden': 'true' }, '＋ '), tx('notes.newPage')));
  const desk = h('div', { class: 'nb__desk' }, sheet, empty);
  const counter = h('span', { class: 'nb__count' });
  const filterChip = h('button', { class: 'nb__filter', type: 'button', onclick: () => toggleFilter() });
  const prev = h('button', { class: 'btn btn--icon nb__nav', type: 'button', 'aria-label': label('notes.prev'), onclick: () => turn(-1) }, '‹');
  const next = h('button', { class: 'btn btn--icon nb__nav', type: 'button', 'aria-label': label('notes.next'), onclick: () => turn(1) }, '›');
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => addPhoto(e.target.files?.[0]) });
  const importInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: e => doImport(e.target.files?.[0]) });
  const menuSheet = h('dialog', { class: 'sheet nb-menu' });
  const pickSheet = h('dialog', { class: 'sheet nb-pick' });
  [menuSheet, pickSheet].forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.addEventListener('keydown', e => e.stopPropagation());
  });

  const bar = h('header', { class: 'nb__bar' },
    h('h2', { class: 'nb__title' }, h('span', { 'aria-hidden': 'true' }, '📓 '), tx('notes.title')),
    filterChip,
    h('span', { class: 'spacer' }),
    prev, counter, next,
    h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('notes.newPage'), onclick: () => newPage() }, '＋'),
    h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('notes.menu'), onclick: () => openMenu() }, '⋯'),
    onMaximise && h('button', { class: 'btn btn--icon nb__max', type: 'button', 'aria-label': label('notes.maximise'), onclick: () => onMaximise('toggle') }, '⤢'),
    onClose && h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('notes.close'), onclick: () => onClose() }, '✕'));
  // Double-tap the bar to fill the screen (or come back).
  bar.addEventListener('dblclick', e => { if (onMaximise && !e.target.closest('button')) onMaximise('toggle'); });

  const toolBtns = TOOLS.map(([id, icon]) => h('button', {
    type: 'button', class: 'nb-tool', 'data-tool': id, 'aria-pressed': 'false', 'aria-label': label(`notes.tool.${id}`),
    onclick: () => setTool(id),
  }, h('span', { 'aria-hidden': 'true' }, icon)));
  const photoBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.tool.photo'), onclick: () => fileInput.click() }, h('span', { 'aria-hidden': 'true' }, '📷'));
  const colourBtns = PENCILS.map(id => h('button', {
    type: 'button', class: 'nb-colour', 'data-colour': id, 'aria-pressed': 'false', 'aria-label': label(`notes.colour.${id}`),
    onclick: () => { nb.colour = id; drawTools(); },
  }));
  const sizeBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.size'), onclick: () => { nb.size = nb.size === 'thin' ? 'thick' : 'thin'; drawTools(); } });
  const footBtns = FEET.map(([id, icon]) => h('button', {
    type: 'button', class: 'nb-tool nb-tool--small', 'data-foot': id, 'aria-pressed': 'false', 'aria-label': label(`notes.foot.${id}`),
    onclick: () => { nb.foot = id; drawTools(); },
  }, h('span', { 'aria-hidden': 'true' }, icon)));
  const undoBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.undo'), onclick: () => undo() }, h('span', { 'aria-hidden': 'true' }, '↶'));
  const redoBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.redo'), onclick: () => redo() }, h('span', { 'aria-hidden': 'true' }, '↷'));
  const inputBtn = h('button', { type: 'button', class: 'nb-input', onclick: () => setInput(input() === 'pen' ? 'finger' : 'pen') });
  const tools = h('div', { class: 'nb__tools', role: 'toolbar', 'aria-label': label('notes.tools') },
    toolBtns, photoBtn, h('span', { class: 'nb__sep' }), colourBtns, sizeBtn,
    h('span', { class: 'nb__feet' }, footBtns), h('span', { class: 'nb__sep' }), undoBtn, redoBtn, h('span', { class: 'spacer' }), inputBtn);

  const el = h('section', { class: 'nb', 'aria-label': label('notes.title') }, bar, tools, desk, fileInput, importInput, menuSheet, pickSheet);

  // ---------- drawing the page ----------
  let scale = 1, dpr = 1;
  function fit() {
    const r = desk.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 16;
    const k = Math.min((r.width - pad * 2) / PAGE_W, (r.height - pad * 2) / PAGE_H);
    const w = Math.max(10, Math.floor(PAGE_W * k)), hgt = Math.max(10, Math.floor(PAGE_H * k));
    sheet.style.setProperty('width', `${w}px`);
    sheet.style.setProperty('height', `${hgt}px`);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = w / PAGE_W;
    for (const c of [base, live]) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    redraw();
  }
  const ctxOf = c => { const x = c.getContext('2d'); x.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); return x; };
  function headerText(page) {
    const card = state.byId.get(page.header.cardId);
    return { date: inLang(dateText(page.header.date, { year: 'numeric', month: 'long', day: 'numeric' })), name: inLang(card?.name), stamp: inLang(t('notes.observed')) };
  }
  function redraw() {
    if (!nb.page) return;
    const c = ctxOf(base);
    c.clearRect(0, 0, PAGE_W, PAGE_H);
    renderPage(c, nb.page, { assets: nb.assets, headerText: headerText(nb.page), skip: drag?.index ?? -1 });
    clearLive();
    if (drag) renderItem(ctxOf(live), nb.page.items[drag.index], nb.assets);
    drawSelection();
  }
  function clearLive() { const c = live.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, live.width, live.height); }

  // Photos and stamp pictures load on demand; the page redraws when they arrive.
  async function loadAssets(page) {
    for (const it of page.items) {
      if (it.t === 'p' && !nb.assets.photos.has(it.id)) {
        nb.assets.photos.set(it.id, null);
        notes.loadPhotoBlob(it.id).then(b => b && createImageBitmap(b)).then(bmp => { if (bmp) { nb.assets.photos.set(it.id, bmp); redraw(); } }).catch(() => {});
      }
      if (it.t === 'm') stampAsset(it.card);
    }
  }
  function stampAsset(id) {
    if (nb.assets.stamps.has(id)) return nb.assets.stamps.get(id);
    const card = state.byId.get(id);
    const a = { emoji: groupById(card?.group)?.emoji ?? '🐾', img: null };
    if (card?.silhouette?.file) { a.img = new Image(); a.img.onload = () => redraw(); a.img.src = card.silhouette.file; }
    nb.assets.stamps.set(id, a);
    return a;
  }

  // ---------- pages ----------
  function listIds() {
    const recs = nb.showAll || !nb.filter ? state.notes : notes.pagesFor(nb.filter);
    return recs.map(r => r.pageId);
  }
  async function show(pos, dir = 0) {
    await flushSave();
    nb.ids = listIds();
    empty.hidden = nb.ids.length > 0;
    sheet.hidden = !nb.ids.length;
    if (!nb.ids.length) {
      const card = !nb.showAll && state.byId.get(nb.filter);
      mount(emptyText, card ? tx('notes.emptyCard', { name: card.name }) : tx('notes.empty'));
      nb.page = null; drawBar(); return;
    }
    nb.pos = Math.max(0, Math.min(pos, nb.ids.length - 1));
    const id = nb.ids[nb.pos];
    nb.page = await notes.loadPage(id);
    if (!nb.page) {
      // The file is missing (e.g. storage was cleared): show a blank page in its place.
      const rec = state.notes.find(r => r.pageId === id);
      nb.page = { id, version: 1, w: PAGE_W, h: PAGE_H, paper: 'dots', header: { date: rec?.createdAt ?? new Date().toISOString(), cardId: rec?.cardIds[0] ?? null }, links: [], items: [], createdAt: rec?.createdAt };
    }
    nb.undo = []; nb.redo = []; nb.selected = -1;
    loadAssets(nb.page);
    drawBar();
    redraw();
    if (dir && !reducedMotion()) {
      sheet.animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  }
  const turn = d => { if (nb.pos + d >= 0 && nb.pos + d < nb.ids.length) { haptic(8); show(nb.pos + d, d); } };
  async function newPage() {
    const page = await notes.createPage({ cardId: nb.filter });
    nb.ids = listIds();
    await show(nb.ids.indexOf(page.id), 1);
  }
  function toggleFilter() { nb.showAll = !nb.showAll; show(nb.showAll ? Math.max(0, state.notes.findIndex(r => r.pageId === nb.page?.id)) : 0); }

  function drawBar() {
    counter.textContent = nb.ids.length ? `${nb.pos + 1} / ${nb.ids.length}` : '';
    prev.disabled = nb.pos <= 0;
    next.disabled = nb.pos >= nb.ids.length - 1;
    const card = state.byId.get(nb.filter);
    filterChip.hidden = !card;
    if (card) mount(filterChip, nb.showAll ? tx('notes.onlyCard', { name: card.name }) : tx('notes.allPages'));
  }
  function drawTools() {
    toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === nb.tool)));
    colourBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.colour === nb.colour)));
    footBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.foot === nb.foot)));
    el.dataset.tool = nb.tool;
    mount(sizeBtn, h('span', { class: ['nb-size', `nb-size--${nb.size}`], 'aria-hidden': 'true' }));
    undoBtn.disabled = !nb.undo.length;
    redoBtn.disabled = !nb.redo.length;
    const pen = input() === 'pen';
    inputBtn.setAttribute('aria-pressed', String(pen));
    mount(inputBtn, h('span', { 'aria-hidden': 'true' }, pen ? '🖊️ ' : '☝️ '), tx(pen ? 'notes.penOnly' : 'notes.finger'));
    inputBtn.setAttribute('aria-label', label(pen ? 'notes.penOnlyHint' : 'notes.fingerHint'));
  }
  function setTool(id) {
    nb.tool = id;
    if (id !== 'move') { nb.selected = -1; drawSelection(); }
    if (id === 'stamp' && !nb.stampCard) openStampPicker();
    drawTools();
  }
  async function setInput(mode) {
    await updateProfile(state.profile.id, { notesInput: mode });
    drawTools();
  }

  // ---------- history ----------
  // Ops: add { index, item }, remove { entries: [{ index, item }] }, change { index, before, after }.
  function apply(op, back) {
    const items = nb.page.items;
    if (op.kind === 'add') { if (back) items.splice(op.index, 1); else items.splice(op.index, 0, op.item); }
    else if (op.kind === 'remove') {
      if (back) [...op.entries].sort((a, b) => a.index - b.index).forEach(e => items.splice(e.index, 0, e.item));
      else [...op.entries].sort((a, b) => b.index - a.index).forEach(e => items.splice(e.index, 1));
    } else if (op.kind === 'change') items[op.index] = structuredClone(back ? op.before : op.after);
  }
  function commit(op) {
    apply(op, false);
    nb.undo.push(op);
    nb.redo = [];
    touched();
  }
  function undo() { const op = nb.undo.pop(); if (!op) return; apply(op, true); nb.redo.push(op); touched(); }
  function redo() { const op = nb.redo.pop(); if (!op) return; apply(op, false); nb.undo.push(op); touched(); }
  // After any change: link the page to the card it is open next to, redraw, save soon.
  function touched() {
    if (beside && cardId && !(nb.page.links ?? []).includes(cardId) && nb.page.header.cardId !== cardId) {
      nb.page.links = [...(nb.page.links ?? []), cardId];
    }
    if (nb.selected >= nb.page.items.length) nb.selected = -1;
    nb.dirty = true;
    redraw();
    drawTools();
    clearTimeout(nb.saveTimer);
    nb.saveTimer = setTimeout(() => flushSave(), 400);
  }
  async function flushSave() {
    clearTimeout(nb.saveTimer);
    nb.saveTimer = 0;
    if (nb.page && nb.dirty) {
      nb.dirty = false;
      await notes.savePage(nb.page);
    }
  }

  // ---------- pointers ----------
  const toPage = e => { const r = sheet.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * PAGE_W, ((e.clientY - r.top) / r.height) * PAGE_H]; };
  const pressureOf = e => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  let stroke = null;   // the pencil line or footprint trail being drawn
  let erasing = null;  // { entries } removed so far
  let drag = null;     // moving an item: { index, before, start, from, mode }
  let swipe = null;    // a finger turning the page: { id, x, y }
  const touches = new Map();
  let penDown = false;
  let pinch = null;

  // Should this pointer draw? Pens and mice always; fingers only in finger mode, never while
  // a pen is on the page, and never a large contact (a palm).
  function draws(e) {
    if (e.pointerType !== 'touch') return true;
    if (penDown || input() === 'pen') return false;
    return !(e.width > 60 || e.height > 60);
  }

  async function firstPen() {
    if (state.profile.notesPenSeen) return;
    await updateProfile(state.profile.id, { notesPenSeen: true, notesInput: 'pen' });
    drawTools();
    toast(tx('notes.penFound'));
  }

  function down(e) {
    if (!nb.page) return;
    if (e.pointerType === 'pen') { penDown = true; firstPen(); }
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) { startPinch(); cancelStroke(); return; }
    }
    if (!draws(e)) { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    try { live.setPointerCapture(e.pointerId); } catch { /* gone */ }
    const [x, y] = toPage(e);
    if (nb.tool === 'pencil') {
      stroke = { id: e.pointerId, item: { t: 's', c: pencilColour(nb.colour), w: SIZES[nb.size], p: [x, y, pressureOf(e)] } };
      const c = ctxOf(live); drawStroke(c, stroke.item);
    } else if (nb.tool === 'roller') {
      stroke = { id: e.pointerId, item: { t: 'f', c: pencilColour(nb.colour), k: nb.foot, p: [x, y] } };
    } else if (nb.tool === 'eraser') {
      erasing = { id: e.pointerId, entries: [] };
      eraseAt(x, y);
    } else if (nb.tool === 'move') {
      const i = hitItem(ctxOf(base), nb.page, x, y, 10, { movable: true });
      // A finger that misses may be the first half of a pinch: deselect only when it lifts.
      if (i < 0 && e.pointerType === 'touch' && nb.selected >= 0) { stroke = { id: e.pointerId, deselect: true }; return; }
      nb.selected = i;
      if (i >= 0) drag = { id: e.pointerId, index: i, before: structuredClone(nb.page.items[i]), from: [x, y], mode: 'move' };
      redraw();
    } else if (nb.tool === 'text' || nb.tool === 'stamp') {
      stroke = { id: e.pointerId, tap: [x, y] };
    }
  }

  function move(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { movePinch(); return; }
    if (swipe?.id === e.pointerId) return;
    const events = e.getCoalescedEvents?.() ?? [e];
    if (stroke?.id === e.pointerId && stroke.item?.t === 's') {
      const from = stroke.item.p.length;
      for (const ev of events.length ? events : [e]) { const [x, y] = toPage(ev); stroke.item.p.push(x, y, pressureOf(ev)); }
      drawStroke(ctxOf(live), stroke.item, from);
    } else if (stroke?.id === e.pointerId && stroke.item?.t === 'f') {
      const [x, y] = toPage(e);
      const p = stroke.item.p;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > 6) {
        p.push(x, y);
        clearLive(); renderItem(ctxOf(live), stroke.item, nb.assets);
      }
    } else if (erasing?.id === e.pointerId) {
      for (const ev of events.length ? events : [e]) { const [x, y] = toPage(ev); eraseAt(x, y); }
    } else if (drag?.id === e.pointerId) {
      const [x, y] = toPage(e);
      transformDrag(x, y);
    }
  }

  function up(e) {
    touches.delete(e.pointerId);
    if (e.pointerType === 'pen') penDown = false;
    if (pinch) { if (touches.size < 2) endPinch(); return; }
    if (swipe?.id === e.pointerId) {
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) turn(dx < 0 ? 1 : -1);
      return;
    }
    if (stroke?.id === e.pointerId) {
      const s = stroke; stroke = null;
      clearLive();
      if (s.item?.t === 's' || (s.item?.t === 'f' && s.item.p.length >= 4)) commit({ kind: 'add', index: nb.page.items.length, item: s.item });
      else if (s.tap && nb.tool === 'text') editText(...s.tap);
      else if (s.tap && nb.tool === 'stamp') placeStamp(...s.tap);
      else if (s.deselect) { nb.selected = -1; redraw(); }
      return;
    }
    if (erasing?.id === e.pointerId) {
      const entries = erasing.entries; erasing = null;
      // The marks are already gone from the page; record them so undo brings them back.
      if (entries.length) { nb.undo.push({ kind: 'remove', entries }); nb.redo = []; touched(); }
      return;
    }
    if (drag?.id === e.pointerId) endDrag();
  }

  function cancelStroke() {
    if (stroke) { stroke = null; clearLive(); }
    swipe = null;
  }

  // Whole marks: anything the eraser touches goes, in one undo step per rub.
  function eraseAt(x, y) {
    const i = hitItem(ctxOf(base), nb.page, x, y, ERASE_R);
    if (i < 0) return;
    // Its index in the page as it was before this rub started, for undo.
    const item = nb.page.items[i];
    let orig = i;
    for (const en of [...erasing.entries].sort((a, b) => a.index - b.index)) if (en.index <= orig) orig++;
    erasing.entries.push({ index: orig, item });
    nb.page.items.splice(i, 1);
    haptic(4);
    redraw();
  }

  // ---------- pinch: fill the screen / come back; or resize & turn a selected item ----------
  const pts = () => [...touches.values()];
  const dist = () => { const [a, b] = pts(); return Math.hypot(a.x - b.x, a.y - b.y); };
  const angle = () => { const [a, b] = pts(); return Math.atan2(b.y - a.y, b.x - a.x); };
  function startPinch() {
    if (nb.tool === 'move' && nb.selected >= 0) {
      const it = nb.page.items[nb.selected];
      pinch = { item: true, d0: dist(), a0: angle(), before: structuredClone(it) };
    } else pinch = { d0: dist() };
  }
  function movePinch() {
    if (touches.size < 2) return;
    if (pinch.item) {
      const it = nb.page.items[nb.selected], b = pinch.before;
      const k = Math.max(0.2, Math.min(5, dist() / pinch.d0));
      resizeItem(it, b, k);
      if (it.t !== 'x') it.r = (b.r ?? 0) + angle() - pinch.a0;
      redraw();
    } else pinch.k = dist() / pinch.d0;
  }
  function endPinch() {
    const p = pinch; pinch = null;
    if (p.item) {
      const after = structuredClone(nb.page.items[nb.selected]);
      nb.page.items[nb.selected] = p.before;
      commit({ kind: 'change', index: nb.selected, before: p.before, after });
    } else if (onMaximise && p.k) {
      if (p.k > 1.3) onMaximise('max');
      else if (p.k < 0.75) onMaximise('restore');
    }
  }

  // ---------- move / resize / turn ----------
  // Kept between a small chip and the width of the page, so nothing gets lost off the paper.
  function resizeItem(it, b, k) {
    if (it.t === 'p') {
      const long = Math.max(b.w, b.h);
      const kk = clamp(k, 80 / long, PAGE_W / long);
      it.w = b.w * kk; it.h = b.h * kk;
    } else it.s = clamp(b.s * k, 16, it.t === 'm' ? 480 : 160);
  }
  function transformDrag(x, y) {
    const it = nb.page.items[drag.index], b = drag.before;
    if (drag.mode === 'move') { it.x = b.x + x - drag.from[0]; it.y = b.y + y - drag.from[1]; }
    else {
      const box = boundsOf(ctxOf(base), b);
      if (drag.mode === 'resize') {
        const k = Math.hypot(x - box.cx, y - box.cy) / Math.max(1, Math.hypot(drag.from[0] - box.cx, drag.from[1] - box.cy));
        resizeItem(it, b, Math.max(0.2, Math.min(5, k)));
      } else if (drag.mode === 'rotate') {
        it.r = (b.r ?? 0) + Math.atan2(y - box.cy, x - box.cx) - Math.atan2(drag.from[1] - box.cy, drag.from[0] - box.cx);
      }
    }
    clearLive(); renderItem(ctxOf(live), it, nb.assets); drawSelection();
  }
  function endDrag() {
    const d = drag; drag = null;
    const after = structuredClone(nb.page.items[d.index]);
    if (JSON.stringify(after) === JSON.stringify(d.before)) { redraw(); return; }
    nb.page.items[d.index] = d.before;
    commit({ kind: 'change', index: d.index, before: d.before, after });
  }
  // The selection box, with a handle to resize, one to turn and a delete button.
  function drawSelection() {
    overlay.replaceChildren();
    if (nb.tool !== 'move' || nb.selected < 0 || !nb.page?.items[nb.selected]) return;
    const b = boundsOf(ctxOf(base), nb.page.items[nb.selected]);
    const box = h('div', { class: 'nb-sel' });
    box.style.setProperty('left', `${(b.cx - b.w / 2) * scale}px`);
    box.style.setProperty('top', `${(b.cy - b.h / 2) * scale}px`);
    box.style.setProperty('width', `${b.w * scale}px`);
    box.style.setProperty('height', `${b.h * scale}px`);
    box.style.setProperty('transform', `rotate(${b.r}rad)`);
    const handle = (mode, cls, glyph, key) => {
      const el2 = h('button', { type: 'button', class: ['nb-sel__h', cls], 'aria-label': label(key) }, glyph);
      el2.addEventListener('pointerdown', e => {
        e.stopPropagation();
        try { el2.setPointerCapture(e.pointerId); } catch { /* gone */ }
        drag = { id: e.pointerId, index: nb.selected, before: structuredClone(nb.page.items[nb.selected]), from: toPage(e), mode };
        redraw();
      });
      el2.addEventListener('pointermove', e => { if (drag?.id === e.pointerId) transformDrag(...toPage(e)); });
      el2.addEventListener('pointerup', e => { if (drag?.id === e.pointerId) endDrag(); });
      return el2;
    };
    const del = h('button', {
      type: 'button', class: 'nb-sel__h nb-sel__del', 'aria-label': label('notes.delete'),
      onclick: () => { const i = nb.selected; nb.selected = -1; commit({ kind: 'remove', entries: [{ index: i, item: nb.page.items[i] }] }); },
    }, '✕');
    box.append(handle('resize', 'nb-sel__resize', '⤡', 'notes.resize'), handle('rotate', 'nb-sel__rotate', '⟳', 'notes.rotate'), del);
    overlay.append(box);
  }

  // ---------- text ----------
  function editText(x, y) {
    const c = ctxOf(base);
    const hit = hitItem(c, nb.page, x, y, 6, { movable: true });
    const existing = hit >= 0 && nb.page.items[hit].t === 'x' ? hit : -1;
    const item = existing >= 0 ? nb.page.items[existing] : { t: 'x', c: pencilColour(nb.colour), s: TEXT_SIZE, x, y, v: '' };
    const area = h('textarea', { class: 'nb-text', 'aria-label': label('notes.tool.text'), rows: 2 });
    area.value = item.v;
    area.style.setProperty('left', `${item.x * scale}px`);
    area.style.setProperty('top', `${item.y * scale}px`);
    area.style.setProperty('font-size', `${item.s * scale}px`);
    area.style.setProperty('color', item.c);
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      const v = area.value.replace(/\s+$/, '');
      area.remove();
      if (!keep) return;
      if (existing >= 0) {
        if (!v) commit({ kind: 'remove', entries: [{ index: existing, item }] });
        else if (v !== item.v) commit({ kind: 'change', index: existing, before: item, after: { ...item, v } });
      } else if (v) commit({ kind: 'add', index: nb.page.items.length, item: { ...item, v } });
    };
    area.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    });
    area.addEventListener('blur', () => finish(true));
    overlay.append(area);
    area.focus();
  }

  // ---------- stamps ----------
  function openStampPicker() {
    const cards = state.cards.filter(isCollected);
    mount(pickSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '🐾'), tx('notes.pickStamp')),
      cards.length
        ? h('div', { class: 'nb-pick__grid' }, cards.map(card => h('button', {
          type: 'button', class: 'nb-pick__item', 'data-group': card.group,
          onclick: () => { nb.stampCard = card.id; nb.tool = 'stamp'; drawTools(); pickSheet.close(); },
        },
        card.silhouette?.file ? h('img', { src: card.silhouette.file, alt: '' }) : h('span', { class: 'nb-pick__emoji', 'aria-hidden': 'true' }, groupById(card.group)?.emoji),
        bi(card.name))))
        : h('p', { class: 'muted' }, tx('notes.noStamps')),
      h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--soft', type: 'button', onclick: () => pickSheet.close() }, tx('card.close'))));
    pickSheet.showModal();
  }
  function placeStamp(x, y) {
    if (!nb.stampCard) { openStampPicker(); return; }
    stampAsset(nb.stampCard);
    haptic(12);
    commit({ kind: 'add', index: nb.page.items.length, item: { t: 'm', c: pencilColour(nb.colour), card: nb.stampCard, x, y, s: STAMP_SIZE, r: 0 } });
  }

  // ---------- photos ----------
  async function addPhoto(file) {
    fileInput.value = '';
    if (!file || !nb.page) return;
    try {
      const { id, w, h: ph } = await notes.savePhoto(file);
      const k = Math.min(560 / w, 560 / ph);
      const item = { t: 'p', id, x: PAGE_W / 2, y: PAGE_H / 2, w: w * k, h: ph * k, r: (Math.random() - 0.5) * 0.12 };
      nb.assets.photos.set(id, await createImageBitmap(await notes.loadPhotoBlob(id)));
      commit({ kind: 'add', index: nb.page.items.length, item });
      nb.selected = nb.page.items.length - 1;
      setTool('move');
      redraw();
    } catch (err) {
      console.error(err);
      toast(tx('notes.photoFailed'));
    }
  }

  // ---------- menu: paper, export, import, delete ----------
  function openMenu() {
    const item = (icon, key, fn, cls = 'btn--soft') => h('button', { class: ['btn', cls], type: 'button', onclick: async () => { menuSheet.close(); await fn(); } },
      h('span', { 'aria-hidden': 'true' }, icon), tx(key));
    mount(menuSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '📓'), tx('notes.title')),
      h('div', { class: 'nb-menu__list' },
        nb.page && item(nb.page.paper === 'grid' ? '⠿' : '▦', nb.page.paper === 'grid' ? 'notes.paperDots' : 'notes.paperGrid', async () => {
          nb.page.paper = nb.page.paper === 'grid' ? 'dots' : 'grid'; await notes.savePage(nb.page); redraw();
        }),
        nb.page && item('🖼️', 'notes.exportPage', () => exportPageImage(nb.page, { assets: nb.assets, headerText: headerText(nb.page) }).catch(() => toast(tx('notes.exportFailed')))),
        item('📦', 'notes.exportAll', async () => { await flushSave(); await exportAll().catch(() => toast(tx('notes.exportFailed'))); }),
        folderSupported() && item('📁', 'notes.toFolder', async () => { await flushSave(); await saveToFolder().catch(() => {}); }),
        item('📥', 'notes.import', () => importInput.click()),
        nb.page && item('🗑️', 'notes.deletePage', async () => {
          if (!window.confirm(label('notes.deleteConfirm'))) return;
          await notes.deletePage(nb.page.id);
          nb.page = null;
          await show(nb.pos);
        }, 'btn--danger')),
      h('p', { class: 'muted' }, tx('notes.backupNote')),
      h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: () => menuSheet.close() }, tx('card.close'))));
    menuSheet.showModal();
  }
  async function doImport(file) {
    importInput.value = '';
    if (!file) return;
    try {
      const n = await importBackup(file);
      toast(tx(n === 1 ? 'notes.imported.one' : 'notes.imported.many', { n }));
      await show(nb.pos);
    } catch (err) {
      console.error(err);
      toast(tx('notes.importFailed'));
    }
  }

  let toastTimer = 0;
  function toast(content) {
    el.querySelector('.nb__toast')?.remove();
    const tEl = h('p', { class: 'nb__toast', role: 'status' }, content);
    el.append(tEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => tEl.remove(), 3500);
  }

  // ---------- wiring ----------
  live.addEventListener('pointerdown', down);
  live.addEventListener('pointermove', move);
  live.addEventListener('pointerup', up);
  live.addEventListener('pointercancel', e => { touches.delete(e.pointerId); if (e.pointerType === 'pen') penDown = false; cancelStroke(); if (pinch && touches.size < 2) pinch = null; });
  // The kraft margin around the page: a finger swipe there always turns pages.
  desk.addEventListener('pointerdown', e => { if (e.target === desk) swipe = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  desk.addEventListener('pointerup', e => { if (e.target === desk && swipe?.id === e.pointerId) up(e); });
  const onKey = e => {
    if (!el.isConnected || e.target.closest?.('textarea, input')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
  };
  document.addEventListener('keydown', onKey, true);
  const ro = new ResizeObserver(() => fit());
  ro.observe(desk);

  drawTools();
  queueMicrotask(async () => {
    await notes.loadIndex();
    // All pages: the newest. One animal's pages: the first (or "start a page" if none).
    const start = nb.showAll ? Math.max(0, state.notes.length - 1) : 0;
    await show(start);
    fit();
  });

  return {
    el,
    async destroy() {
      ro.disconnect();
      document.removeEventListener('keydown', onKey, true);
      await flushSave();
      for (const bmp of nb.assets.photos.values()) bmp?.close?.();
    },
  };
}
