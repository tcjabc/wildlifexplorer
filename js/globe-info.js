// What the globe's info panel shows for each layer (js/views/globe.js draws it): the same
// three parts everywhere.
//   key:   the vertical key. Colour steps or symbols with short labels, top to bottom; never
//          sentences (tests/globe-info.test.mjs checks). 'temp' is the temperature scale.
//   what:  "What am I looking at?": one or two short lines for young children, and a drawing
//          (art, js/globe-art.js).
//   more:  extra lines for older children (a "Did you know?", scientific names), shown when the
//          panel is open.
// Depth also has zones: each step's scientific name and an example animal (its card when one
// is built, otherwise its name and a drawing).
//
// Where the panel goes (panelMode): on a landscape screen, a column on the left with the
// globe beside it; on a portrait tablet, a short sheet under the globe that opens upwards; on
// a phone, a slim strip that opens over the lower half. Collapsed it shows the key only.

export const PHONE_MAX = 600;
export function panelMode(w, h) {
  if (w < PHONE_MAX) return 'strip';
  return w >= h ? 'side' : 'sheet';
}

export const INFO = {
  everywhere: {
    emoji: '🌐', title: 'info.everywhere.title',
    key: [
      { icon: 'pin', label: 'info.everywhere.key.pin' },
      { icon: 'stack', label: 'info.everywhere.key.stack' },
      { icon: 'filter', label: 'info.everywhere.key.filter' },
    ],
    what: ['info.everywhere.what.1', 'info.everywhere.what.2'], art: 'pins',
    more: ['info.everywhere.more.1', 'info.everywhere.more.2'],
  },
  relief: {
    key: [
      { token: '--c-relief-high', label: 'info.relief.key.high', short: '⛰️' },
      { token: '--c-relief-dry', label: 'info.relief.key.dry', short: '🏜️' },
      { token: '--c-relief-low', label: 'info.relief.key.low', short: '🌿' },
    ],
    what: ['info.relief.what.1'], art: 'mountain',
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
    key: [{ token: '--c-reef', label: 'info.reefs.key.reef', short: '🪸' }],
    what: ['info.reefs.what.1', 'info.reefs.what.2'], art: 'reef',
    more: ['info.reefs.more.1'],
  },
  night: {
    key: [
      { token: '--c-map-land', label: 'info.night.key.day', short: '☀️' },
      { token: '--c-twilight', label: 'info.night.key.twilight', short: '🌅' },
      { token: '--c-night', label: 'info.night.key.night', short: '🌙' },
      { token: '--c-city-lights', label: 'info.night.key.lights', short: '✨' },
    ],
    what: ['info.night.what.1', 'info.night.what.2'], art: 'sunEarth',
    more: ['info.night.more.1'],
  },
  temp: {
    key: 'temp',
    what: ['info.temp.what.1', 'info.temp.what.2'], art: 'thermometer',
    more: ['info.temp.more.1', 'info.temp.more.year'],
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
  const keys = new Set(['info.what', 'info.more', 'info.collapse', 'info.expand', 'info.habitat', 'info.zones', 'info.everywhere.title']);
  for (const info of Object.values(INFO)) {
    if (info.title) keys.add(info.title);
    if (Array.isArray(info.key)) for (const k of info.key) keys.add(k.label);
    for (const k of [...info.what, ...info.more]) keys.add(k);
    for (const z of info.zones ?? []) { keys.add(z.sci); keys.add(z.animal.name); }
  }
  return [...keys];
}

// The key's labels (for the "no sentences in the collapsed key" check).
export const keyLabels = id => (Array.isArray(INFO[id]?.key) ? INFO[id].key.map(k => k.label) : []);
