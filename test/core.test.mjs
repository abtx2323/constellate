import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, createChart, addNode, removeNode, addLink, removeLink, findNode, safeUrl, cleanText, sanitizeChart } from '../src/core/model.js';
import { levelOf, progressOf, levelProgress, minutesToNextLevel, statusOf, blockersOf, logPractice, streakOf, totalsOf, recentActivity, formatMinutes, suggestNext, shiftDay, dayString } from '../src/core/progress.js';
import { tidyLayout, boundsOf, fitCamera } from '../src/core/layout.js';
import { TEMPLATES, chartFromTemplate, sampleChart } from '../src/core/templates.js';

const DAY = '2026-11-16';

function chain() {
  const chart = createChart('Test');
  const a = addNode(chart, { name: 'A', target: 10 });
  const b = addNode(chart, { name: 'B', target: 10 });
  const c = addNode(chart, { name: 'C', kind: 'milestone' });
  addLink(chart, a.id, b.id);
  addLink(chart, b.id, c.id);
  return { chart, a, b, c };
}

test('links reject self-links, duplicates and loops', () => {
  const { chart, a, b, c } = chain();
  assert.equal(addLink(chart, a.id, a.id).ok, false);
  assert.equal(addLink(chart, a.id, b.id).ok, false);
  assert.equal(addLink(chart, c.id, a.id).ok, false, 'C -> A would close a loop');
  assert.equal(addLink(chart, a.id, c.id).ok, true);
  assert.equal(chart.links.length, 3);
  removeLink(chart, a.id, c.id);
  assert.equal(chart.links.length, 2);
});

test('removing a skill removes its links and its timer', () => {
  const { chart, b } = chain();
  chart.timer = { id: b.id, start: 1 };
  removeNode(chart, b.id);
  assert.equal(chart.nodes.length, 2);
  assert.equal(chart.links.length, 0);
  assert.equal(chart.timer, null);
});

test('levels follow the share of target hours', () => {
  const { a } = chain(); // target 10 h = 600 min; thresholds 30, 90, 210, 390, 600
  assert.equal(levelOf(a), 0);
  logPractice(a, 29, DAY);
  assert.equal(levelOf(a), 0);
  assert.equal(minutesToNextLevel(a), 1);
  logPractice(a, 1, DAY);
  assert.equal(levelOf(a), 1);
  assert.equal(levelProgress(a), 0);
  logPractice(a, 60, shiftDay(DAY, -1));
  assert.equal(levelOf(a), 2);
  logPractice(a, 510, shiftDay(DAY, -2));
  assert.equal(levelOf(a), 5);
  assert.equal(progressOf(a), 1);
  assert.equal(minutesToNextLevel(a), 0);
});

test('a day never holds more than 24 hours and bad input is ignored', () => {
  const { a, c } = chain();
  assert.equal(logPractice(a, 2000, DAY), 1440);
  assert.equal(logPractice(a, 10, DAY), 0);
  assert.equal(logPractice(a, -5, DAY), 0);
  assert.equal(logPractice(a, NaN, DAY), 0);
  assert.equal(logPractice(c, 30, DAY), 0, 'milestones do not take practice time');
});

test('skills stay locked until prerequisites reach the unlock level', () => {
  const { chart, a, b, c } = chain();
  assert.equal(statusOf(chart, a), 'open');
  assert.equal(statusOf(chart, b), 'locked');
  assert.deepEqual(blockersOf(chart, b).map((n) => n.name), ['A']);
  logPractice(a, 30, DAY); // level 1: lit, but not enough to open B
  assert.equal(statusOf(chart, a), 'active');
  assert.equal(statusOf(chart, b), 'locked');
  logPractice(a, 60, DAY); // level 2
  assert.equal(statusOf(chart, b), 'open');
  assert.equal(statusOf(chart, c), 'locked');
  logPractice(b, 600, shiftDay(DAY, -1));
  assert.equal(statusOf(chart, b), 'mastered');
  assert.equal(statusOf(chart, c), 'open');
  c.done = true;
  assert.equal(statusOf(chart, c), 'mastered');
});

