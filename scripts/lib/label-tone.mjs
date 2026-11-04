// The country label (🇹🇼, shown as "TW" where there is no flag emoji, e.g. Windows) sits on the
// top-right corner of a binder tile's photo, on a small translucent pill. The build samples
// that corner of the thumbnail and stores card.labelTone:
//   "light" – a light corner: a white pill with near-black text
//   "dark"  – a dark corner: a dark pill with white text
// The text is measured against the pill as it looks over each pixel of the photo (the pill is
// partly see-through), so the busy-corner check in the build report is against the pill too.

import sharp from 'sharp';

// As in css/tokens.css (--c-label-on-light / --c-label-on-dark, --c-label-pill-light /
// --c-label-pill-dark): text colours, and the pills' colours and opacity.
export const TEXT = { onLight: '#10171e', onDark: '#ffffff' };
export const PILL = { light: '#ffffff', dark: '#10171e', alpha: 0.78 };
export const AA = 4.5;    // WCAG contrast for this text size
export const BUSY = 0.05; // share of corner pixels where the text on the pill is under 4.5:1

// Tile geometry (css/app.css .tile, .tile__tw): 3:4 tiles from about 120 px (two columns on a
// narrow phone; --tile-min is 150 px) up to about 240 px wide; the name under the photo takes
// about 52 px. The pill is about 40 × 22 px, 4 px from the corner. The sampled box is the pill
// plus a little padding, for both tile widths.
export const TILE = { widths: [120, 240], nameH: 52, inset: 4, label: { w: 40, h: 22 }, pad: 4 };

// sRGB → relative luminance (WCAG).
const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexLum = hex => luminance(...rgb(hex));
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

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

// The corner's pixels as [r, g, b] triples (image file path or buffer).
export async function cornerPixels(input) {
  const img = sharp(input).removeAlpha();
  const { width, height } = await img.metadata();
  const { data, info } = await img.extract(sampleBox(width, height)).raw().toBuffer({ resolveWithObject: true });
  const out = [];
  for (let i = 0; i < data.length; i += info.channels) out.push([data[i], data[i + 1], data[i + 2]]);
  return out;
}

// The pill over one photo pixel, as the browser paints it (sRGB blend).
export const throughPill = (px, tone) => {
  const c = rgb(PILL[tone]);
  return px.map((v, i) => PILL.alpha * c[i] + (1 - PILL.alpha) * v);
};

// Which pill, from the corner's pixels: the one closer to the photo (a light corner → white),
// so the pill sits quietly on it. Then the text's contrast against that pill over every pixel.
export function decideTone(pixels) {
  const n = pixels.length || 1;
  let sum = 0;
  for (const p of pixels) sum += luminance(...p);
  const mean = sum / n;
  const tone = contrast(mean, hexLum(TEXT.onLight)) >= contrast(mean, hexLum(TEXT.onDark)) ? 'light' : 'dark';
  const text = hexLum(tone === 'light' ? TEXT.onLight : TEXT.onDark);
  let poor = 0, min = Infinity;
  for (const p of pixels) {
    const c = contrast(luminance(...throughPill(p, tone)), text);
    if (c < AA) poor++;
    if (c < min) min = c;
  }
  if (!pixels.length) min = contrast(luminance(...throughPill([128, 128, 128], tone)), text);
  const poorShare = poor / n;
  return { tone, mean, minContrast: min, poorShare, busy: poorShare > BUSY };
}

export const labelToneOf = async input => decideTone(await cornerPixels(input));
