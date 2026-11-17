// Chart model: skills (nodes) and prerequisite links. Pure data, no DOM.
// Everything that enters from outside (storage, import, paste) goes through
// sanitizeChart(), which rebuilds the chart field by field.

export const SCHEMA_VERSION = 1;

export const LIMITS = Object.freeze({
  nodes: 400,
  links: 1200,
  title: 80,
  name: 60,
  note: 2000,
  url: 500,
  logDays: 3660,
  minutesPerDay: 1440,
  targetHours: 10000,
  coord: 1e6,
});

const ID_RE = /^[a-z0-9]{6,24}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function newId() {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += (b % 36).toString(36);
  return out;
}

export function createChart(title) {
  return {
    v: SCHEMA_VERSION,
    title: cleanText(title, LIMITS.title) || 'My chart',
    nodes: [],
    links: [],
    timer: null,
  };
}

export function findNode(chart, id) {
  return chart.nodes.find((n) => n.id === id) || null;
}

export function addNode(chart, props) {
  if (chart.nodes.length >= LIMITS.nodes) return null;
  const p = props || {};
  const node = {
    id: newId(),
    name: cleanText(p.name, LIMITS.name) || 'New skill',
    kind: p.kind === 'milestone' ? 'milestone' : 'skill',
    x: cleanCoord(p.x),
    y: cleanCoord(p.y),
    target: cleanTarget(p.target),
    done: false,
    note: '',
    url: '',
    log: [],
  };
  chart.nodes.push(node);
  return node;
}

export function removeNode(chart, id) {
  chart.nodes = chart.nodes.filter((n) => n.id !== id);
  chart.links = chart.links.filter((l) => l.from !== id && l.to !== id);
  if (chart.timer && chart.timer.id === id) chart.timer = null;
}

export function prerequisitesOf(chart, id) {
  return chart.links.filter((l) => l.to === id).map((l) => findNode(chart, l.from)).filter(Boolean);
}

export function dependentsOf(chart, id) {
  return chart.links.filter((l) => l.from === id).map((l) => findNode(chart, l.to)).filter(Boolean);
}

// True when `target` can already be reached by following links from `start`.
function reaches(chart, start, target) {
  const next = new Map();
  for (const l of chart.links) {
    if (!next.has(l.from)) next.set(l.from, []);
    next.get(l.from).push(l.to);
  }
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    for (const n of next.get(cur) || []) {
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return false;
}

// `from` is the prerequisite, `to` is the skill it leads to.
export function addLink(chart, from, to) {
  if (from === to) return { ok: false, reason: 'A skill cannot lead to itself.' };
  if (!findNode(chart, from) || !findNode(chart, to)) return { ok: false, reason: 'That skill no longer exists.' };
  if (chart.links.some((l) => l.from === from && l.to === to)) return { ok: false, reason: 'Those skills are already linked.' };
  if (chart.links.length >= LIMITS.links) return { ok: false, reason: 'This chart has reached its link limit.' };
  if (reaches(chart, to, from)) return { ok: false, reason: 'That link would make a loop.' };
  chart.links.push({ from, to });
  return { ok: true, reason: '' };
}

export function removeLink(chart, from, to) {
  chart.links = chart.links.filter((l) => !(l.from === from && l.to === to));
}

// --- cleaning helpers -------------------------------------------------------

export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // Drop control characters except newline and tab, then trim and cap.
  let out = '';
  for (const ch of value) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 9 || (c >= 32 && c !== 127)) out += ch;
  }
  return out.trim().slice(0, max);
}

function cleanCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-LIMITS.coord, Math.min(LIMITS.coord, Math.round(n)));
}

export function cleanTarget(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.max(1, Math.min(LIMITS.targetHours, Math.round(n)));
}

// Only plain web links are kept. Anything else (javascript:, data:, file:) is dropped.
export function safeUrl(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().slice(0, LIMITS.url);
  if (!text) return '';
  let parsed;
  try { parsed = new URL(text); } catch { return ''; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  if (parsed.username || parsed.password) return '';
  return parsed.href.slice(0, LIMITS.url);
}

function isRealDay(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1970 && y <= 2200;
}

function cleanLog(raw) {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map();
  for (const entry of raw.slice(0, LIMITS.logDays * 2)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!isRealDay(entry.d)) continue;
    const m = Math.floor(Number(entry.m));
    if (!Number.isFinite(m) || m <= 0) continue;
    byDay.set(entry.d, Math.min(LIMITS.minutesPerDay, (byDay.get(entry.d) || 0) + m));
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-LIMITS.logDays)
    .map(([d, m]) => ({ d, m }));
}

// Rebuilds a chart from untrusted data. Unknown fields are dropped, bad
// entries are skipped, and structural problems throw a readable error.
export function sanitizeChart(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('This is not a Constellate chart.');
  if (raw.v !== SCHEMA_VERSION) throw new Error('This chart was made by a different version of Constellate.');
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.links)) throw new Error('This chart is missing its skills or links.');
  if (raw.nodes.length > LIMITS.nodes) throw new Error('This chart has more skills than Constellate allows.');
  if (raw.links.length > LIMITS.links) throw new Error('This chart has more links than Constellate allows.');

  const chart = createChart(raw.title);
  const ids = new Set();
  for (const rn of raw.nodes) {
    if (!rn || typeof rn !== 'object') continue;
    if (typeof rn.id !== 'string' || !ID_RE.test(rn.id) || ids.has(rn.id)) continue;
    ids.add(rn.id);
    chart.nodes.push({
      id: rn.id,
      name: cleanText(rn.name, LIMITS.name) || 'Unnamed skill',
      kind: rn.kind === 'milestone' ? 'milestone' : 'skill',
      x: cleanCoord(rn.x),
      y: cleanCoord(rn.y),
      target: cleanTarget(rn.target),
      done: rn.done === true,
      note: cleanText(rn.note, LIMITS.note),
      url: safeUrl(rn.url),
      log: cleanLog(rn.log),
    });
  }
  for (const rl of raw.links) {
    if (!rl || typeof rl !== 'object') continue;
    if (!ids.has(rl.from) || !ids.has(rl.to)) continue;
    addLink(chart, rl.from, rl.to); // rejects duplicates, self-links and loops
  }
  const t = raw.timer;
  if (t && typeof t === 'object' && ids.has(t.id) && Number.isFinite(t.start) && t.start > 0) {
    chart.timer = { id: t.id, start: Math.floor(t.start) };
  }
  return chart;
}
