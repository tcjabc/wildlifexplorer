// Card data plus every explorer's progress, kept on the device in IndexedDB (see db.js).
// An explorer ("profile") is one person or a whole family; packs, binder, badges and quiz
// scores all belong to the profile that is using the app.
import * as db from './db.js';
import { dueAt } from './schedule.js';
import { isReady } from './ready.js';
import { allBadges, isEarned } from './badges.js';

export const state = {
  cards: [],
  groups: [],
  byId: new Map(),
  drops: [],        // the weekly pack plan (data/drops.json), the same order for everyone
  seriesDrops: 29,
  profiles: [],     // explorers on this device, oldest first
  profile: null,    // the one using the app now
  collected: {},    // card id -> when it was collected (ISO time), for this profile
  badges: {},       // badge id (see badges.js) -> when it was earned
  regions: { continents: [], biomes: [] }, // continent and biome tags (data/regions.json)
  badgeCfg: null,   // { regions, badges, secrets }: what can be earned
  lookalikes: { entries: {}, groups: [] },
  quiz: { best: {} },
  packs: [],        // this profile's packs on its current timeline, in drop order
  legacy: null,     // progress saved before there were profiles, until it moves into one
};

// 'profile': the active profile or one of its settings changed. 'profiles': the list
// changed. 'packs': a pack arrived or was opened.
const bus = new EventTarget();
export const onChange = (type, fn) => bus.addEventListener(type, fn);
const emit = type => bus.dispatchEvent(new Event(type));

export async function init() {
  const [cards, groups, plan, regions, badges, secrets, lookalikes] = await Promise.all(
    ['data/animals.json', 'data/groups.json', 'data/drops.json', 'data/regions.json', 'data/badges.json',
      'data/secret-badges.json', 'data/lookalikes.json'].map(u => fetch(u).then(r => r.json())),
  );
  const known = new Set(groups.map(g => g.id));
  state.cards = cards.filter(c => known.has(c.group));
  state.cards.forEach((c, i) => { c.number = i + 1; });
  state.groups = groups;
  state.byId = new Map(state.cards.map(c => [c.id, c]));
  state.drops = plan.drops;
  state.seriesDrops = plan.seriesDrops;
  state.regions = regions;
  state.badgeCfg = { regions, badges, secrets };
  state.lookalikes = lookalikes;

  state.profiles = (await db.all('profiles')).filter(p => !p.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!(await db.getMeta('migratedV1', false))) state.legacy = await db.readLegacy();

  // First run: ask the browser not to clear this data when the device runs low on space.
  if (!(await db.getMeta('persistAsked', false))) {
    await db.setMeta('persistAsked', true);
    Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
  }
}

const nowIso = () => new Date().toISOString();
// Every record carries createdAt / updatedAt / deletedAt, for syncing later.
const stamp = (rec, now = nowIso()) => ({ ...rec, createdAt: rec.createdAt ?? now, updatedAt: now, deletedAt: rec.deletedAt ?? null });
const live = list => list.filter(r => !r.deletedAt);

// ---------- Profiles ----------

const AVATARS = 8; // colours, see [data-avatar] in app.css
// Units follow the device's region until a parent changes them.
function defaultParent() {
  const imperial = /-(US|LR|MM)\b/i.test(navigator.language ?? '');
  return { dropDay: 6, dropTime: '09:00', length: imperial ? 'imperial' : 'metric', temp: imperial ? 'F' : 'C', preview: false };
}
// A new profile copies the drop day/time and units of the existing ones.
export function parentTemplate() {
  const from = state.profile ?? state.profiles[0];
  if (!from) return defaultParent();
  const { dropDay, dropTime, length, temp } = from.parent;
  return { dropDay, dropTime, length, temp, preview: false };
}

function nextAvatar() {
  const used = new Set(state.profiles.map(p => p.avatar));
  for (let i = 1; i <= AVATARS; i++) if (!used.has(i)) return i;
  return (state.profiles.length % AVATARS) + 1;
}

// The fields of the Welcome form. Height and weight are always stored in cm and kg.
const FIELDS = ['name', 'lang', 'age', 'heightCm', 'weightKg', 'homeCountry'];
function pickFields(fields, prev) {
  const out = {};
  for (const k of FIELDS) if (k in fields) out[k] = fields[k] ?? null;
  if ('age' in out && out.age !== prev?.age) out.ageAsOf = out.age == null ? null : nowIso();
  return out;
}

