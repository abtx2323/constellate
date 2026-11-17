// Constellate: the canvas app. No network calls, no markup injection.

import { LIMITS, createChart, findNode, addNode, removeNode, addLink, removeLink, prerequisitesOf, dependentsOf, cleanText, cleanTarget, safeUrl, sanitizeChart } from '../core/model.js';
import { LEVEL_NAMES, MAX_LEVEL, UNLOCK_LEVEL, minutesOf, levelOf, progressOf, levelProgress, minutesToNextLevel, blockersOf, statusOf, dayString, logPractice, streakOf, totalsOf, recentActivity, formatMinutes, suggestNext } from '../core/progress.js';
import { tidyLayout, fitCamera } from '../core/layout.js';
import { passphraseProblem, createVaultKey, vaultKeyFor, isEnvelope, sealWithKey, unsealWithKey, seal, unseal } from '../core/vault.js';
import { TEMPLATES, chartFromTemplate, sampleChart } from '../core/templates.js';
import { STAR_COLORS, drawSky, nodeAt, toScreen, toWorld } from './renderer.js';
import { el, clear, button, openDialog, field } from './dom.js';

const APP_NAME = 'Constellate';
const STORE_KEY = 'constellate.chart.v1';
const MAX_IMPORT_CHARS = 10 * 1024 * 1024;
const MAX_TIMER_MINUTES = 480;
// Set by the embed build for hosts that block file downloads from a page.
const EMBEDDED = document.documentElement.hasAttribute('data-embed');

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const ui = {
  title: document.getElementById('titleBtn'),
  stats: document.getElementById('stats'),
  menu: document.getElementById('menuBtn'),
  timer: document.getElementById('timerBar'),
  add: document.getElementById('addBtn'),
  link: document.getElementById('linkBtn'),
  next: document.getElementById('nextBtn'),
  fit: document.getElementById('fitBtn'),
  undo: document.getElementById('undoBtn'),
  sheet: document.getElementById('sheet'),
  hint: document.getElementById('hint'),
  toast: document.getElementById('toast'),
};

const S = {
  chart: createChart('My chart'),
  cam: { x: 0, y: 0, k: 1 },
  view: { w: 1, h: 1, dpr: 1, cam: null },
  info: new Map(),
  sel: null,
  linking: false,
  linkFrom: null,
  undo: [],
  redo: [],
  vault: null,      // session key when the chart is passphrase-protected
  locked: false,    // true while an encrypted chart waits for its passphrase
  bursts: [],
  storageWarned: false,
};
S.view.cam = S.cam;

const today = () => dayString(new Date());
const reducedMotion = () => globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- storage ----------------------------------------------------------------

function storeGet(key) {
  try { return globalThis.localStorage.getItem(key); } catch { return null; }
}

function storeSet(key, value) {
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    if (!S.storageWarned) {
      S.storageWarned = true;
      toast('This browser is not keeping changes. Export a backup from the menu to keep your chart.', 7000);
    }
    return false;
  }
}

let saveTimer = 0;
let saveChain = Promise.resolve();

function scheduleSave() {
  if (S.locked) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

function saveNow() {
  clearTimeout(saveTimer);
  if (S.locked) return saveChain;
  const plain = JSON.stringify(S.chart);
  const vault = S.vault;
  saveChain = saveChain.then(async () => {
    const text = vault ? JSON.stringify(await sealWithKey(vault, plain)) : plain;
    storeSet(STORE_KEY, text);
  }).catch(() => {});
  return saveChain;
}

// --- state changes ----------------------------------------------------------

function rebuildInfo() {
  S.info = new Map();
  for (const node of S.chart.nodes) {
    S.info.set(node.id, { level: levelOf(node), status: statusOf(S.chart, node), step: levelProgress(node) });
  }
}

function pushUndo() {
  S.undo.push(JSON.stringify(S.chart));
  if (S.undo.length > 60) S.undo.shift();
  S.redo = [];
}

function restore(snapshot) {
  const timer = S.chart.timer;
  S.chart = sanitizeChart(JSON.parse(snapshot));
  S.chart.timer = timer && findNode(S.chart, timer.id) ? timer : null;
  if (S.sel && !findNode(S.chart, S.sel)) S.sel = null;
  S.linkFrom = null;
  changed();
  buildSheet();
}

function undo() {
  if (!S.undo.length) return toast('Nothing to undo.');
  S.redo.push(JSON.stringify(S.chart));
  restore(S.undo.pop());
}

function redo() {
  if (!S.redo.length) return toast('Nothing to redo.');
  S.undo.push(JSON.stringify(S.chart));
  restore(S.redo.pop());
}

// Call after any change to the chart.
function changed() {
  rebuildInfo();
  scheduleSave();
  refreshHud();
  refreshSheet();
  render();
}

function setChart(chart, options) {
  S.chart = chart;
  S.sel = null;
  S.linkFrom = null;
  setLinking(false);
  rebuildInfo();
  buildSheet();
  refreshHud();
  homeView();
  if (!options || options.save !== false) scheduleSave();
}

// --- rendering --------------------------------------------------------------

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const now = performance.now();
    const more = drawSky(ctx, S.view, {
      chart: S.chart, info: S.info, selId: S.sel, linkFrom: S.linkFrom,
      timerId: S.chart.timer ? S.chart.timer.id : null, bursts: S.bursts, now,
    });
    S.bursts = S.bursts.filter((b) => now - b.t0 < 900);
    if (more || camTween) render();
  });
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  S.view.w = Math.max(1, rect.width);
  S.view.h = Math.max(1, rect.height);
  S.view.dpr = dpr;
  canvas.width = Math.round(S.view.w * dpr);
  canvas.height = Math.round(S.view.h * dpr);
  render();
}

