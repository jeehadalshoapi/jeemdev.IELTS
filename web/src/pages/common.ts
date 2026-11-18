import type { AttemptSummary, Kind, MarkReason, QuestionType, Skill } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { formatClock } from '../lib/format';

export const SKILL_LABEL: Record<Skill, string> = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking', mixed: 'Full mock' };
export const SKILL_ICON: Record<Skill, string> = { reading: '📖', listening: '🎧', writing: '✍️', speaking: '🗣', mixed: '🏁' };
export const KIND_LABEL: Record<Kind, string> = { homework: 'Homework', practice: 'Practice', full_mock: 'Full mock' };

export const skillBadge = (s: Skill) => el('span', { class: `badge badge-${s}` }, `${SKILL_ICON[s]} ${SKILL_LABEL[s]}`);
export const kindBadge = (k: Kind) => el('span', { class: `badge badge-kind kind-${k}` }, KIND_LABEL[k]);

/** "14 min left" / "12 min spent" for an attempt */
export function timeText(a: AttemptSummary): string {
  const t = a.timing;
  if (t.remainingSec === null) return `${formatClock(t.spentSec.total ?? 0)} spent`;
  if (a.mode === 'exam') return t.remainingSec > 0 ? `${Math.ceil(t.remainingSec / 60)} min left (clock running)` : 'time is up';
  return t.remainingSec >= 0 ? `${Math.ceil(t.remainingSec / 60)} min left` : `${Math.ceil(-t.remainingSec / 60)} min over time`;
}

export const TYPE_LABEL: Record<QuestionType, string> = {
  tfng: 'True / False / Not Given', ynng: 'Yes / No / Not Given', mcq_single: 'Multiple choice', mcq_multi: 'Multiple choice (choose 2+)',
  matching_headings: 'Matching headings', matching_information: 'Matching information', matching_features: 'Matching features',
  matching_sentence_endings: 'Sentence endings', sentence_completion: 'Sentence completion', summary_completion: 'Summary completion',
  note_completion: 'Note completion', table_completion: 'Table completion', flowchart_completion: 'Flow-chart completion',
  diagram_labelling: 'Diagram labelling', form_completion: 'Form completion', short_answer: 'Short answer', map_labelling: 'Map labelling',
  writing_task1: 'Writing Task 1', writing_task2: 'Writing Task 2', paragraph: 'Paragraph', speaking_part1: 'Speaking Part 1',
  speaking_part2: 'Speaking Part 2', speaking_part3: 'Speaking Part 3'
};

export const REASON_LABEL: Record<MarkReason, string> = {
  correct: 'Correct', blank: 'Not answered', wrong: 'Wrong answer', over_word_limit: 'Over the word limit', likely_spelling: 'Spelling'
};

export const fmtBandValue = (b: number | null | undefined) => (b === null || b === undefined ? '–' : b.toFixed(1));

export function appHeader(subtitle: string, back = false): HTMLElement {
  const here = location.hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard';
  return el('header', { class: 'app-header' },
    el('div', { class: 'brand' },
      back ? el('a', { class: 'icon-btn back', href: '#/', title: 'Dashboard' }, '←') : el('span', { class: 'brand-mark' }, 'IE'),
      el('div', null, el('b', null, 'IELTS Practice'), el('small', null, subtitle))),
    el('nav', { class: 'tabs' },
      el('a', { href: '#/', class: here === 'dashboard' ? 'active' : '' }, 'Dashboard'),
      el('a', { href: '#/history', class: here === 'history' ? 'active' : '' }, 'History'),
      el('a', { href: '#/tests', class: here === 'tests' || here === 'import' ? 'active' : '' }, 'Tests')),
    el('div', { class: 'header-actions' },
      el('button', {
        class: 'btn btn-ghost btn-sm', onclick: async () => {
          await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
          location.href = '/login';
        }
      }, 'Log out')));
}
