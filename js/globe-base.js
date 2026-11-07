// The globe's base layers: every full-surface layer through one small WebGL 1 shader, on a canvas
// under the 2D ones, so they all look like the same globe. If WebGL isn't there or its context is
// lost, js/globe.js falls back to the 2D canvas and js/globegl.js.
//
// One full-screen triangle; the fragment shader turns each pixel into a point on the sphere with
// the same basis B as js/globe.js, so the picture and the 2D outlines can't drift apart. Shared by
// every layer: the ocean colour, the land mask and hillshade (shade-2k.webp; the light is baked into
// it, from the north west) and a thin atmosphere (a gradient, no blur).
//
// A layer is a texture and options (see gpu() in js/layers.js):
//   { kind: 'flat', hill, night? }           land and sea in flat colours; night: { sun, shade, twilight }
//   { kind: 'picture', tex, hill, tiles? }   a picture on the land, the shared ocean around it
//   { kind: 'ramp', tex, stops, bands, hill, sea? } a number per pixel (1…255 along the scale), coloured by
//                                            the scale, smoothly or in `bands` steps; sea: land stays land
//   { kind: 'classes', tex, colours, hill }  up to three coverages, one to a channel, on the land
//   { kind: 'months', stops, bands, hill, pos } Temperature (js/globe-months.js). Two months' numbers are
//                                            mixed first and coloured after, so band edges move
//
// No mipmaps on full-world textures: WebGL 1 can't say what to sample across the jump at 180°, so
// mipmaps would show a seam. A 2048 px texture on a whole globe is about one texel a pixel, and
// shrinks only towards the rim. The zoom tiles' atlas has them: it has no such jump.
import { slotOf, blendAt, heldBlend, fetchOrder, ease, nearestMonth, MONTH_FILES, MONTH_MIN, MONTH_MAX, MORPH_MS } from './globe-months.js';

const RIM = 0.07;       // the atmosphere, as a share of the radius
const RAMP_N = 256;
const KINDS = { flat: 0, picture: 1, ramp: 2, classes: 3, months: 4 };

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uCentre;     // globe centre, CSS px from the top left
uniform float uR, uDpr, uH;
uniform vec3 uE, uN, uC;  // east, north and centre of the view, as world vectors
uniform sampler2D uLayer, uShade, uRamp, uLayerB, uDetail;
uniform int uKind;
uniform float uBands, uHill, uSeaOnly, uMix, uAppear;
uniform vec4 uChA, uChB;  // which channel holds each month
uniform vec2 uRange;      // a month's byte to the scale: scale = byte * x + y
uniform vec3 uOcean, uLand, uClass0, uClass1, uClass2;
uniform vec4 uGlow;
uniform float uNight;     // 1: day and night
uniform vec3 uSun, uNightC, uTwilightC;
uniform float uDetailOn;
uniform vec4 uWin;        // detail window: first column, first row, columns, rows (tiles)
uniform vec2 uGrid;       // tiles across and down the whole map
const float PI = 3.14159265;

