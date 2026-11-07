// Rough shapes of the continents, to light up the land inside them on a map when a card has no
// range of its own (js/worldmap.js). They only have to fall in the sea, or on the usual lines between
// continents: the land itself comes from assets/world.svg. [lon, lat] points; view: what to show.
export const CONTINENTS = {
  asia: {
    view: { west: 60, east: 150, south: -11, north: 60 },
    shape: [[60, 84], [180, 84], [180, 55], [150, 45], [150, 25], [141, -11.5], [95, -11.5], [60, 10], [45, 10], [43, 12.5],
      [34, 28], [34.2, 31.3], [35, 36], [26, 36], [26, 41], [30, 42.5], [41, 42], [48, 45], [52, 47], [60, 52]],
  },
  africa: {
    view: { west: -18, east: 52, south: -35, north: 37 },
    shape: [[-20, 35.95], [-5.5, 35.95], [10, 38.2], [12, 33], [33, 31.5], [34, 28], [43, 12.5], [53, 12], [60, -10], [52, -36], [15, -36], [-20, 5]],
  },
  europe: {
    view: { west: -11, east: 45, south: 36, north: 71 },
    shape: [[-30, 84], [60, 84], [60, 52], [52, 47], [48, 45], [41, 42], [30, 42.5], [26, 41], [26, 36], [10, 38.2], [-5.5, 35.95], [-30, 36]],
  },
  'north-america': {
    view: { west: -168, east: -52, south: 8, north: 72 },
    shape: [[-180, 75], [-100, 84], [-15, 84], [-15, 60], [-50, 40], [-75, 12], [-77.3, 7.5], [-83, 7], [-120, 20], [-180, 50]],
  },
  'south-america': {
    view: { west: -82, east: -34, south: -55, north: 13 },
    shape: [[-90, -5], [-77.3, 7.5], [-75, 12], [-60, 13], [-30, -5], [-50, -56], [-80, -56]],
  },
  oceania: {
    view: { west: 112, east: 179, south: -47, north: -1 },
    shape: [[112, -11.5], [141, -11.5], [141, 0], [180, 0], [180, -50], [112, -50]],
  },
};

// One view round all of a card's continents, or null.
export function continentsView(ids = []) {
  const views = ids.map(id => CONTINENTS[id]?.view).filter(Boolean);
  if (!views.length) return null;
  return {
    west: Math.min(...views.map(v => v.west)), east: Math.max(...views.map(v => v.east)),
    south: Math.min(...views.map(v => v.south)), north: Math.max(...views.map(v => v.north)),
  };
}
