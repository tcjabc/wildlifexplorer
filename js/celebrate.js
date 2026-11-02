// The moment a badge is earned. One scene per badge:
// 1. The medal drops in. A new tier starts in the old metal and turns over into the new
//    one. A secret badge starts as a "?" card: tap or swipe it to turn it over.
// 2. Rub the medal (or tap it) to polish it: it shines and confetti falls.
// 3. Flick it up to the Badges button (or tap "Hooray!").
// Used inside the pack overlay after a pack is opened, or on its own.
import { h, mount, reducedMotion } from './dom.js';
import { bi, tx, label } from './i18n.js';
import { state, groupById } from './store.js';
import { confetti, chimeGood, chimeReveal } from './fx.js';
import { track, tween, spring, lerp, clamp, haptic } from './gesture.js';

const RUB_PX = 260; // how much rubbing polishes a medal
const wait = ms => new Promise(r => setTimeout(r, reducedMotion() ? 0 : ms));

function overlay() {
  const scrim = h('div', { class: 'reveal__scrim' });
  const el = h('div', { class: 'reveal', role: 'dialog', 'aria-modal': 'true' }, scrim);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  return { el, scrim };
}

// Several tiers of one region earned at once show as one step up to the highest; the
// medal starts in the tier the profile had before.
function collapse(badges) {
  const out = [];
  for (const b of badges) {
    if (b.tier == null) { out.push({ badge: b }); continue; }
    const same = out.find(o => o.badge.kind === b.kind && o.badge.ref === b.ref);
    if (same) { if (b.tierIndex > same.badge.tierIndex) same.badge = b; continue; }
    out.push({ badge: b });
  }
  for (const o of out) {
    if (o.badge.tier == null) continue;
    const had = state.badgeCfg.badges.tiers.filter((t, i) => i < o.badge.tierIndex)
      .filter(t => !badges.some(b => b.id === `${o.badge.kind}:${o.badge.ref}:${t.id}`)).at(-1);
    o.from = had?.id ?? null;
  }
  return out;
}

// Secret badges are always gold.
export function medal(b, { huge = false, tier = b.tier ?? (b.kind === 'secret' ? 'gold' : null) } = {}) {
  return h('div', {
    class: ['medal medal--earned', tier && 'medal--tier', huge && 'medal--huge'],
    'data-group': b.kind === 'group' ? b.ref : null, 'data-tier': tier ?? null,
  }, h('span', { 'aria-hidden': 'true' }, b.emoji));
}

const titleOf = b => (b.kind === 'secret' ? tx('badge.secretFound') : b.tier ? tx('badge.tierEarned', { tier: b.tierName }) : tx('badge.earned'));

function textOf(b) {
  if (b.kind === 'secret') return bi(b.title, 'bi--joke');
  if (b.kind === 'group') return tx('badge.complete', { group: groupById(b.ref)?.name ?? b.name });
  return tx('badge.regionText', { n: b.need, region: b.name });
}

// The Badges button, where a medal flies to.
function badgesTarget() {
  const nav = document.querySelector('.nav__item[href="#/badges"]');
  return nav ? { el: nav, rect: nav.getBoundingClientRect() } : null;
}

