// Drawing a Field Notes page onto a canvas: paper, the auto-stamped header, then every item
// in order. Used for the page on screen and for "export page as an image", so both match.
// Page units: PAGE_W × PAGE_H (notes-store.js); the canvas transform scales them.
//   stroke  { t:'s', c, w, p:[x,y,pressure, …] }      pencil line
//   text    { t:'x', c, s, x, y, v, r }                 typed text (x,y = top left)
//   stamp   { t:'m', c, card, x, y, s, r }               creature stamp (centre, height)
//   roller  { t:'f', c, k, p:[x,y, …] }                  footprint trail (k: paw, hoof, bird, bear)
//   photo   { t:'p', id, x, y, w, h, r }                 taped-in photo (centre, size)
import { PAGE_W, PAGE_H } from './notes-store.js';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const PENCILS = ['graphite', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown'];
export const pencilColour = id => css(`--pencil-${id}`) || '#444';
const GRID = 40;

// ---------- pencil grain ----------

let grain = null;
function grainPattern(ctx) {
  if (!grain) {
    grain = document.createElement('canvas');
    grain.width = grain.height = 96;
    const g = grain.getContext('2d');
    const img = g.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = Math.random() < 0.38 ? 40 + Math.random() * 150 : 0;
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(grain, 'repeat');
}

// ---------- pieces ----------

const width = (w, p) => w * (0.35 + 0.95 * p);

// A pressure-sensitive line from point index `from` (to draw only the new part while drawing).
export function drawStroke(ctx, item, from = 0) {
  const p = item.p;
  ctx.strokeStyle = item.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.length === 3) {
    ctx.fillStyle = item.c;
    ctx.beginPath(); ctx.arc(p[0], p[1], width(item.w, p[2]) / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  for (let i = Math.max(3, from); i < p.length; i += 3) {
    ctx.lineWidth = width(item.w, (p[i - 1] + p[i + 2]) / 2);
    ctx.beginPath();
    ctx.moveTo(p[i - 3], p[i - 2]);
    ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }
}

function footprint(ctx, kind, size) {
  ctx.beginPath();
  if (kind === 'paw' || kind === 'bear') {
    const toes = kind === 'bear' ? 5 : 4;
    ctx.ellipse(0, size * 0.18, size * (kind === 'bear' ? 0.36 : 0.28), size * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    const r = size * (kind === 'bear' ? 0.42 : 0.36), tr = size * (kind === 'bear' ? 0.1 : 0.11);
    for (let i = 0; i < toes; i++) {
      const a = Math.PI * (1.15 + (0.7 * i) / (toes - 1));
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, tr, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'hoof') {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * size * 0.14, 0, size * 0.12, size * 0.32, sx * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  } else { // bird: three toes forward, one back
    ctx.lineWidth = size * 0.09;
    ctx.lineCap = 'round';
    for (const a of [-0.45, 0, 0.45]) { ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * size * 0.5, -Math.cos(a) * size * 0.5); }
    ctx.moveTo(0, 0); ctx.lineTo(0, size * 0.28);
    ctx.stroke();
  }
}
const FOOT = { paw: { size: 46, step: 70 }, hoof: { size: 44, step: 76 }, bird: { size: 46, step: 58 }, bear: { size: 64, step: 104 } };

// Prints every `step` along the path, left and right, turned the way the trail goes.
function drawRoller(ctx, item) {
  const { size, step } = FOOT[item.k] ?? FOOT.paw;
  const p = item.p;
  ctx.fillStyle = ctx.strokeStyle = item.c;
  let carry = step / 2, n = 0;
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2], y0 = p[i - 1], dx = p[i] - x0, dy = p[i + 1] - y0;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const ang = Math.atan2(dy, dx);
    for (let d = carry; d <= len; d += step) {
      const side = n++ % 2 ? 1 : -1;
      const x = x0 + (dx * d) / len - Math.sin(ang) * side * size * 0.45;
      const y = y0 + (dy * d) / len + Math.cos(ang) * side * size * 0.45;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang + Math.PI / 2); footprint(ctx, item.k, size); ctx.restore();
      carry = d + step - len;
    }
    if (carry > len) carry -= len;
  }
}

function textLines(ctx, item) {
  ctx.font = `${item.s}px ${css('--font')}`;
  const lines = item.v.split('\n');
  const w = Math.max(...lines.map(l => ctx.measureText(l).width), item.s * 0.5);
  return { lines, w, h: lines.length * item.s * 1.25 };
}

function drawText(ctx, item) {
  const { lines } = textLines(ctx, item);
  ctx.fillStyle = item.c;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, item.x, item.y + i * item.s * 1.25));
}