// The part of the canvas not covered by the detail sheet or the bars.
function freeArea() {
  const top = (ui.timer.hidden ? ui.stats : ui.timer).getBoundingClientRect().bottom;
  const area = { left: 0, top: top + 10, right: S.view.w, bottom: S.view.h - 76 };
  if (!ui.sheet.hidden) {
    const r = ui.sheet.getBoundingClientRect();
    if (r.width > S.view.w * 0.7) area.bottom = Math.min(area.bottom, r.top - 6);
    else area.right = r.left;
  }
  return area;
}

let camTween = null;
function moveCamera(target, instant) {
  if (instant || reducedMotion()) {
    Object.assign(S.cam, target);
    camTween = null;
    render();
    return;
  }
  const from = { ...S.cam };
  const t0 = performance.now();
  camTween = true;
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / 260);
    const e = 1 - Math.pow(1 - t, 3);
    S.cam.x = from.x + (target.x - from.x) * e;
    S.cam.y = from.y + (target.y - from.y) * e;
    S.cam.k = from.k + (target.k - from.k) * e;
    if (t < 1 && camTween) requestAnimationFrame(step);
    else camTween = null;
    render();
  };
  requestAnimationFrame(step);
}

function fitView(instant) {
  const a = freeArea();
  const w = Math.max(120, a.right - a.left);
  const h = Math.max(120, a.bottom - a.top);
  const cam = fitCamera(S.chart, w, h, Math.min(90, w * 0.16));
  // Shift so the chart centre lands in the middle of the free area.
  cam.x -= ((a.left + a.right) / 2 - S.view.w / 2) / cam.k;
  cam.y -= ((a.top + a.bottom) / 2 - S.view.h / 2) / cam.k;
  moveCamera(cam, instant !== false);
}

// Camera that puts a chart point in the middle of the free area.
function cameraAt(x, y, k) {
  const a = freeArea();
  return {
    k,
    x: x - ((a.left + a.right) / 2 - S.view.w / 2) / k,
    y: y - ((a.top + a.bottom) / 2 - S.view.h / 2) / k,
  };
}

function revealNode(node) {
  const a = freeArea();
  const p = toScreen(S.view, node.x, node.y);
  const padX = Math.min(70, (a.right - a.left) / 4);
  const padY = Math.min(70, (a.bottom - a.top) / 4);
  const readable = S.cam.k >= 0.36;
  if (readable && p.x > a.left + padX && p.x < a.right - padX && p.y > a.top + padY && p.y < a.bottom - padY - 20) return;
  moveCamera(cameraAt(node.x, node.y, Math.max(S.cam.k, 0.6)));
}

// Opening view. On a small screen the whole chart is too small to read, so
// start close in on the stars that are already lit.
function homeView() {
  fitView(true);
  if (S.cam.k >= 0.36 || !S.chart.nodes.length) return;
  const lit = S.chart.nodes.filter((n) => S.info.get(n.id).level >= 1);
  const open = S.chart.nodes.filter((n) => S.info.get(n.id).status === 'open');
  const pool = lit.length ? lit : open.length ? open : S.chart.nodes;
  let x = 0;
  let y = 0;
  for (const n of pool) { x += n.x; y += n.y; }
  moveCamera(cameraAt(x / pool.length, y / pool.length, 0.56), true);
}

// --- messages ---------------------------------------------------------------

let toastTimer = 0;
function toast(message, ms) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms || 3200);
}

function setHint(message) {
  ui.hint.textContent = message || '';
  ui.hint.hidden = !message;
}

// --- top bar ----------------------------------------------------------------

let timerTick = 0;
function refreshHud() {
  ui.title.textContent = S.chart.title;
  const t = totalsOf(S.chart);
  const streak = streakOf(S.chart, today());
  clear(ui.stats);
  const parts = [`${formatMinutes(t.minutes)} practiced`, `${t.lit} of ${t.count} lit`];
  if (streak > 0) parts.push(`${streak}-day streak`);
  for (const text of parts) ui.stats.append(el('span', { text }));
  ui.undo.disabled = S.undo.length === 0;
  refreshTimer();
}

function refreshTimer() {
  clearInterval(timerTick);
  const timer = S.chart.timer;
  const node = timer ? findNode(S.chart, timer.id) : null;
  clear(ui.timer);
  ui.timer.hidden = !node;
  if (!node) return;
  const clock = el('span', { class: 'clock' });
  const paint = () => {
    const secs = Math.max(0, Math.floor((Date.now() - timer.start) / 1000));
    const h = Math.floor(secs / 3600);
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    clock.textContent = h ? `${h}:${m}:${s}` : `${m}:${s}`;
  };
  paint();
  timerTick = setInterval(paint, 1000);
  ui.timer.append(
    el('span', { class: 'timer-name', text: `Practicing ${node.name}` }),
    clock,
    button('Stop and log', stopTimer, 'btn gold small'),
  );
}

function startTimer(node) {
  if (S.chart.timer) stopTimer();
  S.chart.timer = { id: node.id, start: Date.now() };
  changed();
  toast(`Timer started for ${node.name}.`);
}

