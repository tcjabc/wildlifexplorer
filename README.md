# Wildlife Explorer · 野生動物探險家

A bilingual (English / 繁體中文) wildlife card-collecting app for kids. It's a plain
HTML/CSS/JavaScript Progressive Web App: no framework, no backend, no accounts, no analytics.
It runs on GitHub Pages and works fully offline once it has been opened.

- **Binder**: 11 coloured group tabs. Cards you haven't collected yet show as silhouettes.
- **Profiles**: a picker on every launch ("Who's exploring today?"). A profile is one person or a
  whole family; packs, binder, badges and quiz scores are per profile.
- **Packs**: a pack of 3 cards arrives every week, starting with Series 1, Week 1 when the profile
  is made. A sheet says "New pack arrived!"; packs wait in **Packs** until the child opens them.
- **Card view**: big photo (and illustration, if there is one), names, fun facts, habitat,
  IUCN conservation badge, "Found in Taiwan" badge, and a credit line you can tap.
- **Badges** for finishing a group. **Quiz**: picture → name, and true/false facts.
- **Read aloud** (Web Speech API): English in an en-GB voice, Chinese in a zh-TW voice.
- **Language**: EN / 中 / Both, per profile.
- **For grown-ups** (behind a sum): pack day and time, units, preview, start over, delete.
- Progress is kept in IndexedDB on each device. Nothing leaves the device.

## Folders

```
index.html, manifest.webmanifest, sw.js   the app shell and service worker
css/tokens.css      all colours, sizes and fonts (change the look here)
css/app.css         components, built only from tokens
css/card.css        the card viewer and the card pages
css/pack.css        foil packs for new cards
js/                 app code (app.js is the entry point, views/ has one file per screen)
lang/en.json        every UI string in English
lang/zh-TW.json     the same keys in Traditional Chinese
data/card-list.csv  THE MASTER LIST — edit this to add cards
data/groups.json    the 12 groups: id, CSV name, emoji, names
data/animals.json   the cards (generated, then hand-edited by you)
data/build-state.json   the build's memory of what it wrote (don't edit; do commit)
data/build-report.md    what needs your attention after each build
data/ranges/        range shapes made by the build (GeoJSON)
data/ranges-manual/ range shapes you draw yourself (the build never touches these)
data/locations.json Globe spots for World Explorer places and Prehistoric fossil sites
img/, img/thumbs/   card pictures (WebP, max 1200 px) and 480 px thumbnails
img/silhouettes/    animal silhouettes (SVG) for size comparisons
icons/              app icons (made by `npm run icons`)
assets/             world map (Natural Earth) and child silhouette for the card pages
assets/layers/      Globe map layers (made by scripts/make-layers.mjs; see CREDITS.md)
data-raw/           big downloaded datasets for the layers (git-ignored)
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
   - `zhuyin`: one syllable per Chinese character, separated by spaces, Taiwan (教育部) readings. First tone unmarked,
     neutral tone in front (`˙ㄉㄜ`). Shown beside the Chinese name on cards (tap the name, or set the default in More).
     The build reports a syllable count that doesn't match. Readings still to check are listed in `data/zhuyin-review.md`.
   - `name_en` becomes the card's id (`Taiwan Blue Magpie` → `taiwan-blue-magpie`). Names must be unique.

2. Run the build (below), read `data/build-report.md`, then write the facts.

The card number shown in the app (No. 001…) is the card's position in `animals.json`,
which follows the CSV order.

## Running the build script

```bash
npm run build                                   # first `limit` cards in drop order (see below)
npm run build:all                               # every row in the CSV
node scripts/build-cards.mjs --limit 60         # first 60 cards in drop order
node scripts/build-cards.mjs --only leopard-cat,koala   # just these cards
node scripts/build-cards.mjs --offline          # no network: re-merge existing cards, re-plan drops, thumbnails
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
- finds a **silhouette** on PhyloPic for the size comparison (same licence rules);
- draws **where the animal lives** as a range shape from GBIF occurrence records (`data/ranges/`, `range`, `mapBounds`).

For **topic** rows it only creates the empty card for you to fill in.

It never deletes a card: if you remove a row from the CSV, the card stays in `animals.json`
and the report lists it, so nothing you wrote is lost.

Settings live in `scripts/build.config.json`:

| Setting | Meaning |
|---|---|
| `limit` | cards processed by `npm run build`, in drop order, so the earliest packs fill first (raise it or use `--all`) |
| `image.maxSize` / `quality` | full-size image limit and WebP quality |
| `image.thumbSize` / `thumbQuality` | thumbnail size and quality |
| `image.minWidth` | skip source images narrower than this |
| `illustrationSearch` | `false` to stop searching Commons for illustrations |
| `drops.cardsPerPack` | cards in each weekly pack (3) |
| `drops.seriesCards` | cards in a series (87, so 29 weekly drops) |
| `drops.groupSizes` | how many cards of each group every series has (they must add up to `seriesCards`; frozen drops keep theirs) |
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
  "taxonomy": { "class": { "sci": "Mammalia", "en": "mammal", "zh": "哺乳動物" }, "…": "…" },
  "wikidata": "Q716455"
}
```

- **facts**: three `{ en, zh }` pairs. Empty facts are simply not shown. Short sentences
  read aloud best. For topic cards the facts appear under "About this topic 認識這個主題".
- **habitat**: one `{ en, zh }` pair. For topic cards you can leave it empty.
- **status**: an IUCN code — `EX` `EW` `CR` `EN` `VU` `NT` `LC` `DD` `NE` — or `null`.
- **photo / illustration**: to use your own picture, put it in `img/`, then fill in all five
  fields (`file`, `author`, `license`, `licenseUrl`, `sourceUrl`). The next build makes its thumbnail
  and warns you if the licence isn't one of the four allowed ones.
- If one half of a pair is missing (say, only English), the app shows the other half in every language mode.

### Your edits are safe

You can re-run the build as often as you like:

- `facts`, `habitat` and any field you add are **never** touched by the build.
- For the fields the build fills in (names, status, taxonomy, photo, illustration…),
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

### The inside and back of a card

Cards are bi-folds like the original Wildlife Explorer cards. The **cover** uses the photo,
names, the first three facts and a small map. The **inside** and **back** come from these optional
fields. Any you leave out are simply not shown, and a card with no inside fields doesn't open.

```json
"profile": {
  "image": "illustration",
  "callouts": [{ "x": 0.34, "y": 0.45, "r": 0.07, "en": "White V on the chest", "zh": "胸前的白色V字" }]
},
"stats": {
  "length": { "en": "120–180 cm", "zh": "120–180 公分", "note": { "en": "without the tail", "zh": "不含尾巴" } },
  "lengthCm": { "min": 120, "max": 180 },
  "weight": { "en": "50–200 kg", "zh": "50–200 公斤" },
  "weightKg": { "min": 50, "max": 200 },
  "lifespan": { "en": "20–30 years", "zh": "20–30 年" },
  "lifespanYears": { "min": 20, "max": 30 },
  "diet": { "en": "Omnivore: …", "zh": "雜食：…" },
  "dietIcons": ["🌰", "🍎", "🌿", "🐛", "🐭"]
},
"compare": { "width": 150 },
"lifeCycle": [{ "en": "…", "zh": "…" }],
"mapBounds": { "west": 119.8, "south": 21.9, "east": 122.3, "north": 24.8, "manual": true },
"_draft": ["facts", "stats"]
```

- **profile**: `image` is `"photo"` or `"illustration"`. Callout `x`/`y` mark the centre of the
  feature as fractions of the picture's width and height (0 = left/top, 1 = right/bottom; percent
  0–100 also works). `r` is how much the magnifier shows: the radius around the feature as a
  fraction of the picture's width (default 0.08; smaller = more zoom). The photo itself stays clean.
  Tapping a list item rings the feature and opens a round magnifier in the emptiest corner, cut
  from the full-size image; tap it again or the photo to close, or swipe the list to step through.
  The build never touches `profile`, so hand-tuned values are safe.
- **stats**: `length`, `weight`, `lifespan` and `diet` are the text shown. `lengthCm`, `weightKg` and
  `lifespanYears` are the numbers the comparisons use (the middle of `min`–`max`). If you only give
  the numbers, the text is made from them. `dietIcons` are emoji for the diet plate.
- **Creature comparison**: each statistic you can tap switches the comparison and replays its
  animation: **length** (silhouettes side by side), **weight** (a balance; the lighter side fills with
  copies until it levels out, with a counter and "= Elephant × n" for huge numbers), **lifespan**
  (birthday timelines) and **diet** (a plate filling up). "You" is 120 cm, 23 kg and 6 years old
  unless the profile has its own height, weight and age (Welcome form, or More → Edit profile).
- **compare**: how big the animal's silhouette is in cm, either `width` (nose to tail tip) or
  `height`. Leave it out to use `lengthCm`. The silhouette itself is found by the build (from
  PhyloPic, CC0/PD/CC BY/CC BY-SA only) and stored in `silhouette`. If there is none for the exact
  species, a related animal's is used and the report says so.
- **range** / **mapBounds**: where the animal lives, drawn as a soft filled shape in the group's
  colour. The build makes the shape from GBIF occurrence records and saves it as small GeoJSON in
  `data/ranges/<id>.json` (`range` points to it); `mapBounds` is the area the map zooms to.
  How the shape is made:
  - Wild sightings are used, spread across countries; museum specimens are used only for
    little-recorded species. CC0/CC BY records are used when there are enough; otherwise all
    records, but only the generalised shape is kept, never the records.
  - The records are binned into a grid, isolated cells are dropped, small gaps are closed, and
    the shape is buffered, smoothed and simplified.
  - It is clipped to land or to sea (Natural Earth coastlines, public domain), depending on where
    most records are. Islands the range mostly covers are filled with the real coastline, so a
    Taiwan endemic fills Taiwan.
  - IUCN range maps are never used (their licence doesn't allow it).
  - Small ranges zoom right in, with a little world map in the corner and a marker.
  To draw a range yourself, save GeoJSON as `data/ranges-manual/<id>.json`: the build uses it
  and never touches it. To set the zoom yourself, write `mapBounds` with `"manual": true`.
- **map** (optional, older): extra dots `{ "areas": [{ "lon": 121, "lat": 23.7 }] }`.
- **_draft**: fields written as a starting point (e.g. by Claude) that still need checking. They are
  listed in the build report. Remove a name once you're happy with it.

The world map (`assets/world.svg`) is drawn from Natural Earth's 1:50m land (public domain) by
`node scripts/make-map.mjs`. You only need to run that again if you want a different map.

### Where a card sits on the Globe

The Globe tab shows every collected card as a photo pin. The first of these that a card has wins:

- **pin** `{ "lat": 23.5, "lng": 121 }`: your own spot, for any card.
- **fossilSite** `{ "lat", "lng", "site" }`: Prehistoric cards, a famous fossil site.
- **place** `{ "lat", "lng", "site" }`: World Explorer cards, the place itself.
- **range**: species are pinned in the middle of their range shape (the biggest part of it).

Cards with none of these (topics, most microscopic life) are left off. The build fills in
`fossilSite` and `place` from `data/locations.json` (keyed by card id); like every build field,
if you change them in `animals.json` your values are kept. The globe's land
(`assets/globe.json`) is made by `node scripts/make-globe.mjs`: simplified coastlines for the
whole-globe view, full 1:50m detail when zoomed in.

### Globe map layers

The chips along the top of the Globe switch on one map layer at a time: 🏔️ topography,
🌳 forests, 🪸 coral reefs, 🌙 day & night (live, from the device clock), 🌡️ temperature
(with a month slider) and 🌊 ocean depth. Each has a small legend. Taiwan's outline glows
above every layer.

- Picture layers (topography, night lights, temperature) are drawn with WebGL 2 by
  `js/globegl.js`, on a canvas between the land and the pins. It is only created when such
  a layer is first switched on. Shape layers (forests, depth, reefs) are drawn like the land.
- Phones load 2048×1024 pictures, tablets and computers 4096×2048.
- Nothing is downloaded until a layer is first switched on; the service worker then keeps it
  (`layers-…` cache), so it works offline from then on.
- To rebuild the files: `node scripts/make-layers.mjs` (all) or name some, e.g.
  `node scripts/make-layers.mjs temp depth`. It downloads the raw datasets into `data-raw/`
  the first time (about 300 MB), needs only Node (sharp and mapshaper), and writes
  `assets/layers/` and `assets/home.json`. After re-running it, bump `LAYERS_VERSION` in `sw.js`.
- Colours live in `css/tokens.css` (`--c-depth-*`, `--c-forest-*`, `--c-temp-scale` …). The
  temperature pictures are painted with `--c-temp-scale`, so re-run `make-layers.mjs temp` if you change it.
- Sources and licences: [CREDITS.md](CREDITS.md).

In the app, children open a card by dragging the cover's right edge, like turning a page.
Swipe up to turn the card over, and swipe down to put it back in the binder.

## Packs and drops

**The plan** (`data/drops.json`, written by the build) is the same for every profile. A **series**
has 87 cards in 29 weekly **drops** of 3, with the same number of cards from each group every
series (`drops.groupSizes` in `build.config.json`). No drop ever has two cards from the same
group, and every group is spread evenly over the series (mammals and birds come most weeks, the
smaller groups every five or six weeks); the build stops with a message saying which setting to
change if that becomes impossible. Rows fill the slots of their group in `card-list.csv` order.
A slot with no row for it yet is planned as `"id": null`, and nothing is borrowed from another group.

**Frozen drops**: as soon as every slot of a drop has a card, the build writes it to
`data/drops.lock.json` and never changes it again: editing, inserting or removing CSV rows, or
changing `groupSizes`, only re-plans the drops that aren't frozen yet. The build warns when a
change would have affected a frozen drop (a frozen card removed from the CSV or moved to another
group, a new row added above frozen ones, a size change that no longer fits a frozen week).

**Ready**: a drop arrives only when all its cards are built **and their 3 facts are written in
English and Chinese** (and not still marked as a draft in `_draft`). An empty topic slot doesn't
count. `data/build-report.md` shows Series 1 week by week, which drops are ready, and what each
card still needs.

**Each profile's timeline**: Series 1, Week 1 arrives the moment the profile is made; after that
one drop a week on the profile's pack day and time (Parents area), with one week off between
series (kept free for a "Series complete" celebration later). The order is the same for everyone;
only the dates differ.

- Each drop is granted **once per profile**: the pack's id is profile + drop id, and it is written
  with an add that fails if it already exists, so reloads, two tabs or a repeated check can't
  grant or open it again.
- A drop whose cards aren't all ready yet **waits** (and the ones after it wait too). Once they
  are, it arrives, and any later drops that are already due catch up straight away.
- Packs are never opened for the child. A "New pack arrived!" sheet (Open now / Later) is shown
  once per pack; unopened packs wait in **Packs** for as long as the child likes, and always open
  **oldest first**.
- Opening: swipe across the top to cut the pack (or tap "Tap to open"). The cards are collected at
  that moment. Then flick each card up into the binder (or tap "Next card"), and see all three at
  the end. Completing every card in a group earns that group's badge.

**For grown-ups**: More → "For grown-ups" (answer the sum). Settings are per profile: pack day and
time, metric/imperial, °C/°F, *Show all cards (preview)* (shows every card without counting them as
collected, handy for checking your facts), edit, *Start over from Series 1, Week 1*, and delete.
A new profile copies the pack day/time and units of the existing ones. To add a setting, add a
section to `SECTIONS` in `js/views/parents.js`.

**Stored on the device** (IndexedDB, see `js/db.js`): `profiles`, `packs`, `collection`,
`badges` and `quiz`, each record with an id and `createdAt` / `updatedAt` / `deletedAt`, ready
to sync to a server later. Height and weight are stored in cm and kg whatever the units. Progress
from the version before profiles moves into the first profile.

## Language and read-aloud

- All UI text is in `lang/en.json` and `lang/zh-TW.json` (same keys). `{n}`-style placeholders are filled in by the app.
- The language choice (EN / 中 / Both) is stored with each profile.
- Read-aloud uses the device's own voices. On iPad, voices can be added under
  Settings → Accessibility → Spoken Content → Voices (English (UK), Chinese (Taiwan)).
  In Both mode the English is read first, then the Chinese.

## Offline and updates

`sw.js` caches the app, the data and every card image (full size and thumbnail) on first visit.
App files and data are fetched fresh when online (falling back to the cache after 3 s or when
offline); images are served from the cache first, because their file names change whenever the picture changes.

After you push an update, an open app picks it up on its next launch. If something looks stuck,
bump `VERSION` in `sw.js`; that clears the old caches (except the Globe map layers, which have their own `LAYERS_VERSION`). If you add or rename a file under `js/`,
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

All colours, sizes, fonts and the 12 group colours are tokens in `css/tokens.css`
(`--g-mammals`, `--g-mammals-ink`, …; the `-ink` colour is the text colour on that group's colour).
`css/app.css` only uses those tokens, so change values there rather than in components.
The icon is drawn in `scripts/make-icons.mjs`; run `npm run icons` after changing it.

## Credits

Names, classification and conservation status: [Wikidata](https://www.wikidata.org/) (CC0).
Pictures: [Wikimedia Commons](https://commons.wikimedia.org/) and [iNaturalist](https://www.inaturalist.org/)
contributors. Every picture's author, licence and source are listed in the app under More → Picture credits.
Map and Globe layer datasets: [CREDITS.md](CREDITS.md).