// Age as of today, counting the birthdays since it was entered.
export function currentAge(p) {
  if (p?.age == null) return null;
  const years = p.ageAsOf ? Math.floor((Date.now() - Date.parse(p.ageAsOf)) / (365.25 * 864e5)) : 0;
  return p.age + Math.max(0, years);
}

// What the Welcome form starts with when there is progress from before profiles.
export function legacyPrefill() {
  const s = state.legacy?.settings;
  if (!s) return null;
  return { lang: s.lang, heightCm: s.child?.heightCm ?? null, weightKg: s.child?.weightKg ?? null, age: s.child?.age ?? null };
}

export async function createProfile(fields) {
  const now = nowIso();
  const s = (!state.profiles.length && state.legacy?.settings) || {};
  const p = stamp({
    id: db.newId(),
    name: '', lang: 'both', age: null, ageAsOf: null, heightCm: null, weightKg: null, homeCountry: null,
    ...pickFields(fields),
    avatar: nextAvatar(),
    zhuyin: Boolean(s.zhuyin),
    rate: s.rate === 'slow' ? 'slow' : 'normal',
    parent: { ...parentTemplate(), preview: Boolean(s.preview) },
    timeline: { epoch: 1, startAt: now },
  }, now);
  await db.put('profiles', p);
  if (!state.profiles.length) await moveLegacy(p);
  state.profiles = [...state.profiles, p];
  emit('profiles');
  return p;
}

// Progress saved before profiles goes into the first profile, once.
async function moveLegacy(p) {
  const old = state.legacy;
  if (old) {
    const at = d => new Date(`${d}T12:00:00`).toISOString(); // version 1 kept local days
    await db.tx(['collection', 'badges', 'quiz'], 'readwrite', async a => {
      for (const [cardId, d] of Object.entries(old.collected ?? {})) {
        await a.put('collection', stamp({ id: `${p.id}:${cardId}`, profileId: p.id, cardId, collectedAt: at(d), packId: null }));
      }
      for (const [groupId, d] of Object.entries(old.badges ?? {})) {
        await a.put('badges', stamp({ id: `${p.id}:group:${groupId}`, profileId: p.id, badgeId: `group:${groupId}`, earnedAt: at(d) }));
      }
      for (const [kind, best] of Object.entries(old.quiz?.best ?? {})) {
        await a.put('quiz', stamp({ id: `${p.id}:${kind}`, profileId: p.id, kind, best }));
      }
    });
  }
  await db.setMeta('migratedV1', true);
  state.legacy = null;
}

// patch: Welcome-form fields, settings (zhuyin, rate) and/or parent: { … } (merged).
export async function updateProfile(id, patch) {
  const prev = state.profiles.find(p => p.id === id);
  if (!prev) return;
  const next = stamp({
    ...prev,
    ...pickFields(patch, prev),
    ...('zhuyin' in patch && { zhuyin: Boolean(patch.zhuyin) }),
    ...('rate' in patch && { rate: patch.rate }),
    parent: { ...prev.parent, ...patch.parent },
  });
  await db.put('profiles', next);
  state.profiles = state.profiles.map(p => (p.id === id ? next : p));
  emit('profiles');
  if (state.profile?.id === id) {
    state.profile = next;
    emit('profile');
    if (['dropDay', 'dropTime', 'preview'].some(k => patch.parent?.[k] !== undefined)) await grantDue();
  }
}

// Kept as a deleted record (for syncing later); the profile's cards go with it.
export async function deleteProfile(id) {
  const prev = state.profiles.find(p => p.id === id);
  if (!prev) return;
  await db.put('profiles', stamp({ ...prev, deletedAt: nowIso() }));
  state.profiles = state.profiles.filter(p => p.id !== id);
  if (state.profile?.id === id) state.profile = null;
  emit('profiles');
}

export async function selectProfile(id) {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  state.profile = p;
  await db.setMeta('activeProfile', id);
  await loadProgress();
  emit('profile');
  emit('packs');
}

export const lastProfileId = () => db.getMeta('activeProfile', null);

