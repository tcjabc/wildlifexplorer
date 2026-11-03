// What wildfile.app publishes (scripts/build-site.mjs, wrangler.jsonc): only the app's own
// files, the right headers, and a service worker that works offline on Cloudflare.
// Run: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSite, ALLOW, cspOf, shellOf } from '../scripts/build-site.mjs';

const root = new URL('..', import.meta.url);
const read = rel => readFile(new URL(rel, root), 'utf8');
const out = await mkdtemp(path.join(tmpdir(), 'wildfile-site-'));
after(() => rm(out, { recursive: true, force: true }));
const published = await buildSite({ out });

test('only allow-listed files are published', () => {
  const allowed = f => ALLOW.files.includes(f) || ALLOW.dirs.some(d => f.startsWith(`${d}/`));
  assert.deepEqual(published.filter(f => !allowed(f)), []);
  for (const f of published) {
    assert.doesNotMatch(f, /(^|\/)\.|node_modules|^(scripts|tests|supabase|data-raw)\/|\.md$|\.csv$|^package|^wrangler|build-state|drops\.lock/, f);
  }
  assert.ok(published.includes('index.html'));
  assert.ok(published.includes('data/animals.json'));
  assert.ok(published.some(f => f.startsWith('data/ranges/')));
});

test('every file the service worker caches is published, and the page is cached as ./', async () => {
  const shell = shellOf(await read('sw.js'));
  assert.deepEqual(shell.filter(u => u !== './' && !published.includes(u)), []);
  assert.ok(shell.includes('./'));
  assert.equal(shell.includes('index.html'), false); // Cloudflare redirects it to ./
});

test('headers: the page\'s CSP plus frame-ancestors, sw.js always revalidated, nothing injected into the page', async () => {
  const headers = await readFile(path.join(out, '_headers'), 'utf8');
  const csp = cspOf(await read('index.html'));
  assert.ok(headers.includes(`Content-Security-Policy: ${csp}; frame-ancestors 'none'\n`));
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
  assert.match(headers, /\/sw\.js\n {2}Cache-Control: no-cache/);
  // Cloudflare injects nothing (its analytics beacon) into a no-transform page.
  assert.match(headers, /\n\/\n {2}Cache-Control: public, max-age=0, must-revalidate, no-transform\n/);
  assert.ok(headers.split('\n').every(line => line.length <= 2000)); // Cloudflare's limit
});

test('wrangler.jsonc: dist/ on wildfile.app only, no workers.dev or preview URLs', async () => {
  const config = JSON.parse((await read('wrangler.jsonc')).replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.assets.directory, './dist');
  assert.deepEqual(config.routes, [{ pattern: 'wildfile.app', custom_domain: true }]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal('main' in config, false); // static assets only
});