function stopTimer() {
  const timer = S.chart.timer;
  if (!timer) return;
  const node = findNode(S.chart, timer.id);
  let minutes = Math.round((Date.now() - timer.start) / 60000);
  const over = minutes > MAX_TIMER_MINUTES;
  minutes = Math.max(1, Math.min(MAX_TIMER_MINUTES, minutes));
  pushUndo();
  S.chart.timer = null;
  if (node) practice(node, minutes, true);
  else changed();
  if (over) toast(`The timer ran past 8 hours, so 8 hours were logged. Undo if that is wrong.`, 6000);
}

// --- practice ---------------------------------------------------------------

function practice(node, minutes, undoAlreadyPushed) {
  const before = new Map(S.info);
  if (!undoAlreadyPushed) pushUndo();
  const added = logPractice(node, minutes, today());
  changed();
  if (!added) return toast('That day is already full.');
  announceProgress(node, before, `Logged ${formatMinutes(added)} on ${node.name}.`);
}

function announceProgress(node, before, fallback) {
  const was = before.get(node.id);
  const now = S.info.get(node.id);
  const opened = S.chart.nodes.filter((n) => {
    const b = before.get(n.id);
    return b && b.status === 'locked' && S.info.get(n.id).status === 'open';
  });
  if (now.level > (was ? was.level : 0)) {
    S.bursts.push({ x: node.x, y: node.y, t0: performance.now(), color: STAR_COLORS[now.level] });
    render();
  }
  if (opened.length) {
    for (const n of opened) S.bursts.push({ x: n.x, y: n.y, t0: performance.now() + 250, color: STAR_COLORS[0] });
    toast(opened.length === 1 ? `${node.name} opened ${opened[0].name}.` : `${node.name} opened ${opened.length} skills.`, 4500);
    render();
  } else if (now.level > (was ? was.level : 0)) {
    toast(now.level >= MAX_LEVEL ? `${node.name} is complete.` : `${node.name} reached level ${now.level}, ${LEVEL_NAMES[now.level]}.`, 4500);
  } else if (fallback) {
    toast(fallback);
  }
}

// --- skills and links -------------------------------------------------------

function select(id, options) {
  S.sel = id;
  buildSheet();
  const node = id ? findNode(S.chart, id) : null;
  if (node && (!options || options.reveal !== false)) revealNode(node);
  render();
}

function addSkillAt(x, y) {
  if (S.chart.nodes.length >= LIMITS.nodes) return toast(`A chart holds up to ${LIMITS.nodes} skills.`);
  pushUndo();
  const node = addNode(S.chart, { x, y });
  changed();
  select(node.id);
  const input = ui.sheet.querySelector('input.name');
  if (input) { input.focus(); input.select(); }
}

function addSkill() {
  const a = freeArea();
  let p = toWorld(S.view, (a.left + a.right) / 2, (a.top + a.bottom) / 2);
  // Step aside until the spot is free.
  for (let i = 0; i < 40 && nodeAt(S.chart, S.info, p.x, p.y, 1); i++) p = { x: p.x + 70, y: p.y + (i % 2 ? 50 : -30) };
  addSkillAt(p.x, p.y);
}

function deleteSkill(node) {
  pushUndo();
  removeNode(S.chart, node.id);
  if (S.sel === node.id) S.sel = null;
  changed();
  buildSheet();
  toast(`Deleted ${node.name}. Undo brings it back.`);
}

function setLinking(on, fromId) {
  S.linking = on;
  S.linkFrom = on ? fromId || null : null;
  ui.link.setAttribute('aria-pressed', on ? 'true' : 'false');
  ui.link.textContent = on ? 'Done' : 'Link';
  if (!on) setHint('');
  else setHint(S.linkFrom ? 'Now tap the skill it leads to.' : 'Tap the skill that comes first.');
  render();
}

function linkTap(node) {
  if (!S.linkFrom) {
    S.linkFrom = node.id;
    setHint(`${node.name} comes first. Now tap the skill it leads to.`);
    return render();
  }
  if (S.linkFrom === node.id) {
    S.linkFrom = null;
    setHint('Tap the skill that comes first.');
    return render();
  }
  const from = findNode(S.chart, S.linkFrom);
  const snapshot = JSON.stringify(S.chart);
  const result = addLink(S.chart, S.linkFrom, node.id);
  if (!result.ok) return toast(result.reason);
  S.undo.push(snapshot);
  S.redo = [];
  S.linkFrom = null;
  setHint('Linked. Tap another first skill, or choose Done.');
  changed();
  toast(`${from.name} now leads to ${node.name}.`);
}

// --- detail sheet -----------------------------------------------------------

let sheetRefs = null;

// Records one undo step the first time a field changes after it gains focus.
function editable(input, apply) {
  let armed = false;
  input.addEventListener('focus', () => { armed = true; });
  input.addEventListener('input', () => {
    if (armed) { pushUndo(); armed = false; }
    apply(input.value);
    rebuildInfo();
    scheduleSave();
    refreshHud();
    refreshSheet();
    render();
  });
}

