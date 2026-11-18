/* History / progress (spec §5.5): every attempt, scores over time per skill, accuracy per question type. */
import type { HistoryResponse, MarkReason, SkillHistory } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate, fmtDuration } from '../lib/format';
import { appHeader, fmtBandValue, REASON_LABEL, skillBadge, TYPE_LABEL } from './common';

export async function mountHistory(root: HTMLElement): Promise<void> {
  const h = await api<HistoryResponse>('/history');
  const page = el('div', { class: 'page' });
  root.append(appHeader('Your progress'), page);

  if (!h.attempts.length) {
    page.appendChild(el('div', { class: 'empty' }, el('h3', null, 'No results yet'), el('p', null, 'Finish a test and your scores will appear here.'), el('a', { class: 'btn btn-primary', href: '#/' }, 'Go to the dashboard')));
    return;
  }

  /* ---------- per skill ---------- */
  const skills = (['reading', 'listening', 'writing', 'speaking'] as const).filter(s => h.bySkill[s]);
  page.appendChild(el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, 'Scores over time'),
    el('div', { class: 'skill-grid' }, skills.map(s => skillCard(s, h.bySkill[s]!)))));

  /* ---------- per question type ---------- */
  if (h.byType.length) {
    page.appendChild(el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, 'Accuracy by question type'),
      el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', null, el('tr', null, ['Question type', 'Correct', 'Accuracy', 'Last 3 attempts', 'Trend'].map(x => el('th', null, x)))),
        el('tbody', null, h.byType.map(t => {
          const acc = t.total ? Math.round((t.raw / t.total) * 100) : 0;
          const recent = t.recent.total ? Math.round((t.recent.raw / t.recent.total) * 100) : 0;
          return el('tr', null,
            el('td', null, el('b', null, TYPE_LABEL[t.type] ?? t.type)),
            el('td', null, `${t.raw} / ${t.total}`),
            el('td', null, el('div', { class: 'acc' }, el('div', { class: 'bd-track' }, el('div', { class: 'bd-fill', style: { width: `${acc}%` } })), el('span', null, `${acc}%`))),
            el('td', null, `${recent}%`),
            el('td', null, t.trend === null ? el('span', { class: 'muted' }, 'need 4+ attempts') : el('span', { class: t.trend > 0 ? 'trend up' : t.trend < 0 ? 'trend down' : 'trend' }, `${t.trend > 0 ? '▲ +' : t.trend < 0 ? '▼ ' : '■ '}${t.trend} pts`)));
        })))))));
  }

  /* ---------- most common mistakes ---------- */
  const mistakes = (['over_word_limit', 'likely_spelling', 'wrong', 'blank'] as MarkReason[]).filter(k => h.reasons[k]);
  if (mistakes.length) {
    page.appendChild(el('div', { class: 'reason-chips' }, el('b', null, 'All mistakes so far: '),
      mistakes.map(k => el('span', { class: `reason reason-${k}` }, `${h.reasons[k]} × ${REASON_LABEL[k].toLowerCase()}`))));
  }

  /* ---------- every attempt ---------- */
  page.appendChild(el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, `All attempts (${h.attempts.length})`),
    el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', null, el('tr', null, ['Submitted', 'Test', 'Mode', 'Score', 'Band', 'Time', ''].map(x => el('th', null, x)))),
      el('tbody', null, h.attempts.map(a => el('tr', { class: 'clickable', onclick: () => { location.hash = `#/result/${a.id}`; } },
        el('td', null, fmtDate(a.submittedAt)),
        el('td', null, el('b', null, a.title), ' ', skillBadge(a.skill)),
        el('td', null, a.mode === 'exam' ? 'Exam' : 'Practice'),
        el('td', null, a.autoScore?.total ? `${a.autoScore.raw} / ${a.autoScore.total}` : '–'),
        el('td', null, el('b', null, fmtBandValue(a.autoScore?.band))),
        el('td', null, fmtDuration(a.timing.spentSec.total ?? 0)),
        el('td', null, a.feedbackReady ? el('span', { class: 'pill-ok' }, '✓ Feedback') : null)))))))));
}

function skillCard(skill: 'reading' | 'listening' | 'writing' | 'speaking', s: SkillHistory): HTMLElement {
  const pts = s.points.slice(-12);
  return el('article', { class: `card skill-card mod-${skill}` },
    el('div', { class: 'card-head' }, skillBadge(skill), el('span', { class: 'muted' }, `${s.attempts} attempt${s.attempts === 1 ? '' : 's'}`)),
    el('div', { class: 'skill-stats' },
      el('div', null, el('small', null, 'Latest'), el('b', null, fmtBandValue(s.latestBand))),
      el('div', null, el('small', null, 'Average (last 5)'), el('b', null, fmtBandValue(s.averageBand))),
      el('div', null, el('small', null, 'Best'), el('b', null, fmtBandValue(s.bestBand)))),
    // one bar per attempt, height = estimated band (0–9); the full charts arrive in Phase 7
    pts.every(p => p.band === null)
      ? el('p', { class: 'muted chart-empty' }, skill === 'writing' || skill === 'speaking' ? 'Bands appear here once Claude has marked your answers.' : 'No bands yet.')
      : el('div', { class: 'mini-chart', role: 'img', 'aria-label': `Estimated bands: ${pts.map(p => fmtBandValue(p.band)).join(', ')}` },
      pts.map(p => el('a', { class: 'mini-bar', href: `#/result/${p.attemptId}`, title: `${fmtDate(p.date)} · ${p.title} · band ${fmtBandValue(p.band)}${p.total ? ` · ${p.raw}/${p.total}` : ''}` },
        el('span', { class: 'mini-fill', style: { height: `${p.band === null ? 4 : Math.max(4, (p.band / 9) * 100)}%` } }),
        el('span', { class: 'mini-label' }, fmtBandValue(p.band))))));
}
