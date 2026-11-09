// Day & night on the globe without WebGL (js/globe.js drawNight): the city lights file, the
// night shade across the twilight band, the lights fading in, and how many show at each zoom.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { nightShade, lightsOn, lightCount, LIGHTS_FAR, NIGHT_ALPHA } from '../js/globe.js';
import { sunVector, sunAt } from '../js/layers.js';

const src = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const lights = JSON.parse(src('assets/layers/lights.json'));
const P = lights.points, N = P.length / 3;

test('lights.json: a few thousand lights, [lon, lat, brightness], brightest first', () => {
  assert.equal(P.length % 3, 0);
  assert.ok(N >= 2000 && N <= 8000, `${N} lights`);
  assert.equal(lights.unit, 0.01);
  for (let i = 0; i < P.length; i += 3) {
    assert.ok(Math.abs(P[i]) <= 18000 && Math.abs(P[i + 1]) <= 9000, `point ${i / 3} on the map`);
    assert.ok(P[i + 2] >= 1 && P[i + 2] <= 99, 'brightness 1–99');
    if (i) assert.ok(P[i + 2] <= P[i - 1], 'brightest first');
  }
  assert.ok(readFileSync(new URL('../assets/layers/lights.json', import.meta.url)).length < 120 * 1024, 'small');
});

test('the lights are where people live: Taiwan\'s west coast lit, the open ocean dark', () => {
  let taiwan = 0, pacific = 0;
  for (let i = 0; i < P.length; i += 3) {
    const lon = P[i] / 100, lat = P[i + 1] / 100;
    if (lon > 119.9 && lon < 122.1 && lat > 21.8 && lat < 25.4) taiwan++;
    if (lon > -160 && lon < -130 && lat > -30 && lat < 10) pacific++;
  }
  assert.ok(taiwan >= 15, `${taiwan} lights over Taiwan`);
  assert.equal(pacific, 0, 'none in the middle of the Pacific');
});

test('the night side: clear by day, twilight at the terminator, fully dark from about 13° down', () => {
  const at = deg => nightShade(Math.sin((deg * Math.PI) / 180));
  assert.equal(at(30).alpha, 0, 'day');
  assert.equal(at(5).alpha, 0, 'the sun still up: day');
  const dusk = at(0), deep = at(-15);
  assert.ok(dusk.alpha > 0 && dusk.alpha < NIGHT_ALPHA, 'dusk at the terminator: partly dark');
  assert.ok(dusk.dark < 0.5, 'dusk is the twilight colour');
  assert.ok(Math.abs(deep.alpha - NIGHT_ALPHA) < 1e-9, 'night');
  assert.ok(deep.dark > 0.9, 'night is the night colour');
  assert.ok(NIGHT_ALPHA < 1, 'translucent: the map still shows at night');
  // Darker all the way from day to night, never lighter again.
  let prev = -1;
  for (let d = 1; d >= -1; d -= 0.01) { const a = nightShade(d).alpha; assert.ok(a >= prev - 1e-12); prev = a; }
});

test('the lights come on through the twilight', () => {
  const at = deg => lightsOn(Math.sin((deg * Math.PI) / 180));
  assert.equal(at(10), 0, 'off by day');
  assert.ok(at(-3) > 0 && at(-3) < 1, 'fading in at dusk');
  assert.equal(at(-10), 1, 'on at night');
});

test('fewer lights zoomed out, more zoomed in, all of them from zoom 4', () => {
  assert.equal(lightCount(1, N), Math.min(N, LIGHTS_FAR));
  assert.ok(lightCount(2, N) > lightCount(1, N));
  assert.equal(lightCount(4, N), N);
  assert.equal(lightCount(40, N), N);
});

test('the sun is overhead near the Tropic of Capricorn at the December solstice, at noon near 0°', () => {
  const [x, y, z] = sunVector(new Date('2026-12-21T12:00:00Z'));
  const lat = (Math.asin(z) * 180) / Math.PI, lon = (Math.atan2(y, x) * 180) / Math.PI;
  assert.ok(Math.abs(lat + 23.44) < 0.3, `latitude ${lat}`);
  assert.ok(Math.abs(lon) < 2, `longitude ${lon}`);
});

const latLon = ([x, y, z]) => [(Math.asin(z) * 180) / Math.PI, (Math.atan2(y, x) * 180) / Math.PI];
const angle = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

test('sunAt: a month and a UTC hour; the equinoxes on the equator, the solstices on the tropics', () => {
  const at = (m, hr) => latLon(sunAt(m, hr, { year: 2026 }));
  for (const [m, lat, tol] of [[3, 0, 0.6], [6, 23.44, 0.1], [9, 0, 0.8], [12, -23.44, 0.1]]) {
    const [la, lo] = at(m, 12);
    assert.ok(Math.abs(la - lat) < tol, `month ${m}: latitude ${la}`);
    assert.ok(Math.abs(lo) < 2.5, `month ${m} at 12:00 UTC: noon near 0°, at ${lo}`);
  }
  assert.ok(Math.abs(angle(at(6, 0)[1], 180)) < 2.5, 'at 00:00 UTC noon is on the far side');
  // An hour later, noon is 15° further west.
  assert.ok(Math.abs(angle(at(6, 13)[1], at(6, 12)[1]) + 15) < 0.1);
  // The same as sunVector for that moment; another day of the month.
  assert.deepEqual(sunAt(11, 5.5, { day: 9, year: 2026 }), sunVector(new Date('2026-11-09T05:30:00Z')));
});

test('midnight sun and polar night: lit all day in the north in June, dark all day in December', () => {
  const shade = (m, hr, lon, lat) => {
    const s = sunAt(m, hr, { year: 2026 }), c = Math.cos((lat * Math.PI) / 180);
    const v = [c * Math.cos((lon * Math.PI) / 180), c * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)];
    return nightShade(s[0] * v[0] + s[1] * v[1] + s[2] * v[2]).alpha;
  };
  for (let hr = 0; hr < 24; hr += 3) {
    assert.equal(shade(6, hr, 0, 80), 0, `June ${hr}:00 at 80° N: day`);
    assert.ok(Math.abs(shade(12, hr, 0, 80) - NIGHT_ALPHA) < 1e-9, `December ${hr}:00 at 80° N: night`);
    assert.equal(shade(12, hr, 0, -80), 0, `December ${hr}:00 at 80° S: day`);
  }
});

test('no night picture any more, and no WebGL night mode', () => {
  for (const s of ['2k', '4k']) assert.ok(!existsSync(new URL(`../assets/layers/night-${s}.webp`, import.meta.url)), `night-${s}.webp gone`);
  assert.doesNotMatch(src('js/globegl.js'), /night|uSun/);
  assert.doesNotMatch(src('js/layers.js'), /night-\$\{|mode: 'night'/);
});