function buildSheet() {
  const node = S.sel ? findNode(S.chart, S.sel) : null;
  clear(ui.sheet);
  sheetRefs = null;
  ui.sheet.hidden = !node;
  document.body.classList.toggle('sheet-open', Boolean(node));
  if (!node) return;

  const name = el('input', { class: 'name', type: 'text', maxlength: LIMITS.name, value: node.name, 'aria-label': 'Skill name', autocomplete: 'off', spellcheck: 'true' });
  editable(name, (v) => { node.name = cleanText(v, LIMITS.name) || 'Unnamed skill'; });

  const status = el('p', { class: 'status' });
  const bar = el('div', { class: 'bar', role: 'img' }, [el('div', { class: 'bar-fill' })]);
  for (let i = 1; i < MAX_LEVEL; i++) bar.append(el('i', { class: `tick t${i}` }));
  const actions = el('div', { class: 'actions' });
  const links = el('div', { class: 'links' });

  const kind = el('select', { 'aria-label': 'Kind' }, [
    el('option', { value: 'skill', text: 'Practice skill' }),
    el('option', { value: 'milestone', text: 'One-time milestone' }),
  ]);
  kind.value = node.kind;
  kind.addEventListener('change', () => {
    pushUndo();
    node.kind = kind.value === 'milestone' ? 'milestone' : 'skill';
    if (node.kind === 'milestone' && S.chart.timer && S.chart.timer.id === node.id) S.chart.timer = null;
    changed();
    buildSheet();
  });

  const target = el('input', { type: 'number', min: 1, max: LIMITS.targetHours, step: 1, value: node.target, inputmode: 'numeric' });
  editable(target, (v) => { node.target = cleanTarget(v); });

  const note = el('textarea', { rows: 3, maxlength: LIMITS.note, value: node.note, placeholder: 'What to practice, what worked, what to try next' });
  editable(note, (v) => { node.note = cleanText(v, LIMITS.note); });

  const url = el('input', { type: 'url', maxlength: LIMITS.url, value: node.url, placeholder: 'Web address of a course, book or doc', autocomplete: 'off' });
  const open = el('a', { class: 'open-link', target: '_blank', rel: 'noopener noreferrer', text: 'Open link' });
  editable(url, (v) => { node.url = safeUrl(v); });
  url.addEventListener('change', () => {
    if (url.value.trim() && !node.url) toast('Only web links that start with http or https are kept.');
  });

  ui.sheet.append(
    el('div', { class: 'sheet-head' }, [name, button('Close', () => select(null), 'btn quiet')]),
    status, bar, actions,
    el('div', { class: 'grid2' }, [
      field('Kind', kind),
      node.kind === 'skill' ? field('Hours to finish', target) : null,
    ]),
    field('Notes', note),
    field('Resource', url),
    open,
    links,
    el('div', { class: 'sheet-foot' }, [
      button('Link to another skill', () => { setLinking(true, node.id); }, 'btn'),
      button('Delete skill', () => deleteSkill(node), 'btn danger'),
    ]),
  );
  sheetRefs = { node, status, bar, actions, links, open };
  refreshSheet();
}

function refreshSheet() {
  if (!sheetRefs) return;
  const { node, status, bar, actions, links, open } = sheetRefs;
  if (!findNode(S.chart, node.id)) return;
  const info = S.info.get(node.id);
  const blockers = blockersOf(S.chart, node);
  const minutes = minutesOf(node);

  let line;
  if (node.kind === 'milestone') {
    line = node.done ? 'Done.' : blockers.length ? '' : 'Not done yet.';
  } else if (info.level >= MAX_LEVEL) {
    line = `Level 5, ${LEVEL_NAMES[5]}. ${formatMinutes(minutes)} practiced.`;
  } else {
    line = `Level ${info.level}, ${LEVEL_NAMES[info.level]}. ${formatMinutes(minutes)} practiced, ${formatMinutes(minutesToNextLevel(node))} to level ${info.level + 1}.`;
  }
  if (blockers.length && info.level < MAX_LEVEL) {
    const names = blockers.map((b) => (b.kind === 'milestone' ? `${b.name} done` : `${b.name} at level ${UNLOCK_LEVEL}`));
    line = `Waiting on ${names.join(' and ')}. ${line}`.trim();
  }
  status.textContent = line;

  const pct = Math.round(progressOf(node) * 100);
  bar.firstChild.style.setProperty('width', `${pct}%`);
  bar.firstChild.style.setProperty('background', STAR_COLORS[Math.max(1, info.level)]);
  bar.setAttribute('aria-label', `${pct} percent of the way to finished`);
  bar.hidden = node.kind === 'milestone';

  clear(actions);
  if (node.kind === 'milestone') {
    actions.append(button(node.done ? 'Mark as not done' : 'Mark as done', () => {
      const before = new Map(S.info);
      pushUndo();
      node.done = !node.done;
      changed();
      if (node.done) announceProgress(node, before, `${node.name} is done.`);
    }, node.done ? 'btn' : 'btn gold'));
  } else {
    const timing = S.chart.timer && S.chart.timer.id === node.id;
    actions.append(
      button('+15 min', () => practice(node, 15), 'btn gold'),
      button('+30 min', () => practice(node, 30), 'btn gold'),
      button('+1 h', () => practice(node, 60), 'btn gold'),
      timing ? button('Stop and log', stopTimer, 'btn') : button('Start timer', () => startTimer(node), 'btn'),
    );
  }

  open.hidden = !node.url;
  if (node.url) open.setAttribute('href', node.url);
  else open.removeAttribute('href');

  clear(links);
  const groups = [
    ['Comes after', prerequisitesOf(S.chart, node.id), (other) => removeLink(S.chart, other.id, node.id)],
    ['Leads to', dependentsOf(S.chart, node.id), (other) => removeLink(S.chart, node.id, other.id)],
  ];
  for (const [label, list, unlink] of groups) {
    if (!list.length) continue;
    const row = el('div', { class: 'link-row' }, [el('span', { class: 'field-label', text: label })]);
    for (const other of list) {
      row.append(el('span', { class: 'chip' }, [
        button(other.name, () => select(other.id), 'chip-name'),
        el('button', { type: 'button', class: 'chip-x', 'aria-label': `Remove link with ${other.name}`, text: 'Remove', onclick: () => { pushUndo(); unlink(other); changed(); } }),
      ]));
    }
    links.append(row);
  }
}

