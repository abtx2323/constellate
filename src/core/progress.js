// Practice, levels, unlocking, streaks and "what next" suggestions.

import { LIMITS, prerequisitesOf, dependentsOf } from './model.js';

// Share of the target hours needed to reach each level. Early levels come
// quickly on purpose: the first hour should visibly light the star.
export const LEVEL_SHARE = Object.freeze([0, 0.05, 0.15, 0.35, 0.65, 1]);
export const LEVEL_NAMES = Object.freeze(['Unlit', 'Ember', 'Glow', 'Shine', 'Bright', 'Brilliant']);
export const MAX_LEVEL = 5;
export const UNLOCK_LEVEL = 2;

export function minutesOf(node) {
  let total = 0;
  for (const e of node.log) total += e.m;
  return total;
}

export function levelOf(node) {
  if (node.kind === 'milestone') return node.done ? MAX_LEVEL : 0;
  const goal = node.target * 60;
  const minutes = minutesOf(node);
  let level = 0;
  for (let i = 1; i <= MAX_LEVEL; i++) {
    if (minutes >= Math.ceil(LEVEL_SHARE[i] * goal)) level = i;
  }
  return level;
}

// 0..1 across the whole target.
export function progressOf(node) {
  if (node.kind === 'milestone') return node.done ? 1 : 0;
  return Math.min(1, minutesOf(node) / (node.target * 60));
}

export function minutesToNextLevel(node) {
  if (node.kind === 'milestone') return 0;
  const level = levelOf(node);
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, Math.ceil(LEVEL_SHARE[level + 1] * node.target * 60) - minutesOf(node));
}

// 0..1 from the current level to the next one.
export function levelProgress(node) {
  if (node.kind === 'milestone') return node.done ? 1 : 0;
  const level = levelOf(node);
  if (level >= MAX_LEVEL) return 1;
  const goal = node.target * 60;
  const from = Math.ceil(LEVEL_SHARE[level] * goal);
  const to = Math.ceil(LEVEL_SHARE[level + 1] * goal);
  return Math.max(0, Math.min(1, (minutesOf(node) - from) / Math.max(1, to - from)));
}

function opensDependents(node) {
  return node.kind === 'milestone' ? node.done : levelOf(node) >= UNLOCK_LEVEL;
}

// Prerequisites that still hold this skill back.
export function blockersOf(chart, node) {
  return prerequisitesOf(chart, node.id).filter((p) => !opensDependents(p));
}

// 'locked' | 'open' | 'active' | 'mastered'
export function statusOf(chart, node) {
  const level = levelOf(node);
  if (level >= MAX_LEVEL) return 'mastered';
  if (level >= 1 || minutesOf(node) > 0) return 'active';
  return blockersOf(chart, node).length ? 'locked' : 'open';
}

export function dayString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dayString(dt);
}

// Adds minutes to a day. Returns the minutes actually recorded (a day holds 24 h at most).
export function logPractice(node, minutes, day) {
  const add = Math.floor(Number(minutes));
  if (node.kind !== 'skill' || !Number.isFinite(add) || add <= 0) return 0;
  let entry = node.log.find((e) => e.d === day);
  if (!entry) {
    entry = { d: day, m: 0 };
    node.log.push(entry);
    node.log.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (node.log.length > LIMITS.logDays) node.log.splice(0, node.log.length - LIMITS.logDays);
  }
  const before = entry.m;
  entry.m = Math.min(LIMITS.minutesPerDay, entry.m + add);
  return entry.m - before;
}

export function minutesByDay(chart) {
  const map = new Map();
  for (const n of chart.nodes) {
    for (const e of n.log) map.set(e.d, (map.get(e.d) || 0) + e.m);
  }
  return map;
}

// Consecutive practice days ending today, or yesterday if today is still empty.
export function streakOf(chart, today) {
  const days = minutesByDay(chart);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = shiftDay(cursor, -1);
  }
  return count;
}

export function totalsOf(chart) {
  let minutes = 0;
  let lit = 0;
  let mastered = 0;
  for (const n of chart.nodes) {
    minutes += minutesOf(n);
    const level = levelOf(n);
    if (level >= 1) lit++;
    if (level >= MAX_LEVEL) mastered++;
  }
  return { minutes, lit, mastered, count: chart.nodes.length };
}

// Oldest first, one entry per day, for the activity strip.
export function recentActivity(chart, today, dayCount) {
  const days = minutesByDay(chart);
  const out = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = shiftDay(today, -i);
    out.push({ d, m: days.get(d) || 0 });
  }
  return out;
}

export function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

// Ranks the skills worth practicing now. Each suggestion carries a plain reason.
export function suggestNext(chart, limit) {
  const out = [];
  for (const node of chart.nodes) {
    const status = statusOf(chart, node);
    if (status === 'locked' || status === 'mastered') continue;
    const waiting = dependentsOf(chart, node.id).filter((d) => {
      const blockers = blockersOf(chart, d);
      return blockers.length === 1 && blockers[0].id === node.id;
    });
    const toNext = minutesToNextLevel(node);
    let score = waiting.length * 3 + (status === 'active' ? 1 : 0);
    if (node.kind === 'skill' && toNext > 0) score += Math.max(0, 2 - toNext / 120);
    let reason;
    if (waiting.length) {
      reason = waiting.length === 1 ? `Opens ${waiting[0].name}` : `Opens ${waiting.length} skills`;
    } else if (node.kind === 'milestone') {
      reason = 'Ready to complete';
    } else if (status === 'open') {
      reason = 'Ready to start';
    } else {
      reason = `${formatMinutes(toNext)} to level ${levelOf(node) + 1}`;
    }
    out.push({ node, score, reason });
  }
  out.sort((a, b) => b.score - a.score || (a.node.name < b.node.name ? -1 : 1));
  return out.slice(0, limit || 3);
}
