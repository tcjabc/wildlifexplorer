// Sends this device's explorers and their progress to the family account (Supabase Data
// API, tables in supabase/migrations), and brings the other devices' changes down. The
// first time a parent signs in on a device they choose which explorers to add; after that
// every change goes up, and the family's explorers come down. Each run pushes first (so the
// server has merged this device's changes), then pulls.
//
// What is sent is an allow-list per table (toRow). Never: height, weight, age, home
// country, preview, Field Notes settings, quiz scores, Field Notes, or when a pack was first
// shown. Not sent at all: explorers the parent left unticked, explorers deleted before this
// device's first sync, progress from before a "Start over" in version 3 (marked deleted), and
// progress of an explorer already deleted.
//
// Changes are found through the outbox (db.js), which every write to a synced store fills
// in the same transaction. An entry is removed once the server has the record, and only if
// the record didn't change meanwhile. A record the server rejects is held back with its
// error (until it changes again) and the rest still go. Being offline, the server being
// busy or the session running out only means trying again later: nothing here blocks the
// app, and nothing runs unless a parent is signed in.
//
// Pulling reads each table's rows changed since the last pull (updated_at, the server's
// time), and merges them in with the server's own rules (merge.js). A record that ends up
// exactly as the server has it gets no outbox entry, so nothing bounces back up. Not
// pulled: explorers left on this device only (their ids, should the server ever have
// them), and progress of explorers this device doesn't have or has deleted. "Start over"
// done on another device also clears this device's quiz scores, as it does here.
//
// meta 'sync': { userId, email, familyId, setUpAt, localOnly: [profile ids] }, written when
// the parent first chooses. A different account signing in on this device later sends
// and pulls nothing: these explorers belong to the first account's family.
// meta 'syncPull': { version, familyId, at: { table: updated_at of the last row pulled } }.
import * as defaultDb from '../db.js';
import { auth as defaultAuth, AuthError } from './auth.js';
import { CARD, DROP, BADGE, HHMM, iso, isoOrNull, epochOk, Invalid, check, MERGE } from './merge.js';

export { Invalid };

const BATCH = 500;
const DEBOUNCE_MS = 2000;
const RETRY_MS = [5e3, 30e3, 2 * 60e3, 10 * 60e3];
const LOCK = 'wildfile-sync';
// Pages bigger than an upload batch: rows sent in one request share one updated_at, so a
// page always gets past them.
const PAGE = 1000;
// updated_at is when a write's transaction began, so a row can commit a little after rows
// with later times. Each pull starts this much before the last one ended; merging a row
// twice changes nothing.
const OVERLAP_MS = 60e3;
const PULL_EVERY_MS = 5 * 60e3;
// Bump to pull everything again (when what is pulled, or how it is merged, changes).
const PULL_VERSION = 1;

// Each table's primary key, for the upsert. In this order: progress needs its profile there.
const TABLES = {
  profiles: 'id',
  packs: 'profile_id,epoch,drop_id',
  collection: 'profile_id,epoch,card_id',
  badges: 'profile_id,epoch,badge_id',
};
const ORDER = Object.keys(TABLES);
// What is pulled: the columns merge.js reads, and the cursor.
const PULLED = {
  profiles: 'id,name,lang,avatar,zhuyin,rate,length_unit,temp_unit,drop_day,drop_time,timeline_epoch,timeline_start_at,client_updated_at,created_at,deleted_at',
  packs: 'profile_id,epoch,drop_id,seq,card_ids,due_at,granted_at,opened_at',
  collection: 'profile_id,epoch,card_id,collected_at,drop_id',
  badges: 'profile_id,epoch,badge_id,earned_at',
};
// The local id of a pulled row (the same as the server's key).
const localId = (store, row) => (store === 'profiles' ? row.id : `${row.profile_id}:${row.epoch}:${row[TABLES[store].split(',')[2]]}`);

// ---------- Records to rows ----------

// The server's own checks (merge.js) hold back a record it would refuse.
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

