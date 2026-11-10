// The fallback for picture layers on the Globe (relief, temperature), when js/globe-base.js can't
// run: a WebGL canvas between the sea-and-land canvas and the overlay canvas of js/globe.js. One full-screen triangle;
// the fragment shader turns each pixel into a point on the sphere (the same orthographic
// view as globe.js) and looks it up in an equirectangular texture.
//
// The context is only made when a picture layer is first switched on, and textures are
// let go as soon as their layer is switched off, so the plain globe costs nothing.
// Lighting is local only: relief gets bumps from a height map, never a darker rim.
//
// Relief's sea level (Topography, as in js/globe-base.js): with a floor, the sea's depth today a
// metre a byte (0 only on the land), the sea less deep than the level has gone down is dry land.
// The floor comes after the picture, and never stops it showing. With the floor and the sea's
// zones (sea: { tex: depth-2k.webp, colours: five [r, g, b] }) the picture's own water gives way to
// the zones, as on the base renderer.
//
// Zoomed in, relief can show a sharper picture (js/globe-tiles.js): a detail window of
// DETAIL × DETAIL tiles round the view's centre, in one texture (the atlas). Tiles not loaded
// yet are clear in the atlas, so the base picture shows there.

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCentre;     // globe centre, CSS px from the top left
uniform float uR, uDpr, uH;
uniform vec3 uE, uN, uC;  // east, north and centre of the view, as world vectors
uniform int uMode;        // 0 relief, 2 picture with alpha
uniform sampler2D uTex, uAux, uFrom;
uniform float uFade;      // 1: uTex alone; less: still crossfading from uFrom
uniform vec2 uAuxStep;    // one texel of uAux
uniform float uBump;
uniform vec3 uLight;
uniform sampler2D uDetail;
uniform vec4 uWin;        // detail window: first column, first row, columns, rows (tiles)
uniform vec2 uGrid;       // tiles across and down the whole map
uniform bool uDetailOn;
uniform sampler2D uFloor;
uniform bool uFloorOn;
uniform float uLevel;     // the sea level, m (below 0: lower than today)
uniform vec3 uDry;        // the land it leaves dry
uniform sampler2D uSeaZ;  // the ocean's zones (depth-2k.webp), and their colours
uniform bool uSeaOn;
uniform vec3 uSeaC[5];
out vec4 outColor;
const float PI = 3.14159265;

vec2 uvOf(vec3 w) { return vec2(atan(w.y, w.x) / (2.0 * PI) + 0.5, 0.5 - asin(clamp(w.z, -1.0, 1.0)) / PI); }

// Mipmapped lookup that doesn't show a seam where longitude jumps from 180 to -180.
vec4 look(sampler2D t, vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return textureGrad(t, uv, dx, dy);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uH - gl_FragCoord.y / uDpr); // CSS px, y down
  vec2 q = vec2(p.x - uCentre.x, uCentre.y - p.y) / uR;
  float rr = dot(q, q);
  if (rr > 1.0) discard;
  vec3 w = q.x * uE + q.y * uN + sqrt(1.0 - rr) * uC;
  vec2 uv = uvOf(w);
  float rim = clamp((1.0 - sqrt(rr)) * uR * uDpr, 0.0, 1.0); // smooth edge, one pixel

  // The texture coordinates' steps across a pixel, without the jump at 180° (as in look()).
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5);
  gy.x -= floor(gy.x + 0.5);

  vec4 col;
  if (uMode == 0) {
    vec3 base = look(uTex, uv).rgb;
    if (uDetailOn) {
      vec2 t = uv * uGrid;
      float c = mod(floor(t.x) - uWin.x + uGrid.x, uGrid.x), r = floor(t.y) - uWin.y;
      if (c < uWin.z && r >= 0.0 && r < uWin.w) {
        vec2 s = uGrid / uWin.zw;
        vec4 d = textureGrad(uDetail, (vec2(c, r) + fract(t)) / uWin.zw, gx * s, gy * s);
        base = mix(base, d.rgb / max(d.a, 1e-4), d.a);
      }
    }
    if (uFloorOn && uSeaOn) {
      float z = clamp((look(uSeaZ, uv).r * 255.0 - 1.0) / 254.0, 0.0, 1.0);
      base = mix(base, uSeaC[int(min(floor(z * 5.0), 4.0))], clamp(look(uFloor, uv).r * 255.0, 0.0, 1.0));
    }
    if (uFloorOn) {
      float deep = look(uFloor, uv).r * 255.0;
      base = mix(base, uDry, clamp(-uLevel - deep + 0.5, 0.0, 1.0) * clamp(-uLevel, 0.0, 1.0) * clamp(deep, 0.0, 1.0));
    }
    float hE = texture(uAux, uv + vec2(uAuxStep.x, 0.0)).r, hW = texture(uAux, uv - vec2(uAuxStep.x, 0.0)).r;
    float hN = texture(uAux, uv - vec2(0.0, uAuxStep.y)).r, hS = texture(uAux, uv + vec2(0.0, uAuxStep.y)).r;
    vec3 east = normalize(vec3(-w.y, w.x, 0.0) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(w, east);
    vec3 n = normalize(w - uBump * ((hE - hW) * east + (hN - hS) * north));
    float shade = dot(n, uLight) - dot(w, uLight); // only the bumps, not the sphere
    col = vec4(base * (1.0 + 1.6 * shade), 1.0);
  } else {
    vec4 t = look(uTex, uv);
    col = vec4(t.rgb * t.a, t.a);
    if (uFade < 1.0) {
      vec4 f = look(uFrom, uv);
      col = mix(vec4(f.rgb * f.a, f.a), col, uFade);
    }
  }
  outColor = col * rim;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const FADE_MS = 300;

// Pictures fetched ahead (Temperature's months), as files: decoded only when shown, since twelve
// decoded would be about 100 MB. Fetched one at a time, in idle time.
const fetched = new Map();
export async function preloadPictures(urls) {
  for (const url of urls) {
    if (fetched.has(url)) continue;
    const res = await fetch(url).catch(() => null);
    if (res?.ok) fetched.set(url, await res.blob());
  }
}

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`could not load ${url}`));
  img.src = url;
});

