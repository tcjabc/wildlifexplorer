// Cutting a subject out of a photo, for silhouettes (scripts/make-silhouette.mjs,
// scripts/make-figures.mjs): the U²-Net salient-object model and mask clean-up. Build time only.
//
// The model (U²-Net, Apache-2.0, https://github.com/xuebinqin/U-2-Net; ONNX export from rembg) is
// downloaded once into data-raw/models/, which is not committed.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MODEL = path.join(ROOT, 'data-raw/models/u2net.onnx');
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx';
export const SIZE = 320;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

export async function ensureModel() {
  if (existsSync(MODEL)) return;
  console.log(`Downloading the U²-Net model (about 170 MB) to ${path.relative(ROOT, MODEL)} …`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  await mkdir(path.dirname(MODEL), { recursive: true });
  await writeFile(MODEL, Buffer.from(await res.arrayBuffer()));
}

export async function session() {
  await ensureModel();
  const ort = (await import('onnxruntime-node')).default;
  const s = await ort.InferenceSession.create(MODEL);
  return { s, ort };
}

// 0…255 saliency map, SIZE × SIZE, of an image buffer.
export async function saliency({ s, ort }, buf) {
  const { data } = await sharp(buf).rotate().removeAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const input = new Float32Array(3 * SIZE * SIZE);
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, data[i]);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (data[i * 3 + c] / max - MEAN[c]) / STD[c];
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const map = out[s.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (const v of map) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return Uint8Array.from(map, v => Math.round(((v - lo) / (hi - lo || 1)) * 255));
}

// The largest 4-connected shape of a 0/1 mask, its holes filled. Returns a 0/1 mask.
export function clean(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack = [];
  const near = (p, x, y) => [x > 0 && p - 1, x < w - 1 && p + 1, y > 0 && p - w, y < h - 1 && p + w];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    let size = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop(); size++;
      const x = p % w, y = (p - x) / w;
      for (const q of near(p, x, y)) if (q !== false && mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  const keep = Uint8Array.from(label, l => (l === best ? 1 : 0));
  // Background reachable from the border stays background; anything else is a hole.
  const outside = new Uint8Array(w * h);
  const seed = p => { if (!keep[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    for (const q of near(p, x, y)) if (q !== false) seed(q);
  }
  return Uint8Array.from(outside, o => (o ? 0 : 1));
}

// A 0/1 mask blurred (radius r) and cut again at `cut` (0…255): grows (low cut) or shrinks (high cut).
export async function blurCut(mask, w, h, r, cut) {
  const b = await sharp(Buffer.from(Uint8Array.from(mask, v => v * 255)), { raw: { width: w, height: h, channels: 1 } })
    .blur(r).extractChannel(0).raw().toBuffer();
  return Uint8Array.from(b, v => (v >= cut ? 1 : 0));
}