test('streak counts back from today, or from yesterday when today is empty', () => {
  const { chart, a } = chain();
  assert.equal(streakOf(chart, DAY), 0);
  logPractice(a, 10, shiftDay(DAY, -1));
  logPractice(a, 10, shiftDay(DAY, -2));
  assert.equal(streakOf(chart, DAY), 2);
  logPractice(a, 10, DAY);
  assert.equal(streakOf(chart, DAY), 3);
  logPractice(a, 10, shiftDay(DAY, -5));
  assert.equal(streakOf(chart, DAY), 3);
});

test('day arithmetic crosses months and years', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(dayString(new Date(2026, 0, 5)), '2026-01-05');
});

test('totals, activity and formatting', () => {
  const { chart, a, b } = chain();
  logPractice(a, 90, DAY);
  logPractice(b, 45, shiftDay(DAY, -3));
  assert.deepEqual(totalsOf(chart), { minutes: 135, lit: 2, mastered: 0, count: 3 });
  const days = recentActivity(chart, DAY, 7);
  assert.equal(days.length, 7);
  assert.equal(days[6].m, 90);
  assert.equal(days[3].m, 45);
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(60), '1 h');
  assert.equal(formatMinutes(135), '2 h 15 min');
});

test('suggestions skip locked and finished skills and prefer ones that open others', () => {
  const chart = createChart('S');
  const gate = addNode(chart, { name: 'Gate', target: 10 });
  const side = addNode(chart, { name: 'Side', target: 10 });
  const next = addNode(chart, { name: 'Next', target: 10 });
  const done = addNode(chart, { name: 'Done', target: 1 });
  addLink(chart, gate.id, next.id);
  logPractice(done, 60, DAY);
  const picks = suggestNext(chart, 3);
  assert.deepEqual(picks.map((p) => p.node.name), ['Gate', 'Side']);
  assert.equal(picks[0].reason, 'Opens Next');
  assert.equal(picks[1].reason, 'Ready to start');
  assert.ok(!picks.some((p) => p.node.id === next.id || p.node.id === done.id));
});

test('safeUrl keeps only plain web links', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('  http://example.com  '), 'http://example.com/');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>1</script>'), '');
  assert.equal(safeUrl('file:///etc/passwd'), '');
  assert.equal(safeUrl('https://user:pw@example.com/'), '');
  assert.equal(safeUrl('not a url'), '');
  assert.equal(safeUrl(42), '');
});

test('cleanText strips control characters and caps length', () => {
  assert.equal(cleanText('  hi\u0000\u0007 there\u007f  ', 50), 'hi there');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
  assert.equal(cleanText(null, 10), '');
  assert.equal(cleanText('<img src=x onerror=1>', 60), '<img src=x onerror=1>', 'markup is kept as plain text; the UI never renders it as HTML');
});

test('sanitizeChart round-trips a real chart', () => {
  const chart = sampleChart(DAY);
  const copy = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  assert.deepEqual(copy, chart);
});

