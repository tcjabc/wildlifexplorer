// What the globe's info panel shows for each layer (js/views/globe.js draws it): the same
// three parts everywhere.
//   key:   the vertical key. Colour steps or symbols with short labels, top to bottom; never
//          sentences (tests/globe-info.test.mjs checks). 'temp' is the temperature scale.
//          Each swatch is the colour as it looks on the map: token, or paint for a mix
//          (reef: the see-through fill on the sea; dusk, night: the land under the night
//          overlay; lights: a glow on the night). mark: an emoji inside the swatch, tree: a
//          tree drawn inside it; short: a mark beside it in the collapsed key (depths);
//          animals: the row is about the pins, so it dims while they are hidden.
//   what:  "What am I looking at?": one or two short lines for young children, and a drawing
//          (art, js/globe-art.js).
//   clock: the layer's clock bar along the bottom of the globe: 'year' (Temperature), 'day'
//          (Day & night) or 'sea-level' (Topography: Today to the Ice Age). None: no bar.
//   more:  extra lines for older children (a "Did you know?", scientific names), shown when the
//          panel is open.
// Depth also has zones: each step's scientific name and an example animal (its card when one
// is built, otherwise its name and a drawing).
//
// Where the panel goes (panelMode): on a tablet, a card of one fixed width at the top left,
// growing downwards when open; on a phone, a slim strip that opens over the lower half.
// Collapsed it shows the key only.

export const PHONE_MAX = 600;
export function panelMode(w) {
  return w < PHONE_MAX ? 'strip' : 'side';
}

