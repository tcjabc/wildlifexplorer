// The weekly drop plan (data/drops.json): which cards come in which pack.
//
// A series has the same number of cards from each group every time (drops.groupSizes in
// build.config.json). Series 1 takes the first N rows of each group in card-list.csv,
// series 2 the next N, and so on, so new rows only ever add to later drops (add new rows
// at the end of their group). Each drop holds cardsPerPack cards, never two from the
// same group. A slot whose row isn't in the CSV yet is planned with "id": null.

export class DropPlanError extends Error {}

// The order the groups fill each drop: the same for every series. Every round takes the
// groups with the most cards left (ties: the one used longest ago, then groups.json
// order). This always succeeds when no group has more cards than there are drops.
export function seriesPattern(groups, { cardsPerPack, seriesCards, groupSizes }) {
  const fail = msg => { throw new DropPlanError(`drops in scripts/build.config.json: ${msg}`); };
  if (!Number.isInteger(cardsPerPack) || cardsPerPack < 1) fail('cardsPerPack must be a whole number of at least 1.');
  if (!Number.isInteger(seriesCards) || seriesCards % cardsPerPack) fail(`seriesCards (${seriesCards}) must be a multiple of cardsPerPack (${cardsPerPack}).`);
  const known = new Set(groups.map(g => g.id));
  for (const id of Object.keys(groupSizes ?? {})) if (!known.has(id)) fail(`groupSizes has "${id}", which is not a group in data/groups.json.`);
  const missing = groups.filter(g => !Number.isInteger(groupSizes?.[g.id]) || groupSizes[g.id] < 0);
  if (missing.length) fail(`groupSizes needs a whole number for ${missing.map(g => g.id).join(', ')}.`);
  const total = groups.reduce((n, g) => n + groupSizes[g.id], 0);
  if (total !== seriesCards) fail(`groupSizes add up to ${total}, but seriesCards is ${seriesCards}.`);

  const drops = seriesCards / cardsPerPack;
  const crowded = groups.filter(g => groupSizes[g.id] > drops);
  if (crowded.length) {
    fail(`a series has ${drops} drops, so a group can have at most ${drops} cards per series or two of its cards would share a pack. ` +
      `Too many: ${crowded.map(g => `${g.id} (${groupSizes[g.id]})`).join(', ')}.`);
  }

  const left = new Map(groups.map(g => [g.id, groupSizes[g.id]]));
  const lastUsed = new Map(groups.map(g => [g.id, -1]));
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const pattern = [];
  for (let d = 0; d < drops; d++) {
    const pick = groups.map(g => g.id).filter(id => left.get(id) > 0)
      .sort((a, b) => left.get(b) - left.get(a) || lastUsed.get(a) - lastUsed.get(b) || order.get(a) - order.get(b))
      .slice(0, cardsPerPack);
    if (pick.length < cardsPerPack) fail(`drop ${d + 1} can't be filled with ${cardsPerPack} different groups.`);
    for (const id of pick) { left.set(id, left.get(id) - 1); lastUsed.set(id, d); }
    pattern.push(pick.sort((a, b) => order.get(a) - order.get(b)));
  }
  return pattern;
}

// rows: [{ id, groupId }] in CSV order. Returns the drops for every series the CSV reaches.
export function planDrops(rows, groups, cfg) {
  const pattern = seriesPattern(groups, cfg);
  const byGroup = new Map(groups.map(g => [g.id, rows.filter(r => r.groupId === g.id)]));
  const seriesCount = Math.max(1, ...groups.map(g =>
    cfg.groupSizes[g.id] ? Math.ceil(byGroup.get(g.id).length / cfg.groupSizes[g.id]) : 0));

  const drops = [];
  for (let s = 0; s < seriesCount; s++) {
    const taken = new Map(groups.map(g => [g.id, s * cfg.groupSizes[g.id]]));
    pattern.forEach((groupIds, w) => {
      const cards = groupIds.map(group => {
        const i = taken.get(group);
        taken.set(group, i + 1);
        return { group, id: byGroup.get(group)[i]?.id ?? null };
      });
      drops.push({ id: `s${s + 1}-w${String(w + 1).padStart(2, '0')}`, series: s + 1, week: w + 1, cards });
    });
  }

  // Belt and braces: the rule the app relies on.
  for (const d of drops) {
    const groupsIn = d.cards.map(c => c.group);
    if (new Set(groupsIn).size !== groupsIn.length) throw new DropPlanError(`Drop ${d.id} has two cards from the same group (${groupsIn.join(', ')}).`);
  }
  const ids = drops.flatMap(d => d.cards.map(c => c.id)).filter(Boolean);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length) throw new DropPlanError(`These cards are planned in two drops: ${[...new Set(twice)].join(', ')}.`);
  return drops;
}

// Position of each card id in the plan, for building cards in drop order.
export const dropOrder = drops => new Map(drops.flatMap(d => d.cards.map(c => c.id)).filter(Boolean).map((id, i) => [id, i]));
