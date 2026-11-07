// A spike, only with ?globe=webgl: every full-surface layer through one small WebGL 1 shader, on a
// canvas under the 2D ones, so they all look like the same globe. js/globegl.js is what ships.
//
// One full-screen triangle; the fragment shader turns each pixel into a point on the sphere with
// the same basis B as js/globe.js, so the picture and the 2D outlines can't drift apart. Shared by
// every layer: the ocean colour, the land mask and hillshade (shade-2k.webp; the light is baked into
// it, from the north west) and a thin atmosphere (a gradient, no blur).
//
// A layer is a texture and options (see BASE in js/layers.js):
//   { kind: 'flat', hill }                 land and sea in flat colours (the plain map)
//   { kind: 'picture', tex, hill }         a picture on the land, the shared ocean around it
//   { kind: 'ramp', tex, stops, hill, bands } a number per pixel (0: none, 1…255 along the scale),
//                                          coloured by the scale, smoothly or in `bands` steps
//
// No mipmaps: WebGL 1 can't say what to sample across the jump at 180°, so mipmaps would show a seam.
// A 2048 px texture on a whole globe is about one texel a pixel, and shrinks only towards the rim.

export const BASE_DPR = 1.5;
const RIM = 0.07;       // the atmosphere, as a share of the radius
const RAMP_N = 256;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uCentre;     // globe centre, CSS px from the top left
uniform float uR, uDpr, uH;
uniform vec3 uE, uN, uC;  // east, north and centre of the view, as world vectors
uniform sampler2D uLayer, uShade, uRamp;
uniform int uKind;        // 0 flat, 1 picture, 2 ramp
uniform float uBands, uHill;
uniform vec3 uOcean, uLand;
uniform vec4 uGlow;
const float PI = 3.14159265;

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
  vec3 col = mix(uOcean, uLand, shade.g);
  if (uKind == 1) {
    col = mix(uOcean, texture2D(uLayer, uv).rgb, shade.g);
  } else if (uKind == 2) {
    float t = texture2D(uLayer, uv).r;
    if (t > 0.002) {
      float v = clamp((t * 255.0 - 1.0) / 254.0, 0.0, 1.0);
      if (uBands > 0.0) v = (min(floor(v * uBands), uBands - 1.0) + 0.5) / uBands;
      col = texture2D(uRamp, vec2(v, 0.5)).rgb;
    }
  }
  col *= 1.0 + uHill * (shade.r - 0.5) * 2.0;
  float edge = clamp((1.0 - d) * uR * uDpr, 0.0, 1.0); // a smooth edge, one pixel
  gl_FragColor = vec4(col, 1.0) * edge;
}`;

const NAMES = ['uCentre', 'uR', 'uDpr', 'uH', 'uE', 'uN', 'uC', 'uLayer', 'uShade', 'uRamp', 'uKind', 'uBands', 'uHill', 'uOcean', 'uLand', 'uGlow'];

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

// What a pixel of a ramp texture says, in the scale's units; null where there is no value.
export function rampValue(byte, stops) {
  if (!byte) return null;
  const lo = stops[0].v, hi = stops[stops.length - 1].v;
  return lo + ((byte - 1) / 254) * (hi - lo);
}

// The GPU memory a layer takes, in bytes: RGBA, no mipmaps.
export const textureBytes = (w, h) => w * h * 4;

// Any CSS colour as [r, g, b, a], 0 to 1.
function rgba(css) {
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  c.fillStyle = css;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, a / 255];
}

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
// texture's url. onChange(usable): the context was lost or came back.
// Returns null where WebGL or high precision isn't there, and the 2D globe carries on.
export function createBase(canvas, { colours, shade, onChange }) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl || !gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) return null;
  const ocean = rgba(colours.sea), land = rgba(colours.land), glow = rgba(colours.glow);
  let loc = null, lost = false, gone = false;
  let layer = null;      // what is asked for
  let layerTex = null;   // { def, tex } once it is on the GPU
  let shadeTex = null, rampTex = null, rampOf = null;

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
    gl.uniform1i(loc.uLayer, 0);
    gl.uniform1i(loc.uShade, 1);
    gl.uniform1i(loc.uRamp, 2);
    gl.uniform3f(loc.uOcean, ...ocean.slice(0, 3));
    gl.uniform3f(loc.uLand, ...land.slice(0, 3));
    gl.uniform4f(loc.uGlow, ...glow);
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
  async function imageTexture(url) {
    const img = await loadImage(url);
    if (lost || gone) return null;
    const tex = makeTexture(gl.REPEAT);
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

  // The shared texture and the layer asked for, on the GPU; the layer before goes.
  async function load() {
    const def = layer;
    shadeTex ??= await imageTexture(shade);
    if (def?.stops) rampTexture(def.stops);
    if (layerTex && layerTex.def?.tex !== def?.tex) { gl.deleteTexture(layerTex.tex); layerTex = null; }
    if (def?.tex && !layerTex) {
      const tex = await imageTexture(def.tex);
      if (!tex) return;
      if (layer !== def) { gl.deleteTexture(tex); return; }
      layerTex = { def, tex };
    } else if (layerTex) layerTex.def = def;
  }

  try { setup(); } catch { return null; }

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    lost = true;
    shadeTex = rampTex = rampOf = layerTex = null;
    canvas.hidden = true;
    onChange?.(false);
  });
  canvas.addEventListener('webglcontextrestored', async () => {
    lost = false;
    try { setup(); await load(); } catch { lost = true; return; }
    canvas.hidden = false;
    onChange?.(true);
  });

  return {
    get lost() { return lost; },
    // Resolves once it can be drawn. null: nothing here (the layer stays with the 2D canvas).
    async set(def) {
      layer = def;
      canvas.hidden = !def || lost;
      if (def && !lost) await load();
    },
    // Whether this frame can come from here.
    ready: () => Boolean(!lost && layer && shadeTex && (!layer.tex || layerTex?.def === layer)),
    // B: the basis from globe.js for this frame; size: { w, h, dpr }.
    draw(B, size) {
      const W = Math.round(size.w * size.dpr), H = Math.round(size.h * size.dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
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
      gl.uniform1i(loc.uKind, { flat: 0, picture: 1, ramp: 2 }[layer.kind]);
      gl.uniform1f(loc.uBands, layer.bands ?? 0);
      gl.uniform1f(loc.uHill, layer.hill ?? 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layerTex?.tex ?? shadeTex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shadeTex);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, rampTex ?? shadeTex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() { gone = true; gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
