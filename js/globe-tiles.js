// Topography zoom tiles (scripts/make-layers.mjs tiles): once the globe is zoomed in past the
// point where the base picture starts to blur, the tiles in view are fetched and put into the
// sphere's detail window (js/globegl.js), a DETAIL × DETAIL block of tiles round the view's
// centre. Only tiles in sight are fetched, a few at a time; the service worker keeps them in
// their own cache, capped at about 25 MB (sw.js). Decoded tiles are kept for a while (KEEP)
// so turning back and forth doesn't fetch them again.
export const RELIEF_TILES = {
  dir: 'assets/layers/relief-tiles/', level: 8192, tile: 512, cols: 16, rows: 8,
  // From this zoom (the 4096 px picture is about one texel a screen pixel at 2.3).
  fromK: 2.4,
};
export const DETAIL = 4;
const KEEP = 24, AT_ONCE = 4;
const DEG = Math.PI / 180;

// The window for a view centred on lon, lat: [first column, first row, columns, rows], the
// tiles nearest the centre (columns wrap round at 180°; rows stay on the map).
export function detailWindow(lon, lat, { cols, rows } = RELIEF_TILES) {
  const tx = ((lon + 180) / 360) * cols, ty = ((90 - lat) / 180) * rows;
  const col = (((Math.round(tx) - DETAIL / 2) % cols) + cols) % cols;
  const row = Math.min(Math.max(Math.round(ty) - DETAIL / 2, 0), rows - DETAIL);
  return [col, row, DETAIL, DETAIL];
}

// A tile's middle (unit vector) and how far its corners reach from it (radians).
export function tileCap(col, row, { cols, rows } = RELIEF_TILES) {
  const lon0 = -180 + (col * 360) / cols, lon1 = lon0 + 360 / cols;
  const lat0 = 90 - (row * 180) / rows, lat1 = lat0 - 180 / rows;
  const v = (lon, lat) => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
  const m = v((lon0 + lon1) / 2, (lat0 + lat1) / 2);
  let reach = 0;
  for (const p of [v(lon0, lat0), v(lon1, lat0), v(lon0, lat1), v(lon1, lat1), v((lon0 + lon1) / 2, lat0), v((lon0 + lon1) / 2, lat1)]) {
    reach = Math.max(reach, Math.acos(Math.min(1, m[0] * p[0] + m[1] * p[1] + m[2] * p[2])));
  }
  return { c: m, r: reach };
}

// sphere: from js/globegl.js. onLoad: a tile arrived (redraw).
export function createTiles(sphere, onLoad, spec = RELIEF_TILES) {
  const images = new Map();   // "row-col" -> decoded image, oldest first
  const pending = new Set();
  let win = null, winKey = '';
  let queue = [];
  const caps = new Map();     // "row-col" -> tileCap

  const keyOf = (col, row) => `${row}-${col}`;
  const inWin = (col, row) => win && ((col - win[0] + spec.cols) % spec.cols) < win[2] && row >= win[1] && row < win[1] + win[3];
  const place = (col, row, img) => sphere.putTile((col - win[0] + spec.cols) % spec.cols, row - win[1], img);

  function remember(key, img) {
    images.delete(key);
    images.set(key, img);
    while (images.size > KEEP) images.delete(images.keys().next().value);
  }

  function pump() {
    while (pending.size < AT_ONCE && queue.length) {
      const [col, row] = queue.shift();
      const key = keyOf(col, row);
      if (images.has(key) || pending.has(key)) continue;
      pending.add(key);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        pending.delete(key);
        remember(key, img);
        if (inWin(col, row)) { place(col, row, img); onLoad(); }
        pump();
      };
      img.onerror = () => { pending.delete(key); pump(); }; // offline: the base picture stays
      img.src = `${spec.dir}${key}.webp`;
    }
  }

  return {
    // Each frame with relief showing: B is the frame's basis (js/globe.js), k the zoom.
    update(B, k) {
      if (k < spec.fromK) {
        if (win) { win = null; winKey = ''; sphere.setDetail(null); }
        queue = [];
        return;
      }
      const lon = Math.atan2(B.c1, B.c0) / DEG, lat = Math.asin(Math.max(-1, Math.min(1, B.c2))) / DEG;
      const next = detailWindow(lon, lat, spec);
      const key = next.join(',');
      if (key !== winKey) {
        win = next; winKey = key;
        sphere.setDetail(win, [spec.cols, spec.rows], spec.tile);
        for (let y = 0; y < win[3]; y++) {
          for (let x = 0; x < win[2]; x++) {
            const col = (win[0] + x) % spec.cols, row = win[1] + y, img = images.get(keyOf(col, row));
            if (img) place(col, row, img);
          }
        }
      }
      // The tiles in sight, nearest the centre first.
      const want = [];
      for (let y = 0; y < win[3]; y++) {
        for (let x = 0; x < win[2]; x++) {
          const col = (win[0] + x) % spec.cols, row = win[1] + y;
          if (images.has(keyOf(col, row)) || pending.has(keyOf(col, row))) continue;
          if (!caps.has(keyOf(col, row))) caps.set(keyOf(col, row), tileCap(col, row, spec));
          const { c, r } = caps.get(keyOf(col, row));
          const d = Math.acos(Math.max(-1, Math.min(1, c[0] * B.c0 + c[1] * B.c1 + c[2] * B.c2)));
          if (d < B.sight + r) want.push([d, col, row]);
        }
      }
      queue = want.sort((a, b) => a[0] - b[0]).map(([, col, row]) => [col, row]);
      pump();
    },
    // Switched off: let the window go (the decoded tiles stay for a while).
    clear() { win = null; winKey = ''; queue = []; },
    get loaded() { return images.size; },
  };
}