async function loadProgress() {
  const pid = state.profile.id;
  const [col, bad, quiz] = await Promise.all(['collection', 'badges', 'quiz'].map(s => db.all(s, pid).then(live)));
  state.collected = Object.fromEntries(col.map(r => [r.cardId, r.collectedAt]));
  // Records from before Phase 2 have only groupId (a group badge).
  state.badges = Object.fromEntries(bad.map(r => [r.badgeId ?? `group:${r.groupId}`, r.earnedAt]));
  state.quiz = { best: Object.fromEntries(quiz.map(r => [r.kind, r.best])) };
  await loadPacks();
}

async function loadPacks() {
  const p = state.profile;
  state.packs = live(await db.all('packs', p.id))
    .filter(r => r.epoch === p.timeline.epoch)
    .sort((a, b) => a.seq - b.seq);
}

// Start a profile over from Series 1, Week 1. Old records are marked deleted and the
// timeline gets a new epoch, so the new packs have new ids.
export async function resetProfile(id) {
  const prev = state.profiles.find(p => p.id === id);
  if (!prev) return;
  const now = nowIso();
  await db.tx(['packs', 'collection', 'badges', 'quiz'], 'readwrite', async a => {
    for (const store of ['packs', 'collection', 'badges', 'quiz']) {
      for (const r of live(await a.all(store, id))) await a.put(store, stamp({ ...r, deletedAt: now }, now));
    }
  });
  const next = stamp({ ...prev, timeline: { epoch: prev.timeline.epoch + 1, startAt: now } }, now);
  await db.put('profiles', next);
  state.profiles = state.profiles.map(p => (p.id === id ? next : p));
  emit('profiles');
  if (state.profile?.id === id) {
    state.profile = next;
    await loadProgress();
    emit('profile');
    emit('packs');
    await grantDue();
  }
}

// ---------- Packs ----------

// A drop can arrive once every card in it is built and its facts are written (ready.js).
// In parent preview a built card is enough, so grown-ups can try packs before then.
const dropReady = drop => drop.cards.every(c => c.id && state.byId.has(c.id) &&
  (state.profile?.parent.preview || isReady(state.byId.get(c.id))));
const scheduleOf = p => ({ startAt: p.timeline.startAt, parent: p.parent, seriesDrops: state.seriesDrops });

// Grant every drop that is due, in order, exactly once. A drop whose cards aren't ready
// yet waits (and holds back the ones after it); once it is ready it arrives with its
// original due time, and any later drops that are also due catch up straight away.
// Each pack's id is profile + timeline epoch + drop id, and it is written with add(), so
// two tabs, a reload or a repeated check can never grant the same drop twice.
let granting = null;
export function grantDue() {
  granting ??= grant().finally(() => { granting = null; });
  return granting;
}

async function grant() {
  const p = state.profile;
  if (!p) return [];
  const now = new Date();
  const at = now.toISOString();
  const epoch = p.timeline.epoch;
  const fresh = await db.tx(['packs'], 'readwrite', async a => {
    const packs = live(await a.all('packs', p.id)).filter(r => r.epoch === epoch).sort((x, y) => x.seq - y.seq);
    let prev = packs.at(-1) ?? null;
    const added = [];
    for (let n = prev ? prev.seq + 1 : 0; n < state.drops.length; n++) {
      const drop = state.drops[n];
      const due = dueAt(n, prev, scheduleOf(p));
      if (due > now || !dropReady(drop)) break;
      const cardIds = drop.cards.map(c => c.id);
      const rec = stamp({
        id: `${p.id}:${epoch}:${drop.id}`, profileId: p.id, epoch, seq: n, dropId: drop.id, cardIds,
        dueAt: due.toISOString(), grantedAt: at, notifiedAt: null, openedAt: null,
      }, at);
      // Nothing new inside (cards brought over from before profiles): file it as opened.
      if (cardIds.every(id => state.collected[id])) rec.openedAt = rec.notifiedAt = at;
      if (await a.add('packs', rec)) added.push(rec);
      prev = rec;
    }
    return added;
  });
  if (state.profile?.id === p.id) await loadPacks();
  if (fresh.length) emit('packs');
  return fresh;
}

export const unopenedPacks = () => state.packs.filter(p => !p.openedAt);
export const inUnopenedPack = cardId => unopenedPacks().some(p => p.cardIds.includes(cardId));
export const dropById = id => state.drops.find(d => d.id === id);

// When the next pack is due: { due, waiting } (waiting: due already, but its cards
// aren't ready yet), or null when every planned drop has arrived.
export function nextDrop() {
  const p = state.profile;
  const prev = state.packs.at(-1) ?? null;
  const n = prev ? prev.seq + 1 : 0;
  if (!p || n >= state.drops.length) return null;
  const due = dueAt(n, prev, scheduleOf(p));
  return { due, waiting: due <= new Date() && !dropReady(state.drops[n]) };
}

