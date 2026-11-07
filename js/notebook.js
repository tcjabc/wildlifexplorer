// Field Notes: a researcher's notebook. Dotted (or grid) paper. Tools: pencil and pen (pressure),
// highlighter (multiplied onto the page), ruler, eraser (whole lines), text, creature stamps,
// footprint roller, washi tape, taped-in Polaroids, undo and redo.
//
// On its own (#/notes) the notebook fills the screen: one page at a time, in a spiral-bound book on
// a wooden desk (js/notes-book.js), closed at first with its cover showing (js/notes-cover.js; a tap
// opens it, Back closes it), with one back button, a pencil roll on the left and a field-kit tray on
// the right (in portrait the tray above and the roll below), sticky index tabs down the page's right
// edge, and buttons to turn pages. The contents is the book's first pages. Beside a card it stays a
// panel: one page, with its bar and toolbar on top, sharing the same tool settings (js/notes-tools.js).
//
// The roll and the tray hold real objects (js/notes-rails.js). The roll: a slider for the thickness,
// the five tools in their loops, and the colours. The tool in use lies out on the desk beside the
// roll where there is room (measured), or else slides partly out of its loop. The tray: the ink
// pad, the sponge (rubs stamps, trails, text and tape off the page, nothing else), three stamps: ABC
// (text), the panda (a collected animal: a tap shows a short row of them, a long press all of them,
// laid out like the binder) and the footprints, the tweezers, the washi tape (drag across the page to lay a strip), the magnifying
// glass and the pile of Polaroids (js/notes-polaroid.js).
//
// The ruler lies on the book, not on a page, and is never saved. One finger moves it (pulled from
// its loop, or tap it there), two fingers both on it turn it; a line started beside an edge follows
// that edge. A pen never moves it, and neither does anything else while a pen is down.
//
// One finger draws. Two fingers pan and pinch-zoom; a clear two-finger swipe at the fitted size turns
// the page, up and down in the book and sideways in the panel (js/notes-view.js has the rules).
// In the book the page zooms inside its own edges: the book itself stays put. During a gesture it moves
// by CSS transform; when it ends, a canvas the size of the screen redraws what is in view
// sharply, so zooming in never needs a bigger page bitmap. The wheel pans, ctrl + wheel zooms.
//
// What is on a page is baked into one bitmap, the base canvas. What is selected is held out of it, on
// the live layer, so moving it draws nothing else (see heldOut).
//
// The tweezers pick up a photo, stamp, footprint trail, text or tape: press it to select it and drag it
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
import { state, updateProfile, isCollected, groupById, debugOn } from './store.js';
import * as notes from './notes-store.js';
import { PAGE_W, PAGE_H } from './notes-store.js';
import { titleOf, withTag, withoutTag, tagsAfterStamp, freePages, openFor, movedTrail, pageFull, bitmapsIn, contents as contentsOf } from './notes-model.js';
import { renderPage, renderItem, appendItem, drawStroke, hitItem, boundsOf, pencilColour, highlightColour } from './notes-render.js';
import { fitScale, bookBox, tabFit, tabsShown, paginate, deskSpot, stackDepth, clampView, pinchView, settleView, swipeTurn, secondFingerCounts, isTap, pixelRatio, railFit, popPlace, keyboardLift, atFit, pinchOpensFull, fullPageBox } from './notes-view.js';
import { PENCILS, DRAWING, INKED, SIZES, WASHI, paletteOf, widthOf, isFine, cleanTools, colourOf, sizeOf, withColour, withSize, canStamp, usedStamp, stampRow } from './notes-tools.js';
import { RULER_L, RULER_H, onRuler, edgeAt, snapTo, clampRuler } from './notes-ruler.js';
import { TOOL_ROWS, toolArt, inkPadArt, stampArt, spongeArt, tweezersArt, washiArt, pileArt, glassArt, underlineArt, tokenArt, openBookArt, rulerArt } from './notes-rails.js';
import { bookFrame, snapshot, turnPage, fadePage, turnCover } from './notes-book.js';
import { bookCover } from './notes-cover.js';
import { polaroids } from './notes-polaroid.js';
import { tabButton, fitLabels } from './notes-tabs.js';
import { tapZones, heavyItems, timed } from './notes-debug.js';
import { thunk } from './fx.js';
import { groupTab, tileFace } from './components.js';
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
const ROLL_MS = 420;   // the roll opening out
const WASHI_W = 56;    // a strip of tape, in page units
const WASHI_TAP = 220; // how long a strip a tap lays
const WASHI_MIN = 40;  // anything shorter is a tap
const PHOTO_SIZE = 560; // a photo's longer side on the page
const PHOTO_TILT = (4 * Math.PI) / 180;
const DOUBLE_TAP_MS = 450;
const TOOL_OUT_MS = 220; // a tool coming out of the roll onto the desk (--t-med)
const ZOOM_STEP = 1.5; // the magnifying glass's + and −
const EDIT_LIFT_MS = 80; // how long a finger lifting from ✎ waits for its click, which may never come
const TAB_PITCH = { full: 60, narrow: 60, stub: 48 }; // a tab and the gap under it, CSS px
const TAB_KEEP_MORE = 12; // --nb-tab-keep over --nb-tab-want
const TAB_W = { full: 96, narrow: 96, stub: 44 };
const NAV_ROOM = 104;  // the two turn buttons under the tabs
const SETTLE_MS = 400; // after selecting, before ✕ counts
const HOLD_MS = 500;   // a long press on the panda stamp
const RULER_PAD = 24;  // CSS px around the ruler that still count as on it for a second finger
const KEPT_PAGES = 3;  // photos and stickers stay decoded for this page and the last two seen

// The card's name and dates in the profile's language, for text drawn on the canvas.
const inLang = pair => {
  if (!pair) return '';
  const m = getMode();
  return m === 'en' ? pair.en || pair.zh : m === 'zh' ? pair.zh || pair.en : [pair.en, pair.zh].filter(Boolean).join('  ');
};

