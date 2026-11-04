// The country label (🇹🇼, shown as "TW" where there is no flag emoji, e.g. Windows) sits on the
// top-right corner of a binder tile's photo. The build samples that corner of the thumbnail and
// stores card.labelTone: "light" (light photo behind: near-black text) or "dark" (white text).
// The text always has an opposite-coloured halo too (css/app.css .tile__tw).

import sharp from 'sharp';

// Text colours, as in css/tokens.css (--c-label-on-light / --c-label-on-dark).
export const TEXT = { onLight: '#10171e', onDark: '#ffffff' };
export const AA = 4.5;    // WCAG contrast for this text size
export const BUSY = 0.25; // share of corner pixels below 3:1 with the text: the halo alone may not be enough

// Tile geometry (css/app.css .tile, .tile__tw): 3:4 tiles from about 120 px (two columns on a
// narrow phone; --tile-min is 150 px) up to about
// 240 px wide; the name under the photo takes about 52 px; the label is about 28 × 20 px, 4 px
// from the corner. The sampled box is the label plus a little padding, for both tile widths.
export const TILE = { widths: [120, 240], nameH: 52, inset: 4, label: { w: 28, h: 20 }, pad: 4 };

// sRGB → relative luminance (WCAG).
const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hexLum = hex => { const n = parseInt(hex.slice(1), 16); return luminance(n >> 16, (n >> 8) & 255, n & 255); };
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const L_ON_LIGHT = hexLum(TEXT.onLight), L_ON_DARK = hexLum(TEXT.onDark);

// The box under the label, in image pixels, for a tile of width w (object-fit: cover, centred).
export function cornerBox(iw, ih, w) {
  const W = w, H = (w * 4) / 3 - TILE.nameH;
  const s = Math.max(W / iw, H / ih);
  const ox = (iw * s - W) / 2, oy = (ih * s - H) / 2;
  const x0 = W - TILE.inset - TILE.label.w - TILE.pad, y0 = 0;
  const x1 = W, y1 = TILE.inset + TILE.label.h + TILE.pad;
  return { left: (x0 + ox) / s, top: (y0 + oy) / s, right: (x1 + ox) / s, bottom: (y1 + oy) / s };
}

// Every tile width's box together, clamped to the image.
export function sampleBox(iw, ih) {
  const boxes = TILE.widths.map(w => cornerBox(iw, ih, w));
  const left = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.left))));
  const top = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.top))));
  const right = Math.min(iw, Math.ceil(Math.max(...boxes.map(b => b.right))));
  const bottom = Math.min(ih, Math.ceil(Math.max(...boxes.map(b => b.bottom))));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

// Luminance of each pixel in the corner box of an image (file path or buffer).
export async function cornerLuminances(input) {
  const img = sharp(input).removeAlpha();
  const { width, height } = await img.metadata();
  const box = sampleBox(width, height);
  const { data, info } = await img.extract(box).raw().toBuffer({ resolveWithObject: true });
  const out = new Float64Array(info.width * info.height);
  for (let i = 0, p = 0; p < out.length; p++, i += info.channels) out[p] = luminance(data[i], data[i + 1], data[i + 2]);
  return out;
}

// Which text colour, from the corner's pixel luminances.
export function decideTone(lums) {
  const n = lums.length || 1;
  let sum = 0;
  for (const l of lums) sum += l;
  const mean = sum / n;
  const vsDark = contrast(mean, L_ON_LIGHT);  // near-black text on this background
  const vsLight = contrast(mean, L_ON_DARK);  // white text on this background
  const tone = vsDark >= vsLight ? 'light' : 'dark';
  const text = tone === 'light' ? L_ON_LIGHT : L_ON_DARK;
  let poor = 0;
  for (const l of lums) if (contrast(l, text) < 3) poor++;
  const ratio = Math.max(vsDark, vsLight);
  const poorShare = poor / n;
  return { tone, mean, contrast: ratio, passes: ratio >= AA, poorShare, busy: poorShare > BUSY || ratio < AA };
}

export const labelToneOf = async input => decideTone(await cornerLuminances(input));