// What the Family account panel says about it, from status(): a string key, or null when
// there is nothing to say yet (not set up on this device, signed out). "Saved" only once
// a push has gone through, with nothing waiting, nothing held back and nothing wrong.
export function statusKey(s) {
  if (s.stage === 'other-account') return 'sync.otherAccount';
  if (s.stage !== 'on') return null;
  if (s.busy || (!s.savedAt && !s.problem)) return 'sync.saving';
  if (s.problem === 'offline') return 'sync.offline';
  if (s.problem === 'server') return 'sync.retry';
  if (s.waiting) return 'sync.waiting';
  if (s.held) return 'sync.held';
  return 'sync.saved';
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

  // Queue an explorer with everything of theirs that is sent (inside a transaction a).
  async function queueExplorer(a, pid) {
    for (const store of ORDER) {
      const list = store === 'profiles' ? [await a.get('profiles', pid)].filter(Boolean) : await a.all(store, pid);
      for (const r of list) {
        if (store !== 'profiles' && r.deletedAt) continue; // old reset history stays here
        await a.put('outbox', { id: `${store}:${r.id}`, store, key: r.id, rev: db.newId() });
      }
    }
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
      for (const e of await a.all('outbox')) await a.remove('outbox', e.id); // from before: not needed
      for (const p of profiles) if (!localOnly.includes(p.id)) await queueExplorer(a, p.id);
      await a.put('meta', { id: 'sync', value: { userId: st.userId, email: st.email, familyId, setUpAt: new Date().toISOString(), localOnly } });
    });
    changed();
    await run();
  }

  // An explorer left on this device only, added later: from now on like the others, and
  // everything they already have goes up now. Everything is pulled again too, in case the
  // server already had rows of theirs that earlier pulls skipped.
  async function addToFamily(pid) {
    if (await stage() !== 'on') return;
    await db.tx(['meta', 'outbox', ...ORDER], 'readwrite', async a => {
      const cfg = (await a.get('meta', 'sync'))?.value;
      const p = await a.get('profiles', pid);
      if (!cfg?.localOnly.includes(pid) || !p || p.deletedAt) return;
      await a.put('meta', { id: 'sync', value: { ...cfg, localOnly: cfg.localOnly.filter(id => id !== pid) } });
      await a.remove('meta', 'syncPull');
      await queueExplorer(a, pid);
    });
    changed();
    await run();
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
      return { entries: list, records: recs, profiles: new Map((await a.all('profiles')).map(p => [p.id, p])) };
    });
    const groups = Object.fromEntries(ORDER.map(s => [s, []]));
    const drop = [];
    const held = [];
    for (const e of entries) {
      const rec = records.get(e.id);
      const pid = e.store === 'profiles' ? e.key : rec?.profileId;
      // Progress of a deleted explorer stays here (their deletion went up instead).
      const gone = !profiles.has(pid) || (e.store !== 'profiles' && profiles.get(pid).deletedAt);
      if (!rec || localOnly.has(pid) || gone) { drop.push(e); continue; }
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

  // ---------- Pulling ----------

  const pullUrl = (store, familyId, since) => `/rest/v1/${store}?select=${PULLED[store]},updated_at` +
    `&family_id=eq.${encodeURIComponent(familyId)}` + (since ? `&updated_at=gte.${encodeURIComponent(since)}` : '') +
    `&order=updated_at.asc,${TABLES[store].split(',').map(c => `${c}.asc`).join(',')}&limit=${PAGE}`;

  async function fetchPage(store, familyId, since) {
    const res = await auth.authFetch(pullUrl(store, familyId, since));
    if (retryable(res.status)) throw new Retry(String(res.status));
    if (res.status !== 200) throw new Error(`pull ${store} ${res.status}`);
    return res.json();
  }

  // Merge one page of rows and move the cursor past it, in one transaction: if the app
  // closes half-way, the page is pulled again. Adds the explorers that changed to touched.
  async function applyPage(store, rows, cursor, touched) {
    const now = new Date().toISOString();
    await db.tx(['meta', 'quiz', ...ORDER], 'readwrite', async a => {
      const cfg = (await a.get('meta', 'sync'))?.value;
      const localOnly = new Set(cfg?.localOnly ?? []);
      for (const row of rows) {
        const pid = store === 'profiles' ? row.id : row.profile_id;
        if (localOnly.has(pid)) continue;
        if (store !== 'profiles') {
          const p = await a.get('profiles', pid);
          if (!p || p.deletedAt) continue;
        }
        const local = await a.get(store, localId(store, row));
        let merged;
        try { merged = MERGE[store](local, row, now); } catch (err) {
          if (!(err instanceof Invalid)) throw err;
          console.warn(`Skipped a ${store} row this app can't use (${err.message})`);
          continue;
        }
        if (!merged) continue;
        // Exactly what the server has: no outbox entry. Ahead: it goes up again.
        await (merged.ahead ? a.put : a.putFromServer)(store, merged.record);
        touched.add(pid);
        // "Start over" on another device: the quiz scores here start over too (store.js).
        if (store === 'profiles' && local && merged.record.timeline.epoch > local.timeline.epoch) {
          for (const q of await a.all('quiz', pid)) {
            if (!q.deletedAt) await a.put('quiz', { ...q, updatedAt: now, deletedAt: now });
          }
        }
      }
      await a.put('meta', { id: 'syncPull', value: cursor });
    });
  }

  // Bring every table's changes down, profiles first (progress needs its explorer here).
  async function pullOnce() {
    const cfg = await config();
    const saved = await db.getMeta('syncPull', null);
    const same = saved?.version === PULL_VERSION && saved.familyId === cfg.familyId;
    const cursor = { version: PULL_VERSION, familyId: cfg.familyId, at: same ? { ...saved.at } : {} };
    const touched = new Set();
    for (const store of ORDER) {
      const last = cursor.at[store];
      let since = last && new Date(Date.parse(last) - OVERLAP_MS).toISOString();
      for (;;) {
        const rows = await fetchPage(store, cfg.familyId, since);
        if (!rows.length) break;
        const end = rows.at(-1).updated_at;
        if (rows.length === PAGE && rows[0].updated_at === end) throw new Error(`pull ${store}: a whole page at one time`);
        cursor.at[store] = end; // the server's own string: a Date would drop the microseconds
        await applyPage(store, rows, structuredClone(cursor), touched);
        if (rows.length < PAGE) break;
        since = end;
      }
    }
    if (touched.size) events.dispatchEvent(new CustomEvent('pulled', { detail: [...touched] }));
  }

  // ---------- Running ----------

  // false when there was nothing it may do (not signed in, not set up, other account).
  const runOnce = async () => {
    if (!(await pushOnce())) return false;
    await pullOnce();
    return true;
  };

  function schedule(ms) {
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = null; run(); }, ms);
  }

  // Push, then pull (one at a time, in every window). Resolves when done; never throws.
  function run() {
    running ??= (async () => {
      try {
        if (await withLock(runOnce)) last = { problem: null, savedAt: new Date().toISOString() };
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

  // Run after changes (once they settle), on sign-in, when the device comes back online,
  // when the app is shown again, and every few minutes while it is shown.
  function start() {
    const shown = () => globalThis.document?.visibilityState !== 'hidden';
    db.events.addEventListener('queued', () => schedule(DEBOUNCE_MS));
    auth.onChange?.(() => { changed(); run(); });
    globalThis.addEventListener?.('online', () => run());
    globalThis.document?.addEventListener('visibilitychange', () => { if (shown()) run(); });
    timers.setInterval?.(() => { if (shown()) run(); }, PULL_EVERY_MS);
    run();
  }

  return {
    stage, candidates, setUp, addToFamily, run, status, start,
    onChange: fn => events.addEventListener('change', fn),
    // fn(profile ids): records of these explorers changed here in a pull.
    onPulled: fn => events.addEventListener('pulled', e => fn(e.detail)),
  };
}

export const sync = createSync();
