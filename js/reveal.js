// "New card arrived!" — shows each newly unlocked card, one at a time, with a
// flip animation, then marks it collected. Also celebrates finished groups.
import { h, mount } from './dom.js';
import { bi, tx, label } from './i18n.js';
import { pendingReveals, collect, groupById } from './store.js';
import { picture, cardNo } from './components.js';
import { confetti, chimeReveal, chimeGood } from './fx.js';

let running = false;

function overlay() {
  const el = h('div', { class: 'reveal', role: 'dialog', 'aria-modal': 'true' });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-open'));
  return el;
}

const waitForClick = (...buttons) => new Promise(resolve => {
  buttons.forEach(b => b.addEventListener('click', () => resolve(b.dataset.act ?? ''), { once: true }));
});

async function showCard(el, card, remaining) {
  const g = groupById(card.group);
  const flip = h('button', { class: 'flip', type: 'button', 'data-group': card.group, 'aria-label': label('reveal.tap') },
    h('span', { class: 'flip__inner' },
      h('span', { class: 'flip__face flip__back' },
        h('span', { class: 'flip__emoji', 'aria-hidden': 'true' }, g.emoji),
        h('span', { class: 'flip__hint' }, tx('reveal.tap'))),
      h('span', { class: 'flip__face flip__front' },
        h('span', { class: 'flip__no' }, cardNo(card.number)),
        h('span', { class: 'flip__pic' }, picture(card)),
        h('span', { class: 'flip__name' }, bi(card.name)))));
  const see = h('a', { class: 'btn btn--soft btn--big', href: `#/card/${encodeURIComponent(card.id)}`, 'data-act': 'see' }, tx('reveal.see'));
  const nextBtn = h('button', { class: 'btn btn--accent btn--big', type: 'button', 'data-act': 'next' },
    tx(remaining ? 'reveal.next' : 'reveal.done'));
  const actions = h('div', { class: 'reveal__actions', hidden: true }, see, nextBtn);

  mount(el,
    h('p', { class: 'reveal__title' }, tx('reveal.title')),
    flip,
    actions,
    remaining > 0 && h('p', { class: 'reveal__more' }, tx('reveal.more', { n: remaining })));

  flip.focus();
  await waitForClick(flip);
  flip.classList.add('is-flipped');
  chimeReveal();
  confetti(el);
  const badge = await collect(card.id);
  actions.hidden = false;
  const act = await waitForClick(see, nextBtn);
  return { act, badge };
}

async function showBadge(el, g) {
  const ok = h('button', { class: 'btn btn--accent btn--big', type: 'button' }, tx('badge.great'));
  mount(el,
    h('p', { class: 'reveal__title' }, tx('badge.earned')),
    h('div', { class: 'medal medal--earned medal--huge', 'data-group': g.id }, h('span', { 'aria-hidden': 'true' }, g.emoji)),
    h('p', { class: 'reveal__text' }, tx('badge.complete', { group: g.name })),
    h('div', { class: 'reveal__actions' }, ok));
  chimeGood();
  confetti(el, 80);
  await waitForClick(ok);
}

export async function runReveals(onDone) {
  if (running) return;
  const queue = pendingReveals();
  if (!queue.length) return;
  running = true;
  const el = overlay();
  try {
    for (let i = 0; i < queue.length; i++) {
      const { act, badge } = await showCard(el, queue[i], queue.length - i - 1);
      if (badge) await showBadge(el, badge);
      // "See card" opens this card; any others stay waiting for the next visit to the binder.
      if (act === 'see') break;
    }
  } finally {
    el.classList.remove('is-open');
    setTimeout(() => el.remove(), 250);
    running = false;
    onDone?.();
  }
}
