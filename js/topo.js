// TopoJSON (as written by mapshaper) → [{ props, polys: [[ [lon, lat]… ]…] }]. A ring made
// of several arcs lists where each one starts (ring.joins): there it meets another outline.
// keep(props) picks the shapes wanted: only the arcs they use are worked out.
export function decodeTopo(topo, keep = () => true) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const decode = arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  };
  const arcs = [];
  const arcAt = i => (arcs[i] ??= decode(topo.arcs[i]));
  const ring = ids => {
    const out = [], joins = [];
    for (const id of ids) {
      const a = id < 0 ? arcAt(~id).slice().reverse() : arcAt(id);
      if (ids.length > 1) joins.push(out.length ? out.length - 1 : 0);
      out.push(...(out.length ? a.slice(1) : a));
    }
    // A closed ring repeats its first point at the end; the joins point into the open ring.
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    out.joins = joins.filter(i => i < out.length);
    return out;
  };
  const geoms = Object.values(topo.objects)[0].geometries;
  return geoms.filter(g => g.arcs && keep(g.properties ?? {})).map(g => ({
    props: g.properties ?? {},
    polys: (g.type === 'Polygon' ? [g.arcs] : g.arcs).map(rings => rings.map(ring)),
  }));
}
