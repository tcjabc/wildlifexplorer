// The weekly drop plan (data/drops.json): which cards come in which pack.
//
// A series has the same number of cards from each group every time (drops.groupSizes in
// build.config.json). Each drop holds cardsPerPack cards, never two from the same group,
// and every group is spread evenly over the series.
//
// Freezing: as soon as a drop is ready (every card in it built and its facts written,
// see js/ready.js), it is written to data/drops.lock.json and never changes again,
// whatever happens to card-list.csv later. Until then a drop can still be re-planned.
// Rows that aren't in a frozen drop yet fill the open slots in CSV order, per group.
// A slot with no row for it yet is planned with "id": null, and its drop waits.

export class DropPlanError extends Error {}

// Which groups fill each drop of a series: the same for every series. Each round takes
// the groups furthest behind an even spread (expected so far minus taken), after any
// group that must go in every remaining drop. That always succeeds when no group has
// more cards than there are drops.
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

  const size = id => groupSizes[id];
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const taken = new Map(groups.map(g => [g.id, 0]));
  const pattern = [];
  for (let d = 0; d < drops; d++) {
    const left = id => size(id) - taken.get(id);
    const behind = id => (size(id) * (d + 1)) / drops - taken.get(id);
    const open = groups.map(g => g.id).filter(id => left(id) > 0);
    const forced = open.filter(id => left(id) === drops - d);
    const rest = open.filter(id => !forced.includes(id)).sort((a, b) =>
      (Math.abs(behind(b) - behind(a)) > 1e-9 ? behind(b) - behind(a) : 0) || size(b) - size(a) || order.get(a) - order.get(b));
    const pick = [...forced, ...rest].slice(0, cardsPerPack);
    if (pick.length < cardsPerPack || forced.length > cardsPerPack) fail(`drop ${d + 1} can't be filled with ${cardsPerPack} different groups.`);
    for (const id of pick) taken.set(id, taken.get(id) + 1);
    pattern.push(pick.sort((a, b) => order.get(a) - order.get(b)));
  }
  return pattern;
}

const dropId = (s, w) => `s${s}-w${String(w).padStart(2, '0')}`;
const sameGroups = (a, b) => a.map(c => c.group ?? c).sort().join() === b.map(c => c.group ?? c).sort().join();

// rows: [{ id, groupId, name, line }] in CSV order. lock: the frozen drops so far
// ({ dropId: [{ group, id }] }). previous: card ids in the last plan (to spot new rows).
// ready(id): whether that card is ready. Returns { drops, lock, warnings }.
export function planDrops(rows, groups, cfg, lock = {}, previous = null, ready = () => false) {
  const pattern = seriesPattern(groups, cfg);
  const perSeries = pattern.length;
  const rowById = new Map(rows.map(r => [r.id, r]));
  const warnings = [];

  const frozenIds = new Set();
  for (const [id, cards] of Object.entries(lock)) {
    for (const c of cards) {
      if (frozenIds.has(c.id)) throw new DropPlanError(`data/drops.lock.json has "${c.id}" in two drops (again in ${id}).`);
      frozenIds.add(c.id);
    }
  }

  // Rows not frozen yet, per group, in CSV order: they fill the open slots in turn.
  const queue = new Map(groups.map(g => [g.id, rows.filter(r => r.groupId === g.id && !frozenIds.has(r.id))]));
  const frozenPer = id => Object.values(lock).flat().filter(c => c.group === id).length;
  const lastFrozenSeries = Math.max(0, ...Object.keys(lock).map(k => Number(k.match(/^s(\d+)-/)?.[1] ?? 0)));
  const seriesCount = Math.max(1, lastFrozenSeries, ...groups.map(g =>
    cfg.groupSizes[g.id] ? Math.ceil((frozenPer(g.id) + queue.get(g.id).length) / cfg.groupSizes[g.id]) : 0));

  const drops = [];
  const nextLock = {};
  for (let s = 1; s <= seriesCount; s++) {
    pattern.forEach((groupIds, i) => {
      const id = dropId(s, i + 1);
      const held = lock[id];
      if (held) {
        if (!sameGroups(held, groupIds)) {
          warnings.push(`${id} is frozen with ${held.map(c => c.group).join(', ')}, but the plan now has ${groupIds.join(', ')} in that week. The frozen drop is kept, so this series' group totals no longer match groupSizes.`);
        }
        for (const c of held) {
          const row = rowById.get(c.id);
          if (!row) warnings.push(`"${c.id}" (frozen in ${id}) is no longer in card-list.csv. The drop keeps it.`);
          else if (row.groupId !== c.group) warnings.push(`"${c.id}" (frozen in ${id} as ${c.group}) is now in group ${row.groupId} in card-list.csv. The drop keeps it as it was.`);
        }
        nextLock[id] = held;
        drops.push({ id, series: s, week: i + 1, frozen: true, cards: held });
        return;
      }
      const cards = groupIds.map(group => ({ group, id: queue.get(group).shift()?.id ?? null }));
      const frozen = cards.every(c => c.id && ready(c.id));
      if (frozen) nextLock[id] = cards;
      drops.push({ id, series: s, week: i + 1, frozen, cards });
    });
  }

  // A new row added above cards that are already frozen can't go where it sits in the CSV.
  const placedIn = new Map(drops.flatMap(d => d.cards.filter(c => c.id).map(c => [c.id, d.id])));
  for (const g of groups) {
    const inGroup = rows.filter(r => r.groupId === g.id);
    const lastFrozen = inGroup.findLastIndex(r => frozenIds.has(r.id));
    inGroup.slice(0, lastFrozen + 1).filter(r => !frozenIds.has(r.id) && previous && !previous.has(r.id)).forEach(r => {
      warnings.push(`"${r.name ?? r.id}" (row ${r.line}) is above cards that are already in frozen drops, so it goes into the next open drop (${placedIn.get(r.id) ?? 'not planned yet'}), not where it sits in the CSV.`);
    });
  }

  // Belt and braces: the rules the app relies on.
  for (const d of drops) {
    const groupsIn = d.cards.map(c => c.group);
    if (new Set(groupsIn).size !== groupsIn.length) throw new DropPlanError(`Drop ${d.id} has two cards from the same group (${groupsIn.join(', ')}).`);
  }
  const ids = drops.flatMap(d => d.cards.map(c => c.id)).filter(Boolean);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length) throw new DropPlanError(`These cards are planned in two drops: ${[...new Set(twice)].join(', ')}.`);
  return { drops, lock: nextLock, warnings };
}

// Position of each card id in the plan, for building cards in drop order.
export const dropOrder = drops => new Map(drops.flatMap(d => d.cards.map(c => c.id)).filter(Boolean).map((id, i) => [id, i]));
