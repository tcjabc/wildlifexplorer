// A fake Supabase Data API for the sync tests: upserts go through the same merge rules as
// the triggers in supabase/migrations, every request gets its own server time (updated_at,
// with microseconds, shared by all the rows of one request), times come back the way
// Postgres writes them ('…+00:00'), and GETs filter, order and page like PostgREST.
import { AuthError } from '../../js/cloud/auth.js';

export const FAMILY = '11111111-1111-4111-8111-111111111111';
const KEYS = { profiles: ['id'], packs: ['profile_id', 'epoch', 'drop_id'], collection: ['profile_id', 'epoch', 'card_id'], badges: ['profile_id', 'epoch', 'badge_id'] };
const TIMES = ['timeline_start_at', 'client_updated_at', 'details_at', 'age_as_of', 'created_at', 'deleted_at', 'due_at', 'granted_at', 'opened_at', 'collected_at', 'earned_at'];
export const keyOf = (table, r) => KEYS[table].map(k => r[k]).join(':');

// Microseconds since 1970, from a time with any number of fraction digits.
export function us(t) {
  const frac = /\.(\d+)/.exec(t)?.[1] ?? '';
  return Date.parse(t.replace(/\.\d+/, '')) * 1000 + Number(frac.padEnd(6, '0').slice(0, 6));
}
const pg = micro => {
  const base = new Date(Math.floor(micro / 1000)).toISOString().slice(0, 19);
  const frac = String(micro % 1e6).padStart(6, '0').replace(/0+$/, '');
  return `${base}${frac ? `.${frac}` : ''}+00:00`;
};
const least = (a, b) => (a == null ? b : b == null ? a : us(b) < us(a) ? b : a);

const SETTINGS = ['name', 'lang', 'avatar', 'zhuyin', 'rate', 'length_unit', 'temp_unit', 'drop_day', 'drop_time', 'client_updated_at'];
const DETAILS = ['age', 'age_as_of', 'height_cm', 'weight_kg', 'home_country', 'details_at'];
// The triggers' rules (merge_profile, merge_pack, merge_collection, merge_badge).
const MERGE = {
  profiles(old, row) {
    row.created_at = old.created_at;
    if (us(row.client_updated_at) < us(old.client_updated_at)) for (const k of SETTINGS) row[k] = old[k];
    if (row.details_at == null || (old.details_at != null && us(row.details_at) < us(old.details_at))) for (const k of DETAILS) row[k] = old[k];
    if (row.timeline_epoch <= old.timeline_epoch) {
      row.timeline_epoch = old.timeline_epoch;
      row.timeline_start_at = old.timeline_start_at;
    }
    row.deleted_at = least(old.deleted_at, row.deleted_at);
  },
  packs(old, row) {
    for (const k of ['seq', 'card_ids', 'due_at', 'granted_at', 'created_at']) row[k] = old[k];
    row.opened_at = least(old.opened_at, row.opened_at);
  },
  collection(old, row) {
    row.created_at = old.created_at;
    if (us(row.collected_at) >= us(old.collected_at)) {
      row.collected_at = old.collected_at;
      row.drop_id = old.drop_id;
    }
  },
  badges(old, row) {
    row.created_at = old.created_at;
    row.earned_at = least(old.earned_at, row.earned_at);
  },
};

const reply = (status, body) => ({ status, json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

export function createServer() {
  const server = {
    calls: [], // upserts
    pulls: [], // GETs of the synced tables
    lookups: [], // family lookups (one per run, and one when setting up)
    familyOf: () => FAMILY, // the family a user is in now (tests change it: removed, left)
    rows: { profiles: new Map(), packs: new Map(), collection: new Map(), badges: new Map() },
    offline: false, refuse: () => false, during: null, failPull: null,
    clock: us('2026-11-04T08:00:00.000Z'),
  };
  const now = () => pg(server.clock += 1001 + (server.clock % 7)); // microseconds that aren't round

  // Put a row as the database would have it after an upsert.
  server.upsert = (table, rows) => {
    const at = now();
    for (const r of rows) {
      const row = { ...r };
      for (const k of TIMES) if (row[k] != null) row[k] = pg(us(row[k]));
      const old = server.rows[table].get(keyOf(table, row));
      if (old) {
        if (row.family_id !== old.family_id) throw new Error('family_id cannot change');
        MERGE[table](old, row);
      } else row.created_at ??= at;
      row.updated_at = at;
      server.rows[table].set(keyOf(table, row), row);
    }
  };

  function select(table, params) {
    const family = params.get('family_id')?.replace(/^eq\./, '');
    const since = params.get('updated_at')?.replace(/^gte\./, '');
    const cols = params.get('select').split(',');
    const order = KEYS[table];
    const list = [...server.rows[table].values()]
      .filter(r => r.family_id === family && (!since || us(r.updated_at) >= us(since)))
      .sort((a, b) => us(a.updated_at) - us(b.updated_at) || order.reduce((c, k) => c || (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0), 0));
    return list.slice(0, Number(params.get('limit') ?? Infinity)).map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null])));
  }

  // The auth.authFetch of a device signed in as user() (a function, so tests can change it).
  server.authFetch = async (path, init = {}) => {
    if (server.offline) throw new AuthError('offline');
    const u = new URL(path, 'https://example.supabase.co');
    const table = u.pathname.split('/').pop();
    if (table === 'family_members') {
      const userId = u.searchParams.get('user_id')?.replace(/^eq\./, '');
      server.lookups.push({ userId, search: u.search });
      return reply(200, [{ family_id: server.familyOf(userId), role: 'owner' }]);
    }
    if ((init.method ?? 'GET') === 'GET') {
      server.pulls.push({ table, search: u.search });
      if (server.failPull) return reply(server.failPull, { message: 'busy' });
      return reply(200, select(table, u.searchParams));
    }
    const body = JSON.parse(init.body);
    server.calls.push({ table, method: init.method, search: u.search, prefer: init.headers?.Prefer, body });
    if (server.during) { const fn = server.during; server.during = null; await fn(); }
    if (body.some(r => server.refuse(table, r))) return reply(409, { code: '23505', message: 'duplicate key' });
    server.upsert(table, body);
    return reply(201);
  };
  return server;
}
