// The settings the notebook's tools share, plain in and out (tests/notes-tools.test.mjs): each
// drawing tool's colour and thickness, the ink on the pad, the footprints, and the animal on the
// stamp. The rails and the panel's toolbar both read and write these, so they stay in step.
// Kept on the profile as notesTools (device-only: js/cloud/sync.js toRow never sends it).

export const PENCILS = ['graphite', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'white'];
export const HIGHLIGHTS = ['cyan', 'yellow', 'magenta'];
export const DRAWING = ['pencil', 'pen', 'highlighter'];
export const FEET = ['paw', 'hoof', 'bird', 'bear'];
const INKED = ['text', 'stamp', 'roller'];
const SIZES = ['thin', 'thick'];
const WIDTHS = {
  pencil: { thin: 5, thick: 12 },
  pen: { thin: 4, thick: 9 },
  highlighter: { thin: 24, thick: 40 },
};

export const paletteOf = tool => (tool === 'highlighter' ? HIGHLIGHTS : PENCILS);
export const widthOf = (tool, size) => WIDTHS[tool][size];

export const DEFAULTS = {
  pencil: { colour: 'graphite', size: 'thin' },
  pen: { colour: 'blue', size: 'thin' },
  highlighter: { colour: 'yellow', size: 'thick' },
  ink: 'graphite',
  foot: 'paw',
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