// --- pointer input ----------------------------------------------------------

const pointers = new Map();
let gesture = null;
let lastTap = { t: 0, x: 0, y: 0 };

function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startSingle(p) {
  const w = toWorld(S.view, p.x, p.y);
  const hit = nodeAt(S.chart, S.info, w.x, w.y, S.cam.k);
  gesture = { type: hit ? 'node' : 'pan', node: hit, sx: p.x, sy: p.y, cx: S.cam.x, cy: S.cam.y, nx: hit ? hit.x : 0, ny: hit ? hit.y : 0, moved: false };
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  gesture = { type: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: S.cam.k, anchor: toWorld(S.view, mid.x, mid.y), moved: true };
}

function zoomAbout(anchor, screen, k) {
  S.cam.k = Math.max(0.15, Math.min(3, k));
  S.cam.x = anchor.x - (screen.x - S.view.w / 2) / S.cam.k;
  S.cam.y = anchor.y - (screen.y - S.view.h / 2) / S.cam.k;
  camTween = null;
  render();
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, localPoint(e));
  camTween = null;
  if (pointers.size === 1) startSingle(pointers.get(e.pointerId));
  else if (pointers.size === 2) startPinch();
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  if (gesture.type === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    zoomAbout(gesture.anchor, mid, gesture.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0));
    return;
  }
  const dx = p.x - gesture.sx;
  const dy = p.y - gesture.sy;
  if (!gesture.moved && Math.hypot(dx, dy) < 7) return;
  if (!gesture.moved) {
    gesture.moved = true;
    if (gesture.type === 'node' && S.linking) gesture.type = 'pan';
    if (gesture.type === 'node') pushUndo();
  }
  if (gesture.type === 'node') {
    gesture.node.x = Math.round(gesture.nx + dx / S.cam.k);
    gesture.node.y = Math.round(gesture.ny + dy / S.cam.k);
  } else {
    S.cam.x = gesture.cx - dx / S.cam.k;
    S.cam.y = gesture.cy - dy / S.cam.k;
  }
  render();
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  const g = gesture;
  if (pointers.size === 1) {
    // One finger left after a pinch: carry on as a pan, never as a tap.
    startSingle([...pointers.values()][0]);
    gesture.type = 'pan';
    gesture.node = null;
    gesture.moved = true;
    return;
  }
  gesture = null;
  if (!g || e.type === 'pointercancel') return;
  if (g.moved) {
    if (g.type === 'node') { scheduleSave(); refreshHud(); }
    return;
  }
  tap(g.node, p);
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function tap(node, p) {
  const now = performance.now();
  if (node) {
    lastTap = { t: 0, x: 0, y: 0 };
    if (S.linking) return linkTap(node);
    return select(node.id);
  }
  const double = now - lastTap.t < 380 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 28;
  lastTap = { t: now, x: p.x, y: p.y };
  if (S.linking) return;
  if (double) {
    lastTap.t = 0;
    const w = toWorld(S.view, p.x, p.y);
    return addSkillAt(w.x, w.y);
  }
  if (S.sel) select(null);
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = localPoint(e);
  const unit = e.deltaMode === 1 ? 16 : 1;
  const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0016));
  zoomAbout(toWorld(S.view, p.x, p.y), p, S.cam.k * factor);
}, { passive: false });

globalThis.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    if (typing) return;
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (e.key === 'Escape') {
    if (S.linking) return setLinking(false);
    if (S.sel) return select(null);
    return;
  }
  if (typing || mod || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'n') { e.preventDefault(); addSkill(); }
  else if (key === 'l') setLinking(!S.linking, S.linking ? null : S.sel);
  else if (key === 'f') fitView(false);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
    const node = findNode(S.chart, S.sel);
    if (node) deleteSkill(node);
  } else if (e.key.startsWith('Arrow')) {
    const step = 60 / S.cam.k;
    if (e.key === 'ArrowLeft') S.cam.x -= step;
    if (e.key === 'ArrowRight') S.cam.x += step;
    if (e.key === 'ArrowUp') S.cam.y -= step;
    if (e.key === 'ArrowDown') S.cam.y += step;
    e.preventDefault();
    render();
  }
});

// --- dialogs ----------------------------------------------------------------

function confirmDialog(title, message, actionLabel, onConfirm) {
  openDialog(title, (body, close) => {
    body.append(
      el('p', { text: message }),
      el('div', { class: 'row end' }, [
        button('Cancel', close, 'btn'),
        button(actionLabel, () => { close(); onConfirm(); }, 'btn danger'),
      ]),
    );
  });
}

function templateButtons(body, close) {
  const list = el('div', { class: 'choices' });
  for (const t of TEMPLATES) {
    list.append(el('button', { type: 'button', class: 'choice', onclick: () => { close(); replaceChart(chartFromTemplate(t.key)); } }, [
      el('strong', { text: t.title }),
      el('span', { text: t.blurb }),
    ]));
  }
  list.append(el('button', { type: 'button', class: 'choice', onclick: () => { close(); replaceChart(createChart('My chart')); toast('Double-tap the sky, or choose Add skill, to place your first star.', 7000); } }, [
    el('strong', { text: 'Blank chart' }),
    el('span', { text: 'Start with an empty sky.' }),
  ]));
  body.append(list);
}

