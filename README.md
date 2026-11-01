# Wildlife Explorer · 野生動物探險家

A bilingual (English / 繁體中文) wildlife card-collecting app for kids. It's a plain
HTML/CSS/JavaScript Progressive Web App: no framework, no backend, no accounts, no analytics.
It runs on GitHub Pages and works fully offline once it has been opened.

- **Binder**: 11 coloured group tabs. Cards you haven't collected yet show as silhouettes.
- **New cards** arrive on their `unlockDate` with a "New card arrived! 新卡片來了！" reveal.
- **Card view**: big photo (and illustration, if there is one), names, fun facts, habitat,
  IUCN conservation badge, "Found in Taiwan" badge, and a credit line you can tap.
- **Badges** for finishing a group. **Quiz**: picture → name, and true/false facts.
- **Read aloud** (Web Speech API): English in an en-GB voice, Chinese in a zh-TW voice.
- **Language**: EN / 中 / Both (default Both), remembered on the device.
- Progress is kept in IndexedDB on each device. Nothing leaves the device.

## Folders

```
index.html, manifest.webmanifest, sw.js   the app shell and service worker
css/tokens.css      all colours, sizes and fonts (change the look here)
css/app.css         components, built only from tokens
js/                 app code (app.js is the entry point, views/ has one file per screen)
lang/en.json        every UI string in English
lang/zh-TW.json     the same keys in Traditional Chinese
data/card-list.csv  THE MASTER LIST — edit this to add cards
data/groups.json    the 11 groups: id, CSV name, emoji, names
data/animals.json   the cards (generated, then hand-edited by you)
data/build-state.json   the build's memory of what it wrote (don't edit; do commit)
data/build-report.md    what needs your attention after each build
img/, img/thumbs/   card pictures (WebP, max 1200 px) and 480 px thumbnails
icons/              app icons (made by `npm run icons`)
scripts/            the build script and helpers (run on your computer only)
```

