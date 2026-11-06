// The rails' objects, drawn as SVG: the pen pouch and what is in it, the ink pad, the stamps and
// the ruler. Flat colours from tokens (css/notes.css gives each .nb-a-* its fill), no blur, no
// filters. The art only; js/notebook.js makes the buttons around it and says what they do.
//
// The pouch is drawn standing up, in a rail --nb-rail wide. Lying on its side in a band is the
// same drawing turned a quarter (css/notes.css). Each tool is its own svg between the pouch's
// back and front, so raising one moves a single layer. A tool's tip sits in a row of its own, the
// row being what a finger taps: the ruler at the back and tallest, the eraser in front.
import { svg } from './dom.js';

const PITCH = 44;     // a tool's row (--nb-tool-pitch)
const TUCKED = 40;    // how far it reaches into the pouch
const W = 68;         // the rail (--nb-rail)
export const TOOL_ROWS = ['ruler', 'pencil', 'pen', 'highlighter', 'eraser'];

const art = (w, hgt, ...kids) => svg('svg', { class: 'nb-art', viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, 'aria-hidden': 'true', focusable: 'false' }, kids);
const path = (cls, d) => svg('path', { class: `nb-a-${cls}`, d });
const rect = (cls, x, y, w, hgt, r = 0) => svg('rect', { class: `nb-a-${cls}`, x, y, width: w, height: hgt, rx: r || null });
const circle = (cls, cx, cy, r) => svg('circle', { class: `nb-a-${cls}`, cx, cy, r });
const ellipse = (cls, cx, cy, rx, ry, turn = 0) => svg('ellipse', { class: `nb-a-${cls}`, cx, cy, rx, ry, transform: turn ? `rotate(${turn} ${cx} ${cy})` : null });
const line = (cls, d) => svg('path', { class: `nb-l-${cls}`, d });

// ---------- what is in the pouch ----------
// Each is drawn from its tip (y 0) down `len` px. The tinted parts take the tool's colour.
const TOOLS = {
  ruler: (cx, len) => {
    const x = cx - 10, ticks = [];
    for (let y = 8, i = 0; y < len; y += 6, i++) ticks.push(`M${x} ${y}h${i % 5 ? 5 : 9}`);
    return [rect('ruler', x, 0, 20, len, 2), line('tick', ticks.join('')), circle('hole', cx + 4, 8, 2.5)];
  },
  pencil: (cx, len) => [
    path('wood', `M${cx - 8} 24L${cx - 3} 8H${cx + 3}L${cx + 8} 24Z`),
    path('tint', `M${cx} 0L${cx + 3} 8H${cx - 3}Z`),
    path('wood-dark', `M${cx - 8} 24l3.2-2 2.2 2 2.6-2 2.6 2 2.2-2 3.2 2Z`),
    rect('tint', cx - 8, 24, 16, len - 24),
    rect('shine', cx - 3, 24, 3, len - 24),
    rect('shade', cx + 4, 24, 4, len - 24),
  ],
  pen: (cx, len) => [
    path('metal', `M${cx} 0L${cx + 1.6} 6L${cx + 6} 22H${cx - 6}L${cx - 1.6} 6Z`),
    rect('grip', cx - 6, 22, 12, 12),
    rect('tint', cx - 6, 34, 12, len - 34),
    rect('shine', cx - 3, 34, 2.5, len - 34),
    rect('metal', cx + 3, 38, 2.5, 26, 1),
  ],
  highlighter: (cx, len) => [
    path('tint', `M${cx - 7} 14L${cx + 7} 2V14Z`),
    rect('collar', cx - 9, 14, 18, 8),
    rect('tint', cx - 10, 22, 20, len - 22, 2),
    rect('shine', cx - 6, 22, 3, len - 22),
    rect('label', cx - 10, 34, 20, 14),
  ],
  eraser: (cx, len) => [
    rect('rubber', cx - 15, 0, 30, len, 5),
    rect('rubber-shade', cx + 8, 3, 5, 15, 2),
    rect('sleeve', cx - 15, 18, 30, len - 18),
    rect('sleeve-band', cx - 15, 26, 30, 7),
  ],
};
// Across the rail, zig-zag, so each one shows beside the taller one behind it.
const PLACES = { ruler: 16, pencil: 50, pen: 31, highlighter: 53, eraser: 30 };

export function toolArt(id) {
  const len = (TOOL_ROWS.length - TOOL_ROWS.indexOf(id)) * PITCH + TUCKED;
  return art(W, len, TOOLS[id](PLACES[id], len));
}

