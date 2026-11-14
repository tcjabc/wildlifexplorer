// The numbers behind the creature comparison, and which comparisons a card can show. Plain data in
// and out, so the heading table (js/headings.js) and its tests can use it without a page.

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
  return {
    length: Boolean(compareImage(card) && sizeOf(card)),
    weight: Boolean(n.weightKg),
    lifespan: Boolean(n.lifespanYears),
  };
}

// Who the animal can be compared with when a child has no height or weight on their profile, or
// just for fun. cm: the size, across its picture's width or up its height; ratio: the picture's
// height / width (its viewBox); kg: its weight. Everyday figures, for scale.
// The cat, car, sand, salt and hair are traced from photos by scripts/make-figures.mjs
// (scripts/figures.config.mjs says what each size stands for; credit: the photo's). The people are
// drawn (CC0). tests/figures.test.mjs keeps cm, ratio and credit in step with the SVGs.
const BY_SA_2 = 'https://creativecommons.org/licenses/by-sa/2.0/';
const BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
export const PARTNERS = {
  adult: { id: 'adult', icon: '🧑', img: 'assets/grown-up.svg', cm: 170, across: false, ratio: 170 / 60, kg: 70 },
  // Nose to tail tip, tail held up: a 46 cm cat (nose to the base of its tail).
  cat: {
    id: 'cat', icon: '🐈', img: 'assets/cat.svg', cm: 66, across: true, ratio: 558 / 1000, kg: 4,
    credit: { author: 'daisuke1230', license: 'CC BY-SA 2.0', licenseUrl: BY_SA_2, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cat_in_Sunset_2016-04-08.jpg' },
  },
  // A Volkswagen Golf: 4276 mm long.
  car: {
    id: 'car', icon: '🚗', img: 'assets/car.svg', cm: 428, across: true, ratio: 336 / 1000, kg: 1400,
    credit: { author: 'Gogodance', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Golf_R_mk7_side_view.jpg' },
  },
  // For what is far too small to stand beside a child (a card's compare.partners). A grain of coarse
  // sand is up to 1 mm, table salt about 0.3 mm (sieves put it at 0.1–0.7 mm) and a hair about
  // 0.07 mm thick (17–181 µm): showCm is what its label says. The hair is a 0.7 mm piece, bent.
  sand: {
    id: 'sand', icon: '🏖️', img: 'assets/sand-grain.svg', cm: 0.1, across: true, ratio: 883 / 1000,
    credit: { author: 'Alexander Klepnev', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:%D0%9F%D0%B5%D1%81%D1%87%D0%B8%D0%BD%D0%BA%D0%B8-1._%D0%96%D0%B5%D0%BB%D1%82%D1%8B%D0%B9_%D1%81%D1%82%D1%80%D0%BE%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9_%D0%BF%D0%B5%D1%81%D0%BE%D0%BA.jpg' },
  },
  hair: {
    id: 'hair', icon: '〰️', img: 'assets/hair.svg', cm: 0.07, across: true, ratio: 181 / 1000, showCm: 0.007,
    credit: { author: 'Foreade', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Human_hair_1.png' },
  },
  salt: {
    id: 'salt', icon: '🧂', img: 'assets/salt-grain.svg', cm: 0.03, across: true, ratio: 912 / 1000,
    credit: { author: 'Prosthetic Head', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Salt_Crystals_macro.jpg' },
  },
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
