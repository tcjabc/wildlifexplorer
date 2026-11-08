// "Creature comparison": the animal measured against the child holding the tablet, or something
// else everyone knows (a grown-up, a cat, a car: PARTNERS in js/compare-data.js).
// One scene per statistic, each with a short animation that replays on every tap:
//   length   – silhouettes side by side, growing up from the ground
//   weight   – a balance; the lighter side fills with copies until it levels out
//   lifespan – birthday timelines, candles ticking along
// The child defaults to 120 cm / 23 kg / 6 years; each profile can set its own (Welcome form).
import { h, mount, reducedMotion } from './dom.js';
import { bi, t, tx } from './i18n.js';
import { state, groupById, currentAge } from './store.js';
import { lengthText } from './units.js';
import { haptic } from './gesture.js';
import { CHILD_RATIO, PARTNERS, compareImage, numbers, sizeOf, sizeStat } from './compare-data.js';

const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

export const CHILD_DEFAULT = { heightCm: 120, weightKg: 23, age: 6 };
function child() {
  const p = state.profile ?? {};
  const age = currentAge(p);
  return {
    heightCm: p.heightCm ?? CHILD_DEFAULT.heightCm,
    weightKg: p.weightKg ?? CHILD_DEFAULT.weightKg,
    age: age ?? CHILD_DEFAULT.age,
  };
}

const ELEPHANT_KG = 6000;
const MAX_COPIES = 20;   // more than this and the balance shows a counter instead
const MAX_TILT = 16;     // degrees
const fmt = n => Math.round(n).toLocaleString('en');

// ---------- animation helpers (all skipped with reduced motion) ----------

function play(el, frames, opts) {
  if (reducedMotion() || !el.animate) return null;
  return el.animate(frames, { fill: 'backwards', easing: 'cubic-bezier(.34,1.56,.64,1)', ...opts });
}

// Runs `steps` callbacks spaced `gap` ms apart; stops if the scene is replaced.
function sequence(run, count, gap, each, done) {
  if (reducedMotion()) { for (let i = 0; i < count; i++) each(i); done?.(); return; }
  let i = 0;
  const tick = () => {
    if (!run.alive) return;
    if (i >= count) { done?.(); return; }
    each(i++);
    setTimeout(tick, gap);
  };
  tick();
}