// ---------- the pouch ----------
// A cylinder of green canvas: the dark inside of its mouth behind the tools, and in front of them
// the body with a zip round it near the top. Where the rail is short, it shows only the top.
const POUCH_H = 130;
const pouchSvg = (...kids) => svg('svg', {
  class: 'nb-art nb-pouch__art', viewBox: `0 0 ${W} ${POUCH_H}`, preserveAspectRatio: 'xMidYMin slice', 'aria-hidden': 'true', focusable: 'false',
}, kids);

export const pouchBack = () => pouchSvg(ellipse('pouch-inside', 34, 10, 31, 9));

export const pouchFront = () => pouchSvg(
  path('pouch', 'M3 10A31 9 0 0 0 65 10V116Q34 130 3 116Z'),
  path('pouch-light', 'M16 17.2Q22 18.6 28 19V122.8Q22 122.2 16 120.7Z'),
  path('pouch-dark', 'M3 10A31 9 0 0 0 11 15.8V119.4Q6.5 118 3 116Z'),
  path('pouch-dark', 'M65 10A31 9 0 0 1 56 15.9V119.7Q61 118 65 116Z'),
  path('zip-tape', 'M3 26Q34 42 65 26V36Q34 52 3 36Z'),
  line('zip-teeth', 'M3 31Q34 47 65 31'),
  rect('metal', 43, 34, 9, 7, 1.5),
  rect('metal', 45.5, 40, 4, 14, 2),
  line('stitch', 'M3 106Q34 120 65 106'),
);

// ---------- the ink pad ----------
export const inkPadArt = () => art(64, 52,
  rect('metal', 5, 1, 54, 14, 3),
  rect('metal-dark', 5, 11, 54, 4),
  rect('tin', 1, 12, 62, 38, 6),
  rect('tin-rim', 6, 17, 52, 28, 3),
  rect('ink', 9, 20, 46, 22, 2),
  line('felt', 'M13 26h38M13 32h38M13 38h38'));

// ---------- the stamps ----------
const body = (...face) => [
  rect('wood-dark', 25, 30, 14, 12),
  rect('wood-light', 5, 40, 54, 24, 4),
  rect('wood', 5, 58, 54, 6),
  rect('ink', 8, 64, 48, 9, 1.5),
  face,
];
const knob = () => [ellipse('wood', 32, 18, 15, 15), ellipse('wood-light', 27, 13, 5, 4, -30)];

const STAMPS = {
  // "ABC" as drawn letters: they are carved on the stamp, not text in a language.
  text: () => [knob(), body(line('carve', 'M12 58L18 44L24 58M14.5 53H21.5M28 44V58M28 44H33A3.5 3.5 0 0 1 33 51H28M33 51A3.5 3.5 0 0 1 33 58H28M52 46.5A7 7 0 1 0 52 55.5'))],
  // The panda is the knob. The block is left for the animal on the stamp (notebook.js puts it there).
  stamp: () => [
    body(),
    circle('panda-dark', 18, 8, 6.5), circle('panda-dark', 46, 8, 6.5),
    circle('panda', 32, 19, 17),
    ellipse('panda-dark', 25, 18, 4.5, 5.5, 20), ellipse('panda-dark', 39, 18, 4.5, 5.5, -20),
    circle('panda', 25.5, 17, 1.6), circle('panda', 38.5, 17, 1.6),
    ellipse('panda-dark', 32, 25, 3, 2.2),
    line('panda-mouth', 'M32 27v2M28.5 30Q32 32.5 35.5 30'),
  ],
  roller: () => [knob(), body(
    ellipse('carve-fill', 32, 54, 7, 5.5),
    ellipse('carve-fill', 21, 49, 2.8, 3.6, -20), ellipse('carve-fill', 28, 45.5, 2.8, 3.6, -6),
    ellipse('carve-fill', 36, 45.5, 2.8, 3.6, 6), ellipse('carve-fill', 43, 49, 2.8, 3.6, 20))],
};
export const stampArt = kind => art(64, 74, STAMPS[kind]());

// ---------- the ruler on the page ----------
// Drawn at its size in page units (js/notes-ruler.js); the element around it scales it.
export function rulerArt(l, hgt) {
  const small = [], big = [], digits = [];
  for (let x = 20, i = 1; x < l - 10; x += 20, i++) {
    if (i % 5) small.push(`M${x} 0v14M${x} ${hgt}v-14`);
    else {
      big.push(`M${x} 0v26M${x} ${hgt}v-26`);
      digits.push(svg('text', { class: 'nb-a-digit', x, y: hgt / 2 + 9, 'text-anchor': 'middle' }, String(i / 5)));
    }
  }
  return svg('svg', { class: 'nb-art', viewBox: `0 0 ${l} ${hgt}`, 'aria-hidden': 'true', focusable: 'false' },
    rect('ruler-glass', 0, 0, l, hgt, 6),
    line('ruler-small', small.join('')), line('ruler-big', big.join('')), digits);
}