async function scene(ui, { badge: b, from }) {
  ui.scrim.classList.remove('is-faint');
  const m = medal(b, { huge: true, tier: from ?? b.tier });
  const stage = h('div', { class: 'celebrate__stage' });
  const help = h('p', { class: 'reveal__help' });
  const ok = h('button', { class: 'btn btn--accent btn--big', type: 'button' }, tx('badge.great'));
  const actions = h('div', { class: 'reveal__actions', hidden: true }, ok);
  const text = h('p', { class: 'reveal__text', hidden: b.kind === 'secret' }, textOf(b));
  const el = h('div', { class: 'reveal__scene celebrate' },
    h('p', { class: 'reveal__title' }, titleOf(b)), stage, text, help, actions);
  ui.el.querySelector('.reveal__scene')?.remove();
  ui.el.append(el);
  chimeGood();

  // ---- 1. a secret badge is a card to turn over ----
  if (b.kind === 'secret') {
    const card = h('button', { class: 'secret-card', type: 'button', 'aria-label': label('badge.secretTap') },
      h('span', { class: 'secret-card__back', 'aria-hidden': 'true' }, '?'),
      h('span', { class: 'secret-card__front' }, m));
    stage.append(card);
    mount(help, tx('badge.secretTap'));
    await new Promise(resolve => {
      let done = false;
      const flip = () => { if (done) return; done = true; card.classList.add('is-flipped'); haptic(15); chimeReveal(); resolve(); };
      card.addEventListener('click', flip);
      track(card, { lock: () => true, end: ({ dx, dy }) => { if (Math.hypot(dx, dy) > 40) flip(); } });
    });
    await wait(500);
    text.hidden = false;
  } else {
    stage.append(m);
    if (from) {
      // The old metal turns over into the new one.
      await wait(700);
      m.classList.add('is-turning');
      await wait(250);
      m.dataset.tier = b.tier;
      haptic(15);
      await wait(350);
      m.classList.remove('is-turning');
    }
  }

  // ---- 2. rub (or tap) to polish ----
  mount(help, tx('badge.rub'));
  await new Promise(resolve => {
    let rubbed = 0, last = null, done = false;
    const polish = () => {
      if (done) return;
      done = true;
      m.classList.add('is-polished');
      haptic(25);
      chimeReveal();
      confetti(ui.el, 80);
      resolve();
    };
    const move = e => {
      if (!e.buttons && e.pointerType === 'mouse') { last = null; return; }
      if (last) {
        rubbed += Math.hypot(e.clientX - last.x, e.clientY - last.y);
        m.style.setProperty('--shine', String(clamp(rubbed / RUB_PX)));
        if (rubbed > RUB_PX) polish();
      }
      last = { x: e.clientX, y: e.clientY };
    };
    m.addEventListener('pointerdown', e => { last = { x: e.clientX, y: e.clientY }; m.setPointerCapture?.(e.pointerId); });
    m.addEventListener('pointermove', move);
    m.addEventListener('pointerup', () => { last = null; });
    m.addEventListener('click', polish);
    ok.addEventListener('click', polish, { once: true });
    actions.hidden = false;
  });

  // ---- 3. flick it up to the Badges button ----
  mount(help, tx('badge.flick'));
  await new Promise(resolve => {
    const pose = { x: 0, y: 0, s: 1 };
    const place = () => m.style.setProperty('transform', `translate(${pose.x}px, ${pose.y}px) scale(${pose.s})`);
    let flown = false, cancel = null;
    const fly = () => {
      if (flown) return;
      flown = true;
      cancel?.();
      actions.hidden = true;
      help.hidden = true;
      ui.scrim.classList.add('is-faint');
      const target = badgesTarget();
      const r = m.getBoundingClientRect();
      const start = { ...pose };
      const dx = target ? target.rect.left + target.rect.width / 2 - (r.left + r.width / 2) : 0;
      const dy = target ? target.rect.top + target.rect.height / 2 - (r.top + r.height / 2) : -innerHeight;
      haptic(15);
      tween({
        from: 0, to: 1, duration: 600, ease: t => t * t * (3 - 2 * t),
        onUpdate: u => {
          pose.x = start.x + dx * u;
          pose.y = start.y + dy * u - Math.sin(Math.PI * u) * 60;
          pose.s = lerp(start.s, 0.15, u);
          place();
        },
        onDone: () => {
          target?.el.classList.remove('is-bumping');
          void target?.el.offsetWidth;
          target?.el.classList.add('is-bumping');
          resolve();
        },
      });
    };
    track(m, {
      start: () => !flown,
      lock: () => { cancel?.(); return true; },
      move: ({ dx, dy }) => { pose.x = dx; pose.y = dy; place(); },
      end: ({ dy, vy }) => {
        if ((dy < -80 && vy < -150) || vy < -900 || dy < -200) { fly(); return; }
        const from = { ...pose };
        cancel = spring({ from: 1, to: 0, onUpdate: k => { pose.x = from.x * k; pose.y = from.y * k; place(); } });
      },
    });
    mount(ok, tx('badge.great'));
    actions.hidden = false;
    ok.addEventListener('click', fly, { once: true });
  });
  await wait(250);
}

// Celebrate the badges in turn. ui: the pack overlay to use, or null for a new one.
export async function celebrate(badges, ui = null) {
  if (!badges?.length) return;
  const own = !ui;
  ui ??= overlay();
  try {
    for (const item of collapse(badges)) await scene(ui, item);
  } finally {
    if (own) {
      ui.el.classList.remove('is-open');
      setTimeout(() => ui.el.remove(), 250);
    }
  }
}
