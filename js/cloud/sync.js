// Sends this device's explorers and their progress to the family account (Supabase Data
// API, tables in supabase/migrations). The first time a parent signs in on a device they
// choose which explorers to add; after that every change goes up. Bringing other devices'
// changes down comes later (README, Family accounts).
//
// What is sent is an allow-list per table (toRow). Never: height, weight, age, home
// country, preview, Field Notes settings, quiz scores, Field Notes, or when a pack was first
// shown. Not sent at all: explorers the parent left unticked, explorers deleted before this
// device's first sync, progress from before a "Start over" in version 3 (marked deleted).
//
// Changes are found through the outbox (db.js), which every write to a synced store fills
// in the same transaction. An entry is removed once the server has the record, and only if
// the record didn't change meanwhile. A record the server rejects is held back with its
// error (until it changes again) and the rest still go. Being offline, the server being
// busy or the session running out only means trying again later: nothing here blocks the
// app, and nothing runs unless a parent is signed in.
//
// meta 'sync': { userId, email, familyId, setUpAt, localOnly: [profile ids] }, written when
// the parent first chooses. A different account signing in on this device later sends
// nothing: these explorers belong to the first account's family.
import * as defaultDb from '../db.js';
import { auth as defaultAuth, AuthError } from './auth.js';

const BATCH = 500;
const DEBOUNCE_MS = 2000;
const RETRY_MS = [5e3, 30e3, 2 * 60e3, 10 * 60e3];
const LOCK = 'wildfile-sync';

// Each table's primary key, for the upsert. In this order: progress needs its profile there.
const TABLES = {
  profiles: 'id',
  packs: 'profile_id,epoch,drop_id',
  collection: 'profile_id,epoch,card_id',
  badges: 'profile_id,epoch,badge_id',
};
const ORDER = Object.keys(TABLES);

// ---------- Records to rows ----------

// The server's own checks (supabase/migrations), so a record it would refuse is held back here.
const CARD = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const DROP = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BADGE = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const iso = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isoOrNull = v => v == null || iso(v);
const epochOk = v => Number.isInteger(v) && v >= 1;

export class Invalid extends Error {}
function check(ok, what) { if (!ok) throw new Invalid(what); }

// The row for one record: exactly the server's columns, nothing else. null when the record
// isn't sent (old reset history). Throws Invalid when the server would refuse it.
export function toRow(store, r, familyId) {
  if (store === 'profiles') {
    const p = r.parent ?? {};
    const row = {
      id: r.id, family_id: familyId,
      name: r.name, lang: r.lang, avatar: r.avatar, zhuyin: Boolean(r.zhuyin), rate: r.rate === 'slow' ? 'slow' : 'normal',
      length_unit: p.length, temp_unit: p.temp, drop_day: p.dropDay, drop_time: p.dropTime,
      timeline_epoch: r.timeline?.epoch, timeline_start_at: r.timeline?.startAt,
      client_updated_at: r.settingsAt ?? r.updatedAt, created_at: r.createdAt, deleted_at: r.deletedAt ?? null,
    };
    const length = [...(row.name ?? '')].length;
    check(typeof row.name === 'string' && length >= 1 && length <= 24, 'name');
    check(['en', 'zh', 'both'].includes(row.lang), 'lang');
    check(Number.isInteger(row.avatar) && row.avatar >= 1 && row.avatar <= 8, 'avatar');
    check(['metric', 'imperial'].includes(row.length_unit) && ['C', 'F'].includes(row.temp_unit), 'units');
    check(Number.isInteger(row.drop_day) && row.drop_day >= 0 && row.drop_day <= 6 && HHMM.test(row.drop_time ?? ''), 'drop time');
    check(epochOk(row.timeline_epoch) && iso(row.timeline_start_at), 'timeline');
    check(iso(row.client_updated_at) && iso(row.created_at) && isoOrNull(row.deleted_at), 'times');
    return row;
  }
  // Progress that version 3 marked deleted at a "Start over" is history this device keeps.
  if (r.deletedAt) return null;
  const base = { profile_id: r.profileId, family_id: familyId, epoch: r.epoch };
  check(epochOk(r.epoch), 'epoch');
  if (store === 'packs') {
    check(DROP.test(r.dropId ?? '') && Number.isInteger(r.seq) && r.seq >= 0, 'drop');
    check(Array.isArray(r.cardIds) && r.cardIds.length >= 1 && r.cardIds.length <= 10 && r.cardIds.every(c => CARD.test(c)), 'cards');
    check(iso(r.dueAt) && iso(r.grantedAt) && isoOrNull(r.openedAt), 'times');
    return { ...base, drop_id: r.dropId, seq: r.seq, card_ids: r.cardIds, due_at: r.dueAt, granted_at: r.grantedAt, opened_at: r.openedAt ?? null };
  }
  if (store === 'collection') {
    check(CARD.test(r.cardId ?? '') && (r.dropId == null || DROP.test(r.dropId)) && iso(r.collectedAt), 'card');
    return { ...base, card_id: r.cardId, collected_at: r.collectedAt, drop_id: r.dropId ?? null };
  }
  if (store === 'badges') {
    check(BADGE.test(r.badgeId ?? '') && iso(r.earnedAt), 'badge');
    return { ...base, badge_id: r.badgeId, earned_at: r.earnedAt };
  }
  throw new Error(`Not a synced store: ${store}`);
}

