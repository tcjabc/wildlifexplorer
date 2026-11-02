// When a card may arrive in a pack: its facts are written, in English and Chinese, and
// they are no longer a draft to check (see "_draft" in data/animals.json). A species card
// also needs its continent and biome tags (badges and the Globe filter use them), checked
// and not a draft. Topic cards may have no tags. A drop waits until all of its cards are
// ready. Used by the app and by the build report.
export const FACTS_NEEDED = 3;

const written = f => Boolean(f?.en?.trim() && f?.zh?.trim());
const drafted = (card, field) => (card._draft ?? []).includes(field);

// What a card still needs before it can arrive: [] when it is ready.
export function stillNeeds(card) {
  if (!card) return ['not built yet'];
  const needs = [];
  const n = (card.facts ?? []).filter(written).length;
  if (n < FACTS_NEEDED) needs.push(`facts (${n} of ${FACTS_NEEDED} written in both languages)`);
  else if (drafted(card, 'facts')) needs.push('facts are a draft to check');
  const tagged = card.continents?.length > 0 && card.biomes?.length > 0;
  if (card.scientificName && !tagged) needs.push('continent and biome tags');
  else if (drafted(card, 'tags')) needs.push('tags are a draft to check');
  return needs;
}

export const isReady = card => stillNeeds(card).length === 0;
