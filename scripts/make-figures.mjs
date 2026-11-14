#!/usr/bin/env node
// Traces the comparison's everyday figures (car, cat, cherry tree, sand, salt, hair) from photos:
// cut out, solid black, edge cleaned, traced to one smoothed path in a tight viewBox, refined with
// simple shapes where the photo falls short (scripts/figures.config.mjs). Build time only: the app
// loads the finished SVGs and nothing else.
//
//   node scripts/make-figures.mjs [name …] [--check <dir>]
//
// Photos are downloaded once into data-raw/figures/ (not committed). --check writes, per figure,
// the photo with the cut-out tinted beside the result. At the end it prints each figure's box and
// its size in cm: js/compare-data.js PARTNERS (cm, ratio) must match (tests/figures.test.mjs).
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FIGURES, WORK } from './figures.config.mjs';
import { SIZE, blurCut, clean, saliency, session as modelSession } from './lib/cutout.mjs';
import { bend, bezier, bounds, resample, simplify, smoothPath, taper, trace } from './lib/trace.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data-raw/figures');
const UA = { 'User-Agent': 'WildFile-build/1.0 (figures from Wikimedia Commons)' };
const UNITS = 1000; // the long side of every figure, in SVG units

async function photo(name, fig) {
  const file = path.join(RAW, `${name}${path.extname(fig.title).toLowerCase() === '.png' ? '.png' : '.jpg'}`);
  if (existsSync(file)) return file;
  const q = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', titles: fig.title, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '2400', format: 'json' })}`;
  const info = Object.values((await (await fetch(q, { headers: UA })).json()).query.pages)[0].imageinfo?.[0];
  if (!info) throw new Error(`${name}: ${fig.title} not found on Commons`);
  const url = info.width <= 2400 ? info.url : info.thumburl;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${name}: download failed (${res.status})`);
  await mkdir(RAW, { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// The photo as worked on: turned, cropped, mirrored, WORK px on its long side.
async function working(file, fig) {
  let buf = await sharp(file).rotate().flatten({ background: '#000' }).jpeg({ quality: 95 }).toBuffer();
  if (fig.rotate) buf = await sharp(buf).rotate(fig.rotate, { background: '#000' }).jpeg({ quality: 95 }).toBuffer();
  if (fig.crop) {
    const m = await sharp(buf).metadata(), [cx, cy, cw, ch] = fig.crop;
    buf = await sharp(buf).extract({ left: Math.round(cx * m.width), top: Math.round(cy * m.height), width: Math.round(cw * m.width), height: Math.round(ch * m.height) }).toBuffer();
  }
  if (fig.flip) buf = await sharp(buf).flop().toBuffer();
  buf = await sharp(buf).resize(WORK, WORK, { fit: 'inside' }).jpeg({ quality: 95 }).toBuffer();
  const { width: w, height: h } = await sharp(buf).metadata();
  return { buf, w, h };
}

// How much each pixel looks like the subject, 0…255.
async function likeness(model, { buf, w, h }, fig) {
  const sal = async () => sharp(Buffer.from(await saliency(model, buf)), { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .resize(w, h, { kernel: 'cubic', fit: 'fill' }).blur(1.5).extractChannel(0).raw().toBuffer();
  if ((fig.mode ?? 'salient') === 'salient') return sal();
  const { data } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (fig.mode === 'bright') return sharp(buf).greyscale().blur(1.5).extractChannel(0).raw().toBuffer();
  if (fig.mode !== 'pink') throw new Error(`unknown mode ${fig.mode}`);
  // Blossom: pink pixels, blurred into one cloud. Trunk: dark pixels inside its band.
  const pink = new Uint8Array(w * h), dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; if (r - g > 45 && b - g > -10) pink[i] = 255; }
  const [tx0, tx1, ty0, ty1, lum] = fig.trunk;
  for (let y = Math.round(ty0 * h); y < Math.round(ty1 * h); y++) {
    for (let x = Math.round(tx0 * w); x < Math.round(tx1 * w); x++) {
      const i = y * w + x;
      if (0.3 * data[i * 3] + 0.59 * data[i * 3 + 1] + 0.11 * data[i * 3 + 2] < lum) dark[i] = 255;
    }
  }
  const crown = await sharp(Buffer.from(pink), { raw: { width: w, height: h, channels: 1 } }).blur(fig.spread).extractChannel(0).raw().toBuffer();
  return Uint8Array.from(crown, (v, i) => Math.max(Math.min(255, v * 3), dark[i]));
}

// The refining shapes, in working pixels: outlines (tails, branches) and circles (wheels).
function shapes(fig, { w, h }, mask) {
  const r = fig.refine ?? {}, outlines = [], circles = [];
  const px = ([x, y]) => [x * w, y * h];
  for (const s of [...(r.tails ?? []), ...(r.branches ?? [])]) {
    const line = s.line.map(px);
    outlines.push(taper(bezier(line, 48), s.w0 * w, s.w1 * w));
  }
  if (r.wheels) {
    // Sized from the car's own length in the photo; standing on the bottom of the cut-out.
    const box = bounds([trace(mask, w, h)]);
    const rad = (r.wheels.radiusCm / fig.measure.cm) * box.w;
    for (const x of r.wheels.xs) circles.push([x * w, box.y1 - rad, rad]);
  }
  return { outlines, circles };
}

// Shapes painted into (or out of) the mask, so the traced outline joins them without seams.
async function paint(mask, w, h, svgBody, value) {
  const img = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g fill="#fff">${svgBody}</g></svg>`))
    .greyscale().extractChannel(0).raw().toBuffer();
  return Uint8Array.from(mask, (v, i) => (img[i] > 127 ? value : v));
}
const polySvg = o => `<polygon points="${o.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>`;

