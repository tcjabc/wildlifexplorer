// The objects on the roll and in the tray, drawn as SVG: the tools in their loops, the ink pad, the
// sponge, the stamps, the tweezers, the washi tape, the pile of Polaroids, the wooden tokens, the
// book's spiral and the ruler. Flat colours from tokens (css/notes.css gives each .nb-a-* its fill),
// thick outlines, no blur, no filters. The art only; js/notebook.js makes the buttons around it and
// says what they do.
//
// A tool is drawn standing, tip up; css/notes.css lays it on its side in the roll beside the page.
import { svg } from './dom.js';

const TOOL_W = 36;    // a tool's drawing (--nb-tool-w), and its length
const TOOL_LEN = 150;
export const TOOL_ROWS = ['ruler', 'pencil', 'pen', 'highlighter', 'eraser'];

const art = (w, hgt, ...kids) => svg('svg', { class: 'nb-art', viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, 'aria-hidden': 'true', focusable: 'false' }, kids);
const path = (cls, d) => svg('path', { class: `nb-a-${cls}`, d });
const rect = (cls, x, y, w, hgt, r = 0) => svg('rect', { class: `nb-a-${cls}`, x, y, width: w, height: hgt, rx: r || null });
const circle = (cls, cx, cy, r) => svg('circle', { class: `nb-a-${cls}`, cx, cy, r });
const ellipse = (cls, cx, cy, rx, ry, turn = 0) => svg('ellipse', { class: `nb-a-${cls}`, cx, cy, rx, ry, transform: turn ? `rotate(${turn} ${cx} ${cy})` : null });
const line = (cls, d) => svg('path', { class: `nb-l-${cls}`, d });

// ---------- the tools ----------
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
export const toolArt = id => art(TOOL_W, TOOL_LEN, TOOLS[id](TOOL_W / 2, TOOL_LEN));

// ---------- the ink pad ----------
// A shallow tin, seen from above with its lid off, the pad filling it in the ink in use.
export const inkPadArt = () => art(64, 52,
  rect('tin-rim', 1, 7, 62, 42, 10),
  rect('tin', 1, 4, 62, 41, 10),
  rect('tin-rim', 7, 10, 50, 29, 6),
  rect('ink', 10, 13, 44, 23, 4),
  path('ink-shine', 'M14 17h19v3H14ZM36 17h5v3h-5Z'));

// ---------- the sponge ----------
// A rounded block: its top, the thicker side under it, and the holes.
export const spongeArt = () => art(64, 44,
  path('sponge-dark', 'M5 13Q4 7 12 6Q22 2 34 5Q48 2 56 7Q62 9 60 17V33Q60 39 52 39Q40 42 30 40Q18 42 10 39Q4 37 4 31Z'),
  path('sponge', 'M5 13Q4 7 12 6Q22 2 34 5Q48 2 56 7Q62 9 60 17Q61 27 52 28Q40 31 30 29Q18 31 10 28Q3 26 5 13Z'),
  ellipse('sponge-pore', 14, 13, 3, 2), ellipse('sponge-pore', 26, 10, 2, 1.5), ellipse('sponge-pore', 38, 12, 3.2, 2.2),
  ellipse('sponge-pore', 50, 11, 2.2, 1.6), ellipse('sponge-pore', 20, 21, 2.4, 1.7), ellipse('sponge-pore', 33, 21, 1.8, 1.3),
  ellipse('sponge-pore', 46, 21, 3, 2), ellipse('sponge-pore', 12, 33, 1.8, 1.3), ellipse('sponge-pore', 40, 34, 2, 1.3));

// ---------- the tweezers ----------
// Lying with their tips towards the page.
export const tweezersArt = () => art(64, 44,
  path('metal-dark', 'M63 16Q63 13 59 13L15 9L2 20L5 21.5L17 15L58 19V25L17 29L5 22.5L2 24L15 35L59 31Q63 31 63 28Z'),
  path('metal', 'M63 16Q63 13 59 13L15 9L2 20L5 20.5L17 13.5L60 17.5Z'),
  path('metal', 'M63 28Q63 31 59 31L15 35L2 24L5 23.5L17 30.5L60 26.5Z'),
  rect('metal-dark', 52, 17, 11, 10, 2),
  line('grip', 'M28 11.5v4M32 12v4M36 12.4v4M28 32.5v-4M32 32v-4M36 31.6v-4'));