// A stamp is the animal's silhouette in the pencil colour, or its group emoji.
function drawStamp(ctx, item, assets) {
  const a = assets.stamps.get(item.card);
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.r ?? 0);
  if (a?.img?.complete && a.img.naturalWidth) {
    const ratio = a.img.naturalWidth / a.img.naturalHeight;
    const h = item.s, w = h * ratio;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w)); off.height = Math.max(1, Math.round(h));
    const o = off.getContext('2d');
    o.drawImage(a.img, 0, 0, off.width, off.height);
    o.globalCompositeOperation = 'source-in';
    o.fillStyle = item.c;
    o.fillRect(0, 0, off.width, off.height);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(off, -w / 2, -h / 2, w, h);
  } else {
    ctx.font = `${item.s}px ${css('--font')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a?.emoji ?? '🐾', 0, 0);
  }
  ctx.restore();
}

// A photo with a white edge, a soft shadow and two strips of tape.
function drawPhoto(ctx, item, assets) {
  const bmp = assets.photos.get(item.id);
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(item.r ?? 0);
  const edge = Math.min(item.w, item.h) * 0.04;
  ctx.shadowColor = css('--nb-shadow');
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = css('--nb-photo-edge');
  ctx.fillRect(-item.w / 2 - edge, -item.h / 2 - edge, item.w + 2 * edge, item.h + 2 * edge);
  ctx.shadowColor = 'transparent';
  if (bmp) ctx.drawImage(bmp, -item.w / 2, -item.h / 2, item.w, item.h);
  ctx.fillStyle = css('--nb-tape');
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * item.w * 0.42, -item.h / 2 - edge);
    ctx.rotate(sx * -0.6);
    ctx.fillRect(-item.w * 0.11, -edge * 2.2, item.w * 0.22, edge * 4.4);
    ctx.restore();
  }
  ctx.restore();
}

function drawPaper(ctx, page) {
  ctx.fillStyle = css('--nb-paper');
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  if (page.paper === 'grid') {
    ctx.strokeStyle = css('--nb-grid');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = GRID; x < PAGE_W; x += GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); }
    for (let y = GRID; y < PAGE_H; y += GRID) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    ctx.stroke();
  } else {
    ctx.fillStyle = css('--nb-dot');
    for (let x = GRID; x < PAGE_W; x += GRID) for (let y = GRID; y < PAGE_H; y += GRID) ctx.fillRect(x - 2, y - 2, 4, 4);
  }
}

// Date, the animal's name (in the profile's language) and the red "Observed" stamp.
function drawHeader(ctx, page, text) {
  const font = css('--font');
  ctx.fillStyle = css('--nb-ink');
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `600 30px ${font}`;
  ctx.fillText(text.date, 60, 80);
  if (text.name) {
    ctx.font = `800 46px ${font}`;
    ctx.fillText(text.name, 60, 140, 640);
  }
  ctx.strokeStyle = css('--nb-ink');
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(60, 165); ctx.lineTo(PAGE_W - 60, 165); ctx.stroke();

  ctx.save();
  ctx.translate(PAGE_W - 170, 98);
  ctx.rotate(-0.12);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = ctx.fillStyle = css('--nb-stamp');
  ctx.lineWidth = 5;
  ctx.strokeRect(-120, -48, 240, 96);
  ctx.lineWidth = 2;
  ctx.strokeRect(-110, -38, 220, 76);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 30px ${font}`;
  ctx.fillText(text.stamp, 0, 2, 200);
  ctx.restore();
}

