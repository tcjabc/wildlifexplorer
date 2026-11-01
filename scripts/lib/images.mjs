import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getBuffer } from './http.mjs';

export const shortHash = s => createHash('sha1').update(s).digest('hex').slice(0, 6);

// Thumbnails live in img/thumbs/ with the same base name as the full image, always .webp.
export const thumbPath = file => path.posix.join('img/thumbs', path.posix.basename(file).replace(/\.[^.]+$/, '') + '.webp');

export async function downloadImage(url, root, file, { maxSize, quality }) {
  const input = await getBuffer(url);
  const out = path.join(root, file);
  await mkdir(path.dirname(out), { recursive: true });
  const webp = await sharp(input, { limitInputPixels: false })
    .rotate()
    .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
  await writeFile(out, webp);
}

export async function ensureThumb(root, file, { thumbSize, thumbQuality }, force = false) {
  const src = path.join(root, file);
  const dest = path.join(root, thumbPath(file));
  if (!existsSync(src)) return 'missing-source';
  if (existsSync(dest) && !force) return 'exists';
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(src)
    .resize({ width: thumbSize, height: thumbSize, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: thumbQuality })
    .toFile(dest);
  return 'created';
}
