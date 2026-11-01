// "Where in the world" maps. The land shape is assets/world.svg (an equirectangular
// projection made by scripts/make-map.mjs) used as a CSS mask, so colours come from tokens.
import { h } from './dom.js';

// Must match MAP in scripts/make-map.mjs.
const MAP = { north: 84, south: -58 };
const LAT_SPAN = MAP.north - MAP.south;

const fx = lon => (lon + 180) / 360;
const fy = lat => (MAP.north - lat) / LAT_SPAN;

// map: { areas: [{ lon, lat, r }], zoom?: { lon, lat, scale } }
export function worldMap(map, { zoomed = false, label } = {}) {
  if (!map?.areas?.length) return null;
  const scale = zoomed && map.zoom ? map.zoom.scale : 1;
  const world = h('div', { class: 'map__world' }, h('div', { class: 'map__land' }),
    map.areas.map(a => h('span', {
      class: 'map__spot',
      style: { left: `${fx(a.lon) * 100}%`, top: `${fy(a.lat) * 100}%` },
    })));

  if (scale > 1) {
    const cx = fx(map.zoom.lon), cy = fy(map.zoom.lat);
    const clampPos = v => Math.min(0, Math.max(100 - scale * 100, v));
    world.style.setProperty('width', `${scale * 100}%`);
    world.style.setProperty('height', `${scale * 100}%`);
    world.style.setProperty('left', `${clampPos(50 - cx * scale * 100)}%`);
    world.style.setProperty('top', `${clampPos(50 - cy * scale * 100)}%`);
  }
  return h('div', { class: ['map', zoomed && 'map--zoomed'], role: 'img', 'aria-label': label ?? '' }, world);
}
