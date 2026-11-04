// Picture layers on the Globe (relief, temperature): a WebGL canvas between
// the sea-and-land canvas and the overlay canvas of js/globe.js. One full-screen triangle;
// the fragment shader turns each pixel into a point on the sphere (the same orthographic
// view as globe.js) and looks it up in an equirectangular texture.
//
// The context is only made when a picture layer is first switched on, and textures are
// let go as soon as their layer is switched off, so the plain globe costs nothing.
// Lighting is local only: relief gets bumps from a height map, never a darker rim.

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCentre;     // globe centre, CSS px from the top left
uniform float uR, uDpr, uH;
uniform vec3 uE, uN, uC;  // east, north and centre of the view, as world vectors
uniform int uMode;        // 0 relief, 2 picture with alpha
uniform sampler2D uTex, uAux;
uniform vec2 uAuxStep;    // one texel of uAux
uniform float uBump;
uniform vec3 uLight;
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

  vec4 col;
  if (uMode == 0) {
    vec3 base = look(uTex, uv).rgb;
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

const loadImage = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`could not load ${url}`));
  img.src = url;
});

// canvas: the (empty) canvas to draw into. Returns null if WebGL 2 isn't available.
export function createSphere(canvas) {
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
    for (const n of ['uCentre', 'uR', 'uDpr', 'uH', 'uE', 'uN', 'uC', 'uMode', 'uTex', 'uAux', 'uAuxStep', 'uBump', 'uLight']) {
      loc[n] = gl.getUniformLocation(prog, n);
    }
    gl.uniform1i(loc.uTex, 0);
    gl.uniform1i(loc.uAux, 1);
  }
  setup();

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; textures.clear(); });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); });

  async function texture(url) {
    if (textures.has(url)) return textures.get(url);
    const img = await loadImage(url);
    if (lost) throw new Error('context lost');
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const t = { tex, w: img.naturalWidth, h: img.naturalHeight };
    textures.set(url, t);
    return t;
  }

  // Free every texture not in keep.
  function release(keep) {
    for (const [url, t] of textures) if (!keep.includes(url)) { gl.deleteTexture(t.tex); textures.delete(url); }
  }

  let spec = null; // { mode, tex, aux, bump }

  return {
    // spec: { mode: 'relief' | 'picture', tex: url, aux?: url (height map), bump? } or null.
    // Resolves once loaded.
    async set(next) {
      spec = next;
      release(next ? [next.tex, next.aux].filter(Boolean) : []);
      if (!next) return;
      await Promise.all([next.tex, next.aux].filter(Boolean).map(texture));
    },
    update(patch) { if (spec) Object.assign(spec, patch); },
    // B: the basis from globe.js for this frame; size: { w, h, dpr }.
    draw(B, size) {
      if (lost) return;
      const W = Math.round(size.w * size.dpr), H = Math.round(size.h * size.dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const tex = spec && textures.get(spec.tex);
      const aux = spec?.aux ? textures.get(spec.aux) : tex;
      if (!tex || !aux) return;
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
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, aux.tex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() { release([]); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
