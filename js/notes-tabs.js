// A sticky index tab (js/notebook.js drawTabs). Its label always reads across, on as many short lines
// as the tab holds. A name that won't fit becomes its group's emoji and its first word, and a single
// word too long for the tab breaks in two: nothing is ever cut off.
import { h, mount } from './dom.js';
import { bi, getMode } from './i18n.js';

// What goes on a tab in place of a name that won't fit.
function shortName({ en, zh }, emoji) {
  const word = `${emoji} ${(en ?? '').split(' ')[0]}`;
  return getMode() === 'zh' ? { en: word, zh: `${emoji} ${zh || en}` } : { en: word, zh };
}

// Against the tab's own height: a line's height is less than its emoji's, which means nothing here.
export const spills = (label, tab) => label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > tab.clientHeight - 2;

// Two short lines to each language at most.
function tooLong(label) {
  const line = parseFloat(getComputedStyle(label).lineHeight);
  return [...label.querySelectorAll('.bi > *')].some(words => words.offsetHeight > line * 2.4);
}

// Once the tab is on the page and has its size. Beside a page with no room for a label there is
// nothing to measure: only the initial shows.
export function fitLabel(tab, { name, emoji }) {
  const label = tab.querySelector('.nb-tab__name');
  if (!emoji || !(spills(label, tab) || tooLong(label))) return;
  tab.setAttribute('data-short', '');
  mount(label, bi(shortName(name, emoji)));
}

//   entry: { id, name, group, emoji }. text: its name as a line of text. current: the tab for the place.
export function tabButton(entry, { name = entry.name, text, current, onclick }) {
  return h('button', {
    type: 'button', class: ['nb-tab', `nb-tab--${entry.group ? 'animal' : entry.id}`], 'data-tab': entry.id, 'data-group': entry.group ?? null,
    'aria-current': current ? 'true' : null, 'aria-label': text, onclick,
  }, h('span', { class: 'nb-tab__initial', 'aria-hidden': 'true' }, text.slice(0, 1).toUpperCase()), h('span', { class: 'nb-tab__name', 'aria-hidden': 'true' }, bi(name)));
}
