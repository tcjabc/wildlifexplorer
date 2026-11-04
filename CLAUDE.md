# CLAUDE.md — standing rules for WildFile

## PROJECT
- WildFile (the same name in both languages; Chinese subtitle "WildFile 動物圖鑑", still to be confirmed): a bilingual (English + Traditional Chinese, zh-TW) collectible wildlife card PWA for the owner's kids, inspired by the 1990s Wildlife Explorer card series.
- The name lives in `lang/*.json` (`app.title`, `app.subtitle`), plus the copies that can't read it: `manifest.webmanifest` (`name`, `short_name`), `index.html` (`<title>`, `apple-mobile-web-app-title`) and the Supabase email templates. Change them together.
- Vanilla JS. No framework, no analytics, no tracking, no third-party scripts or CDNs at runtime.
- Optional family accounts on Supabase (see SUPABASE). Parents sign in; kids never have accounts. The app must keep working fully without signing in.
- Master card list: `data/card-list.csv` (12 groups, defined in `data/groups.json`). Generated data: `data/animals.json`. Images: `/img` (thumbnails in `/img/thumbs`).
- Build: `npm run build` (see README). Local preview: `npm run serve` → http://localhost:8080.
- Design: all colours, sizes and fonts live in `css/tokens.css`; components in `css/app.css` use tokens only.

## GIT
- The remote is already set up (SSH alias `github.com-second`, personal account `tcjabc`). Never change the remote, git config or SSH settings.
- Commit in small, logical steps with clear messages.
- Always ask before any `git push` (also enforced in `.claude/settings.json`).
- Before every push, run `git fetch` and list `git log origin/main..HEAD` in the push report: every commit that would go out. Push only commits the owner has approved. If the list holds any other commit (for example one made in another session), stop and ask; never push it along.
- Never force-push, rewrite history or delete branches.

## SECURITY (this repo is public)
- Never commit secrets. API keys go in `.env`, which is in `.gitignore`; `.env.example` holds placeholder names only.
- The Supabase project URL and publishable key are public by design and live only in `js/config.js`. The secret/service_role key, the database password and Supabase access tokens never go in the repo (not even in `.env.example`).
- Check staged files for secrets before every commit.
- No personal data about the family in the repo (names, photos, locations).
- Progress data stays on the device (IndexedDB). It is sent only to the family's own Supabase project, and only after a parent signs in. Height, weight, age, home country, quiz scores and Field Notes stay on the device.
- Before any family other than ours uses accounts, the app needs a privacy notice (what is stored, where, for how long, how to delete it).
- `index.html` has a Content Security Policy meta tag allowing only same-origin resources, plus `connect-src` to the Supabase project URL (nothing else). The same CSP is sent as an HTTP header on wildfile.app (see DEPLOYMENT).
- Escape or sanitise any text inserted into the DOM. Never use `innerHTML` with data from JSON or external sources.

## CONTENT & LICENSING
- Images and sounds: ONLY Public Domain, CC0, CC BY or CC BY-SA. Never NC or ND.
- Every image/sound stores `author`, `license` and `sourceUrl` (plus `licenseUrl`); all are shown on the Credits page.
- Keep photo and illustration as separate files; never merge differently licensed images into one file.
- Never overwrite facts or fields written by hand in `animals.json` when re-running the build script (see `scripts/lib/merge.mjs` and `data/build-state.json`).
- Kid-appropriate content only. Flag anything graphic (predation, injury) for the owner's review.

## BILINGUAL
- All UI strings live in `lang/en.json` and `lang/zh-TW.json` (same keys). Never hard-code text.
- Use Traditional Chinese (Taiwan) terms, never Simplified.
- Flag any missing or uncertain Chinese names so the owner's wife can check them.

## DEPLOYMENT
- https://wildfile.app/ on Cloudflare Workers (static assets only, `wrangler.jsonc`). Workers Builds deploys every push to `main`, so a push is a release. `workers_dev` and preview URLs stay off: wildfile.app is the only address.
- What's published is `dist/`, built by `npm run site` (`scripts/build-site.mjs`) from an allow-list. A new top-level file or folder the app loads must be added to `ALLOW` there. Never publish the repo root.
- HTTP headers come from `dist/_headers`, written by the build script; its CSP is the one in `index.html` plus `frame-ancestors 'none'`. Change the CSP in `index.html` only.
- Relative paths everywhere: manifest `start_url` and `scope` are `"./"`; the service worker is registered at `./sw.js`. The page is cached as `./`, never `index.html` (Cloudflare redirects `/index.html` to `/`).
- The service worker cache is versioned (`VERSION` in `sw.js`); bump it on every release. New files under `js/` must be added to its `SHELL` list (the site build fails otherwise).

## LOCAL DATABASE
- IndexedDB schema and upgrades live in `js/db.js` (`VERSION`). An upgrade runs entirely inside the upgrade transaction, so an interrupted one leaves the old version untouched. Test every upgrade on realistic old data (see `tests/fixtures/v3.mjs`).
- Version 5 added the `outbox` store: every write to a synced store (`SYNCED` in `db.js`) also puts an outbox entry in the same transaction; `js/cloud/sync.js` sends them. What may leave the device is the allow-list in `toRow` there.
- Version 4 added the `v3backup` store: the version 3 `collection` and `badges` records, kept verbatim as a safety net. Remove it in a later DB version, once sync has been stable for a while.

## SUPABASE
- Project ref `yrgrihgmydzlxjzuoljq` (Seoul, Free plan). The GitHub integration is not connected: schema changes go through `supabase/migrations/` and `npx supabase db push`.
- Show every migration to the owner before `db push`. Never edit a migration that has been pushed; add a new one.
- "Automatically expose new tables" is off: every migration that adds a table has explicit GRANTs (nothing to `anon`) and RLS enabled with policies limited to the caller's family.
- Pulled rows are merged by `js/cloud/merge.js` with the same rules as the merge triggers in `supabase/migrations/`; the fake server in `tests/fixtures/server.mjs` copies them too. Change all three together.
- Settings conflicts are decided by device clocks (`client_updated_at`), so a device with a badly wrong clock can win. Accepted for now.
- Re-run the RLS check after every migration: `npx supabase db query --remote -f supabase/tests/rls_check.sql`. CLI 3 targets a local stack by default; always pass `--remote`.
- Auth email goes out through custom SMTP (Resend, from noreply@wildfile.app). Until accounts are opened to other families, test sign-in with the owner's address only.

## WORKING STYLE
- Ask before adding dependencies. Prefer none at runtime; build-script dev dependencies are fine.
- Test on a local preview before saying something is done.
- Keep explanations short and direct.
