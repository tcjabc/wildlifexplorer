#!/usr/bin/env node
// Makes a silhouette from a photo, for animals PhyloPic has none of: the animal is cut out
// with the U²-Net salient-object model, cleaned up (largest shape only, holes filled,
// smooth edge) and saved as a solid black PNG with a transparent background.
//
//   node scripts/make-silhouette.mjs <photo file> <out.png> [--threshold 0.5] [--crop x,y,w,h] [--preview <file>]
//
// --crop: fractions of the photo (0…1) to look in, when something else in the picture
// stands out more than the animal (e.g. a bright leaf next to a camouflaged snake).
//
// The model (U²-Net, Apache-2.0, https://github.com/xuebinqin/U-2-Net; ONNX export from
// rembg) is downloaded once into data-raw/models/, which is not committed.
// A silhouette made from a photo is a derivative of it: credit the photo's author and keep
// its licence (see "derivedFrom" in README).
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import ort from 'onnxruntime-node';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(ROOT, 'data-raw/models/u2net.onnx');
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx';
const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

async function ensureModel() {
  if (existsSync(MODEL)) return;
  console.log(`Downloading the U²-Net model (about 170 MB) to ${path.relative(ROOT, MODEL)} …`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  await mkdir(path.dirname(MODEL), { recursive: true });
  await writeFile(MODEL, Buffer.from(await res.arrayBuffer()));
}

// 0…1 saliency map at SIZE × SIZE.
async function saliency(session, file) {
  const { data } = await sharp(file).rotate().removeAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const input = new Float32Array(3 * SIZE * SIZE);
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, data[i]);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (data[i * 3 + c] / max - MEAN[c]) / STD[c];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const map = out[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (const v of map) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return Uint8Array.from(map, v => Math.round(((v - lo) / (hi - lo || 1)) * 255));
}

// Keep the largest connected shape and fill its holes (both 4-connected flood fills).
function clean(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    let size = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 && p - 1, x < w - 1 && p + 1, y > 0 && p - w, y < h - 1 && p + w]) {
        if (q !== false && mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  const keep = Uint8Array.from(label, l => (l === best ? 1 : 0));
  // Background reachable from the border stays background; anything else is a hole.
  const outside = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!keep[y * w + x]) { outside[y * w + x] = 1; stack.push(y * w + x); }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!keep[y * w + x] && !outside[y * w + x]) { outside[y * w + x] = 1; stack.push(y * w + x); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    for (const q of [x > 0 && p - 1, x < w - 1 && p + 1, y > 0 && p - w, y < h - 1 && p + w]) {
      if (q !== false && !keep[q] && !outside[q]) { outside[q] = 1; stack.push(q); }
    }
  }
  return Uint8Array.from(outside, (o, i) => (o ? 0 : 255));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const threshold = Number(opt('--threshold') ?? 0.5);
  const preview = opt('--preview');
  const mapOut = opt('--map'); // the raw saliency map, for checking
  const crop = opt('--crop')?.split(',').map(Number);
  const [file, out] = args;
  if (!file || !out) throw new Error('Usage: node scripts/make-silhouette.mjs <photo file> <out.png> [--threshold 0.5] [--crop x,y,w,h] [--preview <file>]');
  let src = await sharp(file).rotate().toBuffer();
  if (crop) {
    const m = await sharp(src).metadata();
    const [cx, cy, cw, ch] = crop;
    src = await sharp(src).extract({ left: Math.round(cx * m.width), top: Math.round(cy * m.height), width: Math.round(cw * m.width), height: Math.round(ch * m.height) }).toBuffer();
  }

  await ensureModel();
  const session = await ort.InferenceSession.create(MODEL);
  const map = await saliency(session, src);
  if (mapOut) await sharp(Buffer.from(map), { raw: { width: SIZE, height: SIZE, channels: 1 } }).png().toFile(mapOut);
  const { width: w, height: h } = await sharp(src).rotate().metadata();

  // Back to the photo's size, smoothed, then cut at the threshold.
  const big = await sharp(Buffer.from(map), { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .resize(w, h, { kernel: 'cubic', fit: 'fill' }).blur(1.2).extractChannel(0).raw().toBuffer();
  const mask = clean(Uint8Array.from(big, v => (v >= threshold * 255 ? 1 : 0)), w, h);

  // Crop to the shape, soften the edge a little, fill solid black.
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 <= x0 || y1 <= y0) throw new Error('No animal found in the photo.');
  const alpha = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).blur(0.6).extractChannel(0).raw().toBuffer();
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const rgba = Buffer.alloc(cw * ch * 4);
  for (let i = 0; i < cw * ch; i++) rgba[i * 4 + 3] = alpha[i];
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out);
  console.log(`Wrote ${out} (${cw}×${ch})`);

  // For checking: the shape over the photo, side by side with the result on white.
  if (preview) {
    const tint = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) if (mask[i]) { tint[i * 4] = 255; tint[i * 4 + 2] = 128; tint[i * 4 + 3] = 115; }
    const overlay = await sharp(tint, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const fit = img => img.resize(480, 480, { fit: 'inside' }).png().toBuffer();
    const left = await fit(sharp(await sharp(src).rotate().composite([{ input: overlay }]).png().toBuffer()));
    const right = await fit(sharp(out).flatten({ background: '#ffffff' }));
    const lm = await sharp(left).metadata(), rm = await sharp(right).metadata();
    await sharp({ create: { width: 980, height: Math.max(lm.height, rm.height), channels: 3, background: '#ffffff' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 500, top: 0 }]).png().toFile(preview);
    console.log(`Preview ${preview}`);
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1); });
