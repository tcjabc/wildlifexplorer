// Opening a pack. Packs open oldest first, one at a time, and only when the child chooses.
// 1. Swipe across the top strip to cut it: a tear line follows the finger. Cut far enough
//    and the strip peels away; stop early and the tear closes up again. The pack's cards
//    are collected at this moment.
// 2. The first card slides up out of the pack with a shine.
// 3. Flick the card up: it flies to its group tab in the binder, which bumps and counts up,
//    and the next card rises. Repeat for every card in the pack.
// 4. Any badges earned, then a summary of the pack's cards.
// Buttons ("Tap to open", "Next card") do the same for small children.
import { h, mount, reducedMotion } from './dom.js';
import { tx } from './i18n.js';
import { state, openPack as claimPack, unopenedPacks, groupById, progress, dropById } from './store.js';
import { celebrate } from './celebrate.js';
import { coverPage } from './cardparts.js';
import { cardTile } from './components.js';
import { confetti, chimeReveal, chimeGood } from './fx.js';
import { track, spring, tween, clamp, lerp, haptic } from './gesture.js';

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};
const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
const wait = ms => new Promise(r => setTimeout(r, reducedMotion() ? 0 : ms));

let running = false;

function overlay() {
  const scrim = h('div', { class: 'reveal__scrim' });
  const el = h('div', { class: 'reveal', role: 'dialog', 'aria-modal': 'true' }, scrim);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  return { el, scrim };
}

// A hidden page has no layout (every size is 0), so wait until the page is shown and the
// pack has a size before measuring it.
async function laidOut(el) {
  while (document.hidden || !el.offsetWidth) {
    await new Promise(r => (document.hidden
      ? document.addEventListener('visibilitychange', r, { once: true })
      : requestAnimationFrame(r)));
  }
}

function scene(ui, ...children) {
  const el = h('div', { class: 'reveal__scene' }, children);
  ui.el.querySelector('.reveal__scene')?.remove();
  ui.el.append(el);
  return el;
}

// A zig-zag line from x0 to x1 at height y, like torn foil.
function tearPoints(x0, x1, y) {
  const pts = [];
  const dir = x1 >= x0 ? 1 : -1;
  for (let x = x0, i = 0; dir * (x1 - x) > 0; x += 6 * dir, i++) pts.push(`${x.toFixed(1)},${(y + (i % 2 ? 2.5 : -2.5)).toFixed(1)}`);
  pts.push(`${x1.toFixed(1)},${y}`);
  return pts.join(' ');
}

// Where the card should fly: its group tab if it's on screen, otherwise the Binder button.
function binderTarget(groupId) {
  const tab = document.querySelector(`.tab[data-group="${groupId}"]`);
  if (tab) {
    tab.scrollIntoView({ block: 'nearest', inline: 'center' });
    const r = tab.getBoundingClientRect();
    if (r.width && r.bottom > 0 && r.top < innerHeight) return { el: tab, rect: r };
  }
  const nav = document.querySelector('.nav__item[href="#/binder"]');
  return nav ? { el: nav, rect: nav.getBoundingClientRect() } : null;
}

function bump(target, groupId) {
  if (!target) return;
  const count = target.el.querySelector('.tab__count');
  if (count) {
    const p = progress(groupId);
    count.textContent = `${p.n}/${p.total}`;
  }
  target.el.classList.remove('is-bumping');
  void target.el.offsetWidth; // restart the animation
  target.el.classList.add('is-bumping');
  target.el.addEventListener('animationend', () => target.el.classList.remove('is-bumping'), { once: true });
}

// Series and week of a pack, for its label.
function seriesWeek(record) {
  const drop = dropById(record.dropId);
  return drop ? { series: drop.series, week: drop.week }
    : { series: Math.floor(record.seq / state.seriesDrops) + 1, week: (record.seq % state.seriesDrops) + 1 };
}

