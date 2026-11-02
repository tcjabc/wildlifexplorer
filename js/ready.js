// When a card may arrive in a pack: its facts are written, in English and Chinese, and
// they are no longer a draft to check (see "_draft" in data/animals.json). A drop waits
// until all of its cards are ready. Used by the app and by the build report.
export const FACTS_NEEDED = 3;

const written = f => Boolean(f?.en?.trim() && f?.zh?.trim());

// What a card still needs before it can arrive: [] when it is ready.
export function stillNeeds(card) {
  if (!card) return ['not built yet'];
  const needs = [];
  const n = (card.facts ?? []).filter(written).length;
  if (n < FACTS_NEEDED) needs.push(`facts (${n} of ${FACTS_NEEDED} written in both languages)`);
  else if ((card._draft ?? []).includes('facts')) needs.push('facts are a draft to check');
  return needs;
}

export const isReady = card => stillNeeds(card).length === 0;