// ---------- the whole page ----------

// headerText: { date, name, stamp } already in the profile's language.
// skip: an item index not to draw (the one being moved, drawn on the live layer instead).
export function renderPage(ctx, page, { assets, headerText, skip = -1 }) {
  drawPaper(ctx, page);
  drawHeader(ctx, page, headerText);
  // Pencil work goes on its own layer so the grain only roughens pencil, not photos.
  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width; layer.height = ctx.canvas.height;
  const l = layer.getContext('2d');
  l.setTransform(ctx.getTransform());
  const flush = () => {
    l.save();
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'destination-out';
    l.fillStyle = grainPattern(l);
    l.fillRect(0, 0, layer.width, layer.height);
    l.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    l.save(); l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, layer.width, layer.height); l.restore();
  };
  let pending = false;
  page.items.forEach((item, i) => {
    if (i === skip) return;
    if (item.t === 's') { drawStroke(l, item); pending = true; return; }
    if (pending) { flush(); pending = false; }
    if (item.t === 'x') drawText(ctx, item);
    else if (item.t === 'm') drawStamp(ctx, item, assets);
    else if (item.t === 'f') drawRoller(ctx, item);
    else if (item.t === 'p') drawPhoto(ctx, item, assets);
  });
  if (pending) flush();
}

// Draw one item on its own (the live layer while moving it).
export function renderItem(ctx, item, assets) {
  if (item.t === 's') drawStroke(ctx, item);
  else if (item.t === 'x') drawText(ctx, item);
  else if (item.t === 'm') drawStamp(ctx, item, assets);
  else if (item.t === 'f') drawRoller(ctx, item);
  else if (item.t === 'p') drawPhoto(ctx, item, assets);
}

// ---------- hit testing (eraser, move tool) ----------

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The box an item fills: { cx, cy, w, h, r } in page units.
export function boundsOf(ctx, item) {
  if (item.t === 'p') return { cx: item.x, cy: item.y, w: item.w, h: item.h, r: item.r ?? 0 };
  if (item.t === 'm') return { cx: item.x, cy: item.y, w: item.s, h: item.s, r: item.r ?? 0 };
  if (item.t === 'x') { const { w, h } = textLines(ctx, item); return { cx: item.x + w / 2, cy: item.y + h / 2, w, h, r: 0 }; }
  const xs = [], ys = [];
  const step = item.t === 's' ? 3 : 2;
  for (let i = 0; i < item.p.length; i += step) { xs.push(item.p[i]); ys.push(item.p[i + 1]); }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, r: 0 };
}

function inBox(b, x, y, pad) {
  const c = Math.cos(-b.r), s = Math.sin(-b.r);
  const lx = (x - b.cx) * c - (y - b.cy) * s, ly = (x - b.cx) * s + (y - b.cy) * c;
  return Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad;
}

// The topmost item under (x, y), or -1. movable: only photos, stamps and text.
export function hitItem(ctx, page, x, y, r, { movable = false } = {}) {
  for (let i = page.items.length - 1; i >= 0; i--) {
    const it = page.items[i];
    if (movable && !['p', 'm', 'x'].includes(it.t)) continue;
    if (it.t === 's') {
      const p = it.p;
      if (p.length === 3 && Math.hypot(p[0] - x, p[1] - y) <= it.w + r) return i;
      for (let j = 3; j < p.length; j += 3) if (segDist(x, y, p[j - 3], p[j - 2], p[j], p[j + 1]) <= it.w / 2 + r) return i;
    } else if (it.t === 'f') {
      for (let j = 0; j < it.p.length; j += 2) if (Math.hypot(it.p[j] - x, it.p[j + 1] - y) <= 40 + r) return i;
    } else if (inBox(boundsOf(ctx, it), x, y, r)) return i;
  }
  return -1;
}
