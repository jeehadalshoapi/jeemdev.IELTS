import type { AttemptSummary, Kind, Skill } from '@ielts/shared';
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

export function appHeader(subtitle: string, back = false): HTMLElement {
  return el('header', { class: 'app-header' },
    el('div', { class: 'brand' },
      back ? el('a', { class: 'icon-btn back', href: '#/', title: 'Dashboard' }, '←') : el('span', { class: 'brand-mark' }, 'IE'),
      el('div', null, el('b', null, 'IELTS Practice'), el('small', null, subtitle))),
    el('div', { class: 'header-actions' },
      el('button', {
        class: 'btn btn-ghost btn-sm', onclick: async () => {
          await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
          location.href = '/login';
        }
      }, 'Log out')));
}