// canvas: the (empty) canvas to draw into. still: no crossfades. Returns null if WebGL 2 isn't available.
// onLoad(): a texture that came after its layer (the floor, the sea's zones) is here, so draw again.
export function createSphere(canvas, { still = false, onLoad } = {}) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return null;
  let prog = null, loc = null, lost = false;
  const textures = new Map(); // url -> { tex, w, h }

  function setup() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    loc = {};
    for (const n of ['uCentre', 'uR', 'uDpr', 'uH', 'uE', 'uN', 'uC', 'uMode', 'uTex', 'uAux', 'uAuxStep', 'uBump', 'uLight', 'uDetail', 'uWin', 'uGrid', 'uDetailOn', 'uFrom', 'uFade', 'uFloor', 'uFloorOn', 'uLevel', 'uDry', 'uSeaZ', 'uSeaOn', 'uSeaC']) {
      loc[n] = gl.getUniformLocation(prog, n);
    }
    gl.uniform1i(loc.uTex, 0);
    gl.uniform1i(loc.uAux, 1);
    gl.uniform1i(loc.uDetail, 2);
    gl.uniform1i(loc.uFrom, 3);
    gl.uniform1i(loc.uFloor, 4);
    gl.uniform1i(loc.uSeaZ, 5);
  }
  setup();

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; textures.clear(); detail = null; floor = floorWant = seaZ = seaWant = null; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); });

  // grey: one channel (R8), a quarter of the memory, kept out of the map so release() leaves it.
  async function texture(url, { grey = false } = {}) {
    if (!grey && textures.has(url)) return textures.get(url);
    const blob = fetched.get(url);
    const img = blob ? await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : await loadImage(url);
    if (lost) throw new Error('context lost');
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (grey) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const t = { tex, w: img.naturalWidth ?? img.width, h: img.naturalHeight ?? img.height };
    img.close?.();
    if (!grey) textures.set(url, t);
    return t;
  }

  let floor = null, floorWant = null, level = 0; // relief's floor: { url, tex }, the url coming, the sea level (m)
  let seaZ = null, seaWant = null;                // relief's sea zones: { url, tex }, the url coming
  // A one-channel texture that comes after its layer: held in get()/set(), let go with the layer.
  function later(url, get, set, want, setWant) {
    if (!url) { if (get()) gl.deleteTexture(get().tex); set(null); setWant(null); return; }
    if (get()?.url === url || want() === url) return;
    setWant(url);
    texture(url, { grey: true }).then(t => {
      if (want() !== url || lost) { gl.deleteTexture(t.tex); return; }
      if (get()) gl.deleteTexture(get().tex);
      set({ url, tex: t.tex });
      onLoad?.();
    }).catch(() => { if (want() === url) setWant(null); });
  }
  const useFloor = url => later(url, () => floor, v => { floor = v; }, () => floorWant, v => { floorWant = v; });
  const useSea = url => later(url, () => seaZ, v => { seaZ = v; }, () => seaWant, v => { seaWant = v; });

  // Free every texture not in keep.
  function release(keep) {
    for (const [url, t] of textures) if (!keep.includes(url)) { gl.deleteTexture(t.tex); textures.delete(url); }
  }

  let spec = null; // { mode, tex, aux, bump }
  let fade = null;  // crossfading from: { url, t0 }
  let setting = 0;

  // The detail atlas: { tex, win: [col, row, cols, rows], grid: [cols, rows], tile (px) }.
  let detail = null;
  function dropDetail() { if (detail) { gl.deleteTexture(detail.tex); detail = null; } }

  return {
    // spec: { mode: 'relief' | 'picture', tex: url, aux?: url (height map), bump? } or null.
    // Resolves once loaded. What was showing stays until then, and a picture crossfades to the next.
    async set(next) {
      const mine = ++setting, urls = next ? [next.tex, next.aux].filter(Boolean) : [];
      await Promise.all(urls.map(texture));
      if (mine !== setting) return;
      const was = spec;
      spec = next;
      if (next?.mode !== 'relief') dropDetail();
      useFloor(next?.mode === 'relief' ? next.floor?.tex : null);
      useSea(next?.mode === 'relief' ? next.sea?.tex : null);
      fade = !still && was?.mode === 'picture' && next?.mode === 'picture' && was.tex !== next.tex ? { url: was.tex, t0: performance.now() } : null;
      release(fade ? [...urls, fade.url] : urls);
    },
    update(patch) { if (spec) Object.assign(spec, patch); },
    // Relief's sea level, m: below 0 the sea that lower is dry.
    seaLevel(m) { level = m; },
    // A new detail window (null: none). The atlas starts clear; putTile fills it.
    setDetail(win, grid, tile) {
      if (lost) return;
      if (!win) { dropDetail(); return; }
      const w = win[2] * tile, h = win[3] * tile;
      if (!detail || detail.w !== w || detail.h !== h) {
        dropDetail();
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, Math.log2(Math.max(w, h)) + 1, gl.RGBA8, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        detail = { tex, w, h };
      }
      // Clear: where no tile is, the base picture shows.
      gl.bindTexture(gl.TEXTURE_2D, detail.tex);
      if (detail.zeros?.length !== w * h * 4) detail.zeros = new Uint8Array(w * h * 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, detail.zeros);
      gl.generateMipmap(gl.TEXTURE_2D);
      Object.assign(detail, { win, grid, tile });
    },
    // One tile's picture into its place in the window (x, y: its place, in tiles).
    putTile(x, y, img) {
      if (lost || !detail) return;
      gl.bindTexture(gl.TEXTURE_2D, detail.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x * detail.tile, y * detail.tile, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    // B: the basis from globe.js for this frame; size: { w, h, dpr }. Returns whether it is still
    // crossfading, and so wants another frame.
    draw(B, size) {
      if (lost) return false;
      const W = Math.round(size.w * size.dpr), H = Math.round(size.h * size.dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const tex = spec && textures.get(spec.tex);
      const aux = spec?.aux ? textures.get(spec.aux) : tex;
      if (!tex || !aux) return false;
      gl.useProgram(prog);
      gl.uniform2f(loc.uCentre, B.cx, B.cy);
      gl.uniform1f(loc.uR, B.r);
      gl.uniform1f(loc.uDpr, size.dpr);
      gl.uniform1f(loc.uH, H / size.dpr);
      gl.uniform3f(loc.uE, B.e0, B.e1, 0);
      gl.uniform3f(loc.uN, B.n0, B.n1, B.n2);
      gl.uniform3f(loc.uC, B.c0, B.c1, B.c2);
      gl.uniform1i(loc.uMode, { relief: 0, picture: 2 }[spec.mode]);
      gl.uniform2f(loc.uAuxStep, 1 / aux.w, 1 / aux.h);
      gl.uniform1f(loc.uBump, spec.bump ?? 0);
      // Light from the upper left, a little in front: fixed to the screen, not the Earth.
      const L = [-0.45, 0.55, 0.7], m = Math.hypot(...L);
      gl.uniform3f(loc.uLight,
        (L[0] * B.e0 + L[1] * B.n0 + L[2] * B.c0) / m,
        (L[0] * B.e1 + L[1] * B.n1 + L[2] * B.c1) / m,
        (L[1] * B.n2 + L[2] * B.c2) / m);
      const on = Boolean(detail?.win) && spec.mode === 'relief';
      gl.uniform1i(loc.uDetailOn, on ? 1 : 0);
      if (on) {
        gl.uniform4f(loc.uWin, ...detail.win);
        gl.uniform2f(loc.uGrid, ...detail.grid);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, detail.tex);
      }
      // The floor whenever it is here: it says where the sea is, for its zones, as well as what a lower sea leaves.
      const floorOn = Boolean(floor) && spec.mode === 'relief', seaOn = floorOn && Boolean(seaZ) && Boolean(spec.sea);
      gl.uniform1i(loc.uFloorOn, floorOn ? 1 : 0);
      gl.uniform1i(loc.uSeaOn, seaOn ? 1 : 0);
      gl.uniform1f(loc.uLevel, level);
      if (floorOn) gl.uniform3f(loc.uDry, ...spec.floor.dry);
      if (seaOn) gl.uniform3fv(loc.uSeaC, spec.sea.colours.flat());
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, floorOn ? floor.tex : tex.tex);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, seaOn ? seaZ.tex : tex.tex);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, aux.tex);
      const from = fade && textures.get(fade.url), t = from ? Math.min(1, (performance.now() - fade.t0) / FADE_MS) : 1;
      gl.uniform1f(loc.uFade, t);
      if (from) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, from.tex); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (fade && t >= 1) { release([spec.tex, spec.aux].filter(Boolean)); fade = null; }
      return Boolean(fade);
    },
    destroy() { release([]); dropDetail(); useFloor(null); useSea(null); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
