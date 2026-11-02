// Numbers with units, in the active profile's units (a parent setting). Everything is
// stored metric; imperial and °F are only for showing.
import { t } from './i18n.js';
import { state } from './store.js';

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

export const imperial = () => state.profile?.parent.length === 'imperial';
export const fahrenheit = () => state.profile?.parent.temp === 'F';

const round = v => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
const num = v => round(v).toLocaleString('en');
const span = (lo, hi, f) => (hi == null || lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`);
const pair = (text, unitKey) => {
  const u = t(`unit.${unitKey}`);
  return { en: `${text} ${u.en}`, zh: `${text} ${u.zh}` };
};

// Lengths as { en, zh }. Imperial: inches below 3 ft, feet above.
export function lengthText(cm, cmMax = null) {
  if (!imperial()) return pair(span(cm, cmMax, num), 'cm');
  const big = (cmMax ?? cm) >= 3 * 12 * CM_PER_IN;
  const f = big ? v => num(v / CM_PER_IN / 12) : v => num(v / CM_PER_IN);
  return pair(span(cm, cmMax, f), big ? 'ft' : 'in');
}

export function weightText(kg, kgMax = null) {
  if (!imperial()) return pair(span(kg, kgMax, num), 'kg');
  return pair(span(kg, kgMax, v => num(v / KG_PER_LB)), 'lb');
}

export const tempText = c => (fahrenheit() ? `${Math.round(c * 9 / 5 + 32)}°F` : `${c}°C`);

// The Welcome form takes height in ft + in and weight in lb when imperial.
export const cmFromFtIn = (ft, inch) => ((ft ?? 0) * 12 + (inch ?? 0)) * CM_PER_IN;
export const ftInFromCm = cm => {
  const total = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(total / 12), inch: total % 12 };
};
export const kgFromLb = lb => lb * KG_PER_LB;
export const lbFromKg = kg => Math.round(kg / KG_PER_LB);
