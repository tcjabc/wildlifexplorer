# WildFile

Chinese subtitle: WildFile 動物圖鑑 (to be confirmed). The app was called Wildlife Explorer / 野生動物探險家 before.

A bilingual (English / 繁體中文) wildlife card-collecting app for kids. It's a plain
HTML/CSS/JavaScript Progressive Web App: no framework, no analytics, no tracking.
It runs at https://wildfile.app/ (Cloudflare) and works fully offline once it has been opened. Family accounts
(Supabase) are optional and being added; see [Family accounts](#family-accounts-supabase).

- **Binder**: 11 coloured group tabs. Cards you haven't collected yet show as silhouettes.
- **Profiles**: a picker on every launch ("Who's exploring today?"). A profile is one person or a
  whole family; packs, binder, badges and quiz scores are per profile.
- **Packs**: a pack of 3 cards arrives every week, starting with Series 1, Week 1 when the profile
  is made. A sheet says "New pack arrived!"; packs wait in **Packs** until the child opens them.
- **Card view**: the camera zooms from the binder onto a wooden desk, with the card filling the page.
  Open it and one large stage sits beside a fixed grid of eight picture headings, the same on every
  card, so children who can't read yet learn them. Tapping a heading shows its text and switches the
  stage to match. The only thing on a card that speaks is the 🔊 button, which says its name.
- **Badges**: for finishing a group, Bronze/Silver/Gold for continents and habitats, and secret
  badges. **Quiz**: picture → name, and true/false facts.
- **Creature comparison**, on the whole stage: You (the animal against your own size, or a grown-up,
  a cat or a car) or Animal (lookalikes side by side, with how
  to tell them apart). **Globe**: filter the pins by continent or habitat, or hide
  them all with the paw button to see the map on its own.
- **Field Notes**: a researcher's notebook per profile. Draw with a pencil, pen and highlighter
  (pen pressure and palm rejection), rule straight lines, write, stamp collected animals, roll
  footprints and tape in photos, in the notebook beside every card or on its own page. Back it up
  to a zip.
- **Read aloud** (Web Speech API): English in an en-GB voice, Chinese in a zh-TW voice.
- **Language**: EN / 中 / Both, per profile.
- **For grown-ups** (behind a times-table question): pack day and time, units, preview, start over, delete.
- Progress is kept in IndexedDB on each device. Without signing in, nothing leaves the device.

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
data/groups.json    the 12 groups: id, CSV name, emoji, names, stampable (groups of living things)
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
supabase/           family accounts: CLI config, migrations/ (the schema), tests/ (RLS check)
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

On a tablet on the same Wi-Fi, open http://<this computer's address>:8080 (Windows may ask to
let Node through the firewall). It works without the service worker there (plain `http` on a
network address isn't a secure context), so nothing is kept offline.

**Touch tests.** `tests/touch.test.mjs` runs the gesture code (`js/gesture.js`) in WebKit with an
iPad profile and in Chromium, using Playwright (a dev dependency, never part of the app). It
needs the browsers once: `npx playwright install webkit chromium`; without them those tests are
skipped. A touch pointer is captured by the element touched (implicit capture); when a drag takes
it over, that element's `lostpointercapture` must not end the drag, and the click after any drag
must not count as a tap (on iPad, drags used to act like taps).

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
     neutral tone in front (`˙ㄉㄜ`). Shown beside the Chinese name on cards (tap the name, or set the default in the Parents area).
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

- missing Chinese names (a name that differs from Wikidata is kept, and Wikidata's is stored as `name.zhAlt`);
- species with no IUCN status;
- cards with no photo (add one by hand) or a photo with an unknown author;
- **illustrations found by search — always look at these**, the search can pick an odd picture.
  If it's good, add `"illustration"` to the card's `"locked"` list (see below) to keep it and stop the reminder;
- topic cards that still need everything;
- **Needs illustration**: cards with an empty illustration slot, in drop order (for your own sketches);
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
  "factFile": {
    "habitat": [{ "en": "Mountain forests all over Taiwan.", "zh": "臺灣各地的山區森林。" }],
    "breeding": [{ "en": "", "zh": "" }],
    "behaviour": [{ "en": "", "zh": "" }],
    "foodAndHunting": [{ "en": "", "zh": "" }],
    "conservation": [{ "en": "", "zh": "" }],
    "didYouKnow": [{ "en": "", "zh": "" }]
  },
  "status": "VU",
  "taiwan": true,
  "photo": { "file": "img/…webp", "author": "…", "license": "CC BY-SA 3.0", "licenseUrl": "…", "sourceUrl": "…" },
  "illustration": null,
  "taxonomy": { "class": { "sci": "Mammalia", "en": "mammal", "zh": "哺乳動物" }, "…": "…" },
  "wikidata": "Q716455"
}
```

- **facts**: three `{ en, zh }` pairs. Empty facts are simply not shown. Short sentences
  read aloud best. For topic cards the facts appear under "About this topic 認識這個主題" on the
  cover, and under the headings inside (`factHeadings`).
- **factHeadings**: on a topic card, the heading each fact goes under, in order, for example
  `["what", "wow", "who"]`. Written by hand; the build never touches it. Without it: What, Wow, Did you
  know. See "Inside a card".
- **factFile**: the text under a card's headings, written for older kids (pre-teen) with real
  vocabulary. Each section (`habitat`, `breeding`, `behaviour`, `foodAndHunting`, `conservation`)
  is a list of short paragraphs, each one `{ en, zh }` pair; `didYouKnow` is a list of 1–2 pairs.
  A heading with nothing to show is greyed out. Empty slots are not shown, and the build report lists them under "Still to
  write". Topic cards have no `factFile`.
  - **todo**: a paragraph (or `stats.development` / `stats.youngCount`) with `"todo": "what to
    check, and the source tried"` has not been confirmed. Only grown-ups in preview see it, marked
    with a dashed line; the build report lists every todo. Delete the key once it is checked.
  - **Glossary terms**: mark a term inline as `[[omnivore]]` (shown as written) or
    `[[omnivore|omnivores]]` (the entry, shown as other words); Chinese always gives the words:
    `[[omnivore|雜食性動物]]`. Entries live in `data/glossary.json` (term and kid-friendly definition,
    in both languages). Tapping a term opens a small popover; an id that isn't there is plain text.
    `npm test` fails on missing entries, and the build report lists missing and unused ones.
- **labelTone**: written by the build, `"light"` or `"dark"`: the photo corner under a tile's
  country label (🇹🇼, "TW" where there is no flag emoji) is light or dark. The label always sits on
  a small translucent pill: white with near-black text on a light corner, dark with white text on a
  dark one. Recomputed on every build from the tile's thumbnail (`scripts/lib/label-tone.mjs`);
  list it in `locked` to set it by hand. The build report checks the text against the pill over
  every pixel of the corner and lists any busy corners.
- **_sources**: where the `factFile`'s facts come from (`[{ "title", "url" }]`), next to `_draft`. A size
  or weight names the number it backs with `"for": ["stats.weightKg"]`.
- **status**: an IUCN code — `EX` `EW` `CR` `EN` `VU` `NT` `LC` `DD` `NE` — or `null`.
- **photo / illustration**: to use your own picture, put it in `img/`, then fill in all five
  fields (`file`, `author`, `license`, `licenseUrl`, `sourceUrl`). The next build makes its thumbnail
  and warns you if the licence isn't one of the four allowed ones.
- If one half of a pair is missing (say, only English), the app shows the other half in every language mode.

### Your edits are safe

You can re-run the build as often as you like:

- `facts`, `factFile` and any field you add are **never** touched by the build. (Older cards with
  `habitat` and `lifeCycle` are moved into `factFile` word for word: `scripts/lib/card-schema.mjs`.)
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

### Inside a card

A card has two faces, the same size: the **front**, to explore, for children who can't read yet, and
the **back**, the Fact File, for readers and grown-ups. Pages are laid out at design size 448 × 560
(4:5), scaled as a whole, wider or taller where the space is (`openLayout` in `js/card-layout.js`).

- **The front** (`js/card-open.js`): the group, number and series, a large **stage**, and under it a
  fixed 4 × 2 grid of heading buttons with their names. Nothing to read. Tapping a heading lights it
  and switches the stage, without a sound; a heading a card has nothing for is grey, never missing,
  so nothing ever moves. Buttons never go under 64 px on the screen (`--tap-heading`).
- **The back** (`js/fact-back.js`), laid out like a printed card back: 📁 Fact File with the series
  and card number, the card's name and Latin name, a **Vital Statistics** box (the numbers, and the Key
  Features: the first three facts), **Where in the World** (the map, which opens the globe, with the
  IUCN status and "Found in Taiwan"), then the grid's headings in the grid's order, each with its icon
  and colour as a small marker and its full text. Headings with nothing to read are left out
  (`backSections` in `js/headings.js`): Size is the statistics box, Where lists the continents, a topic
  card's Who to look for names its animals. No speech; it scrolls inside the card. Text still to
  check (`todo`) shows only to a grown-up in preview.