async function figure(model, name, fig, checkDir) {
  const work = await working(await photo(name, fig), fig);
  const { w, h } = work;
  let mask = clean(Uint8Array.from(await likeness(model, work, fig), v => (v >= (fig.thr ?? 0.5) * 255 ? 1 : 0)), w, h);
  if (fig.open) mask = await blurCut(clean(await blurCut(mask, w, h, fig.open, 235), w, h), w, h, fig.open, 20);
  if (fig.close) mask = clean(await blurCut(await blurCut(mask, w, h, fig.close, 20), w, h, fig.close, 235), w, h);
  mask = clean(await blurCut(mask, w, h, fig.smooth ?? 2, 128), w, h);

  // Refining: cut away what is replaced, then add the shapes (wheels: the lower half of each wheel
  // is exactly round).
  const r = fig.refine ?? {};
  for (const [x0, y0, x1, y1] of r.erase ?? []) {
    for (let y = Math.round(y0 * h); y < Math.round(y1 * h); y++) for (let x = Math.round(x0 * w); x < Math.round(x1 * w); x++) mask[y * w + x] = 0;
  }
  const { outlines, circles } = shapes(fig, work, mask);
  if (circles.length) {
    // The photo's wheel goes (its shadow, the squashed tyre), with a thin gap around it like a wheel
    // arch's, so the round wheel drawn in its place stands out from the body.
    mask = await paint(mask, w, h, circles.map(([cx, cy, rad]) => `<circle cx="${cx}" cy="${cy}" r="${rad * (r.wheels.gap ?? 1)}"/><rect x="${cx - rad * 1.2}" y="${cy + rad * 0.55}" width="${rad * 2.4}" height="${rad}"/>`).join(''), 0);
  }
  mask = clean(await paint(mask, w, h, outlines.map(polySvg).join('') + (r.wheels?.gap ? '' : circles.map(([cx, cy, rad]) => `<circle cx="${cx}" cy="${cy}" r="${rad}"/>`).join('')), 1), w, h);

  let outline = simplify(trace(mask, w, h), fig.eps ?? 0.9);
  let thickness = null;
  if (r.bend) {
    // A straight strip: bent along a gentle S, tapered from taperFrom to a tip.
    const box = bounds([outline]);
    thickness = box.h;
    const { wave, taperFrom, tip } = r.bend;
    outline = simplify(bend(resample(outline, 2), { x0: box.x0, x1: box.x1, yc: (box.y0 + box.y1) / 2 },
      t => wave * Math.sin(2 * Math.PI * t),
      t => (t <= taperFrom ? 1 : 1 - (1 - tip) * ((t - taperFrom) / (1 - taperFrom)) ** 1.2)), fig.eps ?? 0.9);
  }

  // Into figure units: the box's long side is UNITS.
  const box = bounds([outline, ...outlines], circles);
  const k = UNITS / Math.max(box.w, box.h);
  const to = ([x, y]) => [(x - box.x0) * k, (y - box.y0) * k];
  const vw = Math.round(box.w * k), vh = Math.round(box.h * k);
  const parts = [`<path d="${smoothPath(outline.map(to))}"/>`,
    ...outlines.map(o => `<path d="${smoothPath(simplify(o, 0.5).map(to))}"/>`),
    ...circles.map(([cx, cy, rad]) => { const [x, y] = to([cx, cy]); return `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${Math.round(rad * k)}"/>`; })];

  // Its size in cm: what the measured span stands for, scaled to the whole box.
  const m = fig.measure;
  const spanPx = m.span === 'box' ? (m.across ? box.w : box.h) : m.span === 'thickness' ? thickness : (m.span[1] - m.span[0]) * w;
  const cm = m.cm * ((m.across ? box.w : box.h) / spanPx);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}">
