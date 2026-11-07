// The numbers behind the creature comparison, and which comparisons a card can show. Plain data in
// and out, so the heading table (js/headings.js) and its tests can use it without a page.

const filled = p => p && (p.en || p.zh);
const mid = r => (r == null ? null : typeof r === 'number' ? r : r.max == null ? r.min : (r.min + r.max) / 2);

// Numbers for the comparisons: lengthCm / weightKg / lifespanYears ({ min, max }, the midpoint
// is used), or the older { min, max, unit } shape of length / weight / lifespan.
export function numbers(card) {
  const s = card.stats ?? {};
  const old = (o, unit) => (o?.min != null && o.unit === unit ? o : null);
  return {
    lengthCm: mid(s.lengthCm ?? old(s.length, 'cm')),
    heightCm: mid(s.heightCm),
    wingspanCm: mid(s.wingspanCm),
    weightKg: mid(s.weightKg ?? old(s.weight, 'kg')),
    lifespanYears: mid(s.lifespanYears ?? old(s.lifespan, 'years')),
  };
}

// How big the silhouette is drawn: { cm, across }. across: the size runs along the picture's width
// (a length or a wingspan); otherwise up its height. compare.width and compare.height, written for
// the card's own silhouette, win over the statistics. Null when there is nothing to go by.
export function sizeOf(card) {
  const n = numbers(card);
  const c = card.compare ?? {};
  if (c.width) return { cm: c.width, across: true };
  if (c.height) return { cm: c.height, across: false };
  if (n.lengthCm) return { cm: n.lengthCm, across: true };
  if (n.heightCm) return { cm: n.heightCm, across: false };
  if (n.wingspanCm) return { cm: n.wingspanCm, across: true };
  return null;
}

export function modesFor(card) {
  const n = numbers(card);
  const s = card.stats ?? {};
  return {
    length: Boolean(card.silhouette?.file && sizeOf(card)),
    weight: Boolean(n.weightKg),
    lifespan: Boolean(n.lifespanYears),
    diet: Boolean(s.dietIcons?.length || filled(s.diet)),
  };
}
