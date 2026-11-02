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
import { h, mount, reducedMotion } from '../dom.js';
import { bi, tx, label, plain } from '../i18n.js';
import { state, isVisible, groupById, thumbOf, mainImage } from '../store.js';
import { picture, groupTitle, cardNo } from '../components.js';
import { createGlobe, toVec } from '../globe.js';
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
let tempMonth = new Date().getMonth() + 1;

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

export function render(main) {
  const layer = h('div', { class: 'globe__pins' });
  const hint = h('p', { class: 'globe__hint' }, tx('globe.hint'));
  const stage = h('div', { class: 'globe__stage' }, layer);
  const bar = h('div', { class: 'glayers', role: 'toolbar', 'aria-label': label('globe.layers') });
  const legend = h('div', { class: 'glegend', hidden: true });
  const view = h('section', { class: 'globe', 'aria-label': label('nav.globe') },
    stage, bar, h('div', { class: 'globe__foot' }, legend, hint));
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
      if (p.z < NEAR_SIDE || fan?.members.includes(p)) continue;
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
      if (!lead || (!fanned && p.z < NEAR_SIDE)) { p.el.classList.add('is-off'); continue; }
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

  globe = createGlobe(stage, {
    onFrame: layout,
    onInteract: () => { if (fan) { fan = null; globe.redraw(); } },
    onTap: () => { fan = null; select(null); },
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
    p.el.classList.add('is-off');
    pins.push(p);
    layer.append(p.el);
    placed++;
    globe.redraw();
  })).then(() => {
    if (!placed) hint.replaceChildren(tx('globe.empty'));
    pins.sort((a, b) => a.card.number - b.card.number);
  });

  // ---------- map layers ----------
  const col = name => getComputedStyle(view).getPropertyValue(name).trim();
  let ticker = 0;
  let wanted = null;
  const chips = LAYERS.map(L => h('button', {
    class: 'glayer', type: 'button', 'aria-pressed': 'false', 'data-layer': L.id,
    onclick: () => choose(shownLayer === L.id ? null : L.id),
  }, h('span', { class: 'glayer__emoji', 'aria-hidden': 'true' }, L.emoji), tx(`layer.${L.id}`)));
  bar.append(...chips);

  const swatch = token => h('span', { class: 'glegend__sw', style: { '--sw': `var(${token})` }, 'aria-hidden': 'true' });

  function tempScale() {
    const stops = tempStops(col);
    const lo = stops[0].v, hi = stops.at(-1).v;
    const grad = stops.map(s => `${s.colour} ${(((s.v - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ');
    const month = h('input', {
      class: 'glegend__month', type: 'range', min: 1, max: 12, step: 1, value: tempMonth,
      'aria-label': label('layer.temp.month'),
      oninput: e => { tempMonth = Number(e.target.value); mount(name, tx(`month.${tempMonth}`)); show(LAYERS.find(l => l.id === 'temp')); },
    });
    const name = h('span', { class: 'glegend__monthname' }, tx(`month.${tempMonth}`));
    return [
      h('div', { class: 'glegend__bar', style: { background: `linear-gradient(to right, ${grad})` }, 'aria-hidden': 'true' }),
      h('div', { class: 'glegend__scale' },
        h('span', null, '❄️ ', tempText(lo)), h('span', null, tempText(0)), h('span', null, `${tempText(hi)} `, '🔥')),
      h('label', { class: 'glegend__months' }, name, month),
    ];
  }

  // While a legend shows, the globe moves into the space between the chips and the legend
  // (and shrinks if it must) instead of hiding behind them.
  function fitGlobe() {
    if (!globe || sheet) return;
    if (legend.hidden) { globe.setRoom(0, 0); return; }
    const vb = view.getBoundingClientRect();
    globe.setRoom(bar.getBoundingClientRect().bottom - vb.top, vb.bottom - legend.getBoundingClientRect().top);
  }

  function renderLegend(L, failed = false) {
    legend.hidden = false;
    queueMicrotask(fitGlobe);
    mount(legend,
      h('p', { class: 'glegend__title' }, h('span', { 'aria-hidden': 'true' }, `${L.emoji} `), tx(`layer.${L.id}`)),
      failed
        ? h('p', { class: 'glegend__note' }, tx('layer.failed'))
        : [
          L.legend === 'temp'
            ? tempScale()
            : h('ul', { class: 'glegend__items' }, L.legend.map(([token, key]) => h('li', null, swatch(token), tx(key)))),
          L.note && h('p', { class: 'glegend__note' }, tx(L.note, { year: 2024 })),
        ]);
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
      if (L.tick && !ticker) ticker = setInterval(() => globe?.updateRaster(L.tick()), 60000);
    } catch {
      if (wanted !== L || !globe) return;
      chip.classList.add('is-failed');
      renderLegend(L, true);
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
    if (!L) { wanted = null; legend.hidden = true; fitGlobe(); globe.setLayer(null).catch(() => {}); return; }
    renderLegend(L);
    show(L);
  }
  if (shownLayer) choose(shownLayer);

  const onResize = () => { measure(); fitGlobe(); };
  window.addEventListener('resize', onResize);
  return () => {
    clearInterval(ticker);
    window.removeEventListener('resize', onResize);
    closeSheet({ animate: false });
    globe.destroy();
    globe = null;
  };
}

export function onKey(e) {
  if (!globe) return;
  if (e.key === 'Escape' && sheet) { e.preventDefault(); sheet.el.querySelector('.gsheet__close')?.click(); return; }
  if (sheet) return;
  const moves = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] };
  if (moves[e.key]) { e.preventDefault(); globe.spinBy(...moves[e.key]); }
  else if (e.key === '+' || e.key === '=') globe.zoomBy(1.6);
  else if (e.key === '-') globe.zoomBy(1 / 1.6);
}