<!-- ${`${fig.what}, ${round(cm)} cm ${m.across ? 'across' : 'tall'}. Traced by scripts/make-figures.mjs from the photo by ${fig.author}, ${fig.license}: ${fig.sourceUrl}`.replace(/-{2,}/g, '-')} -->
<g fill="#000">${parts.join('')}</g>
</svg>
`;
  await writeFile(path.join(ROOT, fig.file), svg);

  if (checkDir) {
    const tint = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) if (mask[i]) { tint[i * 4] = 255; tint[i * 4 + 2] = 128; tint[i * 4 + 3] = 120; }
    const over = await sharp(work.buf).composite([{ input: await sharp(tint, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer() }]).png().toBuffer();
    const left = await sharp(over).resize(440, 440, { fit: 'contain', background: '#fff' }).png().toBuffer();
    const right = await sharp(Buffer.from(svg)).resize(440, 440, { fit: 'contain', background: '#fff' }).flatten({ background: '#fff' }).png().toBuffer();
    await mkdir(checkDir, { recursive: true });
    await writeFile(path.join(checkDir, `${name}-photo.jpg`), await sharp(work.buf).resize(600, 600, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer());
    await sharp({ create: { width: 900, height: 440, channels: 3, background: '#fff' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 460, top: 0 }]).jpeg({ quality: 80 }).toFile(path.join(checkDir, `${name}-check.jpg`));
  }
  return { name, file: fig.file, viewBox: `${vw}×${vh}`, ratio: round(vh / vw, 4), cm: round(cm), across: m.across, bytes: Buffer.byteLength(svg) };
}

const round = (n, d = 3) => Number(n.toPrecision(d + 1));

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--check');
  const checkDir = ci >= 0 ? path.resolve(args.splice(ci, 2)[1]) : null;
  const names = args.length ? args : Object.keys(FIGURES);
  for (const n of names) if (!FIGURES[n]) throw new Error(`No figure "${n}" (have: ${Object.keys(FIGURES).join(', ')})`);
  const model = await modelSession();
  const out = [];
  for (const n of names) out.push(await figure(model, n, FIGURES[n], checkDir));
  console.table(out);
  console.log(`Total ${(out.reduce((s, o) => s + o.bytes, 0) / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message ?? err); process.exit(1); });
}
