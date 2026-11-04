// Small drawings for the globe's info panel (js/views/globe.js): drawn for WildFile, as SVG
// built here, coloured with design tokens through the .art classes in css/app.css. No
// image files, nothing to fetch. Each function returns an <svg> (decorative: aria-hidden).
import { svg } from './dom.js';

const frame = (w, h, ...parts) => svg('svg', { class: 'art', viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true', focusable: 'false' }, ...parts);
const path = (d, cls) => svg('path', { d, class: cls });
const circle = (cx, cy, r, cls) => svg('circle', { cx, cy, r, class: cls });
const rect = (x, y, w, h, cls, rx = 0) => svg('rect', { x, y, width: w, height: h, rx, class: cls });
const text = (x, y, s, cls) => svg('text', { x, y, class: cls, 'text-anchor': 'middle' }, s);
const sunRays = (cx, cy, r) => Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
  return path(`M${cx + c * (r + 3)} ${cy + s * (r + 3)}L${cx + c * (r + 8)} ${cy + s * (r + 8)}`, 'art__ray');
});

// Everywhere: a photo pin, and pins close together shown as one with a number.
export function pins() {
  return frame(160, 70,
    rect(0, 0, 160, 70, 'art__sea', 10),
    path('M10 52C30 30 60 58 80 44C100 30 130 50 150 36L150 70L10 70Z', 'art__land'),
    circle(42, 30, 14, 'art__pin'), circle(42, 30, 10, 'art__pinface'),
    circle(110, 26, 14, 'art__pin'), circle(110, 26, 10, 'art__pinface'),
    circle(122, 14, 8, 'art__count'), text(122, 18, '3', 'art__counttext'));
}

// Topography: lowlands, dry hills, a high snowy peak.
export function mountain() {
  return frame(160, 80,
    rect(0, 0, 160, 80, 'art__sky', 10),
    path('M0 80L0 62C20 58 30 60 44 56L70 40L88 50L112 14L140 52L160 58L160 80Z', 'art__relief-low'),
    path('M70 40L88 50L100 32L112 14L126 34L140 52C120 50 96 52 70 40Z', 'art__relief-dry'),
    path('M112 14L100 32L106 30L112 34L118 30L126 34Z', 'art__relief-high'),
    path('M0 80L0 66C30 62 60 66 90 64C120 62 140 66 160 64L160 80Z', 'art__relief-low'));
}

// Forests: a tropical tree, a leafy temperate tree, a conifer of the cold north.
export function tree(kind) {
  if (kind === 'tropical') {
    return frame(40, 48, path('M19 46L19 24L21 24L21 46Z', 'art__trunk'),
      path('M20 26C8 26 4 18 8 12C10 6 18 4 22 6C30 4 36 12 32 18C36 24 30 28 20 26Z', 'art__forest-tropical'));
  }
  if (kind === 'temperate') {
    return frame(40, 48, path('M18.5 46L18.5 28L21.5 28L21.5 46Z', 'art__trunk'),
      circle(20, 20, 13, 'art__forest-temperate'));
  }
  return frame(40, 48, path('M19 46L19 38L21 38L21 46Z', 'art__trunk'),
    path('M20 4L30 18L25 18L33 30L26 30L34 40L6 40L14 30L7 30L15 18L10 18Z', 'art__forest-boreal'));
}
export function forests() {
  const a = tree('tropical'), b = tree('temperate'), c = tree('boreal');
  for (const [el, x] of [[a, 0], [b, 54], [c, 108]]) { el.setAttribute('x', x); el.setAttribute('width', 52); el.setAttribute('height', 62); }
  return frame(160, 66, a, b, c);
}

// Coral reefs: sunlight through warm, shallow, clear water down to the corals.
export function reef() {
  return frame(160, 80,
    rect(0, 0, 160, 22, 'art__sky'),
    circle(24, 11, 6, 'art__sun'), ...sunRays(24, 11, 6),
    rect(0, 22, 160, 58, 'art__shallow'),
    path('M30 28L44 70M60 26L70 68M92 26L98 68', 'art__beam'),
    path('M0 80L0 70C20 66 40 72 60 68C80 64 110 70 160 66L160 80Z', 'art__sand'),
    path('M40 70C38 60 34 56 36 50M40 70C42 60 46 58 44 50M40 62L48 56', 'art__coral-branch'),
    circle(76, 66, 7, 'art__coral'), circle(86, 68, 5, 'art__coral'),
    path('M112 70C110 58 114 52 120 48C118 56 122 60 120 70Z', 'art__coral'),
    path('M128 70C128 62 134 58 138 56C136 62 138 66 136 70Z', 'art__coral'));
}

