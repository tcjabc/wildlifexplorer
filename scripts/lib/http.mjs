// Polite HTTP: a User-Agent on every request, a minimum gap between requests
// to the same host, and retries with back-off on rate limits and server errors.

const MIN_GAP_MS = {
  'commons.wikimedia.org': 1000,
  'www.wikidata.org': 400,
  'query.wikidata.org': 1000,
  'api.inaturalist.org': 1100,
  'upload.wikimedia.org': 400,
  'api.phylopic.org': 500,
  'images.phylopic.org': 300,
};
const lastHit = new Map();
let userAgent = 'WildlifeExplorer-build/0.1';

export function setUserAgent(ua) { userAgent = ua; }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function throttle(host) {
  const gap = MIN_GAP_MS[host] ?? 300;
  const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export async function request(url, { tries = 5 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    await throttle(host);
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent } });
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(2000 * attempt);
      continue;
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= tries) throw new Error(`HTTP ${res.status} for ${url}`);
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * attempt);
  }
}

export async function getJson(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const res = await request(u.toString());
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Wikimedia sometimes answers a rate limit with a 200 and a plain-text body.
    if (/too many requests/i.test(text)) {
      await sleep(15000);
      return getJson(url, params);
    }
    throw new Error(`Not JSON from ${u}: ${text.slice(0, 120)}`);
  }
}

export async function getBuffer(url) {
  const res = await request(url);
  return Buffer.from(await res.arrayBuffer());
}
