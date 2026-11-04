#!/usr/bin/env node
// Builds dist/, what wildfile.app serves (Cloudflare Workers static assets, wrangler.jsonc):
// npm run site. Only the files on the allow-list below are copied, so nothing else in the
// repo (.env, node_modules, scripts, build notes, the card list) can ever be published.
// Also writes dist/_headers (HTTP headers, with the CSP taken from index.html) and checks
// the service worker's SHELL list against what's there. No dependencies, so the Workers
// build can skip installing them.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything the app loads. A new top-level file or folder the app needs goes here.
export const ALLOW = {
  files: ['index.html', 'manifest.webmanifest', 'sw.js',
    'data/animals.json', 'data/groups.json', 'data/drops.json', 'data/regions.json',
    'data/badges.json', 'data/secret-badges.json', 'data/lookalikes.json', 'data/glossary.json'],
  dirs: ['css', 'js', 'lang', 'icons', 'img', 'assets', 'data/ranges'],
};

// Headers for every response; the CSP is index.html's, plus what only a header can say.
function headersFile(csp) {
  return `# Built by scripts/build-site.mjs; edit the script (or index.html's CSP), not this file.
/*
  Content-Security-Policy: ${csp}; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()

/sw.js
  Cache-Control: no-cache

# The page only: no-transform stops Cloudflare injecting anything into it (on the Free plan
# its RUM / Web Analytics beacon is on by default). It also skips compression, which the
# small page doesn't need; everything else stays compressed.
/
  Cache-Control: public, max-age=0, must-revalidate, no-transform
`;
}

async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export const cspOf = html => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
export const shellOf = sw => [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

// Returns the published paths (relative, with /), sorted.
export async function buildSite({ root = ROOT, out = path.join(ROOT, 'dist') } = {}) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const copied = [];
  const copy = async rel => {
    await mkdir(path.dirname(path.join(out, rel)), { recursive: true });
    await cp(path.join(root, rel), path.join(out, rel));
    copied.push(rel.split(path.sep).join('/'));
  };
  for (const rel of ALLOW.files) await copy(rel);
  for (const dir of ALLOW.dirs) {
    for (const file of await files(path.join(root, dir))) await copy(path.relative(root, file));
  }

  const csp = cspOf(await readFile(path.join(root, 'index.html'), 'utf8'));
  if (!csp) throw new Error('index.html has no Content-Security-Policy meta tag');
  await writeFile(path.join(out, '_headers'), headersFile(csp));

  // Every SHELL entry must be published, and every script must be in SHELL (or it won't
  // work offline).
  const shell = shellOf(await readFile(path.join(root, 'sw.js'), 'utf8'));
  const have = new Set(copied);
  const missing = shell.filter(u => u !== './' && !have.has(u));
  if (missing.length) throw new Error(`sw.js SHELL lists files that aren't published: ${missing.join(', ')}`);
  const unlisted = copied.filter(f => f.startsWith('js/') && f.endsWith('.js') && !shell.includes(f));
  if (unlisted.length) throw new Error(`Add these to SHELL in sw.js: ${unlisted.join(', ')}`);

  return copied.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = await buildSite();
  let bytes = 0;
  for (const f of list) bytes += (await stat(path.join(ROOT, 'dist', f))).size;
  console.log(`dist/: ${list.length} files, ${(bytes / 1e6).toFixed(1)} MB, plus _headers`);
}