- **Side by side** where there is room for two pages (landscape): front and back always both there,
  the same height. A heading tapped on the front also brings its section into view on the back, marked.
- **One page** where there isn't (portrait, a phone, beside the expanded notebook): the card turns over
  between front and back (swipe up or down, or 🔄), with the lit heading's section in view.
- The lit heading tapped again goes back to the gallery, in both.
- Pack reveals still show the old cover (`coverPage` in `js/cardparts.js`).

Every card has the same grid (`js/headings.js`, tested on every card in `tests/headings.test.mjs`):

| Place | Species cards | Stage | Topic cards | Stage |
|---|---|---|---|---|
| 1 | 🏠 Habitat | photo | ❓ What is it? | photo |
| 2 | 🍃 Food & Hunting | diet plate, or photo | How it works (a gear) | photo |
| 3 | 🥚 Babies | photo | 👀 Who to look for | `related` cards, or photo |
| 4 | 🐾 Behaviour | the Profile magnifier, or photo | 🕒 When | photo |
| 5 | 📏 Size | creature comparison | ⭐ Wow! | photo |
| 6 | 🌍 Where in the World | map | 🌍 Where | map |
| 7 | ❤️ Status | Red List scale | ❤️ How we help | photo |
| 8 | 💡 Did You Know? | photo | 💡 Did you know | photo |

Topic cards are the four groups Exploring Behavior, World Explorer, Conservation Issues and How Animals
Work. Their text is their `facts`, sorted by `factHeadings`. The map shows the range if there is one,
otherwise a pin on the card's `place`, otherwise its `continents` lit up (`js/continents.js`).

**A card's own stage**: `"stage": { "food": "profile" }` makes a heading show another view, if the card
can. **A new kind of view** (a Stepper, say) is three small steps, listed at the top of `js/headings.js`:
a line in `VIEW_HAS`, a builder in `STAGE_VIEWS` (`js/stage-views.js`), and its name in a heading's
`views` or a card's `stage`.

**An animal's call**: `"call": { "file": "audio/calls/formosan-black-bear.m4a", "author": …, "license": …,
"licenseUrl": …, "sourceUrl": … }` plays when the gallery on the stage is tapped. No card has one
yet. Before the first one: add `audio` to `ALLOW` in `scripts/build-site.mjs` and decide how the service
worker keeps them. Mono AAC `.m4a`, 3–6 seconds, about 64 kbps, under 60 KB, at similar loudness.

**A heading's narration**: `"narration": { "habitat": { "en": "audio/narration/bear-habitat-en.m4a", "zh":
"audio/narration/bear-habitat-zh.m4a" } }` plays that recording when the heading is tapped, in the
explorer's language (Both: English, then Chinese). No file, no sound. No card has one yet; they need the
same setup as a call, and each recording its credit.

The inside uses these optional fields. Any you leave out are simply not shown.

```json
"profile": {
  "image": "illustration",
  "callouts": [{ "x": 0.34, "y": 0.45, "r": 0.07, "en": "White V on the chest", "zh": "胸前的白色V字",
                 "detail": { "en": "", "zh": "" } }]
},
"stats": {
  "length": { "en": "120–180 cm", "zh": "120–180 公分", "note": { "en": "without the tail", "zh": "不含尾巴" } },
  "lengthCm": { "min": 120, "max": 180 },
  "weight": { "en": "50–200 kg", "zh": "50–200 公斤" },
  "weightKg": { "min": 50, "max": 200 },
  "lifespan": { "en": "20–30 years", "zh": "20–30 年" },
  "lifespanYears": { "min": 20, "max": 30 },
  "diet": { "en": "Omnivore: …", "zh": "雜食：…" },
  "dietIcons": ["🌰", "🍎", "🌿", "🐛", "🐭"],
  "development": { "kind": "gestation", "days": { "min": …, "max": … } },
  "youngCount": { "min": …, "max": … }
},
"compare": { "width": 150 },
"related": ["taiwan-serow", { "scientificName": "Ursus arctos", "name": { "en": "Brown bear", "zh": "棕熊" } }],
"mapBounds": { "west": 119.8, "south": 21.9, "east": 122.3, "north": 24.8, "manual": true },
"_draft": ["facts", "stats"]
```

- **profile**: `image` is `"photo"` or `"illustration"`. Callout `x`/`y` mark the centre of the
  feature as fractions of the picture's width and height (0 = left/top, 1 = right/bottom; percent
  0–100 also works). `r` is how much the magnifier shows: the radius around the feature as a
  fraction of the picture's width (default 0.08; smaller = more zoom). The photo itself stays clean.
  Each callout is a numbered label drawn on the picture; tapping it rings the feature, opens a round
  magnifier in the emptiest corner (cut from the full-size image) and shows a box under the picture
  with its name and `detail` (optional). Tap it again or the picture to close. It is on the stage
  under 🐾 Behaviour. The build never touches `profile`, so hand-tuned values are safe.
- **stats**: `length`, `weight`, `lifespan` and `diet` are the text shown. `lengthCm`, `weightKg` and
  `lifespanYears` are the numbers the comparisons use (the middle of `min`–`max`). If you only give
  the numbers, the text is made from them. `dietIcons` are emoji for the diet plate.
  `development` is gestation or incubation: `kind` is `"gestation"` (shown as Gestation 懷孕期) or
  `"incubation"` (Incubation 孵化期), `days` the time in days (`min`–`max`), with optional `en`/`zh`
  text instead. `youngCount` is the number of young (or eggs) at a time, with optional `young` text;
  it is in the back's statistics block.
- **related**: related species, as card ids or `{ scientificName, name }` for animals with no card.
  They show on a topic card under 👀. A card the profile has opens on tap; one not collected yet shows as a locked silhouette; an animal
  with no card is a small entry with its names. Cards not built yet are left out.
- **Creature comparison** fills the stage under 📏 Size. Each scene plays an animation: **length**
  (silhouettes side by side, names and sizes in a row underneath), **weight** (a balance; the lighter
  side fills with copies until it levels out, as many as the "× n" line says, sized to fit on the pan;
  a counter and "= Elephant × n" for huge numbers) and **lifespan** (birthday timelines);
  **diet** (a plate filling up) is under 🍃 instead. "You" is 120 cm, 23 kg and 6 years old unless the
  profile has its own height, weight and age (Welcome form, or For grown-ups → Edit profile). A grown-up,
  a cat and a car can stand in (`PARTNERS` in `js/compare-data.js`), and a profile without the number a
  scene needs starts with the grown-up. There is nothing to tap and count: the scene takes all the room
  under the buttons. The partner buttons share the top row with the modes when they fit. On a stage too short for it all (`--stage-short`, a phone on its side) the scene shows with
  its modes only.
- **compare**: how big the animal's silhouette is in cm, either `width` or `height`, of the whole
  picture. That is the picture's size, not the animal's: where a tail curls or hangs, a true nose-to-tail
  length would make the animal far too tall, so size it so the body comes out right and check the
  shoulder against its source. Leave it out to use `lengthCm`, `heightCm` or `wingspanCm`, in that order.
  Also: `partners`, who it can stand beside when it isn't You, a grown-up, a cat and a car (`you`, `adult`,
  `cat`, `car`, `sand`, `hair`, `salt`: `PARTNERS` in `js/compare-data.js`); `silhouette`, a picture of its
  own for the comparison, with the usual credit fields, when the card's silhouette isn't the right one
  (a cherry's is its fruit); and `stat`, which statistic the caption
  shows, when it isn't the usual one (a flying fox, drawn wings out, shows `wingspanCm`). The caption
  always gives the card's statistic, never the size of the picture. The silhouette itself is found by the build (from
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
whole-globe view, full 1:50m detail when zoomed in. It is fetched the first time the globe
opens (not installed with the app); the very first time that needs the internet, and offline
the globe says so ("The globe needs the internet the first time…") with Try again.

### From a card to the globe

A card's map (on the back, and under 🌍 on the stage) opens the globe at that animal's range: the
whole map is the button, with a small 🌏 in its corner. It is a tap only: a drag that starts on the
map still changes card or turns it over. Only cards with a range
file have it (`opensGlobe` in `js/card-return.js`), and not in pack reveals.

- `#/globe/<card id>` lights the range up, turns to it and zooms so it fills about 40% of the
  view, but never past zoom 8 (`FIT_K_MAX`, `rangeFit` in `js/globe.js`), so a Taiwan-only animal
  still shows the coasts around it. The globe holds still there until it is touched.
