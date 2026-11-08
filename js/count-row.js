// A row of little figures to tap and count. Each tap lights the next one and shows its number; the
// last shows the whole thing ("12 of you!"), and one more starts again. The row is a single button,
// so a child who taps anywhere on it counts. Silent, with a short vibration.
import { h, mount, reducedMotion } from './dom.js';
import { bi, label } from './i18n.js';
import { haptic } from './gesture.js';

// count: how many. figure(): one figure, a new element each time. done: the pair shown at the end.
export function countRow({ count, figure, done }) {
  let lit = 0;
  const figs = Array.from({ length: count }, () => h('span', { class: 'count__fig' }, figure()));
  const say = h('span', { class: 'count__say', 'aria-live': 'polite' });

  const reset = () => { lit = 0; figs.forEach(f => f.classList.remove('is-lit')); mount(say, h('span', { 'aria-hidden': 'true' }, '👆')); };
  const tap = () => {
    if (lit === count) reset();
    const fig = figs[lit++];
    fig.classList.add('is-lit');
    if (!reducedMotion()) fig.animate?.([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
    mount(say, lit === count ? bi(done) : String(lit));
    haptic(6);
  };
  reset();
  // All the figures in one row: smaller when there are more than fit (the gaps stay as they are).
  const row = h('span', { class: 'count__figs' }, figs);
  const fit = () => {
    row.style.setProperty('--fig-scale', '1');
    const gaps = (parseFloat(getComputedStyle(row).columnGap) || 0) * (count - 1);
    const k = (row.clientWidth - gaps) / (row.scrollWidth - gaps);
    if (k > 0 && k < 1) row.style.setProperty('--fig-scale', String(Math.floor(k * 100) / 100));
  };
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (row.isConnected) fit(); else watch.disconnect(); }) : null;
  watch?.observe(row);
  row.addEventListener('load', fit, true); // a picture arriving makes the row wider
  return h('button', { class: 'count', type: 'button', 'aria-label': label('card.countTap'), onclick: tap }, row, say);
}
