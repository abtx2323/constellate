// Radial layout: starting skills sit near the centre and each prerequisite
// step moves one ring outward, so the chart reads like a star map.

export const RING_GAP = 190;
const MIN_ARC = 150;

export function tidyLayout(chart) {
  const nodes = chart.nodes;
  if (!nodes.length) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parents = new Map(nodes.map((n) => [n.id, []]));
  for (const l of chart.links) {
    if (byId.has(l.from) && byId.has(l.to)) parents.get(l.to).push(l.from);
  }

  // Depth = longest chain of prerequisites above the node.
  const depth = new Map();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    depth.set(id, 0); // guards against bad data; real charts have no loops
    let d = 0;
    for (const p of parents.get(id)) d = Math.max(d, depthOf(p) + 1);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) depthOf(n.id);

  // Each node hangs off its deepest prerequisite, which turns the graph into a tree.
  const children = new Map(nodes.map((n) => [n.id, []]));
  const roots = [];
  for (const n of nodes) {
    let best = null;
    for (const p of parents.get(n.id)) {
      if (best === null || depth.get(p) > depth.get(best)) best = p;
    }
    if (best === null) roots.push(n.id);
    else children.get(best).push(n.id);
  }

  const weight = new Map();
  const weigh = (id) => {
    let w = 0;
    for (const c of children.get(id)) w += weigh(c);
    weight.set(id, Math.max(1, w));
    return weight.get(id);
  };
  let total = 0;
  for (const r of roots) total += weigh(r);

  const single = roots.length === 1;
  const perRing = new Map();
  for (const n of nodes) {
    const ring = depth.get(n.id) + (single ? 0 : 1);
    perRing.set(ring, (perRing.get(ring) || 0) + 1);
  }
  const maxRing = Math.max(...perRing.keys());
  const radius = [0];
  for (let ring = 1; ring <= maxRing; ring++) {
    const needed = ((perRing.get(ring) || 0) * MIN_ARC) / (2 * Math.PI);
    radius[ring] = Math.max(radius[ring - 1] + RING_GAP, needed);
  }

  const place = (id, from, to) => {
    const node = byId.get(id);
    const ring = depth.get(id) + (single ? 0 : 1);
    const angle = (from + to) / 2;
    node.x = Math.round(Math.cos(angle) * radius[ring]);
    node.y = Math.round(Math.sin(angle) * radius[ring]);
    let cursor = from;
    const span = to - from;
    for (const c of children.get(id)) {
      const share = (weight.get(c) / weight.get(id)) * span;
      place(c, cursor, cursor + share);
      cursor += share;
    }
  };

  let cursor = -Math.PI / 2;
  for (const r of roots) {
    const share = (weight.get(r) / total) * Math.PI * 2;
    place(r, cursor, cursor + share);
    cursor += share;
  }
}

export function boundsOf(chart) {
  if (!chart.nodes.length) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of chart.nodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
  }
  return { minX, minY, maxX, maxY };
}

// Camera that shows the whole chart inside a viewport, with room for labels.
export function fitCamera(chart, width, height, pad) {
  const b = boundsOf(chart);
  const margin = pad === undefined ? 90 : pad;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const k = Math.max(0.15, Math.min(1.4, Math.min((width - margin * 2) / w, (height - margin * 2) / h)));
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, k };
}
