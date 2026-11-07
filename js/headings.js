// The heading grid on an open card: eight buttons, the same icon, colour and place on every card, so
// children who can't read yet learn them. A card with nothing for a heading shows it greyed out,
// never missing, so nothing ever moves. Topic cards have a set of their own, with 🌍 ❤️ 💡 in the
// same places. Plain data in and out, so it can be tested without a page (tests/headings.test.mjs).
//
// Each heading names the stage views it would like, best first; the first this card can show is
// used. To add one (a Stepper, say):
//   1. a line in VIEW_HAS here: can this card show it?
//   2. a builder of the same name in js/stage-views.js
//   3. its name in the `views` of a heading, or in a card's own "stage": { "<heading>": "<view>" }
import { modesFor } from './compare-data.js';

const filled = p => p && (p.en || p.zh);
const shown = (p, preview) => filled(p) && (!p.todo || preview);

// slot: the place in the grid, 1–8, and the colour (--head-<slot> in css/tokens.css).
// text: the Fact File section read out and shown under the grid.
export const SPECIES_HEADINGS = [
  { id: 'habitat', slot: 1, icon: '🏠', label: 'ff.habitat', text: 'habitat', views: ['photo'] },
  { id: 'food', slot: 2, icon: '🍃', label: 'ff.foodAndHunting', text: 'foodAndHunting', views: ['diet', 'photo'] },
  { id: 'babies', slot: 3, icon: '🥚', label: 'heading.babies', text: 'breeding', views: ['babies', 'photo'] },
  { id: 'behaviour', slot: 4, icon: '🐾', label: 'ff.behaviour', text: 'behaviour', views: ['profile', 'photo'] },
  { id: 'size', slot: 5, icon: '📏', label: 'heading.size', views: ['compare'] },
  { id: 'where', slot: 6, icon: '🌍', label: 'card.where', views: ['map'] },
  { id: 'status', slot: 7, icon: '❤️', label: 'heading.status', text: 'conservation', views: ['status'] },
  { id: 'dyk', slot: 8, icon: '💡', label: 'ff.didYouKnow', text: 'didYouKnow', views: ['photo'] },
];

export const TOPIC_HEADINGS = [
  { id: 'what', slot: 1, icon: '❓', label: 'heading.what', views: ['photo'] },
  { id: 'how', slot: 2, icon: '⚙️', label: 'heading.how', views: ['photo'] },
  { id: 'who', slot: 3, icon: '👀', label: 'heading.who', views: ['related', 'photo'] },
  { id: 'when', slot: 4, icon: '🕒', label: 'heading.when', views: ['photo'] },
  { id: 'wow', slot: 5, icon: '⭐', label: 'heading.wow', views: ['photo'] },
  { id: 'where', slot: 6, icon: '🌍', label: 'card.where', views: ['map'] },
  { id: 'help', slot: 7, icon: '❤️', label: 'heading.help', views: ['photo'] },
  { id: 'dyk', slot: 8, icon: '💡', label: 'ff.didYouKnow', views: ['photo'] },
];

export const TOPIC_GROUPS = new Set(['behavior', 'world-explorer', 'conservation', 'how-animals-work']);
export const isTopic = card => TOPIC_GROUPS.has(card.group);
export const headingSet = card => (isTopic(card) ? TOPIC_HEADINGS : SPECIES_HEADINGS);

// A topic card's three facts, until it says which heading each belongs to ("factHeadings").
const TOPIC_FACTS = ['what', 'wow', 'dyk'];

// Sounds live in audio/calls/, like the pictures in img/: nothing else is ever played.
export const hasCall = c => /^audio\/calls\/[a-z0-9-]+\.(m4a|mp3|ogg)$/.test(c.call?.file ?? '');

// A heading's recorded narration, if the card has one: "narration": { "habitat": { "en": file, "zh":
// file } }. The files to play, in order, for the language mode; none means nothing plays.
const NARRATION = /^audio\/narration\/[a-z0-9-]+\.(m4a|mp3|ogg)$/;
export function narrationFiles(card, heading, mode = 'both') {
  const n = card.narration?.[heading] ?? {};
  return (mode === 'zh' ? [n.zh] : mode === 'en' ? [n.en] : [n.en, n.zh]).filter(f => NARRATION.test(f ?? ''));
}

export const hasMap = c => Boolean(c.map?.areas?.length || c.range || c.mapBounds);

// Can this card show a view? ctx: { preview, lookalikes, related } (how many it has to show).
// `photo` always can: with no picture it shows the group's emoji on paper. Views marked by
// FILLER don't make a heading worth tapping on their own.
export const VIEW_HAS = {
  gallery: () => true,
  photo: () => true,
  diet: c => Boolean(c.stats?.dietIcons?.length),
  babies: (c, { preview }) => Boolean(c.stats?.youngCount?.min && (!c.stats.youngCount.todo || preview)),
  profile: c => Boolean(c.profile?.callouts?.length && c[c.profile.image ?? 'photo']?.file),
  compare: (c, { lookalikes = 0 }) => {
    const m = modesFor(c);
    return m.length || m.weight || m.lifespan || lookalikes > 0;
  },
  map: c => hasMap(c) || Boolean(c.continents?.length || c.place),
  status: c => Boolean(c.status),
  related: (c, { related = 0 }) => related > 0,
};
const FILLER = new Set(['gallery', 'photo']);

// The text under a heading: a list of pairs (glossary marks and all; todo text for grown-ups only).
export function textOf(card, heading, { preview = false } = {}) {
  if (isTopic(card)) {
    const map = card.factHeadings ?? TOPIC_FACTS;
    return (card.facts ?? []).filter((f, i) => map[i] === heading.id && shown(f, preview));
  }
  return heading.text ? (card.factFile?.[heading.text] ?? []).filter(p => shown(p, preview)) : [];
}

// Which view a heading shows on this card: the card's own choice if it can, else the first it can.
export function viewFor(card, heading, ctx = {}) {
  const can = id => Boolean(VIEW_HAS[id]?.(card, ctx));
  const own = card.stage?.[heading.id];
  return can(own) ? own : heading.views.find(can) ?? null;
}

// The grid for a card: every heading in its place, with what it shows. enabled: false is greyed
// out. A heading is worth tapping when it has text, or a view of its own.
export function headingsFor(card, ctx = {}) {
  return headingSet(card).map(heading => {
    const view = viewFor(card, heading, ctx);
    const text = textOf(card, heading, ctx);
    return { ...heading, view, text, enabled: text.length > 0 || Boolean(view && !FILLER.has(view)) };
  });
}