test('sanitizeChart drops hostile and malformed content', () => {
  const raw = JSON.parse(`{
    "v": 1, "title": "T", "extra": "dropped", "__proto__": {"polluted": true},
    "nodes": [
      {"id": "aaaaaa", "name": "Good", "kind": "skill", "x": 10, "y": 20, "target": 5, "url": "javascript:alert(1)", "note": "n",
       "log": [{"d": "2026-11-16", "m": 30}, {"d": "2026-11-16", "m": 99999}, {"d": "2026-02-30", "m": 5}, {"d": "x", "m": 5}, {"d": "2026-11-15", "m": -4}, null],
       "evil": {"a": 1}},
      {"id": "aaaaaa", "name": "Duplicate id"},
      {"id": "../../etc", "name": "Bad id"},
      {"id": "__proto__", "name": "Proto id"},
      {"id": "bbbbbb", "name": 7, "kind": "weird", "x": "NaN", "y": 1e99, "target": -3, "done": "yes"},
      "nope", null
    ],
    "links": [
      {"from": "aaaaaa", "to": "bbbbbb"}, {"from": "bbbbbb", "to": "aaaaaa"},
      {"from": "aaaaaa", "to": "aaaaaa"}, {"from": "aaaaaa", "to": "zzzzzz"}, 5
    ],
    "timer": {"id": "zzzzzz", "start": 5}
  }`);
  const chart = sanitizeChart(raw);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(chart).sort(), ['links', 'nodes', 'timer', 'title', 'v']);
  assert.equal(chart.nodes.length, 2);
  const [good, odd] = chart.nodes;
  assert.deepEqual(Object.keys(good).sort(), ['done', 'id', 'kind', 'log', 'name', 'note', 'target', 'url', 'x', 'y']);
  assert.equal(good.url, '');
  assert.deepEqual(good.log, [{ d: '2026-11-16', m: 1440 }]);
  assert.equal(odd.name, 'Unnamed skill');
  assert.equal(odd.kind, 'skill');
  assert.equal(odd.x, 0);
  assert.equal(odd.y, LIMITS.coord, 'huge coordinates are clamped');
  assert.equal(odd.target, 20);
  assert.equal(odd.done, false);
  assert.deepEqual(chart.links, [{ from: 'aaaaaa', to: 'bbbbbb' }], 'loop, self-link and dangling link are dropped');
  assert.equal(chart.timer, null);
});

test('sanitizeChart rejects things that are not charts', () => {
  for (const bad of [null, 5, 'x', [], {}, { v: 2, nodes: [], links: [] }, { v: 1, nodes: {}, links: [] }]) {
    assert.throws(() => sanitizeChart(bad));
  }
  const tooMany = { v: 1, title: 't', links: [], nodes: Array.from({ length: LIMITS.nodes + 1 }, () => ({})) };
  assert.throws(() => sanitizeChart(tooMany), /more skills/);
});

test('every template builds a loop-free chart with no overlapping stars', () => {
  for (const tpl of TEMPLATES) {
    const chart = chartFromTemplate(tpl.key);
    assert.equal(chart.nodes.length, tpl.nodes.length, tpl.key);
    assert.equal(chart.links.length, tpl.links.length, `${tpl.key}: every template link is valid`);
    for (let i = 0; i < chart.nodes.length; i++) {
      for (let j = i + 1; j < chart.nodes.length; j++) {
        const a = chart.nodes[i];
        const b = chart.nodes[j];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 80, `${tpl.key}: ${a.name} and ${b.name} overlap`);
      }
    }
    assert.ok(chart.nodes.some((n) => statusOf(chart, n) === 'open'), `${tpl.key} has somewhere to start`);
  }
  assert.equal(chartFromTemplate('nope'), null);
});

test('layout puts later skills farther from the centre', () => {
  const { chart, a, b, c } = chain();
  tidyLayout(chart);
  const r = (n) => Math.hypot(n.x, n.y);
  assert.equal(r(a), 0);
  assert.ok(r(b) > r(a) && r(c) > r(b));
  const box = boundsOf(chart);
  assert.ok(box.maxX >= box.minX && box.maxY >= box.minY);
  const cam = fitCamera(chart, 800, 600);
  assert.ok(cam.k > 0.15 && cam.k <= 1.4);
  tidyLayout(createChart('empty')); // must not throw
});

test('the sample chart shows a range of levels', () => {
  const chart = sampleChart(DAY);
  const levels = new Set(chart.nodes.map(levelOf));
  assert.ok(levels.size >= 5, `expected variety, got ${[...levels]}`);
  assert.ok(streakOf(chart, DAY) >= 2);
  assert.ok(findNode(chart, chart.nodes[0].id));
});
