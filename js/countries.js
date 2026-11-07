// Home country choices: ISO 3166-1 region codes. Their names come from the browser
// (Intl.DisplayNames) in English and Traditional Chinese, so no names are stored here.
import { plain } from './i18n.js';

export const CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');

let names = null;
function namer() {
  if (names) return names;
  try {
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    const zh = new Intl.DisplayNames(['zh-Hant-TW'], { type: 'region' });
    // Taiwan as the app writes it everywhere else (臺, not the browser's 台).
    names = code => ({ en: en.of(code) ?? code, zh: code === 'TW' ? '臺灣' : zh.of(code) ?? code });
  } catch {
    names = code => ({ en: code, zh: code });
  }
  return names;
}

export const countryName = code => (code ? namer()(code) : null);

// [{ code, text }] sorted by name in the current language.
export function countryOptions() {
  return CODES.map(code => ({ code, text: plain(countryName(code)) }))
    .sort((a, b) => a.text.localeCompare(b.text, ['en', 'zh-Hant-TW']));
}
