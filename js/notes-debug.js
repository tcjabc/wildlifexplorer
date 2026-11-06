// ?debug=taps (js/store.js debugOn): every tap zone in the notebook outlined with its size in CSS px,
// red when it is under the 44 px a finger needs. For checking on a real screen; nothing else uses it.
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