// ---------- Sync ----------

class Retry extends Error {}
const retryable = status => status === 408 || status === 425 || status === 429 || status >= 500;

export function createSync({ db = defaultDb, auth = defaultAuth, locks = globalThis.navigator?.locks, timers = globalThis } = {}) {
  const events = new EventTarget();
  const changed = () => events.dispatchEvent(new Event('change'));
  let running = null;
  let timer = null;
  let tries = 0;
  let last = { problem: null, savedAt: null }; // problem: 'offline' | 'needs-sign-in' | 'server'

  const config = () => db.getMeta('sync', null);
  const withLock = fn => (locks ? locks.request(LOCK, fn) : fn());

  // Where this device stands with whoever is signed in.
  //   'signed-out' · 'needs-sign-in' · 'choose' (first sign-in here: pick explorers) ·
  //   'other-account' (this device's explorers belong to another account) · 'on'
  async function stage() {
    const st = await auth.state();
    if (!st.signedIn) return st.needsSignIn ? 'needs-sign-in' : 'signed-out';
    const cfg = await config();
    if (!cfg) return 'choose';
    return cfg.userId === st.userId ? 'on' : 'other-account';
  }

  // The explorers to offer the first time: everyone not deleted, oldest first.
  async function candidates() {
    const list = (await db.all('profiles')).filter(p => !p.deletedAt);
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function familyOf(userId) {
    const res = await auth.authFetch(`/rest/v1/family_members?select=family_id,role&user_id=eq.${encodeURIComponent(userId)}&order=role.asc&limit=1`);
    if (res.status !== 200) throw new AuthError(retryable(res.status) ? 'offline' : 'unknown', `family ${res.status}`);
    const [row] = await res.json();
    if (!row?.family_id) throw new AuthError('unknown', 'no family');
    return row.family_id;
  }

  // The parent's choice, the first time: the ticked explorers are queued with all their
  // progress; the rest, and explorers already deleted, stay on this device only.
  async function setUp(chosenIds) {
    const st = await auth.state();
    if (!st.signedIn) throw new AuthError('signed-out');
    if (await config()) return;
    const familyId = await familyOf(st.userId);
    const picked = new Set(chosenIds);
    await db.tx(['meta', 'outbox', ...ORDER], 'readwrite', async a => {
      if (await a.get('meta', 'sync')) return; // another window chose first
      const profiles = await a.all('profiles');
      const localOnly = profiles.filter(p => p.deletedAt || !picked.has(p.id)).map(p => p.id);
      const sent = new Set(profiles.map(p => p.id).filter(id => !localOnly.includes(id)));
      for (const e of await a.all('outbox')) await a.remove('outbox', e.id); // from before: not needed
      for (const store of ORDER) {
        for (const r of await a.all(store)) {
          const pid = store === 'profiles' ? r.id : r.profileId;
          if (!sent.has(pid) || (store !== 'profiles' && r.deletedAt)) continue;
          await a.put('outbox', { id: `${store}:${r.id}`, store, key: r.id, rev: db.newId() });
        }
      }
      await a.put('meta', { id: 'sync', value: { userId: st.userId, email: st.email, familyId, setUpAt: new Date().toISOString(), localOnly } });
    });
    changed();
    await push();
  }

  // ---------- Pushing ----------

  const upsert = (store, rows) => auth.authFetch(`/rest/v1/${store}?on_conflict=${TABLES[store]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });

  // Remove (or hold back, with why) the entries that are still the ones we read.
  async function settle(done, held) {
    if (!done.length && !held.length) return;
    await db.tx(['outbox'], 'readwrite', async a => {
      for (const e of done) if ((await a.get('outbox', e.id))?.rev === e.rev) await a.remove('outbox', e.id);
      for (const [e, error] of held) if ((await a.get('outbox', e.id))?.rev === e.rev) await a.put('outbox', { ...e, error });
    });
  }

  // Send items (all one store). A rejected batch is split in half until the bad record is
  // alone; that one is held back.
  async function send(store, items) {
    const res = await upsert(store, items.map(i => i.row));
    if (res.status >= 200 && res.status < 300) return settle(items.map(i => i.e), []);
    if (retryable(res.status)) throw new Retry(String(res.status));
    if (items.length > 1) {
      const half = Math.ceil(items.length / 2);
      await send(store, items.slice(0, half));
      return send(store, items.slice(half));
    }
    const body = await res.text().catch(() => '');
    let code = '';
    try { code = JSON.parse(body)?.code ?? ''; } catch { /* not JSON */ }
    return settle([], [[items[0].e, `${res.status} ${code}`.trim()]]);
  }

  // Returns false when there was nothing it may do (not signed in, not set up, other account).
  async function pushOnce() {
    if (await stage() !== 'on') return false;
    const cfg = await config();
    const localOnly = new Set(cfg.localOnly);
    const { entries, records, profiles } = await db.tx(['outbox', ...ORDER], 'readonly', async a => {
      const list = (await a.all('outbox')).filter(e => !e.error); // held ones wait for a change
      const recs = new Map();
      for (const e of list) recs.set(e.id, await a.get(e.store, e.key));
      return { entries: list, records: recs, profiles: new Set((await a.all('profiles')).map(p => p.id)) };
    });
    const groups = Object.fromEntries(ORDER.map(s => [s, []]));
    const drop = [];
    const held = [];
    for (const e of entries) {
      const rec = records.get(e.id);
      const pid = e.store === 'profiles' ? e.key : rec?.profileId;
      if (!rec || localOnly.has(pid) || !profiles.has(pid)) { drop.push(e); continue; }
      try {
        const row = toRow(e.store, rec, cfg.familyId);
        if (row) groups[e.store].push({ e, row }); else drop.push(e);
      } catch (err) {
        if (!(err instanceof Invalid)) throw err;
        held.push([e, `invalid ${err.message}`]);
      }
    }
    await settle(drop, held);
    for (const store of ORDER) {
      for (let i = 0; i < groups[store].length; i += BATCH) await send(store, groups[store].slice(i, i + BATCH));
    }
    return true;
  }

  function schedule(ms) {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = null; push(); }, ms);
  }

  // Push now (one at a time, in every window). Resolves when done; never throws.
  function push() {
    running ??= (async () => {
      try {
        if (await withLock(pushOnce)) last = { problem: null, savedAt: new Date().toISOString() };
        tries = 0;
      } catch (err) {
        const offline = err instanceof AuthError && err.code === 'offline';
        const signIn = err instanceof AuthError && ['needs-sign-in', 'signed-out'].includes(err.code);
        if (!offline && !signIn && !(err instanceof Retry)) console.error(err);
        last = { ...last, problem: signIn ? 'needs-sign-in' : offline ? 'offline' : 'server' };
        if (!signIn) schedule(RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
      } finally {
        running = null;
        changed();
      }
    })();
    return running;
  }

  // For the Family account panel.
  async function status() {
    const [where, cfg, outbox] = await Promise.all([stage(), config(), db.all('outbox')]);
    const localOnly = new Set(cfg?.localOnly ?? []);
    const profiles = where === 'on' ? (await db.all('profiles')).filter(p => !p.deletedAt && localOnly.has(p.id)) : [];
    return {
      stage: where,
      email: cfg?.email ?? null,
      busy: Boolean(running),
      waiting: outbox.filter(e => !e.error).length,
      held: outbox.filter(e => e.error).length,
      problem: last.problem,
      savedAt: last.savedAt,
      localOnly: profiles.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
    };
  }

  // Push after changes (once they settle), on sign-in, when the device comes back online
  // and when the app is shown again.
  function start() {
    db.events.addEventListener('queued', () => schedule(DEBOUNCE_MS));
    auth.onChange?.(() => { changed(); push(); });
    globalThis.addEventListener?.('online', () => push());
    globalThis.document?.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') push(); });
    push();
  }

  return { stage, candidates, setUp, push, status, start, onChange: fn => events.addEventListener('change', fn) };
}

export const sync = createSync();
