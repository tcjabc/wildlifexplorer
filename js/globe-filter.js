// Which cards the Globe shows. Filters are sets of ids in three sections: a card matches a
// section if it has any of its ids (or the section is empty), and it must match every section.
// So Asia + Africa + Birds is birds from either continent.
export const SECTIONS = ['continents', 'biomes', 'groups'];

export const noFilters = () => Object.fromEntries(SECTIONS.map(key => [key, new Set()]));

const tags = (card, key) => (key === 'groups' ? [card.group] : card[key] ?? []);
const inSection = (card, key, ids) => !ids.size || tags(card, key).some(id => ids.has(id));

export const matches = (card, filters) => SECTIONS.every(key => inSection(card, key, filters[key]));

export const filterCount = filters => SECTIONS.reduce((n, key) => n + filters[key].size, 0);

// How many of these cards an option stands for, given the other sections' filters: what its
// button shows, and 0 means choosing it would leave nothing on the globe.
export const optionCount = (cards, filters, key, id) => cards.filter(card => tags(card, key).includes(id)
  && SECTIONS.every(other => other === key || inSection(card, other, filters[other]))).length;

// Can this card ever have a pin? (js/views/globe.js placeOf has the details.)
export const onGlobe = card => Boolean(card.pin || card.fossilSite || card.place || card.range);
