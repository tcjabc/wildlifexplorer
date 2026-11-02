// Bilingual strings. Every piece of text is a pair { en, zh }. Both halves are
// rendered into the page and CSS (html[data-lang]) shows English, Chinese or both.
import { h } from './dom.js';

let strings = { en: {}, zh: {} };
let mode = 'both';

export async function loadStrings() {
  const [en, zh] = await Promise.all(
    ['lang/en.json', 'lang/zh-TW.json'].map(u => fetch(u).then(r => r.json())),
  );
  strings = { en, zh };
}

export const stringsLoaded = () => Object.keys(strings.en).length > 0;

export function setMode(m) {
  mode = m;
  document.documentElement.dataset.lang = m;
  document.documentElement.lang = m === 'zh' ? 'zh-Hant-TW' : 'en';
}
export const getMode = () => mode;

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// t('quiz.score', { n: 3, total: 10 }) -> { en, zh }. A var may itself be a pair.
export function t(key, vars = {}) {
  const side = lang => Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, v && typeof v === 'object' ? (v[lang] || v.en) : v]),
  );
  return {
    en: fill(strings.en[key] ?? key, side('en')),
    zh: fill(strings.zh[key] ?? strings.en[key] ?? key, side('zh')),
  };
}

// Render a pair as an element. A half that is missing, or a pair whose halves are
// identical (e.g. "2 / 20"), is shown once in every mode.
export function bi(pair, cls = '') {
  if (!pair) return null;
  const en = pair.en ?? '', zh = pair.zh ?? '';
  if (!en && !zh) return null;
  if (!zh || !en || en === zh) {
    return h('span', { class: ['bi', cls] }, h('span', { class: 't-any', lang: en ? 'en' : 'zh-Hant-TW' }, en || zh));
  }
  return h('span', { class: ['bi', cls] },
    h('span', { class: 't-en', lang: 'en' }, en),
    h('span', { class: 't-zh', lang: 'zh-Hant-TW' }, zh));
}

export const tx = (key, vars, cls) => bi(t(key, vars), cls);

// Plain text for attributes (aria-label, title) in the current mode.
export function plain(pair) {
  if (mode === 'en') return pair.en || pair.zh;
  if (mode === 'zh') return pair.zh || pair.en;
  return pair.en === pair.zh ? pair.en : [pair.en, pair.zh].filter(Boolean).join(' / ');
}
export const label = (key, vars) => plain(t(key, vars));

// A date (Date or ISO string) as { en, zh }, written the local way in each language.
export function dateText(d, opts = { year: 'numeric', month: 'long', day: 'numeric' }) {
  const date = d instanceof Date ? d : new Date(d);
  return {
    en: new Intl.DateTimeFormat('en', opts).format(date),
    zh: new Intl.DateTimeFormat('zh-Hant-TW', opts).format(date),
  };
}
