// What badges exist and which ones a profile has earned. Pure functions of the data
// (data/regions.json, badges.json, secret-badges.json) and the profile's collection.
//   group:<group>                 every card in a group
//   continent:<id>:<tier>         <tier>'s count of collected cards tagged with that continent
//   biome:<id>:<tier>             the same for a biome
//   secret:<id>                   every card in a set; hidden until earned
// Only collected cards count (parent preview shows cards without collecting them).

export const REGION_KINDS = [['continent', 'continents'], ['biome', 'biomes']];

const tierNeed = (cfg, regionId, tier) => cfg.badges.counts?.[regionId]?.[tier.id] ?? tier.count;

// Every badge, in display order.
export function allBadges(cfg, groups) {
  const out = groups.map(g => ({ id: `group:${g.id}`, kind: 'group', ref: g.id, emoji: g.emoji, name: g.name }));
  for (const [kind, key] of REGION_KINDS) {
    for (const r of cfg.regions[key]) {
      cfg.badges.tiers.forEach((tier, i) => out.push({
        id: `${kind}:${r.id}:${tier.id}`, kind, ref: r.id, emoji: r.emoji, name: r.name,
        tier: tier.id, tierIndex: i, tierName: tier.name, need: tierNeed(cfg, r.id, tier),
      }));
    }
  }
  for (const s of cfg.secrets.badges) out.push({ id: `secret:${s.id}`, kind: 'secret', ref: s.id, emoji: s.emoji, title: s.title, cards: s.cards });
  return out;
}

// How many collected cards carry a tag.
export const tagCount = (cards, isCollected, key, id) => cards.filter(c => isCollected(c) && (c[key] ?? []).includes(id)).length;

export function isEarned(b, { cards, isCollected, byId }) {
  if (b.kind === 'group') {
    const list = cards.filter(c => c.group === b.ref);
    return list.length > 0 && list.every(isCollected);
  }
  if (b.kind === 'secret') return b.cards.every(id => byId.has(id) && isCollected(byId.get(id)));
  const key = REGION_KINDS.find(([k]) => k === b.kind)[1];
  return tagCount(cards, isCollected, key, b.ref) >= b.need;
}

// A region's progress: { n, tiers: [badge…], current (highest earned tier or null), next }.
export function regionProgress(all, kind, regionId, ctx) {
  const key = REGION_KINDS.find(([k]) => k === kind)[1];
  const tiers = all.filter(b => b.kind === kind && b.ref === regionId);
  const n = tagCount(ctx.cards, ctx.isCollected, key, regionId);
  const earned = tiers.filter(t => n >= t.need);
  return { n, tiers, current: earned.at(-1) ?? null, next: tiers.find(t => n < t.need) ?? null };
}