- Pins are on when the globe opens from a card, even if they were hidden with the paw button, and
  that card's own pin shows even when a filter would leave it out, until the filters change or
  another pin is picked.
- "‹ Back to card" (Esc, or the device's back button) returns to the card as it was: the same
  side (front or back) and the same heading, without saying it again, and the notebook collapsed or expanded, on the same page
  (`js/card-return.js`, kept in memory only). `#/globe` on its own is the Globe tab as always.

### Globe map layers

The hero button at the top of the Globe's toolbar opens a picker that switches on one map layer at a time: 🏔️ topography,
🌳 forests, 🪸 coral reefs, 🌙 day & night (live, from the device clock), 🌡️ temperature
(with a month slider) and 🌊 ocean depth. Taiwan's outline glows above every layer.

- **The info panel** (`js/globe-info.js` says what it holds, `js/views/globe.js` draws it) has
  the same three parts for every layer, and for the plain map (pins and clusters, how to filter):
  a vertical key (24 px swatches in the colour the map shows, with an emoji or a tree inside;
  short labels, never sentences), "What am I looking
  at?" (one or two short lines and a drawing), and "Did you know?" for older children. Depth's
  open key is the ocean guide: each zone's scientific name and an example animal (its card when
  one is built, otherwise its name and a drawing). Opened from a card, the animal's name and
  habitat sit above the key. The drawings (`js/globe-art.js`) are SVG drawn for WildFile,
  coloured with tokens; there are no image files.
- Where it goes (`panelMode`): on a tablet a card at the top left, 256 px wide open or not and
  as tall as what it shows; open, it grows downwards and scrolls inside. In landscape the globe
  moves right and is sized to the space beside it, growing into spare width up to 47 % of the
  free height as its radius (`roomFit` in `js/globe.js`). In portrait the card floats over the
  globe's corner and the globe keeps its full size. On a phone (under 600 px) a slim strip that
  opens over the globe. Top to bottom: the hero (the layer in use, as a tile), the key, and the
  full-width row that opens it, whose chevron points the way the card will move. The filter button and active filters sit along the top beside it.
  Open or collapsed is kept per
  profile on the device (`globePanel`); a phone always starts collapsed.

- Picture layers (topography, temperature) are drawn with WebGL 2 by `js/globegl.js`, on a
  canvas between the land and the pins. It is only created when such a layer is first switched
  on. Shape layers (forests, depth, reefs) are drawn like the land.
- On every layer the land's own outline is drawn as a clear dark line (`--c-map-coast`) on a light
  halo (`--c-map-coast-halo`), 1.5 px on 3 px at every zoom (`COAST_LINE`, `COAST_GLOW`, `drawCoast` in
  `js/globe.js`; the canvas draws in screen px, so nothing scales them), so the coasts stay sharp when zoomed in and read
  on mountains, deserts, red and blue; the far or detailed
  outline as for the land. The stretches along the map's frame, where Natural Earth cuts its
  shapes (the antimeridian, the South Pole), are left out (`coastRuns`).
- 🌋 Plates & volcanoes: the plate boundaries are Peter Bird's PB2002 (ODC-By 1.0, see
  CREDITS.md), made by `node scripts/make-layers.mjs plates` into `assets/layers/plates.json`
  (detailed, about 0.5° between points) and `plates-far.json` (no segment over 3°). Three kinds:
  pulling apart (ridges, rifts: a double line), crashing together (subduction, collision: a line
  with teeth on the side of the plate that stays on top; from PB2002's names, where "A/B" means B
  dives under A, and the plate shapes; collisions with no plate diving get teeth on both sides),
  sliding past (transforms: dashed). Widths from `coastWidth` (1.5 px to 2.5 px from zoom 8), on a halo (`--c-plate`). Each major
  plate gets its name (`plate.*` strings), where it is widest and only when it fits and misses
  the pins, and an arrow (`plates-motion.json`): Bird's poles are relative to the Pacific, so
  the build takes off the shell's net rotation (no-net-rotation frame); the longer the arrow, the
  faster. The pieces Bird splits off west of Taiwan (Yangtze, Sunda) are named the Eurasian Plate.
  Drawn for tablets: the dashes are made as short lines, the double line is a light stripe on a
  wide line, and the teeth and volcano triangles are stamped from small pictures (a canvas line
  dash, cutting the stripe out, and hundreds of tiny paths each cost about 10 fps).
- Volcanoes (the same layer): NOAA NCEI's Volcano Locations Database (public domain), made by
  `node scripts/make-layers.mjs volcanoes` into `assets/layers/volcanoes.json`: place, name,
  country and the last eruption as a period (NCEI has no years: since 1964, 1900–1963, the 1800s
  … date unknown). Chinese names from Wikidata (zh-tw or zh-hant only); the notable ones are
  listed in `data/volcano-names-review.md` for checking. `data/volcano-overrides.json` is
  written by hand (with sources) and wins: Taiwan's Tatun Volcanic Group and Kueishantao, both
  "uncertain". The whole globe shows the notable volcanoes (erupted since 1964, and Taiwan's),
  zoom 2.5 and closer all of them. A tap within 22 px of a triangle (a 44 px target) opens its
  card; a tap elsewhere or Esc closes it; a drag that starts on one still turns the globe
  (`tests/volcano-touch.test.mjs`).
- The Plates & volcanoes panel (`js/globe-info.js` plates): the key (three boundary styles, the
  arrow, the triangle), "What am I looking at?" with plates drawn as puzzle pieces, and, open, the
  three kinds of boundary as cross-sections with their kid names and school terms
  (張裂性 / 聚合性 / 錯動性板塊邊界), the Ring of Fire, and Taiwan's note (why it has tall mountains,
  earthquakes and hot springs; the Tatun volcanoes). Zoomed in on Taiwan (zoom 2.5 and closer,
  Taiwan near the middle) the note moves to the top and is marked. Sources: CREDITS.md.
- Coral reefs are areas made from Natural Earth's reef lines: everything within 8 km of a reef,
  joined where they touch and simplified (25 km for the whole-globe file, so they still show as a
  band), so the Great Barrier Reef reads as one long chain. See-through coral (`--c-reef-fill`) with
  a darker edge (`--c-reef-edge`), on the sea under the land, so they stop at the coast.
- Day & night has no picture and no WebGL (`drawNight` in `js/globe.js`). The night side is
  a translucent dark overlay worked out from the sun's height at each point, one value every
  4 px, smoothed up and clipped to the globe: dusk starts while the sun is just up, the colour
  goes from twilight (`--c-twilight`) to night (`--c-night`), and it is fully dark once the
  sun is about 13° down (`nightShade`). The city lights are 6,000 points from NASA's Black
  Marble (`assets/layers/lights.json`, 79 KB: the brightest 0.21° cells, each with its
  brightness), drawn as glows added onto the map (`lighter`), fading in through the twilight.
  The brightest 1,500 show for the whole globe, more as it zooms in, all of them from zoom 4
  (`lightCount`). The sun moves every minute.
- The ocean depth bands (`depth-2k.webp`; the fallback draws the shapes) are Natural Earth's 1:10m bathymetry at 200, 1,000, 4,000 and 6,000 m,
  where the ocean's zones meet (sunlight, twilight, midnight, the abyss, the trenches; NOAA /
  NWS JetStream "Layers of the Ocean"), simplified to the forests'
  density: about 0.23° between points in the detailed file (99% of segments under 1°) and 0.7°
  in the far one (none over 4°); `tests/globe-path.test.mjs` keeps them there. They are drawn
  with light curves (`DEPTH_CURVE`), which never cross a clip point (the horizon, the map's
  edges, where outlines meet), and the bands still nest. The detailed file is used from zoom 5
  (`DEPTH_NEAR_K`). Outline points far off the screen are left out (`traceRing`), which changes
  nothing on screen but saves drawing when zoomed in.