export async function markNotified(packs) {
  const at = nowIso();
  await db.tx(['packs'], 'readwrite', async a => {
    for (const { id } of packs) {
      const r = await a.get('packs', id);
      if (r && !r.notifiedAt) await a.put('packs', stamp({ ...r, notifiedAt: at }, at));
    }
  });
  await loadPacks();
}

// Open a pack: the oldest unopened one only, and only once. Its cards are collected at
// this moment (when the pack is cut open). Returns the badges just earned (badges.js),
// or null if the pack can't be opened.
export async function openPack(id) {
  const p = state.profile;
  if (unopenedPacks()[0]?.id !== id) return null;
  const at = nowIso();
  const newly = await db.tx(['packs', 'collection'], 'readwrite', async a => {
    const pack = await a.get('packs', id);
    if (!pack || pack.profileId !== p.id || pack.deletedAt || pack.openedAt) return null;
    await a.put('packs', stamp({ ...pack, openedAt: at, notifiedAt: pack.notifiedAt ?? at }, at));
    const added = [];
    for (const cardId of pack.cardIds) {
      const key = `${p.id}:${cardId}`;
      const had = await a.get('collection', key);
      if (had && !had.deletedAt) continue;
      await a.put('collection', stamp({ id: key, profileId: p.id, cardId, collectedAt: at, packId: id, createdAt: had?.createdAt }, at));
      added.push(cardId);
    }
    return added;
  });
  if (!newly) { await loadPacks(); return null; }
  state.collected = { ...state.collected, ...Object.fromEntries(newly.map(c => [c, at])) };
  state.packs = state.packs.map(x => (x.id === id ? { ...x, openedAt: at } : x));

  const earned = await awardBadges();
  emit('packs');
  return earned;
}

// ---------- Badges ----------

export const badgeList = () => allBadges(state.badgeCfg, state.groups);
const badgeCtx = () => ({ cards: state.cards, isCollected, byId: state.byId });

// Save every badge the profile has earned but doesn't have yet (after opening a pack, or
// when the tier counts change). Returns the new ones, for the celebration.
export async function awardBadges() {
  const p = state.profile;
  if (!p || !state.badgeCfg) return [];
  const ctx = badgeCtx();
  const fresh = badgeList().filter(b => !state.badges[b.id] && isEarned(b, ctx));
  if (!fresh.length) return [];
  const at = nowIso();
  await db.tx(['badges'], 'readwrite', async a => {
    for (const b of fresh) await a.put('badges', stamp({ id: `${p.id}:${b.id}`, profileId: p.id, badgeId: b.id, earnedAt: at }, at));
  });
  state.badges = { ...state.badges, ...Object.fromEntries(fresh.map(b => [b.id, at])) };
  emit('badges');
  return fresh;
}

// ---------- Collection ----------

export const isCollected = c => Boolean(state.collected[c.id]);
// What the binder shows face-up: collected cards, or everything in parent preview.
export const isVisible = c => isCollected(c) || Boolean(state.profile?.parent.preview);

export const groupById = id => state.groups.find(g => g.id === id);
export const cardsIn = gid => state.cards.filter(c => c.group === gid);

export function progress(gid) {
  const list = gid ? cardsIn(gid) : state.cards;
  return { n: list.filter(isCollected).length, total: list.length };
}

export async function saveQuizScore(kind, score) {
  const p = state.profile;
  const best = Math.max(state.quiz.best?.[kind] ?? 0, score);
  state.quiz = { ...state.quiz, best: { ...state.quiz.best, [kind]: best } };
  const id = `${p.id}:${kind}`;
  const prev = await db.get('quiz', id);
  await db.put('quiz', stamp({ id, profileId: p.id, kind, best, createdAt: prev?.createdAt }));
  return best;
}

// Image helpers. Thumbnails sit in img/thumbs/ with the same base name, as .webp.
export const thumbOf = file => 'img/thumbs/' + file.split('/').pop().replace(/\.[^.]+$/, '') + '.webp';
export const mainImage = c => c.photo ?? c.illustration ?? null;
export const speechRate = () => (state.profile?.rate === 'slow' ? 0.7 : 0.95);