// Returns 'next' (open the next pack), 'done', 'see' (a card was tapped) or 'gone' (the
// pack had already been opened, e.g. in another tab).
async function openOne(ui, record) {
  const cards = record.cardIds.map(id => state.byId.get(id)).filter(Boolean);
  const tearLine = svgEl('polyline', { class: 'pack__tear-line', points: '' });
  const tear = svgEl('svg', { class: 'pack__tear', 'aria-hidden': 'true' });
  tear.append(tearLine);
  // The first card sits on top of the stack inside the pack.
  const slots = cards.map(card => {
    const inner = h('div', { class: 'pack__card-inner' }, coverPage(card));
    return { card, inner, el: h('div', { class: 'pack__card' }, inner) };
  });
  const strip = h('div', { class: 'pack__strip' }, h('span', { class: 'pack__cutline' }), h('span', { class: 'pack__scissors', 'aria-hidden': 'true' }, '✂️'));
  const body = h('div', { class: 'pack__body' },
    h('span', { class: 'pack__emojis', 'aria-hidden': 'true' }, cards.map(c => groupById(c.group)?.emoji).join('')),
    h('span', { class: 'pack__brand' }, tx('app.title')),
    h('span', { class: 'pack__group' }, tx('pack.label', seriesWeek(record))));
  const pack = h('div', { class: 'pack pack--drop' }, [...slots].reverse().map(s => s.el), body, strip, tear,
    h('span', { class: 'pack__hand', 'aria-hidden': 'true' }, '👆'));
  const help = h('p', { class: 'reveal__help' }, tx('pack.cut'));
  const tapBtn = h('button', { class: 'btn btn--soft pack__tap', type: 'button' }, tx('reveal.tap'));
  const next = h('button', { class: 'btn btn--accent btn--big', type: 'button' }, tx('reveal.next'));
  const actions = h('div', { class: 'reveal__actions', hidden: true }, next);
  const counter = h('p', { class: 'reveal__more', hidden: true });
  scene(ui, h('p', { class: 'reveal__title' }, tx('reveal.title')), pack, help, tapBtn, actions, counter);
  await laidOut(pack);

  // Size the cards inside the pack. offsetWidth/Height ignore the drop-in animation's transform.
  const W = pack.offsetWidth, H = pack.offsetHeight;
  const stripY = H * (cssNum('--pack-strip') / 100);
  const cardW = W * 0.86;
  const cardScale = cardW / cssNum('--card-w');
  const cardH = cssNum('--card-h') * cardScale;
  const topNow = stripY * 0.6;
  for (const s of slots) {
    s.el.style.setProperty('width', `${cardW}px`);
    s.el.style.setProperty('height', `${cardH}px`);
    s.el.style.setProperty('left', `${(W - cardW) / 2}px`);
    s.el.style.setProperty('top', `${topNow}px`);
    s.inner.style.setProperty('zoom', String(cardScale)); // real size, so it stays sharp
  }
  tear.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // ---- 1. cut the strip ----
  await new Promise(resolve => {
    let x0 = 0, cut = 0, done = false, lastTick = 0, cancel = null;
    const drawTear = x => tearLine.setAttribute('points', tearPoints(x0, x, stripY));
    const finish = () => {
      if (done) return;
      done = true;
      cancel?.();
      // Finish the tear to the far edge, then peel the strip away.
      const end = x0 < W / 2 ? W : 0;
      const from = x0 + cut * (end > x0 ? 1 : -1) * W;
      tween({
        from, to: end, duration: 160, onUpdate: drawTear,
        onDone: () => { haptic(20); chimeReveal(); resolve(); },
      });
    };
    track(pack, {
      start: ({ y }) => !done && y - pack.getBoundingClientRect().top < stripY * 2.4,
      lock: ({ axis, x }) => {
        if (axis !== 'x') return false;
        cancel?.();
        x0 = clamp(x - pack.getBoundingClientRect().left, 0, W);
        pack.classList.add('is-cutting');
        return true;
      },
      move: ({ dx }) => {
        cut = clamp(Math.abs(dx) / W);
        drawTear(clamp(x0 + dx, 0, W));
        if (cut - lastTick > 0.15) { lastTick = cut; haptic(5); }
        if (cut > 0.7) finish();
      },
      end: () => {
        if (done) return;
        // Not far enough: the tear zips back closed.
        const cur = clamp(x0 + (x0 < W / 2 ? 1 : -1) * cut * W, 0, W);
        lastTick = 0;
        cancel = tween({ from: cur, to: x0, duration: 260, onUpdate: drawTear, onDone: () => { tearLine.setAttribute('points', ''); pack.classList.remove('is-cutting'); } });
      },
    });
    tapBtn.addEventListener('click', () => {
      if (done) return;
      x0 = 0;
      pack.classList.add('is-cutting');
      cancel = tween({ from: 0, to: W * 0.75, duration: 650, ease: t => t, onUpdate: x => { cut = x / W; drawTear(x); }, onDone: finish });
    });
  });

  // The pack is open: its cards are collected now, whatever happens next.
  const badges = await claimPack(record.id);
  if (!badges) return 'gone';

  // ---- 2. peel the strip ----
  tapBtn.hidden = true;
  help.hidden = true;
  pack.classList.add('is-cut');
  if (!reducedMotion()) {
    strip.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(-25%, -160%) rotate(-16deg)', opacity: 0 }],
      { duration: 520, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' });
    tear.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
  } else {
    strip.hidden = true;
    tear.style.setProperty('display', 'none');
  }
  await wait(220);

  // ---- 3. one card at a time: rise, then flick into the binder ----
  const centered = (H - cardH) / 2 - topNow;
  for (const [i, { card, el }] of slots.entries()) {
    const last = i === slots.length - 1;
    const pose = { x: 0, y: 0, r: 0, s: 1 };
    // While moving the card uses a transform; at rest it has none, so it isn't drawn as a bitmap.
    const place = () => {
      if (!pose.x && !pose.y && !pose.r && pose.s === 1) el.style.removeProperty('transform');
      else el.style.setProperty('transform', `translate(${pose.x}px, ${pose.y}px) rotate(${pose.r}deg) scale(${pose.s})`);
    };

    // Rise out of the pack…
    await new Promise(r => spring({ from: 0, to: -H * 0.55, stiffness: 120, damping: 16, onUpdate: y => { pose.y = y; place(); }, onDone: r }));
    el.classList.add('is-out', 'is-shining');
    if (last) pack.classList.add('is-empty');
    // …then come forward, centred (the empty pack drops away under the last one).
    await new Promise(r => tween({ from: 0, to: 1, duration: 420, onUpdate: u => { pose.y = lerp(-H * 0.55, centered, u); place(); }, onDone: r }));
    // Settle: move the resting position into top (a whole pixel) and drop the transform.
    el.style.setProperty('top', `${Math.round(topNow + pose.y)}px`);
    pose.y = 0;
    place();
    confetti(ui.el, last ? 48 : 24);
    mount(next, tx(last ? 'reveal.done' : 'reveal.next'));
    mount(counter, tx('pack.count', { n: i + 1, total: slots.length }));
    mount(help, tx('pack.flick'));
    actions.hidden = false;
    counter.hidden = false;
    help.hidden = false;

    await new Promise(resolve => {
      let flown = false, cancel = null;
      const fly = () => {
        if (flown) return;
        flown = true;
        cancel?.();
        next.removeEventListener('click', fly);
        actions.hidden = true;
        help.hidden = true;
        ui.scrim.classList.add('is-faint');
        const target = binderTarget(card.group);
        const from = el.getBoundingClientRect();
        const start = { ...pose };
        const dx = target ? target.rect.left + target.rect.width / 2 - (from.left + from.width / 2) : 0;
        const dy = target ? target.rect.top + target.rect.height / 2 - (from.top + from.height / 2) : -innerHeight;
        const endScale = target ? Math.max(0.08, (target.rect.height / from.height) * start.s) : 0.1;
        haptic(15);
        tween({
          from: 0, to: 1, duration: 560, ease: t => t * t * (3 - 2 * t),
          onUpdate: u => {
            pose.x = start.x + dx * u;
            pose.y = start.y + dy * u - Math.sin(Math.PI * u) * 60; // a little arc
            pose.r = start.r + 20 * u;
            pose.s = lerp(start.s, endScale, u);
            place();
            el.style.setProperty('opacity', String(1 - clamp((u - 0.85) / 0.15)));
          },
          onDone: () => {
            el.hidden = true;
            bump(target, card.group);
            haptic(25);
            chimeGood();
            ui.scrim.classList.remove('is-faint');
            resolve();
          },
        });
      };
      const rest = { ...pose };
      track(el, {
        start: () => !flown,
        lock: () => { cancel?.(); return true; },
        move: ({ dx, dy }) => { pose.x = rest.x + dx; pose.y = rest.y + dy; pose.r = dx * 0.06; place(); },
        end: ({ dy, vy }) => {
          if ((dy < -90 && vy < -150) || vy < -900 || dy < -220) { fly(); return; }
          // Not a flick: spring back to the middle.
          const start = { ...pose };
          cancel = spring({ from: 1, to: 0, velocity: 0, onUpdate: k => {
            pose.x = lerp(rest.x, start.x, k); pose.y = lerp(rest.y, start.y, k); pose.r = start.r * k;
            if (k === 0) { pose.x = 0; pose.y = 0; pose.r = 0; }
            place();
          } });
        },
      });
      next.addEventListener('click', fly);
    });
  }

  // ---- 4. badges, then the summary ----
  await celebrate(badges, ui);
  return summary(ui, cards);
}

// Every card from the pack. Tapping one opens it; more packs can be opened from here.
function summary(ui, cards) {
  ui.scrim.classList.remove('is-faint'); // a badge flying to its tab leaves it faint
  const left = unopenedPacks().length;
  return new Promise(resolve => {
    const done = h('button', { class: ['btn btn--big', left ? 'btn--soft' : 'btn--accent'], type: 'button', onclick: () => resolve('done') }, tx('pack.done'));
    const more = left > 0 && h('button', { class: 'btn btn--accent btn--big', type: 'button', onclick: () => resolve('next') }, tx('pack.openNext', { n: left }));
    const tiles = cards.map(cardTile);
    tiles.forEach(t => t.addEventListener('click', () => resolve('see')));
    scene(ui,
      h('p', { class: 'reveal__title' }, tx('pack.summary', { n: cards.length })),
      h('div', { class: 'reveal__cards' }, tiles),
      h('div', { class: 'reveal__actions' }, done, more));
  });
}

// Open the oldest unopened pack, and more if the child asks for them.
export async function openPacks(onDone) {
  if (running || !unopenedPacks().length) return;
  running = true;
  const ui = overlay();
  try {
    for (let pack = unopenedPacks()[0]; pack; pack = unopenedPacks()[0]) {
      ui.scrim.classList.remove('is-faint');
      const act = await openOne(ui, pack);
      if (act !== 'next' && act !== 'gone') break;
      await wait(250);
    }
  } finally {
    ui.el.classList.remove('is-open');
    setTimeout(() => ui.el.remove(), 250);
    running = false;
    onDone?.();
  }
}

export const revealing = () => running;