- Topography's picture is 2048×1024 everywhere.
- Topography zoom tiles (`js/globe-tiles.js`): from zoom 1.6, where that picture starts
  to blur, the same picture at 8192×4096 in 512 px tiles (`assets/layers/relief-tiles/<row>-<col>.webp`,
  128 tiles, 2.2 MB in all) is fetched for the view only, the tiles nearest the middle first, four
  at a time. They go into a 4 × 4 tile window round the view's centre (one 2048 px texture in
  `js/globegl.js`); where a tile isn't there yet (or offline), the base picture shows. The service
  worker keeps them in their own cache (`tiles-…`), letting the oldest go above 25 MB.
  `node scripts/make-layers.mjs tiles` makes them (from the same Natural Earth picture).
- Nothing is downloaded until a layer is first switched on; the service worker then keeps it
  (`layers-…` cache, which also holds `assets/globe.json` and the home outline in use), so it works
  offline from then on.
- To rebuild the files: `node scripts/make-layers.mjs` (all) or name some, e.g.
  `node scripts/make-layers.mjs temp depth`. It downloads the raw datasets into `data-raw/`
  the first time (about 300 MB), needs only Node (sharp and mapshaper), and writes
  `assets/layers/`. After re-running it (or `make-globe.mjs`), bump
  `LAYERS_VERSION` in `sw.js`.
- Frame rate: add `?debug=fps` to the address to see the globe's frames per second and drawing time
  while it turns, on any profile (`?debug=off` to stop). It also says which renderer is drawing, and at
  what pixel ratio.
- The base layers go through one WebGL 1 shader (`js/globe-base.js`) on a canvas under the 2D ones, at a pixel
  ratio of at most 1.5: Plain map, Topography (with its zoom tiles), Forests, Ocean depth, Day & night and
  Temperature. Every layer shares the ocean colour, the land mask and hillshade (`shade-2k.webp`, its light baked in
  from the north west) and the atmosphere. Zoomed in, the Plain map, Forests and Ocean depth take their hillshade from Topography's zoom tiles
  instead: the tile's light and dark less a blur of it (a mip level of the atlas), as `shade-2k.webp` was made.
  Their land mask's edge gets steeper as they zoom, so the land stops at the coastline instead of fading out. Coral reefs, plates, volcanoes, city lights, the coastline and the
  home outline are drawn on top, on the 2D canvases. `node scripts/make-layers.mjs base` makes the textures.
- **Known issue, not fixed:** at high zoom the coastline and the home outline don't exactly match the
  hillshade tiles. The lines are drawn from Natural Earth's outlines and the tiles come from its shaded
  relief picture, two sources that were never lined up with each other, so they drift a little apart.
- If WebGL is missing or its context is lost, the 2D canvas draws sea and land and `load()` in `js/layers.js` gives
  each layer as it was, with pictures through `js/globegl.js` (WebGL 2), until the context comes back.
- Temperature is twelve months of numbers, not colours: `temp-months-1…3.webp`, 720 × 360, a month to a channel, -50 to
  +50 °C in a byte (`js/globe-months.js`). The shader mixes two months first and colours them after, in ten
  bands, so band edges move between months. A change of month morphs over 400 ms, the slider scrubs, and ▶
  plays the year until anything is touched (none of it with reduced motion). The textures are fetched in idle time
  after the globe has drawn. Without the base renderer the monthly pictures are fetched the same way and crossfade
  over 300 ms. `scripts/make-era5.mjs` is a stub for a real climatology.
- The home outline follows the explorer's home country, or Taiwan with none set. Every country's is in one TopoJSON
  file, `assets/layers/home.topo.json` (Natural Earth 1:50m, `node scripts/make-layers.mjs home`), the same for everyone,
  so no request says where an explorer is from. It is fetched in idle time after the globe has drawn and kept by the
  service worker, and only the explorer's own is decoded and drawn. 13 territories the forms offer have no outline
  (`tests/home-outlines.test.mjs`). Magenta (`--c-map-home`) means home and nothing else on the globe.
- Colours live in `css/tokens.css` (`--c-depth-*`, `--c-forest-*`, `--c-temp-scale` …). The
  temperature pictures are painted with `--c-temp-scale`, so re-run `make-layers.mjs temp` if you change it.
- Sources and licences: [CREDITS.md](CREDITS.md).

