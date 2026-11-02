// Chinese names with zhuyin (注音), the way Taiwanese school books print it: each
// character with its bopomofo in a small column on its right, the tone mark beside the
// column and the neutral-tone dot above it.
//
// card.name.zhuyin holds one syllable per Chinese character, separated by spaces
// (e.g. "ㄊㄞˊ ㄨㄢ ㄏㄟ ㄒㄩㄥˊ"). Both forms are in the page; html[data-zhuyin] picks
// which one shows. Tapping a name switches every name for this visit; the default is a
// setting.
import { h, $$ } from './dom.js';

const TONES = 'ˊˇˋ';
const OPENING = '（(「『《〈';
const isHan = ch => /\p{Script=Han}/u.test(ch);

export function setZhuyin(on) {
  document.documentElement.dataset.zhuyin = on ? 'on' : 'off';
  for (const b of $$('.zyname')) b.setAttribute('aria-pressed', String(on));
}
export const zhuyinOn = () => document.documentElement.dataset.zhuyin === 'on';

function syllable(s) {
  const neutral = s.startsWith('˙');
  const body = neutral ? s.slice(1) : s;
  const tone = TONES.includes(body.at(-1)) ? body.at(-1) : '';
  const symbols = [...(tone ? body.slice(0, -1) : body)];
  return h('span', { class: 'zy__r' },
    neutral && h('span', { class: 'zy__n' }, '˙'),
    h('span', { class: 'zy__b' }, symbols.map(c => h('span', null, c))),
    tone && h('span', { class: 'zy__t' }, tone));
}

// The Chinese name with zhuyin, or null if the syllables don't match the characters.
function annotated(zh, zhuyin) {
  const syl = zhuyin.trim().split(/\s+/);
  const chars = [...zh];
  if (chars.filter(isHan).length !== syl.length) return null;
  let i = 0;
  // Lines may only break between characters: an opening bracket stays with the
  // character after it, any other mark with the one before.
  const units = [];
  let open = null;
  for (const ch of chars) {
    if (!isHan(ch)) {
      if (OPENING.includes(ch)) open = ch;
      else if (units.length) units.at(-1).append(ch);
      else units.push(h('span', { class: 'zy' }, ch));
      continue;
    }
    units.push(h('span', { class: 'zy' }, open, h('span', { class: 'zy__h' }, ch), syllable(syl[i++])));
    open = null;
  }
  return h('span', { class: ['zyname__zy', syl.length > 8 && 'zyname__zy--long'], 'aria-hidden': 'true' }, units);
}

function toggle(e) {
  e.stopPropagation();
  const on = !zhuyinOn();
  setZhuyin(on);
  const btn = e.currentTarget;
  btn.classList.remove('is-turning');
  void btn.offsetWidth; // restart the animation
  btn.classList.add('is-turning');
}

// Like i18n's bi(), but the Chinese half is a button that switches 漢字 ↔ 注音.
// Falls back to plain text when the name has no zhuyin.
export function nameBi(name, cls = '') {
  const en = name.en ?? '', zh = name.zh ?? '';
  const zy = zh && name.zhuyin ? annotated(zh, name.zhuyin) : null;
  const zhEl = zy
    ? h('button', {
      class: 't-zh zyname', type: 'button', lang: 'zh-Hant-TW', 'aria-label': zh,
      'aria-pressed': String(zhuyinOn()), onclick: toggle,
      onanimationend: e => e.currentTarget.classList.remove('is-turning'),
    }, h('span', { class: 'zyname__plain' }, zh), zy)
    : zh && h('span', { class: 't-zh', lang: 'zh-Hant-TW' }, zh);
  return h('span', { class: ['bi', cls] }, en && h('span', { class: 't-en', lang: 'en' }, en), zhEl);
}
