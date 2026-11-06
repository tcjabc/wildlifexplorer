// Field Notes: a researcher's notebook. Kraft cover, dotted (or grid) paper. Tools: pencil and pen
// (pressure), highlighter (multiplied onto the page), ruler, eraser (whole lines), text, creature
// stamps, footprint roller, taped-in photos, undo and redo.
//
// On its own (#/notes) the notebook fills the screen: no app header, one back button, rails at the
// left and right (bands above and below the page in portrait), a ribbon marking the place, and
// tabs to turn pages. Landscape lies open at a two-page spread, portrait shows one page; both pages
// of a spread are live. Beside a card it stays a panel: one page, with its bar and toolbar on top,
// sharing the rails' tool settings (js/notes-tools.js).
//
// The rails hold real objects (js/notes-rails.js). Left: a pen pouch; the tool in use stands raised
// out of it, and tapping it again opens its colours and thickness. Right: the ink pad, the sponge
// (rubs stamps, trails and text off the page, nothing else), three stamps: ABC (text), the panda
// (a collected animal: a tap moves to the next, a long press lists them) and the footprints, and
// the tweezers.
//
// The ruler lies on the book, not on a page, and is never saved. One finger moves it (pulled from
// the pouch, or tap it there), two fingers both on it turn it; a line started beside an edge follows
// that edge. A pen never moves it, and neither does anything else while a pen is down.
//
// One finger draws. Two fingers pan and pinch-zoom; a clear sideways two-finger swipe at the
// fitted size turns the page (js/notes-view.js has the rules). During a gesture the page moves
// by CSS transform; when it ends, a canvas the size of the screen redraws what is in view
// sharply, so zooming in never needs a bigger page bitmap. The wheel pans, ctrl + wheel zooms.
//
// The tweezers pick up a photo, stamp, footprint trail or text: press it to select it and drag it
// straight away, use the handles, or pinch on it to resize and turn it. A tap elsewhere lets go.
// They never touch lines, and never turn the page. With a stamp in the hand a tap on something
// selects it too, a tap on bare paper stamps, and with ABC a tap on text edits it. With a pencil,
// pen or highlighter a tap on something is a dot like any other.
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
// notebook({ cardId, beside, lead, start, onBack, onFull }):
//   cardId: open on that animal's pages (its most recently edited one; a draft page tagged
//           with it when it has none, saved at its first mark). "All pages" shows the
//           contents, and from there "‹ <animal>" comes back. Without a card: the contents.
//   beside: the notebook is open next to a card. The page then fills the panel's width and
//           pans up and down when it is taller
//   lead: an element for the start of the bar beside a card (the panel's "Collapse ›")
//   start: { view, scope, pageId } from where(): open there (coming back from the globe, or
//          opening the full notebook from the panel)
//   onBack: leave the notebook (on its own)
//   onFull: open the full notebook (beside a card): the bar's open book button, or a pinch outward
//           from the fitted page. A pinch there never zooms: what it reaches goes back when let go
import { h, mount, reducedMotion } from './dom.js';
import { bi, t, tx, label, getMode, dateText } from './i18n.js';
import { state, updateProfile, isCollected, groupById } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { titleOf, withTag, withoutTag, tagsAfterStamp, freePages, openFor, movedTrail, contents as contentsOf } from './notes-model.js';
import { renderPage, renderItem, appendItem, drawStroke, hitItem, boundsOf, pencilColour, highlightColour } from './notes-render.js';
import { slotsFor, fitScale, clampView, pinchView, settleView, swipeTurn, secondFingerCounts, isTap, pixelRatio, railFit, popPlace, keyboardLift, atFit, pinchOpensFull, fullPageBox } from './notes-view.js';
import { PENCILS, DRAWING, INKED, paletteOf, widthOf, cleanTools, colourOf, sizeOf, withColour, withSize, nextAnimal } from './notes-tools.js';
import { RULER_L, RULER_H, onRuler, edgeAt, snapTo, clampRuler } from './notes-ruler.js';
import { TOOL_ROWS, toolArt, pouchBack, pouchFront, inkPadArt, stampArt, spongeArt, tweezersArt, tokenArt, openBookArt, rulerArt } from './notes-rails.js';
import { thunk } from './fx.js';
import { exportPageImage, exportAll, importBackup, saveToFolder, folderSupported } from './notes-io.js';
import { haptic, clamp } from './gesture.js';

const TOOLS = [
  ['pencil', '✏️'], ['eraser', '🧽'], ['text', '🔤'], ['stamp', '🐾'], ['roller', '👣'],
];
const FEET = [['paw', '🐈'], ['hoof', '🦌'], ['bird', '🐦'], ['bear', '🐻']];
const TEXT_SIZE = 40;
const STAMP_SIZE = 180;
const ERASE_R = 14;
const SPONGE_R = 24;   // a sponge is wider than an eraser
const WIPE_MS = 220;   // a stamp wiped off the page
const GROW_MS = 260;   // the panel growing to the screen (--t-med)
const GROW_HOLD_MS = 120; // the kraft stays while the full notebook draws under it
const GROW_FADE_MS = 160;
const UNZOOM_MS = 140; // a pinch that didn't reach the full notebook going back
const SETTLE_MS = 400; // after selecting, before ✕ counts
const HOLD_MS = 500;   // a long press on the panda stamp
const RULER_PAD = 24;  // CSS px around the ruler that still count as on it for a second finger

// The card's name and dates in the profile's language, for text drawn on the canvas.
const inLang = pair => {
  if (!pair) return '';
  const m = getMode();
  return m === 'en' ? pair.en || pair.zh : m === 'zh' ? pair.zh || pair.en : [pair.en, pair.zh].filter(Boolean).join('  ');
};

