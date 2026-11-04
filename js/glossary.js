// Glossary terms in card text. Text marks a term inline:
//   [[omnivore]]                → the glossary entry "omnivore", shown as "omnivore"
//   [[omnivore|omnivores]]      → the same entry, shown as "omnivores"
//   [[omnivore|雜食性動物]]      → Chinese text always gives the words to show
// Terms in data/glossary.json become buttons; tapping one opens a small popover with a
// kid-friendly definition. An unknown term is just its text (tests/glossary.test.mjs and the
// build report list the missing ones). Everything is built as DOM nodes, never innerHTML.
import { h } from './dom.js';
import { bi } from './i18n.js';
import { state } from './store.js';

export const TERM = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

// "[[omnivore|omnivores]] eat…" → "omnivores eat…" (for read-aloud and plain text).
export const plainText = s => (s ?? '').replace(TERM, (_, id, shown) => shown ?? id);
export const plainPair = p => (p ? { ...p, en: plainText(p.en), zh: plainText(p.zh) } : p);

const entry = id => state.glossary?.[id] ?? null;

// One language's text as nodes: plain text, with glossary terms as buttons.
function nodes(text) {
  const out = [];
  let last = 0;
  for (const m of (text ?? '').matchAll(TERM)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, id, shown] = m;
    const words = shown ?? id;
    out.push(entry(id)
      ? h('button', { class: 'gloss', type: 'button', 'data-term': id, onclick: e => { e.stopPropagation(); toggle(e.currentTarget, id); } }, words)
      : words);
    last = m.index + m[0].length;
  }
  if (last < (text ?? '').length) out.push(text.slice(last));
  return out;
}

// Like bi(), with the glossary terms in each language.
export function glossBi(pair, cls = '') {
  if (!pair) return null;
  const en = pair.en ?? '', zh = pair.zh ?? '';
  if (!en && !zh) return null;
  if (!zh || !en || plainText(en) === plainText(zh)) {
    return h('span', { class: ['bi', cls] }, h('span', { class: 't-any', lang: en ? 'en' : 'zh-Hant-TW' }, nodes(en || zh)));
  }
  return h('span', { class: ['bi', cls] },
    h('span', { class: 't-en', lang: 'en' }, nodes(en)),
    h('span', { class: 't-zh', lang: 'zh-Hant-TW' }, nodes(zh)));
}

// ---------- the popover ----------

let open = null; // { pop, term, off }

export function closePopover() {
  if (!open) return;
  open.pop.remove();
  open.term.setAttribute('aria-expanded', 'false');
  open.off();
  open = null;
}

function toggle(term, id) {
  const same = open?.term === term;
  closePopover();
  if (!same) show(term, id);
}

// Placed under the term inside its card page. The page is enlarged with CSS zoom, so screen
// pixels are converted back to the page's own pixels.
function show(term, id) {
  const e = entry(id);
  const page = term.closest('.cpage') ?? document.body;
  const pop = h('div', { class: 'gloss-pop', role: 'dialog', 'aria-label': [e.term.en, e.term.zh].filter(Boolean).join(' / ') },
    h('p', { class: 'gloss-pop__term' }, h('span', { 'aria-hidden': 'true' }, '📖'), bi(e.term)),
    h('p', { class: 'gloss-pop__def' }, bi(e.def)));
  page.append(pop);
  const pr = page.getBoundingClientRect(), tr = term.getBoundingClientRect();
  const k = pr.width / page.offsetWidth || 1;
  const left = Math.max(0, Math.min((tr.left - pr.left) / k, page.offsetWidth - pop.offsetWidth));
  let top = (tr.bottom - pr.top) / k + 4;
  if (top + pop.offsetHeight > page.offsetHeight) top = Math.max(0, (tr.top - pr.top) / k - pop.offsetHeight - 4);
  pop.style.setProperty('left', `${left}px`);
  pop.style.setProperty('top', `${top}px`);
  term.setAttribute('aria-expanded', 'true');

  // Closes on a tap anywhere else, on Escape, or when the page scrolls.
  const onDown = ev => { if (!pop.contains(ev.target) && ev.target !== term) closePopover(); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); closePopover(); } };
  const scroller = term.closest('[data-scroll]');
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  scroller?.addEventListener('scroll', closePopover, { once: true });
  open = {
    pop, term,
    off: () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      scroller?.removeEventListener('scroll', closePopover);
    },
  };
}
