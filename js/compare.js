// "Creature comparison": the animal measured against the child holding the tablet.
// One scene per statistic, each with a short animation that replays on every tap:
//   length   – silhouettes side by side, growing up from the ground
//   weight   – a balance; the lighter side fills with copies until it levels out
//   lifespan – birthday timelines, candles ticking along
//   diet     – a plate filling with what the animal eats
// The child defaults to 120 cm / 23 kg / 6 years; each profile can set its own (Welcome form).
import { h, mount, reducedMotion } from './dom.js';
import { bi, t, tx } from './i18n.js';
import { state, groupById, currentAge } from './store.js';
import { lengthText } from './units.js';
import { haptic } from './gesture.js';

const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

export const CHILD_DEFAULT = { heightCm: 120, weightKg: 23, age: 6 };
export function child() {
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
const filled = p => p && (p.en || p.zh);

const mid = r => (r == null ? null : typeof r === 'number' ? r : r.max == null ? r.min : (r.min + r.max) / 2);

// Numbers for the comparisons: lengthCm / weightKg / lifespanYears ({ min, max }, the midpoint
// is used), or the older { min, max, unit } shape of length / weight / lifespan.
export function numbers(card) {
  const s = card.stats ?? {};
  const old = (o, unit) => (o?.min != null && o.unit === unit ? o : null);
  return {
    lengthCm: mid(s.lengthCm ?? old(s.length, 'cm')),
    weightKg: mid(s.weightKg ?? old(s.weight, 'kg')),
    lifespanYears: mid(s.lifespanYears ?? old(s.lifespan, 'years')),
  };
}

export function modesFor(card) {
  const n = numbers(card);
  const s = card.stats ?? {};
  return {
    length: Boolean(card.silhouette?.file && (card.compare?.width || card.compare?.height || n.lengthCm)),
    weight: Boolean(n.weightKg),
    lifespan: Boolean(n.lifespanYears),
    diet: Boolean(s.dietIcons?.length || filled(s.diet)),
  };
}

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

const youImg = cls => h('img', { class: ['cmp__you', cls], src: 'assets/child.svg', alt: '' });
const animalImg = (card, cls) => card.silhouette?.file
  ? h('img', { class: ['cmp__animal', cls], src: card.silhouette.file, alt: '' })
  : h('span', { class: ['cmp__emoji', cls], 'aria-hidden': 'true' }, groupById(card.group)?.emoji);

// ---------- length ----------

function lengthScene(card, run) {
  const you = child();
  const n = numbers(card);
  const ground = h('div', { class: 'cmp-len' });
  const kidImg = youImg('cmp-len__img');
  const pic = animalImg(card, 'cmp-len__img');
  const size = card.compare?.width ?? card.compare?.height ?? n.lengthCm;
  ground.append(
    h('figure', { class: 'cmp-len__item' }, kidImg,
      h('figcaption', null, tx('card.you'), h('span', { class: 'cmp__num' }, bi(lengthText(you.heightCm))))),
    h('figure', { class: 'cmp-len__item' }, pic,
      h('figcaption', null, bi(card.name), h('span', { class: 'cmp__num' }, bi(lengthText(size))))));

  // Once the silhouette's shape is known, size both so 1 cm is the same on each.
  const layout = () => {
    if (!run.alive) return;
    const ratio = pic.naturalHeight / pic.naturalWidth || 0.6;
    const w = card.compare?.width ?? (card.compare?.height ? card.compare.height / ratio : n.lengthCm);
    const tallest = Math.max(you.heightCm, w * ratio);
    const avail = cssNum('--compare-h');
    const availW = cssNum('--card-w') * 0.8;
    const pxPerCm = Math.min(avail / tallest, availW / (w + you.heightCm * 0.4 + 10));
    kidImg.style.setProperty('height', `${you.heightCm * pxPerCm}px`);
    pic.style.setProperty('width', `${w * pxPerCm}px`);
    [kidImg, pic].forEach((el, i) => play(el, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 600, delay: i * 180 }));
  };
  if (pic.complete) requestAnimationFrame(layout); else pic.addEventListener('load', () => requestAnimationFrame(layout));
  return [ground];
}

// ---------- weight ----------

function weightScene(card, run) {
  const you = child();
  const w = numbers(card).weightKg;
  const animalHeavier = w >= you.weightKg;
  const heavy = Math.max(w, you.weightKg), light = Math.min(w, you.weightKg);
  const n = Math.max(1, Math.round(heavy / light));
  const many = n > MAX_COPIES;

  // You on the left, the animal on the right; the lighter side gets the copies.
  const panYou = h('div', { class: 'cmp-wt__pan cmp-wt__pan--left' });
  const panAnimal = h('div', { class: 'cmp-wt__pan cmp-wt__pan--right' });
  const lightPan = animalHeavier ? panYou : panAnimal;
  const heavyPan = animalHeavier ? panAnimal : panYou;
  const icon = side => (side === 'you' ? youImg('cmp-wt__icon') : animalImg(card, 'cmp-wt__icon'));
  const lightSide = animalHeavier ? 'you' : 'animal';
  heavyPan.append(h('div', { class: 'cmp-wt__stack' }, icon(animalHeavier ? 'animal' : 'you')));
  const stack = h('div', { class: ['cmp-wt__stack', many && 'is-many'] });
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
  if (n === 1 && heavy / light < 1.4) caption = t('compare.weightEqual', { name });
  else caption = t(animalHeavier ? 'compare.weightHeavy' : 'compare.weightLight', { n: fmt(n), name });
  const elephants = animalHeavier && many && w / ELEPHANT_KG >= 2 ? t('compare.elephants', { n: fmt(w / ELEPHANT_KG), name }) : null;
  const text = h('div', { class: 'cmp__caption', hidden: !reducedMotion() }, bi(caption), elephants && bi(elephants, 'cmp__sub'));

  const shown = many ? MAX_COPIES : n;
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

// ---------- diet ----------

function dietScene(card, run) {
  const s = card.stats ?? {};
  const icons = s.dietIcons ?? [];
  const plate = h('div', { class: 'cmp-diet__plate' });
  sequence(run, icons.length, 220, i => {
    // Spread the food around the plate.
    const a = (i / icons.length) * Math.PI * 2 - Math.PI / 2;
    const r = icons.length > 1 ? 30 : 0;
    const el = h('span', {
      class: 'cmp-diet__food', 'aria-hidden': 'true',
      style: { left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` },
    }, icons[i]);
    plate.append(el);
    play(el, [{ transform: 'translate(-50%, -160%) scale(.5)', opacity: 0 }, { transform: 'translate(-50%, -50%)', opacity: 1 }], { duration: 420 });
  });
  return [h('div', { class: 'cmp-diet' }, plate), filled(s.diet) && h('p', { class: 'cmp__caption' }, bi(s.diet))];
}

const SCENES = { length: lengthScene, weight: weightScene, lifespan: lifespanScene, diet: dietScene };

// The comparison panel. show(mode) swaps the scene and replays its animation.
export function comparePanel(card) {
  const body = h('div', { class: 'cmp' });
  let run = { alive: false };
  return {
    el: body,
    show(mode) {
      run.alive = false;
      run = { alive: true };
      mount(body, SCENES[mode](card, run));
    },
  };
}
