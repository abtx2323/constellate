// Starter charts. Each entry: [key, name, target hours] for a skill,
// or [key, name, 'milestone'] for a one-off achievement.

import { createChart, addNode, addLink } from './model.js';
import { tidyLayout } from './layout.js';
import { logPractice, shiftDay } from './progress.js';

export const TEMPLATES = Object.freeze([
  {
    key: 'frontend',
    title: 'Front-end developer',
    blurb: 'From HTML to shipping a tested, accessible app.',
    nodes: [
      ['html', 'HTML and semantics', 10], ['css', 'CSS layout', 20], ['js', 'JavaScript basics', 30],
      ['git', 'Git', 10], ['a11y', 'Accessibility', 15], ['responsive', 'Responsive design', 15],
      ['dom', 'DOM and events', 20], ['async', 'Async and APIs', 20], ['ts', 'TypeScript', 30],
      ['framework', 'A UI framework', 40], ['testing', 'Testing', 25], ['perf', 'Performance', 20],
      ['pr', 'First merged pull request', 'milestone'], ['ship', 'Ship a real project', 'milestone'],
    ],
    links: [
      ['html', 'css'], ['html', 'a11y'], ['html', 'js'], ['css', 'responsive'], ['js', 'dom'], ['js', 'async'],
      ['js', 'ts'], ['dom', 'framework'], ['async', 'framework'], ['framework', 'testing'], ['framework', 'perf'],
      ['git', 'pr'], ['js', 'pr'], ['testing', 'ship'], ['a11y', 'ship'], ['responsive', 'ship'],
    ],
  },
  {
    key: 'manager',
    title: 'New engineering manager',
    blurb: 'The first year of leading a team.',
    nodes: [
      ['oneonone', 'One-on-ones', 15], ['feedback', 'Giving feedback', 15], ['delegate', 'Delegation', 15],
      ['planning', 'Planning and estimates', 20], ['hiring', 'Hiring and interviews', 25], ['coaching', 'Coaching', 30],
      ['conflict', 'Handling conflict', 15], ['strategy', 'Team strategy', 30], ['stake', 'Stakeholder updates', 15],
      ['review', 'First review cycle', 'milestone'], ['hire', 'First hire onboarded', 'milestone'],
    ],
    links: [
      ['oneonone', 'feedback'], ['oneonone', 'coaching'], ['feedback', 'conflict'], ['feedback', 'review'],
      ['delegate', 'planning'], ['planning', 'strategy'], ['planning', 'stake'], ['hiring', 'hire'], ['coaching', 'review'],
    ],
  },
  {
    key: 'spanish',
    title: 'Conversational Spanish',
    blurb: 'From first words to a full conversation.',
    nodes: [
      ['sounds', 'Sounds and spelling', 5], ['core', 'First 500 words', 30], ['present', 'Present tense', 20],
      ['listen', 'Listening', 60], ['past', 'Past tenses', 30], ['speak', 'Speaking practice', 60],
      ['read', 'Reading', 40], ['subj', 'Subjunctive', 30],
      ['order', 'Order a meal in Spanish', 'milestone'], ['talk', '30-minute conversation', 'milestone'],
    ],
    links: [
      ['sounds', 'core'], ['core', 'present'], ['core', 'listen'], ['present', 'past'], ['present', 'speak'],
      ['core', 'read'], ['past', 'subj'], ['speak', 'order'], ['speak', 'talk'], ['listen', 'talk'], ['past', 'talk'],
    ],
  },
  {
    key: 'marathon',
    title: 'First marathon',
    blurb: 'Build the base, then the distance.',
    nodes: [
      ['base', 'Easy running base', 40], ['strength', 'Strength work', 20], ['mobility', 'Mobility', 10],
      ['long', 'Long runs', 50], ['tempo', 'Tempo runs', 25], ['fuel', 'Fuelling and hydration', 8],
      ['pace', 'Race pacing', 15],
      ['five', 'Run 5 km without stopping', 'milestone'], ['half', 'Finish a half marathon', 'milestone'],
      ['full', 'Finish the marathon', 'milestone'],
    ],
    links: [
      ['base', 'five'], ['base', 'long'], ['base', 'tempo'], ['five', 'half'], ['long', 'half'], ['long', 'fuel'],
      ['tempo', 'pace'], ['half', 'full'], ['fuel', 'full'], ['pace', 'full'], ['strength', 'long'],
    ],
  },
]);

export function chartFromTemplate(key) {
  const tpl = TEMPLATES.find((t) => t.key === key);
  if (!tpl) return null;
  const chart = createChart(tpl.title);
  const ids = new Map();
  for (const [k, name, third] of tpl.nodes) {
    const node = addNode(chart, third === 'milestone' ? { name, kind: 'milestone' } : { name, target: third });
    ids.set(k, node.id);
  }
  for (const [a, b] of tpl.links) addLink(chart, ids.get(a), ids.get(b));
  tidyLayout(chart);
  return chart;
}

// The chart shown on first run: the front-end template with some practice
// already logged, so a new visitor sees what a lit sky looks like.
export function sampleChart(today) {
  const chart = chartFromTemplate('frontend');
  const byName = new Map(chart.nodes.map((n) => [n.name, n]));
  const plan = [
    ['HTML and semantics', 600, 9], ['CSS layout', 780, 7], ['JavaScript basics', 640, 6], ['Git', 600, 8],
    ['Accessibility', 150, 3], ['Responsive design', 140, 2], ['DOM and events', 70, 2],
  ];
  for (const [name, minutes, sessions] of plan) {
    const node = byName.get(name);
    const each = Math.floor(minutes / sessions);
    for (let i = 0; i < sessions; i++) logPractice(node, each, shiftDay(today, -i * 2 - (name.length % 2)));
  }
  logPractice(byName.get('JavaScript basics'), 25, today);
  logPractice(byName.get('CSS layout'), 30, shiftDay(today, -1));
  byName.get('First merged pull request').done = true;
  chart.title = 'Sample: front-end developer';
  return chart;
}