function replaceChart(chart) {
  pushUndo();
  setChart(chart);
  saveNow();
}

function welcomeDialog() {
  openDialog(APP_NAME, (body, close) => {
    body.append(
      el('p', { class: 'lede', text: 'Map what you want to learn as a night sky. Each hour of practice makes a star burn hotter, and bright stars open the ones beyond them.' }),
      el('p', { class: 'fine', text: 'Your chart stays in this browser. Nothing is sent anywhere, and you can lock it with a passphrase from the menu.' }),
      button('Explore the sample chart', close, 'btn gold wide'),
      el('h3', { text: 'Or start your own' }),
    );
    templateButtons(body, close);
  });
}

function newChartDialog() {
  openDialog('New chart', (body, close) => {
    body.append(el('p', { text: 'This replaces the chart on screen. Undo brings the old one back, and a backup keeps it for good.' }));
    templateButtons(body, close);
  });
}

function renameDialog() {
  openDialog('Chart name', (body, close) => {
    const input = el('input', { type: 'text', maxlength: LIMITS.title, value: S.chart.title, autocomplete: 'off' });
    const form = el('form', { onsubmit: (e) => {
      e.preventDefault();
      const title = cleanText(input.value, LIMITS.title);
      if (title && title !== S.chart.title) { pushUndo(); S.chart.title = title; changed(); }
      close();
    } }, [field('Name', input), el('div', { class: 'row end' }, [el('button', { type: 'submit', class: 'btn gold', text: 'Save name' })])]);
    body.append(form);
    input.select();
  });
}

function nextDialog() {
  openDialog('What next', (body, close) => {
    const picks = suggestNext(S.chart, 3);
    if (!picks.length) {
      body.append(el('p', { text: S.chart.nodes.length ? 'Every open skill is complete. Add a new one to keep going.' : 'Add a skill to get a suggestion.' }));
    } else {
      body.append(el('p', { text: 'The best places to spend your next session:' }));
      const list = el('div', { class: 'choices' });
      for (const pick of picks) {
        list.append(el('button', { type: 'button', class: 'choice', onclick: () => { close(); select(pick.node.id); } }, [
          el('strong', { text: pick.node.name }),
          el('span', { text: pick.reason }),
        ]));
      }
      body.append(list);
    }
    const days = recentActivity(S.chart, today(), 84);
    const peak = Math.max(60, ...days.map((d) => d.m));
    const strip = el('div', { class: 'heat', role: 'img', 'aria-label': `Practice over the last 12 weeks: ${days.filter((d) => d.m > 0).length} active days` });
    for (const d of days) {
      const cell = el('i', { title: `${d.d}: ${formatMinutes(d.m)}` });
      if (d.m > 0) cell.style.setProperty('opacity', String(0.3 + 0.7 * Math.min(1, d.m / peak)));
      else cell.className = 'empty';
      strip.append(cell);
    }
    body.append(el('h3', { text: 'Last 12 weeks' }), strip);
  });
}

function listDialog() {
  openDialog('All skills', (body, close) => {
    if (!S.chart.nodes.length) return body.append(el('p', { text: 'This chart has no skills yet.' }));
    const order = { active: 0, open: 1, locked: 2, mastered: 3 };
    const words = { active: 'In progress', open: 'Ready to start', locked: 'Waiting on earlier skills', mastered: 'Complete' };
    const nodes = [...S.chart.nodes].sort((a, b) => order[S.info.get(a.id).status] - order[S.info.get(b.id).status] || (a.name < b.name ? -1 : 1));
    const list = el('div', { class: 'choices' });
    for (const node of nodes) {
      const info = S.info.get(node.id);
      const detail = node.kind === 'milestone' ? words[info.status] : `${words[info.status]}. Level ${info.level}, ${formatMinutes(minutesOf(node))}`;
      list.append(el('button', { type: 'button', class: 'choice', onclick: () => { close(); select(node.id); } }, [
        el('strong', { text: node.name }),
        el('span', { text: detail }),
      ]));
    }
    body.append(list);
  });
}

