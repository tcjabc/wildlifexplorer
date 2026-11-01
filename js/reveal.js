// New cards arrive as sealed foil packs.
// 1. Swipe across the top strip to cut it: a tear line follows the finger. Cut far enough
//    and the strip peels away; stop early and the tear closes up again.
// 2. The card slides up out of the pack with a shine.
// 3. Flick the card up: it flies to its group tab in the binder, which bumps and counts up.
// Buttons ("Tap to open", "Put in binder") do the same for small children.
import { h, mount, reducedMotion } from './dom.js';
import { bi, tx, label } from './i18n.js';
import { pendingReveals, collect, groupById, progress } from './store.js';
import { coverPage } from './cardparts.js';
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

async function openPack(ui, card, remaining) {
  const g = groupById(card.group);
  const tearLine = svgEl('polyline', { class: 'pack__tear-line', points: '' });
  const tear = svgEl('svg', { class: 'pack__tear', 'aria-hidden': 'true' });
  tear.append(tearLine);
  const inner = h('div', { class: 'pack__card-inner' }, coverPage(card));
  const cardEl = h('div', { class: 'pack__card' }, inner);
  const strip = h('div', { class: 'pack__strip' }, h('span', { class: 'pack__cutline' }), h('span', { class: 'pack__scissors', 'aria-hidden': 'true' }, '✂️'));
  const body = h('div', { class: 'pack__body' },
    h('span', { class: 'pack__emoji', 'aria-hidden': 'true' }, g.emoji),
    h('span', { class: 'pack__brand' }, tx('app.title')),
    h('span', { class: 'pack__group' }, bi(g.name)));
  const pack = h('div', { class: 'pack', 'data-group': card.group }, cardEl, body, strip, tear,
    h('span', { class: 'pack__hand', 'aria-hidden': 'true' }, '👆'));
  const help = h('p', { class: 'reveal__help' }, tx('pack.cut'));
  const tapBtn = h('button', { class: 'btn btn--soft pack__tap', type: 'button' }, tx('reveal.tap'));
  const see = h('a', { class: 'btn btn--soft btn--big', href: `#/card/${encodeURIComponent(card.id)}` }, tx('reveal.see'));
  const put = h('button', { class: 'btn btn--accent btn--big', type: 'button' }, tx(remaining ? 'reveal.next' : 'reveal.done'));
  const actions = h('div', { class: 'reveal__actions', hidden: true }, see, put);
  const scene = h('div', { class: 'reveal__scene' },
    h('p', { class: 'reveal__title' }, tx('reveal.title')),
    pack, help, tapBtn, actions,
    remaining > 0 && h('p', { class: 'reveal__more' }, tx('reveal.more', { n: remaining })));
  ui.el.querySelector('.reveal__scene')?.remove();
  ui.el.append(scene);

  // Size the card inside the pack. offsetWidth/Height ignore the drop-in animation's transform.
  const W = pack.offsetWidth, H = pack.offsetHeight;
  const stripY = H * (cssNum('--pack-strip') / 100);
  const cardW = W * 0.86;
  const cardScale = cardW / cssNum('--card-w');
  cardEl.style.setProperty('width', `${cardW}px`);
  cardEl.style.setProperty('height', `${cssNum('--card-h') * cardScale}px`);
  cardEl.style.setProperty('left', `${(W - cardW) / 2}px`);
  cardEl.style.setProperty('top', `${stripY * 0.6}px`);
  inner.style.setProperty('transform', `scale(${cardScale})`);
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

  // ---- 2. peel the strip, slide the card out ----
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

  const pose = { x: 0, y: 0, r: 0, s: 1 };
  const place = () => cardEl.style.setProperty('transform', `translate(${pose.x}px, ${pose.y}px) rotate(${pose.r}deg) scale(${pose.s})`);
  const cardH = cssNum('--card-h') * cardScale;
  const topNow = stripY * 0.6;
  const centered = (H - cardH) / 2 - topNow;

  // Rise out of the pack…
  await new Promise(r => spring({ from: 0, to: -H * 0.55, stiffness: 120, damping: 16, onUpdate: y => { pose.y = y; place(); }, onDone: r }));
  cardEl.classList.add('is-out', 'is-shining');
  pack.classList.add('is-empty');
  // …then come forward, centred, while the empty pack drops away.
  await new Promise(r => tween({ from: 0, to: 1, duration: 420, onUpdate: u => { pose.y = lerp(-H * 0.55, centered, u); pose.s = lerp(1, 1.12, u); place(); }, onDone: r }));
  confetti(ui.el);
  const badge = await collect(card.id);
  actions.hidden = false;
  mount(help, tx('pack.flick'));
  help.hidden = false;

  // ---- 3. flick into the binder ----
  const rest = { ...pose };
  const act = await new Promise(resolve => {
    let flown = false, cancel = null;
    const fly = () => {
      if (flown) return;
      flown = true;
      cancel?.();
      actions.hidden = true;
      help.hidden = true;
      ui.scrim.classList.add('is-faint');
      const target = binderTarget(card.group);
      const from = cardEl.getBoundingClientRect();
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
          cardEl.style.setProperty('opacity', String(1 - clamp((u - 0.85) / 0.15)));
        },
        onDone: () => { bump(target, card.group); haptic(25); chimeGood(); resolve('next'); },
      });
    };
    track(cardEl, {
      start: () => !flown,
      lock: () => { cancel?.(); return true; },
      move: ({ dx, dy }) => { pose.x = rest.x + dx; pose.y = rest.y + dy; pose.r = dx * 0.06; place(); },
      end: ({ dy, vy }) => {
        if ((dy < -90 && vy < -150) || vy < -900 || dy < -220) { fly(); return; }
        // Not a flick: spring back to the middle.
        const start = { ...pose };
        cancel = spring({ from: 1, to: 0, velocity: 0, onUpdate: k => {
          pose.x = lerp(rest.x, start.x, k); pose.y = lerp(rest.y, start.y, k); pose.r = start.r * k; place();
        } });
      },
    });
    put.addEventListener('click', fly);
    see.addEventListener('click', () => resolve('see'));
  });

  if (badge) await showBadge(ui, badge);
  return act;
}

async function showBadge(ui, g) {
  ui.scrim.classList.remove('is-faint');
  const ok = h('button', { class: 'btn btn--accent btn--big', type: 'button' }, tx('badge.great'));
  const scene = h('div', { class: 'reveal__scene' },
    h('p', { class: 'reveal__title' }, tx('badge.earned')),
    h('div', { class: 'medal medal--earned medal--huge', 'data-group': g.id }, h('span', { 'aria-hidden': 'true' }, g.emoji)),
    h('p', { class: 'reveal__text' }, tx('badge.complete', { group: g.name })),
    h('div', { class: 'reveal__actions' }, ok));
  ui.el.querySelector('.reveal__scene')?.remove();
  ui.el.append(scene);
  chimeGood();
  confetti(ui.el, 80);
  await new Promise(r => ok.addEventListener('click', r, { once: true }));
}

export async function runReveals(onDone) {
  if (running) return;
  const queue = pendingReveals();
  if (!queue.length) return;
  running = true;
  const ui = overlay();
  try {
    for (let i = 0; i < queue.length; i++) {
      ui.scrim.classList.remove('is-faint');
      const act = await openPack(ui, queue[i], queue.length - i - 1);
      // "See card" opens this card; any others wait for the next visit to the binder.
      if (act === 'see') break;
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