export const INFO = {
  everywhere: {
    emoji: '🌐', title: 'info.everywhere.title',
    key: [
      { icon: 'pin', label: 'info.everywhere.key.pin', animals: true },
      { icon: 'stack', label: 'info.everywhere.key.stack', animals: true },
      { icon: 'filter', label: 'info.everywhere.key.filter', animals: true },
    ],
    what: ['info.everywhere.what.1', 'info.everywhere.what.2'], art: 'pins',
    more: ['info.everywhere.more.1', 'info.everywhere.more.2'],
  },
  relief: {
    key: [
      { token: '--c-relief-high', label: 'info.relief.key.high', mark: '⛰️' },
      { token: '--c-relief-dry', label: 'info.relief.key.dry', mark: '🏜️' },
      { token: '--c-relief-low', label: 'info.relief.key.low', mark: '🌿' },
    ],
    clock: 'sea-level', // its clock bar: the sea level (js/views/globe.js seaBar)
    what: ['info.relief.what.1', 'info.relief.what.2'], art: 'mountain',
    more: ['info.relief.more.1'],
  },
  forests: {
    key: [
      { token: '--c-forest-tropical', label: 'info.forests.key.tropical', tree: 'tropical' },
      { token: '--c-forest-temperate', label: 'info.forests.key.temperate', tree: 'temperate' },
      { token: '--c-forest-boreal', label: 'info.forests.key.boreal', tree: 'boreal' },
    ],
    what: ['info.forests.what.1'], art: 'forests',
    more: ['info.forests.more.1'],
  },
  reefs: {
    key: [{ token: '--c-reef-fill', paint: 'reef', label: 'info.reefs.key.reef', mark: '🪸' }],
    what: ['info.reefs.what.1', 'info.reefs.what.2'], art: 'reef',
    more: ['info.reefs.more.1'],
  },
  night: {
    key: [
      { token: '--c-map-land', label: 'info.night.key.day', mark: '☀️' },
      { token: '--c-twilight', paint: 'dusk', label: 'info.night.key.twilight', mark: '🌅' },
      { token: '--c-night', paint: 'night', label: 'info.night.key.night', mark: '🌙' },
      { token: '--c-city-lights', paint: 'lights', label: 'info.night.key.lights' },
    ],
    clock: 'day', // its clock bar: the time of day and the month (js/views/globe.js dayBar)
    what: ['info.night.what.1', 'info.night.what.2'], art: 'sunEarth',
    more: ['info.night.more.1'],
  },
  temp: {
    key: 'temp', clock: 'year', // its clock bar: the month (js/views/globe.js tempBar)
    what: ['info.temp.what.1', 'info.temp.what.2'], art: 'thermometer',
    more: ['info.temp.more.1', 'info.temp.more.year'],
  },
  plates: {
    key: [
      { line: 'apart', label: 'info.plates.key.apart' },
      { line: 'crash', label: 'info.plates.key.crash' },
      { line: 'slide', label: 'info.plates.key.slide' },
      { line: 'arrow', label: 'info.plates.key.arrow' },
      { line: 'volcano', label: 'info.plates.key.volcano' },
    ],
    what: ['info.plates.what.1', 'info.plates.what.2'], art: 'plates',
    more: ['info.plates.more.speed', 'info.plates.more.ring'],
    // Open: what happens at each kind of boundary, a drawing each, with the school term.
    bounds: [
      { art: 'sectionApart', name: 'info.plates.key.apart', term: 'info.plates.term.apart', text: 'info.plates.bound.apart' },
      { art: 'sectionCrash', name: 'info.plates.key.crash', term: 'info.plates.term.crash', text: 'info.plates.bound.crash' },
      { art: 'sectionSlide', name: 'info.plates.key.slide', term: 'info.plates.term.slide', text: 'info.plates.bound.slide' },
    ],
    // Taiwan: in the open panel, first (and marked) when the globe is zoomed in on Taiwan.
    taiwan: {
      at: [120.9, 23.7], near: 2.5, // from this zoom, with Taiwan near the middle
      lines: ['info.plates.taiwan.1', 'info.plates.taiwan.2', 'info.plates.taiwan.3'],
      more: 'info.plates.taiwan.more',
    },
  },
  depth: {
    // Lightest at the top: going down the key is going deeper.
    key: [
      { token: '--c-map-sea', label: 'layer.depth.0', short: '0' },
      { token: '--c-depth-1', label: 'layer.depth.1', short: '200' },
      { token: '--c-depth-2', label: 'layer.depth.2', short: '1,000' },
      { token: '--c-depth-3', label: 'layer.depth.3', short: '4,000' },
      { token: '--c-depth-4', label: 'layer.depth.4', short: '6,000' },
    ],
    what: ['info.depth.what.1', 'info.depth.what.2'], art: 'oceanZones',
    more: ['info.depth.more.1'],
    zones: [
      { sci: 'info.depth.sci.0', animal: { name: 'info.depth.animal.0', art: 'turtle', card: 'green-sea-turtle' } },
      { sci: 'info.depth.sci.1', animal: { name: 'info.depth.animal.1', art: 'nautilus', card: 'chambered-nautilus' } },
      { sci: 'info.depth.sci.2', animal: { name: 'info.depth.animal.2', art: 'anglerfish', card: 'deep-sea-anglerfish' } },
      { sci: 'info.depth.sci.3', animal: { name: 'info.depth.animal.3', art: 'dumbo', card: 'dumbo-octopus' } },
      { sci: 'info.depth.sci.4', animal: { name: 'info.depth.animal.4', art: 'snailfish', card: 'mariana-snailfish' } },
    ],
  },
};

// Every string key the panel uses, for the tests (both languages must have them all).
export function infoKeys() {
  const keys = new Set(['info.what', 'info.more', 'info.collapse', 'info.expand', 'info.habitat', 'info.zones', 'info.everywhere.title', 'info.plates.bounds', 'info.plates.taiwan']);
  for (const info of Object.values(INFO)) {
    if (info.title) keys.add(info.title);
    if (Array.isArray(info.key)) for (const k of info.key) keys.add(k.label);
    for (const k of [...info.what, ...info.more]) keys.add(k);
    for (const z of info.zones ?? []) { keys.add(z.sci); keys.add(z.animal.name); }
    for (const b of info.bounds ?? []) { keys.add(b.name); keys.add(b.term); keys.add(b.text); }
    if (info.taiwan) { info.taiwan.lines.forEach(k => keys.add(k)); keys.add(info.taiwan.more); }
  }
  return [...keys];
}

// The key's labels (for the "no sentences in the collapsed key" check).
export const keyLabels = id => (Array.isArray(INFO[id]?.key) ? INFO[id].key.map(k => k.label) : []);