export function notebook({ cardId = null, beside = false, lead = null, start = null, onBack = null, onFull = null } = {}) {
  // The page open (none in the contents), and whether it is a draft (not saved until its first
  // mark) or has unsaved changes.
  const base = h('canvas', { class: 'nb__base' });
  // The page's animal tags, under the OBSERVED stamp (positioned in page units, css/notes.css).
  const tagsBox = h('div', { class: 'nb__tags', role: 'group', 'aria-label': label('notes.tags') });
  // The selection handles and the text box being typed go on a layer of their own.
  const selLayer = h('div', { class: 'nb__sel-layer' });
  const leaf = { base, tagsBox, selLayer, sheet: h('div', { class: 'nb__sheet' }, base), overlay: h('div', { class: 'nb__overlay' }, selLayer, tagsBox), page: null, draft: false, dirty: false };

  // view: 'pages' or 'contents'. scope: whose pages are turned through: { kind: 'animal', id } or
  // { kind: 'free' }. pos: the page's index in that list. away: the page open has left the list (its
  // tag came off): pos is then where it was, and the tabs go on from there.
  const nb = {
    home: cardId, view: cardId ? 'pages' : 'contents', scope: cardId ? { kind: 'animal', id: cardId } : null,
    ids: [], pos: 0, away: false, ready: false, toc: 0, tocPages: [[]],
    tool: 'pencil', lastDraw: 'pencil', stowed: false, set: cleanTools(state.profile?.notesTools),
    undo: [], redo: [], selected: -1, saveTimer: 0, seen: [],
    assets: { photos: new Map(), stamps: new Map(), stickers: new Map() },
    get page() { return leaf.page; },
    get draft() { return leaf.draft; },
  };
  const input = () => state.profile.notesInput ?? 'finger';

  // ---------- DOM ----------
  // Two layers with the same transform: the page under the canvases, what sits on it over.
  const book = h('div', { class: 'nb__book' }, leaf.sheet);
  const over = h('div', { class: 'nb__book nb__book--over' }, leaf.overlay);
  const detail = h('canvas', { class: 'nb__detail', hidden: true }); // the sharp view when zoomed in
  const live = h('canvas', { class: 'nb__live' });                   // the mark being made
  const desk = h('div', { class: 'nb__desk', 'data-scroll': '' }, book, detail, live, over);
  const bk = bookFrame(desk);
  // On its own the book starts closed. Opened from the panel, the page grows straight into place.
  const covered = !beside && !start;
  let shut = covered;
  const cover = covered && bookCover({ title: tx('notes.title'), name: state.profile?.name, label: label('notes.openBook'), onOpen: () => openBook() });
  if (cover) bk.hinge.append(cover.el);
  const contentsBox = h('div', { class: 'nb__contents', 'data-scroll': '', hidden: true });
  if (!beside) bk.el.insertBefore(contentsBox, bk.turn); // on its own, it is a page of the book
  // Beside a card the page can be taller than the panel: a slim indicator on its right edge
  // shows how much more there is, and where.
  const thumb = h('span', { class: 'nb__thumb' });
  const scrollbar = h('div', { class: 'nb__scrollbar', 'aria-hidden': 'true', hidden: true }, thumb);
  const counter = h('span', { class: 'nb__count' });
  // "All pages" (to the contents), or in the contents of a card's notebook "‹ <animal>".
  const filterChip = h('button', { class: 'nb__filter', type: 'button', onclick: () => (nb.view === 'pages' ? openContents() : openHome()) });
  const prev = h('button', { class: 'btn btn--icon nb__nav nb__nav--prev', type: 'button', 'aria-label': label('notes.prev'), onclick: () => turn(-1) }, h('span', { class: 'nb__nav-sign', 'aria-hidden': 'true' }, '‹'));
  const next = h('button', { class: 'btn btn--icon nb__nav nb__nav--next', type: 'button', 'aria-label': label('notes.next'), onclick: () => turn(1) }, h('span', { class: 'nb__nav-sign', 'aria-hidden': 'true' }, '›'));
  const newBtn = h('button', { class: 'btn btn--icon nb__new', type: 'button', 'aria-label': label('notes.newPage'), onclick: () => newPage() }, '＋');
  const menuBtn = h('button', { class: 'btn btn--icon nb__menu', type: 'button', 'aria-label': label('notes.menu'), onclick: () => openMenu() }, '⋯');
  // Sticky index tabs on the page's right edge (see drawTabs).
  const tabsBox = h('div', { class: 'nb-tabs', role: 'group' });
  const deskWrap = h('div', { class: 'nb__deskwrap' }, bk.el, scrollbar, !beside && tabsBox, !beside && prev, !beside && next);
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => (beside ? addPhoto(e.target.files?.[0]) : pickedPhoto(e.target.files?.[0])) });
  const importInput = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true, onchange: e => doImport(e.target.files?.[0]) });
  const menuSheet = h('dialog', { class: 'sheet nb-menu' });
  const pickSheet = h('dialog', { class: 'sheet nb-pick' });
  [menuSheet, pickSheet].forEach(d => {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.addEventListener('keydown', e => e.stopPropagation());
  });

  const toolBtns = TOOLS.map(([id, icon]) => h('button', {
    type: 'button', class: 'nb-tool', 'data-tool': id, 'aria-pressed': 'false', 'aria-label': label(`notes.tool.${id}`),
    onclick: () => (id === 'stamp' && nb.tool === 'stamp' ? openStampPicker() : setTool(id)),
  }, h('span', { 'aria-hidden': 'true' }, icon)));
  const photoBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.tool.photo'), onclick: () => fileInput.click() }, h('span', { 'aria-hidden': 'true' }, '📷'));
  const colourBtns = PENCILS.map(id => h('button', {
    type: 'button', class: 'nb-colour', 'data-colour': id, 'aria-pressed': 'false', 'aria-label': label(`notes.colour.${id}`),
    onclick: () => setColour(id),
  }));
  const sizeBtn = h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.size'), onclick: () => setSize(isFine(sizeOf(nb.set, nb.tool)) ? 'thick' : 'thin') });
  // On the roll these are wooden tokens; in the panel's toolbar, plain icons.
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
  // On its own, the roll and the tray.
  const loops = new Map(TOOL_ROWS.map(id => [id, h('button', {
    type: 'button', class: 'nb-pt', 'data-pt': id, 'aria-pressed': 'false', 'aria-label': label(`notes.tool.${id}`), onclick: () => tapLoop(id),
  }, toolArt(id), h('span', { class: 'nb-pt__loop', 'aria-hidden': 'true' }))]));
  const sizeInput = h('input', { type: 'range', class: 'nb-slider', min: 0, max: SIZES.length - 1, step: 1, 'aria-label': label('notes.thickness'), oninput: e => rollSize(SIZES[Number(e.target.value)]) });
  const colourBox = h('div', { class: 'nb-roll__colours', role: 'group', 'aria-label': label('notes.colourPick') });
  const cloth = !beside && h('div', { class: 'nb-roll__cloth' },
    h('div', { class: 'nb-roll__size' }, h('span', { class: 'nb-roll__dot', 'aria-hidden': 'true' }), sizeInput, h('span', { class: 'nb-roll__dot nb-roll__dot--big', 'aria-hidden': 'true' })),
    h('div', { class: 'nb-roll__loops', role: 'group', 'aria-label': label('notes.tools') }, [...loops.values()]),
    colourBox,
    h('div', { class: 'nb__railfoot' }, undoBtn, redoBtn, inputBtn));
  const roll = !beside && h('div', { class: 'nb-roll' }, cloth, h('span', { class: 'nb-roll__end', 'aria-hidden': 'true' }));
  const inkBtn = h('button', { type: 'button', class: 'nb-rack nb-rack--ink', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': label('notes.ink'), onclick: () => openInk() }, inkPadArt());
  const stampTag = h('span', { class: 'nb-rack__tag', 'aria-hidden': 'true' });
  const rackBtn = (id, key, art, onclick, ...kids) => h('button', { type: 'button', class: 'nb-rack', 'data-rack': id, 'aria-pressed': 'false', 'aria-label': label(key), onclick }, art, kids);
  const rackBtns = {
    sponge: rackBtn('sponge', 'notes.tool.sponge', spongeArt(), () => setTool('sponge')),
    text: rackBtn('text', 'notes.tool.text', stampArt('text'), () => setTool('text')),
    stamp: rackBtn('stamp', 'notes.tool.stamp', stampArt('stamp'), () => tapPanda(), stampTag),
    roller: rackBtn('roller', 'notes.tool.roller', stampArt('roller'), () => tapFootprints()),
    tweezers: rackBtn('tweezers', 'notes.tool.tweezers', tweezersArt(), () => setTool('tweezers')),
    washi: rackBtn('washi', 'notes.tool.washi', washiArt(), () => tapWashi()),
    zoom: rackBtn('zoom', 'notes.zoom', glassArt(), () => openZoom()),
  };
  const pileBtn = h('button', { type: 'button', class: 'nb-rack', 'data-rack': 'photos', 'aria-label': label('notes.tool.photo'), onclick: () => fileInput.click() }, pileArt());
  // Saved first: what is on the page must be there for whatever opens it next.
  const backBtn = !beside && h('button', { class: 'btn btn--icon nb__back', type: 'button', 'aria-label': label('notes.back'), onclick: async () => { await flushSave(); await closeBook(); onBack?.(); } }, '‹');
  const railStart = !beside && h('aside', { class: 'nb__rail nb__rail--start' }, roll);
  const railEnd = !beside && h('aside', { class: 'nb__rail nb__rail--end' }, newBtn,
    h('div', { class: 'nb-tray', role: 'group', 'aria-label': label('notes.stamps') }, inkBtn, rackBtns.sponge, rackBtns.text, rackBtns.stamp, rackBtns.roller, rackBtns.tweezers, rackBtns.washi, rackBtns.zoom, pileBtn),
    menuBtn);
  // The tool in hand, out on the desk: tapped, it goes back in its loop.
  const deskTool = !beside && h('button', { type: 'button', class: 'nb-desktool', hidden: true, onclick: () => tapLoop(nb.tool) });
  // The popover for whatever on the rails was tapped; its content changes with that.
  const railPop = { box: h('div', { class: 'nb-pop nb-pop--rail nb-pop--three', role: 'group', hidden: true }), btn: null };

  const el = h('section', { class: ['nb', beside ? 'nb--beside' : 'nb--immersive'], 'data-book': shut ? 'closed' : null, 'aria-label': label('notes.title') },
    bar, beside && tools, railStart, beside && colourPick.box, beside && footPick.box, !beside && railPop.box, deskWrap, beside && contentsBox, railEnd, deskTool, backBtn, fileInput, importInput, menuSheet, pickSheet);

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
    const side = beside ? 'below' : land ? (start ? 'right' : 'left') : start ? 'above' : 'below';
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
    railPop.box.classList.toggle('nb-pop--stamps', key === 'notes.pickStamp');
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
  let sheetW = 0, sheetH = 0;   // the page at the fitted size, CSS px
  let frame = { w: 0, h: 0 };   // what the page is seen through: the panel, or in the book the page itself
  let rect = { left: 0, top: 0 }; // where it is on screen: read once per press, not per point
  let view = { k: 1, x: 0, y: 0 };
  const margin = () => (beside ? parseFloat(getComputedStyle(el).getPropertyValue('--nb-page-margin')) || 16 : 0);
  const bookSize = () => ({ w: sheetW, h: sheetH });
  const tokens = names => { const c = getComputedStyle(el); return names.map(n => parseFloat(c.getPropertyValue(n)) || 0); };

  function place() {
    const k = view.k, tr = `translate(${view.x}px, ${view.y}px) scale(${k})`;
    book.style.setProperty('transform', tr);
    over.style.setProperty('transform', tr);
    over.style.setProperty('--nb-unzoom', String(1 / k));
    desk.toggleAttribute('data-zoomed', k > 1.001);
    drawScroll();
    if (heldOut() >= 0) paintLive(); // the live layer doesn't move with the page
  }
  function setView(next) { view = clampView(next, frame, bookSize(), margin()); place(); }
  // The fitted page; beside a card, from its top.
  function resetView() { setView({ k: 1, x: 0, y: margin() }); paintDetail(); }

  // Landscape or portrait, the layout and the size of everything in it.
  function layout() {
    if (document.activeElement?.classList.contains('nb-text')) return; // a keyboard is no rotation
    if (!beside) {
      el.dataset.orient = el.clientWidth > el.clientHeight ? 'landscape' : 'portrait';
      el.dataset.rails = railFit({ w: el.clientWidth, h: el.clientHeight });
    }
    fit();
    placeTool();
    zones?.draw();
  }

  function fit() {
    const w = deskWrap.clientWidth, hgt = deskWrap.clientHeight;
    if (!w || !hgt) return;
    const pad = margin();
    const was = frame.w;
    if (beside) {
      const k = fitScale({ w, h: hgt, pad, pageW: PAGE_W, pageH: PAGE_H, byWidth: true });
      sheetW = Math.max(10, Math.floor(PAGE_W * k));
      sheetH = Math.max(10, Math.floor(PAGE_H * k));
      frame = { w, h: hgt };
    } else {
      const [top, bottom, side, right, keep] = tokens(['--nb-book-top', '--nb-book-bottom', '--nb-book-side', '--nb-tab-want', '--nb-tab-keep']);
      const b = bookBox({ w, h: hgt, top, bottom, side, right, keep, pageW: PAGE_W, pageH: PAGE_H });
      sheetW = b.width;
      sheetH = b.height;
      frame = { w: sheetW, h: sheetH };
      for (const [p, v] of [['left', b.left], ['top', b.top], ['width', sheetW], ['height', sheetH]]) bk.el.style.setProperty(p, `${v}px`);
      // The tabs follow the page's edge: beside it where there is the room, or else over it.
      const room = w - b.left - sheetW, fits = tabFit(room), wide = Math.min(TAB_W[fits], Math.max(room, TAB_W.stub));
      el.dataset.tabs = fits;
      deskWrap.style.setProperty('--nb-tab-x', `${Math.min(b.left + sheetW, w - wide)}px`);
      deskWrap.style.setProperty('--nb-tab-w', `${wide}px`);
      deskWrap.style.setProperty('--nb-edge-top', `${b.top}px`);
      deskWrap.style.setProperty('--nb-edge-bottom', `${hgt - b.top - sheetH}px`);
      bk.el.style.setProperty('--nb-sheet-w', `${sheetW}px`);
    }
    scale = sheetW / PAGE_W;
    dpr = pixelRatio(window.devicePixelRatio);
    for (const box of [leaf.sheet, leaf.overlay]) { box.style.setProperty('width', `${sheetW}px`); box.style.setProperty('height', `${sheetH}px`); }
    base.width = Math.round(sheetW * dpr);
    base.height = Math.round(sheetH * dpr);
    clipped = false; // resizing a canvas resets it
    for (const c of [live, detail]) { c.width = Math.round(frame.w * dpr); c.height = Math.round(frame.h * dpr); }
    if (frame.w !== was) view = { k: 1, x: 0, y: pad };
    setView(view);
    if (ruler) ruler = clampRuler(ruler, PAGE_W, PAGE_H);
    drawRuler();
    redraw();
    maybeNudge(); // the first fit is the first moment the page's height is known
    if (!beside) { if (nb.view === 'contents') drawContents(); tabsKey = ''; drawTabs(); }
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
  // The page's own bitmap, in page units.
  const baseCtx = () => { const x = base.getContext('2d'); x.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); return x; };
  // A canvas the size of the frame, in page units, as the view shows it.
  const onView = c => {
    const a = dpr * view.k * scale;
    c.setTransform(a, 0, 0, a, dpr * view.x, dpr * view.y);
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
  // The item selected (or moved) is held out of the page's bitmap and drawn on the live layer, so
  // moving it redraws only it. Letting go bakes it back in, where it was among the rest.
  const heldOut = () => (drag ? drag.index : nb.selected);
  function renderLeaf(c) {
    renderPage(c, leaf.page, { assets: nb.assets, headerText: headerText(leaf.page), backdrop: backdropOf(leaf.page), skip: heldOut() });
  }
  // The animal in the corner of the paper: the page's first living thing with a silhouette. It is
  // the page's look, not something on it: it follows the tags, and is in no item.
  function backdropOf(page) {
    const id = (page.tags ?? []).find(tag => { const card = state.byId.get(tag); return card?.silhouette?.file && groupById(card.group)?.stampable; }) ?? null;
    if (id) stampAsset(id);
    return id;
  }
  function paintDetail() {
    const on = view.k > 1.001 && !gest && !swipe?.panned;
    detail.hidden = !on;
    if (!on) return;
    const c = detail.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, detail.width, detail.height);
    if (!leaf.page) return;
    c.save();
    onView(c);
    clipPage(c);
    renderLeaf(c);
    c.restore();
  }
  // The page, from its data.
  function redraw() {
    if (leaf.page) {
      const c = baseCtx();
      c.clearRect(0, 0, PAGE_W, PAGE_H);
      renderLeaf(c);
    }
    paintDetail();
    paintLive();
    drawSelection();
  }
  // Only what is on top of the page's bitmap: the item held out of it and the mark being made.
  function paintLive() {
    clearLive();
    const it = leaf.page?.items[heldOut()], mark = stroke?.item;
    if (it) renderItem(liveCtx(), it, nb.assets);
    if (mark && !(mark.t === 'w' && mark.l < WASHI_MIN)) renderItem(liveCtx(), mark, nb.assets);
  }
  // Rubbing out goes by the frame, however many marks one move takes off.
  let redrawFrame = 0;
  function redrawSoon() { redrawFrame ||= requestAnimationFrame(() => { redrawFrame = 0; redraw(); }); }
  // A new item on top: on the bitmaps as they are, with no redrawing of the rest.
  function addToPage(item) {
    appendItem(baseCtx(), item, nb.assets);
    if (detail.hidden) return;
    const c = detail.getContext('2d');
    c.save();
    onView(c);
    clipPage(c);
    appendItem(c, item, nb.assets);
    c.restore();
  }
  // The live layer is the size of the frame; a mark being made stays on the page.
  let clipped = false;
  function clearLive() {
    const c = live.getContext('2d');
    if (clipped) { c.restore(); clipped = false; }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, live.width, live.height);
  }
  function liveCtx() {
    const c = live.getContext('2d');
    if (clipped) c.restore();
    c.save();
    clipped = true;
    onView(c);
    clipPage(c);
    return c;
  }

  // Decoded pictures stay only for the pages near this one. The rest load again if they come back.
  function keepBitmaps(page) {
    nb.seen = [page, ...nb.seen.filter(p => p.id !== page.id)].slice(0, KEPT_PAGES);
    const keep = bitmapsIn(nb.seen);
    for (const kind of [nb.assets.photos, nb.assets.stickers]) {
      for (const [id, bmp] of kind) if (!keep.has(id)) { bmp?.close?.(); kind.delete(id); }
    }
  }
  // Photos and stamp pictures load on demand; the page redraws when they arrive.
  async function loadAssets(page) {
    for (const it of page.items) {
      if (it.t === 'p' && !nb.assets.photos.has(it.id)) {
        nb.assets.photos.set(it.id, null);
        notes.loadPhotoBlob(it.id).then(b => b && createImageBitmap(b)).then(bmp => { if (bmp) { nb.assets.photos.set(it.id, bmp); redrawSoon(); } }).catch(() => {});
      }
      if (it.t === 'm') stampAsset(it.card);
    }
  }
  function stampAsset(id) {
    if (nb.assets.stamps.has(id)) return nb.assets.stamps.get(id);
    const card = state.byId.get(id);
    const a = { emoji: groupById(card?.group)?.emoji ?? '🐾', img: null };
    if (card?.silhouette?.file) { a.img = new Image(); a.img.onload = () => redrawSoon(); a.img.src = card.silhouette.file; }
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
  async function loadSlot(id) {
    const page = await notes.loadPage(id);
    if (page) return page;
    // The file is missing (e.g. storage was cleared): show a blank page in its place.
    const rec = state.notes.find(r => r.pageId === id);
    return { ...notes.blankPage({ tags: rec?.tags ?? [] }), id, createdAt: rec?.createdAt, header: { date: rec?.createdAt ?? new Date().toISOString() } };
  }
  function clearLeaf() { leaf.page = null; leaf.draft = false; leaf.dirty = false; mount(tagsBox); }
  let showing = 0;
  async function show(pos, dir = 0) {
    const mine = ++showing;
    await flushSave();
    select(-1);
    nb.ids = listIds();
    if (!nb.ids.length && nb.scope?.kind !== 'animal') { await openContents(); return; }
    const at = clamp(pos, 0, Math.max(0, nb.ids.length - 1)), id = nb.ids[at] ?? null;
    const page = id ? await loadSlot(id) : notes.blankPage({ tags: nb.scope?.kind === 'animal' ? [nb.scope.id] : [] });
    if (mine !== showing) return;
    const was = turnsFrom(dir);
    const back = nb.view !== 'pages';
    setPane('pages');
    if (back) fit(); // out of the contents: the desk has only now got its size
    clearLeaf();
    leaf.page = page;
    leaf.draft = !id;
    nb.pos = at;
    nb.away = false;
    nb.undo = []; nb.redo = []; nb.selected = -1;
    drawTags();
    keepBitmaps(page);
    loadAssets(page);
    drawBar();
    drawTools();
    stopNudge();
    resetView();
    redraw();
    maybeNudge();
    unroll();
    if (was) playTurn(dir, was);
    else if (dir && beside && !reducedMotion()) {
      for (const box of [leaf.sheet, leaf.overlay]) box.animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }
  }
  // What a turn starts from, as a picture: the page, or a copy of the contents page. Only in the book,
  // once it is open.
  const pageFace = () => {
    if (nb.view === 'pages') return snapshot(base, sheetW, sheetH);
    const copy = contentsBox.cloneNode(true);
    copy.classList.add('nb-leaf__face');
    return copy;
  };
  const turnsFrom = dir => (dir && !beside && nb.ready && !shut && (leaf.page || nb.view === 'contents') ? pageFace() : null);
  function playTurn(dir, was) {
    if (reducedMotion()) fadePage(bk.turn, was);
    else turnPage(bk.turn, { dir, was, now: dir < 0 ? pageFace() : null });
  }
  // Which page a turn goes to. From a page that has left the list: the ones either side of its place.
  const target = d => (nb.away ? (d > 0 ? nb.pos : nb.pos - 1) : nb.pos + d);
  function canTurn(d) {
    if (beside) return nb.view === 'pages' && target(d) >= 0 && target(d) < nb.ids.length;
    if (nb.view === 'contents') return d < 0 ? nb.toc > 0 : nb.toc < nb.tocPages.length - 1 || bookEntries().length > 1;
    return d < 0 || target(d) < nb.ids.length; // back from a section's first page: the contents
  }
  function turn(d) {
    if (!canTurn(d)) return;
    haptic(8);
    if (nb.view === 'contents') {
      if (nb.toc + d < nb.tocPages.length) { tocTo(nb.toc + d, d); return; }
      const first = bookEntries()[1]; // past the contents: the first page of the first section
      const list = first.id === 'free' ? freePages(state.notes, known) : notes.pagesFor(first.id);
      openPage(first.scope, list[0].pageId, 1);
    } else if (!beside && target(d) < 0) openContents();
    else show(target(d), d);
  }
  // ＋: a new page tagged with the animal whose pages these are (on the free pages: a free page).
  async function newPage(scope = nb.scope) {
    await flushSave();
    // An empty new page is already showing.
    if (scope === nb.scope && nb.view === 'pages' && leaf.draft) return;
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
  async function openPage(scope, pageId, dir = 0) {
    await flushSave();
    if (nb.view === 'pages' && leaf.page?.id === pageId && !leaf.draft) { nb.scope = scope; nb.ids = listIds(); nb.pos = Math.max(0, nb.ids.indexOf(pageId)); nb.away = false; drawBar(); return; }
    nb.scope = scope;
    nb.ids = listIds();
    await show(Math.max(0, nb.ids.indexOf(pageId)), dir);
  }

  function drawBar() {
    const pages = nb.view === 'pages', n = nb.ids.length;
    counter.textContent = !pages ? '' : n ? `${nb.pos + 1} / ${n}` : '1 / 1';
    prev.disabled = !canTurn(-1);
    next.disabled = !canTurn(1);
    const home = nb.home && state.byId.get(nb.home);
    filterChip.hidden = !pages && !home;
    mount(filterChip, pages ? tx('notes.allPages') : home ? tx('notes.backTo', { name: home.name }) : null);
    if (beside) return;
    const fore = nb.tocPages.length;
    bk.depth(pages ? stackDepth(fore + Math.min(nb.pos, Math.max(0, n - 1)), fore + Math.max(n, 1)) : stackDepth(nb.toc, fore + state.notes.length));
    tabsBox.setAttribute('aria-label', label('notes.place', pages ? { n: Math.min(nb.pos + 1, Math.max(n, 1)), total: Math.max(n, 1) } : { n: nb.toc + 1, total: fore }));
    drawTabs();
  }
  // ---------- index tabs ----------
  // Contents, every animal with pages (in the contents' order, in its group's colour), the free pages.
  function bookEntries() {
    const toc = contentsOf(state.notes, id => state.byId.get(id) ?? null, state.groups);
    return [
      { id: 'contents', name: t('notes.contents') },
      ...toc.groups.flatMap(({ group, animals }) => animals.map(a => ({ id: a.cardId, group: group.id, emoji: group.emoji, name: a.card.name, scope: { kind: 'animal', id: a.cardId }, pageId: a.latest.pageId }))),
      ...(toc.free.length ? [{ id: 'free', name: t('notes.freePages'), scope: { kind: 'free' }, pageId: toc.free[toc.free.length - 1].pageId }] : []),
    ];
  }
  const placeId = () => (nb.view === 'contents' ? 'contents' : nb.scope?.kind === 'animal' ? nb.scope.id : nb.scope?.kind === 'free' ? 'free' : null);
  // One flip, whichever way the tab lies from the place.
  function jump(entry, entries) {
    if (entry.id === 'contents' || entry.id === 'more') { if (nb.view === 'contents') tocTo(0, -1); else openContents(); return; }
    const place = entries.findIndex(e => e.id === placeId());
    openPage(entry.scope, entry.pageId, entries.findIndex(e => e.id === entry.id) >= place ? 1 : -1);
  }
  let tabsKey = '';
  function drawTabs() {
    if (beside || !sheetH) return;
    const fits = el.dataset.tabs, entries = bookEntries(), place = placeId();
    const shown = tabsShown(entries, Math.max(0, entries.findIndex(e => e.id === place)), Math.max(2, Math.floor((sheetH - NAV_ROOM) / TAB_PITCH[fits])));
    const key = JSON.stringify([fits, place, getMode(), shown.map(e => e.id)]);
    if (key === tabsKey) return;
    tabsKey = key;
    mount(tabsBox, shown.map(e => {
      const name = e.id === 'more' ? t('notes.moreTabs') : e.name;
      return tabButton(e, { name, text: inLang(name), current: e.id === place, onclick: () => jump(e, entries) });
    }));
    fitLabels([...tabsBox.children], shown);
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
    mount(sizeBtn, h('span', { class: ['nb-size', `nb-size--${isFine(size) ? 'thin' : 'thick'}`], 'aria-hidden': 'true' }));
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
  // The objects on the roll and in the tray: the tool in use slid out of its loop, each tool showing
  // its colour, the roll's colours and slider for the drawing tool in hand (or last in it), the ink
  // on the pad and on the stamps' rubber, and the animal on the panda stamp.
  const rollTool = () => (DRAWING.includes(nb.tool) ? nb.tool : nb.lastDraw);
  function drawRails() {
    if (beside) return;
    for (const [id, b] of loops) {
      if (id === 'ruler') { b.setAttribute('aria-pressed', String(Boolean(ruler))); b.toggleAttribute('data-out', Boolean(ruler)); continue; }
      b.setAttribute('aria-pressed', String(id === nb.tool));
      b.toggleAttribute('data-raised', id === nb.tool && id !== toolOut());
      b.toggleAttribute('data-away', id === toolOut());
      if (DRAWING.includes(id)) b.style.setProperty('--tool-c', colourFor(id));
    }
    drawDeskTool();
    cloth.toggleAttribute('data-bare', nb.tool === 'eraser'); // nothing to choose for it
    const tool = rollTool();
    if (colourBox.dataset.tool !== tool) {
      colourBox.dataset.tool = tool;
      mount(colourBox, swatches(tool, rollColour));
    }
    colourBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.colour ?? b.dataset.hl) === colourOf(nb.set, tool))));
    sizeInput.value = String(SIZES.indexOf(sizeOf(nb.set, tool)));
    sizeInput.setAttribute('aria-valuetext', label(`notes.size.${sizeOf(nb.set, tool)}`));
    cloth.style.setProperty('--tool-c', colourFor(tool));
    el.style.setProperty('--ink-c', pencilColour(nb.set.ink));
    el.style.setProperty('--washi-c', `var(--nb-washi-${nb.set.washi})`);
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
  // The roll opens out the first time a page shows. The cloth and the window it is seen through move
  // opposite ways, so it stays put and only the edge travels: transforms, and nothing laid out.
  let unrolled = false;
  function unroll() {
    if (beside || unrolled || shut || nb.view !== 'pages') return;
    unrolled = true;
    if (reducedMotion()) return;
    const along = el.dataset.orient === 'portrait' ? 'X' : 'Y', timing = { duration: ROLL_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
    const end = 'var(--nb-roll-shut)';
    roll.animate([{ transform: `translate${along}(calc(-100% + ${end}))` }, { transform: 'none' }], timing);
    cloth.animate([{ transform: `translate${along}(calc(100% - ${end}))` }, { transform: 'none' }], timing);
  }
  // The tool in hand, out on the desk beside the roll, wherever the desk has the room for it. Measured
  // from the layout, not the screen, so the roll's own opening doesn't move it.
  let spot = null;
  const toolOut = () => (spot && !nb.stowed && (DRAWING.includes(nb.tool) || nb.tool === 'eraser') ? nb.tool : null);
  function placeTool() {
    if (beside || !el.clientWidth) return;
    const rail = railStart, cover = bk.el, [side, bottom, top, len, wide] = tokens(['--nb-book-side', '--nb-book-bottom', '--nb-book-top', '--nb-desk-tool-len', '--nb-desk-tool-w']);
    const left = rail.offsetLeft + roll.offsetLeft, up = rail.offsetTop + roll.offsetTop;
    const x = deskWrap.offsetLeft + cover.offsetLeft, y = deskWrap.offsetTop + cover.offsetTop;
    spot = deskSpot({
      w: el.clientWidth, h: el.clientHeight, len, wide, near: up + roll.offsetHeight / 2,
      roll: { left, top: up, right: left + roll.offsetWidth, bottom: up + roll.offsetHeight },
      book: { left: x - side, top: y - top, right: x + sheetW + side, bottom: y + sheetH + bottom },
    });
    el.toggleAttribute('data-desk-room', Boolean(spot));
    drawTools();
  }
  function drawDeskTool() {
    const id = toolOut();
    deskTool.hidden = !id;
    if (!id) { delete deskTool.dataset.tool; return; }
    deskTool.setAttribute('aria-label', label(`notes.tool.${id}`));
    deskTool.style.setProperty('--tool-c', colourFor(id));
    deskTool.style.setProperty('left', `${spot.x}px`);
    deskTool.style.setProperty('top', `${spot.y}px`);
    const lying = `translate(-50%, -50%) rotate(${spot.turn}rad)`;
    deskTool.style.setProperty('transform', lying);
    if (deskTool.dataset.tool === id) return;
    deskTool.dataset.tool = id;
    mount(deskTool, toolArt(id));
    if (reducedMotion()) return;
    const from = loops.get(id).getBoundingClientRect(), e = el.getBoundingClientRect();
    deskTool.animate([{ transform: `translate(-50%, -50%) translate(${from.left + from.width / 2 - e.left - spot.x}px, ${from.top + from.height / 2 - e.top - spot.y}px)` }, { transform: lying }], { duration: TOOL_OUT_MS, easing: 'ease-out' });
  }
  // The cover: tapped, it turns up over the spiral and the roll opens out. Back turns it down again
  // before the notebook goes. data-book stays set until it is clear of the page.
  let turning = false;
  async function openBook() {
    if (!shut || turning) return;
    turning = true;
    haptic(8);
    shut = false;
    el.dataset.book = 'opening';
    unroll();
    await turnCover(cover.el, { open: true, still: reducedMotion() });
    delete el.dataset.book;
    turning = false;
  }
  async function closeBook() {
    if (!cover || shut || turning) return;
    turning = true;
    closePicker();
    select(-1);
    el.dataset.book = 'closing';
    await turnCover(cover.el, { open: false, still: reducedMotion() });
    shut = true;
    el.dataset.book = 'closed';
    turning = false;
  }
  function setTool(id) {
    closePicker();
    nb.tool = id;
    nb.stowed = false;
    if (DRAWING.includes(id)) nb.lastDraw = id;
    select(-1);
    if (id === 'stamp' && !stampNow()) openStampPicker();
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

  // ---------- the roll and the tray ----------
  let popFor = null; // the tool whose popover is open
  const swatches = (tool, pick = setColour) => paletteOf(tool).map(id => h('button', {
    type: 'button', class: 'nb-colour', [tool === 'highlighter' ? 'data-hl' : 'data-colour']: id,
    'aria-pressed': String(colourOf(nb.set, tool) === id), 'aria-label': label(`notes.${tool === 'highlighter' ? 'hl' : 'colour'}.${id}`),
    onclick: () => pick(id, tool),
  }));
  // A colour or thickness from the roll is for drawing with: the tool it belongs to comes to hand.
  function rollColour(id, tool) { if (nb.tool !== tool) setTool(tool); setColour(id, tool); }
  function rollSize(size) { const tool = rollTool(); if (nb.tool !== tool) setTool(tool); setSize(size, tool); }
  function openRailPop(btn, tool, key, ...content) {
    toggleRailPop(btn, key, ...content);
    popFor = openPick === railPop ? tool : null;
  }
  // The ruler comes and goes on its own. Another tool comes to hand. The one out on the desk, or its
  // empty loop, goes back, and the pencil comes out: a finger always draws something. The pencil
  // itself goes back and stays raised in its loop, still in the hand, until it is tapped out again.
  function tapLoop(id) {
    if (id === 'ruler') { if (pulled) pulled = false; else putRuler(!ruler); return; }
    if (id !== nb.tool) { setTool(id); return; }
    if (!spot) return;
    if (nb.stowed) { nb.stowed = false; drawTools(); return; }
    if (id === 'pencil') { nb.stowed = true; drawTools(); return; }
    setTool('pencil');
  }
  const openInk = () => openRailPop(inkBtn, 'stamp', 'notes.ink', swatches('stamp'));
  function tapFootprints() {
    if (nb.tool !== 'roller') { setTool('roller'); return; }
    openRailPop(rackBtns.roller, null, 'notes.footPick', FEET.map(([id, icon]) => h('button', {
      type: 'button', class: 'nb-tool', 'data-foot': id, 'aria-pressed': String(nb.set.foot === id), 'aria-label': label(`notes.foot.${id}`),
      onclick: () => { closePicker(); setFoot(id); },
    }, h('span', { 'aria-hidden': 'true' }, icon))));
  }
  // The magnifying glass: for zooming without two fingers or a wheel.
  function zoomBy(k) {
    const c = { x: frame.w / 2, y: frame.h / 2 };
    view = pinchView(view, c, c, k, frame, bookSize(), margin());
    place();
    settle();
  }
  function openZoom() {
    const btn = (key, sign, fn) => h('button', { type: 'button', class: 'nb-tool', 'data-zoom': key, 'aria-label': label(`notes.zoom.${key}`), onclick: fn }, h('span', { 'aria-hidden': 'true' }, sign));
    toggleRailPop(rackBtns.zoom, 'notes.zoom', btn('in', '＋', () => zoomBy(ZOOM_STEP)), btn('out', '－', () => zoomBy(1 / ZOOM_STEP)), btn('reset', '⟲', () => resetView()));
  }
  // The tape: picked up, then tapped again for another roll.
  function tapWashi() {
    if (nb.tool !== 'washi') { setTool('washi'); return; }
    openRailPop(rackBtns.washi, null, 'notes.tool.washi', WASHI.map(id => h('button', {
      type: 'button', class: 'nb-colour nb-colour--washi', 'data-washi': id, 'aria-pressed': String(nb.set.washi === id), 'aria-label': label(`notes.colour.${id}`),
      onclick: () => { closePicker(); saveSet({ ...nb.set, washi: id }); },
    })));
  }
  // The panda stamp: picked up on its last animal, with a short row of the likely ones beside it. A
  // long press shows all of them.
  const stampCards = () => state.cards.filter(c => isCollected(c) && canStamp(c, groupById(c.group)));
  const stampNow = () => { const cards = stampCards(); return (cards.find(c => c.id === nb.set.stampCard) ?? cards[0])?.id ?? null; };
  let held = false, holdTimer = 0;
  function tapPanda() {
    if (held) { held = false; return; }
    const id = stampNow();
    if (!id) { openStampPicker(); return; }
    if (id !== nb.set.stampCard) saveSet({ ...nb.set, stampCard: id });
    if (nb.tool !== 'stamp') setTool('stamp');
    const can = card => stampCards().some(c => c.id === card);
    const pack = state.packs.filter(p => p.openedAt).at(-1)?.cardIds ?? [];
    const row = stampRow({ linked: leaf.page?.tags ?? [], recent: nb.set.stampRecent, pack, can });
    openRailPop(rackBtns.stamp, null, 'notes.pickStamp', (row.length ? row : [id]).map(cardId => {
      const card = state.byId.get(cardId);
      return h('button', {
        type: 'button', class: 'nb-tool nb-tool--stamp', 'data-card': cardId, 'aria-pressed': String(cardId === id), 'aria-label': label('notes.stampOf', { name: card.name }),
        onclick: () => { closePicker(); saveSet({ ...nb.set, stampCard: cardId }); },
      }, h('img', { src: card.silhouette.file, alt: '' }));
    }), h('button', { type: 'button', class: 'nb-tool', 'aria-label': label('notes.pickStamp'), onclick: () => { closePicker(); openStampPicker(); } }, h('span', { 'aria-hidden': 'true' }, '⋯')));
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
  // Ops: add { index, item }, remove { entries: [{ index, item }] }, change { index,
  // before, after }, tags (only the tags). Any op may also carry tags: { before, after } (a stamp
  // adds its animal).
  function apply(op, back) {
    const page = leaf.page, items = page.items;
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
    apply(op, false);
    nb.undo.push(op);
    nb.redo = [];
    // The held item changed: it is on the live layer, and the page's bitmap has no part in it.
    touched(onTop(op), op.kind === 'change' && op.index === heldOut());
  }
  function undo() { const op = nb.undo.pop(); if (!op) return; apply(op, true); nb.redo.push(op); nb.selected = -1; touched(); }
  function redo() { const op = nb.redo.pop(); if (!op) return; apply(op, false); nb.undo.push(op); nb.selected = -1; touched(onTop(op)); }
  // After any change: draw it and save soon (a draft page is saved for the first time). A tag
  // change is saved straight away, since it moves the page in or out of the list in view.
  function touched(added = null, onLive = false) {
    if (nb.selected >= (nb.page?.items.length ?? 0)) nb.selected = -1;
    leaf.dirty = true;
    if (added) { addToPage(added); paintLive(); drawSelection(); } else if (onLive) { paintLive(); drawSelection(); } else redraw();
    drawTools();
    clearTimeout(nb.saveTimer);
    if (nb.tagsChanged) { nb.tagsChanged = false; drawTags(); afterTags(); return; }
    nb.saveTimer = setTimeout(() => flushSave(), 400);
  }
  async function flushSave() {
    clearTimeout(nb.saveTimer);
    nb.saveTimer = 0;
    if (!leaf.page || !leaf.dirty) return;
    leaf.dirty = false;
    await notes.savePage(leaf.page);
    if (!leaf.draft) return;
    leaf.draft = false;
    nb.ids = listIds();
    nb.pos = Math.max(0, nb.ids.indexOf(leaf.page.id));
    drawBar();
  }
  // Whether the page open has left the list in view (its animal's tag removed, a free page tagged).
  // If so it stays open and the tabs carry on through that list from where it was, so its neighbours
  // are one turn away; a short note says where it went.
  async function afterTags() {
    await flushSave();
    const tags = (leaf.page.tags ?? []).filter(known);
    const inScope = nb.scope?.kind === 'animal' ? tags.includes(nb.scope.id) : !tags.length;
    nb.ids = listIds();
    if (inScope) { nb.away = false; nb.pos = Math.max(0, nb.ids.indexOf(leaf.page.id)); }
    else if (!nb.away) {
      nb.away = true;
      const card = state.byId.get(tags[0]);
      toast(card ? tx('notes.movedTo', { name: card.name }) : tx('notes.movedFree'));
    }
    drawBar();
  }
  function setTags(after) {
    const before = [...(leaf.page.tags ?? [])];
    if (after.length === before.length && after.every((id, i) => id === before[i])) return;
    commit({ kind: 'tags', tags: { before, after } });
  }

  // ---------- tag chips ----------
  // One chip per animal (its name and ✕), and "＋" for another collected animal.
  function drawTags() {
    if (!leaf.page) { mount(tagsBox); return; }
    const chips = (leaf.page.tags ?? []).filter(known).map(id => {
      const card = state.byId.get(id);
      return h('span', { class: 'nb-tag' },
        h('span', { class: 'nb-tag__name' }, bi(card.name)),
        h('button', { class: 'nb-tag__x', type: 'button', 'aria-label': label('notes.removeTag', { name: card.name }), onclick: () => setTags(withoutTag(leaf.page.tags, id)) },
          h('span', { 'aria-hidden': 'true' }, '✕')));
    });
    mount(tagsBox, chips, h('button', { class: 'nb-tag nb-tag--add', type: 'button', 'aria-label': label('notes.addTag'), onclick: () => openTagPicker() },
      h('span', { 'aria-hidden': 'true' }, '＋')));
  }

  // ---------- pointers ----------
  const fromFrame = e => [(e.clientX - rect.left - view.x) / view.k / scale, (e.clientY - rect.top - view.y) / view.k / scale];
  const pressureOf = e => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
  const palm = e => e.pointerType === 'touch' && (e.width > 60 || e.height > 60);
  let stroke = null;   // the mark being made, or a press that may be a tap: { id, t0, x, y, travel, item | tap }
  let erasing = null;  // { id, t0, entries } removed so far
  let drag = null;     // moving an item: { id, index, before, from, mode, t0 }
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

  // Whether a press is on the page, not on the book around it or the desk.
  function onPage(e) {
    const x = (e.clientX - rect.left - view.x) / view.k, y = (e.clientY - rect.top - view.y) / view.k;
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    return inside && x >= 0 && y >= 0 && x <= sheetW && y <= sheetH && Boolean(leaf.page);
  }
  const itemAt = (x, y) => hitItem(baseCtx(), leaf.page, x, y, 10, { movable: true });
  // The handles appear under the finger: the click ending this very tap (or a quick second tap
  // on a small item) must not land on ✕.
  let selectedAt = 0;
  function select(i) {
    const moved = i !== nb.selected;
    nb.selected = i;
    selectedAt = performance.now();
    if (moved) redraw(); else drawSelection();
  }
  // Only tweezers and the stamps select with a tap: with anything else a tap is that tool's.
  const selects = () => nb.tool === 'tweezers' || INKED.includes(nb.tool);
  // A tap on a photo, stamp or text.
  function tapSelect(x, y) {
    const i = itemAt(x, y);
    if (i < 0) return false;
    haptic(4);
    select(i);
    return true;
  }

  function down(e) {
    // In the contents a swipe may start on a link: the link keeps its tap, so nothing captures it.
    const reading = nb.view === 'contents';
    if (growing || shut || (beside && reading) || (!reading && e.target.closest('button, textarea')) || e.target.closest('.nb-tabs, .nb__nav') || (e.pointerType === 'mouse' && e.button)) return;
    stopNudge();
    rect = desk.getBoundingClientRect();
    if (e.pointerType === 'pen') { penDown = true; firstPen(); }
    if (e.pointerType === 'touch') {
      if (palm(e)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) secondFinger();
      if (touches.size > 1) return;
    }
    if (!reading) try { deskWrap.setPointerCapture(e.pointerId); } catch { /* gone */ }
    if (ruler && !reading && e.pointerType !== 'pen' && !penDown && overRuler(e)) {
      rulerMove = { id: e.pointerId, t0: performance.now(), start: ruler, from: fromFrame(e) };
      return;
    }
    const on = onPage(e);
    // Tweezers draw nothing, so fingers work them even in pen-only mode, but not with a pen down.
    if (on && nb.tool === 'tweezers' && !(penDown && e.pointerType === 'touch')) { grip(e); return; }
    if (!on || !draws(e)) { startSwipe(e); return; }
    const [x, y] = fromFrame(e), now = performance.now();
    if (nb.selected >= 0 && itemAt(x, y) === nb.selected) { pickUp(e, x, y); return; }
    const press = { id: e.pointerId, t0: now, x: e.clientX, y: e.clientY, travel: 0 };
    if (DRAWING.includes(nb.tool)) {
      const edge = ruler ? edgeAt(ruler, x, y, { inside: e.pointerType === 'pen' }) : 0;
      const [px, py] = edge ? snapTo(ruler, edge, x, y) : [x, y];
      const item = { t: 's', c: colourFor(nb.tool), w: widthOf(nb.tool, sizeOf(nb.set, nb.tool)), p: [px, py, pressureOf(e)] };
      if (nb.tool !== 'pencil') item.k = nb.tool; // no k: a pencil, as on every page before these
      stroke = { ...press, edge, item };
      // The live layer has no page under it: the browser multiplies it onto the page instead.
      if (item.k === 'highlighter') desk.dataset.blend = '';
      drawStroke(liveCtx(), item);
    } else if ((nb.tool === 'roller' || nb.tool === 'washi') && pageFull(leaf.page)) {
      stroke = { ...press, tap: [x, y] }; // only a tap on something still does anything
    } else if (nb.tool === 'roller') {
      stroke = { ...press, item: { t: 'f', c: pencilColour(nb.set.ink), k: nb.set.foot, p: [x, y] } };
    } else if (nb.tool === 'eraser' || nb.tool === 'sponge') {
      select(-1);
      erasing = { id: e.pointerId, t0: now, entries: [] };
      eraseAt(x, y);
    } else if (nb.tool === 'washi') {
      stroke = { ...press, from: [x, y], item: { t: 'w', k: nb.set.washi, x, y, l: 0, s: WASHI_W, r: 0 } };
    } else {
      stroke = { ...press, tap: [x, y] };
    }
  }

  // The selected item, starting to move. It stays put until the finger has gone further than a tap.
  function pickUp(e, x, y, fresh = false) {
    drag = { id: e.pointerId, index: nb.selected, before: structuredClone(leaf.page.items[nb.selected]), from: [x, y], mode: 'move', still: true, fresh, t0: performance.now() };
  }
  // The tweezers: one press selects what is under them and can already drag it. Bare paper lets go
  // only if it turns out to be a tap: it may be the first finger of a pinch on something small.
  function grip(e) {
    const [x, y] = fromFrame(e), i = itemAt(x, y);
    if (i < 0) { startSwipe(e); return; }
    const fresh = i !== nb.selected;
    if (fresh) { haptic(4); select(i); }
    pickUp(e, x, y, fresh);
  }

  function move(e) {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Fingers report one at a time: read them together, once a frame, or the first to report
    // looks like a change in their distance.
    if (gest) { gestFrame ||= requestAnimationFrame(moveGesture); return; }
    if (swipe?.id === e.pointerId) { moveSwipe(e); return; }
    if (rulerMove?.id === e.pointerId) {
      const [x, y] = fromFrame(e), { start, from } = rulerMove;
      ruler = clampRuler({ ...start, x: start.x + x - from[0], y: start.y + y - from[1] }, PAGE_W, PAGE_H);
      drawRuler();
      return;
    }
    const events = e.getCoalescedEvents?.() ?? [];
    const points = events.length ? events : [e];
    if (stroke?.id === e.pointerId) {
      stroke.travel = Math.max(stroke.travel, Math.hypot(e.clientX - stroke.x, e.clientY - stroke.y));
      const item = stroke.item;
      if (item?.t === 's') {
        const from = item.p.length;
        for (const ev of points) {
          const [x, y] = fromFrame(ev);
          item.p.push(...(stroke.edge && ruler ? snapTo(ruler, stroke.edge, x, y) : [x, y]), pressureOf(ev));
        }
        // A highlighter line is one path: drawn again whole, or its joints would show.
        if (item.k === 'highlighter') paintLive(); else drawStroke(liveCtx(), item, from);
      } else if (item?.t === 'f') {
        const [x, y] = fromFrame(e), p = item.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) > 6) {
          p.push(x, y);
          if (p.length === 4) stampFx('roller', e.clientX, e.clientY);
          paintLive();
        }
      } else if (item?.t === 'w') {
        // From where it was pressed to the finger.
        const [x, y] = fromFrame(e), [x0, y0] = stroke.from;
        item.x = (x0 + x) / 2; item.y = (y0 + y) / 2; item.l = Math.hypot(x - x0, y - y0); item.r = Math.atan2(y - y0, x - x0);
        paintLive();
      }
    } else if (erasing?.id === e.pointerId) {
      for (const ev of points) eraseAt(...fromFrame(ev));
    } else if (drag?.id === e.pointerId) {
      transformDrag(...fromFrame(e));
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
    const tap = isTap(s.travel, performance.now() - s.t0), had = nb.selected >= 0;
    paintLive();
    delete desk.dataset.blend;
    if (s.tap) {
      if (had) { select(-1); return; }
      const [x, y] = s.tap, i = itemAt(x, y);
      if (nb.tool === 'text' && i >= 0 && leaf.page.items[i].t === 'x') editText(x, y);
      // On a full page nearly every tap lands on something: the note has to come all the same.
      else if (i >= 0 && selects() && (tap || nb.tool !== 'roller')) { tapSelect(x, y); if (nb.tool !== 'tweezers') tooFull(); }
      else if (nb.tool === 'text') { if (!tooFull()) { stampFx('text', s.x, s.y); editText(x, y); } }
      else if (nb.tool === 'stamp') placeStamp(x, y, s.x, s.y);
      else tooFull();
      return;
    }
    if (s.item.t === 'w') {
      if (had) { select(-1); if (tap) return; }
      if (s.item.l < WASHI_MIN) { s.item.l = WASHI_TAP; s.item.r = 0; }
      commit({ kind: 'add', index: leaf.page.items.length, item: s.item });
      return;
    }
    if (tap && selects() && tapSelect(s.item.p[0], s.item.p[1])) return;
    if (had) select(-1);
    if (tap && had) return; // the tap let go of the selection: no dot
    if (s.item.t === 's' || s.item.p.length >= 4) commit({ kind: 'add', index: leaf.page.items.length, item: s.item });
  }

  // What the first finger was doing, undone: a second one has made this a gesture.
  function dropPress() {
    if (stroke) { stroke = null; paintLive(); delete desk.dataset.blend; }
    if (erasing) {
      const { entries } = erasing; erasing = null;
      if (entries.length) { apply({ kind: 'remove', entries }, true); redraw(); }
    }
    if (drag) {
      const d = drag; drag = null;
      leaf.page.items[d.index] = d.before;
      paintLive();
      drawSelection();
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
  // stamps, trails, text and tape. Photos have their ✕.
  function eraseAt(x, y) {
    const sponge = nb.tool === 'sponge';
    const i = hitItem(baseCtx(), leaf.page, x, y, sponge ? SPONGE_R : ERASE_R, sponge ? { stamped: true } : { lines: true });
    if (i < 0) return;
    // Its index in the page as it was before this rub started, for undo.
    const item = leaf.page.items[i];
    let orig = i;
    for (const en of [...erasing.entries].sort((a, b) => a.index - b.index)) if (en.index <= orig) orig++;
    erasing.entries.push({ index: orig, item });
    if (sponge) wipeFx(item, x, y);
    leaf.page.items.splice(i, 1);
    haptic(4);
    redrawSoon();
  }
  // What the sponge took fades off the paper as the sponge rocks over it. Drawn once onto a small
  // canvas of its own, then only its opacity changes, so a rub costs the tablet no redrawing.
  let spongeGhost = null;
  function wipeFx(item, x, y) {
    if (reducedMotion()) return;
    const b = boundsOf(baseCtx(), item), half = Math.hypot(b.w, b.h) / 2 + 8;
    const left = (b.cx - half) * scale, top = (b.cy - half) * scale, size = Math.ceil(half * 2 * scale);
    const wiped = h('canvas', { class: 'nb-wipe', 'aria-hidden': 'true', width: size, height: size, style: { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` } });
    const c = wiped.getContext('2d');
    c.setTransform(scale, 0, 0, scale, -left, -top);
    renderItem(c, item, nb.assets);
    selLayer.append(wiped);
    wiped.animate([{ opacity: 1 }, { opacity: 0 }], { duration: WIPE_MS, easing: 'ease-out' }).onfinish = () => wiped.remove();
    if (spongeGhost) return;
    const e = el.getBoundingClientRect(), k = scale * view.k;
    spongeGhost = h('div', { class: 'nb-ghost', 'aria-hidden': 'true', style: { left: `${rect.left - e.left + view.x + x * k}px`, top: `${rect.top - e.top + view.y + y * k}px` } }, spongeArt());
    el.append(spongeGhost);
    spongeGhost.animate([
      { transform: 'translate(-50%, -50%) rotate(-10deg)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) rotate(10deg)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%, -50%) rotate(-6deg)', opacity: 0 },
    ], { duration: WIPE_MS, easing: 'ease-in-out' }).onfinish = () => { spongeGhost.remove(); spongeGhost = null; };
  }
  function endErase() {
    const { entries } = erasing; erasing = null;
    // The marks are already gone from the page; record them so undo brings them back.
    if (entries.length) { nb.undo.push({ kind: 'remove', entries }); nb.redo = []; touched(); }
  }

  // ---------- two fingers on the page ----------
  // Handles lie close round something small, and a pinch on it can land on one. So every finger is
  // counted on its way down, handles or not: with two down the handles go, and a finger already on
  // one joins the pinch, its handle undone, as if it had landed on the paper.
  const fingers = new Map();
  let pinched = false; // two were down: nothing a finger lifts from counts until they have all gone
  function fingerDown(e) {
    if (e.pointerType !== 'touch' || !e.target.closest('.nb__desk')) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size !== 2) return;
    pinched = true;
    desk.dataset.fingers = '';
    rect = desk.getBoundingClientRect();
    if (drag && (drag.mode === 'resize' || drag.mode === 'rotate')) dropPress();
    for (const [id, p] of fingers) if (id !== e.pointerId && !touches.has(id)) touches.set(id, p);
    if (!e.target.closest('.nb-sel__h')) return;
    e.stopPropagation(); // its own press never happens
    touches.set(e.pointerId, fingers.get(e.pointerId));
    if (touches.size === 2) secondFinger();
  }
  function fingerUp(e) {
    fingers.delete(e.pointerId);
    if (fingers.size) return;
    delete desk.dataset.fingers;
    setTimeout(() => { if (!fingers.size) pinched = false; }); // after its own lift has been heard
  }

  // ---------- two fingers: zoom and pan; or resize & turn a selected item ----------
  const pts = () => [...touches.values()];
  const dist = () => { const [a, b] = pts(); return Math.hypot(a.x - b.x, a.y - b.y); };
  const angle = () => { const [a, b] = pts(); return Math.atan2(b.y - a.y, b.x - a.x); };
  const mid = () => { const [a, b] = pts(); return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }; };
  function startGesture() {
    stopNudge();
    clearTimeout(settleTimer);
    const m = mid();
    if (nb.selected >= 0 && itemAt(...fromFrame({ clientX: m.x + rect.left, clientY: m.y + rect.top })) === nb.selected) {
      const before = structuredClone(leaf.page.items[nb.selected]);
      gest = { item: true, d0: dist(), a0: angle(), before };
      drag = { id: -1, index: nb.selected, before, mode: 'pinch', t0: 0 };
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
      const it = leaf.page.items[drag.index], b = gest.before;
      if (it.t === 'f') it.p = movedTrail(b.p, { ...centreOf(b), k: clamp(ratio, 0.2, 5), a: angle() - gest.a0 });
      else { resizeItem(it, b, clamp(ratio, 0.2, 5)); it.r = (b.r ?? 0) + angle() - gest.a0; }
      paintLive(); drawSelection();
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
    if (nb.view === 'contents') view = { k: 1, x: 0, y: 0 }; // nothing to zoom: the book stays as it was
    const dir = swipeTurn({ dx: g.to.x - g.from.x, dy: g.to.y - g.from.y, span: g.d0, peak: g.peak, zoom: g.start.k, axis: beside ? 'x' : 'y' });
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
    select(-1); // the page's bitmap is what grows
    if (!reducedMotion()) await grow();
    onFull();
  }
  // The kraft spreads from the panel to the screen while the page goes to where it will lie (one
  // scale of each: transform only, nothing laid out again). They stay over everything for a moment
  // so the full notebook can draw under them, then fade.
  async function grow() {
    const w = window.innerWidth, hgt = window.innerHeight, from = el.getBoundingClientRect();
    const back = h('div', { class: 'nb-grow__back' }), box = h('div', { class: 'nb-grow', 'aria-hidden': 'true' }, back);
    document.body.append(box);
    const timing = { duration: GROW_MS, easing: 'ease-in-out' };
    back.animate([{ transform: `translate(${from.left}px, ${from.top}px) scale(${from.width / w}, ${from.height / hgt})` }, { transform: 'none' }], timing);
    if (nb.view === 'pages' && leaf.page) {
      const at = leaf.sheet.getBoundingClientRect(), land = w > hgt;
      const [rollSize, tray, top, bottom, side, right] = tokens([land ? '--nb-roll-w' : '--nb-roll-band', land ? '--nb-tray-w' : '--nb-tray-band', '--nb-book-top', '--nb-book-bottom', '--nb-book-side', '--nb-tab-want']);
      const keep = !land && w >= hgt * 0.5 ? right + TAB_KEEP_MORE : 0; // near enough: this only aims the growing page
      const to = fullPageBox({ w, h: hgt, roll: rollSize, tray, top, bottom, side, right, keep, pageW: PAGE_W, pageH: PAGE_H });
      const paper = h('canvas', {
        class: 'nb-grow__page', width: base.width, height: base.height,
        style: { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` },
      });
      paper.getContext('2d').drawImage(base, 0, 0);
      box.append(paper);
      paper.animate([{ transform: `translate(${at.left - to.left}px, ${at.top - to.top}px) scale(${at.width / to.width})` }, { transform: 'none' }], timing);
    }
    box.animate([{ opacity: 1 }, { opacity: 0 }], { delay: GROW_MS + GROW_HOLD_MS, duration: GROW_FADE_MS, fill: 'forwards' }).onfinish = () => box.remove();
    await new Promise(done => { setTimeout(done, GROW_MS); });
  }

  // ---------- the ruler ----------
  // On the page's top layer, so it moves and zooms with the page, and out of everything saved.
  let ruler = null;    // { x, y, r } while it is out of its loop (js/notes-ruler.js)
  let pulled = false;  // it was just dragged out: the click ending that isn't a tap on it
  const rulerEl = h('div', { class: 'nb-ruler', hidden: true, 'aria-hidden': 'true' }, rulerArt(RULER_L, RULER_H));
  over.append(rulerEl);
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
    const [x, y] = fromFrame(e);
    return onRuler(ruler, x, y, pad / (scale * view.k));
  }
  // Out across the page, or back in its loop.
  function putRuler(out) {
    if (nb.view !== 'pages') return;
    ruler = out ? { x: PAGE_W / 2, y: PAGE_H / 2, r: 0 } : null;
    drawRuler();
    drawTools();
  }
  function endRulerMove(e) {
    rulerMove = null;
    const b = roll && roll.getBoundingClientRect();
    const home = b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
    if (home) putRuler(false);
  }
  function startRulerTurn() {
    const m = mid();
    gest = { ruler: true, start: ruler, a0: angle(), from: fromFrame({ clientX: m.x + rect.left, clientY: m.y + rect.top }) };
  }
  function turnRuler() {
    const m = mid(), [x, y] = fromFrame({ clientX: m.x + rect.left, clientY: m.y + rect.top }), { start, from, a0 } = gest;
    ruler = clampRuler({ x: start.x + x - from[0], y: start.y + y - from[1], r: start.r + angle() - a0 }, PAGE_W, PAGE_H);
    drawRuler();
  }
  // Pulled out of its loop: it follows the finger from the moment it leaves, and goes back if let
  // go off the page.
  if (!beside) {
    const b = loops.get('ruler');
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
      const [x, y] = fromFrame(e);
      ruler = clampRuler({ x, y, r: 0 }, PAGE_W, PAGE_H);
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
  // Beside the page, or anywhere when only a pen draws. In the book: up and down turns the page. In
  // the panel: sideways does, and up and down pans a page taller than it. Zoomed in, it pans any way.
  // Tweezers on bare paper only pan.
  function startSwipe(e) { swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), start: view, axis: null, panned: false }; }
  function moveSwipe(e) {
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.axis && Math.hypot(dx, dy) > 8) swipe.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (!swipe.axis) return;
    const zoomed = view.k > 1;
    if (!zoomed && (!beside || swipe.axis !== 'y')) return;
    swipe.panned = true;
    detail.hidden = true;
    setView({ ...swipe.start, x: swipe.start.x + (zoomed ? dx : 0), y: swipe.start.y + dy });
  }
  function endSwipe(e) {
    const sw = swipe; swipe = null;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (sw.panned) { settle(); return; }
    if (isTap(Math.hypot(dx, dy), performance.now() - sw.t0)) {
      if (!(onPage(e) && selects() && tapSelect(...fromFrame(e))) && nb.selected >= 0) select(-1);
      return;
    }
    // A grab that missed must not lose the page.
    const along = beside ? dx : dy, across = beside ? dy : dx;
    if (nb.tool !== 'tweezers' && (!beside || sw.axis !== 'y') && Math.abs(along) > 60 && Math.abs(along) > Math.abs(across) * 1.4) turn(along < 0 ? 1 : -1);
  }

  // ---------- move / resize / turn ----------
  // Kept between a small chip and the width of the page, so nothing gets lost off the paper.
  function resizeItem(it, b, k) {
    if (it.t === 'p') {
      const long = Math.max(b.w, b.h);
      const kk = clamp(k, 80 / long, PAGE_W / long);
      it.w = b.w * kk; it.h = b.h * kk;
    } else if (it.t === 'f') it.p = movedTrail(b.p, { ...centreOf(b), k });
    else if (it.t === 'w') it.l = clamp(b.l * k, WASHI_MIN, PAGE_H);
    else it.s = clamp(b.s * k, 16, it.t === 'm' ? 480 : 160);
  }
  const centreOf = trail => { const { cx, cy } = boundsOf(null, trail); return { cx, cy }; };
  function transformDrag(x, y) {
    const it = leaf.page.items[drag.index], b = drag.before;
    if (drag.mode === 'move') {
      const dx = x - drag.from[0], dy = y - drag.from[1];
      if (drag.still) {
        if (isTap(Math.hypot(dx, dy) * scale * view.k, 0)) return; // a tap's wobble moves nothing
        drag.still = false;
      }
      if (it.t === 'f') it.p = movedTrail(b.p, { dx, dy });
      else { it.x = b.x + dx; it.y = b.y + dy; }
    } else {
      const box = boundsOf(baseCtx(), b);
      if (drag.mode === 'resize') {
        const k = Math.hypot(x - box.cx, y - box.cy) / Math.max(1, Math.hypot(drag.from[0] - box.cx, drag.from[1] - box.cy));
        resizeItem(it, b, Math.max(0.2, Math.min(5, k)));
      } else if (drag.mode === 'rotate') {
        const a = Math.atan2(y - box.cy, x - box.cx) - Math.atan2(drag.from[1] - box.cy, drag.from[0] - box.cx);
        if (it.t === 'f') it.p = movedTrail(b.p, { cx: box.cx, cy: box.cy, a });
        else it.r = (b.r ?? 0) + a;
      }
    }
    paintLive(); drawSelection();
  }
  function endDrag() {
    const d = drag; drag = null;
    const items = leaf.page.items;
    const after = structuredClone(items[d.index]);
    if (JSON.stringify(after) === JSON.stringify(d.before)) {
      paintLive();
      drawSelection();
      // A second tap, soon, on text that was already selected.
      if (d.mode === 'move' && d.still && !d.fresh && after.t === 'x' && performance.now() - selectedAt < DOUBLE_TAP_MS) editSelected();
      return;
    }
    items[d.index] = d.before;
    commit({ kind: 'change', index: d.index, before: d.before, after });
  }
  // The selection box, with a handle to resize, one to turn and a delete button. Kept while it
  // moves: a handle being dragged must stay the same element.
  let selBox = null, selEdit = null;
  function makeSelBox() {
    const box = h('div', { class: 'nb-sel' });
    const handle = (mode, cls, glyph, key) => {
      const el2 = h('button', { type: 'button', class: ['nb-sel__h', cls], 'aria-label': label(key) }, glyph);
      el2.addEventListener('pointerdown', e => {
        e.stopPropagation();
        rect = desk.getBoundingClientRect();
        try { el2.setPointerCapture(e.pointerId); } catch { /* gone */ }
        drag = { id: e.pointerId, index: nb.selected, before: structuredClone(leaf.page.items[nb.selected]), from: fromFrame(e), mode, t0: 0 };
      });
      el2.addEventListener('pointermove', e => { if (drag?.id === e.pointerId) transformDrag(...fromFrame(e)); });
      el2.addEventListener('pointerup', e => { if (drag?.id === e.pointerId) endDrag(); });
      return el2;
    };
    const remove = () => {
      if (pinched || nb.selected < 0 || performance.now() - selectedAt < SETTLE_MS) return;
      const i = nb.selected;
      nb.selected = -1;
      commit({ kind: 'remove', entries: [{ index: i, item: nb.page.items[i] }] });
    };
    const del = h('button', { type: 'button', class: 'nb-sel__h nb-sel__del', 'aria-label': label('notes.delete'), onclick: remove }, '✕');
    // As with ✕, the first tap after dragging a handle can come without a click, so the finger lifting
    // counts. But the box to type in must open after any click, or that click would close it: the
    // lift waits a moment for one. Only a press on ✎ itself counts, never a drag ending here.
    let pressed = false, lifted = 0;
    const go = () => { clearTimeout(lifted); lifted = 0; if (!pinched) editSelected(); };
    selEdit = h('button', {
      type: 'button', class: 'nb-sel__h nb-sel__edit', 'aria-label': label('notes.editText'),
      onclick: e => { if (lifted || !e.detail) go(); }, // no detail: the keyboard
    }, '✎');
    selEdit.addEventListener('pointerdown', () => { pressed = true; });
    selEdit.addEventListener('pointerup', () => { if (pressed && !pinched) lifted = setTimeout(go, EDIT_LIFT_MS); pressed = false; });
    selEdit.addEventListener('pointercancel', () => { pressed = false; });
    // The first tap after dragging a handle can come without a click: the finger lifting counts too.
    del.addEventListener('pointerup', remove);
    box.append(handle('resize', 'nb-sel__resize', '⤡', 'notes.resize'), handle('rotate', 'nb-sel__rotate', '⟳', 'notes.rotate'), del, selEdit);
    return box;
  }
  // The selected text, in its box to type in.
  function editSelected() {
    const it = leaf.page?.items[nb.selected];
    if (it?.t !== 'x') return;
    const b = boundsOf(baseCtx(), it);
    select(-1);
    editText(b.cx, b.cy);
  }
  function drawSelection() {
    const item = nb.selected >= 0 ? leaf.page?.items[nb.selected] : null;
    if (!item) { selBox?.remove(); selBox = null; return; }
    selBox ??= makeSelBox();
    if (selBox.parentNode !== selLayer) selLayer.append(selBox);
    selEdit.hidden = item.t !== 'x';
    const b = boundsOf(baseCtx(), item);
    selBox.style.setProperty('left', `${(b.cx - b.w / 2) * scale}px`);
    selBox.style.setProperty('top', `${(b.cy - b.h / 2) * scale}px`);
    selBox.style.setProperty('width', `${b.w * scale}px`);
    selBox.style.setProperty('height', `${b.h * scale}px`);
    selBox.style.setProperty('transform', `rotate(${b.r}rad)`);
  }

  // ---------- text ----------
  function editText(x, y) {
    const hit = hitItem(baseCtx(), leaf.page, x, y, 6, { movable: true });
    const existing = hit >= 0 && leaf.page.items[hit].t === 'x' ? hit : -1;
    const item = existing >= 0 ? leaf.page.items[existing] : { t: 'x', c: pencilColour(nb.set.ink), s: TEXT_SIZE, x, y, v: '' };
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
        if (!v) commit({ kind: 'remove', entries: [{ index: existing, item }] });
        else if (v !== item.v) commit({ kind: 'change', index: existing, before: item, after: { ...item, v } });
      } else if (v) commit({ kind: 'add', index: leaf.page.items.length, item: { ...item, v } });
    };
    area.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    });
    area.addEventListener('blur', () => finish(true));
    selLayer.append(area);
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
    pickSheet.classList.remove('nb-pick--binder');
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
  // Every stamp this explorer has, the binder's way: its groups as tabs, one group's tiles at a time.
  function openStampPicker() {
    const cards = stampCards();
    if (!cards.length) { pickAnimal({ icon: '🐾', titleKey: 'notes.pickStamp', emptyKey: 'notes.noStamps', cards }); return; }
    const groups = state.groups.filter(g => cards.some(c => c.group === g.id));
    const now = state.byId.get(stampNow());
    let group = groups.find(g => g.id === now.group);
    const tabs = h('nav', { class: 'tabs', 'aria-label': label('nav.groups') });
    const grid = h('div', { class: 'grid' });
    const page = h('div', { class: 'binder__page' }, grid);
    const binder = h('section', { class: 'binder nb-pick__binder' }, tabs, page);
    const pick = card => { pickSheet.close(); nb.tool = 'stamp'; saveSet({ ...nb.set, stampCard: card.id }); };
    const draw = () => {
      binder.dataset.group = group.id;
      mount(tabs, groups.map(g => groupTab(g, { active: g === group, count: String(cards.filter(c => c.group === g.id).length), onclick: () => { group = g; draw(); } })));
      mount(grid, cards.filter(c => c.group === group.id).map(card => h('button', { type: 'button', class: 'tile', 'data-group': card.group, 'data-card': card.id, onclick: () => pick(card) }, tileFace(card))));
      page.scrollTop = 0;
    };
    draw();
    mount(pickSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '🐾'), tx('notes.pickStamp')),
      binder,
      h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--soft', type: 'button', onclick: () => pickSheet.close() }, tx('card.close'))));
    pickSheet.classList.add('nb-pick--binder');
    pickSheet.showModal();
  }
  // Only animals this explorer has collected, and not already on the page.
  function openTagPicker() {
    const tags = leaf.page?.tags ?? [];
    pickAnimal({ icon: '🏷️', titleKey: 'notes.pickTag', emptyKey: 'notes.noTags', cards: state.cards.filter(c => isCollected(c) && !tags.includes(c.id)),
      onPick: card => setTags(withTag(leaf.page.tags ?? [], card.id)) });
  }
  // A stamp also tags the page with its animal (once); removing the stamp leaves the tag.
  function placeStamp(x, y, screenX, screenY) {
    const card = stampNow();
    if (!card) { openStampPicker(); return; }
    if (tooFull()) return;
    stampAsset(card);
    stampFx('stamp', screenX, screenY);
    if (nb.set.stampRecent[0] !== card) saveSet({ ...nb.set, stampCard: card, stampRecent: usedStamp(nb.set.stampRecent, card) });
    const before = [...(leaf.page.tags ?? [])], after = tagsAfterStamp(before, card);
    commit({
      kind: 'add', index: leaf.page.items.length, item: { t: 'm', c: pencilColour(nb.set.ink), card, x, y, s: STAMP_SIZE, r: 0 },
      ...(after.length !== before.length && { tags: { before, after } }),
    });
  }

  // ---------- contents ----------
  // Binder groups with the animals that have pages (count, latest page), each page listed
  // under every animal it is tagged with ("also in" the others); then the free pages.
  // In the book it lies on pages of its own, the first in the notebook; beside a card it is a list.
  async function openContents({ dir = -1, page = 0 } = {}) {
    const mine = ++showing;
    await flushSave();
    if (mine !== showing) return;
    select(-1);
    const was = turnsFrom(dir);
    setPane('contents');
    clearLeaf();
    nb.toc = page;
    resetView();
    drawSelection();
    drawContents();
    drawBar();
    if (was) playTurn(dir, was);
  }
  function tocTo(page, dir) {
    if (page === nb.toc) return;
    const was = turnsFrom(dir);
    nb.toc = page;
    drawContents();
    drawBar();
    if (was) playTurn(dir, was);
  }
  const pages = n => tx(n === 1 ? 'notes.pageCount.one' : 'notes.pageCount.many', { n });
  const shortDate = iso => bi(dateText(iso, { year: 'numeric', month: 'short', day: 'numeric' }));
  // Each row of the contents: a heading or a link, text only.
  function tocRows() {
    const toc = contentsOf(state.notes, id => state.byId.get(id) ?? null, state.groups);
    const free = { kind: 'free' };
    const link = (attrs, onclick, name, ...meta) => h('button', { class: 'nb-toc__link', type: 'button', onclick, ...attrs },
      h('span', { class: 'nb-toc__name' }, name), h('span', { class: 'nb-toc__meta' }, meta));
    const heading = (attrs, icon, name) => ({ head: true, el: h('h3', { class: 'nb-toc__heading', ...attrs }, h('span', { 'aria-hidden': 'true' }, icon), name) });
    return [
      ...toc.groups.flatMap(({ group, animals }) => [
        heading({ 'data-group': group.id }, group.emoji, bi(group.name)),
        ...animals.map(a => ({ el: link({ 'data-card': a.cardId }, () => openPage({ kind: 'animal', id: a.cardId }, a.latest.pageId, 1), bi(a.card.name), pages(a.count), ' · ', shortDate(a.latest.editedAt ?? a.latest.createdAt)) })),
      ]),
      heading({}, '📝', tx('notes.freePages')),
      ...toc.free.map(r => ({ el: link({ 'data-free': r.pageId }, () => openPage(free, r.pageId, 1), shortDate(r.createdAt), shortDate(r.editedAt ?? r.createdAt)) })),
      { el: h('button', { class: 'nb-toc__link nb-toc__new', type: 'button', onclick: () => newPage(free) }, h('span', { class: 'nb-toc__name' }, h('span', { 'aria-hidden': 'true' }, '＋ '), tx('notes.newFreePage'))) },
    ];
  }
  function drawContents() {
    const rows = tocRows();
    const title = h('h2', { class: 'nb-toc__title' }, tx('notes.contents'), underlineArt());
    const empty = !state.notes.length && h('p', { class: 'nb-toc__empty' }, tx('notes.empty'));
    if (beside) { mount(contentsBox, title, empty, rows.map(r => r.el)); contentsBox.scrollTop = 0; return; }
    const [pad, row] = tokens(['--nb-toc-pad', '--nb-toc-row']), perPage = Math.max(2, Math.floor((sheetH - pad * 2) / row));
    nb.tocPages = paginate(rows, { perPage, first: Math.max(1, perPage - (empty ? 4 : 2)) });
    nb.toc = clamp(nb.toc, 0, nb.tocPages.length - 1);
    mount(contentsBox, !nb.toc && title, !nb.toc && empty, nb.tocPages[nb.toc].map(r => r.el));
    contentsBox.style.setProperty('--nb-sheet-w', `${sheetW}px`);
  }

  // ---------- photos ----------
  async function addPhoto(file) {
    fileInput.value = '';
    if (!file || !nb.page || tooFull()) return;
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

  // From the pile: it waits on the desk, developing, until a finger carries it to the page.
  const desktop = beside ? null : polaroids({ host: el, pile: pileBtn, label: label('notes.tool.photo'), onDrop: dropPhoto });
  async function pickedPhoto(file) {
    fileInput.value = '';
    if (!file) return;
    try {
      const shot = await notes.shrinkPhoto(file), bmp = await createImageBitmap(shot.blob);
      desktop.add(shot, bmp);
      bmp.close?.();
    } catch (err) {
      console.error(err);
      toast(tx('notes.photoFailed'));
    }
  }
  // Let go over the page: kept, and on the page a little askew, wherever it was let go.
  async function dropPhoto(shot, screenX, screenY) {
    rect = desk.getBoundingClientRect();
    const at = { clientX: screenX, clientY: screenY };
    if (nb.view !== 'pages' || !onPage(at) || tooFull()) return false;
    try {
      const [x, y] = fromFrame(at), { id, w, h: ph } = await notes.keepPhoto(shot), k = Math.min(PHOTO_SIZE / w, PHOTO_SIZE / ph);
      nb.assets.photos.set(id, await createImageBitmap(shot.blob));
      commit({ kind: 'add', index: leaf.page.items.length, item: { t: 'p', id, x, y, w: w * k, h: ph * k, r: (Math.random() * 2 - 1) * PHOTO_TILT } });
      return true;
    } catch (err) {
      console.error(err);
      toast(tx('notes.photoFailed'));
      return false;
    }
  }

  // ---------- menu: paper, export, import, delete ----------
  function openMenu() {
    const open = nb.view === 'pages' && nb.page;
    const item = (icon, key, fn, cls = 'btn--soft') => h('button', { class: ['btn', cls], type: 'button', onclick: async () => { menuSheet.close(); await fn(); } },
      h('span', { 'aria-hidden': 'true' }, icon), tx(key));
    mount(menuSheet,
      h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '📓'), tx('notes.title')),
      h('div', { class: 'nb-menu__list' },
        !beside && open && item('📑', 'notes.allPages', () => openContents()),
        open && item(leaf.page.paper === 'grid' ? '⠿' : '▦', leaf.page.paper === 'grid' ? 'notes.paperDots' : 'notes.paperGrid', async () => {
          leaf.page.paper = leaf.page.paper === 'grid' ? 'dots' : 'grid'; leaf.dirty = true; await flushSave(); redraw();
        }),
        open && item('🖼️', 'notes.exportPage', () => exportPageImage(leaf.page, { assets: nb.assets, headerText: headerText(leaf.page), backdrop: backdropOf(leaf.page) }).catch(() => toast(tx('notes.exportFailed')))),
        item('📦', 'notes.exportAll', async () => { await flushSave(); await exportAll().catch(() => toast(tx('notes.exportFailed'))); }),
        folderSupported() && item('📁', 'notes.toFolder', async () => { await flushSave(); await saveToFolder().catch(() => {}); }),
        item('📥', 'notes.import', () => importInput.click()),
        open && !leaf.draft && item('🗑️', 'notes.deletePage', async () => {
          if (!window.confirm(label('notes.deleteConfirm'))) return;
          await notes.deletePage(leaf.page.id);
          leaf.page = null; leaf.dirty = false;
          await show(nb.pos);
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
      if (nb.view === 'contents') await openContents({ dir: 0, page: nb.toc }); else await show(nb.pos);
    } catch (err) {
      console.error(err);
      toast(tx('notes.importFailed'));
    }
  }

  // The page has all it can take: a note on the desk, and nothing is placed.
  function tooFull() {
    if (!pageFull(leaf.page)) return false;
    haptic(8);
    toast(tx('notes.pageFull'), 'note');
    return true;
  }
  let toastTimer = 0;
  function toast(content, kind = null) {
    el.querySelector('.nb__toast')?.remove();
    const tEl = h('p', { class: ['nb__toast', kind && `nb__toast--${kind}`], role: 'status' }, content);
    el.append(tEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => tEl.remove(), 3500);
  }

  // ---------- wiring ----------
  deskWrap.addEventListener('pointerdown', fingerDown, true);
  for (const ev of ['pointerup', 'pointercancel']) deskWrap.addEventListener(ev, fingerUp, true);
  deskWrap.addEventListener('pointerdown', down);
  deskWrap.addEventListener('pointermove', move);
  deskWrap.addEventListener('pointerup', up);
  deskWrap.addEventListener('pointercancel', cancelled);
  // The wheel pans, ctrl + wheel (a trackpad's pinch too) zooms: a mouse has no second finger.
  deskWrap.addEventListener('wheel', e => {
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
  ro.observe(deskWrap);

  // ?debug=taps: every tap zone outlined with its size (js/notes-debug.js).
  const zones = !beside && debugOn('taps') ? tapZones(el) : null;
  // ?debug=notes: a very full page, and what it costs to draw (js/notes-debug.js).
  if (debugOn('notes')) {
    window.wfNotes = {
      async heavy(stamps, trails) {
        const cards = state.cards.filter(c => c.silhouette?.file).map(c => c.id);
        const page = notes.blankPage();
        page.items = heavyItems(cards, PAGE_W, PAGE_H, stamps, trails);
        await notes.savePage(page);
        await openPage({ kind: 'free' }, page.id);
        return page.id;
      },
      async bench(n = 5) {
        const bake = await timed(n, redraw, base);
        setView({ k: 2, x: 0, y: 0 });
        const zoomSettle = await timed(n, paintDetail, detail);
        resetView();
        const turn = await timed(n, () => show(nb.pos), base);
        return { items: leaf.page?.items.length, bake, zoomSettle, turn };
      },
    };
  }

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
    nb.ready = true;
    drawBar();
    zones?.draw();
    // Text is drawn on the canvas: it needs its font before it can look right.
    document.fonts?.load(`${TEXT_SIZE}px "WildFile Notes"`).then(() => { if (leaf.page) redraw(); tabsKey = ''; drawTabs(); }).catch(() => {});
  });

  // The list to open the page in again: its own, if it has left the one in view.
  function placeOf() {
    if (!nb.away) return nb.scope;
    const tag = (leaf.page?.tags ?? []).find(known);
    return tag ? { kind: 'animal', id: tag } : { kind: 'free' };
  }

  return {
    el,
    // Where the notebook is, to open there again: the contents, or a page in a list.
    where: () => ({ view: nb.view, scope: placeOf(), pageId: nb.view === 'pages' && leaf.page && !leaf.draft ? leaf.page.id : null }),
    async destroy() {
      ro.disconnect();
      toolsRo.disconnect();
      closePicker();
      stopNudge();
      desktop?.clear();
      zones?.remove();
      clearTimeout(settleTimer);
      cancelAnimationFrame(redrawFrame);
      cancelAnimationFrame(gestFrame);
      document.removeEventListener('keydown', onKey, true);
      await flushSave();
      for (const bmp of nb.assets.photos.values()) bmp?.close?.();
    },
  };
}