export function notebook({ cardId = null, beside = false, lead = null, start = null, onBack = null, onFull = null } = {}) {
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
    tool: 'pencil', set: cleanTools(state.profile?.notesTools),
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
    onclick: () => setColour(id),
  }));
  const sizeBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.size'), onclick: () => setSize(sizeOf(nb.set, nb.tool) === 'thin' ? 'thick' : 'thin') });
  // On the rails these are wooden tokens; in the panel's toolbar, plain icons.
  const face = (sign, icon) => (beside ? h('span', { 'aria-hidden': 'true' }, icon) : tokenArt(sign));
  const undoBtn = h('button', { type: 'button', class: ['nb-tool', 'nb-undo', !beside && 'nb-token'], 'aria-label': label('notes.undo'), onclick: () => undo() }, face('undo', '↶'));
  const redoBtn = h('button', { type: 'button', class: ['nb-tool', !beside && 'nb-token'], 'aria-label': label('notes.redo'), onclick: () => redo() }, face('redo', '↷'));
  const inputBtn = h('button', { type: 'button', class: ['nb-input', !beside && 'nb-token'], onclick: () => setInput(input() === 'pen' ? 'finger' : 'pen') });
  // The roller's feet open from one button (shown with the roller) in a small picker. Where one
  // row doesn't fit (see layoutTools) the toolbar has two rows of 44 px controls and no room for
  // a row of colours, so they open from a swatch the same way; in one row they sit in it.
  const colourPick = picker('nb-tool--colour', 'notes.colourPick', PENCILS.map(id => h('button', {
    type: 'button', class: 'nb-colour', 'data-colour': id, 'aria-pressed': 'false', 'aria-label': label(`notes.colour.${id}`),
    onclick: () => { closePicker(); setColour(id); },
  })));
  colourPick.box.classList.add('nb-pop--three');
  const footPick = picker('nb-tool--foot', 'notes.footPick', FEET.map(([id, icon]) => h('button', {
    type: 'button', class: 'nb-tool', 'data-foot': id, 'aria-pressed': 'false', 'aria-label': label(`notes.foot.${id}`),
    onclick: () => { closePicker(); setFoot(id); },
  }, h('span', { 'aria-hidden': 'true' }, icon))));
  const tools = beside && h('div', { class: 'nb__tools', role: 'toolbar', 'aria-label': label('notes.tools') },
    toolBtns, photoBtn, h('span', { class: 'nb__break', 'aria-hidden': 'true' }), h('span', { class: 'nb__sep' }),
    colourPick.btn, colourBtns, sizeBtn, footPick.btn,
    h('span', { class: 'nb__sep' }), undoBtn, redoBtn, h('span', { class: 'spacer' }), inputBtn);

  const fullBtn = beside && onFull && h('button', { class: 'btn btn--icon nb__full', type: 'button', 'aria-label': label('notes.openFull'), onclick: () => openFull() }, openBookArt());
  // Beside a card, one row: the lead, the chip, and the page buttons, which stay together. When
  // the row is too narrow it wraps between those groups; the chip never shrinks below its text.
  // The open book keeps the top corner either way.
  const bar = beside && h('header', { class: ['nb__bar', onFull && 'nb__bar--full'] },
    lead,
    h('span', { class: 'nb__chipwrap' }, filterChip),
    h('span', { class: 'nb__pages' }, prev, counter, next, newBtn, menuBtn),
    fullBtn);
  // On its own, the rails. Left: back, the pouch, and at its foot the camera (a Polaroid on the
  // right rail, later), undo, redo and pen / finger. Right: new page, the ink pad, the sponge, the
  // stamps and the tweezers with room for that Polaroid, and the menu.
  const pouchTools = new Map(TOOL_ROWS.map(id => [id, h('button', {
    type: 'button', class: 'nb-pt', 'data-pt': id, 'aria-pressed': 'false', 'aria-label': label(`notes.tool.${id}`), onclick: () => tapPouch(id),
  }, toolArt(id))]));
  const inkBtn = h('button', { type: 'button', class: 'nb-rack nb-rack--ink', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': label('notes.ink'), onclick: () => openInk() }, inkPadArt());
  const stampTag = h('span', { class: 'nb-rack__tag', 'aria-hidden': 'true' });
  const rackBtn = (id, key, art, onclick, ...kids) => h('button', { type: 'button', class: 'nb-rack', 'data-rack': id, 'aria-pressed': 'false', 'aria-label': label(key), onclick }, art, kids);
  const rackBtns = {
    sponge: rackBtn('sponge', 'notes.tool.sponge', spongeArt(), () => setTool('sponge')),
    text: rackBtn('text', 'notes.tool.text', stampArt('text'), () => setTool('text')),
    stamp: rackBtn('stamp', 'notes.tool.stamp', stampArt('stamp'), () => tapPanda(), stampTag),
    roller: rackBtn('roller', 'notes.tool.roller', stampArt('roller'), () => tapFootprints()),
    tweezers: rackBtn('tweezers', 'notes.tool.tweezers', tweezersArt(), () => setTool('tweezers')),
  };
  // Saved first: what is on the page must be there for whatever opens it next.
  const backBtn = !beside && h('button', { class: 'btn btn--icon nb__back', type: 'button', 'aria-label': label('notes.back'), onclick: async () => { await flushSave(); onBack?.(); } }, '‹');
  const railStart = !beside && h('aside', { class: 'nb__rail nb__rail--start' }, backBtn,
    h('div', { class: 'nb__pouch', role: 'group', 'aria-label': label('notes.tools') },
      h('div', { class: 'nb__pouch-in' }, h('div', { class: 'nb__pouch-back' }, pouchBack()), [...pouchTools.values()], h('div', { class: 'nb__pouch-front' }, pouchFront()))),
    h('div', { class: 'nb__railfoot' }, photoBtn, undoBtn, redoBtn, inputBtn));
  const railEnd = !beside && h('aside', { class: 'nb__rail nb__rail--end' }, newBtn,
    h('div', { class: 'nb__rack', role: 'group', 'aria-label': label('notes.stamps') }, inkBtn, Object.values(rackBtns), h('span', { class: 'nb__rack-room', 'aria-hidden': 'true' })),
    menuBtn);
  // The popover for whatever on the rails was tapped; its content changes with that.
  const railPop = { box: h('div', { class: 'nb-pop nb-pop--rail nb-pop--three', role: 'group', hidden: true }), btn: null };

  const el = h('section', { class: ['nb', beside ? 'nb--beside' : 'nb--immersive'], 'aria-label': label('notes.title') },
    bar, beside && tools, railStart, beside && colourPick.box, beside && footPick.box, !beside && railPop.box, deskWrap, contentsBox, railEnd, fileInput, importInput, menuSheet, pickSheet);

  // ---------- toolbar layout ----------
  // One row if all of it fits (measured at its widest, with the roller's footprint button),
  // otherwise two rows with the colours behind a picker. Measured, not a breakpoint: the pen /
  // finger label's width depends on the language.
  let toolbar = '';
  function layoutTools() {
    if (!beside || !el.isConnected || !tools.clientWidth) return;
    el.dataset.toolbar = 'wide';
    el.dataset.measure = '';
    const fits = tools.scrollWidth <= tools.clientWidth + 1;
    delete el.dataset.measure;
    const next = fits ? 'wide' : 'compact';
    el.dataset.toolbar = next;
    if (next !== toolbar) { toolbar = next; closePicker(); }
  }
  const toolsRo = new ResizeObserver(() => layoutTools());
  if (beside) toolsRo.observe(el);

  // ---------- pickers (two-row toolbar, rails) ----------
  // One open at a time, next to its button and on the page's side of a rail; a tap elsewhere, Esc
  // or another tool closes it, and in the two-row toolbar so does a pick.
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
    const start = railStart && railStart.contains(p.btn), land = el.dataset.orient === 'landscape';
    const side = beside ? 'below' : land ? (start ? 'right' : 'left') : start ? 'below' : 'above';
    const anchor = { left: b.left - e.left, right: b.right - e.left, top: b.top - e.top, bottom: b.bottom - e.top };
    const { left, top } = popPlace({ anchor, frame: { w: e.width, h: e.height }, w: p.box.offsetWidth, h: p.box.offsetHeight, side });
    p.box.style.setProperty('left', `${left}px`);
    p.box.style.setProperty('top', `${top}px`);
    p.btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    p.box.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  // A rail's popover for this button, or closed when it is already open.
  function toggleRailPop(btn, key, ...content) {
    if (openPick === railPop && railPop.btn === btn) { closePicker(); return; }
    closePicker();
    railPop.btn = btn;
    railPop.box.setAttribute('aria-label', label(key));
    railPop.box.classList.toggle('nb-pop--feet', key === 'notes.footPick');
    mount(railPop.box, content);
    openPicker(railPop);
  }
  function closePicker() {
    if (!openPick) return;
    openPick.box.hidden = true;
    openPick.btn.setAttribute('aria-expanded', 'false');
    openPick = null;
    popFor = null;
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
    if (document.activeElement?.classList.contains('nb-text')) return; // a keyboard is no rotation
    if (!beside) {
      const land = el.clientWidth > el.clientHeight;
      el.dataset.orient = land ? 'landscape' : 'portrait';
      el.dataset.rails = railFit({ w: el.clientWidth, h: el.clientHeight });
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
    if (ruler) ruler = clampRuler(ruler, bookW(), PAGE_H);
    drawRuler();
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
    drawRuler();
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
    const colour = colourOf(nb.set, nb.tool), size = sizeOf(nb.set, nb.tool);
    toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === nb.tool)));
    // Colour and size buttons say what they say about the tool they belong to: on the rails, the
    // one the popover is open for.
    const shown = popFor ?? nb.tool;
    el.querySelectorAll('button[data-colour], button[data-hl]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.colour ?? b.dataset.hl) === colourOf(nb.set, shown))));
    el.querySelectorAll('button[data-thick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.thick === sizeOf(nb.set, shown))));
    el.querySelectorAll('button[data-foot]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.foot === nb.set.foot)));
    mount(colourPick.btn, h('span', { class: 'nb-swatch', 'data-colour': colour, 'aria-hidden': 'true' }));
    mount(footPick.btn, h('span', { 'aria-hidden': 'true' }, FEET.find(([id]) => id === nb.set.foot)?.[1] ?? ''));
    el.dataset.tool = nb.tool;
    mount(sizeBtn, h('span', { class: ['nb-size', `nb-size--${size}`], 'aria-hidden': 'true' }));
    drawRails();
    undoBtn.disabled = !nb.undo.length;
    redoBtn.disabled = !nb.redo.length;
    const pen = input() === 'pen';
    inputBtn.setAttribute('aria-pressed', String(pen));
    if (beside) mount(inputBtn, h('span', { 'aria-hidden': 'true' }, pen ? '🖊️ ' : '☝️ '), tx(pen ? 'notes.penOnly' : 'notes.finger'));
    else mount(inputBtn, tokenArt(pen ? 'pen' : 'finger'));
    inputBtn.setAttribute('aria-label', label(pen ? 'notes.penOnlyHint' : 'notes.fingerHint'));
    layoutTools();
  }
  // The objects on the rails: the tool in use raised, each tool showing its colour, the ink on the
  // pad and on the stamps' rubber, and the animal on the panda stamp.
  function drawRails() {
    if (beside) return;
    for (const [id, b] of pouchTools) {
      if (id === 'ruler') { b.setAttribute('aria-pressed', String(Boolean(ruler))); b.toggleAttribute('data-out', Boolean(ruler)); continue; }
      b.setAttribute('aria-pressed', String(id === nb.tool));
      b.toggleAttribute('data-raised', id === nb.tool);
      if (DRAWING.includes(id)) b.style.setProperty('--tool-c', colourFor(id));
    }
    el.style.setProperty('--ink-c', pencilColour(nb.set.ink));
    for (const [id, b] of Object.entries(rackBtns)) {
      b.setAttribute('aria-pressed', String(id === nb.tool));
      b.toggleAttribute('data-raised', id === nb.tool);
    }
    const card = state.byId.get(stampNow());
    rackBtns.stamp.setAttribute('aria-label', card ? label('notes.stampOf', { name: card.name }) : label('notes.tool.stamp'));
    if (stampTag.dataset.card === (card?.id ?? '')) return;
    stampTag.dataset.card = card?.id ?? '';
    mount(stampTag, !card ? null : card.silhouette?.file ? h('img', { src: card.silhouette.file, alt: '' }) : groupById(card.group)?.emoji);
  }
  function setTool(id) {
    closePicker();
    nb.tool = id;
    nb.selected = -1;
    drawSelection();
    if (id === 'stamp' && !nb.set.stampCard) openStampPicker();
    drawTools();
  }
  // Tool settings: for this notebook now, and on the profile for the next one (the panel beside a
  // card and the notebook on its own read the same ones).
  function saveSet(next) {
    nb.set = next;
    updateProfile(state.profile.id, { notesTools: next });
    drawTools();
  }
  const setColour = (id, tool = popFor ?? nb.tool) => saveSet(withColour(nb.set, tool, id));
  const setSize = (id, tool = popFor ?? nb.tool) => saveSet(withSize(nb.set, tool, id));
  const setFoot = id => saveSet({ ...nb.set, foot: id });
  const colourFor = tool => (tool === 'highlighter' ? highlightColour(nb.set.highlighter.colour) : pencilColour(colourOf(nb.set, tool)));

  // ---------- the rails ----------
  let popFor = null; // the tool whose popover is open
  const swatches = tool => paletteOf(tool).map(id => h('button', {
    type: 'button', class: 'nb-colour', [tool === 'highlighter' ? 'data-hl' : 'data-colour']: id,
    'aria-pressed': String(colourOf(nb.set, tool) === id), 'aria-label': label(`notes.${tool === 'highlighter' ? 'hl' : 'colour'}.${id}`),
    onclick: () => setColour(id, tool),
  }));
  const thickness = tool => h('div', { class: 'nb-pop__sizes' }, ['thin', 'thick'].map(id => h('button', {
    type: 'button', class: 'nb-thick', 'data-thick': id, 'aria-pressed': String(sizeOf(nb.set, tool) === id), 'aria-label': label(`notes.${id}`),
    onclick: () => setSize(id, tool),
  }, h('span', { class: `nb-thick__line nb-thick__line--${id}`, 'aria-hidden': 'true' }))));
  function openRailPop(btn, tool, key, ...content) {
    toggleRailPop(btn, key, ...content);
    popFor = openPick === railPop ? tool : null;
  }
  // The tool in use, tapped again: its colours and thickness. The ruler comes and goes on its own.
  function tapPouch(id) {
    if (id === 'ruler') { if (pulled) pulled = false; else putRuler(!ruler); return; }
    if (id !== nb.tool) { setTool(id); return; }
    if (DRAWING.includes(id)) openRailPop(pouchTools.get(id), id, `notes.tool.${id}`, swatches(id), thickness(id));
  }
  const openInk = () => openRailPop(inkBtn, 'stamp', 'notes.ink', swatches('stamp'));
  function tapFootprints() {
    if (nb.tool !== 'roller') { setTool('roller'); return; }
    openRailPop(rackBtns.roller, null, 'notes.footPick', FEET.map(([id, icon]) => h('button', {
      type: 'button', class: 'nb-tool', 'data-foot': id, 'aria-pressed': String(nb.set.foot === id), 'aria-label': label(`notes.foot.${id}`),
      onclick: () => { closePicker(); setFoot(id); },
    }, h('span', { 'aria-hidden': 'true' }, icon))));
  }
  // The panda stamp: picked up on its last animal, then each tap moves to the next. A long press
  // lists them, for when there are many.
  const collected = () => state.cards.filter(isCollected).map(c => c.id);
  const stampNow = () => { const ids = collected(); return ids.includes(nb.set.stampCard) ? nb.set.stampCard : ids[0] ?? null; };
  let held = false, holdTimer = 0;
  function tapPanda() {
    if (held) { held = false; return; }
    const ids = collected();
    if (!ids.length) { openStampPicker(); return; }
    const was = stampNow(), again = nb.tool === 'stamp';
    const id = again ? nextAnimal(ids, was) : was;
    if (id !== nb.set.stampCard) saveSet({ ...nb.set, stampCard: id });
    setTool('stamp');
    if (again) toast(bi(state.byId.get(id).name));
  }
  if (!beside) {
    const b = rackBtns.stamp, letGo = () => clearTimeout(holdTimer);
    b.addEventListener('pointerdown', () => {
      held = false;
      holdTimer = setTimeout(() => { held = true; haptic(8); openStampPicker(); }, HOLD_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, letGo);
  }
  // Stamping: the stamp comes down where it was pressed, with a knock and a buzz.
  function stampFx(kind, x, y) {
    haptic(15);
    thunk();
    if (reducedMotion()) return;
    if (!beside) rackBtns[kind].firstChild.animate([{ transform: 'none' }, { transform: 'translateY(var(--nb-press)) scaleY(0.94)' }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
    const e = el.getBoundingClientRect();
    const ghost = h('div', { class: 'nb-ghost', 'aria-hidden': 'true', style: { left: `${x - e.left}px`, top: `${y - e.top}px` } }, stampArt(kind));
    el.append(ghost);
    ghost.animate([
      { transform: 'translate(-50%, -130%) scale(1.15)', opacity: 0.6 },
      { transform: 'translate(-50%, -100%) scale(1)', opacity: 1, offset: 0.45 },
      { transform: 'translate(-50%, -100%) scale(1)', opacity: 1, offset: 0.6 },
      { transform: 'translate(-50%, -125%) scale(1.05)', opacity: 0 },
    ], { duration: 240, easing: 'ease-in-out' }).onfinish = () => ghost.remove();
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
  let gest = null;     // two fingers: zoom and pan, resizing the selected item, or turning the ruler
  let rulerMove = null; // one finger moving the ruler: { id, t0, start, from }
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
  // Only tweezers and the stamps select with a tap: with anything else a tap is that tool's.
  const selects = () => nb.tool === 'tweezers' || INKED.includes(nb.tool);
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
    if (growing || nb.view !== 'pages' || e.target.closest('button, textarea') || (e.pointerType === 'mouse' && e.button)) return;
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
    if (ruler && e.pointerType !== 'pen' && !penDown && overRuler(e)) {
      rulerMove = { id: e.pointerId, t0: performance.now(), start: ruler, from: fromFrame(e, 0) };
      return;
    }
    const s = sideAt(e);
    // Tweezers draw nothing, so fingers work them even in pen-only mode, but not with a pen down.
    if (s && nb.tool === 'tweezers' && !(penDown && e.pointerType === 'touch')) { grip(e, s); return; }
    if (!s || !draws(e)) { startSwipe(e); return; }
    setActive(s);
    const [x, y] = fromFrame(e, s.i), now = performance.now();
    if (nb.selected >= 0 && itemAt(s, x, y) === nb.selected) { pickUp(e, s, x, y); return; }
    const press = { id: e.pointerId, side: s.i, t0: now, x: e.clientX, y: e.clientY, travel: 0 };
    if (DRAWING.includes(nb.tool)) {
      const edge = ruler ? edgeAt(ruler, x + s.i * PAGE_W, y, { inside: e.pointerType === 'pen' }) : 0;
      const [px, py] = edge ? onEdge(s.i, edge, x, y) : [x, y];
      const item = { t: 's', c: colourFor(nb.tool), w: widthOf(nb.tool, sizeOf(nb.set, nb.tool)), p: [px, py, pressureOf(e)] };
      if (nb.tool !== 'pencil') item.k = nb.tool; // no k: a pencil, as on every page before these
      stroke = { ...press, edge, item };
      // The live layer has no page under it: the browser multiplies it onto the page instead.
      if (item.k === 'highlighter') desk.dataset.blend = '';
      drawStroke(liveCtx(s.i), item);
    } else if (nb.tool === 'roller') {
      stroke = { ...press, item: { t: 'f', c: pencilColour(nb.set.ink), k: nb.set.foot, p: [x, y] } };
    } else if (nb.tool === 'eraser' || nb.tool === 'sponge') {
      select(-1);
      erasing = { id: e.pointerId, side: s.i, t0: now, entries: [] };
      eraseAt(x, y);
    } else {
      stroke = { ...press, tap: [x, y] };
    }
  }

  // The selected item, starting to move. It stays put until the finger has gone further than a tap.
  function pickUp(e, s, x, y) {
    drag = { id: e.pointerId, side: s.i, index: nb.selected, before: structuredClone(s.page.items[nb.selected]), from: [x, y], mode: 'move', still: true, t0: performance.now() };
    redraw();
  }
  // The tweezers: one press selects what is under them and can already drag it. Bare paper lets go
  // only if it turns out to be a tap: it may be the first finger of a pinch on something small.
  function grip(e, s) {
    setActive(s);
    const [x, y] = fromFrame(e, s.i), i = itemAt(s, x, y);
    if (i < 0) { startSwipe(e); return; }
    if (i !== nb.selected) { haptic(4); select(i); }
    pickUp(e, s, x, y);
  }

  function move(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Fingers report one at a time: read them together, once a frame, or the first to report
    // looks like a change in their distance.
    if (gest) { gestFrame ||= requestAnimationFrame(moveGesture); return; }
    if (swipe?.id === e.pointerId) { moveSwipe(e); return; }
    if (rulerMove?.id === e.pointerId) {
      const [x, y] = fromFrame(e, 0), { start, from } = rulerMove;
      ruler = clampRuler({ ...start, x: start.x + x - from[0], y: start.y + y - from[1] }, bookW(), PAGE_H);
      drawRuler();
      return;
    }
    const events = e.getCoalescedEvents?.() ?? [];
    const points = events.length ? events : [e];
    if (stroke?.id === e.pointerId) {
      stroke.travel = Math.max(stroke.travel, Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y));
      const item = stroke.item, i = stroke.side;
      if (item?.t === 's') {
        const from = item.p.length;
        for (const ev of points) {
          const [x, y] = fromFrame(ev, i);
          item.p.push(...(stroke.edge && ruler ? onEdge(i, stroke.edge, x, y) : [x, y]), pressureOf(ev));
        }
        // A highlighter line is one path: drawn again whole, or its joints would show.
        if (item.k === 'highlighter') { clearLive(); drawStroke(liveCtx(i), item); } else drawStroke(liveCtx(i), item, from);
      } else if (item?.t === 'f') {
        const [x, y] = fromFrame(e, i), p = item.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > 6) {
          p.push(x, y);
          if (p.length === 4) stampFx('roller', e.clientX, e.clientY);
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
    if (rulerMove?.id === e.pointerId) { endRulerMove(e); return; }
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
    if (rulerMove?.id === e.pointerId) { ruler = rulerMove.start; rulerMove = null; drawRuler(); }
    if (stroke?.id === e.pointerId || drag?.id === e.pointerId) dropPress();
    if (erasing?.id === e.pointerId) endErase();
  }

  function endStroke() {
    const s = stroke; stroke = null;
    const side = sides[s.side], tap = isTap(s.travel, performance.now() - s.t0), had = nb.selected >= 0;
    clearLive();
    delete desk.dataset.blend;
    if (s.tap) {
      if (had) { select(-1); return; }
      const [x, y] = s.tap, i = itemAt(side, x, y);
      if (nb.tool === 'text' && i >= 0 && side.page.items[i].t === 'x') editText(side, x, y);
      else if (i >= 0) tapSelect(side, x, y);
      else if (nb.tool === 'text') { stampFx('text', s.x, s.y); editText(side, x, y); }
      else if (nb.tool === 'stamp') placeStamp(side, x, y, s.x, s.y);
      return;
    }
    if (tap && selects() && tapSelect(side, s.item.p[0], s.item.p[1])) return;
    if (had) select(-1);
    if (tap && had) return; // the tap let go of the selection: no dot
    if (s.item.t === 's' || s.item.p.length >= 4) commit({ kind: 'add', side: s.side, index: side.page.items.length, item: s.item });
  }

  // What the first finger was doing, undone: a second one has made this a gesture.
  function dropPress() {
    if (stroke) { stroke = null; clearLive(); delete desk.dataset.blend; }
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
    if (rulerMove) {
      // Both on the ruler turn it, however late the second comes: it stays put by itself, so a
      // second finger on it is meant. One on it and one off is a pan or zoom, if it came at once.
      if (pts().every(p => overRuler({ clientX: p.x, clientY: p.y }, RULER_PAD))) { rulerMove = null; startRulerTurn(); return; }
      if (!secondFingerCounts(performance.now() - rulerMove.t0)) return;
      ruler = rulerMove.start;
      rulerMove = null;
      drawRuler();
      startGesture();
      return;
    }
    const press = stroke ?? erasing ?? drag;
    if (press && !secondFingerCounts(performance.now() - press.t0)) return; // a brush of the hand
    dropPress();
    swipe = null;
    startGesture();
  }

  // Whole lines: any the eraser touches goes, in one undo step per rub. The sponge does the same for
  // stamps, trails and text. Photos have their ✕.
  function eraseAt(x, y) {
    const s = sides[erasing.side], sponge = nb.tool === 'sponge';
    const i = hitItem(ctxOf(s), s.page, x, y, sponge ? SPONGE_R : ERASE_R, sponge ? { stamped: true } : { lines: true });
    if (i < 0) return;
    // Its index in the page as it was before this rub started, for undo.
    const item = s.page.items[i];
    let orig = i;
    for (const en of [...erasing.entries].sort((a, b) => a.index - b.index)) if (en.index <= orig) orig++;
    erasing.entries.push({ index: orig, item });
    if (sponge) wipeFx(s, item, x, y);
    s.page.items.splice(i, 1);
    haptic(4);
    redrawSoon();
  }
  // What the sponge took fades off the paper as the sponge rocks over it. Drawn once onto a small
  // canvas of its own, then only its opacity changes, so a rub costs the tablet no redrawing.
  let spongeGhost = null;
  function wipeFx(s, item, x, y) {
    if (reducedMotion()) return;
    const b = boundsOf(ctxOf(s), item), half = Math.hypot(b.w, b.h) / 2 + 8;
    const left = (b.cx - half) * scale, top = (b.cy - half) * scale, size = Math.ceil(half * 2 * scale);
    const wiped = h('canvas', { class: 'nb-wipe', 'aria-hidden': 'true', width: size, height: size, style: { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` } });
    const c = wiped.getContext('2d');
    c.setTransform(scale, 0, 0, scale, -left, -top);
    renderItem(c, item, nb.assets);
    s.selLayer.append(wiped);
    wiped.animate([{ opacity: 1 }, { opacity: 0 }], { duration: WIPE_MS, easing: 'ease-out' }).onfinish = () => wiped.remove();
    if (spongeGhost) return;
    const e = el.getBoundingClientRect(), k = scale * view.k;
    spongeGhost = h('div', { class: 'nb-ghost', 'aria-hidden': 'true', style: { left: `${rect.left - e.left + view.x + (x + s.i * PAGE_W) * k}px`, top: `${rect.top - e.top + view.y + y * k}px` } }, spongeArt());
    el.append(spongeGhost);
    spongeGhost.animate([
      { transform: 'translate(-50%, -50%) rotate(-10deg)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) rotate(10deg)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%, -50%) rotate(-6deg)', opacity: 0 },
    ], { duration: WIPE_MS, easing: 'ease-in-out' }).onfinish = () => { spongeGhost.remove(); spongeGhost = null; };
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
    if (gest.ruler) { turnRuler(); return; }
    const ratio = dist() / gest.d0;
    if (gest.item) {
      const it = sides[drag.side].page.items[drag.index], b = gest.before;
      if (it.t === 'f') it.p = movedTrail(b.p, { ...centreOf(b), k: clamp(ratio, 0.2, 5), a: angle() - gest.a0 });
      else { resizeItem(it, b, clamp(ratio, 0.2, 5)); it.r = (b.r ?? 0) + angle() - gest.a0; }
      clearLive(); renderItem(liveCtx(drag.side), it, nb.assets); drawSelection();
      return;
    }
    gest.to = mid();
    gest.peak = Math.max(gest.peak, Math.abs(ratio - 1));
    view = pinchView(gest.start, gest.from, gest.to, ratio, frame, bookSize(), margin());
    place();
    if (onFull && pinchOpensFull(gest.start.k, ratio)) {
      gest = null;
      delete desk.dataset.gesture;
      openFull();
    }
  }
  function endGesture() {
    const g = gest; gest = null;
    delete desk.dataset.gesture;
    if (g.ruler) return;
    if (g.item) { endDrag(); return; }
    const dir = swipeTurn({ dx: g.to.x - g.from.x, dy: g.to.y - g.from.y, span: g.d0, peak: g.peak, zoom: g.start.k });
    if (onFull && atFit(g.start.k)) unzoom();
    settle();
    if (dir) turn(dir);
  }
  // A pinch beside a card that stopped short of the full notebook: back to the fitted page.
  function unzoom() {
    if (view.k === 1) return;
    const from = book.style.getPropertyValue('transform');
    setView({ ...view, k: 1 });
    if (reducedMotion()) return;
    const to = book.style.getPropertyValue('transform');
    for (const b of [book, over]) b.animate([{ transform: from }, { transform: to }], { duration: UNZOOM_MS, easing: 'ease-out' });
  }

  // ---------- the full notebook, from the panel ----------
  // Everything is saved, then the panel grows to the screen and onFull takes over.
  let growing = false;
  async function openFull() {
    if (growing) return;
    growing = true;
    haptic(8);
    stopNudge();
    await flushSave();
    if (!reducedMotion()) await grow();
    onFull();
  }
  // The kraft spreads from the panel to the screen while the page goes to where it will lie (one
  // scale of each: transform only, nothing laid out again). They stay over everything for a moment
  // so the full notebook can draw under them, then fade.
  async function grow() {
    const w = window.innerWidth, hgt = window.innerHeight, from = el.getBoundingClientRect(), s = sides[nb.active];
    const back = h('div', { class: 'nb-grow__back' }), box = h('div', { class: 'nb-grow', 'aria-hidden': 'true' }, back);
    document.body.append(box);
    const timing = { duration: GROW_MS, easing: 'ease-in-out' };
    back.animate([{ transform: `translate(${from.left}px, ${from.top}px) scale(${from.width / w}, ${from.height / hgt})` }, { transform: 'none' }], timing);
    if (nb.view === 'pages' && s.page) {
      const at = s.sheet.getBoundingClientRect(), css = getComputedStyle(el);
      const rail = parseFloat(css.getPropertyValue(w > hgt ? '--nb-rail' : '--nb-rail-band')) || 0;
      const to = fullPageBox({ w, h: hgt, rail, tall: PAGE_H / PAGE_W, right: (nb.pos + nb.active) % 2 === 1 });
      const paper = h('canvas', {
        class: 'nb-grow__page', width: s.base.width, height: s.base.height,
        style: { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` },
      });
      paper.getContext('2d').drawImage(s.base, 0, 0);
      box.append(paper);
      paper.animate([{ transform: `translate(${at.left - to.left}px, ${at.top - to.top}px) scale(${at.width / to.width})` }, { transform: 'none' }], timing);
    }
    box.animate([{ opacity: 1 }, { opacity: 0 }], { delay: GROW_MS + GROW_HOLD_MS, duration: GROW_FADE_MS, fill: 'forwards' }).onfinish = () => box.remove();
    await new Promise(done => { setTimeout(done, GROW_MS); });
  }

  // ---------- the ruler ----------
  // On the book's top layer, so it moves and zooms with the pages, and out of everything saved.
  let ruler = null;    // { x, y, r } while it is out of the pouch (js/notes-ruler.js)
  let pulled = false;  // it was just dragged out: the click ending that isn't a tap on it
  const rulerEl = h('div', { class: 'nb-ruler', hidden: true, 'aria-hidden': 'true' }, rulerArt(RULER_L, RULER_H));
  over.append(rulerEl);
  const bookW = () => PAGE_W * open().length;
  function drawRuler() {
    rulerEl.hidden = !ruler || nb.view !== 'pages';
    if (rulerEl.hidden) return;
    rulerEl.style.setProperty('left', `${(ruler.x - RULER_L / 2) * scale}px`);
    rulerEl.style.setProperty('top', `${(ruler.y - RULER_H / 2) * scale}px`);
    rulerEl.style.setProperty('width', `${RULER_L * scale}px`);
    rulerEl.style.setProperty('height', `${RULER_H * scale}px`);
    rulerEl.style.setProperty('transform', `rotate(${ruler.r}rad)`);
  }
  // pad: CSS px on screen.
  function overRuler(e, pad = 0) {
    const [x, y] = fromFrame(e, 0);
    return onRuler(ruler, x, y, pad / (scale * view.k));
  }
  // A point of a line on side i, moved onto the ruler's edge.
  function onEdge(i, edge, x, y) {
    const [bx, by] = snapTo(ruler, edge, x + i * PAGE_W, y);
    return [bx - i * PAGE_W, by];
  }
  // Out across the page being worked on, or back in the pouch.
  function putRuler(out) {
    if (nb.view !== 'pages') return;
    ruler = out ? { x: (nb.active + 0.5) * PAGE_W, y: PAGE_H / 2, r: 0 } : null;
    drawRuler();
    drawTools();
  }
  function endRulerMove(e) {
    rulerMove = null;
    const b = railStart && pouchTools.get('ruler').closest('.nb__pouch').getBoundingClientRect();
    const home = b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
    if (home) putRuler(false);
  }
  function startRulerTurn() {
    const m = mid();
    gest = { ruler: true, start: ruler, a0: angle(), from: fromFrame({ clientX: m.x + rect.left, clientY: m.y + rect.top }, 0) };
  }
  function turnRuler() {
    const m = mid(), [x, y] = fromFrame({ clientX: m.x + rect.left, clientY: m.y + rect.top }, 0), { start, from, a0 } = gest;
    ruler = clampRuler({ x: start.x + x - from[0], y: start.y + y - from[1], r: start.r + angle() - a0 }, bookW(), PAGE_H);
    drawRuler();
  }
  // Pulled out of the pouch: it follows the finger from the moment it leaves, and goes back if let
  // go off the desk.
  if (!beside) {
    const b = pouchTools.get('ruler');
    let pull = null;
    b.addEventListener('pointerdown', e => {
      pulled = false;
      if (ruler || nb.view !== 'pages') return;
      rect = desk.getBoundingClientRect();
      pull = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
      try { b.setPointerCapture(e.pointerId); } catch { /* gone */ }
    });
    b.addEventListener('pointermove', e => {
      if (pull?.id !== e.pointerId) return;
      pull.on ||= Math.hypot(e.clientX - pull.x, e.clientY - pull.y) > 10;
      if (!pull.on) return;
      const [x, y] = fromFrame(e, 0);
      ruler = clampRuler({ x, y, r: 0 }, bookW(), PAGE_H);
      drawRuler();
    });
    const end = e => {
      if (pull?.id !== e.pointerId) return;
      const on = pull.on;
      pull = null;
      if (!on) return;
      pulled = true;
      const r = desk.getBoundingClientRect();
      if (e.type === 'pointercancel' || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) ruler = null;
      drawRuler();
      drawTools();
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
  }

  // ---------- one finger not drawing ----------
  // On the kraft, or anywhere when only a pen draws: sideways turns the page; up and down pans a
  // page taller than the panel, and zoomed in it pans any way. Tweezers on bare paper only pan.
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
      if (!(s && selects() && tapSelect(s, ...fromFrame(e, s.i))) && nb.selected >= 0) select(-1);
      return;
    }
    // A grab that missed must not lose the page.
    if (nb.tool !== 'tweezers' && sw.axis !== 'y' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) turn(dx < 0 ? 1 : -1);
  }

  // ---------- move / resize / turn ----------
  // Kept between a small chip and the width of the page, so nothing gets lost off the paper.
  function resizeItem(it, b, k) {
    if (it.t === 'p') {
      const long = Math.max(b.w, b.h);
      const kk = clamp(k, 80 / long, PAGE_W / long);
      it.w = b.w * kk; it.h = b.h * kk;
    } else if (it.t === 'f') it.p = movedTrail(b.p, { ...centreOf(b), k });
    else it.s = clamp(b.s * k, 16, it.t === 'm' ? 480 : 160);
  }
  const centreOf = trail => { const { cx, cy } = boundsOf(null, trail); return { cx, cy }; };
  function transformDrag(x, y) {
    const s = sides[drag.side], it = s.page.items[drag.index], b = drag.before;
    if (drag.mode === 'move') {
      const dx = x - drag.from[0], dy = y - drag.from[1];
      if (drag.still) {
        if (isTap(Math.hypot(dx, dy) * scale * view.k, 0)) return; // a tap's wobble moves nothing
        drag.still = false;
      }
      if (it.t === 'f') it.p = movedTrail(b.p, { dx, dy });
      else { it.x = b.x + dx; it.y = b.y + dy; }
    } else {
      const box = boundsOf(ctxOf(s), b);
      if (drag.mode === 'resize') {
        const k = Math.hypot(x - box.cx, y - box.cy) / Math.max(1, Math.hypot(drag.from[0] - box.cx, drag.from[1] - box.cy));
        resizeItem(it, b, Math.max(0.2, Math.min(5, k)));
      } else if (drag.mode === 'rotate') {
        const a = Math.atan2(y - box.cy, x - box.cx) - Math.atan2(drag.from[1] - box.cy, drag.from[0] - box.cx);
        if (it.t === 'f') it.p = movedTrail(b.p, { cx: box.cx, cy: box.cy, a });
        else it.r = (b.r ?? 0) + a;
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
    const remove = () => {
      if (nb.selected < 0 || performance.now() - selectedAt < SETTLE_MS) return;
      const i = nb.selected;
      nb.selected = -1;
      commit({ kind: 'remove', entries: [{ index: i, item: nb.page.items[i] }] });
    };
    const del = h('button', { type: 'button', class: 'nb-sel__h nb-sel__del', 'aria-label': label('notes.delete'), onclick: remove }, '✕');
    // The first tap after dragging a handle can come without a click: the finger lifting counts too.
    del.addEventListener('pointerup', remove);
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
    const item = existing >= 0 ? s.page.items[existing] : { t: 'x', c: pencilColour(nb.set.ink), s: TEXT_SIZE, x, y, v: '' };
    const area = h('textarea', { class: 'nb-text', 'aria-label': label('notes.tool.text'), rows: 2 });
    area.value = item.v;
    area.style.setProperty('left', `${item.x * scale}px`);
    area.style.setProperty('top', `${item.y * scale}px`);
    area.style.setProperty('font-size', `${item.s * scale}px`);
    area.style.setProperty('color', item.c);
    area.toggleAttribute('data-light', item.c === pencilColour('white')); // white needs a dark box
    let done = false, freeKeyboard = null;
    const finish = keep => {
      if (done) return;
      done = true;
      const v = area.value.replace(/\s+$/, '');
      area.remove();
      freeKeyboard();
      layout();
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
    freeKeyboard = clearKeyboard(area);
    area.focus({ preventScroll: true });
  }
  // While a text box is open the desk rises so the box stays above the on-screen keyboard, however
  // the browser makes room for it: the notebook keeps its height, and the visual viewport says
  // what is still in sight. Returns what puts it all back.
  function clearKeyboard(area) {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    let up = 0;
    el.style.setProperty('height', `${el.getBoundingClientRect().height}px`);
    const lift = () => {
      const b = area.getBoundingClientRect();
      const next = keyboardLift({ box: { top: b.top + up, bottom: b.bottom + up }, viewTop: vv.offsetTop, viewBottom: vv.offsetTop + vv.height });
      if (next === up) return;
      up = next;
      deskWrap.style.setProperty('transform', `translateY(${-up}px)`);
    };
    vv.addEventListener('resize', lift);
    vv.addEventListener('scroll', lift);
    area.addEventListener('input', lift);
    lift();
    return () => {
      vv.removeEventListener('resize', lift);
      vv.removeEventListener('scroll', lift);
      deskWrap.style.removeProperty('transform');
      el.style.removeProperty('height');
    };
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
      onPick: card => { nb.tool = 'stamp'; saveSet({ ...nb.set, stampCard: card.id }); } });
  }
  // Only animals this explorer has collected, and not already on the page.
  function openTagPicker(s) {
    const tags = s.page?.tags ?? [];
    pickAnimal({ icon: '🏷️', titleKey: 'notes.pickTag', emptyKey: 'notes.noTags', cards: state.cards.filter(c => isCollected(c) && !tags.includes(c.id)),
      onPick: card => setTags(s, withTag(s.page.tags ?? [], card.id)) });
  }
  // A stamp also tags the page with its animal (once); removing the stamp leaves the tag.
  function placeStamp(s, x, y, screenX, screenY) {
    const card = nb.set.stampCard;
    if (!card) { openStampPicker(); return; }
    stampAsset(card);
    stampFx('stamp', screenX, screenY);
    const before = [...(s.page.tags ?? [])], after = tagsAfterStamp(before, card);
    commit({
      kind: 'add', side: s.i, index: s.page.items.length, item: { t: 'm', c: pencilColour(nb.set.ink), card, x, y, s: STAMP_SIZE, r: 0 },
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
    // A mouse has no second finger: the wheel over the ruler turns it.
    if (ruler && !e.ctrlKey && !e.metaKey && overRuler(e)) { ruler = { ...ruler, r: ruler.r + e.deltaY * 0.002 }; drawRuler(); return; }
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
