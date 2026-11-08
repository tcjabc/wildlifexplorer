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

// The statistic under an animal in the comparison, as { min, max }: what the card says about its
// size, not how big its picture is drawn. A card sized by height shows its height; compare.stat names
// another one (a flying fox, drawn wings out, shows its wingspan).
export function sizeStat(card) {
  const s = card.stats ?? {};
  const r = card.compare?.stat ? s[card.compare.stat]
    : card.compare?.height ? s.heightCm ?? s.lengthCm
      : s.lengthCm ?? s.heightCm ?? s.wingspanCm;
  return typeof r === 'number' ? { min: r } : r ?? null;
}

// The picture a comparison draws: the card's silhouette, unless the card says otherwise. A cherry's
// silhouette is its fruit, for stamps; beside a child it has to be the tree (compare.silhouette).
export const compareImage = card => card.compare?.silhouette?.file ?? card.silhouette?.file ?? null;

export function modesFor(card) {
  const n = numbers(card);
  const s = card.stats ?? {};
  return {
    length: Boolean(compareImage(card) && sizeOf(card)),
    weight: Boolean(n.weightKg),
    lifespan: Boolean(n.lifespanYears),
    diet: Boolean(s.dietIcons?.length || filled(s.diet)),
  };
}

// Who the animal can be compared with when a child has no height or weight on their profile, or
// just for fun. cm: the size, across its picture's width or up its height; ratio: the picture's
// height / width; kg: its weight. Everyday figures, for scale.
export const PARTNERS = {
  adult: { id: 'adult', icon: '🧑', img: 'assets/grown-up.svg', cm: 170, across: false, ratio: 170 / 60, kg: 70 },
  cat: { id: 'cat', icon: '🐈', img: 'assets/cat.svg', cm: 48, across: true, ratio: 30 / 48, kg: 4 },
  car: { id: 'car', icon: '🚗', img: 'assets/car.svg', cm: 430, across: true, ratio: 150 / 430, kg: 1400 },
  // For what is far too small to stand beside a child (a card's compare.partners). A grain of coarse
  // sand is up to 1 mm, table salt about 0.3 mm (sieves put it at 0.1–0.7 mm) and a hair about
  // 0.07 mm thick (17–181 µm): showCm is what its label says.
  sand: { id: 'sand', icon: '🏖️', img: 'assets/sand-grain.svg', cm: 0.1, across: true, ratio: 84 / 100 },
  hair: { id: 'hair', icon: '〰️', img: 'assets/hair.svg', cm: 0.15, across: true, ratio: 30 / 300, showCm: 0.007 },
  salt: { id: 'salt', icon: '🧂', img: 'assets/salt-grain.svg', cm: 0.03, across: true, ratio: 1 },
};

// Who a card can be compared with, the child being 'you'. A card can have its own list.
export const EVERYDAY = ['you', 'adult', 'cat', 'car'];
export const whoOf = card => card.compare?.partners ?? EVERYDAY;
export const CHILD_RATIO = 120 / 48; // assets/child.svg

// Who a comparison starts with: the child if their profile has the number it needs, otherwise the
// grown-up, and on a card without them the first on its list.
export function startWith(mode, profile, list = EVERYDAY) {
  const want = (mode === 'weight' ? profile?.weightKg : profile?.heightCm) != null ? 'you' : 'adult';
  return list.includes(want) ? want : list[0];
}