In the app, gestures on a card are decided by direction, from anywhere on the card or a 40 px
margin around it. All of this stays below the top bar and never reaches the notebook
(its spine, its panel or, on phones, its tab), so drawing never moves the card; on narrow screens
the zones shrink to fit. A drag that starts at
an in-between angle waits a few more pixels before deciding its direction. Grown-ups in preview can
see these areas (the notebook's in purple): add `?debug=gestures` to the address (`?debug=off` to stop).
Sideways changes card (left the next, right the one before, as ‹ › and ← → do); with no card that
way it gives a little and springs back. On one page, up or down turns the card over (up over the top,
down the other way; 🔄, ↑ ↓, Space or Enter too). A vertical drag on what scrolls (the back, a list on
the stage) scrolls it, and turns the card only from the end it is scrolled to. Side by side nothing
turns, and 🔄 is hidden. The card turns about its middle (rotateX); the face turned away is see-through
and inert. ← (or Escape) goes back to the binder. The first three times an explorer opens a card on
one page, a hand on the stage shows the swipe up until something moves (not with reduced motion);
side by side there is no hand: both faces are there.
The layout rules are pure functions in `js/card-layout.js` (tested in `tests/card-layout.test.mjs`). Every gesture
ends settled: it commits or springs back, also when the pointer is cancelled, the
capture is lost or the window loses focus (`js/gesture-release.js`). A quarter of the way or
a quick flick is enough; less springs back, and a touch that hardly moves is a tap. A tap or a
scroll while the card is still settling lets it finish settling. The zoom in from the binder lands on
the card's final size (both faces side by side, or the one page): nothing resizes after it.

**Turning the device** (or a browser bar coming or going): the card is laid out again for the new
space whenever the desk changes size (a `ResizeObserver` on it, plus the window's and the visual
viewport's `resize`), at most once a frame and without animation. Anything moving jumps to where it
was going first (zooming in, turning over; closing finishes closing; a drag lets go where
it started). Each stage view fits its new size and keeps what it showed: the comparison its mode,
partner, the magnifier its feature, the map redrawn to the new shape.
`tests/card-rotate-touch.test.mjs` turns tablet and phone sizes both ways in every state.

## Packs and drops

**The plan** (`data/drops.json`, written by the build) is the same for every profile. A **series**
has 87 cards in 29 weekly **drops** of 3, with the same number of cards from each group every
series (`drops.groupSizes` in `build.config.json`). No drop ever has two cards from the same
group, and every group is spread evenly over the series (mammals and birds come most weeks, the
smaller groups every five or six weeks); the build stops with a message saying which setting to
change if that becomes impossible. Rows fill the slots of their group in `card-list.csv` order.
A slot with no row for it yet is planned as `"id": null`, and nothing is borrowed from another group.

**Frozen drops**: as soon as a drop is **ready** (see below), the build writes it to
`data/drops.lock.json` and never changes it again. Until then it can still be re-planned. After
you finish a card (and clear its draft flag), run the build (`--offline` is enough) to freeze the
drops it completes: editing, inserting or removing CSV rows, or
changing `groupSizes`, only re-plans the drops that aren't frozen yet. The build warns when a
change would have affected a frozen drop (a frozen card removed from the CSV or moved to another
group, a new row added above frozen ones, a size change that no longer fits a frozen week).

**Ready**: a drop arrives only when all its cards are built **and their 3 facts are written in
English and Chinese** (and not still marked as a draft in `_draft`). Claude's drafts carry
`"facts"` in `_draft`: check them, then remove it. An empty topic slot doesn't
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

**For grown-ups**: the 🔒 tab (answer the multiplication, written in words, on its number pad; the system keyboard never opens). Adding an explorer on the
picker asks it too; switching explorers from the avatar does not. Settings are per profile: pack day and
time, metric/imperial, °C/°F, Chinese names on cards, reading speed, *Preview* (shows every card without counting them as collected,
handy for checking your facts, and lets packs arrive as soon as their cards are built, so you can
try pack opening before the facts are done; use *Start over* afterwards), edit, *Start over from Series 1, Week 1*, and delete.
A new profile copies the pack day/time and units of the existing ones. To add a setting, add a
section to `SECTIONS` in `js/views/parents.js`.

**Stored on the device** (IndexedDB, see `js/db.js`): `profiles`, `packs`, `collection`,
`badges`, `quiz` and `notes` (the Field Notes index), each record with an id and `createdAt` /
`updatedAt` / `deletedAt`, so they can be synced (see [Family accounts](#family-accounts-supabase)). Field Notes pages and photos are files
in the browser's private storage (OPFS), with IndexedDB (`notefiles`) as the fallback. Height and weight are stored in cm and kg whatever the units. Progress
from the version before profiles moves into the first profile.

## Badges, tags and lookalikes

**Tags.** Every species card has `continents` and `biomes` (habitat) lists in
`data/animals.json`, using the ids in `data/regions.json` (7 continents, 8 habitats). Badges
and the Globe filter both read them. Tag a card where it lives in the wild (coastal seas
included); prehistoric animals where their fossils were found; topic cards only when the topic is
set in a place (Kenting Coral Reefs, World Explorer cards). General topics (Migration, How Animals
Fly) have no tags and don't count. A species card can't arrive until its tags are checked (remove
`"tags"` from `_draft`).

**Badges** (per profile, only collected cards count):

- *Groups*: every card in a group.
- *Continents and habitats*: Bronze/Silver/Gold at 3/10/25 tagged cards, set in `data/badges.json`.
  `counts` lowers them for regions with few animals (Antarctica 1/3/5, polar 2/5/10). To add a
  tier (e.g. Platinum), add it there and give it a colour as `--tier-<id>` in `css/tokens.css`.
- *Secret*: `data/secret-badges.json`: a set of card ids, with separate English and Chinese titles
  (they can be different jokes). Hidden on the Badges page until earned.

Earning one: the medal drops in (a new tier turns over from the old metal; a secret badge is a "?"
card to turn over), rub it to polish it, then flick it up to the Badges button.

**Lookalikes** (`data/lookalikes.json`): groups of easily confused animals, defined once and shown
on every member's card in the Animal comparison. A member is a card id, or `entry:<id>` for an
animal with no card (name, size, photo and silhouette in `entries`). `measure` says what the
side-by-side view is drawn to scale by: `length` (`stats.lengthCm`), `height` (`stats.heightCm`)
or `wingspan` (`stats.wingspanCm`). A collected card shows in full and opens on tap; one not
collected yet is a dark silhouette; cards not built yet are left out. Tapping a standalone
lookalike shows its photo with its credit. Groups with `"draft": true`
only show in parent preview. The build report lists what each group still needs.

**Silhouettes.** The comparison is silhouette against silhouette; an animal without one is a "?"
outline at the right size (the report's "Needs silhouette" list). The build takes silhouettes from
PhyloPic. When PhyloPic has none, one can be made from a photo:

```bash
node scripts/make-silhouette.mjs img/<photo>.webp img/silhouettes/<id>-photo.png --preview check.png
```

It cuts the animal out with the U²-Net model (Apache-2.0; downloaded once, about 170 MB, into
`data-raw/models/`, which is not committed), keeps the largest shape, fills holes and smooths the
edge. `--crop x,y,w,h` (fractions of the photo) helps when something else stands out more than the
animal; camouflaged animals (e.g. a snake on leaf litter) often don't work. A silhouette made from
a photo is a derivative of it: give it the photo's author and licence, add
`"derivedFrom": "<the photo's sourceUrl>"`, and lock `"silhouette"`.

## Field Notes

One notebook per profile (📓 in the nav, or beside every card). Code: `js/notebook.js` (the UI),
`js/notes-render.js` (drawing a page), `js/notes-rails.js` (the roll's and tray's objects, as SVG),
`js/notes-book.js` (the book round the page, and what turns on its spiral), `js/notes-cover.js` (its
front cover, kept apart for decorating later), `js/notes-polaroid.js` (photos
waiting on the desk), `js/notes-debug.js` (the tap zone overlay),
`js/notes-view.js` (where the page lies, zoom limits, what a gesture means; pure, tested in
`tests/notes-view.test.mjs`), `js/notes-model.js` (tags, contents, migration; pure, tested in
`tests/notes-model.test.mjs`), `js/notes-tools.js` (the tools' shared settings) and
`js/notes-ruler.js` (the ruler's geometry; both pure, tested in `tests/notes-tools.test.mjs`),
`js/notes-store.js` (storage), `js/notes-io.js`
(backup), `js/zip.js`, styles in `css/notes.css`. `tests/notes-*-touch.test.mjs` drive the notebook
with real touches in Chromium, and `tests/notes-full.test.mjs` the trip from the panel to the full
notebook and back in the real app.

- **On its own** (`#/notes`): the whole screen, with no app header or tab bar. The book lies closed on
  the desk, showing its cover with "Field Notes" and the explorer's name; a tap turns the cover up over
  the spiral, and Back turns it down again before leaving. Opened from the panel beside a card there
  is no cover: the page grows straight into place, and Back goes straight back to the panel.
  One page at a time, in either orientation: a 4:5 page (1120 × 1400 units), with the pencil roll and
  the tray beside the book in landscape, the tray above and the roll below in portrait: orientation
  alone decides. A short screen folds them into two columns and a narrow one into rows.
- **The book** (`js/notes-book.js`) lies outside the page: the cover, the coils and the page edges
  all stay inside the desk's margins (`--nb-book-top`, `-bottom`, `-side`), which `bookBox` in
  `js/notes-view.js` leaves round the page whether or not they are drawn, so the canvas is the same size
  with them as without. On the baseline tablet the page is 585 × 732 in landscape and 708 × 885 in
  portrait, which fills the room left by the tray, the roll and the tabs. The stack of page edges below the page
  shows the pages to come, the stack above the spiral the pages turned (`stackDepth`: 12 or more fill
  it, a short list is a thin book). Zooming happens inside the page's own edges, so the book stays still.
- **Motion**: the cover turns in 0.8 s and a page in 0.6 s, with one easing, tuned in `css/tokens.css`
  (`--nb-cover-ms`, `--nb-flip-ms`, `--nb-flip-ease`, `--nb-flip-angle`, `--nb-fade-ms`). A turn stops just
  past edge-on: further, and it would be off the screen with half its time left. A jump to a distant page
  (a tab, a contents link) is one flip with the target already underneath, never through the pages
  between. What turns is never what fades: an element fading is flattened, and shows its front from
  behind, so its wrap fades instead. With reduced motion a 0.3 s crossfade stands in for every turn.
- **Index tabs** stick out of the page's right edge: Contents, every animal with pages in the contents'
  order and its group's colour, then the free pages. The one for the place sits forward. A tap jumps
  there, to an animal's latest page. Page turns stay within an animal's section; back from its first page
  is the contents. Where they don't all fit, the nearest show, with "more" for the contents. How they
  fit is measured (`tabFit`). Beside the page a label always reads across, in two short lines to each
  language (`js/notes-tabs.js`): a name that won't fit becomes its group's emoji and last word, or its
  last two where tabs showing together would read the same, and a single word too long for the tab
  breaks in two, so nothing is cut off. Where there is no room beside
  the page, on phones, a tab is a stub: an initial with its label on press, 44 px wide over the page's
  edge. Two buttons below them turn the page.
- **The desk** is one picture behind one token, `--desk-texture` in `css/tokens.css` (with
  `--desk-texture-size` and `--desk-colour`), so it can be swapped, and used for the explorer's desk
  home screen. The placeholder, `img/desk/wood.webp`, is a seamless tile drawn by `scripts/make-desk.mjs`.
  No soft shadows or filters on anything on it: hard offset edges only.
- **The pencil roll** opens out when the notebook first shows a page (its window and its cloth move
  opposite ways, so only the edge travels; not with reduced motion). Top to bottom: a thickness slider
  of five notches, the ruler, pencil, pen, highlighter and eraser in their loops, the colours, and undo,
  redo and pen or finger as wooden tokens with the sign carved in (worn flat when there is nothing to
  undo). The colours and slider are for the drawing tool in hand, or the last one: using them brings
  that tool back to hand; the eraser has none. Cyan, yellow and magenta are the highlighter's only; the
  pencil and pen have nine colours, white among them.
- **The tool in hand** comes out of the roll and lies on the desk at a slight angle, wherever the free
  desk beside the roll has the room (`deskSpot`, measured from the layout, not the device). Where it
  doesn't, on phones, it slides partly out of its loop and stays there, raised and highlighted. Tapped
  on the desk, or at its empty loop, it goes back and the pencil comes out, so a finger always draws
  something; the pencil itself goes back and stays raised, still in the hand.
- **The tray** holds, in compartments, the ink pad (tap for the ink colour), the sponge, three stamps:
  ABC (text), the panda (a collected animal: tap for a short row of them, long press or ⋯ for all of them) and the
  footprints (tap again for the kind), the tweezers, the washi tape, the magnifying glass (+, − and
  back to the whole page, for zooming with no second finger or wheel) and the pile of Polaroids. ＋ and
  ⋯ sit beside it.
- **Washi tape**: a drag across the page lays a strip along it, a tap a short one; tapped again in
  the tray it offers four colours. Tweezers move, stretch and turn a strip, and the sponge takes it.
- **Polaroids**: a tap on the pile opens the device's picker (camera or library). The picture, shrunk
  to 1280 px, slides off the pile and develops over 2 s on the desk, and a finger carries it to the page,
  where it lands within ±4° of straight. It is kept (the usual `photos/` file) only then, so a picture
  left on the desk leaves nothing behind; let go off the page, it goes back to its place. Every photo,
  old or new, is drawn in a white frame with washi over its top corners. Beside a card the 📷 button
  puts a photo straight on the page, and it stays selected so it can be placed.
- **Font**: notebook text (ABC stamp, contents, cover label, tabs) is WildFile Notes: Andika's Latin
  in two weights, 13 KB each, in `assets/fonts/`. It is Andika subset with `pyftsubset`, and renamed
  because the OFL reserves that name from modified versions (`OFL-Andika.txt` beside it). Chinese stays
  in the system font: a subset for the app's own 733 characters would be about 100–400 KB by
  font, but anything else a child types would fall back and mix styles.
- **Tap zones**: `?debug=taps` (in a parent's preview, like the other overlays) outlines each one with
  its size, in red if it is under 44 px.
- **Tweezers**: press a photo, stamp, footprint trail, text or tape to select it and drag it in the same
  move; the handles resize and turn it, ✕ removes it, and a tap on bare paper lets go. They work with
  a finger in *Pen only* too. They never touch lines, never open the keyboard, and a drag on bare paper
  only pans when zoomed in, so a missed grab can't turn the page.
- **The page's bitmap**: what is on a page is baked into one bitmap at the capped pixel ratio (`.nb__base`).
  A new item goes on top of it. Undo, redo, a page turn and a zoom settling draw the page again; a pinch
  or pan only scales the bitmap. What is selected is held out of the bitmap and drawn on the live layer,
  so moving it draws only it; letting go bakes it back in. Stamps and footprints come from small kept
  pictures (`js/notes-sprites.js`), one per animal, ink and size, about 24 MB at most.
- **A full page**: a page takes 150 things placed (`PAGE_CAP` in `js/notes-model.js`): stamps, trails (one
  each, however long), tape, text, photos, later stickers. Then a note on the desk says *Page full: turn
  the page!* and nothing is placed. Lines don't count, since a few lines of handwriting would reach it.
  Pages already fuller keep everything. `?debug=notes` in a parent's preview adds `wfNotes.heavy()` (a page
  of 400 stamps and 20 trails) and `wfNotes.bench()` (what it costs to draw).
- **Which animals are stamps**: a card in a `stampable` group (`data/groups.json`: never Behavior, How Animals
  Work, World Explorer or Conservation) with `"stamp": true` in `data/animals.json` and a silhouette.
  The build never writes `stamp`, so a hand edit stays. Stamps already on a page stay, whatever the card.
  A tap on the panda shows a short row: this page's animal, the last three used, the latest pack. A long
  press (or ⋯) shows all of them with the binder's tabs and tiles. Beside a card, a second tap on the stamp
  tool does.
- **The page's animal**: a page tagged with a living thing (the first one, if it has a silhouette) has that
  silhouette faded into the paper's bottom right corner, with the dots fading inside it
  (`--nb-backdrop`). It is part of the paper, in exports too: no item, not counted, and nothing rubs it out.
  Taking the tag off takes it away.
- **Sponge**: rubbing or tapping takes stamps, footprint trails, text and tape off the page, one undo step
  per rub, with a brief wipe (`wipeFx`: each item drawn once on a small canvas that fades; none with
  reduced motion). Lines stay (they are the eraser's) and so do photos (✕). The page keeps its animal
  tags. In *Pen only* it follows the eraser and takes only the pen, so a resting hand can't wipe.
- **Stamping**: the stamp comes down on the page with `navigator.vibrate(15)` and a short thunk made
  by Web Audio (`js/fx.js`, no sound file). A tap on bare paper stamps; a tap on something already
  there selects it, or with ABC edits text. A stamp's box follows its silhouette's shape. Selected
  text has a pencil button to edit it, and a double tap on it with the tweezers or a stamp does the same.
  The button answers the finger lifting, as ✕ does, since the first tap after dragging a handle can come
  without a click; it only counts a press on itself. All the handles go while two fingers are down, and
  a finger that had landed on one joins the pinch, so a pinch on small text can't catch one.
- **Ruler**: it lies on the book, not on a page, so it zooms and pans with the page, stays out when
  it turns, and is never saved or exported. Drag it out of its loop or tap it; tap it there, or drag
  it back, to put it away. One finger moves it. Two fingers both on it turn it, however late the
  second comes; one on it and one off it is a pan or zoom. A line started within 30 page units of a
  long edge follows that edge to the ruler's ends. A pen on the ruler draws along the nearer edge and
  never moves it, and touches don't move it while a pen is down. With a mouse, the wheel over it turns it.
- **Gestures**: one finger draws. Two fingers pan and pinch-zoom, up to 4×: the page moves by CSS
  transform during the gesture, and when it ends a screen-sized canvas redraws the view sharply, so
  zooming never needs a bigger page bitmap. At the fitted size a two-finger swipe turns the page (up for
  the next, down for the one before; sideways in the panel, where up and down pans), only
  when it is clearly in that direction, at least 80 px, and the fingers' distance never changed by 5% or
  12 px, whichever is more: a pinch can't turn the page. A second finger within 200 ms of the first makes a gesture and drops what the
  first had started; later, the line carries on. With a mouse, the wheel pans and ctrl + wheel zooms.
- **Pen**: a solid line of one width whatever the pressure, drawn as curves through the middles of its
  segments, so it stays smooth; the file still keeps each point's pressure, and old pen lines draw the
  same way. The pencil keeps its pressure and grain.
- **Canvas**: at most 1.5 device pixels per CSS pixel. The page is a cached bitmap: the mark being
  made is on a live layer, and a finished one is added to the bitmap on its own. Eraser redraws go by
  the frame. A highlighter line is multiplied onto the page, drawn as one path: piece by piece its
  joints would show. The live layer has no page under it, so while one is being drawn the browser
  multiplies that layer instead (`mix-blend-mode`).
- **Keyboard**: while a text box is open the desk rises so it stays above the on-screen keyboard,
  going by `visualViewport`, and the notebook keeps its height, so the page doesn't re-fit.

- **Beside a card**: the notebook is always there, in one of two states. Collapsed, it is a kraft
  spine with an elastic band in the 60 px strip at the right (on phones, a 📓 tab at the bottom
  right). Tap it to expand it: it takes half the stage (`--nb-panel-share`, `PANEL_SHARE` in
  `js/card-layout.js`) and the card is centred and scaled in the other half. Always in landscape;
  in portrait only while the card stays at least 340 px wide, otherwise (and on phones, under
  600 px) the panel covers the card. Beside the panel the card is one page, in the room that is left.
  The panel has one bar: "Collapse ›" (which folds it
  back), the "All pages / Only this animal" chip and the page buttons; where it is too narrow it
  wraps between them rather than clip anything. The state is kept per profile on the device
  (`notesPanel`).
- **The page beside a card** fills the panel's width (less a 16 px kraft margin) and scrolls up and
  down when it is taller: with the wheel, two fingers, one finger on the kraft margin, or one
  finger on the page in *Pen only*. Ctrl + wheel zooms it; a pinch doesn't (see below). A slim indicator on its right edge shows there is more, and
  the first time each page opens it dips down a little and back (not with reduced motion).
- **The full notebook from the panel**: the open book in the bar's top corner, or a pinch outward from
  the fitted page past 1.3× (a shorter one springs back), opens `#/notes/<card>` on the same page. It
  saves first; then the desk and the page grow to the screen by transform alone, and stay a moment
  while the full notebook draws under them (none of it with reduced motion). A pinch on a selected
  item still resizes it. Back returns to the same card and side with the panel open, through
  `js/card-return.js` as from the globe: on the page the full notebook ended on if that page is
  tagged with this card, otherwise on the page it started from, so another animal's page never ends
  up beside this card. Undo history starts afresh, as on any page turn.
- **Animal tags**: a page has zero or more animals, shown as chips under its OBSERVED stamp
  (✕ removes one, "＋" adds an animal this explorer has collected). Placing a stamp adds its animal;
  removing the stamp leaves the tag. The header's title is the first animal's name ("+ N more" when
  there are several); a page with no animals is a free page (隨手記). Tag changes are undoable.
  When the tag that put a page in the list in view comes off, the page stays open with a short note
  saying where it went, and the tabs carry on through the same list from where it was.
  The badge on a card's binder tile counts that animal's pages.
- **Opening**: with a card open, the notebook steps through that animal's pages (oldest first),
  starting on the one edited last; "＋" adds a page tagged with it. An animal with no pages gets a
  new page tagged with it, saved only once something goes on it (flicking through cards never makes
  empty pages, or duplicates). The Field Notes page in the menu opens on the **contents**, the first
  pages of the book, on the same paper and read-only, so the roll and the tray are put away: under a
  tilted heading with a drawn line, binder groups with a text link for each animal that has pages (page
  count, last edited), then the free pages and "＋ New free page". It flows onto more pages (`paginate`),
  turned like any other. Beside a card it is the same list, scrolling. Pages never move: the contents
  is a view of their tags.
- **Tools**: pencil and pen in 9 colours (white too) and five thicknesses, highlighter (cyan, yellow or
  magenta), ruler, eraser (whole lines of any tool; everything else has its ✕), text, stamps
  (collected cards' silhouettes, or the group emoji), footprint roller (cat paw, hoof, bird, bear),
  washi tape, photos, undo and redo (Ctrl/⌘+Z). Text, stamps and footprints take the ink. The settings are kept
  per profile on the device (`notesTools`, never sent). With the tweezers or a stamp in the hand, one
  tap on a photo, stamp, footprint trail or text selects it; with a pencil, pen or highlighter a tap
  there is a dot like any other. Drag it inside its box, use
  the handles outside the box or a two-finger pinch on it to resize and turn it, ✕ to remove it; a
  tap elsewhere lets go. Resizing a trail stretches its path, not its prints.
  Beside a card the toolbar stays a toolbar, with its own tools (no pen, highlighter, ruler, tweezers,
  sponge or tape: the open book is one tap away), thin and thick for the slider's second and fourth
  notches, and the same settings. It never scrolls: one row when it all fits (measured, as the labels' width
  depends on the language), otherwise two rows of 44 px controls with the colours behind a swatch. The
  roller's feet always open from one button in a small picker.
- **Pen or finger**: the first time a pen touches the page, the notebook switches to *Pen only*
  so a resting hand doesn't draw, and one finger turns pages. The toggle at the end of the toolbar switches
  back to finger drawing at any time; the choice is kept per profile. Touches wider than a finger
  are ignored, and so are touches while the pen is down.
- **Backup** (⋯ menu): *Back up all my notes* makes a zip (`manifest.json`, `pages/*.json`,
  `photos/*.jpg`) and shares or downloads it; *Restore from a backup* adds pages that aren't there
  yet and never overwrites; *Save this page as a picture* makes a PNG. Where the browser supports
  it (not Safari), *Also save to a folder* writes the same files into a folder you pick.
- **Page file** (`version: 2`): `w`, `h` (1120, 1400), `paper` (`dots`/`grid`), `header` (`date`), `tags` (card ids, in
  order), `createdAt`, `editedAt` (content or tags last changed), and
  `items` in page units: `s` a line (`p` = x, y, pressure…; `k` is `pen` or
  `highlighter`, and none means pencil, so pages from before these draw as they did; `t` is taken: it
  is every item's type), `x` text, `m` stamp, `f` footprints, `p` photo (`id` of a file in `photos/`), `w` a strip of tape (`k` its colour, `x`, `y` its
  centre, `l` its length, `s` its width, `r` its turn). `k` is kept for stickers (`id`, `x`, `y`, `w`, `h`, `r`):
  they draw, select and count, but nothing makes one yet. Their bitmaps belong in `assets.stickers`, decoded at the
  size shown, and go with photos when their page is three pages back (`keepBitmaps`). A trail stays one `f` item however long. Pages from when the paper was 5:7 have `w` 1000:
  as they load, `widenPage` moves what is on them 60 units in, so they lie centred on the wider paper
  with the same height; their file only changes when the page next does. Version 1 pages (`header.cardId`, `links`, no
  tags) are tagged with what they were linked to (header card, cards drawn next to, stamped animals)
  when they load; their index records the same way, once. Backups list each page's `tags`
  (manifest `version: 2`); version 1 backups still restore. Field Notes never sync: `notes` and
  `notefiles` are not in `SYNCED` (`tests/notes-store.test.mjs` checks the outbox stays empty).

## Language and read-aloud

- All UI text is in `lang/en.json` and `lang/zh-TW.json` (same keys). `{n}`-style placeholders are filled in by the app.
- The language choice (EN / 中 / Both) is stored with each profile.
- Read-aloud uses the device's own voices. On iPad, voices can be added under
  Settings → Accessibility → Spoken Content → Voices (English (UK), Chinese (Taiwan)).
  In Both mode the English is read first, then the Chinese.
- On a card only 🔊 speaks, and it says the card's name, at the explorer's own reading speed. Headings and
  counting are silent. The quiz has its own read-aloud buttons.

## Offline and updates

`sw.js` caches the app, the data and every card image (full size and thumbnail) on first visit.
App files and data are fetched fresh when online (falling back to the cache after 3 s or when
offline); images are served from the cache first, because their file names change whenever the picture changes.

After you push an update, an open app picks it up on its next launch. If something looks stuck,
bump `VERSION` in `sw.js`; that clears the old caches (except the Globe map layers, which have their own `LAYERS_VERSION`). If you add or rename a file under `js/`,
add it to the `SHELL` list in `sw.js` too.

## Family accounts (Supabase)

Work in progress. Signing in is optional and only for parents: the family account owns the
profiles, and kids never have accounts. The device keeps working offline and stays the source of
truth; it syncs with Supabase when online.

- **Synced:** profile nickname, language, avatar colour, zhuyin, read-aloud speed, units, pack day
  and time, age, height, weight, home country, packs (and whether they're opened), collected cards
  and badges. Every grown-up in the family can see them.
- **Never leaves the device:** quiz scores and Field Notes.
- **Home country** goes nowhere but the family's own account: no other request says what it is. Its
  outline on the globe comes from one file that holds every country's.
- **Signing in:** For grown-ups → ☁️ Family account. A grown-up types their email, then the code
  from the email (or opens the email's link on this device, which asks before signing in). Signing
  out keeps the explorers on the device. The code is in `js/cloud/auth.js` (plain `fetch`, tests
  in `tests/`, run `npm test`).
- **What a device is** (asked once, after the first sign-in on it): *the explorers' device* (where
  packs are granted and opened, the default, also for every device from before) or *a grown-up's
  device* (watch mode). Kept in `meta 'device'`, on that device only; changed in For grown-ups →
  ☁️ Family account. A grown-up's device with explorers of its own adds them all to the family
  account, or is the explorers' device instead: a grown-up's device never has local-only
  explorers. Becoming a grown-up's device needs everything from the device saved first (nothing
  waiting or held back) and no local-only explorers.
- **Watch mode** (a grown-up's device): it pulls everything but never grants or opens a pack,
  collects a card or earns a badge. `db.js` refuses those writes (`WatchOnly`, read inside the
  writing transaction), and `store.js` doesn't attempt them. No "New pack arrived", no
  celebrations; the Packs page lists each pack as waiting or opened; Quiz and Field Notes are
  hidden (they stay on each device); a "👀 Watching" chip shows in the header. Settings, units,
  pack day and new explorers can be changed and go up; Start over, Delete and Restore are only on
  the explorers' device.
- **Signing out:** "Sign out" keeps the explorers on the device (first on the explorers' device).
  "Sign out and remove the family from this device" (first on a grown-up's device) saves everything
  first, then removes the family's explorers with their packs, cards, badges, quiz scores and Field
  Notes from this device only, and signs out. Explorers kept on the device only stay. Nothing is sent:
  the family account keeps everything.
- **Another grown-up** (`js/cloud/family.js`, migration
  `supabase/migrations/20261104112117_family_invites.sql`): the family's owner invites an email
  under ☁️ Family account → "Grown-ups in this family". Nothing is emailed by the app: the owner
  tells them to sign in here with that email within 7 days. At their first sign-in on a device they
  are asked whether to join; joining makes them a *parent* of that family (only if their own
  account has no explorers on the server yet). The owner sees open and expired invites (cancel,
  invite again) and can remove a parent; a parent can leave. At most 4 grown-ups per family,
  counting open invites. Every grown-up is in exactly one family: removed or leaving, they get an
  empty one of their own. When the owner's account is deleted, the parent who joined first becomes
  the owner. All of it goes through database functions that check who is asking (RLS check in
  `supabase/tests/rls_check.sql`).
- **No longer in the family** (removed, or left): each sync run first asks which family the
  grown-up is in. When it isn't the device's any more, nothing goes up or comes down, the panel says
  so, and "Sign out and remove the family from this device" (asks first) removes the family's
  explorers from the device. Changes not saved yet are dropped with them. Back in the family, it
  carries on.
- **Who may make an account:** sign-ups are open only to invited emails, through the
  *Before User Created* auth hook (`public.hook_before_user_created`, in the same migration).
  Existing accounts sign in as before. In the dashboard: Authentication → Auth Hooks → Before User
  Created → Postgres, `public.hook_before_user_created`; then Authentication → Sign In / Providers
  → Allow new users to sign up. Turn the hook on before sign-ups, and sign-ups off before the hook.
- **A new device:** the Welcome screen has "Already have a family account? Sign in". Behind the
  grown-ups' question it is the same email and code (or link); then the family's explorers come down
  (`sync.join()`) and the picker shows them. If the family has no explorers yet, the Welcome form
  carries on and the new explorer goes up. Opening the email link on a device with no explorers
  does the same without the question.
- **Saving to the family account** (`js/cloud/sync.js`): the first time a parent signs in on a
  device, they tick which explorers to add (an unticked explorer stays on that device only, and
  so does one deleted before then); the choice is remembered. After that every change is sent:
  each write to a synced store also puts an entry in the `outbox` store, in the same
  transaction, and sync upserts the records (profiles first) and clears their entries. Offline
  or a busy server just means trying again later; a record the server refuses is held back with
  its error and shown in the panel. A different account signing in on that device sends
  nothing.
- **Bringing other devices' changes down** (`js/cloud/sync.js`, rules in `js/cloud/merge.js`):
  each run pushes, then pulls every table's rows changed since the last pull (by the server's
  `updated_at`, starting 60 s early, in pages of 1000) and merges them with the same rules as
  the server's triggers. Settings: the newer `settingsAt` wins. Timeline: the higher epoch wins.
  Packs: the first grant's details, the earliest opening. Cards and badges: the earliest time.
  Deleted explorers stay deleted. Device-only fields are never touched, explorers kept on one
  device only are never pulled into, and a "Start over" from another device also clears this
  device's quiz scores. A pulled pack that isn't opened yet shows "New pack arrived" once on
  each device. Runs on start, sign-in, coming back online, showing the app or focusing its window
  (two windows side by side never hide), after changes, and every 5 minutes while the app is shown
  (no Realtime). The picker, the header and the Parents page's explorers redraw
  with what came down. Tests: `tests/pull.test.mjs`, with two
  devices and a fake server that merges like the triggers (`tests/fixtures/server.mjs`).
- **Clocks:** which settings win is decided by the devices' clocks (`client_updated_at`), so a
  device whose clock is badly wrong can win over newer changes. Acceptable for now.
- **Not handled:** the same child made as two explorers on two devices before signing in stays
  two explorers.
- **Sign-in email** is sent through Resend (custom SMTP, from noreply@wildfile.app). In the
  dashboard (Authentication → Emails), both *Confirm sign up* (a new address gets this one) and
  *Magic link* contain the code `{{ .Token }}` and the link
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`. The code's length is the project's
  *Email OTP Length*; `CODE_LENGTH` in `js/config.js` must match it.
- **Deleting an account:** when a user is deleted and their family has no members left, the
  family is deleted too, with its profiles, packs, cards and badges
  (`supabase/migrations/20261104050133_family_cleanup.sql`). Devices keep their local copy. If
  other grown-ups are still in it, the family stays, and if the owner was deleted the parent who
  joined first becomes the owner.
- **Privacy notice:** needed before any family other than ours uses accounts. It must say that
  deleting a family's last parent account deletes that family's data on the server, and that the
  family's grown-ups see each other's email addresses.

The schema lives in `supabase/migrations/` and is applied with the Supabase CLI (a dev
dependency). Once per machine:

```
npx supabase login
npx supabase link --project-ref yrgrihgmydzlxjzuoljq
```

`login` keeps the access token in the CLI's own store, and `link` asks for the database password.
Neither goes in the repo (see `.env.example`). After adding a migration:

```
npx supabase db push --remote --dry-run
npx supabase db push --remote
```

then re-run the RLS check (`npx supabase db query --remote -f supabase/tests/rls_check.sql`, or paste it into the SQL editor). The public project
URL and publishable key are in `js/config.js`; the secret key is never used by the app.

## Publishing (Cloudflare, wildfile.app)

The app is served at https://wildfile.app/ by a Cloudflare Worker with static assets only (no
Worker code), configured in `wrangler.jsonc`. Workers Builds is connected to this repo and deploys
every push to `main`.

- **What's published** is `dist/`, built by `npm run site` (`scripts/build-site.mjs`) from an
  allow-list of the app's own files, so `.env`, `node_modules`, scripts, tests and build notes can
  never go out. The build also writes `dist/_headers` (the CSP from `index.html` plus
  `frame-ancestors 'none'`, `nosniff`, no referrer, no camera/microphone/location, `sw.js`
  always revalidated) and fails if `sw.js`'s `SHELL` list and the published files disagree.
  `npm test` checks all of this.
- **Workers Builds settings** (Cloudflare dashboard → Workers & Pages → wildfile → Settings → Build):
  build command `npm run site`, deploy command `npx --yes wrangler@4.151.3 deploy`, build variable
  `SKIP_DEPENDENCY_INSTALL=1` (the site build needs no packages, so the heavy dev dependencies
  aren't installed). Update the pinned wrangler version now and then, to one at least two weeks old.
- **Only wildfile.app:** `workers_dev` and preview URLs are off. Every address keeps its own saved
  progress, so there is one address to install from.
- **Try it the Cloudflare way locally:** `npm run site`, then `npx --yes wrangler@4.151.3 dev`
  (http://localhost:8787, same headers and redirects as the real site). `npm run serve` is the
  everyday preview.

To install on a tablet: open the site, then Share → *Add to Home Screen* (iPad) or the ⋮ menu →
*Install app* (Android Chrome).

## Changing the name

The name shown in the app is `app.title` (and the Chinese-only `app.subtitle`) in `lang/en.json`
and `lang/zh-TW.json`. A few places can't read those and keep their own copy: `name` and
`short_name` in `manifest.webmanifest` (the home-screen name), `<title>` and
`apple-mobile-web-app-title` in `index.html`, and the sign-in email templates in the Supabase
dashboard. The IndexedDB database keeps its old name (`wildlife-explorer`) so nobody loses progress.

## Changing the look

All colours, sizes, fonts and the 12 group colours are tokens in `css/tokens.css`
(`--g-mammals`, `--g-mammals-ink`, …; the `-ink` colour is the text colour on that group's colour).
`css/app.css` only uses those tokens, so change values there rather than in components.
The icon is drawn in `scripts/make-icons.mjs`; run `npm run icons` after changing it.

## Credits

Names, classification and conservation status: [Wikidata](https://www.wikidata.org/) (CC0).
Pictures: [Wikimedia Commons](https://commons.wikimedia.org/) and [iNaturalist](https://www.inaturalist.org/)
contributors. Every picture's author, licence and source are listed in the app under For grown-ups → Picture credits.
Map and Globe layer datasets: [CREDITS.md](CREDITS.md).
