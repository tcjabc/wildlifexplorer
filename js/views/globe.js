// Globe tab: every collected card as a round photo pin on a spinning Earth (js/globe.js).
//
// Where a card's pin goes, first match wins:
//   card.pin {lat, lng}         your own spot, for any card
//   card.fossilSite {lat, lng}  Prehistoric: a famous fossil site
//   card.place {lat, lng}       World Explorer: the place itself
//   card.range                  species: the middle of its range shape
// Cards with none of these (topics, most microscopic life) are not on the globe.
//
// Pins that overlap merge into a stack with a count; tapping a stack zooms in and fans
// the pins out. Tapping a pin lights up that species' range and opens its card sheet.
//
// #/globe/<card id> (from a card's map): that animal's range lit up and in view, and a
// "Back to card" button (Esc, or the device's back button, does the same) that returns to
// the card as it was (js/card-return.js). #/globe on its own is the Globe tab as always.
import { h, mount, reducedMotion } from '../dom.js';
import { bi, t, tx, label, plain } from '../i18n.js';
import { state, isVisible, groupById, thumbOf, mainImage, debugOn, updateProfile } from '../store.js';
import { INFO, panelMode } from '../globe-info.js';
import { ART, animal, tree } from '../globe-art.js';
import { picture, groupTitle, cardNo } from '../components.js';
import { createGlobe, toVec, rangeFit, nightShade } from '../globe.js';
import { cameFromMap } from '../card-return.js';
import { loadRange, rangePolygons } from '../worldmap.js';
import { track, haptic } from '../gesture.js';
import { nameBi } from '../zhuyin.js';
import { LAYERS, tempStops } from '../layers.js';
import { tempText } from '../units.js';

const NEAR_SIDE = 0.06;   // pins this close to the rim fade out
const TOUCH = 0.8;        // pins closer than this many pin widths stack up
const FAN_MS = 300;

let globe = null;
let sheet = null;          // { el, scrim, pin }
// The map layer and month, kept while visiting other tabs.
let shownLayer = null;
let shownFilter = null;   // { key: 'continents' | 'biomes', id }: only show pins with that tag
let tempMonth = new Date().getMonth() + 1;
let goBack = null;         // "Back to card", while the globe was opened from a card
let closePanel = null;     // folds the info panel back when it is open over the globe

// ---------- where pins go ----------

const ll = p => (Number.isFinite(p?.lat) && Number.isFinite(p?.lng) ? [p.lng, p.lat] : null);

// Shoelace area and centroid of a ring in degrees (fine at range-map scale).
function ringStats(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const f = xj * yi - xi * yj;
    a += f; x += (xj + xi) * f; y += (yj + yi) * f;
  }
  return a ? { area: Math.abs(a / 2), x: x / (3 * a), y: y / (3 * a) } : { area: 0, x: ring[0][0], y: ring[0][1] };
}

