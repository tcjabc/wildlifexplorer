// Build-report sections for continent/biome tags and badges, secret badges and
// lookalikes, plus the checks behind them (unknown tags, unknown card ids, missing sizes).

const MEASURE_KEY = { length: 'lengthCm', height: 'heightCm', wingspan: 'wingspanCm' };

// cfg: { regions, badges, secrets, lookalikes }. Returns markdown lines.
export function renderBadgeSections({ rows, cards, drops, cfg }) {
  const L = [];
  const byId = new Map(cards.map(c => [c.id, c]));
  const rowName = new Map(rows.map(r => [r.id, r.name_en]));
  const name = id => byId.get(id)?.name?.en ?? rowName.get(id) ?? id;
  const regionIds = { continents: new Set(cfg.regions.continents.map(r => r.id)), biomes: new Set(cfg.regions.biomes.map(r => r.id)) };
  const dropOf = new Map(drops.flatMap(d => d.cards.filter(c => c.id).map(c => [c.id, d.id])));

  // ---- tags and tiers ----
  const warnings = [];
  for (const c of cards) {
    for (const kind of ['continents', 'biomes']) {
      for (const t of c[kind] ?? []) if (!regionIds[kind].has(t)) warnings.push(`${c.id}: unknown ${kind.slice(0, -1)} "${t}" (see data/regions.json)`);
    }
  }
  const tierCount = (region, tier) => cfg.badges.counts?.[region]?.[tier.id] ?? tier.count;
  L.push('## Regions and badges', '');
  L.push('Cards count towards a region badge once collected. Tiers and counts are in data/badges.json. "Tagged" counts every built card with that tag, drafts included.', '');
  for (const [kind, title] of [['continents', 'Continents'], ['biomes', 'Biomes']]) {
    L.push(`### ${title}`, '');
    L.push(`| ${title.slice(0, -1)} | Tagged cards | ${cfg.badges.tiers.map(t => t.name.en).join(' | ')} |`, `|---|---|${cfg.badges.tiers.map(() => '---|').join('')}`);
    for (const r of cfg.regions[kind]) {
      const n = cards.filter(c => (c[kind] ?? []).includes(r.id)).length;
      L.push(`| ${r.emoji} ${r.name.en} | ${n} | ${cfg.badges.tiers.map(t => { const need = tierCount(r.id, t); return n >= need ? `${need} ✓` : `${need}`; }).join(' | ')} |`);
    }
    L.push('');
  }
  const untagged = cards.filter(c => c.scientificName && !(c.continents?.length && c.biomes?.length));
  const draftTags = cards.filter(c => (c._draft ?? []).includes('tags'));
  L.push(`- Species cards without tags (they can't arrive yet): ${untagged.length ? untagged.map(c => `\`${c.id}\``).join(', ') : 'none'}`);
  L.push(`- Cards whose tags are a draft to check: ${draftTags.length}${draftTags.length ? ` (${draftTags.map(c => `\`${c.id}\``).join(', ')})` : ''}`);
  L.push(`- Topic cards with no tags (they don't count towards region badges): ${cards.filter(c => !c.scientificName && !c.continents?.length).map(c => `\`${c.id}\``).join(', ') || 'none'}`, '');

  // ---- secret badges ----
  L.push('## Secret badges', '');
  L.push('Hidden until earned. Defined in data/secret-badges.json.', '');
  for (const b of cfg.secrets.badges) {
    const missing = b.cards.filter(id => !rowName.has(id));
    if (missing.length) warnings.push(`secret badge "${b.id}": ${missing.join(', ')} not in card-list.csv`);
    L.push(`- ${b.emoji} \`${b.id}\`: ${b.cards.map(id => `${name(id)}${byId.has(id) ? '' : ' (not built yet)'}`).join(' + ')}`);
    L.push(`  - EN: ${b.title.en}`);
    L.push(`  - ZH: ${b.title.zh}`);
  }
  L.push('');

  // ---- lookalikes ----
  const entries = cfg.lookalikes.entries ?? {};
  const todo = [];
  L.push('## Lookalikes', '');
  L.push('For the "Animal" comparison. Defined in data/lookalikes.json; a group shows on a card once at least one other member is built (or a standalone entry), and groups marked "draft" only show in parent preview.', '');
  for (const g of cfg.lookalikes.groups) {
    const key = MEASURE_KEY[g.measure];
    if (!key) warnings.push(`lookalike group "${g.id}": unknown measure "${g.measure}"`);
    L.push(`### ${g.title.en} · ${g.title.zh} (\`${g.id}\`)${g.draft ? ' (draft)' : ''}`, '');
    for (const m of g.members) {
      if (m.startsWith('entry:')) {
        const e = entries[m.slice(6)];
        if (!e) { warnings.push(`lookalike group "${g.id}": no entry "${m}"`); continue; }
        const needs = [!e.size?.[key] && `size (${key})`, !e.photo?.file && 'photo', !e.silhouette?.file && 'silhouette'].filter(Boolean);
        L.push(`- ◆ ${e.name.en} · ${e.name.zh} (standalone)${needs.length ? `: needs ${needs.join(', ')}` : ''}`);
        if (needs.length) todo.push(`${e.name.en} (standalone, ${g.id}): ${needs.join(', ')}`);
        continue;
      }
      if (!rowName.has(m) && !byId.has(m)) { warnings.push(`lookalike group "${g.id}": "${m}" is not a card in card-list.csv`); continue; }
      const c = byId.get(m);
      if (!c) {
        L.push(`- ○ ${name(m)}: not built yet (${dropOf.get(m) ?? 'not planned'})`);
        todo.push(`${name(m)} (\`${m}\`, ${g.id}): not built yet`);
        continue;
      }
      const needs = [!c.stats?.[key] && `size (stats.${key})`, !c.silhouette?.file && 'silhouette (the group emoji is drawn instead)'].filter(Boolean);
      const draft = (c._draft ?? []).includes('stats') ? ' (size is a draft)' : '';
      L.push(`- ✓ ${c.name.en}${needs.length ? `: needs ${needs.join(', ')}` : ''}${draft}`);
      if (needs.length) todo.push(`${c.name.en} (\`${c.id}\`, ${g.id}): ${needs.join(', ')}`);
    }
    L.push('');
  }
  L.push('### Lookalike content still needed', '');
  for (const t of todo) L.push(`- ${t}`);
  if (!todo.length) L.push('Nothing.');
  L.push('');

  // ---- silhouettes ----
  // The Animal comparison is silhouette against silhouette, so lookalikes come first; other
  // species cards only miss the "You" length comparison.
  const inGroups = new Map();
  for (const g of cfg.lookalikes.groups) for (const m of g.members) inGroups.set(m, [...(inGroups.get(m) ?? []), g.id]);
  const noSil = [
    ...cards.filter(c => c.scientificName && !c.silhouette?.file).map(c => ({ key: c.id, label: `${c.name.en} (\`${c.id}\`)` })),
    ...Object.entries(entries).filter(([, e]) => !e.silhouette?.file).map(([id, e]) => ({ key: `entry:${id}`, label: `${e.name.en} (standalone)` })),
  ];
  const lookFirst = noSil.filter(x => inGroups.has(x.key));
  const rest = noSil.filter(x => !inGroups.has(x.key));
  L.push('## Needs silhouette', '');
  L.push(`${noSil.length} species have no silhouette. In the Animal comparison they are drawn as a "?" outline at the right size.`, '');
  L.push('### In a lookalike group', '');
  for (const x of lookFirst) L.push(`- ${x.label}: ${inGroups.get(x.key).join(', ')}`);
  if (!lookFirst.length) L.push('None.');
  L.push('', '### Other species cards (no "You" length comparison)', '');
  for (const x of rest) L.push(`- ${x.label}`);
  if (!rest.length) L.push('None.');
  L.push('');

  if (warnings.length) {
    L.push('## Tag and badge problems', '');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }
  return L;
}
