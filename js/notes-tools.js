// The settings the notebook's tools share, plain in and out (tests/notes-tools.test.mjs): each
// drawing tool's colour and thickness, the ink on the pad, the footprints, the tape, and the animal
// on the stamp. The roll, the tray and the panel's toolbar all read and write these, so they stay in step.
// Kept on the profile as notesTools (device-only: js/cloud/sync.js toRow never sends it).

export const PENCILS = ['graphite', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'white'];
export const HIGHLIGHTS = ['cyan', 'yellow', 'magenta'];
export const DRAWING = ['pencil', 'pen', 'highlighter'];
export const FEET = ['paw', 'hoof', 'bird', 'bear'];
export const INKED = ['text', 'stamp', 'roller'];
export const WASHI = ['yellow', 'green', 'blue', 'red'];
// The notches of the slider on the roll. Thin and thick are what the panel's button goes between.
export const SIZES = ['hair', 'thin', 'mid', 'thick', 'bold'];
const WIDTHS = {
  pencil: { hair: 3, thin: 5, mid: 8, thick: 12, bold: 18 },
  pen: { hair: 2.5, thin: 4, mid: 6, thick: 9, bold: 14 },
  highlighter: { hair: 16, thin: 24, mid: 32, thick: 40, bold: 54 },
};

export const paletteOf = tool => (tool === 'highlighter' ? HIGHLIGHTS : PENCILS);
export const widthOf = (tool, size) => WIDTHS[tool][size];
// The panel's button shows and sets only two: which side of the slider's middle a size is on.
export const isFine = size => SIZES.indexOf(size) < SIZES.indexOf('mid');

export const DEFAULTS = {
  pencil: { colour: 'graphite', size: 'thin' },
  pen: { colour: 'blue', size: 'thin' },
  highlighter: { colour: 'yellow', size: 'thick' },
  ink: 'graphite',
  foot: 'paw',
  washi: 'yellow',
  stampCard: null,
};

const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback);

// Whatever was stored, as settings that are safe to use.
export function cleanTools(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const tool = id => ({
    colour: oneOf(paletteOf(id), r[id]?.colour, DEFAULTS[id].colour),
    size: oneOf(SIZES, r[id]?.size, DEFAULTS[id].size),
  });
  return {
    pencil: tool('pencil'), pen: tool('pen'), highlighter: tool('highlighter'),
    ink: oneOf(PENCILS, r.ink, DEFAULTS.ink),
    foot: oneOf(FEET, r.foot, DEFAULTS.foot),
    washi: oneOf(WASHI, r.washi, DEFAULTS.washi),
    stampCard: typeof r.stampCard === 'string' && r.stampCard ? r.stampCard : null,
  };
}

// The tool whose settings a colour or thickness control changes while `tool` is in the hand.
// The ink for the stamps; the pencil for what has no colour of its own (the eraser).
const slot = tool => (DRAWING.includes(tool) ? tool : 'pencil');
export const colourOf = (set, tool) => (INKED.includes(tool) ? set.ink : set[slot(tool)].colour);
export const sizeOf = (set, tool) => set[slot(tool)].size;
export function withColour(set, tool, colour) {
  if (INKED.includes(tool)) return { ...set, ink: colour };
  const id = slot(tool);
  return { ...set, [id]: { ...set[id], colour } };
}
export function withSize(set, tool, size) {
  const id = slot(tool);
  return { ...set, [id]: { ...set[id], size } };
}

// The stamp's next animal: the one after `current`, round to the first.
export function nextAnimal(ids, current) {
  if (!ids.length) return null;
  return ids[(ids.indexOf(current) + 1) % ids.length];
}
