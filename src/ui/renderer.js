// Draws the chart as a star map. Level sets a star's colour the way
// temperature does in the real sky: red, orange, yellow, white, blue-white.

import { RING_GAP } from '../core/layout.js';

export const SKY = Object.freeze({
  deep: '#081530',
  mid: '#0C2148',
  high: '#17376B',
  grid: 'rgba(140, 172, 226, 0.11)',
  gridStrong: 'rgba(140, 172, 226, 0.2)',
  label: 'rgba(240, 233, 214, 0.95)',
  labelDim: 'rgba(160, 180, 214, 0.62)',
  line: 'rgba(236, 226, 196, 0.62)',
  lineDim: 'rgba(132, 160, 208, 0.34)',
  hollow: 'rgba(168, 194, 236, 0.9)',
  gold: '#E9B949',
});

export const STAR_COLORS = Object.freeze(['#8FA9D6', '#DC7460', '#EE9F5A', '#F6D573', '#FBF4E2', '#B5D0FF']);

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", P052, Georgia, serif';

export function starRadius(info) {
  if (info.status === 'locked') return 7;
  return 9 + info.level * 2.2;
}

// Small deterministic generator so the background stars never jump around.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DUST = (() => {
  const rand = seeded(20261116);
  const out = [];
  for (let i = 0; i < 150; i++) out.push({ x: rand(), y: rand(), s: 0.6 + rand() * 1.1, a: 0.18 + rand() * 0.5 });
  return out;
})();

function splitLabel(name) {
  if (name.length <= 18) return [name];
  const mid = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  if (best < 0) return [name];
  return [name.slice(0, best), name.slice(best + 1)];
}

export function toScreen(view, wx, wy) {
  return { x: (wx - view.cam.x) * view.cam.k + view.w / 2, y: (wy - view.cam.y) * view.cam.k + view.h / 2 };
}

export function toWorld(view, sx, sy) {
  return { x: (sx - view.w / 2) / view.cam.k + view.cam.x, y: (sy - view.h / 2) / view.cam.k + view.cam.y };
}

