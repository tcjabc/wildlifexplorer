// The everyday things the creature comparison measures animals against, traced from photos by
// scripts/make-figures.mjs. Plain data, so tests can read it without the image tools.
//
// Per figure:
//   file      where the SVG goes (fixed name; the app's PARTNERS in js/compare-data.js point here)
//   title     the photo on Wikimedia Commons; sourceUrl, author, license, licenseUrl: its credit,
//             checked on the photo's own page (a traced outline is a derivative: same licence)
//   crop      fractions of the photo [x, y, w, h]; flip: mirror so it faces left like the others
//   mode      'salient' (the U²-Net model), 'bright' (light subject on a dark background) or
//             'pink' (a flowering tree: blossom colour for the crown, dark pixels in `trunk` for the trunk)
//   thr, open, close, smooth, eps: mask cut (0…1), stray-strand removal, gap filling, edge smoothing (px),
//             outline simplification (px), all at the 900 px working size
//   refine    simple shapes added to the traced outline (coordinates: fractions of the working
//             picture's width and height, sizes: fractions of its width)
//   measure   what the picture's size stands for, so its box can be given in cm (see README)
//
// The people (assets/child.svg, assets/grown-up.svg) stay drawn: owner's choice, 2026-11-14.
export const FIGURES = {
  car: {
    file: 'assets/car.svg',
    title: 'File:Golf R mk7 side view.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Golf_R_mk7_side_view.jpg',
    author: 'Gogodance', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    what: 'Volkswagen Golf R (Mk7), 4276 mm long, 1436 mm high',
    flip: true, crop: [0, 0.35, 1, 0.55],
    // Wheels as true circles: tyre 225/40 R18 (radius 31.9 cm), centres where the photo has them, with
    // a gap around them (gap: the arch's radius, in tyre radii).
    refine: { wheels: { xs: [0.18, 0.775], radiusCm: 31.9, gap: 1.12 } },
    measure: { cm: 427.6, across: true, span: 'box' },
  },
  cat: {
    file: 'assets/cat.svg',
    title: 'File:Cat in Sunset 2016-04-08.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cat_in_Sunset_2016-04-08.jpg',
    author: 'daisuke1230', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    what: 'a house cat standing on a wall, side on',
    crop: [0.2, 0.1, 0.8, 0.62],
    // The photo's tail is held short: it is cut off at its base and drawn full length (about 0.6 of
    // the body), curving up.
    refine: {
      erase: [[0.72, 0, 1, 0.455]],
      tails: [{ line: [[0.7, 0.44], [0.86, 0.48], [0.94, 0.36], [0.99, 0.14]], w0: 0.05, w1: 0.022 }],
    },
    // A house cat is about 46 cm from the nose to the base of the tail (tail not counted).
    measure: { cm: 46, across: true, span: [0.085, 0.725] },
  },
  'cherry-tree': {
    file: 'assets/cherry-tree.svg',
    title: 'File:Sakura at Mount Yae 201902 01.JPG',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sakura_at_Mount_Yae_201902_01.JPG',
    author: 'Kugel~commonswiki', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    what: 'a Taiwan cherry (Prunus campanulata) in flower, Mount Yae, Okinawa',
    mode: 'pink', spread: 16, close: 6, trunk: [0.425, 0.5, 0.5, 0.94, 85], eps: 1.4,
    // The crown is the blossom filled in; the trunk and main branches are drawn where the photo has them.
    refine: {
      branches: [
        { line: [[0.462, 0.935], [0.466, 0.8], [0.47, 0.66]], w0: 0.024, w1: 0.017 },
        { line: [[0.468, 0.68], [0.42, 0.56], [0.33, 0.46]], w0: 0.014, w1: 0.006 },
        { line: [[0.47, 0.67], [0.478, 0.53], [0.455, 0.42]], w0: 0.013, w1: 0.006 },
        { line: [[0.474, 0.68], [0.53, 0.59], [0.6, 0.5]], w0: 0.013, w1: 0.006 },
        { line: [[0.468, 0.74], [0.4, 0.64], [0.3, 0.6]], w0: 0.01, w1: 0.005 },
        { line: [[0.472, 0.72], [0.55, 0.65], [0.66, 0.61]], w0: 0.011, w1: 0.005 },
      ],
    },
    // Drawn 5.5 m tall (the card's compare.height).
    measure: { cm: 550, across: false, span: 'box' },
  },
  sand: {
    file: 'assets/sand-grain.svg',
    title: 'File:Песчинки-1. Желтый строительный песок.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:%D0%9F%D0%B5%D1%81%D1%87%D0%B8%D0%BD%D0%BA%D0%B8-1._%D0%96%D0%B5%D0%BB%D1%82%D1%8B%D0%B9_%D1%81%D1%82%D1%80%D0%BE%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9_%D0%BF%D0%B5%D1%81%D0%BE%D0%BA.jpg',
    author: 'Alexander Klepnev', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    what: 'one grain of building sand under a microscope',
    mode: 'bright', crop: [0.18, 0.16, 0.14, 0.16], thr: 0.12,
    measure: { cm: 0.1, across: true, span: 'box' },
  },
  salt: {
    file: 'assets/salt-grain.svg',
    title: 'File:Salt Crystals macro.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Salt_Crystals_macro.jpg',
    author: 'Prosthetic Head', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    what: 'one grain of table salt (a small cube), macro photo',
    mode: 'bright', crop: [0.135, 0.115, 0.05, 0.075], thr: 0.45, open: 12, smooth: 3,
    measure: { cm: 0.03, across: true, span: 'box' },
  },
  hair: {
    file: 'assets/hair.svg',
    title: 'File:Human hair 1.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Human_hair_1.png',
    author: 'Foreade', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    what: 'a human hair under a scanning electron microscope',
    mode: 'bright', rotate: -18.4, crop: [0.15, 0.36, 0.7, 0.28], thr: 0.22, smooth: 5, eps: 0.9,
    // Bent into a gentle S and tapered to a tip at one end; the other end is cut, like a snipped hair.
    refine: { bend: { wave: 0.06, taperFrom: 0.55, tip: 0.12 } },
    // The photo's hair is about 75 µm thick; drawn 0.07 mm thick, as its label says.
    measure: { cm: 0.007, across: true, span: 'thickness' },
  },
};

// The working size every photo is scaled to before cutting out (long side, px).
export const WORK = 900;