function inside(rings, x, y) {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

// The middle of the biggest part of a range. If that falls outside the shape (a crescent,
// a ring of coast), the nearest point inside it instead.
function rangeCentre(polys) {
  let best = null;
  for (const rings of polys) {
    const s = ringStats(rings[0]);
    if (!best || s.area > best.s.area) best = { rings, s };
  }
  if (!best) return null;
  const { rings, s } = best;
  if (inside(rings, s.x, s.y)) return [s.x, s.y];
  const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
  const [w, e, so, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let pick = rings[0][0], d = Infinity;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const x = w + ((e - w) * i) / 24, y = so + ((n - so) * j) / 24;
    const dd = (x - s.x) ** 2 + (y - s.y) ** 2;
    if (dd < d && inside(rings, x, y)) { d = dd; pick = [x, y]; }
  }
  return pick;
}

async function placeOf(card) {
  const fixed = ll(card.pin) ?? ll(card.fossilSite) ?? ll(card.place);
  if (fixed) return fixed;
  if (!card.range) return null;
  return rangeCentre(rangePolygons(await loadRange(card.range)));
}

// ---------- pins ----------

function pinEl(card, onTap) {
  const img = mainImage(card);
  return h('button', {
    class: 'gpin', type: 'button', 'data-group': card.group, 'aria-label': plain(card.name), onclick: onTap,
  },
  img?.file
    ? h('img', { class: 'gpin__img', src: thumbOf(img.file), alt: '', decoding: 'async', draggable: 'false' })
    : h('span', { class: 'gpin__emoji', 'aria-hidden': 'true' }, groupById(card.group)?.emoji),
  h('span', { class: 'gpin__count', 'aria-hidden': 'true' }));
}

export function render(main, [cardId] = []) {
  const from = cardId && state.byId.get(cardId);
  const card = from && isVisible(from) ? from : null;
  const layer = h('div', { class: 'globe__pins' });
  // Messages only (no cards yet, nothing in this filter): how to use the globe is in the panel.
  const hint = h('p', { class: 'globe__hint', hidden: true });
  const say = content => { hint.hidden = !content; mount(hint, content); };
  const stage = h('div', { class: 'globe__stage' }, layer);
  const bar = h('div', { class: 'glayers', role: 'toolbar', 'aria-label': label('globe.layers') });
  // The info panel (js/globe-info.js): a key, "What am I looking at?", and more when open.
  const panelBody = h('div', { class: 'gpanel__body', 'data-scroll': '' });
  const panelToggle = h('button', { class: 'gpanel__toggle', type: 'button', onclick: () => setPanel(panel.dataset.state !== 'expanded') });
  const panel = h('aside', { class: 'gpanel', 'aria-label': label('info.what') }, panelToggle, panelBody);
  const filterPanel = h('div', { class: 'gfilter', hidden: true });
  // Back to the card: in history when the globe was opened from it, else to its address.
  goBack = card ? () => { if (cameFromMap(card.id)) history.back(); else location.hash = `#/card/${encodeURIComponent(card.id)}`; } : null;
  const back = card && h('button', { class: 'btn btn--primary globe__back', type: 'button', onclick: () => goBack?.() },
    h('span', { 'aria-hidden': 'true' }, '‹ '), tx('globe.backToCard'));
  // The first time, the land has to come from the internet.
  const offline = h('div', { class: 'globe__offline', role: 'status', hidden: true },
    h('p', null, h('span', { 'aria-hidden': 'true' }, '📡 '), tx('globe.offline')),
    h('button', { class: 'btn btn--soft', type: 'button', onclick: () => globe?.retry() }, tx('globe.retry')));
  const view = h('section', { class: ['globe', card && 'has-back'], 'aria-label': label('nav.globe') },
    stage, back, bar, panel, filterPanel, offline, h('div', { class: 'globe__foot' }, hint));
  mount(main, view);

  const pins = [];          // { card, lon, lat, v, el, x, y, z, stack }
  let pinSize = 44;
  let fan = null;           // { members, start }
  let fanNext = null;       // pins to fan out if they still overlap after zooming in
  let selected = null;

  const measure = () => { pinSize = parseFloat(getComputedStyle(view).getPropertyValue('--gpin')) || pinSize; };
  measure();

  // Lay the pins out over the globe: hide the far side, stack the ones that overlap.
  function layout({ project, ctx }) {
    const D = pinSize * TOUCH;
    const stacks = [];
    for (const p of pins) {
      [p.x, p.y, p.z] = project(p.v);
      p.stack = null;
      if (p.z < NEAR_SIDE || p.off || fan?.members.includes(p)) continue;
      const s = stacks.find(st => (st.x - p.x) ** 2 + (st.y - p.y) ** 2 < D * D);
      if (s) { s.members.push(p); p.stack = s; } else { p.stack = { x: p.x, y: p.y, members: [p] }; stacks.push(p.stack); }
    }

    // After zooming in on a stack: fan its pins out if they still sit on top of each other.
    if (fanNext) {
      const still = fanNext.filter(p => p.stack && p.stack === fanNext[0].stack);
      if (still.length > 1) fan = { members: fanNext, start: performance.now() };
      fanNext = null;
      if (fan) { globe.redraw(); return; }
    }

    let fanning = false;
    if (fan) {
      const n = fan.members.length;
      const cx = fan.members.reduce((s, p) => s + p.x, 0) / n, cy = fan.members.reduce((s, p) => s + p.y, 0) / n;
      const t = reducedMotion() ? 1 : Math.min(1, (performance.now() - fan.start) / FAN_MS);
      const e = 1 - (1 - t) ** 3;
      const radius = Math.max(pinSize * 0.95, (n * pinSize * 1.15) / (2 * Math.PI));
      fanning = t < 1;
      ctx.strokeStyle = getComputedStyle(view).getPropertyValue('--c-surface');
      ctx.lineWidth = 2;
      fan.members.forEach((p, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        p.fx = cx + Math.cos(a) * radius * e;
        p.fy = cy + Math.sin(a) * radius * e;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.fx, p.fy); ctx.stroke();
      });
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    }

    for (const p of pins) {
      const fanned = fan?.members.includes(p);
      const lead = fanned || (p.stack && p.stack.members[0] === p);
      if (p.off || !lead || (!fanned && p.z < NEAR_SIDE)) { p.el.classList.add('is-off'); continue; }
      const x = fanned ? p.fx : p.x, y = fanned ? p.fy : p.y;
      const depth = fanned ? 1 : Math.min(1, (p.z - NEAR_SIDE) / 0.25);
      const count = fanned ? 1 : p.stack.members.length;
      p.el.classList.remove('is-off');
      p.el.classList.toggle('is-stack', count > 1);
      p.el.lastChild.textContent = count > 1 ? String(count) : '';
      p.el.style.setProperty('transform', `translate3d(${(x - pinSize / 2).toFixed(1)}px, ${(y - pinSize / 2).toFixed(1)}px, 0) scale(${(0.55 + 0.45 * depth).toFixed(3)})`);
      p.el.style.setProperty('opacity', depth.toFixed(2));
    }
    if (fanning) globe.redraw();
  }

  const debug = debugOn('fps');
  globe = createGlobe(stage, {
    debug,
    onLand: ok => { offline.hidden = ok; },
    onFrame: layout,
    onInteract: () => {
      if (fan) { fan = null; globe.redraw(); }
      if (holding) { holding = false; globe.pause(false); } // touched: it may turn by itself again
    },
    onTap: () => { fan = null; select(null); closePanel?.(); },
  });

  // Tapping a stack zooms in far enough to pull its pins apart (and fans them if needed).
  function openStack(stack) {
    haptic(6);
    const members = stack.members;
    let x = 0, y = 0, z = 0;
    for (const p of members) { x += p.v[0]; y += p.v[1]; z += p.v[2]; }
    const lon = Math.atan2(y, x) * 180 / Math.PI, lat = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
    let gap = Math.PI;
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const a = members[i].v, b = members[j].v;
      gap = Math.min(gap, Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    }
    const need = (pinSize * 1.3) / (globe.radius * Math.max(gap, 1e-6));
    const k = Math.max(globe.k * 1.8, need);
    globe.flyTo(lon, lat, k, { duration: 650, onDone: () => { fanNext = members; globe.redraw(); } });
  }

  function tapPin(p) {
    if (!fan?.members.includes(p) && p.stack?.members.length > 1) { openStack(p.stack); return; }
    select(p);
    openSheet(p);
  }

  // Light up a pin's range in its group colour.
  function select(p) {
    selected?.el.classList.remove('is-selected');
    selected = p;
    globe.setRange(null);
    if (!p) return;
    p.el.classList.add('is-selected');
    if (p.card.range) {
      loadRange(p.card.range).then(geo => { if (selected === p) globe.setRange(rangePolygons(geo), p.card.group); });
    }
  }

  // ---------- card sheet ----------
  function openSheet(p) {
    closeSheet({ animate: false });
    const card = p.card;
    const g = groupById(card.group);
    const fact = (card.facts ?? []).find(f => f?.en || f?.zh);
    const close = h('button', { class: 'btn btn--icon gsheet__close', type: 'button', 'aria-label': label('card.close'), onclick: () => closeSheet() },
      h('span', { 'aria-hidden': 'true' }, '✕'));
    const el = h('div', { class: 'gsheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': plain(card.name), tabindex: '-1', 'data-group': card.group },
      h('span', { class: 'gsheet__grip', 'aria-hidden': 'true' }),
      close,
      h('div', { class: 'gsheet__pic' }, picture(card)),
      h('div', { class: 'gsheet__body' },
        h('p', { class: 'gsheet__meta' },
          h('span', { class: 'gsheet__no' }, tx('card.number', { n: cardNo(card.number) })),
          g && groupTitle(g)),
        h('h2', { class: 'gsheet__name' }, nameBi(card.name)),
        fact && h('p', { class: 'gsheet__fact' }, bi(fact)),
        h('a', { class: 'btn btn--primary btn--big gsheet__open', href: `#/card/${encodeURIComponent(card.id)}` },
          h('span', { 'aria-hidden': 'true' }, '📒'), tx('globe.openInBinder'))));
    const scrim = h('div', { class: 'gsheet__scrim', onclick: () => closeSheet() });
    view.append(scrim, el);
    sheet = { el, scrim, pin: p };
    globe.pause(true);
    globe.setOffset(Math.min(el.offsetHeight, view.clientHeight * 0.6));
    globe.flyTo(p.lon, p.lat);

    // Grow out of the pin.
    if (!reducedMotion()) {
      const a = p.el.getBoundingClientRect(), b = el.getBoundingClientRect();
      el.animate([
        { transform: `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})`, opacity: 0.4 },
        { transform: 'none', opacity: 1 },
      ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    }
    el.focus({ preventScroll: true });

    // Swipe down to close.
    track(el, {
      start: ({ target }) => !target.closest('a, button'),
      lock: ({ axis, dy }) => axis === 'y' && dy > 0,
      move: ({ dy }) => el.style.setProperty('transform', `translateY(${Math.max(0, dy)}px)`),
      end: ({ dy, vy }) => {
        if (dy > 90 || vy > 600) closeSheet({ from: dy });
        else el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'ease-out' })
          .finished.then(() => el.style.removeProperty('transform'));
      },
    });
  }

  function closeSheet({ animate = true, from = 0 } = {}) {
    if (!sheet) return;
    const { el, scrim, pin } = sheet;
    sheet = null;
    globe.pause(false);
    globe.setOffset(0);
    fitGlobe();
    if (animate && !reducedMotion()) {
      scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      el.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(110%)' }], { duration: 240, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => { el.remove(); scrim.remove(); });
    } else { el.remove(); scrim.remove(); }
    if (pin.el.isConnected) pin.el.focus({ preventScroll: true });
  }

  // ---------- the cards ----------
  const cards = state.cards.filter(isVisible);
  let placed = 0;
  Promise.all(cards.map(async card => {
    const at = await placeOf(card).catch(() => null);
    if (!at || !globe) return;
    const p = { card, lon: at[0], lat: at[1], v: toVec(at[0], at[1]), x: 0, y: 0, z: -1, stack: null };
    p.el = pinEl(card, () => tapPin(p));
    p.off = !matchesFilter(card);
    p.el.classList.add('is-off');
    pins.push(p);
    layer.append(p.el);
    placed++;
    globe.redraw();
  })).then(() => {
    if (!placed) say(tx('globe.empty'));
    pins.sort((a, b) => a.card.number - b.card.number);
    // From a card: its pin is the selected one (its range is already lit).
    const own = card && pins.find(p => p.card === card);
    if (own && !selected) { selected = own; own.el.classList.add('is-selected'); }
  });

  // From a card's map: light up its range and turn to it, zoomed to fit (js/globe.js rangeFit),
  // and stay there (no slow turning away) until the child touches the globe.
  let holding = false;
  if (card?.range) {
    holding = true;
    globe.pause(true);
    loadRange(card.range).then(geo => {
      const polys = rangePolygons(geo);
      const fit = rangeFit(polys);
      if (!globe || !fit) return;
      globe.setRange(polys, card.group);
      globe.flyTo(fit.lon, fit.lat, fit.k, { duration: 900 });
    });
  }

  // ---------- region filter: continents and habitats, from the cards' tags ----------
  function matchesFilter(card) {
    return !shownFilter || (card[shownFilter.key] ?? []).includes(shownFilter.id);
  }
  const regionOf = f => f && state.regions[f.key].find(r => r.id === f.id);
  const filterChip = h('button', {
    class: 'glayer glayer--filter', type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'true',
    onclick: () => openFilter(filterPanel.hidden),
  });
  function drawFilterChip() {
    const r = regionOf(shownFilter);
    filterChip.setAttribute('aria-pressed', String(Boolean(r)));
    mount(filterChip, h('span', { class: 'glayer__emoji', 'aria-hidden': 'true' }, r?.emoji ?? '🔎'), r ? bi(r.name) : tx('globe.filterAll'));
  }
  function openFilter(open) {
    filterPanel.hidden = !open;
    filterChip.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const chip = (f, emoji, name) => h('button', {
      class: 'glayer', type: 'button',
      'aria-pressed': String(f ? shownFilter?.key === f.key && shownFilter?.id === f.id : !shownFilter),
      onclick: () => applyFilter(f),
    }, h('span', { class: 'glayer__emoji', 'aria-hidden': 'true' }, emoji), bi(name));
    mount(filterPanel,
      h('div', { class: 'gfilter__row' }, chip(null, '🌐', t('globe.filterAll'))),
      ...[['continents', 'badge.continents'], ['biomes', 'badge.biomes']].map(([key, titleKey]) => h('div', { class: 'gfilter__group' },
        h('p', { class: 'gfilter__title' }, tx(titleKey)),
        h('div', { class: 'gfilter__row' }, state.regions[key].map(r => chip({ key, id: r.id }, r.emoji, r.name))))));
  }
  // Show only the pins with that tag, and turn the globe towards a continent.
  function applyFilter(f) {
    shownFilter = f;
    openFilter(false);
    drawFilterChip();
    let shown = 0;
    for (const p of pins) { p.off = !matchesFilter(p.card); if (!p.off) shown++; }
    fan = null;
    select(null);
    say(pins.length && !shown ? tx('globe.filterNone') : null);
    const r = regionOf(f);
    if (r?.center) globe.flyTo(r.center[0], r.center[1], globe.k, { duration: 650 });
    globe.redraw();
  }
  drawFilterChip();
  bar.append(filterChip);

  // ---------- map layers ----------
  const col = name => getComputedStyle(view).getPropertyValue(name).trim();
  let ticker = 0;
  let wanted = null;
  const chips = LAYERS.map(L => h('button', {
    class: 'glayer', type: 'button', 'aria-pressed': 'false', 'data-layer': L.id,
    onclick: () => choose(shownLayer === L.id ? null : L.id),
  }, h('span', { class: 'glayer__emoji', 'aria-hidden': 'true' }, L.emoji), tx(`layer.${L.id}`)));
  bar.append(...chips);

  // ---------- the info panel ----------
  // Landscape: a column on the left, the globe beside it. Portrait tablet: a sheet under the
  // globe that opens upwards. Phone: a strip that opens over the lower half. Collapsed it shows
  // the key only; open, also "What am I looking at?" and more. Open or not is kept per explorer
  // on this device (globePanel); on a phone it always starts as the strip.
  let panelLayer = null, panelFailed = false, peek = 0;
  // A key swatch in the colour the map shows (globe-info.js: token, paint), with its mark or
  // tree inside.
  const rgbOf = hex => (hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)?.slice(1) ?? ['0', '0', '0']).map(x => parseInt(x, 16));
  // The land under the night overlay with the sun at deg below the horizon (js/globe.js).
  function landAtNight(deg) {
    const { alpha, dark } = nightShade(Math.sin((-deg * Math.PI) / 180));
    const land = rgbOf(col('--c-map-land')), tw = rgbOf(col('--c-twilight')), night = rgbOf(col('--c-night'));
    const c = land.map((l, i) => Math.round(l + (tw[i] + (night[i] - tw[i]) * dark - l) * alpha));
    return `rgb(${c.join(' ')})`;
  }
  const paints = { dusk: () => landAtNight(6), night: () => landAtNight(18), lights: () => landAtNight(18) };
  const swatch = k => h('span', {
    class: ['gkey__sw', k.paint && `gkey__sw--${k.paint}`],
    style: { '--sw': paints[k.paint]?.() ?? `var(${k.token})` }, 'aria-hidden': 'true',
  }, k.mark && h('span', { class: 'gkey__mark' }, k.mark), k.tree && tree(k.tree));
  const keyIcon = icon => h('span', { class: `gkey__icon gkey__icon--${icon}`, 'aria-hidden': 'true' }, icon === 'stack' ? '3' : icon === 'filter' ? '🔎' : '');
  function animalChip(a) {
    const c = state.byId.get(a.card);
    const inner = [h('span', { class: 'gzone__art', 'aria-hidden': 'true' }, animal(a.art)), h('span', { class: 'gzone__animal-name' }, tx(a.name))];
    return c && isVisible(c)
      ? h('a', { class: 'gzone__animal', href: `#/card/${encodeURIComponent(c.id)}` }, inner)
      : h('span', { class: 'gzone__animal' }, inner);
  }
  const keyItem = (k, zone) => h('li', { class: 'gkey__item' },
    k.icon ? keyIcon(k.icon) : swatch(k),
    k.short && h('span', { class: 'gkey__short', 'aria-hidden': 'true' }, k.short),
    h('span', { class: 'gkey__label' }, tx(k.label), zone && h('span', { class: 'gkey__sci' }, sciName(k, zone))),
    zone && animalChip(zone.animal));
  // A zone's scientific name, leaving out a language where it only repeats the kid name after
  // the depth (4,000–6,000 公尺 · 深淵帶 and 深淵帶): there, nothing more is shown.
  function sciName(k, zone) {
    const kid = t(k.label), sci = t(zone.sci);
    const same = lang => sci[lang] === kid[lang].split(' · ').pop();
    if (!same('en') && !same('zh')) return tx(zone.sci);
    return h('span', { class: 'bi' }, ['en', 'zh'].filter(l => !same(l)).map(l =>
      h('span', { class: `t-${l}`, lang: l === 'en' ? 'en' : 'zh-Hant-TW' }, sci[l])));
  }
  // Temperature: hot at the top, cold at the bottom, and the month under it.
  function tempKey() {
    const stops = tempStops(col);
    const lo = stops[0].v, hi = stops.at(-1).v;
    const grad = stops.map(s => `${s.colour} ${(((s.v - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ');
    const name = h('span', { class: 'gtemp__monthname' }, tx(`month.${tempMonth}`));
    const month = h('input', {
      class: 'gtemp__slider', type: 'range', min: 1, max: 12, step: 1, value: tempMonth,
      'aria-label': label('layer.temp.month'),
      oninput: e => { tempMonth = Number(e.target.value); mount(name, tx(`month.${tempMonth}`)); show(LAYERS.find(l => l.id === 'temp')); },
    });
    return h('div', { class: 'gtemp' },
      h('div', { class: 'gtemp__scale' },
        h('div', { class: 'gtemp__bar', style: { '--gtemp-v': `linear-gradient(to top, ${grad})`, '--gtemp-h': `linear-gradient(to left, ${grad})` }, 'aria-hidden': 'true' }),
        h('div', { class: 'gtemp__ticks' },
          h('span', null, h('span', { 'aria-hidden': 'true' }, '🔥 '), tempText(hi)), h('span', null, tempText(0)),
          h('span', null, h('span', { 'aria-hidden': 'true' }, '❄️ '), tempText(lo)))),
      h('label', { class: 'gtemp__month' }, name, month));
  }
  // From a card: the animal and where it lives (its habitats), above the key.
  function cardNote() {
    if (!card) return null;
    const places = (card.biomes ?? []).map(id => state.regions.biomes.find(r => r.id === id)).filter(Boolean);
    return h('div', { class: 'gpanel__card' },
      h('p', { class: 'gpanel__name' }, nameBi(card.name)),
      places.length > 0 && h('p', { class: 'gpanel__habitat' },
        h('span', { class: 'gpanel__habitat-label' }, tx('info.habitat')), ' ',
        h('span', { 'aria-hidden': 'true' }, places.map(r => r.emoji).join(' ')), ' ',
        bi({ en: places.map(r => r.name.en).join(', '), zh: places.map(r => r.name.zh || r.name.en).join('、') })));
  }
  function drawPanel(L = panelLayer, failed = panelFailed) {
    panelLayer = L; panelFailed = failed;
    const info = INFO[L?.id ?? 'everywhere'];
    panel.dataset.layer = L?.id ?? 'everywhere';
    mount(panelBody,
      cardNote(),
      h('h2', { class: 'gpanel__title' }, h('span', { class: 'gpanel__emoji', 'aria-hidden': 'true' }, L?.emoji ?? info.emoji),
        h('span', { class: 'gpanel__titletext' }, tx(L ? `layer.${L.id}` : info.title))),
      info.key === 'temp' ? tempKey() : h('ul', { class: 'gkey' }, info.key.map((k, i) => keyItem(k, info.zones?.[i]))),
      h('section', { class: 'gpanel__what' },
        h('h3', { class: 'gpanel__heading' }, tx('info.what')),
        failed ? h('p', null, tx('layer.failed')) : info.what.map(k => h('p', null, tx(k))),
        !failed && h('div', { class: 'gpanel__art' }, ART[info.art]?.())),
      !failed && h('section', { class: 'gpanel__more' },
        h('h3', { class: 'gpanel__heading' }, tx('info.more')),
        info.more.map(k => h('p', null, tx(k, { year: 2024 })))));
    layoutPanel();
  }
  function setPanel(open, { remember = true } = {}) {
    panel.dataset.state = open ? 'expanded' : 'collapsed';
    panelToggle.setAttribute('aria-expanded', String(open));
    panelToggle.setAttribute('aria-label', label(open ? 'info.collapse' : 'info.expand'));
    mount(panelToggle, h('span', { 'aria-hidden': 'true' }, open ? (panel.dataset.mode === 'side' ? '‹' : '⌄') : (panel.dataset.mode === 'side' ? '›' : '⌃')));
    if (remember && panel.dataset.mode !== 'strip' && state.profile) updateProfile(state.profile.id, { globePanel: open ? 'expanded' : 'collapsed' }).catch(() => {});
    closePanel = open && panel.dataset.mode !== 'side' ? () => setPanel(false) : null;
    layoutPanel();
  }
  // Where the panel sits, and the room it leaves the globe.
  function layoutPanel() {
    const mode = panelMode(view.clientWidth, view.clientHeight);
    if (panel.dataset.mode !== mode) {
      panel.dataset.mode = mode;
      // A phone starts with the strip; a tablet as this explorer left it.
      setPanel(mode === 'strip' ? false : state.profile?.globePanel !== 'collapsed', { remember: false });
      return;
    }
    fitGlobe();
  }
  // The globe moves into the space the chips and the panel leave (and shrinks if it must).
  function fitGlobe() {
    if (!globe || sheet) return;
    const vb = view.getBoundingClientRect();
    const top = bar.getBoundingClientRect().bottom - vb.top;
    view.style.setProperty('--gpanel-top', `${Math.round(top)}px`);
    const css = n => parseFloat(getComputedStyle(view).getPropertyValue(n)) || 0;
    if (panel.dataset.mode === 'side') {
      const w = panel.dataset.state === 'expanded' ? css('--gpanel-w') : css('--gpanel-strip');
      globe.setRoom(top, 0, w + 2 * css('--s-3'));
      return;
    }
    // Sheet and strip: the globe keeps clear of the collapsed panel; open, it goes over it.
    if (panel.dataset.state !== 'expanded') peek = vb.bottom - panel.getBoundingClientRect().top;
    globe.setRoom(top, peek, 0);
  }

  // Load a layer's data and show it on the globe (also used when the month changes).
  async function show(L) {
    wanted = L;
    const chip = chips.find(c => c.dataset.layer === L.id);
    chip.classList.add('is-loading');
    try {
      const spec = await L.load({ col, month: tempMonth });
      if (wanted !== L || !globe) return;
      await globe.setLayer(spec);
      if (L.tick && !ticker) ticker = setInterval(() => globe?.updateLayer(L.tick()), 60000);
    } catch {
      if (wanted !== L || !globe) return;
      chip.classList.add('is-failed');
      drawPanel(L, true);
      globe.setLayer(null).catch(() => {});
    } finally {
      chip.classList.remove('is-loading');
    }
  }

  function choose(id) {
    shownLayer = id;
    clearInterval(ticker);
    ticker = 0;
    view.classList.toggle('has-layer', Boolean(id));
    chips.forEach(c => { c.setAttribute('aria-pressed', String(c.dataset.layer === id)); c.classList.remove('is-failed'); });
    const L = LAYERS.find(l => l.id === id);
    if (!L) { wanted = null; drawPanel(null, false); globe.setLayer(null).catch(() => {}); return; }
    drawPanel(L, false);
    show(L);
  }
  if (shownLayer) choose(shownLayer); else drawPanel(null, false);

  // ?debug=fps: the globe on window too, to put it at an exact view for comparing pictures.
  if (debug) window.wfGlobe = globe;
  const onResize = () => { measure(); layoutPanel(); };
  const onOnline = () => globe?.retry();
  window.addEventListener('resize', onResize);
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(ticker);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('online', onOnline);
    goBack = null;
    closePanel = null;
    closeSheet({ animate: false });
    globe.destroy();
    globe = null;
    if (debug) delete window.wfGlobe;
  };
}

export function onKey(e) {
  if (!globe) return;
  if (e.key === 'Escape' && sheet) { e.preventDefault(); sheet.el.querySelector('.gsheet__close')?.click(); return; }
  if (e.key === 'Escape' && closePanel) { e.preventDefault(); closePanel(); return; }
  if (e.key === 'Escape' && goBack) { e.preventDefault(); goBack(); return; }
  if (sheet) return;
  const moves = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] };
  if (moves[e.key]) { e.preventDefault(); globe.spinBy(...moves[e.key]); }
  else if (e.key === '+' || e.key === '=') globe.zoomBy(1.6);
  else if (e.key === '-') globe.zoomBy(1 / 1.6);
}