## Setup (once)

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
```

This installs `sharp`, which the build script uses to resize images. Nothing from
`node_modules` is used by the app itself.

## Try it locally

```bash
npm run serve
```

Then open http://localhost:8080. (Opening `index.html` straight from disk won't work:
service workers need `localhost` or `https`.)

## Adding cards

1. Add a row to `data/card-list.csv`:

   ```csv
   group,name_en,name_zh,scientific_name,taiwan
   Birds,Taiwan Blue Magpie,臺灣藍鵲,Urocissa caerulea,Y
   World Explorer,Yushan,玉山,,Y
   ```

   - `group` must match a `csv` value in `data/groups.json` exactly.
   - `scientific_name` filled in → a **species card**: the build looks it up for you.
   - `scientific_name` empty → a **topic card** (behaviour, places, conservation…): you write it all by hand.
   - `taiwan`: `Y` shows the "Found in Taiwan 臺灣在地" badge.
   - `name_en` becomes the card's id (`Taiwan Blue Magpie` → `taiwan-blue-magpie`). Names must be unique.

2. Run the build (below), read `data/build-report.md`, then write the facts.

The card number shown in the app (No. 001…) is the card's position in `animals.json`,
which follows the CSV order.

## Running the build script

```bash
npm run build                                   # first `limit` rows (20 for now, see below)
npm run build:all                               # every row in the CSV
node scripts/build-cards.mjs --limit 60         # first 60 rows
node scripts/build-cards.mjs --only leopard-cat,koala   # just these cards
node scripts/build-cards.mjs --offline          # no network: re-merge, re-date, make thumbnails
node scripts/build-cards.mjs --prune            # also delete images no card uses any more
```

For each **species** row the build:

- finds the species on **Wikidata** by scientific name and takes its classification
  (class/order/family, with Chinese names where Wikidata has them) and IUCN status. A
  subspecies with no assessment of its own gets its parent species' status (noted in the report);
- checks your Chinese name against Wikidata's zh-TW label and reports differences
  (台/臺 differences are ignored). If your `name_zh` is empty it fills in Wikidata's and flags it;
- picks a **photo**: Wikidata's main image on Wikimedia Commons if it is a photo, otherwise
  the most-faved research-grade **iNaturalist** photo;
- picks an optional **illustration**: an old natural-history plate or drawing from Commons;
- **only accepts Public Domain, CC0, CC BY or CC BY-SA**. Anything NC or ND, or with a licence
  it can't identify, is skipped. iNaturalist is queried with `photo_license=cc0,cc-by,cc-by-sa`
  and each photo's licence is checked again;
- downloads the image, resizes it to max 1200 px and saves it as WebP in `img/`, plus a
  480 px thumbnail in `img/thumbs/`, and records `file`, `author`, `license`, `licenseUrl`
  and `sourceUrl`.

For **topic** rows it only creates the empty card for you to fill in.

It never deletes a card: if you remove a row from the CSV, the card stays in `animals.json`
and the report lists it, so nothing you wrote is lost.

Settings live in `scripts/build.config.json`:

| Setting | Meaning |
|---|---|
| `limit` | rows processed by `npm run build` (20 while testing; raise it or use `--all`) |
| `image.maxSize` / `quality` | full-size image limit and WebP quality |
| `image.thumbSize` / `thumbQuality` | thumbnail size and quality |
| `image.minWidth` | skip source images narrower than this |
| `illustrationSearch` | `false` to stop searching Commons for illustrations |
| `unlock.start` | the date the first cards arrive |
| `unlock.initial` | how many cards are already there on that day |
| `unlock.everyDays` | days between each new card after that |
| `userAgent` | identifies the script to Wikimedia/iNaturalist (please keep a contact URL in it) |

### After a build: check the report

`data/build-report.md` lists, card by card:

- Chinese names that differ from Wikidata, or are missing;
- species with no IUCN status;
- cards with no photo (add one by hand) or a photo with an unknown author;
- **illustrations found by search — always look at these**, the search can pick an odd picture.
  If it's good, add `"illustration"` to the card's `"locked"` list (see below) to keep it and stop the reminder;
- topic cards that still need everything;
- image files no card uses any more.

## Writing facts (editing `data/animals.json`)

Each card looks like this:

```json
{
  "id": "formosan-black-bear",
  "group": "mammals",
  "scientificName": "Ursus thibetanus formosanus",
  "name": { "en": "Formosan Black Bear", "zh": "臺灣黑熊" },
  "facts": [
    { "en": "It has a white V-shaped mark on its chest.", "zh": "牠的胸前有白色的V字形斑紋。" },
    { "en": "", "zh": "" },
    { "en": "", "zh": "" }
  ],
  "habitat": { "en": "Mountain forests all over Taiwan.", "zh": "臺灣各地的山區森林。" },
  "status": "VU",
  "taiwan": true,
  "photo": { "file": "img/…webp", "author": "…", "license": "CC BY-SA 3.0", "licenseUrl": "…", "sourceUrl": "…" },
  "illustration": null,
  "unlockDate": "2026-11-01",
  "taxonomy": { "class": { "sci": "Mammalia", "en": "mammal", "zh": "哺乳動物" }, "…": "…" },
  "wikidata": "Q716455"
}
```

- **facts**: three `{ en, zh }` pairs. Empty facts are simply not shown. Short sentences
  read aloud best. For topic cards the facts appear under "About this topic 認識這個主題".
- **habitat**: one `{ en, zh }` pair. For topic cards you can leave it empty.
- **status**: an IUCN code — `EX` `EW` `CR` `EN` `VU` `NT` `LC` `DD` `NE` — or `null`.
- **unlockDate**: `YYYY-MM-DD`, the local day the card arrives. Change it to reschedule a card.
- **photo / illustration**: to use your own picture, put it in `img/`, then fill in all five
  fields (`file`, `author`, `license`, `licenseUrl`, `sourceUrl`). The next build makes its thumbnail
  and warns you if the licence isn't one of the four allowed ones.
- If one half of a pair is missing (say, only English), the app shows the other half in every language mode.

### Your edits are safe

You can re-run the build as often as you like:

- `facts`, `habitat` and any field you add are **never** touched by the build.
- For the fields the build fills in (names, status, taxonomy, photo, illustration, unlockDate…),
  `data/build-state.json` remembers what the build wrote last time. If the value in
  `animals.json` is different, you changed it, so the build leaves it alone (the report says
  "Kept your edit of …").
- To freeze a field even if it is empty — for example "no illustration on this card, please" —
  list it in `locked`:

  ```json
  "illustration": null,
  "locked": ["illustration"]
  ```

Commit `data/build-state.json` along with `animals.json`. If it is ever lost, the build treats
every field that already has a value as yours and leaves it alone.

## How unlocking works

The build gives every card an `unlockDate`. Cards are dealt **round-robin across the groups**
(one mammal, one bird, one reptile…) so new arrivals rotate through the binder, and the dates
are worked out over the whole CSV so they don't move when you process more rows later.
With the current settings, the first 12 cards in that order arrive on 2026-11-01 and then
one new card arrives each day.

When the app opens (or comes back to the front) it shows a reveal for every card whose date has
passed and that hasn't been revealed on this device yet. Revealed = collected. Completing every
card in a group earns that group's badge.

**For grown-ups**: More → "For grown-ups" (answer the sum) has
*Show all cards (preview)* — shows every card without counting them as collected, handy for checking
your facts — and *Reset all progress*.

## Language and read-aloud

- All UI text is in `lang/en.json` and `lang/zh-TW.json` (same keys). `{n}`-style placeholders are filled in by the app.
- The language choice (EN / 中 / Both) is stored in IndexedDB on the device.
- Read-aloud uses the device's own voices. On iPad, voices can be added under
  Settings → Accessibility → Spoken Content → Voices (English (UK), Chinese (Taiwan)).
  In Both mode the English is read first, then the Chinese.

## Offline and updates

`sw.js` caches the app, the data and every card image (full size and thumbnail) on first visit.
App files and data are fetched fresh when online (falling back to the cache after 3 s or when
offline); images are served from the cache first, because their file names change whenever the picture changes.

After you push an update, an open app picks it up on its next launch. If something looks stuck,
bump `VERSION` in `sw.js`; that clears the old caches. If you add or rename a file under `js/`,
add it to the `SHELL` list in `sw.js` too.

## Publishing on GitHub Pages

1. Commit everything (including `img/`, `data/animals.json` and `data/build-state.json`) and push.
2. In the repo on GitHub: Settings → Pages → Build and deployment → Source: *Deploy from a branch*,
   Branch: `main`, folder `/ (root)`.
3. The app will be at `https://<user>.github.io/<repo>/`. All paths are relative, so any repo name works.
   The `.nojekyll` file tells GitHub Pages to serve the files as they are.

To install on a tablet: open the site, then Share → *Add to Home Screen* (iPad) or the ⋮ menu →
*Install app* (Android Chrome).

## Changing the look

All colours, sizes, fonts and the 11 group colours are tokens in `css/tokens.css`
(`--g-mammals`, `--g-mammals-ink`, …; the `-ink` colour is the text colour on that group's colour).
`css/app.css` only uses those tokens, so change values there rather than in components.
The icon is drawn in `scripts/make-icons.mjs`; run `npm run icons` after changing it.

## Credits

Names, classification and conservation status: [Wikidata](https://www.wikidata.org/) (CC0).
Pictures: [Wikimedia Commons](https://commons.wikimedia.org/) and [iNaturalist](https://www.inaturalist.org/)
contributors. Every picture's author, licence and source are listed in the app under More → Picture credits.