// Counts a number up over `ms` (ease-out), calling `each(value)` every frame.
function countUp(run, from, to, ms, each, done) {
  if (reducedMotion()) { each(to); done?.(); return; }
  const start = performance.now();
  const step = now => {
    if (!run.alive) return;
    const k = Math.min(1, (now - start) / ms);
    each(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

// Who the animal is measured against: the child, or one of PARTNERS.
//   { id, name, img, cm, across, ratio, kg }
export function partner(id = 'you') {
  if (id !== 'you') return { ...PARTNERS[id], name: t(`compare.partner.${id}`) };
  const you = child();
  return { id, name: t('card.you'), img: 'assets/child.svg', cm: you.heightCm, across: false, ratio: CHILD_RATIO, kg: you.weightKg };
}

export const whoImg = (who, cls) => h('img', { class: ['cmp__you', cls], src: who.img, alt: '' });
export const animalImg = (card, cls) => compareImage(card)
  ? h('img', { class: ['cmp__animal', cls], src: compareImage(card), alt: '' })
  : h('span', { class: ['cmp__emoji', cls], 'aria-hidden': 'true' }, groupById(card.group)?.emoji);

// ---------- length ----------

function lengthScene(card, run, who) {
  const size = sizeOf(card);
  const stat = sizeStat(card);
  const kidImg = whoImg(who, 'cmp-len__img');
  const pic = animalImg(card, 'cmp-len__img');
  const items = [h('figure', { class: 'cmp-len__item' }, kidImg), h('figure', { class: 'cmp-len__item' }, pic)];
  const ground = h('div', { class: 'cmp-len__ground' }, items);
  // Names and sizes in a row of their own under the ground, half the width each, so they never
  // run into each other; each sits under its figure as far as its half allows.
  const caps = [
    h('div', { class: 'cmp-len__cap' }, bi(who.name), h('span', { class: 'cmp__num' }, bi(lengthText(who.showCm ?? who.cm)))),
    h('div', { class: 'cmp-len__cap' }, bi(card.name), h('span', { class: 'cmp__num' }, bi(stat ? lengthText(stat.min, stat.max) : lengthText(size.cm)))),
  ];
  const scene = h('div', { class: 'cmp-len' }, ground, h('div', { class: 'cmp-len__caps' }, caps));

  // Once the silhouette's shape is known, size both so 1 cm is the same on each, from the room the
  // ground has. Sized again (without the animation) whenever the stage changes size: run.resize.
  const size1 = () => {
    const ratio = pic.naturalHeight / pic.naturalWidth || 0.6;
    const w = size.across ? size.cm : size.cm / ratio;
    const whoW = who.across ? who.cm : who.cm / who.ratio;
    const tallest = Math.max(whoW * who.ratio, w * ratio);
    const laid = ground.clientWidth > 0; // not on the page yet: its design size
    const avail = laid ? ground.clientHeight : cssNum('--compare-h');
    const availW = (laid ? ground.clientWidth : cssNum('--card-w')) * 0.8;
    const pxPerCm = Math.min(avail / tallest, availW / (w + whoW));
    kidImg.style.setProperty('width', `${whoW * pxPerCm}px`);
    pic.style.setProperty('width', `${w * pxPerCm}px`);
    scene.dataset.ready = '';
    caps.forEach((cap, i) => {
      cap.style.removeProperty('transform');
      const c = cap.getBoundingClientRect(), half = cap.parentElement.getBoundingClientRect();
      const f = items[i].getBoundingClientRect();
      const col = half.left + (half.width / 2) * (i + 0.5), room = (half.width / 2 - c.width) / 2;
      const k = cap.offsetWidth / (c.width || 1); // screen px to the card's own px
      const shift = Math.max(-room, Math.min(room, f.left + f.width / 2 - col));
      cap.style.setProperty('transform', `translateX(${shift * k}px)`);
    });
  };
  const layout = () => {
    if (!run.alive) return;
    size1();
    run.resize = size1;
    [kidImg, pic].forEach((el, i) => play(el, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 600, delay: i * 180 }));
  };
  if (pic.complete) requestAnimationFrame(layout); else pic.addEventListener('load', () => requestAnimationFrame(layout));
  return [scene];
}

// ---------- weight ----------

// The biggest copies (px high) of which n fit in rows in room { w, h }, each aspect wide for its
// height, gap apart; at most `most` high.
export function copySize(n, room, aspect, gap, most) {
  for (let size = Math.floor(most); size > 1; size--) {
    const cols = Math.max(1, Math.floor((room.w + gap) / (size * aspect + gap)));
    const rows = Math.ceil(n / cols);
    if (size * aspect <= room.w && rows * size + (rows - 1) * gap <= room.h) return size;
  }
  return 1;
}

function weightScene(card, run, who) {
  const w = numbers(card).weightKg;
  const animalHeavier = w >= who.kg;
  const heavy = Math.max(w, who.kg), light = Math.min(w, who.kg);
  const n = Math.max(1, Math.round(heavy / light));
  const many = n > MAX_COPIES;

  // You on the left, the animal on the right; the lighter side gets the copies.
  const panYou = h('div', { class: 'cmp-wt__pan cmp-wt__pan--left' });
  const panAnimal = h('div', { class: 'cmp-wt__pan cmp-wt__pan--right' });
  const lightPan = animalHeavier ? panYou : panAnimal;
  const heavyPan = animalHeavier ? panAnimal : panYou;
  const icon = side => (side === 'you' ? whoImg(who, 'cmp-wt__icon') : animalImg(card, 'cmp-wt__icon'));
  const lightSide = animalHeavier ? 'you' : 'animal';
  heavyPan.append(h('div', { class: 'cmp-wt__stack cmp-wt__stack--one' }, icon(animalHeavier ? 'animal' : 'you')));
  const stack = h('div', { class: 'cmp-wt__stack' });
  const counter = h('span', { class: 'cmp-wt__count', hidden: true });
  lightPan.append(stack, counter);

  const scene = h('div', { class: 'cmp-wt' },
    h('div', { class: 'cmp-wt__post' }), h('div', { class: 'cmp-wt__beam' }), panYou, panAnimal);

  // Tilt towards the heavy side, levelling out as the light side fills up.
  const setBalance = copies => {
    const imbalance = Math.max(-1, Math.min(1, (heavy - copies * light) / heavy));
    const tilt = (animalHeavier ? 1 : -1) * MAX_TILT * imbalance;
    scene.style.setProperty('--tilt', `${tilt}deg`);
    scene.style.setProperty('--drop', String(Math.sin((tilt * Math.PI) / 180)));
  };
  setBalance(0);

  const name = card.name;
  let caption;
  if (n === 1 && heavy / light < 1.4) caption = t('compare.weightEqual', { name, who: who.name });
  else caption = t(animalHeavier ? 'compare.weightHeavy' : 'compare.weightLight', { n: fmt(n), name, who: who.name });
  const elephants = animalHeavier && many && w / ELEPHANT_KG >= 2 ? t('compare.elephants', { n: fmt(w / ELEPHANT_KG), name }) : null;
  const text = h('div', { class: 'cmp__caption', hidden: !reducedMotion() }, bi(caption), elephants && bi(elephants, 'cmp__sub'));

  const shown = many ? MAX_COPIES : n;

  // Every copy fits on its pan, under the buttons above the scene, even with the pan at its highest
  // while it tilts: the copies get as big as that allows (never bigger than one on its own). Fitted
  // again whenever the stage changes size (run.resize).
  const probe = icon(lightSide);
  const fit = () => {
    if (!run.alive || !scene.isConnected) return;
    const arm = lightPan.offsetWidth / 1.05;
    const floor = lightPan.offsetTop + lightPan.offsetHeight - parseFloat(getComputedStyle(stack).bottom || '0');
    const room = { w: lightPan.offsetWidth, h: Math.max(1, floor - arm * Math.sin((MAX_TILT * Math.PI) / 180)) };
    const gap = parseFloat(getComputedStyle(stack).columnGap) || 0;
    const most = Math.min(cssNum('--stage-cmp-icon') || room.h, room.h);
    const aspect = probe.naturalWidth && probe.naturalHeight ? probe.naturalWidth / probe.naturalHeight : 1;
    scene.style.setProperty('--wt-one', `${most}px`);
    scene.style.setProperty('--wt-icon', `${copySize(shown, room, aspect, gap, most)}px`);
  };
  run.resize = fit;
  if (probe.tagName !== 'IMG' || probe.complete) requestAnimationFrame(fit);
  else probe.addEventListener('load', () => requestAnimationFrame(fit));
  sequence(run, shown, many ? 45 : 160, i => {
    const el = icon(lightSide);
    stack.append(el);
    play(el, [{ transform: 'translateY(-30px) scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320 });
    setBalance(i + 1);
    if (!many && i % 2 === 0) haptic(4);
  }, () => {
    if (!many) { text.hidden = false; return; }
    // Too many to draw: a counter rolls up the rest of the way.
    counter.hidden = false;
    countUp(run, shown, n, 1400, v => {
      counter.textContent = `× ${fmt(v)}`;
      setBalance(v);
    }, () => { text.hidden = false; haptic(10); });
  });
  if (reducedMotion()) { setBalance(n); if (many) { counter.hidden = false; counter.textContent = `× ${fmt(n)}`; } }
  return [scene, text];
}

// ---------- lifespan ----------

function lifespanScene(card, run) {
  const you = child();
  const years = numbers(card).lifespanYears;
  const top = Math.max(years, you.age) * 1.04;

  const row = (labelPair, value, cls) => {
    // A candle per birthday for short lives; one per 5 or 10 years for long ones.
    const every = value > 50 ? 10 : value > 12 ? 5 : 1;
    const fill = h('div', { class: 'cmp-life__fill' });
    const candles = h('div', { class: 'cmp-life__candles' });
    const cake = h('span', { class: 'cmp-life__cake', 'aria-hidden': 'true', hidden: true }, '🎂');
    const num = h('span', { class: 'cmp__num' }, '0');
    const el = h('div', { class: ['cmp-life__row', cls] },
      h('span', { class: 'cmp-life__who' }, bi(labelPair)),
      h('div', { class: 'cmp-life__track' }, fill, candles, cake),
      num);
    const grow = (done, ms) => {
      let lit = 0;
      countUp(run, 0, value, ms, v => {
        fill.style.setProperty('width', `${(v / top) * 100}%`);
        num.textContent = fmt(v);
        // A candle for every birthday (or every 5 or 10 years for long lives).
        while ((lit + 1) * every <= v) {
          lit++;
          const c = h('span', { class: 'cmp-life__candle', 'aria-hidden': 'true', style: { left: `${((lit * every) / top) * 100}%` } }, '🕯️');
          candles.append(c);
          play(c, [{ transform: 'translate(-50%, -12px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 260 });
        }
      }, () => {
        cake.hidden = false;
        cake.style.setProperty('left', `${(value / top) * 100}%`);
        play(cake, [{ transform: 'translate(-50%, 0) scale(0)' }, { transform: 'translate(-50%, 0) scale(1)' }], { duration: 400 });
        done?.();
      });
    };
    return { el, grow };
  };

  const kid = row(t('compare.lifespanYou', { n: you.age }), you.age, 'cmp-life__row--you');
  const animal = row(t('compare.lifespanAnimal', { n: fmt(years), name: card.name }), years);
  kid.grow(() => animal.grow(() => haptic(8), 1600), 600);
  return [h('div', { class: 'cmp-life' }, animal.el, kid.el)];
}

const SCENES = { length: lengthScene, weight: weightScene, lifespan: lifespanScene };

// The comparison panel. show(mode, who) swaps the scene and replays its animation.
export function comparePanel(card) {
  const body = h('div', { class: 'cmp' });
  let run = { alive: false };
  return {
    el: body,
    show(mode, who = partner()) {
      run.alive = false;
      run = { alive: true };
      mount(body, SCENES[mode](card, run, who));
    },
    // The stage changed size: the scene fits it again, where it is, without starting over.
    resize() { if (run.alive) run.resize?.(); },
    stop() { run.alive = false; },
  };
}
