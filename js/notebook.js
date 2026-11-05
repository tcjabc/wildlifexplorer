// Field Notes: a researcher's notebook. Kraft cover, dotted (or grid) paper. Tools: pencil
// (pressure), eraser (whole marks), coloured pencils, text, creature stamps, footprint roller,
// taped-in photos, undo and redo.
//
// On its own (#/notes) the notebook fills the screen: no app header, one back button, rails for
// the tools at the left and right (bands above and below the page in portrait), a ribbon marking
// the place, and tabs to turn pages. Landscape lies open at a two-page spread, portrait shows one
// page; both pages of a spread are live. Beside a card it stays a panel: one page, with its bar
// and toolbar on top.
//
// One finger draws. Two fingers pan and pinch-zoom; a clear sideways two-finger swipe at the
// fitted size turns the page (js/notes-view.js has the rules). During a gesture the page moves
// by CSS transform; when it ends, a canvas the size of the screen redraws what is in view
// sharply, so zooming in never needs a bigger page bitmap. The wheel pans, ctrl + wheel zooms.
//
// One tap on a photo, stamp or text selects it: drag it inside its box, use the handles, or
// pinch on it to resize and turn it. A tap elsewhere lets go.
//
// Pen and fingers: in "finger" mode fingers draw; in "pen" mode only a pen (or mouse) draws
// and one finger turns pages. The first time a pen draws, the notebook switches to pen mode
// (palm rejection); the toggle in the toolbar switches back at any time. Remembered per
// profile. While a pen is touching the page, other touches never draw.
//
// Pages carry animal tags (js/notes-model.js): chips under the OBSERVED stamp, "＋" to add a
// collected animal, ✕ to remove one; a stamp adds its animal's tag. A page with no tags is a
// free page (隨手記).
//
// notebook({ cardId, beside, lead, start, onBack }):
//   cardId: open on that animal's pages (its most recently edited one; a draft page tagged
//           with it when it has none, saved at its first mark). "All pages" shows the
//           contents, and from there "‹ <animal>" comes back. Without a card: the contents.
//   beside: the notebook is open next to a card. The page then fills the panel's width and
//           pans up and down when it is taller
//   lead: an element for the start of the bar beside a card (the panel's "Collapse ›")
//   start: { view, scope, pageId } from where(): open there (coming back from the globe)
//   onBack: leave the notebook (on its own)
import { h, mount, reducedMotion } from './dom.js';
import { bi, t, tx, label, getMode, dateText } from './i18n.js';
import { state, updateProfile, isCollected, groupById } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { titleOf, withTag, withoutTag, tagsAfterStamp, freePages, openFor, contents as contentsOf } from './notes-model.js';
import { renderPage, renderItem, appendItem, drawStroke, hitItem, boundsOf, PENCILS, pencilColour } from './notes-render.js';
import { slotsFor, fitScale, clampView, pinchView, settleView, swipeTurn, secondFingerCounts, isTap, pixelRatio } from './notes-view.js';
import { exportPageImage, exportAll, importBackup, saveToFolder, folderSupported } from './notes-io.js';
import { haptic, clamp } from './gesture.js';

const TOOLS = [
  ['pencil', '✏️'], ['eraser', '🧽'], ['text', '🔤'], ['stamp', '🐾'], ['roller', '👣'],
];
const FEET = [['paw', '🐈'], ['hoof', '🦌'], ['bird', '🐦'], ['bear', '🐻']];
const SIZES = { thin: 5, thick: 12 };
const TEXT_SIZE = 40;
const STAMP_SIZE = 180;
const ERASE_R = 14;
const SETTLE_MS = 400; // after selecting, before ✕ counts

// The card's name and dates in the profile's language, for text drawn on the canvas.
const inLang = pair => {
  if (!pair) return '';
  const m = getMode();
  return m === 'en' ? pair.en || pair.zh : m === 'zh' ? pair.zh || pair.en : [pair.en, pair.zh].filter(Boolean).join('  ');
};

