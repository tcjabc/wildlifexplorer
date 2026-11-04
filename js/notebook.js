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
// Pages carry animal tags (js/notes-model.js): chips under the OBSERVED stamp, "＋" to add a
// collected animal, ✕ to remove one; a stamp adds its animal's tag. A page with no tags is a
// free page (隨手記).
//
// notebook({ cardId, beside, lead, onMaximise, onClose }):
//   cardId: open on that animal's pages (its most recently edited one; a draft page tagged
//           with it when it has none, saved at its first mark). "All pages" shows the
//           contents, and from there "‹ <animal>" comes back. Without a card: the contents.
//   beside: the notebook is open next to a card. The page then fills the panel's width and
//           scrolls up and down when it is taller
//   lead: an element for the start of the bar in place of the "Field Notes" title (beside a
//         card: the panel's "Collapse ›", so the panel has one bar)
//   start: { view, scope, pageId } from where(): open there (coming back from the globe)
import { h, mount, reducedMotion } from './dom.js';
import { bi, t, tx, label, plain, getMode, dateText } from './i18n.js';
import { state, updateProfile, isCollected, groupById } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { titleOf, withTag, withoutTag, tagsAfterStamp, freePages, openFor, contents as contentsOf } from './notes-model.js';
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

export function notebook({ cardId = null, beside = false, lead = null, start = null, onMaximise = null, onClose = null } = {}) {
  // view: 'pages' (one page at a time) or 'contents'. scope: whose pages the arrows step
  // through: { kind: 'animal', id } or { kind: 'free' }. draft: the page isn't saved yet.
  const nb = {
    home: cardId, view: cardId ? 'pages' : 'contents', scope: cardId ? { kind: 'animal', id: cardId } : null, draft: false,
    ids: [], pos: 0, page: null,
    tool: 'pencil', colour: 'graphite', size: 'thin', foot: 'paw', stampCard: null,
    undo: [], redo: [], selected: -1, saveTimer: 0,
    assets: { photos: new Map(), stamps: new Map() },
  };
  const input = () => state.profile.notesInput ?? 'finger';

  // ---------- DOM ----------
  const base = h('canvas', { class: 'nb__base' });
  const live = h('canvas', { class: 'nb__live' });
  // The page's animal tags, under the OBSERVED stamp (positioned in page units, css/notes.css).
  const tagsBox = h('div', { class: 'nb__tags', role: 'group', 'aria-label': label('notes.tags') });
  // The selection handles and the text box being typed go on a layer of their own.
  const selLayer = h('div', { class: 'nb__sel-layer' });
  const overlay = h('div', { class: 'nb__overlay' }, selLayer, tagsBox);
  const sheet = h('div', { class: 'nb__sheet' }, base, live, overlay);
  const desk = h('div', { class: 'nb__desk', 'data-scroll': '' }, sheet);
  const contentsBox = h('div', { class: 'nb__contents', 'data-scroll': '', hidden: true });
  // Beside a card the page can be taller than the panel: a slim indicator on its right edge
  // shows how much more there is, and where.
  const thumb = h('span', { class: 'nb__thumb' });
  const scrollbar = h('div', { class: 'nb__scrollbar', 'aria-hidden': 'true', hidden: true }, thumb);
  const deskWrap = h('div', { class: 'nb__deskwrap' }, desk, scrollbar);
  const counter = h('span', { class: 'nb__count' });
  // "All pages" (to the contents), or in the contents of a card's notebook "‹ <animal>".
  const filterChip = h('button', { class: 'nb__filter', type: 'button', onclick: () => (nb.view === 'pages' ? openContents() : openHome()) });
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

  // One row: the title (or the lead), the chip, and the page buttons, which stay together. When
  // the row is too narrow it wraps between those groups; the chip never shrinks below its text.
  const bar = h('header', { class: 'nb__bar' },
    lead ?? h('h2', { class: 'nb__title' }, h('span', { 'aria-hidden': 'true' }, '📓 '), tx('notes.title')),
    h('span', { class: 'nb__chipwrap' }, filterChip),
    h('span', { class: 'nb__pages' },
      prev, counter, next,
      h('button', { class: 'btn btn--icon nb__new', type: 'button', 'aria-label': label('notes.newPage'), onclick: () => newPage() }, '＋'),
      h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('notes.menu'), onclick: () => openMenu() }, '⋯'),
      onMaximise && h('button', { class: 'btn btn--icon nb__max', type: 'button', 'aria-label': label('notes.maximise'), onclick: () => onMaximise('toggle') }, '⤢'),
      onClose && h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('notes.close'), onclick: () => onClose() }, '✕')));
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
  const undoBtn = h('button', { type: 'button', class: 'nb-tool nb-undo', 'aria-label': label('notes.undo'), onclick: () => undo() }, h('span', { 'aria-hidden': 'true' }, '↶'));
  const redoBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.redo'), onclick: () => redo() }, h('span', { 'aria-hidden': 'true' }, '↷'));
  const inputBtn = h('button', { type: 'button', class: 'nb-input', onclick: () => setInput(input() === 'pen' ? 'finger' : 'pen') });
  // The roller's feet open from one button (shown with the roller) in a small picker. Where one
  // row doesn't fit (see layoutTools) the toolbar has two rows of 44 px controls and no room for
  // a row of colours, so they open from a swatch the same way; in one row they sit in it.
  const colourPick = picker('nb-tool--colour', 'notes.colourPick', PENCILS.map(id => h('button', {
    type: 'button', class: 'nb-colour', 'data-colour': id, 'aria-pressed': 'false', 'aria-label': label(`notes.colour.${id}`),
    onclick: () => { nb.colour = id; closePicker(); drawTools(); },
  })));
  const footPick = picker('nb-tool--foot', 'notes.footPick', FEET.map(([id, icon]) => h('button', {
    type: 'button', class: 'nb-tool', 'data-foot': id, 'aria-pressed': 'false', 'aria-label': label(`notes.foot.${id}`),
    onclick: () => { nb.foot = id; closePicker(); drawTools(); },
  }, h('span', { 'aria-hidden': 'true' }, icon))));
  const tools = h('div', { class: 'nb__tools', role: 'toolbar', 'aria-label': label('notes.tools') },
    toolBtns, photoBtn, h('span', { class: 'nb__break', 'aria-hidden': 'true' }), h('span', { class: 'nb__sep' }),
    colourPick.btn, colourBtns, sizeBtn, footPick.btn,
    h('span', { class: 'nb__sep' }), undoBtn, redoBtn, h('span', { class: 'spacer' }), inputBtn);

  const el = h('section', { class: ['nb', beside && 'nb--beside'], 'aria-label': label('notes.title') },
    bar, tools, colourPick.box, footPick.box, deskWrap, contentsBox, fileInput, importInput, menuSheet, pickSheet);

  // ---------- toolbar layout ----------
  // One row if all of it fits (measured at its widest, with the roller's footprint button),
  // otherwise two rows with the colours behind a picker. Measured, not a breakpoint: the pen /
  // finger label's width depends on the language.
  let toolbar = '';
  function layoutTools() {
    if (!el.isConnected || !tools.clientWidth) return;
    el.dataset.toolbar = 'wide';
    el.dataset.measure = '';
    const fits = tools.scrollWidth <= tools.clientWidth + 1;
    delete el.dataset.measure;
    const next = fits ? 'wide' : 'compact';
    el.dataset.toolbar = next;
    if (next !== toolbar) { toolbar = next; closePicker(); }
  }
  const toolsRo = new ResizeObserver(() => layoutTools());
  toolsRo.observe(el);

  // ---------- pickers (two-row toolbar) ----------
  // One open at a time, just under its button; a pick, a tap elsewhere, Esc or another tool closes it.
  let openPick = null;
  function picker(cls, key, items) {
    const box = h('div', { class: 'nb-pop', role: 'group', 'aria-label': label(key), hidden: true }, items);
    const p = { box };
    p.btn = h('button', {
      type: 'button', class: ['nb-tool', cls], 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': label(key),
      onclick: () => (openPick === p ? closePicker() : openPicker(p)),
    });
    return p;
  }
  function openPicker(p) {
    closePicker();
    openPick = p;
    p.box.hidden = false;
    const left = Math.max(0, Math.min(p.btn.offsetLeft, el.clientWidth - p.box.offsetWidth));
    p.box.style.setProperty('left', `${left}px`);
    p.box.style.setProperty('top', `${p.btn.offsetTop + p.btn.offsetHeight}px`);
    p.btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    p.box.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  function closePicker() {
    if (!openPick) return;
    openPick.box.hidden = true;
    openPick.btn.setAttribute('aria-expanded', 'false');
    openPick = null;
    document.removeEventListener('pointerdown', onOutside, true);
  }
  const onOutside = e => { if (openPick && !openPick.box.contains(e.target) && !openPick.btn.contains(e.target)) closePicker(); };

  // ---------- drawing the page ----------
  let scale = 1, dpr = 1;
  function fit() {
    const r = desk.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Beside a card: the panel's width less a small margin (the page scrolls if it is taller).
    // On its own: the whole page in view.
    const pad = beside ? parseFloat(getComputedStyle(el).getPropertyValue('--nb-page-margin')) || 16 : 16;
    const k = beside
      ? (desk.clientWidth - pad * 2) / PAGE_W
      : Math.min((r.width - pad * 2) / PAGE_W, (r.height - pad * 2) / PAGE_H);
    const w = Math.max(10, Math.floor(PAGE_W * k)), hgt = Math.max(10, Math.floor(PAGE_H * k));
    sheet.style.setProperty('width', `${w}px`);
    sheet.style.setProperty('height', `${hgt}px`);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = w / PAGE_W;
    for (const c of [base, live]) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    redraw();
    drawScroll();
    maybeNudge(); // the first fit is the first moment the page's height is known
  }

  // ---------- scrolling (beside a card) ----------
  function drawScroll() {
    const sh = desk.scrollHeight, ch = desk.clientHeight;
    const over = beside && !sheet.hidden && sh - ch > 1;
    scrollbar.hidden = !over;
    if (!over) return;
    const track = scrollbar.clientHeight;
    const len = Math.max(track * (ch / sh), Math.min(track, 32));
    thumb.style.setProperty('height', `${len}px`);
    thumb.style.setProperty('transform', `translateY(${(track - len) * (desk.scrollTop / (sh - ch))}px)`);
  }
  // The first time a page opens beside a card and there is more below, it dips down a little
  // and comes back, so a child can see the page goes on.
  const nudged = new Set();
  let nudge = 0;
  function stopNudge() { cancelAnimationFrame(nudge); nudge = 0; }
  function maybeNudge() {
    const room = desk.scrollHeight - desk.clientHeight;
    if (!beside || !nb.page || room <= 1 || desk.scrollTop > 0 || nudged.has(nb.page.id) || reducedMotion()) return;
    nudged.add(nb.page.id);
    const depth = Math.min(56, room), t0 = performance.now() + 450, dur = 900;
    const step = now => {
      const t = (now - t0) / dur;
      if (t >= 1) { desk.scrollTop = 0; nudge = 0; return; }
      if (t > 0) desk.scrollTop = depth * Math.sin(Math.PI * t);
      nudge = requestAnimationFrame(step);
    };
    stopNudge();
    nudge = requestAnimationFrame(step);
  }
  const ctxOf = c => { const x = c.getContext('2d'); x.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); return x; };
  // The title: the first tag's name, "+ N more" when there are several; none on a free page.
  function headerText(page) {
    const title = titleOf(page.tags ?? [], known);
    const card = title && state.byId.get(title.first);
    const more = title?.more ? t('notes.moreTags', { n: title.more }) : null;
    const name = card && (more ? { en: `${card.name.en} ${more.en}`, zh: `${card.name.zh || card.name.en} ${more.zh}` } : card.name);
    return { date: inLang(dateText(page.header.date, { year: 'numeric', month: 'long', day: 'numeric' })), name: inLang(name), stamp: inLang(t('notes.observed')) };
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
  const known = id => state.byId.has(id);
  // The pages the arrows step through: one animal's (oldest first), or the free pages.
  function listIds() {
    if (!nb.scope) return [];
    const recs = nb.scope.kind === 'animal' ? notes.pagesFor(nb.scope.id) : freePages(state.notes, known);
    return recs.map(r => r.pageId);
  }
  function setView(view) {
    nb.view = view;
    el.dataset.view = view;
    contentsBox.hidden = view !== 'contents';
    if (view === 'contents') closePicker();
  }
  async function show(pos, dir = 0) {
    await flushSave();
    nb.ids = listIds();
    if (!nb.ids.length && nb.scope?.kind !== 'animal') { await openContents(); return; }
    setView('pages');
    if (!nb.ids.length) {
      // This animal has no pages: a new one tagged with it, saved at its first mark.
      nb.pos = 0;
      nb.draft = true;
      nb.page = notes.blankPage({ tags: [nb.scope.id] });
    } else {
      nb.draft = false;
      nb.pos = Math.max(0, Math.min(pos, nb.ids.length - 1));
      const id = nb.ids[nb.pos];
      nb.page = await notes.loadPage(id);
      if (!nb.page) {
        // The file is missing (e.g. storage was cleared): show a blank page in its place.
        const rec = state.notes.find(r => r.pageId === id);
        nb.page = { ...notes.blankPage({ tags: rec?.tags ?? [] }), id, createdAt: rec?.createdAt, header: { date: rec?.createdAt ?? new Date().toISOString() } };
      }
    }
    nb.undo = []; nb.redo = []; nb.selected = -1;
    drawTags();
    loadAssets(nb.page);
    drawBar();
    redraw();
    stopNudge();
    desk.scrollTop = 0;
    drawScroll();
    maybeNudge();
    if (dir && !reducedMotion()) {
      sheet.animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  }
  const turn = d => { if (!nb.draft && nb.pos + d >= 0 && nb.pos + d < nb.ids.length) { haptic(8); show(nb.pos + d, d); } };
  // ＋: a new page tagged with the animal whose pages these are (on the free pages: a free page).
  async function newPage(scope = nb.scope) {
    await flushSave();
    if (nb.draft && scope === nb.scope) return; // the empty new page is already showing
    nb.scope = scope ?? { kind: 'free' };
    const page = await notes.createPage({ tags: nb.scope.kind === 'animal' ? [nb.scope.id] : [] });
    nb.ids = listIds();
    await show(nb.ids.indexOf(page.id), 1);
  }
  // A card's notebook: its animal's most recently edited page (or the draft).
  async function openHome() {
    nb.scope = { kind: 'animal', id: nb.home };
    await show(openFor(state.notes, nb.home).pos);
  }
  // A page from the contents: the arrows then step through the list it was under.
  async function openPage(scope, pageId) {
    await flushSave();
    nb.scope = scope;
    nb.ids = listIds();
    await show(Math.max(0, nb.ids.indexOf(pageId)));
  }

  function drawBar() {
    const pages = nb.view === 'pages';
    counter.textContent = !pages ? '' : nb.draft ? '1 / 1' : nb.ids.length ? `${nb.pos + 1} / ${nb.ids.length}` : '';
    prev.disabled = !pages || nb.draft || nb.pos <= 0;
    next.disabled = !pages || nb.draft || nb.pos >= nb.ids.length - 1;
    const home = nb.home && state.byId.get(nb.home);
    filterChip.hidden = !pages && !home;
    mount(filterChip, pages ? tx('notes.allPages') : home ? tx('notes.backTo', { name: home.name }) : null);
  }
  function drawTools() {
    toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === nb.tool)));
    el.querySelectorAll('button[data-colour]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.colour === nb.colour)));
    el.querySelectorAll('button[data-foot]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.foot === nb.foot)));
    mount(colourPick.btn, h('span', { class: 'nb-swatch', 'data-colour': nb.colour, 'aria-hidden': 'true' }));
    mount(footPick.btn, h('span', { 'aria-hidden': 'true' }, FEET.find(([id]) => id === nb.foot)?.[1] ?? ''));
    el.dataset.tool = nb.tool;
    mount(sizeBtn, h('span', { class: ['nb-size', `nb-size--${nb.size}`], 'aria-hidden': 'true' }));
    undoBtn.disabled = !nb.undo.length;
    redoBtn.disabled = !nb.redo.length;
    const pen = input() === 'pen';
    inputBtn.setAttribute('aria-pressed', String(pen));
    mount(inputBtn, h('span', { 'aria-hidden': 'true' }, pen ? '🖊️ ' : '☝️ '), tx(pen ? 'notes.penOnly' : 'notes.finger'));
    inputBtn.setAttribute('aria-label', label(pen ? 'notes.penOnlyHint' : 'notes.fingerHint'));
    layoutTools();
  }
  function setTool(id) {
    closePicker();
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
  // Ops: add { index, item }, remove { entries: [{ index, item }] }, change { index, before, after },
  // tags (only the tags). Any op may also carry tags: { before, after } (a stamp adds its animal).
  function apply(op, back) {
    const items = nb.page.items;
    if (op.kind === 'add') { if (back) items.splice(op.index, 1); else items.splice(op.index, 0, op.item); }
    else if (op.kind === 'remove') {
      if (back) [...op.entries].sort((a, b) => a.index - b.index).forEach(e => items.splice(e.index, 0, e.item));
      else [...op.entries].sort((a, b) => b.index - a.index).forEach(e => items.splice(e.index, 1));
    } else if (op.kind === 'change') items[op.index] = structuredClone(back ? op.before : op.after);
    if (op.tags) { nb.page.tags = [...(back ? op.tags.before : op.tags.after)]; nb.tagsChanged = true; }
  }
  function commit(op) {
    apply(op, false);
    nb.undo.push(op);
    nb.redo = [];
    touched();
  }
  function undo() { const op = nb.undo.pop(); if (!op) return; apply(op, true); nb.redo.push(op); touched(); }
  function redo() { const op = nb.redo.pop(); if (!op) return; apply(op, false); nb.undo.push(op); touched(); }
  // After any change: redraw and save soon (a draft page is saved for the first time). A tag
  // change is saved straight away, since it moves the page in or out of the list in view.
  function touched() {
    if (nb.selected >= nb.page.items.length) nb.selected = -1;
    nb.dirty = true;
    redraw();
    drawTools();
    clearTimeout(nb.saveTimer);
    if (nb.tagsChanged) { nb.tagsChanged = false; drawTags(); afterTags(); return; }
    nb.saveTimer = setTimeout(() => flushSave(), 400);
  }
  async function flushSave() {
    clearTimeout(nb.saveTimer);
    nb.saveTimer = 0;
    if (nb.page && nb.dirty) {
      nb.dirty = false;
      await notes.savePage(nb.page);
      if (nb.draft) { nb.draft = false; nb.ids = listIds(); nb.pos = Math.max(0, nb.ids.indexOf(nb.page.id)); drawBar(); }
    }
  }
  // The page left the list in view (its animal's tag removed, a free page tagged): the arrows
  // now step through the list it is in, its first animal's or the free pages.
  async function afterTags() {
    await flushSave();
    const tags = (nb.page.tags ?? []).filter(known);
    const inScope = nb.scope?.kind === 'animal' ? tags.includes(nb.scope.id) : !tags.length;
    if (!inScope) nb.scope = tags.length ? { kind: 'animal', id: tags[0] } : { kind: 'free' };
    nb.ids = listIds();
    nb.pos = Math.max(0, nb.ids.indexOf(nb.page.id));
    drawBar();
  }
  function setTags(after) {
    const before = [...(nb.page.tags ?? [])];
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    commit({ kind: 'tags', tags: { before, after } });
  }

  // ---------- tag chips ----------
  // One chip per animal (its name and ✕), and "＋" for another collected animal.
  function drawTags() {
    if (!nb.page) { mount(tagsBox); return; }
    const chips = (nb.page.tags ?? []).filter(known).map(id => {
      const card = state.byId.get(id);
      return h('span', { class: 'nb-tag' },
        h('span', { class: 'nb-tag__name' }, bi(card.name)),
        h('button', { class: 'nb-tag__x', type: 'button', 'aria-label': label('notes.removeTag', { name: card.name }), onclick: () => setTags(withoutTag(nb.page.tags, id)) },
          h('span', { 'aria-hidden': 'true' }, '✕')));
    });
    mount(tagsBox, chips, h('button', { class: 'nb-tag nb-tag--add', type: 'button', 'aria-label': label('notes.addTag'), onclick: () => openTagPicker() },
      h('span', { 'aria-hidden': 'true' }, '＋')));
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
    if (!draws(e)) { startSwipe(e); return; }
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
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, axis = swipe.axis;
      swipe = null;
      if (axis !== 'y' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) turn(dx < 0 ? 1 : -1);
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
  const midY = () => { const [a, b] = pts(); return (a.y + b.y) / 2; };
  function startPinch() {
    if (nb.tool === 'move' && nb.selected >= 0) {
      const it = nb.page.items[nb.selected];
      pinch = { item: true, d0: dist(), a0: angle(), before: structuredClone(it) };
    } else { stopNudge(); pinch = { d0: dist(), y0: midY(), top: desk.scrollTop }; } // two fingers scroll the page
  }
  function movePinch() {
    if (touches.size < 2) return;
    if (pinch.item) {
      const it = nb.page.items[nb.selected], b = pinch.before;
      const k = Math.max(0.2, Math.min(5, dist() / pinch.d0));
      resizeItem(it, b, k);
      if (it.t !== 'x') it.r = (b.r ?? 0) + angle() - pinch.a0;
      redraw();
    } else {
      pinch.k = dist() / pinch.d0;
      desk.scrollTop = pinch.top - (midY() - pinch.y0);
    }
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
    selLayer.replaceChildren();
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
    selLayer.append(box);
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
    selLayer.append(area);
    area.focus();
  }

  // ---------- stamps and tags: picking a collected animal ----------
  function pickAnimal({ icon, titleKey, emptyKey, cards, onPick }) {
    mount(pickSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, icon), tx(titleKey)),
      cards.length
        ? h('div', { class: 'nb-pick__grid' }, cards.map(card => h('button', {
          type: 'button', class: 'nb-pick__item', 'data-group': card.group,
          onclick: () => { pickSheet.close(); onPick(card); },
        },
        card.silhouette?.file ? h('img', { src: card.silhouette.file, alt: '' }) : h('span', { class: 'nb-pick__emoji', 'aria-hidden': 'true' }, groupById(card.group)?.emoji),
        bi(card.name))))
        : h('p', { class: 'muted' }, tx(emptyKey)),
      h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--soft', type: 'button', onclick: () => pickSheet.close() }, tx('card.close'))));
    pickSheet.showModal();
  }
  function openStampPicker() {
    pickAnimal({ icon: '🐾', titleKey: 'notes.pickStamp', emptyKey: 'notes.noStamps', cards: state.cards.filter(isCollected),
      onPick: card => { nb.stampCard = card.id; nb.tool = 'stamp'; drawTools(); } });
  }
  // Only animals this explorer has collected, and not already on the page.
  function openTagPicker() {
    const tags = nb.page?.tags ?? [];
    pickAnimal({ icon: '🏷️', titleKey: 'notes.pickTag', emptyKey: 'notes.noTags', cards: state.cards.filter(c => isCollected(c) && !tags.includes(c.id)),
      onPick: card => setTags(withTag(nb.page.tags ?? [], card.id)) });
  }
  // A stamp also tags the page with its animal (once); erasing the stamp leaves the tag.
  function placeStamp(x, y) {
    if (!nb.stampCard) { openStampPicker(); return; }
    stampAsset(nb.stampCard);
    haptic(12);
    const before = [...(nb.page.tags ?? [])], after = tagsAfterStamp(before, nb.stampCard);
    commit({
      kind: 'add', index: nb.page.items.length, item: { t: 'm', c: pencilColour(nb.colour), card: nb.stampCard, x, y, s: STAMP_SIZE, r: 0 },
      ...(after.length !== before.length && { tags: { before, after } }),
    });
  }

  // ---------- contents ----------
  // Binder groups with the animals that have pages (count, latest page), each page listed
  // under every animal it is tagged with ("also in" the others); then the free pages.
  async function openContents() {
    await flushSave();
    setView('contents');
    nb.page = null;
    nb.draft = false; // an untouched new page is simply dropped
    mount(tagsBox);
    drawBar();
    drawContents();
  }
  const pages = n => tx(n === 1 ? 'notes.pageCount.one' : 'notes.pageCount.many', { n });
  const shortDate = iso => bi(dateText(iso, { year: 'numeric', month: 'short', day: 'numeric' }));
  const names = ids => {
    const cards = ids.map(id => state.byId.get(id)).filter(Boolean);
    return { en: cards.map(c => c.name.en).join(', '), zh: cards.map(c => c.name.zh || c.name.en).join('、') };
  };
  function drawContents() {
    const toc = contentsOf(state.notes, id => state.byId.get(id) ?? null, state.groups);
    const free = { kind: 'free' };
    const pageRow = (rec, scope, alsoIn = []) => h('li', {},
      h('button', { class: 'nb-toc__page', type: 'button', onclick: () => openPage(scope, rec.pageId) },
        thumbFor(rec.pageId, 'nb-toc__thumb--small'),
        h('span', { class: 'nb-toc__info' },
          h('span', { class: 'nb-toc__date' }, shortDate(rec.createdAt)),
          alsoIn.length ? h('span', { class: 'nb-toc__also' }, tx('notes.alsoIn', { names: names(alsoIn) })) : null)));
    mount(contentsBox,
      h('h2', { class: 'nb-toc__title' }, tx('notes.contents')),
      !state.notes.length && h('p', { class: 'nb-toc__empty' }, tx('notes.empty')),
      toc.groups.map(({ group, animals }) => h('section', { class: 'nb-toc__group', 'data-group': group.id },
        h('h3', { class: 'nb-toc__heading' }, h('span', { 'aria-hidden': 'true' }, group.emoji), bi(group.name)),
        animals.map(a => {
          const scope = { kind: 'animal', id: a.cardId };
          return h('div', { class: 'nb-toc__animal' },
            h('button', { class: 'nb-toc__head', type: 'button', onclick: () => openPage(scope, a.latest.pageId) },
              thumbFor(a.latest.pageId),
              h('span', { class: 'nb-toc__name' }, bi(a.card.name)),
              h('span', { class: 'nb-toc__count' }, pages(a.count))),
            h('ul', { class: 'nb-toc__pages' }, a.pages.map(p => pageRow(p.rec, scope, p.alsoIn))));
        }))),
      h('section', { class: 'nb-toc__group nb-toc__group--free' },
        h('h3', { class: 'nb-toc__heading' }, h('span', { 'aria-hidden': 'true' }, '📝'), tx('notes.freePages'),
          toc.free.length ? h('span', { class: 'nb-toc__count' }, pages(toc.free.length)) : null),
        toc.free.length ? h('ul', { class: 'nb-toc__pages' }, toc.free.map(r => pageRow(r, free))) : null,
        h('button', { class: 'btn btn--accent nb-toc__new', type: 'button', onclick: () => newPage(free) },
          h('span', { 'aria-hidden': 'true' }, '＋ '), tx('notes.newFreePage'))));
    contentsBox.scrollTop = 0;
  }

  // Small pictures of pages, drawn from their data a few at a time and kept for this visit.
  const thumbs = new Map(); // pageId -> Promise<HTMLCanvasElement | null>
  let thumbQueue = Promise.resolve();
  function thumbFor(pageId, cls = '') {
    const canvas = h('canvas', { class: ['nb-toc__thumb', cls], 'aria-hidden': 'true' });
    if (!thumbs.has(pageId)) thumbs.set(pageId, (thumbQueue = thumbQueue.then(() => drawThumb(pageId)).catch(() => null)));
    thumbs.get(pageId).then(src => {
      if (!src || !canvas.isConnected) return;
      const r = canvas.getBoundingClientRect(), k = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * k)); canvas.height = Math.max(1, Math.round(r.height * k));
      canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    });
    return canvas;
  }
  async function drawThumb(pageId) {
    const page = await notes.loadPage(pageId);
    if (!page) return null;
    for (const it of page.items) {
      if (it.t === 'p' && !nb.assets.photos.get(it.id)) {
        const blob = await notes.loadPhotoBlob(it.id).catch(() => null);
        if (blob) nb.assets.photos.set(it.id, await createImageBitmap(blob).catch(() => null));
      }
      if (it.t === 'm') { const a = stampAsset(it.card); if (a.img && !a.img.complete) await a.img.decode().catch(() => {}); }
    }
    const k = 0.24; // 240 × 336: sharp enough for the largest thumbnail on a 2x screen
    const c = document.createElement('canvas');
    c.width = PAGE_W * k; c.height = PAGE_H * k;
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    renderPage(ctx, page, { assets: nb.assets, headerText: headerText(page) });
    return c;
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
    const onPage = nb.view === 'pages' && nb.page;
    const item = (icon, key, fn, cls = 'btn--soft') => h('button', { class: ['btn', cls], type: 'button', onclick: async () => { menuSheet.close(); await fn(); } },
      h('span', { 'aria-hidden': 'true' }, icon), tx(key));
    mount(menuSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '📓'), tx('notes.title')),
      h('div', { class: 'nb-menu__list' },
        onPage && item(nb.page.paper === 'grid' ? '⠿' : '▦', nb.page.paper === 'grid' ? 'notes.paperDots' : 'notes.paperGrid', async () => {
          nb.page.paper = nb.page.paper === 'grid' ? 'dots' : 'grid'; nb.dirty = true; await flushSave(); redraw();
        }),
        onPage && item('🖼️', 'notes.exportPage', () => exportPageImage(nb.page, { assets: nb.assets, headerText: headerText(nb.page) }).catch(() => toast(tx('notes.exportFailed')))),
        item('📦', 'notes.exportAll', async () => { await flushSave(); await exportAll().catch(() => toast(tx('notes.exportFailed'))); }),
        folderSupported() && item('📁', 'notes.toFolder', async () => { await flushSave(); await saveToFolder().catch(() => {}); }),
        item('📥', 'notes.import', () => importInput.click()),
        onPage && !nb.draft && item('🗑️', 'notes.deletePage', async () => {
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
      if (nb.view === 'contents') await openContents(); else await show(nb.pos);
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
  // The kraft margin around the page: one finger there turns pages (sideways) or scrolls the
  // page (up and down). So does a finger on the page itself when only a pen draws.
  function startSwipe(e) { stopNudge(); swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, top: desk.scrollTop, axis: null }; }
  desk.addEventListener('pointerdown', e => {
    stopNudge();
    if (e.target !== desk) return;
    startSwipe(e);
    try { desk.setPointerCapture(e.pointerId); } catch { /* gone */ }
  });
  desk.addEventListener('pointermove', e => {
    if (swipe?.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.axis && Math.hypot(dx, dy) > 8) swipe.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (swipe.axis === 'y') desk.scrollTop = swipe.top - dy;
  });
  desk.addEventListener('pointerup', e => { if (e.target === desk && swipe?.id === e.pointerId) up(e); });
  desk.addEventListener('pointercancel', e => { if (swipe?.id === e.pointerId) swipe = null; });
  desk.addEventListener('wheel', stopNudge, { passive: true });
  desk.addEventListener('scroll', drawScroll, { passive: true });
  const onKey = e => {
    if (!el.isConnected || e.target.closest?.('textarea, input')) return;
    if (e.key === 'Escape' && openPick) {
      e.preventDefault(); e.stopPropagation();
      const btn = openPick.btn;
      closePicker();
      btn.focus({ preventScroll: true });
      return;
    }
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
    if (start?.view === 'contents') await openContents();
    else if (start?.scope && start.pageId) await openPage(start.scope, start.pageId);
    else if (nb.home) await openHome();
    else await openContents();
    fit();
  });

  return {
    el,
    // Where the notebook is, to open there again: the contents, or a page in a list.
    where: () => ({ view: nb.view, scope: nb.scope, pageId: nb.view === 'pages' && !nb.draft ? nb.page?.id ?? null : null }),
    async destroy() {
      ro.disconnect();
      toolsRo.disconnect();
      closePicker();
      stopNudge();
      document.removeEventListener('keydown', onKey, true);
      await flushSave();
      for (const bmp of nb.assets.photos.values()) bmp?.close?.();
    },
  };
}
