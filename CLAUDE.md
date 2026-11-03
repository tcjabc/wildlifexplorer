# CLAUDE.md — standing rules for Wildlife Explorer

## PROJECT
- Wildlife Explorer / 野生動物探險家: a bilingual (English + Traditional Chinese, zh-TW) collectible wildlife card PWA for the owner's kids, inspired by the 1990s Wildlife Explorer card series.
- Vanilla JS. No framework, no analytics, no tracking, no third-party scripts or CDNs at runtime.
- Optional family accounts on Supabase (see SUPABASE). Parents sign in; kids never have accounts. The app must keep working fully without signing in.
- Master card list: `data/card-list.csv` (12 groups, defined in `data/groups.json`). Generated data: `data/animals.json`. Images: `/img` (thumbnails in `/img/thumbs`).
- Build: `npm run build` (see README). Local preview: `npm run serve` → http://localhost:8080.
- Design: all colours, sizes and fonts live in `css/tokens.css`; components in `css/app.css` use tokens only.

## GIT
- The remote is already set up (SSH alias `github.com-second`, personal account `tcjabc`). Never change the remote, git config or SSH settings.
- Commit in small, logical steps with clear messages.
- Always ask before any `git push` (also enforced in `.claude/settings.json`).
- Never force-push, rewrite history or delete branches.

## SECURITY (this repo is public)
- Never commit secrets. API keys go in `.env`, which is in `.gitignore`; `.env.example` holds placeholder names only.
- The Supabase project URL and publishable key are public by design and live only in `js/config.js`. The secret/service_role key, the database password and Supabase access tokens never go in the repo (not even in `.env.example`).
- Check staged files for secrets before every commit.
- No personal data about the family in the repo (names, photos, locations).
- Progress data stays on the device (IndexedDB). It is sent only to the family's own Supabase project, and only after a parent signs in. Height, weight, age, home country, quiz scores and Field Notes stay on the device.
- Before any family other than ours uses accounts, the app needs a privacy notice (what is stored, where, for how long, how to delete it).
- `index.html` has a Content Security Policy meta tag allowing only same-origin resources, plus `connect-src` to the Supabase project URL (nothing else).
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
- GitHub Pages at https://tcjabc.github.io/wildlifexplorer/ (a subpath).
- Relative paths everywhere: manifest `start_url` and `scope` are `"./"`; the service worker is registered at `./sw.js`.
- The service worker cache is versioned (`VERSION` in `sw.js`); bump it on every release. New files under `js/` must be added to its `SHELL` list.

## SUPABASE
- Project ref `yrgrihgmydzlxjzuoljq` (Seoul, Free plan). The GitHub integration is not connected: schema changes go through `supabase/migrations/` and `npx supabase db push`.
- Show every migration to the owner before `db push`. Never edit a migration that has been pushed; add a new one.
- "Automatically expose new tables" is off: every migration that adds a table has explicit GRANTs (nothing to `anon`) and RLS enabled with policies limited to the caller's family.
- Re-run the RLS check in `supabase/tests/` after every migration.
- Email: Supabase's built-in email (test with the owner's address only) until custom SMTP (Resend, noreply@wildfile.app) is set up.

## WORKING STYLE
- Ask before adding dependencies. Prefer none at runtime; build-script dev dependencies are fine.
- Test on a local preview before saying something is done.
- Keep explanations short and direct.