function drawBackground(ctx, view) {
  const { w, h } = view;
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, SKY.high);
  g.addColorStop(0.55, SKY.mid);
  g.addColorStop(1, SKY.deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Faint far stars with a little parallax.
  const tile = 900;
  const ox = -view.cam.x * view.cam.k * 0.12;
  const oy = -view.cam.y * view.cam.k * 0.12;
  ctx.fillStyle = '#DCE6FA';
  for (let tx = -1; tx * tile < w; tx++) {
    for (let ty = -1; ty * tile < h; ty++) {
      for (const d of DUST) {
        const x = (((d.x * tile + ox) % tile) + tile) % tile + tx * tile;
        const y = (((d.y * tile + oy) % tile) + tile) % tile + ty * tile;
        if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
        ctx.globalAlpha = d.a;
        ctx.fillRect(x, y, d.s, d.s);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// Rings and spokes centred on the chart origin, like a planisphere.
function drawGrid(ctx, view) {
  const k = view.cam.k;
  const c = toScreen(view, 0, 0);
  const corners = [[0, 0], [view.w, 0], [0, view.h], [view.w, view.h]];
  let far = 0;
  for (const [x, y] of corners) far = Math.max(far, Math.hypot(x - c.x, y - c.y));
  const step = RING_GAP * k * (k < 0.3 ? 2 : 1);
  const rings = Math.min(40, Math.ceil(far / step));
  ctx.lineWidth = 1;
  for (let i = 1; i <= rings; i++) {
    ctx.strokeStyle = i % 3 === 0 ? SKY.gridStrong : SKY.grid;
    ctx.beginPath();
    ctx.arc(c.x, c.y, i * step, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = SKY.grid;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.moveTo(c.x + Math.cos(a) * step, c.y + Math.sin(a) * step);
    ctx.lineTo(c.x + Math.cos(a) * rings * step, c.y + Math.sin(a) * rings * step);
  }
  ctx.stroke();
}

function drawLinks(ctx, view, scene) {
  const k = view.cam.k;
  const byId = new Map(scene.chart.nodes.map((n) => [n.id, n]));
  for (const l of scene.chart.links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    const ia = scene.info.get(a.id);
    const ib = scene.info.get(b.id);
    const pa = toScreen(view, a.x, a.y);
    const pb = toScreen(view, b.x, b.y);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (len < 1) continue;
    const ux = (pb.x - pa.x) / len;
    const uy = (pb.y - pa.y) / len;
    const ra = Math.max(3, starRadius(ia) * k) + 6;
    const rb = Math.max(3, starRadius(ib) * k) + 6;
    if (len <= ra + rb) continue;
    const bright = ia.level >= 1 && ib.level >= 1;
    const open = ib.status !== 'locked';
    ctx.strokeStyle = bright ? SKY.line : SKY.lineDim;
    ctx.lineWidth = bright ? 1.6 : 1.1;
    ctx.setLineDash(open ? [] : [3, 6]);
    ctx.beginPath();
    ctx.moveTo(pa.x + ux * ra, pa.y + uy * ra);
    ctx.lineTo(pb.x - ux * rb, pb.y - uy * rb);
    ctx.stroke();
    ctx.setLineDash([]);
    // A small chevron at the midpoint shows which way the path runs.
    if (len > 70) {
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      const s = 4.5;
      ctx.beginPath();
      ctx.moveTo(mx - ux * s - uy * s, my - uy * s + ux * s);
      ctx.lineTo(mx + ux * s, my + uy * s);
      ctx.lineTo(mx - ux * s + uy * s, my - uy * s - ux * s);
      ctx.stroke();
    }
  }
}

function drawStar(ctx, x, y, r, node, info) {
  const color = STAR_COLORS[info.level];
  const milestone = node.kind === 'milestone';

  if (info.level >= 1) {
    const halo = r * (2.4 + info.level * 0.45);
    const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, halo);
    g.addColorStop(0, color + '66');
    g.addColorStop(0.4, color + '22');
    g.addColorStop(1, color + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, Math.PI * 2);
    ctx.fill();
  }

  if (info.level >= 5) {
    // Diffraction spikes for a finished star.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.75;
    const s = r * 3.1;
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  if (milestone) {
    const d = r * 1.15;
    ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  if (info.level >= 1) {
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(8, 21, 48, 0.85)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = info.status === 'locked' ? SKY.labelDim : SKY.hollow;
    ctx.setLineDash(info.status === 'locked' ? [2.5, 3.5] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Arc showing progress toward the next level.
  if (!milestone && info.level < 5 && info.step > 0) {
    ctx.strokeStyle = STAR_COLORS[info.level + 1];
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r + 4.5, -Math.PI / 2, -Math.PI / 2 + info.step * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

function drawLabel(ctx, x, y, r, node, info, k, selected) {
  if (k < 0.34 && !selected) return;
  const size = Math.max(11.5, Math.min(17, 14 * Math.sqrt(k)));
  ctx.font = `italic ${size}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = splitLabel(node.name);
  let ty = y + r + (selected ? 22 : 9);
  for (const line of lines) {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(8, 21, 48, 0.8)';
    ctx.lineJoin = 'round';
    ctx.strokeText(line, x, ty);
    ctx.fillStyle = info.status === 'locked' ? SKY.labelDim : SKY.label;
    ctx.fillText(line, x, ty);
    ty += size * 1.22;
  }
}

function drawSelection(ctx, x, y, r, color) {
  const rr = r + 11;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.moveTo(x + Math.cos(a) * (rr + 3), y + Math.sin(a) * (rr + 3));
    ctx.lineTo(x + Math.cos(a) * (rr + 9), y + Math.sin(a) * (rr + 9));
  }
  ctx.stroke();
}

// scene: { chart, info: Map(id -> {level, status, step}), selId, linkFrom, timerId, bursts, now }
// Returns true while an animation still needs more frames.
export function drawSky(ctx, view, scene) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  drawBackground(ctx, view);
  drawGrid(ctx, view);
  drawLinks(ctx, view, scene);

  const k = view.cam.k;
  for (const node of scene.chart.nodes) {
    const info = scene.info.get(node.id);
    const p = toScreen(view, node.x, node.y);
    const r = Math.max(3, starRadius(info) * k);
    if (p.x < -160 || p.y < -160 || p.x > view.w + 160 || p.y > view.h + 160) continue;
    drawStar(ctx, p.x, p.y, r, node, info);
    if (scene.timerId === node.id) {
      ctx.fillStyle = SKY.gold;
      ctx.beginPath();
      ctx.arc(p.x + r + 7, p.y - r - 7, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (scene.selId === node.id) drawSelection(ctx, p.x, p.y, r, SKY.label);
    if (scene.linkFrom === node.id) drawSelection(ctx, p.x, p.y, r, SKY.gold);
    drawLabel(ctx, p.x, p.y, r, node, info, k, scene.selId === node.id || scene.linkFrom === node.id);
  }

  let animating = false;
  for (const b of scene.bursts || []) {
    const t = (scene.now - b.t0) / 900;
    if (t < 0 || t >= 1) continue;
    animating = true;
    const p = toScreen(view, b.x, b.y);
    const ease = 1 - (1 - t) * (1 - t);
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14 + ease * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8 + ease * 38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  return animating;
}

// Nearest skill under a point, with a touch-friendly reach.
export function nodeAt(chart, info, wx, wy, k) {
  let best = null;
  let bestDist = Infinity;
  for (const node of chart.nodes) {
    const reach = Math.max(starRadius(info.get(node.id)) + 8, 24 / k);
    const d = Math.hypot(node.x - wx, node.y - wy);
    if (d <= reach && d < bestDist) { best = node; bestDist = d; }
  }
  return best;
}
