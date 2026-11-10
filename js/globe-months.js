// Temperature's twelve months, plain in and out (tests/globe-months.test.mjs). Months are stored as
// numbers, one to a channel, four to a texture (scripts/make-layers.mjs months). A position runs from
// 1 (January) to just under 13 (back round to January): 3.25 is a quarter of the way from March to
// April.

export const TEMP_BANDS = 10;   // Temperature's steps; 0 in the shader is smooth, and nothing offers it
export const MORPH_MS = 400;    // one month becoming another
export const PLAY_MS = 1000;    // a month while the year plays
export const MONTH_FILES = [0, 1, 2].map(i => `assets/layers/temp-months-${i + 1}.webp`);
export const MONTH_MIN = -50, MONTH_MAX = 50; // °C at byte 1 and byte 255

// Where a month is: its texture and channel.
export const slotOf = month => ({ tex: Math.floor((month - 1) / 4), ch: (month - 1) % 4 });

export const wrapPos = pos => ((((pos - 1) % 12) + 12) % 12) + 1;
export const nearestMonth = pos => { const m = Math.round(wrapPos(pos)); return m > 12 ? 1 : m; };
// Where a position goes on the year's slider (1 to 12): always with its label (nearestMonth). Past
// halfway from December the label says January, so the slider is already back at the start, in one
// jump: it never sits at the end under "January".
export const sliderPos = pos => { const p = wrapPos(pos); return p >= 12.5 ? 1 : p; };

// The two months either side of a position, and how far along.
export function blendAt(pos) {
  const p = wrapPos(pos), a = Math.floor(p);
  return { a, b: a === 12 ? 1 : a + 1, mix: p - a };
}

// What can be shown of a blend with only some textures here. has(month): is it on the GPU?
// last: the month last shown. Returns a blend, or null when there is nothing yet.
export function heldBlend({ a, b, mix }, has, last = null) {
  if (has(a) && has(b)) return { a, b, mix };
  if (has(a) && mix < 0.5) return { a, b: a, mix: 0 };
  if (has(b) && mix >= 0.5) return { a: b, b, mix: 0 };
  if (last && has(last)) return { a: last, b: last, mix: 0 };
  if (has(a)) return { a, b: a, mix: 0 };
  if (has(b)) return { a: b, b, mix: 0 };
  return null;
}

// The textures to fetch, the one with this month first.
export function fetchOrder(month) {
  const first = slotOf(month).tex;
  return [first, ...[0, 1, 2].filter(i => i !== first)];
}

// °C as a byte, and back.
export const toByte = c => 1 + Math.round(((Math.max(MONTH_MIN, Math.min(MONTH_MAX, c)) - MONTH_MIN) / (MONTH_MAX - MONTH_MIN)) * 254);
export const fromByte = b => MONTH_MIN + ((b - 1) / 254) * (MONTH_MAX - MONTH_MIN);

// A gentle start and stop.
export const ease = t => t * t * (3 - 2 * t);

// The scale as `bands` flat steps, for the key: [{ from, to, at }] with from and to 0 to 1, at the
// share of the scale that gives the band's colour.
export function bandSteps(bands) {
  return Array.from({ length: bands }, (_, i) => ({ from: i / bands, to: (i + 1) / bands, at: (i + 0.5) / bands }));
}