vec3 ramped(float v) {
  if (uBands > 0.0) v = (min(floor(v * uBands), uBands - 1.0) + 0.5) / uBands;
  return texture2D(uRamp, vec2(v, 0.5)).rgb;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uH - gl_FragCoord.y / uDpr); // CSS px, y down
  vec2 q = vec2(p.x - uCentre.x, uCentre.y - p.y) / uR;
  float d = length(q);
  if (d >= 1.0) {
    float a = 1.0 - (d - 1.0) / ${RIM.toFixed(3)};
    if (a <= 0.0) discard;
    gl_FragColor = vec4(uGlow.rgb, 1.0) * uGlow.a * a;
    return;
  }
  vec3 w = q.x * uE + q.y * uN + sqrt(1.0 - d * d) * uC;
  vec2 uv = vec2(atan(w.y, w.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(w.z, -1.0, 1.0)) / PI);
  vec4 shade = texture2D(uShade, uv); // red: hillshade, 0.5 is flat. green: land.
  vec3 plain = mix(uOcean, uLand, shade.g);
  vec3 col = plain;
  if (uKind == 1) {
    vec3 pic = texture2D(uLayer, uv).rgb;
    if (uDetailOn > 0.5) {
      vec2 t = uv * uGrid;
      vec2 at = vec2(mod(t.x - uWin.x + uGrid.x, uGrid.x), t.y - uWin.y);
      if (at.x < uWin.z && at.y >= 0.0 && at.y < uWin.w) {
        vec4 tile = texture2D(uDetail, at / uWin.zw);
        pic = mix(pic, tile.rgb / max(tile.a, 0.0001), tile.a);
      }
    }
    col = mix(uOcean, pic, shade.g);
  } else if (uKind == 2) {
    float v = clamp((texture2D(uLayer, uv).r * 255.0 - 1.0) / 254.0, 0.0, 1.0);
    col = ramped(v);
    if (uSeaOnly > 0.5) col = mix(col, uLand, shade.g);
  } else if (uKind == 3) {
    vec3 c = texture2D(uLayer, uv).rgb;
    col = mix(col, uClass0, c.r * shade.g);
    col = mix(col, uClass1, c.g * shade.g);
    col = mix(col, uClass2, c.b * shade.g);
  } else if (uKind == 4) {
    float a = dot(texture2D(uLayer, uv), uChA), b = dot(texture2D(uLayerB, uv), uChB);
    float v = clamp(mix(a, b, uMix) * uRange.x + uRange.y, 0.0, 1.0);
    col = mix(plain, ramped(v), uAppear);
  }
  col *= 1.0 + uHill * (shade.r - 0.5) * 2.0;
  if (uNight > 0.5) {
    float s = dot(w, uSun);
    float alpha = 0.66 * (1.0 - smoothstep(-0.22, 0.06, s)), dark = 1.0 - smoothstep(-0.3, 0.02, s);
    col = mix(col, mix(uTwilightC, uNightC, dark), alpha);
  }
  float edge = clamp((1.0 - d) * uR * uDpr, 0.0, 1.0); // a smooth edge, one pixel
  gl_FragColor = vec4(col, 1.0) * edge;
}`;

const NAMES = ['uCentre', 'uR', 'uDpr', 'uH', 'uE', 'uN', 'uC', 'uLayer', 'uShade', 'uRamp', 'uLayerB', 'uDetail', 'uKind', 'uBands', 'uHill', 'uSeaOnly',
  'uMix', 'uAppear', 'uChA', 'uChB', 'uRange', 'uOcean', 'uLand', 'uClass0', 'uClass1', 'uClass2', 'uGlow', 'uNight', 'uSun', 'uNightC', 'uTwilightC', 'uDetailOn', 'uWin', 'uGrid'];

// The colour scale as n RGBA pixels, evenly from its first value to its last.
//   stops: [{ v, colour: '#rrggbb' }]
export function rampBytes(stops, n = RAMP_N) {
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const lo = stops[0].v, hi = stops[stops.length - 1].v, out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = lo + ((hi - lo) * i) / (n - 1);
    const b = Math.max(1, stops.findIndex(s => v <= s.v)), from = stops[b - 1], to = stops[b];
    const t = (v - from.v) / (to.v - from.v), x = rgb(from.colour), y = rgb(to.colour);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(x[k] + (y[k] - x[k]) * t);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// A month's byte (0 to 1 in the shader) to its place on the scale: scale = byte * x + y.
export function monthRange(stops) {
  const lo = stops[0].v, hi = stops[stops.length - 1].v, perByte = (MONTH_MAX - MONTH_MIN) / 254;
  return [(255 * perByte) / (hi - lo), (MONTH_MIN - perByte - lo) / (hi - lo)];
}

// The GPU memory a texture takes, in bytes: RGBA, no mipmaps.
export const textureBytes = (w, h) => w * h * 4;

// Any CSS colour as [r, g, b, a], 0 to 1.
const seen = new Map();
function rgba(css) {
  if (!seen.has(css)) {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    c.fillStyle = css;
    c.fillRect(0, 0, 1, 1);
    seen.set(css, [...c.getImageData(0, 0, 1, 1).data].map(v => v / 255));
  }
  return seen.get(css);
}
const rgb3 = css => rgba(css).slice(0, 3);

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`could not load ${url}`));
  img.src = url;
});

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// canvas: the (empty) canvas to draw into. colours: { sea, land, glow } as CSS. shade: the shared
// texture's url. onChange(usable): the context was lost or came back. onDraw(): something arrived.
// still: reduced motion. Returns null where WebGL or high precision isn't there.
export function createBase(canvas, { colours, shade, onChange, onDraw, still = false }) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) return null;
  let loc = null, lost = false, gone = false;
  let layer = null, asked = null; // what is drawn, and what was last asked for
  let layerTex = null;            // { url, tex }
  let shadeTex = null, rampTex = null, rampOf = null;
  let detail = null;              // the zoom tiles' atlas: { tex, w, h, zeros, win, grid, tile }
  // Temperature: the textures here, the place wanted, a morph under way, the month last shown, and
  // when the first texture came (the layer fades in from the plain map then).
  const months = [null, null, null], fetching = new Set();
  let monthsWanted = false, monthFirst = 1;
  let goal = 1, morph = null, lastMonth = null, appearAt = 0;

  function setup() {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    loc = Object.fromEntries(NAMES.map(n => [n, gl.getUniformLocation(prog, n)]));
    ['uLayer', 'uShade', 'uRamp', 'uLayerB', 'uDetail'].forEach((n, i) => gl.uniform1i(loc[n], i));
    gl.uniform3f(loc.uOcean, ...rgb3(colours.sea));
    gl.uniform3f(loc.uLand, ...rgb3(colours.land));
    gl.uniform4f(loc.uGlow, ...rgba(colours.glow));
    // Numbers must arrive as they are in the file.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  function makeTexture(wrap) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  // wrap: gl.REPEAT needs a power-of-two size in WebGL 1; the month textures aren't.
  async function imageTexture(url, wrap = gl.REPEAT) {
    const img = await loadImage(url);
    if (lost || gone) return null;
    const tex = makeTexture(wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return tex;
  }
  function rampTexture(stops) {
    const key = JSON.stringify(stops);
    if (rampOf === key) return;
    if (rampTex) gl.deleteTexture(rampTex);
    rampTex = makeTexture(gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, RAMP_N, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rampBytes(stops));
    rampOf = key;
  }
  const dropDetail = () => { if (detail) { gl.deleteTexture(detail.tex); detail = null; } };

  const hasMonth = m => Boolean(months[slotOf(m).tex]);
  // A texture came: the place wanted may now be in reach, so morph to it.
  function landed() {
    if (layer?.kind === 'months') {
      appearAt ||= performance.now();
      const m = nearestMonth(goal);
      if (!still && lastMonth && lastMonth !== m && hasMonth(m)) morph = { from: lastMonth, to: m, t0: performance.now() };
    }
    onDraw?.();
  }
  // The month textures, this month's first, one at a time so they don't compete with the page.
  async function fetchMonths() {
    for (const i of fetchOrder(monthFirst)) {
      if (months[i] || fetching.has(i)) continue;
      fetching.add(i);
      try {
        const tex = await imageTexture(MONTH_FILES[i], gl.CLAMP_TO_EDGE);
        if (tex) { months[i] = tex; landed(); }
      } catch { /* offline: the months here carry on */ } finally { fetching.delete(i); }
    }
  }

  // The texture for what is asked for; only then does it take over, so nothing goes blank.
  async function load(def) {
    shadeTex ??= await imageTexture(shade).catch(() => null); // offline the first time: the 2D canvas draws
    if (def.kind === 'months') { goal = def.pos ?? goal; monthFirst = nearestMonth(goal); monthsWanted = true; fetchMonths(); }
    const tex = def.tex && layerTex?.url !== def.tex ? await imageTexture(def.tex) : null;
    if (def !== asked || lost || gone) { if (tex) gl.deleteTexture(tex); return; }
    if (tex || !def.tex) { if (layerTex) gl.deleteTexture(layerTex.tex); layerTex = tex ? { url: def.tex, tex } : null; }
    if (def.stops) rampTexture(def.stops);
    if (def.kind !== 'picture') dropDetail();
    layer = def;
    // Months already here: nothing to fade in from.
    if (def.kind === 'months') appearAt = months.some(Boolean) ? performance.now() - MORPH_MS : 0;
  }

  try { setup(); } catch { return null; }

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    lost = true;
    shadeTex = rampTex = rampOf = layerTex = detail = null;
    months.fill(null);
    canvas.hidden = true;
    onChange?.(false);
  });
  canvas.addEventListener('webglcontextrestored', async () => {
    lost = false;
    try {
      setup();
      if (asked) await load(asked);
      if (monthsWanted) fetchMonths();
    } catch { lost = true; return; }
    onChange?.(true);
  });

  return {
    get lost() { return lost; },
    // Resolves once it can be drawn; what was showing stays until then.
    async set(def) {
      asked = def;
      if (!lost) await load(def);
    },
    update(patch) {
      if (layer?.night && patch.sun) layer.night = { ...layer.night, ...patch };
    },
    // Fetch the months now (idle time), starting with this one.
    loadMonths(first) { monthFirst = first; monthsWanted = true; if (!lost) fetchMonths(); },
    // To this place in the year: at once, or morphing there over ms.
    month(pos, ms = 0) {
      goal = pos;
      const to = nearestMonth(pos);
      morph = ms && !still && lastMonth && lastMonth !== to ? { from: lastMonth, to, t0: performance.now(), ms } : null;
    },
    // Whether this frame can come from here.
    ready: () => Boolean(!lost && layer && shadeTex && (!layer.tex || layerTex?.url === layer.tex)),
    // For js/globe-tiles.js, as js/globegl.js has. A new detail window (null: none); it starts clear.
    setDetail(win, grid, tile) {
      if (lost) return;
      if (!win) { dropDetail(); return; }
      const w = win[2] * tile, h = win[3] * tile;
      if (!detail || detail.w !== w || detail.h !== h) {
        dropDetail();
        const tex = makeTexture(gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        detail = { tex, w, h, zeros: new Uint8Array(w * h * 4) };
      }
      gl.bindTexture(gl.TEXTURE_2D, detail.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, detail.zeros);
      gl.generateMipmap(gl.TEXTURE_2D);
      Object.assign(detail, { win, grid, tile });
    },
    putTile(x, y, img) {
      if (lost || !detail) return;
      gl.bindTexture(gl.TEXTURE_2D, detail.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x * detail.tile, y * detail.tile, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    // B: the basis from globe.js for this frame; size: { w, h, dpr }. Returns whether it is still
    // moving by itself, and so wants another frame.
    draw(B, size) {
      const W = Math.round(size.w * size.dpr), H = Math.round(size.h * size.dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      if (canvas.hidden) canvas.hidden = false;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.uCentre, B.cx, B.cy);
      gl.uniform1f(loc.uR, B.r);
      gl.uniform1f(loc.uDpr, size.dpr);
      gl.uniform1f(loc.uH, H / size.dpr);
      gl.uniform3f(loc.uE, B.e0, B.e1, 0);
      gl.uniform3f(loc.uN, B.n0, B.n1, B.n2);
      gl.uniform3f(loc.uC, B.c0, B.c1, B.c2);
      gl.uniform1f(loc.uBands, layer.bands ?? 0);
      gl.uniform1f(loc.uHill, layer.hill ?? 0);
      gl.uniform1f(loc.uSeaOnly, layer.sea ? 1 : 0);
      layer.colours?.forEach((c, i) => gl.uniform3f(loc[`uClass${i}`], ...rgb3(c)));
      const { night } = layer;
      gl.uniform1f(loc.uNight, night ? 1 : 0);
      if (night) {
        gl.uniform3f(loc.uSun, ...night.sun);
        gl.uniform3f(loc.uNightC, ...rgb3(night.shade));
        gl.uniform3f(loc.uTwilightC, ...rgb3(night.twilight));
      }
      const on = Boolean(detail?.win) && layer.kind === 'picture';
      gl.uniform1f(loc.uDetailOn, on ? 1 : 0);
      if (on) {
        gl.uniform4f(loc.uWin, ...detail.win);
        gl.uniform2f(loc.uGrid, ...detail.grid);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, detail.tex);
      }
      let kind = KINDS[layer.kind], first = layerTex?.tex ?? shadeTex, second = shadeTex, moving = false;
      if (layer.kind === 'months') {
        const now = performance.now();
        let blend = blendAt(goal);
        if (morph) {
          const t = Math.min(1, (now - morph.t0) / (morph.ms ?? MORPH_MS));
          blend = { a: morph.from, b: morph.to, mix: ease(t) };
          if (t >= 1) morph = null; else moving = true;
        }
        const shown = heldBlend(blend, hasMonth, lastMonth);
        if (shown) {
          const a = slotOf(shown.a), b = slotOf(shown.b), one = ch => [0, 1, 2, 3].map(i => (i === ch ? 1 : 0));
          first = months[a.tex];
          second = months[b.tex];
          gl.uniform4f(loc.uChA, ...one(a.ch));
          gl.uniform4f(loc.uChB, ...one(b.ch));
          gl.uniform1f(loc.uMix, shown.mix);
          gl.uniform2f(loc.uRange, ...monthRange(layer.stops));
          const appear = still ? 1 : Math.min(1, (now - appearAt) / MORPH_MS);
          gl.uniform1f(loc.uAppear, ease(appear));
          if (appear < 1) moving = true;
          if (!morph) lastMonth = shown.mix < 0.5 ? shown.a : shown.b;
        } else kind = KINDS.flat;
      }
      gl.uniform1i(loc.uKind, kind);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, first);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadeTex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rampTex ?? shadeTex);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, second);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return moving;
    },
    destroy() { gone = true; gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
