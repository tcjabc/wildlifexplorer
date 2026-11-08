// Stage pictures: a heading's own photos in a card's "stage" in data/animals.json, each { image,
// credit: { author, license, licenseUrl, sourceUrl } } with image a WebP in our own img/. Habitat
// (js/habitat.js) and Food (js/food.js) build on this; Babies is one static photo:
// "stage": { "babies": { image, credit } }. Plain data, tested in tests/stage-pictures.test.mjs.

const FILE = /^img\/[a-z0-9-]+\.webp$/;

// A stage picture as a picture record like card.photo: { file, author, license, licenseUrl,
// sourceUrl }. Null when it isn't one it can show.
export function stagePicture(entry) {
  if (!entry || typeof entry !== 'object' || !FILE.test(entry.image ?? '')) return null;
  return { file: entry.image, ...(entry.credit ?? {}) };
}

// The card's photo of its young, or null.
export const babiesOf = card => stagePicture(card?.stage?.babies);