function download(blob, filename) {
  const href = URL.createObjectURL(blob);
  const a = el('a', { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

function fileStem() {
  const slug = S.chart.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chart';
  return `${slug}-${today()}`;
}

function exportDialog() {
  openDialog('Export backup', (body) => {
    const pass = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 256 });
    const message = el('p', { class: 'fine', role: 'status' });
    const out = el('textarea', { rows: 5, readonly: true, hidden: true, 'aria-label': 'Backup text' });

    const make = async () => {
      const plain = JSON.stringify(S.chart);
      if (S.vault) return JSON.stringify(await sealWithKey(S.vault, plain));
      if (!pass.value) return plain;
      const problem = passphraseProblem(pass.value);
      if (problem) throw new Error(problem);
      message.textContent = 'Encrypting…';
      return JSON.stringify(await seal(plain, pass.value));
    };
    const run = async (then) => {
      try {
        const text = await make();
        message.textContent = '';
        await then(text);
      } catch (err) {
        message.textContent = err.message;
      }
    };

    body.append(
      el('p', { text: S.vault
        ? 'This chart is locked with a passphrase, so the backup is encrypted with the same one.'
        : 'A backup is one small file with your whole chart. Add a passphrase to encrypt it, or leave it empty for a plain file.' }),
      S.vault ? null : field('Passphrase for this backup (optional)', pass),
      el('div', { class: 'row' }, [
        EMBEDDED ? null : button('Download backup', () => run(async (text) => {
          download(new Blob([text], { type: 'application/json' }), `${fileStem()}.constellate.json`);
          message.textContent = 'Backup saved to your downloads.';
        }), 'btn gold'),
        button('Copy backup text', () => run(async (text) => {
          out.value = text;
          out.hidden = false;
          out.select();
          try {
            await navigator.clipboard.writeText(text);
            message.textContent = 'Backup text copied.';
          } catch {
            message.textContent = 'Copy the selected text below.';
          }
        }), EMBEDDED ? 'btn gold' : 'btn'),
      ]),
      message,
      out,
    );
  });
}

function importDialog() {
  openDialog('Import backup', (body, close) => {
    const file = el('input', { type: 'file', accept: '.json,application/json' });
    const paste = el('textarea', { rows: 4, placeholder: 'Or paste backup text here', 'aria-label': 'Backup text' });
    const pass = el('input', { type: 'password', autocomplete: 'off', maxlength: 256 });
    const passField = field('Passphrase for this backup', pass);
    passField.hidden = true;
    const message = el('p', { class: 'fine', role: 'status' });

    const load = async () => {
      let text = paste.value;
      if (file.files && file.files[0]) {
        if (file.files[0].size > MAX_IMPORT_CHARS) throw new Error('That file is too large to be a Constellate backup.');
        text = await file.files[0].text();
      }
      if (!text.trim()) throw new Error('Choose a backup file or paste backup text first.');
      if (text.length > MAX_IMPORT_CHARS) throw new Error('That is too large to be a Constellate backup.');
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('That is not a Constellate backup.'); }
      if (isEnvelope(data)) {
        if (!pass.value) {
          passField.hidden = false;
          pass.focus();
          throw new Error('This backup is encrypted. Enter its passphrase, then choose Import again.');
        }
        message.textContent = 'Decrypting…';
        try { data = JSON.parse(await unseal(data, pass.value)); } catch (err) {
          throw new Error(err instanceof SyntaxError ? 'This backup is damaged.' : err.message);
        }
      }
      return sanitizeChart(data);
    };

    body.append(
      el('p', { text: 'Importing replaces the chart on screen. Undo brings the old one back.' }),
      field('Backup file', file),
      paste,
      passField,
      el('div', { class: 'row end' }, [button('Import', async () => {
        try {
          const chart = await load();
          close();
          replaceChart(chart);
          toast(`Imported ${chart.title}.`);
        } catch (err) {
          message.textContent = err.message;
        }
      }, 'btn gold')]),
      message,
    );
  });
}

function passphraseDialog() {
  openDialog(S.vault ? 'Change passphrase' : 'Lock with a passphrase', (body, close) => {
    const a = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 256 });
    const b = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 256 });
    const message = el('p', { class: 'fine', role: 'status' });
    const form = el('form', { onsubmit: async (e) => {
      e.preventDefault();
      const problem = passphraseProblem(a.value);
      if (problem) { message.textContent = problem; return; }
      if (a.value !== b.value) { message.textContent = 'The two entries do not match.'; return; }
      message.textContent = 'Encrypting…';
      try {
        S.vault = await createVaultKey(a.value);
        await saveNow();
        close();
        toast('Chart locked. It is now saved encrypted on this device.', 4500);
      } catch {
        message.textContent = 'This browser could not encrypt the chart. Open Constellate over https or from localhost.';
      }
    } }, [
      el('p', { text: 'The chart is encrypted before it is saved in this browser, and you will be asked for the passphrase each time you open it.' }),
      el('p', { class: 'warn', text: 'There is no reset. If you forget the passphrase, the chart cannot be recovered.' }),
      field('New passphrase', a, 'At least 10 characters. A few random words work well.'),
      field('Type it again', b),
      el('div', { class: 'row end' }, [el('button', { type: 'submit', class: 'btn gold', text: S.vault ? 'Change passphrase' : 'Lock chart' })]),
      message,
    ]);
    body.append(form);
    if (S.vault) {
      body.append(el('div', { class: 'row' }, [button('Remove passphrase', () => {
        close();
        confirmDialog('Remove passphrase', 'The chart will be saved in this browser without encryption.', 'Remove passphrase', async () => {
          S.vault = null;
          await saveNow();
          toast('Passphrase removed.');
        });
      }, 'btn danger')]));
    }
  });
}

function unlockDialog(envelope) {
  openDialog('Unlock your chart', (body, close) => {
    const pass = el('input', { type: 'password', autocomplete: 'current-password', maxlength: 256 });
    const message = el('p', { class: 'fine', role: 'status' });
    const form = el('form', { onsubmit: async (e) => {
      e.preventDefault();
      message.textContent = 'Unlocking…';
      try {
        const key = await vaultKeyFor(pass.value, envelope);
        const chart = sanitizeChart(JSON.parse(await unsealWithKey(key, envelope)));
        S.vault = key;
        S.locked = false;
        pass.value = '';
        close();
        setChart(chart, { save: false });
      } catch (err) {
        message.textContent = err instanceof SyntaxError ? 'The saved chart is damaged.' : err.message;
        pass.select();
      }
    } }, [
      field('Passphrase', pass),
      el('div', { class: 'row end' }, [el('button', { type: 'submit', class: 'btn gold', text: 'Unlock' })]),
      message,
    ]);
    body.append(form, el('div', { class: 'row' }, [button('Erase and start over', () => {
      confirmDialog('Erase the locked chart', 'This deletes the encrypted chart from this browser for good. It cannot be undone.', 'Erase chart', () => {
        S.locked = false;
        S.vault = null;
        close();
        setChart(sampleChart(today()));
        saveNow();
        welcomeDialog();
      });
    }, 'btn quiet')]));
    pass.focus();
  }, { sticky: true });
}