// ---------- the washi tape ----------
// A roll on its side, its end pulled out. The tape takes the colour on the roll (--washi-c).
export const washiArt = () => art(64, 48,
  path('washi', 'M30 30H62V40H55L52 37L49 40L46 37L43 40H30Z'),
  circle('washi-edge', 24, 24, 22), circle('washi', 24, 22, 21), circle('washi-core', 24, 22, 9), circle('washi-hole', 24, 22, 6));

// ---------- the pile of Polaroids ----------
// Loose, one on the other, the top one still blank.
const polaroid = (x, y, turn, cls) => svg('g', { transform: `rotate(${turn} ${x + 21} ${y + 25})` },
  rect('polaroid-line', x - 1.5, y - 1.5, 45, 54, 2), rect('polaroid', x, y, 42, 51, 1), rect(cls, x + 4, y + 4, 34, 33));
export const pileArt = () => art(64, 70,
  polaroid(14, 10, 11, 'polaroid-sky'), polaroid(7, 12, -9, 'polaroid-leaf'), polaroid(11, 11, 2, 'polaroid-blank'));

// ---------- the book's spiral ----------
// Coils along the top of the book, a tile repeated across it, through the holes in the stub.
export const spiralArt = () => svg('svg', { class: 'nb-bk__spiral', width: '100%', height: 30, 'aria-hidden': 'true', focusable: 'false' },
  svg('defs', null, svg('pattern', { id: 'nb-coil', width: 24, height: 30, patternUnits: 'userSpaceOnUse' },
    ellipse('coil-hole', 12, 22, 4, 3.5),
    line('coil-line', 'M12 22C12 8 8 3 4 3C0 3 1 10 3 12'),
    line('coil', 'M12 22C12 8 8 3 4 3C0 3 1 10 3 12'))),
  svg('rect', { width: '100%', height: 30, fill: 'url(#nb-coil)' }));

// ---------- the magnifying glass ----------
export const glassArt = () => art(64, 64,
  path('wood-dark', 'M38 44L45 37L61 53Q63 57 59.5 60Q56 63 52 60Z'),
  path('wood', 'M38 42L43 37L60 52Q61 55 58.5 57.5Q56 59 54 57Z'),
  circle('metal-dark', 26, 26, 24), circle('metal', 26, 24, 23), circle('glass', 26, 25, 17), path('glass-shine', 'M15 25A11 11 0 0 1 26 14V19A6 6 0 0 0 20 25Z'));

// ---------- the line under the contents' heading ----------
export const underlineArt = () => svg('svg', { class: 'nb-art nb-toc__rule', viewBox: '0 0 200 12', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
  line('rule', 'M3 7C30 3 52 9 84 6S140 3 165 7S190 8 197 5'));

// ---------- the tokens on the roll ----------
// Round pieces of the same wood as the stamps, the sign carved in.
const SIGNS = {
  undo: 'M31 30A10 10 0 0 0 22 16H13M19 10L13 16L19 22',
  redo: 'M13 30A10 10 0 0 1 22 16H31M25 10L31 16L25 22',
  pen: 'M12 32L14.5 24L27 11.5L32.5 17L20 29.5ZM24.5 14L30 19.5M14.5 24L20 29.5',
  finger: 'M20 33L13.5 25.5C12 23.5 14.5 21.5 16.5 23L19 25V12.5A2.2 2.2 0 0 1 23.4 12.5V20L29.5 21.5C31.5 22 32.5 23.5 32 25.5L30.5 33',
};
export const tokenArt = sign => art(44, 44,
  circle('wood-dark', 22, 23, 20.5), circle('wood', 22, 21, 20), ellipse('wood-light', 15, 11, 7, 3.6, -30),
  line('carve', SIGNS[sign]));

// ---------- the open book on the panel's bar ----------
export const openBookArt = () => art(28, 24, line('book', 'M14 6C11 4 6 3.5 2 4.5V20C6 19 11 19.5 14 21C17 19.5 22 19 26 20V4.5C22 3.5 17 4 14 6ZM14 6V21'));

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
