// Card data plus the child's progress (kept in IndexedDB).
import * as db from './db.js';

export const state = {
  cards: [],
  groups: [],
  byId: new Map(),
  settings: { lang: 'both', rate: 'normal', preview: false, zhuyin: false },
  collected: {},  // id -> date it was revealed
  badges: {},     // group id -> date earned
  quiz: { best: {} },
};

export async function init() {
  const [cards, groups] = await Promise.all(
    ['data/animals.json', 'data/groups.json'].map(u => fetch(u).then(r => r.json())),
  );
  const known = new Set(groups.map(g => g.id));
  state.cards = cards.filter(c => known.has(c.group));
  state.cards.forEach((c, i) => { c.number = i + 1; });
  state.groups = groups;
  state.byId = new Map(state.cards.map(c => [c.id, c]));

  state.settings = { ...state.settings, ...(await db.get('settings', {})) };
  state.collected = await db.get('collected', {});
  state.badges = await db.get('badges', {});
  state.quiz = await db.get('quiz', { best: {} });
}

// Local calendar date as YYYY-MM-DD (unlock dates are local days, not UTC).
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

export const hasArrived = c => !c.unlockDate || c.unlockDate <= today();
export const isCollected = c => Boolean(state.collected[c.id]);
// What the binder shows face-up: collected cards, or everything in parent preview.
export const isVisible = c => isCollected(c) || state.settings.preview;

export const groupById = id => state.groups.find(g => g.id === id);
export const cardsIn = gid => state.cards.filter(c => c.group === gid);

export function progress(gid) {
  const list = gid ? cardsIn(gid) : state.cards;
  return { n: list.filter(isCollected).length, total: list.length };
}

export const pendingReveals = () => state.cards.filter(c => hasArrived(c) && !isCollected(c));

// Mark a card collected. Returns the group whose badge was just earned, if any.
export async function collect(id) {
  const card = state.byId.get(id);
  if (!card || state.collected[id]) return null;
  state.collected = { ...state.collected, [id]: today() };
  await db.set('collected', state.collected);

  const { n, total } = progress(card.group);
  if (n === total && !state.badges[card.group]) {
    state.badges = { ...state.badges, [card.group]: today() };
    await db.set('badges', state.badges);
    return groupById(card.group);
  }
  return null;
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.set('settings', state.settings);
}

export async function saveQuizScore(kind, score) {
  const best = Math.max(state.quiz.best?.[kind] ?? 0, score);
  state.quiz = { ...state.quiz, best: { ...state.quiz.best, [kind]: best } };
  await db.set('quiz', state.quiz);
  return best;
}

export async function resetProgress() {
  state.collected = {};
  state.badges = {};
  state.quiz = { best: {} };
  await Promise.all([db.set('collected', {}), db.set('badges', {}), db.set('quiz', state.quiz)]);
}

// Image helpers. Thumbnails sit in img/thumbs/ with the same base name, as .webp.
export const thumbOf = file => 'img/thumbs/' + file.split('/').pop().replace(/\.[^.]+$/, '') + '.webp';
export const mainImage = c => c.photo ?? c.illustration ?? null;
export const speechRate = () => (state.settings.rate === 'slow' ? 0.7 : 0.95);