export function notebook({ cardId = null, beside = false, lead = null, start = null, onBack = null } = {}) {
  // Each side of the book: its page (none when not showing), and whether that page is a draft
  // (not saved until its first mark) or has unsaved changes.
  const makeSide = i => {
    const base = h('canvas', { class: 'nb__base' });
    // The page's animal tags, under the OBSERVED stamp (positioned in page units, css/notes.css).
    const tagsBox = h('div', { class: 'nb__tags', role: 'group', 'aria-label': label('notes.tags') });
    // The selection handles and the text box being typed go on a layer of their own.
    const selLayer = h('div', { class: 'nb__sel-layer' });
    return {
      i, base, tagsBox, selLayer, sheet: h('div', { class: 'nb__sheet' }, base), overlay: h('div', { class: 'nb__overlay' }, selLayer, tagsBox),
      page: null, draft: false, dirty: false,
    };
  };
  const sides = [makeSide(0), makeSide(1)];
  sides[1].sheet.hidden = sides[1].overlay.hidden = true;

  // view: 'pages' or 'contents'. scope: whose pages are turned through: { kind: 'animal', id } or
  // { kind: 'free' }. pos: the list index of the first page open. active: the side being worked
  // on (the last one touched); nb.page and nb.draft are that side's.
  const nb = {
    home: cardId, view: cardId ? 'pages' : 'contents', scope: cardId ? { kind: 'animal', id: cardId } : null,
    ids: [], pos: 0, active: 0, spread: false,
    tool: 'pencil', colour: 'graphite', size: 'thin', foot: 'paw', stampCard: null,
    undo: [], redo: [], selected: -1, saveTimer: 0,
    assets: { photos: new Map(), stamps: new Map() },
    get page() { return sides[this.active].page; },
    get draft() { return sides[this.active].draft; },
  };
  const input = () => state.profile.notesInput ?? 'finger';
  const open = () => (nb.spread ? sides : sides.slice(0, 1));

  // ---------- DOM ----------
  // Two books with the same transform: the pages under the canvases, what sits on them over.
  const book = h('div', { class: 'nb__book' }, sides[0].sheet, sides[1].sheet);
  const over = h('div', { class: 'nb__book nb__book--over' }, sides[0].overlay, sides[1].overlay, h('span', { class: 'nb__fold', 'aria-hidden': 'true' }));
  const detail = h('canvas', { class: 'nb__detail', hidden: true }); // the sharp view when zoomed in
  const live = h('canvas', { class: 'nb__live' });                   // the mark being made
  const desk = h('div', { class: 'nb__desk', 'data-scroll': '' }, book, detail, live, over);
  const contentsBox = h('div', { class: 'nb__contents', 'data-scroll': '', hidden: true });
  // Beside a card the page can be taller than the panel: a slim indicator on its right edge
  // shows how much more there is, and where.
  const thumb = h('span', { class: 'nb__thumb' });
  const scrollbar = h('div', { class: 'nb__scrollbar', 'aria-hidden': 'true', hidden: true }, thumb);
  const counter = h('span', { class: 'nb__count' });
  // "All pages" (to the contents), or in the contents of a card's notebook "‹ <animal>".
  const filterChip = h('button', { class: 'nb__filter', type: 'button', onclick: () => (nb.view === 'pages' ? openContents() : openHome()) });
  const prev = h('button', { class: 'btn btn--icon nb__nav nb__nav--prev', type: 'button', 'aria-label': label('notes.prev'), onclick: () => turn(-1) }, '‹');
  const next = h('button', { class: 'btn btn--icon nb__nav nb__nav--next', type: 'button', 'aria-label': label('notes.next'), onclick: () => turn(1) }, '›');
  const newBtn = h('button', { class: 'btn btn--icon nb__new', type: 'button', 'aria-label': label('notes.newPage'), onclick: () => newPage() }, '＋');
  const menuBtn = h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('notes.menu'), onclick: () => openMenu() }, '⋯');
  // The ribbon marks the place in the book; tapping it opens the contents.
  const ribbon = h('button', { class: 'nb__ribbon', type: 'button', onclick: () => openContents() });
  const deskWrap = h('div', { class: 'nb__deskwrap' }, desk, scrollbar, !beside && ribbon, !beside && prev, !beside && next);
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => addPhoto(e.target.files?.[0]) });
  const importInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: e => doImport(e.target.files?.[0]) });
  const menuSheet = h('dialog', { class: 'sheet nb-menu' });
  const pickSheet = h('dialog', { class: 'sheet nb-pick' });
  [menuSheet, pickSheet].forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.addEventListener('keydown', e => e.stopPropagation());
  });

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

  // Beside a card, one row: the lead, the chip, and the page buttons, which stay together. When
  // the row is too narrow it wraps between those groups; the chip never shrinks below its text.
  const bar = beside && h('header', { class: 'nb__bar' },
    lead,
    h('span', { class: 'nb__chipwrap' }, filterChip),
    h('span', { class: 'nb__pages' }, prev, counter, next, newBtn, menuBtn));
  // On its own, the rails: back and the tools; and room for more tools, with new page and the
  // menu at its ends.
  const backBtn = !beside && h('button', { class: 'btn btn--icon nb__back', type: 'button', 'aria-label': label('notes.back'), onclick: () => onBack?.() }, '‹');
  const railStart = !beside && h('aside', { class: 'nb__rail nb__rail--start' }, backBtn, tools);
  const railEnd = !beside && h('aside', { class: 'nb__rail nb__rail--end' }, newBtn, h('span', { class: 'spacer' }), menuBtn);

  const el = h('section', { class: ['nb', beside ? 'nb--beside' : 'nb--immersive'], 'aria-label': label('notes.title') },
    bar, beside && tools, railStart, colourPick.box, footPick.box, deskWrap, contentsBox, railEnd, fileInput, importInput, menuSheet, pickSheet);

  // ---------- toolbar layout ----------
  // One row if all of it fits (measured at its widest, with the roller's footprint button),
  // otherwise two rows with the colours behind a picker. Measured, not a breakpoint: the pen /
  // finger label's width depends on the language.
  let toolbar = '';
  function layoutTools() {
    if (!beside) { el.dataset.toolbar = 'compact'; return; } // the rail: one control after another
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

  // ---------- pickers (two-row toolbar, rails) ----------
  // One open at a time, just under its button (beside it in a side rail); a pick, a tap
  // elsewhere, Esc or another tool closes it.
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
    const b = p.btn.getBoundingClientRect(), e = el.getBoundingClientRect();
    const rail = !beside && el.dataset.orient === 'landscape';
    const left = rail ? b.right - e.left : Math.max(0, Math.min(b.left - e.left, e.width - p.box.offsetWidth));
    const top = rail ? Math.max(0, Math.min(b.top - e.top, e.height - p.box.offsetHeight)) : b.bottom - e.top;
    p.box.style.setProperty('left', `${left}px`);
    p.box.style.setProperty('top', `${top}px`);
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

  // ---------- the view: fitting, zoom and pan ----------
  let scale = 1, dpr = 1;       // CSS px per page unit at the fitted size; canvas px per CSS px
  let sheetW = 0, sheetH = 0;   // one page at the fitted size, CSS px
  let frame = { w: 0, h: 0 };   // the desk
  let rect = { left: 0, top: 0 }; // where it is on screen: read once per press, not per point
  let view = { k: 1, x: 0, y: 0 };
  const margin = () => (beside ? parseFloat(getComputedStyle(el).getPropertyValue('--nb-page-margin')) || 16 : 0);
  const bookSize = () => ({ w: sheetW * open().length, h: sheetH });

  function place() {
    const k = view.k, tr = `translate(${view.x}px, ${view.y}px) scale(${k})`;
    book.style.setProperty('transform', tr);
    over.style.setProperty('transform', tr);
    over.style.setProperty('--nb-unzoom', String(1 / k));
    drawScroll();
  }
  function setView(next) { view = clampView(next, frame, bookSize(), margin()); place(); }
  // The fitted page; beside a card, from its top.
  function resetView() { setView({ k: 1, x: 0, y: margin() }); paintDetail(); }

  // Landscape or portrait, the layout and the size of everything in it.
  function layout() {
    if (!beside && !document.activeElement?.classList.contains('nb-text')) { // a keyboard is no rotation
      const land = el.clientWidth > el.clientHeight;
      el.dataset.orient = land ? 'landscape' : 'portrait';
      if (land !== nb.spread) {
        nb.spread = land;
        sides[1].sheet.hidden = sides[1].overlay.hidden = !land;
        fit();
        if (nb.view === 'pages' && nb.page) show(nb.pos + nb.active);
        return;
      }
    }
    fit();
  }

  function fit() {
    const w = desk.clientWidth, hgt = desk.clientHeight;
    if (!w || !hgt) return;
    const pad = margin(), widthChanged = w !== frame.w;
    const k = fitScale({ w, h: hgt, pages: open().length, pad, pageW: PAGE_W, pageH: PAGE_H, byWidth: beside });
    sheetW = Math.max(10, Math.floor(PAGE_W * k));
    sheetH = Math.max(10, Math.floor(PAGE_H * k));
    scale = sheetW / PAGE_W;
    dpr = pixelRatio(window.devicePixelRatio);
    frame = { w, h: hgt };
    const showing = open();
    for (const s of sides) {
      for (const box of [s.sheet, s.overlay]) { box.style.setProperty('width', `${sheetW}px`); box.style.setProperty('height', `${sheetH}px`); }
      s.base.width = showing.includes(s) ? Math.round(sheetW * dpr) : 1;
      s.base.height = showing.includes(s) ? Math.round(sheetH * dpr) : 1;
    }
    clipped = false; // resizing a canvas resets it
    for (const c of [live, detail]) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    // The tabs and the ribbon follow the book's edge.
    const b = bookSize();
    deskWrap.style.setProperty('--nb-edge-x', `${Math.max(0, (w - b.w) / 2)}px`);
    deskWrap.style.setProperty('--nb-edge-y', `${Math.max(0, (hgt - b.h) / 2)}px`);
    if (widthChanged) view = { k: 1, x: 0, y: pad };
    setView(view);
    redraw();
    maybeNudge(); // the first fit is the first moment the page's height is known
  }

  // After a gesture: the sharp view of what ended up on screen.
  let settleTimer = 0;
  function settle() {
    clearTimeout(settleTimer);
    view = settleView(view, frame, bookSize(), margin());
    place();
    paintDetail();
  }

  // ---------- scrolling (beside a card) ----------
  function drawScroll() {
    const pad = margin(), sh = sheetH * view.k + pad * 2, ch = frame.h;
    const tall = beside && nb.view === 'pages' && sh - ch > 1;
    scrollbar.hidden = !tall;
    if (!tall) return;
    const track = scrollbar.clientHeight;
    const len = Math.max(track * (ch / sh), Math.min(track, 32));
    thumb.style.setProperty('height', `${len}px`);
    thumb.style.setProperty('transform', `translateY(${(track - len) * ((pad - view.y) / (sh - ch))}px)`);
  }
  // The first time a page opens beside a card and there is more below, it dips down a little
  // and comes back, so a child can see the page goes on.
  const nudged = new Set();
  let nudge = 0;
  function stopNudge() { cancelAnimationFrame(nudge); nudge = 0; }
  function maybeNudge() {
    const pad = margin(), room = sheetH * view.k + pad * 2 - frame.h;
    if (!beside || !nb.page || room <= 1 || view.y < pad || nudged.has(nb.page.id) || reducedMotion()) return;
    nudged.add(nb.page.id);
    const depth = Math.min(56, room), t0 = performance.now() + 450, dur = 900;
    const frameStep = now => {
      const t = (now - t0) / dur;
      if (t >= 1) { setView({ ...view, y: pad }); nudge = 0; return; }
      if (t > 0) setView({ ...view, y: pad - depth * Math.sin(Math.PI * t) });
      nudge = requestAnimationFrame(frameStep);
    };
    stopNudge();
    nudge = requestAnimationFrame(frameStep);
  }

  // ---------- drawing the pages ----------
  // A side's own bitmap, in page units.
  const ctxOf = s => { const x = s.base.getContext('2d'); x.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); return x; };
  // A canvas the size of the desk, in the page units of a side, as the view shows it.
  const onView = (c, i) => {
    const a = dpr * view.k * scale;
    c.setTransform(a, 0, 0, a, dpr * (view.x + i * sheetW * view.k), dpr * view.y);
  };
  const clipPage = c => { c.beginPath(); c.rect(0, 0, PAGE_W, PAGE_H); c.clip(); };
  // The title: the first tag's name, "+ N more" when there are several; none on a free page.
  function headerText(page) {
    const title = titleOf(page.tags ?? [], known);
    const card = title && state.byId.get(title.first);
    const more = title?.more ? t('notes.moreTags', { n: title.more }) : null;
    const name = card && (more ? { en: `${card.name.en} ${more.en}`, zh: `${card.name.zh || card.name.en} ${more.zh}` } : card.name);
    return { date: inLang(dateText(page.header.date, { year: 'numeric', month: 'long', day: 'numeric' })), name: inLang(name), stamp: inLang(t('notes.observed')) };
  }
  function renderSide(c, s) {
    renderPage(c, s.page, { assets: nb.assets, headerText: headerText(s.page), skip: drag?.side === s.i ? drag.index : -1 });
  }
  function paintDetail() {
    const on = view.k > 1.001 && !gest && !swipe?.panned;
    detail.hidden = !on;
    if (!on) return;
    const c = detail.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, detail.width, detail.height);
    for (const s of open()) {
      if (!s.page) continue;
      c.save();
      onView(c, s.i);
      clipPage(c);
      renderSide(c, s);
      c.restore();
    }
  }
  // Every page open, from its data.
  function redraw() {
    for (const s of open()) {
      if (!s.page) continue;
      const c = ctxOf(s);
      c.clearRect(0, 0, PAGE_W, PAGE_H);
      renderSide(c, s);
    }
    paintDetail();
    clearLive();
    if (drag) renderItem(liveCtx(drag.side), sides[drag.side].page.items[drag.index], nb.assets);
    if (stroke?.item) renderItem(liveCtx(stroke.side), stroke.item, nb.assets);
    drawSelection();
  }
  // Rubbing out goes by the frame, however many marks one move takes off.
  let redrawFrame = 0;
  function redrawSoon() { redrawFrame ||= requestAnimationFrame(() => { redrawFrame = 0; redraw(); }); }
  // A new item on top: on the bitmaps as they are, with no redrawing of the rest.
  function addToPage(s, item) {
    appendItem(ctxOf(s), item, nb.assets);
    if (detail.hidden) return;
    const c = detail.getContext('2d');
    c.save();
    onView(c, s.i);
    clipPage(c);
    appendItem(c, item, nb.assets);
    c.restore();
  }
  // The live layer is the size of the desk; a mark being made stays on its own page.
  let clipped = false;
  function clearLive() {
    const c = live.getContext('2d');
    if (clipped) { c.restore(); clipped = false; }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, live.width, live.height);
  }
  function liveCtx(i) {
    const c = live.getContext('2d');
    if (clipped) c.restore();
    c.save();
    clipped = true;
    onView(c, i);
    clipPage(c);
    return c;
  }

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
  function setPane(name) {
    nb.view = name;
    el.dataset.view = name;
    contentsBox.hidden = name !== 'contents';
    if (name === 'contents') closePicker();
  }
  // A page not saved yet in a slot with nothing in it. On the right it dates from just after the
  // left, so the two keep their places in the list.
  function blankSlot(i) {
    const page = notes.blankPage({ tags: nb.scope?.kind === 'animal' ? [nb.scope.id] : [] });
    if (i) page.createdAt = new Date(Date.parse(page.createdAt) + i).toISOString();
    return page;
  }
  async function loadSlot(id) {
    const page = await notes.loadPage(id);
    if (page) return page;
    // The file is missing (e.g. storage was cleared): show a blank page in its place.
    const rec = state.notes.find(r => r.pageId === id);
    return { ...notes.blankPage({ tags: rec?.tags ?? [] }), id, createdAt: rec?.createdAt, header: { date: rec?.createdAt ?? new Date().toISOString() } };
  }
  function clearSides() { for (const s of sides) { s.page = null; s.draft = false; s.dirty = false; mount(s.tagsBox); } }
  let showing = 0;
  async function show(pos, dir = 0) {
    const mine = ++showing;
    await flushSave();
    nb.ids = listIds();
    if (!nb.ids.length && nb.scope?.kind !== 'animal') { await openContents(); return; }
    const { start, at, slots } = slotsFor(nb.ids, pos, nb.spread);
    const loaded = await Promise.all(slots.map((id, i) => (id ? loadSlot(id) : blankSlot(i))));
    if (mine !== showing) return;
    setPane('pages');
    clearSides();
    slots.forEach((id, i) => { sides[i].page = loaded[i]; sides[i].draft = !id; });
    nb.pos = start;
    nb.active = at;
    nb.undo = []; nb.redo = []; nb.selected = -1;
    for (const s of open()) { drawTags(s); loadAssets(s.page); }
    drawBar();
    drawTools();
    stopNudge();
    resetView();
    redraw();
    maybeNudge();
    if (dir && !reducedMotion()) {
      for (const s of open()) for (const box of [s.sheet, s.overlay]) box.animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  }
  const step = () => (nb.spread ? 2 : 1);
  const canTurn = d => nb.pos + d * step() >= 0 && nb.pos + d * step() < nb.ids.length;
  const turn = d => { if (nb.view === 'pages' && canTurn(d)) { haptic(8); show(nb.pos + d * step(), d); } };
  // ＋: a new page tagged with the animal whose pages these are (on the free pages: a free page).
  async function newPage(scope = nb.scope) {
    await flushSave();
    // An empty new page is already showing.
    const blank = scope === nb.scope && nb.view === 'pages' && open().find(s => s.draft);
    if (blank) { setActive(blank); return; }
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
    const pages = nb.view === 'pages', n = nb.ids.length;
    counter.textContent = !pages ? '' : n ? `${nb.pos + 1} / ${n}` : '1 / 1';
    prev.disabled = !pages || !canTurn(-1);
    next.disabled = !pages || !canTurn(1);
    const home = nb.home && state.byId.get(nb.home);
    filterChip.hidden = !pages && !home;
    mount(filterChip, pages ? tx('notes.allPages') : home ? tx('notes.backTo', { name: home.name }) : null);
    deskWrap.style.setProperty('--nb-place', String(n > 1 ? nb.pos / (n - 1) : 0));
    ribbon.setAttribute('aria-label', label('notes.ribbon', { n: Math.min(nb.pos + 1, Math.max(n, 1)), total: Math.max(n, 1) }));
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
    nb.selected = -1;
    drawSelection();
    if (id === 'stamp' && !nb.stampCard) openStampPicker();
    drawTools();
  }
  async function setInput(mode) {
    await updateProfile(state.profile.id, { notesInput: mode });
    drawTools();
  }

  // ---------- history ----------
  // One list for both pages of a spread, in the order things were done. Each op says which side
  // it is on. Ops: add { index, item }, remove { entries: [{ index, item }] }, change { index,
  // before, after }, tags (only the tags). Any op may also carry tags: { before, after } (a stamp
  // adds its animal).
  function apply(op, back) {
    const page = sides[op.side].page, items = page.items;
    if (op.kind === 'add') { if (back) items.splice(op.index, 1); else items.splice(op.index, 0, op.item); }
    else if (op.kind === 'remove') {
      if (back) [...op.entries].sort((a, b) => a.index - b.index).forEach(e => items.splice(e.index, 0, e.item));
      else [...op.entries].sort((a, b) => b.index - a.index).forEach(e => items.splice(e.index, 1));
    } else if (op.kind === 'change') items[op.index] = structuredClone(back ? op.before : op.after);
    if (op.tags) { page.tags = [...(back ? op.tags.before : op.tags.after)]; nb.tagsChanged = true; }
  }
  // A plain new item goes on top of what is drawn. Anything else redraws.
  const onTop = op => (op.kind === 'add' && !op.tags ? op.item : null);
  function commit(op) {
    op.side ??= nb.active;
    apply(op, false);
    nb.undo.push(op);
    nb.redo = [];
    touched(sides[op.side], onTop(op));
  }
  function undo() { const op = nb.undo.pop(); if (!op) return; apply(op, true); nb.redo.push(op); nb.selected = -1; touched(sides[op.side]); }
  function redo() { const op = nb.redo.pop(); if (!op) return; apply(op, false); nb.undo.push(op); nb.selected = -1; touched(sides[op.side], onTop(op)); }
  // After any change: draw it and save soon (a draft page is saved for the first time). A tag
  // change is saved straight away, since it moves the page in or out of the list in view.
  function touched(s, added = null) {
    if (nb.selected >= (nb.page?.items.length ?? 0)) nb.selected = -1;
    s.dirty = true;
    if (added) { clearLive(); addToPage(s, added); drawSelection(); } else redraw();
    drawTools();
    clearTimeout(nb.saveTimer);
    if (nb.tagsChanged) { nb.tagsChanged = false; drawTags(s); afterTags(s); return; }
    nb.saveTimer = setTimeout(() => flushSave(), 400);
  }
  async function flushSave() {
    clearTimeout(nb.saveTimer);
    nb.saveTimer = 0;
    // A first mark on the right of two blank pages keeps the left one, as in a paper notebook.
    if (sides[1].dirty && sides[1].draft && sides[0].draft) sides[0].dirty = true;
    let first = false;
    for (const s of sides) {
      if (!s.page || !s.dirty) continue;
      s.dirty = false;
      await notes.savePage(s.page);
      if (s.draft) { s.draft = false; first = true; }
    }
    if (first) { nb.ids = listIds(); nb.pos = Math.max(0, nb.ids.indexOf(sides[0].page?.id)); drawBar(); }
  }
  // The page left the list in view (its animal's tag removed, a free page tagged): the page tabs
  // now go through the list it is in, its first animal's or the free pages.
  async function afterTags(s) {
    await flushSave();
    const tags = (s.page.tags ?? []).filter(known);
    const inScope = nb.scope?.kind === 'animal' ? tags.includes(nb.scope.id) : !tags.length;
    if (!inScope) nb.scope = tags.length ? { kind: 'animal', id: tags[0] } : { kind: 'free' };
    nb.ids = listIds();
    nb.pos = Math.max(0, nb.ids.indexOf(s.page.id) - s.i);
    drawBar();
  }
  function setTags(s, after) {
    const before = [...(s.page.tags ?? [])];
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    commit({ kind: 'tags', side: s.i, tags: { before, after } });
  }

  // ---------- tag chips ----------
  // One chip per animal (its name and ✕), and "＋" for another collected animal.
  function drawTags(s) {
    if (!s.page) { mount(s.tagsBox); return; }
    const chips = (s.page.tags ?? []).filter(known).map(id => {
      const card = state.byId.get(id);
      return h('span', { class: 'nb-tag' },
        h('span', { class: 'nb-tag__name' }, bi(card.name)),
        h('button', { class: 'nb-tag__x', type: 'button', 'aria-label': label('notes.removeTag', { name: card.name }), onclick: () => setTags(s, withoutTag(s.page.tags, id)) },
          h('span', { 'aria-hidden': 'true' }, '✕')));
    });
    mount(s.tagsBox, chips, h('button', { class: 'nb-tag nb-tag--add', type: 'button', 'aria-label': label('notes.addTag'), onclick: () => openTagPicker(s) },
      h('span', { 'aria-hidden': 'true' }, '＋')));
  }

  // ---------- pointers ----------
  const fromFrame = (e, i) => [((e.clientX - rect.left - view.x) / view.k - i * sheetW) / scale, (e.clientY - rect.top - view.y) / view.k / scale];
  const pressureOf = e => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  const palm = e => e.pointerType === 'touch' && (e.width > 60 || e.height > 60);
  let stroke = null;   // the mark being made, or a press that may be a tap: { id, side, t0, x, y, travel, item | tap }
  let erasing = null;  // { id, side, t0, entries } removed so far
  let drag = null;     // moving an item: { id, side, index, before, from, mode, t0 }
  let swipe = null;    // one finger not drawing: { id, x, y, t0, start, axis, panned }
  let gest = null;     // two fingers: zoom and pan, or resizing the selected item
  let gestFrame = 0;
  const touches = new Map();
  let penDown = false;

  // Should this pointer draw? Pens and mice always; fingers only in finger mode, and never
  // while a pen is on the page.
  function draws(e) {
    return e.pointerType !== 'touch' || !(penDown || input() === 'pen');
  }

  async function firstPen() {
    if (state.profile.notesPenSeen) return;
    await updateProfile(state.profile.id, { notesPenSeen: true, notesInput: 'pen' });
    drawTools();
    toast(tx('notes.penFound'));
  }

  // The side under a press, or null on the kraft around the book.
  function sideAt(e) {
    const x = (e.clientX - rect.left - view.x) / view.k, y = (e.clientY - rect.top - view.y) / view.k;
    if (x < 0 || y < 0 || y > sheetH) return null;
    const s = open()[Math.floor(x / sheetW)];
    return s?.page ? s : null;
  }
  // The page being worked on is the one last touched.
  function setActive(s) {
    if (s.i === nb.active) return;
    nb.selected = -1;
    drawSelection();
    nb.active = s.i;
  }
  const itemAt = (s, x, y) => hitItem(ctxOf(s), s.page, x, y, 10, { movable: true });
  // The handles appear under the finger: the click ending this very tap (or a quick second tap
  // on a small item) must not land on ✕.
  let selectedAt = 0;
  function select(i) { nb.selected = i; selectedAt = performance.now(); drawSelection(); }
  // A tap on a photo, stamp or text.
  function tapSelect(s, x, y) {
    const i = itemAt(s, x, y);
    if (i < 0) return false;
    setActive(s);
    haptic(4);
    select(i);
    return true;
  }

  function down(e) {
    if (nb.view !== 'pages' || e.target.closest('button, textarea') || (e.pointerType === 'mouse' && e.button)) return;
    stopNudge();
    rect = desk.getBoundingClientRect();
    if (e.pointerType === 'pen') { penDown = true; firstPen(); }
    if (e.pointerType === 'touch') {
      if (palm(e)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) secondFinger();
      if (touches.size > 1) return;
    }
    try { desk.setPointerCapture(e.pointerId); } catch { /* gone */ }
    const s = sideAt(e);
    if (!s || !draws(e)) { startSwipe(e); return; }
    setActive(s);
    const [x, y] = fromFrame(e, s.i), now = performance.now();
    if (nb.selected >= 0 && itemAt(s, x, y) === nb.selected) {
      drag = { id: e.pointerId, side: s.i, index: nb.selected, before: structuredClone(s.page.items[nb.selected]), from: [x, y], mode: 'move', t0: now };
      redraw();
      return;
    }
    const press = { id: e.pointerId, side: s.i, t0: now, x: e.clientX, y: e.clientY, travel: 0 };
    if (nb.tool === 'pencil') {
      stroke = { ...press, item: { t: 's', c: pencilColour(nb.colour), w: SIZES[nb.size], p: [x, y, pressureOf(e)] } };
      drawStroke(liveCtx(s.i), stroke.item);
    } else if (nb.tool === 'roller') {
      stroke = { ...press, item: { t: 'f', c: pencilColour(nb.colour), k: nb.foot, p: [x, y] } };
    } else if (nb.tool === 'eraser') {
      select(-1);
      erasing = { id: e.pointerId, side: s.i, t0: now, entries: [] };
      eraseAt(x, y);
    } else {
      stroke = { ...press, tap: [x, y] };
    }
  }

  function move(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Fingers report one at a time: read them together, once a frame, or the first to report
    // looks like a change in their distance.
    if (gest) { gestFrame ||= requestAnimationFrame(moveGesture); return; }
    if (swipe?.id === e.pointerId) { moveSwipe(e); return; }
    const events = e.getCoalescedEvents?.() ?? [];
    const points = events.length ? events : [e];
    if (stroke?.id === e.pointerId) {
      stroke.travel = Math.max(stroke.travel, Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y));
      const item = stroke.item, i = stroke.side;
      if (item?.t === 's') {
        const from = item.p.length;
        for (const ev of points) { const [x, y] = fromFrame(ev, i); item.p.push(x, y, pressureOf(ev)); }
        drawStroke(liveCtx(i), item, from);
      } else if (item?.t === 'f') {
        const [x, y] = fromFrame(e, i), p = item.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > 6) {
          p.push(x, y);
          clearLive(); renderItem(liveCtx(i), item, nb.assets);
        }
      }
    } else if (erasing?.id === e.pointerId) {
      for (const ev of points) eraseAt(...fromFrame(ev, erasing.side));
    } else if (drag?.id === e.pointerId) {
      transformDrag(...fromFrame(e, drag.side));
    }
  }

  function up(e) {
    // Fingers can lift before the frame that would have read their last move.
    if (gestFrame) { cancelAnimationFrame(gestFrame); moveGesture(); }
    touches.delete(e.pointerId);
    if (e.pointerType === 'pen') penDown = false;
    if (gest) { if (touches.size < 2) endGesture(); return; }
    if (swipe?.id === e.pointerId) { endSwipe(e); return; }
    if (stroke?.id === e.pointerId) { endStroke(); return; }
    if (erasing?.id === e.pointerId) { endErase(); return; }
    if (drag?.id === e.pointerId) endDrag();
  }

  function cancelled(e) {
    touches.delete(e.pointerId);
    if (e.pointerType === 'pen') penDown = false;
    if (gest && touches.size < 2) { if (gest.item) endDrag(); gest = null; delete desk.dataset.gesture; settle(); }
    if (swipe?.id === e.pointerId) { swipe = null; settle(); }
    if (stroke?.id === e.pointerId || drag?.id === e.pointerId) dropPress();
    if (erasing?.id === e.pointerId) endErase();
  }

  function endStroke() {
    const s = stroke; stroke = null;
    const side = sides[s.side], tap = isTap(s.travel, performance.now() - s.t0), had = nb.selected >= 0;
    clearLive();
    if (s.tap) {
      if (had) select(-1);
      else if (nb.tool === 'text') editText(side, ...s.tap);
      else if (nb.tool === 'stamp') placeStamp(side, ...s.tap);
      return;
    }
    if (tap && tapSelect(side, s.item.p[0], s.item.p[1])) return;
    if (had) select(-1);
    if (tap && had) return; // the tap let go of the selection: no dot
    if (s.item.t === 's' || s.item.p.length >= 4) commit({ kind: 'add', side: s.side, index: side.page.items.length, item: s.item });
  }

  // What the first finger was doing, undone: a second one has made this a gesture.
  function dropPress() {
    if (stroke) { stroke = null; clearLive(); }
    if (erasing) {
      const { side, entries } = erasing; erasing = null;
      if (entries.length) { apply({ kind: 'remove', side, entries }, true); redraw(); }
    }
    if (drag) {
      const d = drag; drag = null;
      sides[d.side].page.items[d.index] = d.before;
      redraw();
    }
  }
  function secondFinger() {
    const press = stroke ?? erasing ?? drag;
    if (press && !secondFingerCounts(performance.now() - press.t0)) return; // a brush of the hand
    dropPress();
    swipe = null;
    startGesture();
  }

  // Whole marks: anything the eraser touches goes, in one undo step per rub.
  function eraseAt(x, y) {
    const s = sides[erasing.side];
    const i = hitItem(ctxOf(s), s.page, x, y, ERASE_R);
    if (i < 0) return;
    // Its index in the page as it was before this rub started, for undo.
    const item = s.page.items[i];
    let orig = i;
    for (const en of [...erasing.entries].sort((a, b) => a.index - b.index)) if (en.index <= orig) orig++;
    erasing.entries.push({ index: orig, item });
    s.page.items.splice(i, 1);
    haptic(4);
    redrawSoon();
  }
  function endErase() {
    const { side, entries } = erasing; erasing = null;
    // The marks are already gone from the page; record them so undo brings them back.
    if (entries.length) { nb.undo.push({ kind: 'remove', side, entries }); nb.redo = []; touched(sides[side]); }
  }

  // ---------- two fingers: zoom and pan; or resize & turn a selected item ----------
  const pts = () => [...touches.values()];
  const dist = () => { const [a, b] = pts(); return Math.hypot(a.x - b.x, a.y - b.y); };
  const angle = () => { const [a, b] = pts(); return Math.atan2(b.y - a.y, b.x - a.x); };
  const mid = () => { const [a, b] = pts(); return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }; };
  function startGesture() {
    stopNudge();
    clearTimeout(settleTimer);
    const m = mid(), s = sides[nb.active];
    if (nb.selected >= 0 && itemAt(s, ...fromFrame({ clientX: m.x + rect.left, clientY: m.y + rect.top }, s.i)) === nb.selected) {
      const before = structuredClone(s.page.items[nb.selected]);
      gest = { item: true, d0: dist(), a0: angle(), before };
      drag = { id: -1, side: s.i, index: nb.selected, before, mode: 'pinch', t0: 0 };
      redraw();
      return;
    }
    gest = { d0: dist(), from: m, to: m, start: view, peak: 0 };
    desk.dataset.gesture = '';
    detail.hidden = true; // the page itself moves now, a little soft until the fingers lift
  }
  function moveGesture() {
    gestFrame = 0;
    if (!gest || touches.size < 2) return;
    const ratio = dist() / gest.d0;
    if (gest.item) {
      const it = sides[drag.side].page.items[drag.index], b = gest.before;
      resizeItem(it, b, clamp(ratio, 0.2, 5));
      if (it.t !== 'x') it.r = (b.r ?? 0) + angle() - gest.a0;
      clearLive(); renderItem(liveCtx(drag.side), it, nb.assets); drawSelection();
      return;
    }
    gest.to = mid();
    gest.peak = Math.max(gest.peak, Math.abs(ratio - 1));
    view = pinchView(gest.start, gest.from, gest.to, ratio, frame, bookSize(), margin());
    place();
  }
  function endGesture() {
    const g = gest; gest = null;
    delete desk.dataset.gesture;
    if (g.item) { endDrag(); return; }
    const dir = swipeTurn({ dx: g.to.x - g.from.x, dy: g.to.y - g.from.y, span: g.d0, peak: g.peak, zoom: g.start.k });
    settle();
    if (dir) turn(dir);
  }

  // ---------- one finger not drawing ----------
  // On the kraft, or anywhere when only a pen draws: sideways turns the page; up and down pans a
  // page taller than the panel, and zoomed in it pans any way.
  function startSwipe(e) { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), start: view, axis: null, panned: false }; }
  function moveSwipe(e) {
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.axis && Math.hypot(dx, dy) > 8) swipe.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (!swipe.axis) return;
    const zoomed = view.k > 1;
    if (!zoomed && swipe.axis !== 'y') return;
    swipe.panned = true;
    detail.hidden = true;
    setView({ ...swipe.start, x: swipe.start.x + (zoomed ? dx : 0), y: swipe.start.y + dy });
  }
  function endSwipe(e) {
    const sw = swipe; swipe = null;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (sw.panned) { settle(); return; }
    if (isTap(Math.hypot(dx, dy), performance.now() - sw.t0)) {
      const s = sideAt(e);
      if (s && !tapSelect(s, ...fromFrame(e, s.i)) && nb.selected >= 0) select(-1);
      return;
    }
    if (sw.axis !== 'y' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) turn(dx < 0 ? 1 : -1);
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
    const s = sides[drag.side], it = s.page.items[drag.index], b = drag.before;
    if (drag.mode === 'move') { it.x = b.x + x - drag.from[0]; it.y = b.y + y - drag.from[1]; }
    else {
      const box = boundsOf(ctxOf(s), b);
      if (drag.mode === 'resize') {
        const k = Math.hypot(x - box.cx, y - box.cy) / Math.max(1, Math.hypot(drag.from[0] - box.cx, drag.from[1] - box.cy));
        resizeItem(it, b, Math.max(0.2, Math.min(5, k)));
      } else if (drag.mode === 'rotate') {
        it.r = (b.r ?? 0) + Math.atan2(y - box.cy, x - box.cx) - Math.atan2(drag.from[1] - box.cy, drag.from[0] - box.cx);
      }
    }
    clearLive(); renderItem(liveCtx(drag.side), it, nb.assets); drawSelection();
  }
  function endDrag() {
    const d = drag; drag = null;
    const items = sides[d.side].page.items;
    const after = structuredClone(items[d.index]);
    if (JSON.stringify(after) === JSON.stringify(d.before)) { redraw(); return; }
    items[d.index] = d.before;
    commit({ kind: 'change', side: d.side, index: d.index, before: d.before, after });
  }
  // The selection box, with a handle to resize, one to turn and a delete button. Kept while it
  // moves: a handle being dragged must stay the same element.
  let selBox = null;
  function makeSelBox() {
    const box = h('div', { class: 'nb-sel' });
    const handle = (mode, cls, glyph, key) => {
      const el2 = h('button', { type: 'button', class: ['nb-sel__h', cls], 'aria-label': label(key) }, glyph);
      el2.addEventListener('pointerdown', e => {
        e.stopPropagation();
        rect = desk.getBoundingClientRect();
        try { el2.setPointerCapture(e.pointerId); } catch { /* gone */ }
        const s = sides[nb.active];
        drag = { id: e.pointerId, side: s.i, index: nb.selected, before: structuredClone(s.page.items[nb.selected]), from: fromFrame(e, s.i), mode, t0: 0 };
        redraw();
      });
      el2.addEventListener('pointermove', e => { if (drag?.id === e.pointerId) transformDrag(...fromFrame(e, drag.side)); });
      el2.addEventListener('pointerup', e => { if (drag?.id === e.pointerId) endDrag(); });
      return el2;
    };
    const del = h('button', {
      type: 'button', class: 'nb-sel__h nb-sel__del', 'aria-label': label('notes.delete'),
      onclick: () => {
        if (performance.now() - selectedAt < SETTLE_MS) return;
        const i = nb.selected;
        nb.selected = -1;
        commit({ kind: 'remove', entries: [{ index: i, item: nb.page.items[i] }] });
      },
    }, '✕');
    box.append(handle('resize', 'nb-sel__resize', '⤡', 'notes.resize'), handle('rotate', 'nb-sel__rotate', '⟳', 'notes.rotate'), del);
    return box;
  }
  function drawSelection() {
    const s = sides[nb.active], item = nb.selected >= 0 ? s.page?.items[nb.selected] : null;
    if (!item) { selBox?.remove(); selBox = null; return; }
    selBox ??= makeSelBox();
    if (selBox.parentNode !== s.selLayer) s.selLayer.append(selBox);
    const b = boundsOf(ctxOf(s), item);
    selBox.style.setProperty('left', `${(b.cx - b.w / 2) * scale}px`);
    selBox.style.setProperty('top', `${(b.cy - b.h / 2) * scale}px`);
    selBox.style.setProperty('width', `${b.w * scale}px`);
    selBox.style.setProperty('height', `${b.h * scale}px`);
    selBox.style.setProperty('transform', `rotate(${b.r}rad)`);
  }

  // ---------- text ----------
  function editText(s, x, y) {
    const hit = hitItem(ctxOf(s), s.page, x, y, 6, { movable: true });
    const existing = hit >= 0 && s.page.items[hit].t === 'x' ? hit : -1;
    const item = existing >= 0 ? s.page.items[existing] : { t: 'x', c: pencilColour(nb.colour), s: TEXT_SIZE, x, y, v: '' };
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
        if (!v) commit({ kind: 'remove', side: s.i, entries: [{ index: existing, item }] });
        else if (v !== item.v) commit({ kind: 'change', side: s.i, index: existing, before: item, after: { ...item, v } });
      } else if (v) commit({ kind: 'add', side: s.i, index: s.page.items.length, item: { ...item, v } });
    };
    area.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    });
    area.addEventListener('blur', () => finish(true));
    s.selLayer.append(area);
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
  function openTagPicker(s) {
    const tags = s.page?.tags ?? [];
    pickAnimal({ icon: '🏷️', titleKey: 'notes.pickTag', emptyKey: 'notes.noTags', cards: state.cards.filter(c => isCollected(c) && !tags.includes(c.id)),
      onPick: card => setTags(s, withTag(s.page.tags ?? [], card.id)) });
  }
  // A stamp also tags the page with its animal (once); erasing the stamp leaves the tag.
  function placeStamp(s, x, y) {
    if (!nb.stampCard) { openStampPicker(); return; }
    stampAsset(nb.stampCard);
    haptic(12);
    const before = [...(s.page.tags ?? [])], after = tagsAfterStamp(before, nb.stampCard);
    commit({
      kind: 'add', side: s.i, index: s.page.items.length, item: { t: 'm', c: pencilColour(nb.colour), card: nb.stampCard, x, y, s: STAMP_SIZE, r: 0 },
      ...(after.length !== before.length && { tags: { before, after } }),
    });
  }

  // ---------- contents ----------
  // Binder groups with the animals that have pages (count, latest page), each page listed
  // under every animal it is tagged with ("also in" the others); then the free pages.
  async function openContents() {
    showing++;
    await flushSave();
    setPane('contents');
    clearSides();
    drawSelection();
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
      !beside && !filterChip.hidden && filterChip, // beside a card it is in the bar
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
      const r = canvas.getBoundingClientRect(), k = pixelRatio(window.devicePixelRatio);
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
      select(nb.page.items.length - 1);
    } catch (err) {
      console.error(err);
      toast(tx('notes.photoFailed'));
    }
  }

  // ---------- menu: paper, export, import, delete ----------
  function openMenu() {
    const onPage = nb.view === 'pages' && nb.page, s = sides[nb.active];
    const item = (icon, key, fn, cls = 'btn--soft') => h('button', { class: ['btn', cls], type: 'button', onclick: async () => { menuSheet.close(); await fn(); } },
      h('span', { 'aria-hidden': 'true' }, icon), tx(key));
    // In a spread: which of the two pages the page's actions are for.
    const sidePick = onPage && nb.spread && h('div', { class: 'nb-menu__sides', role: 'group' }, [['notes.leftPage', 0], ['notes.rightPage', 1]].map(([key, i]) => h('button', {
      class: ['btn', i === nb.active ? 'btn--primary' : 'btn--soft'], type: 'button', 'aria-pressed': String(i === nb.active),
      onclick: () => { setActive(sides[i]); openMenu(); },
    }, tx(key))));
    mount(menuSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '📓'), tx('notes.title')),
      h('div', { class: 'nb-menu__list' },
        !beside && onPage && item('📑', 'notes.allPages', () => openContents()),
        sidePick,
        onPage && item(s.page.paper === 'grid' ? '⠿' : '▦', s.page.paper === 'grid' ? 'notes.paperDots' : 'notes.paperGrid', async () => {
          s.page.paper = s.page.paper === 'grid' ? 'dots' : 'grid'; s.dirty = true; await flushSave(); redraw();
        }),
        onPage && item('🖼️', 'notes.exportPage', () => exportPageImage(s.page, { assets: nb.assets, headerText: headerText(s.page) }).catch(() => toast(tx('notes.exportFailed')))),
        item('📦', 'notes.exportAll', async () => { await flushSave(); await exportAll().catch(() => toast(tx('notes.exportFailed'))); }),
        folderSupported() && item('📁', 'notes.toFolder', async () => { await flushSave(); await saveToFolder().catch(() => {}); }),
        item('📥', 'notes.import', () => importInput.click()),
        onPage && !s.draft && item('🗑️', 'notes.deletePage', async () => {
          if (!window.confirm(label('notes.deleteConfirm'))) return;
          await notes.deletePage(s.page.id);
          s.page = null; s.dirty = false;
          await show(nb.pos + s.i);
        }, 'btn--danger')),
      h('p', { class: 'muted' }, tx('notes.backupNote')),
      h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: () => menuSheet.close() }, tx('card.close'))));
    if (!menuSheet.open) menuSheet.showModal();
  }
  async function doImport(file) {
    importInput.value = '';
    if (!file) return;
    try {
      const n = await importBackup(file);
      toast(tx(n === 1 ? 'notes.imported.one' : 'notes.imported.many', { n }));
      if (nb.view === 'contents') await openContents(); else await show(nb.pos + nb.active);
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
  desk.addEventListener('pointerdown', down);
  desk.addEventListener('pointermove', move);
  desk.addEventListener('pointerup', up);
  desk.addEventListener('pointercancel', cancelled);
  // The wheel pans, ctrl + wheel (a trackpad's pinch too) zooms: a mouse has no second finger.
  desk.addEventListener('wheel', e => {
    if (nb.view !== 'pages') return;
    e.preventDefault();
    stopNudge();
    rect = desk.getBoundingClientRect();
    detail.hidden = true;
    if (e.ctrlKey || e.metaKey) {
      const m = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      view = pinchView(view, m, m, Math.exp(-e.deltaY * 0.002), frame, bookSize(), margin());
      place();
    } else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 120);
  }, { passive: false });
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
  const ro = new ResizeObserver(() => layout());
  ro.observe(el);
  ro.observe(desk);

  drawTools();
  queueMicrotask(async () => {
    layout();
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
    where: () => ({ view: nb.view, scope: nb.scope, pageId: nb.view === 'pages' ? [sides[nb.active], sides[0]].find(s => s.page && !s.draft)?.page.id ?? null : null }),
    async destroy() {
      ro.disconnect();
      toolsRo.disconnect();
      closePicker();
      stopNudge();
      clearTimeout(settleTimer);
      cancelAnimationFrame(redrawFrame);
      cancelAnimationFrame(gestFrame);
      document.removeEventListener('keydown', onKey, true);
      await flushSave();
      for (const bmp of nb.assets.photos.values()) bmp?.close?.();
    },
  };
}