function pictureDialog() {
  const w = 1600;
  const h = 1200;
  const off = el('canvas', { width: w, height: h });
  const octx = off.getContext('2d');
  const cam = fitCamera(S.chart, w, h - 120, 150);
  cam.y -= 40 / cam.k;
  drawSky(octx, { w, h, dpr: 1, cam }, { chart: S.chart, info: S.info, selId: null, linkFrom: null, timerId: null, bursts: [], now: 0 });
  const t = totalsOf(S.chart);
  octx.fillStyle = 'rgba(240, 233, 214, 0.96)';
  octx.textAlign = 'left';
  octx.textBaseline = 'top';
  octx.font = 'italic 46px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
  octx.fillText(S.chart.title, 56, 48);
  octx.font = '22px "Avenir Next", "Segoe UI", system-ui, sans-serif';
  octx.fillStyle = 'rgba(190, 206, 236, 0.9)';
  octx.fillText(`${formatMinutes(t.minutes)} practiced, ${t.lit} of ${t.count} lit`, 58, 108);

  off.toBlob((blob) => {
    if (!blob) return toast('This browser could not make the picture.');
    const href = URL.createObjectURL(blob);
    openDialog('Picture of your chart', (body) => {
      body.append(
        el('img', { class: 'preview', src: href, alt: `Star map of ${S.chart.title}` }),
        EMBEDDED ? null : el('div', { class: 'row' }, [button('Download picture', () => download(blob, `${fileStem()}.png`), 'btn gold')]),
        el('p', { class: 'fine', text: `${EMBEDDED ? 'Press and hold the picture to save or share it.' : 'On a phone you can also press and hold the picture to save or share it.'} It shows skill names and progress, so share it only where you are happy for those to be seen.` }),
      );
    }, { onClose: () => URL.revokeObjectURL(href) });
  }, 'image/png');
}

function aboutDialog() {
  openDialog('Privacy and how it works', (body) => {
    const points = [
      'Constellate runs entirely in this browser. It makes no network requests, loads nothing from other sites, and has no accounts, analytics or cookies.',
      'Your chart is saved in this browser only. Clearing site data removes it, so export a backup now and then.',
      'A passphrase encrypts the saved chart with AES-256-GCM. The key is derived with PBKDF2-SHA-256 and is held only in memory while the page is open.',
      `Skills gain a level at 5, 15, 35, 65 and 100 percent of their hours. A skill opens the ones after it at level ${UNLOCK_LEVEL}; a milestone opens them when it is done.`,
      'Shortcuts: N adds a skill, L links, F fits the chart, Delete removes the selected skill, Ctrl or Cmd with Z undoes.',
    ];
    for (const text of points) body.append(el('p', { text }));
  });
}

function menuDialog() {
  openDialog('Menu', (body, close) => {
    const items = [
      ['All skills', 'A list you can read and search by keyboard', listDialog],
      ['Tidy layout', 'Arrange the stars in rings by what comes first', () => { pushUndo(); tidyLayout(S.chart); changed(); fitView(false); }],
      ['Save a picture', 'A shareable image of the chart', pictureDialog],
      ['Export backup', 'Download or copy the whole chart', exportDialog],
      ['Import backup', 'Load a chart from a backup', importDialog],
      [S.vault ? 'Passphrase' : 'Lock with a passphrase', S.vault ? 'Change or remove the passphrase' : 'Encrypt the chart saved on this device', passphraseDialog],
      S.vault ? ['Lock now', 'Close the chart until the passphrase is entered', async () => { await saveNow(); globalThis.location.reload(); }] : null,
      ['Redo', 'Bring back the last undone change', redo],
      ['New chart', 'Start from a template or a blank sky', newChartDialog],
      ['Privacy and how it works', 'What is stored, levels and shortcuts', aboutDialog],
    ];
    const list = el('div', { class: 'choices' });
    for (const item of items) {
      if (!item) continue;
      list.append(el('button', { type: 'button', class: 'choice', onclick: () => { close(); item[2](); } }, [
        el('strong', { text: item[0] }),
        el('span', { text: item[1] }),
      ]));
    }
    body.append(list);
  });
}

// --- start ------------------------------------------------------------------

ui.title.addEventListener('click', renameDialog);
ui.menu.addEventListener('click', menuDialog);
ui.add.addEventListener('click', addSkill);
ui.link.addEventListener('click', () => setLinking(!S.linking, S.linking ? null : S.sel));
ui.next.addEventListener('click', nextDialog);
ui.fit.addEventListener('click', () => fitView(false));
ui.undo.addEventListener('click', undo);
globalThis.addEventListener('resize', resize);
if (globalThis.ResizeObserver) new ResizeObserver(resize).observe(canvas);
globalThis.addEventListener('pagehide', () => { if (!S.locked) saveNow(); });

function start() {
  resize();
  const raw = storeGet(STORE_KEY);
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (isEnvelope(parsed)) {
    S.locked = true;
    setChart(createChart('Locked chart'), { save: false });
    unlockDialog(parsed);
    return;
  }
  if (parsed) {
    try {
      setChart(sanitizeChart(parsed), { save: false });
      return;
    } catch {
      toast('The saved chart could not be read, so the sample is shown instead.', 6000);
    }
  }
  setChart(sampleChart(today()), { save: false });
  if (!raw) welcomeDialog();
}

start();
