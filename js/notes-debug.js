// ?debug=taps (js/store.js debugOn): every tap zone in the notebook outlined with its size in CSS px,
// red when it is under the 44 px a finger needs. For checking on a real screen; nothing else uses it.
// ?debug=notes: see below.
import { h } from './dom.js';

const MIN = 44;
const ZONES = 'button, input, .nb-polaroid';

export function tapZones(root) {
  const box = h('div', { class: 'nb-taps', 'aria-hidden': 'true' });
  root.append(box);
  return {
    draw() {
      const at = root.getBoundingClientRect();
      box.replaceChildren(...[...root.querySelectorAll(ZONES)].flatMap(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest('dialog')) return [];
        const w = Math.round(r.width), hgt = Math.round(r.height);
        return h('span', {
          class: ['nb-taps__zone', (w < MIN || hgt < MIN) && 'nb-taps__zone--small'],
          style: { left: `${r.left - at.left}px`, top: `${r.top - at.top}px`, width: `${r.width}px`, height: `${r.height}px` },
        }, `${w}×${hgt}`);
      }));
    },
    remove: () => box.remove(),
  };
}

// ?debug=notes: window.wfNotes.heavy() opens a page far fuller than the soft cap allows (what two
// three-year-olds and the pages from before it can reach), and bench() times what it costs to draw.
// The numbers mean something on the device only; a desktop is many times faster.
const HEAVY_STAMPS = 400, HEAVY_TRAILS = 20, TRAIL_POINTS = 40;
const INKS = ['#3d3a35', '#c0392b', '#2e7d32', '#1565c0', '#6a1b9a'];

// The same page every time. cards: ids to stamp, round and round.
export function heavyItems(cards, w, hgt, stamps = HEAVY_STAMPS, trails = HEAVY_TRAILS) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const items = [];
  for (let i = 0; i < stamps; i++) {
    items.push({ t: 'm', c: INKS[i % INKS.length], card: cards[i % cards.length], x: rnd() * w, y: 180 + rnd() * (hgt - 200), s: 60 + rnd() * 120, r: (rnd() - 0.5) * 0.6 });
  }
  for (let i = 0; i < trails; i++) {
    const p = [], y = 200 + rnd() * (hgt - 300), bend = 40 + rnd() * 80;
    for (let j = 0; j < TRAIL_POINTS; j++) p.push((j / TRAIL_POINTS) * w, y + Math.sin(j / 4 + i) * bend);
    items.push({ t: 'f', c: INKS[i % INKS.length], k: ['paw', 'hoof', 'bird', 'bear'][i % 4], p });
  }
  return items;
}

// The average of n runs of what is timed, with the canvas made to finish (a read of one pixel).
export async function timed(n, run, canvas) {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await run();
  canvas.getContext('2d').getImageData(0, 0, 1, 1);
  return Math.round(((performance.now() - t0) / n) * 10) / 10;
}