// Day & night: the sun lights the half of the Earth that faces it.
export function sunEarth() {
  return frame(160, 80,
    rect(0, 0, 160, 80, 'art__space', 10),
    circle(22, 40, 12, 'art__sun'), ...sunRays(22, 40, 12),
    path('M40 26L84 26M40 40L84 40M40 54L84 54', 'art__beam'),
    circle(112, 40, 26, 'art__earth-day'),
    path('M112 14A26 26 0 0 1 112 66Z', 'art__earth-night'),
    circle(124, 34, 1.6, 'art__light'), circle(128, 46, 1.4, 'art__light'), circle(120, 52, 1.2, 'art__light'), circle(130, 30, 1, 'art__light'));
}

// Temperature: a thermometer between hot sun and cold snow.
export function thermometer() {
  return frame(160, 80,
    rect(0, 0, 160, 80, 'art__sky', 10),
    circle(30, 26, 10, 'art__sun'), ...sunRays(30, 26, 10),
    rect(74, 10, 12, 52, 'art__glass', 6), circle(80, 66, 9, 'art__glass'),
    rect(77, 26, 6, 40, 'art__mercury', 3), circle(80, 66, 6, 'art__mercury'),
    path('M126 30L134 38M134 30L126 38M130 26L130 42M122 34L138 34', 'art__snow'));
}

// Ocean depth: a slice of the sea, the light fading from the sunlit top to the dark trench.
export function oceanZones() {
  const bands = [0, 1, 2, 3, 4].map(i => rect(0, 10 + i * 16, 160, 16, `art__zone art__zone--${i}`));
  return frame(160, 96,
    rect(0, 0, 160, 10, 'art__sky'),
    circle(140, 6, 4, 'art__sun'),
    ...bands,
    path('M136 10L120 36M144 10L134 30', 'art__beam'),
    path('M0 96L0 88C30 84 60 86 80 82L92 66L104 90L112 86C130 84 150 88 160 86L160 96Z', 'art__seabed'));
}

// The example animal of each ocean zone (simple shapes, drawn for WildFile).
const ANIMALS = {
  turtle: () => frame(64, 40,
    path('M14 20C14 10 26 6 34 6C44 6 52 12 52 20C52 28 44 32 34 32C24 32 14 28 14 20Z', 'art__animal'),
    path('M52 18C58 16 62 18 62 21C62 24 58 25 52 23Z', 'art__animal'),
    path('M20 10L12 4M20 30L12 36M44 9L50 3M44 31L50 37', 'art__limb'),
    path('M24 14L32 12L40 14L42 22L34 26L26 24Z', 'art__shell')),
  nautilus: () => frame(64, 40,
    path('M40 20A16 16 0 1 1 24 6C32 6 38 12 38 20C38 26 33 30 27 30C22 30 18 26 18 21C18 17 21 14 25 14', 'art__shellline'),
    path('M40 22C46 22 54 24 58 30M40 26C46 28 52 32 54 36M40 18C46 16 52 16 56 14', 'art__limb')),
  anglerfish: () => frame(64, 40,
    path('M10 22C10 12 22 6 34 8C44 10 50 16 52 22C46 30 36 34 24 32C16 30 10 28 10 22Z', 'art__animal'),
    path('M52 22L62 14L62 30Z', 'art__animal'),
    path('M24 10C22 2 12 0 8 4', 'art__limb'), circle(8, 5, 2.4, 'art__light'),
    path('M14 24L18 22L20 26L24 23L26 27', 'art__teeth'), circle(22, 16, 1.6, 'art__eye')),
  dumbo: () => frame(64, 40,
    path('M20 18C20 8 26 4 32 4C38 4 44 8 44 18C44 24 40 28 32 28C24 28 20 24 20 18Z', 'art__animal'),
    path('M20 12C12 8 8 12 10 16C12 18 16 18 20 16M44 12C52 8 56 12 54 16C52 18 48 18 44 16', 'art__fin'),
    path('M24 27C22 32 18 34 16 38M29 28C28 33 27 35 26 39M35 28C36 33 37 35 38 39M40 27C42 32 46 34 48 38', 'art__limb'),
    circle(27, 16, 1.5, 'art__eye'), circle(37, 16, 1.5, 'art__eye')),
  snailfish: () => frame(64, 40,
    path('M8 20C8 12 18 8 28 10C40 12 54 16 60 20C54 24 40 28 28 30C18 32 8 28 8 20Z', 'art__animal-pale'),
    path('M30 10C38 6 48 10 56 18M30 30C38 34 48 30 56 22', 'art__fin'),
    circle(16, 18, 1.8, 'art__eye')),
};
export const animal = name => ANIMALS[name]?.() ?? null;

export const ART = { pins, mountain, forests, reef, sunEarth, thermometer, oceanZones };
