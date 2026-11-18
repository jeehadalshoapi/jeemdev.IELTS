/* What Claude reads when it marks an attempt (get_attempt / get_latest_attempt / list_attempts). */
import {
  isCompletionType, isMatchingType, isObjectiveType, letter, PLACEHOLDER_RE, type AnswerKey, type AttemptSummary,
  type AutoScore, type Part, type QuestionGroup, type TestContent
} from '@ielts/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attempts, files, tests } from '../db/schema';
import { getAttemptView, getResultView, isUuid, summarize } from '../attempts/service';
import { notFound } from '../http/errors';

interface ItemInfo { part: string; question: string; options?: Record<string, string> }

/** the text of every question / task, so Claude can mark without opening the test */
function itemInfo(content: TestContent): Map<string, ItemInfo> {
  const out = new Map<string, ItemInfo>();
  for (const part of content.parts) {
    for (const g of part.questionGroups) {
      const base = { part: part.title };
      if (isObjectiveType(g.type)) {
        const og = g as Extract<QuestionGroup, { questions: unknown[] }> & { options?: Array<{ label: string; text: string }>; template?: string };
        const bank = og.options ? Object.fromEntries(og.options.map(o => [o.label, o.text])) : undefined;
        const lines = og.template ? og.template.split('\n') : [];
        for (const q of og.questions as Array<{ id: string; text?: string; options?: string[] }>) {
          let text = q.text ?? '';
          if (!text && lines.length) {
            const line = lines.find(l => l.includes(`{{${q.id}}}`)) ?? '';
            text = line.replace(PLACEHOLDER_RE, (_m, id: string) => (id === q.id ? '[GAP]' : '___')).trim();
          }
          const options = q.options ? Object.fromEntries(q.options.map((o, i) => [letter(i), o])) : (isMatchingType(g.type) || (isCompletionType(g.type) && bank)) ? bank : undefined;
          out.set(q.id, { ...base, question: text, ...(options ? { options } : {}) });
        }
      } else if (g.type === 'writing_task1' || g.type === 'writing_task2' || g.type === 'paragraph') {
        out.set(g.id, { ...base, question: g.prompt });
      } else if (g.type === 'speaking_part2') {
        out.set(g.id, { ...base, question: `${g.cueCard.topic}\nYou should say: ${g.cueCard.bullets.join('; ')}${g.cueCard.closing ? `\n${g.cueCard.closing}` : ''}` });
        for (const q of g.followUps) out.set(q.id, { ...base, question: q.text });
      } else if (g.type === 'speaking_part1' || g.type === 'speaking_part3') {
        for (const q of g.questions) out.set(q.id, { ...base, question: q.text });
      }
    }
  }
  return out;
}

/** "iii" -> "iii (Glass in modern buildings)" */
const withOption = (value: string | null, options?: Record<string, string>) => {
  if (value === null) return null;
  const t = options?.[value] ?? options?.[value.toUpperCase()] ?? options?.[value.toLowerCase()];
  return t ? `${value} (${t})` : value;
};

const partTitles = (parts: Part[]) => new Map(parts.map(p => [p.id, p.title]));

/** short line per attempt for list_attempts */
export function attemptLine(a: AttemptSummary, origin: string) {
  return {
    id: a.id, testId: a.testId, test: a.title, skill: a.skill, kind: a.kind, mode: a.mode, status: a.status,
    score: a.autoScore?.total ? `${a.autoScore.raw}/${a.autoScore.total}` : null,
    estimatedBand: a.autoScore?.band ?? null,
    answered: `${a.answered}/${a.items}`,
    feedbackSaved: a.feedbackReady,
    startedAt: a.startedAt, submittedAt: a.submittedAt,
    resultsUrl: a.status === 'in_progress' ? null : `${origin}/#/result/${a.id}`
  };
}

export async function listAttemptLines(db: Db, origin: string, f: { testId?: string; status?: string; since?: Date; limit?: number }) {
  const rows = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id))
    .where(and(f.testId ? eq(attempts.testId, f.testId) : undefined))
    .orderBy(desc(attempts.updatedAt)).limit(500);
  return rows.map(r => summarize(r.attempts, r.tests))
    .filter(a => (!f.status || a.status === f.status) && (!f.since || new Date(a.submittedAt ?? a.updatedAt) >= f.since))
    .slice(0, Math.min(f.limit ?? 20, 100))
    .map(a => attemptLine(a, origin));
}

/** the newest submitted attempt (optionally of one skill) */
export async function latestSubmittedAttemptId(db: Db, skill?: string): Promise<string | null> {
  const rows = await db.select({ id: attempts.id, skill: tests.skill, content: tests.content }).from(attempts).innerJoin(tests, eq(attempts.testId, tests.id))
    .where(ne(attempts.status, 'in_progress')).orderBy(desc(attempts.submittedAt)).limit(200);
  const hit = rows.find(r => !skill || r.skill === skill || (r.skill === 'mixed' && r.content.parts.some(p => p.skill === skill)));
  return hit?.id ?? null;
}

/** everything about one attempt: each answer with the right answer and the reason, writing / speaking text, times */
export async function attemptDetail(db: Db, attemptId: string, origin: string): Promise<Record<string, unknown>> {
  if (!isUuid(attemptId)) throw notFound('Attempt not found (the id must be a uuid from list_attempts).');
  const live = await getAttemptView(db, attemptId); // also submits an exam attempt whose time ran out
  if (live.attempt.status === 'in_progress') {
    const answered = Object.values(live.attempt.answers).filter(v => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).length;
    return {
      id: live.attempt.id, status: 'in_progress', mode: live.attempt.mode, test: { id: live.test.id, title: live.test.title, skill: live.test.skill },
      note: 'Not submitted yet, so it is not scored. Ask the student to submit, or mark the answers so far.',
      answeredItems: answered, startedAt: live.attempt.startedAt, timeSpentSec: live.timing.spentSec, answersSoFar: live.attempt.answers
    };
  }

  const r = await getResultView(db, attemptId);
  const s = r.autoScore as AutoScore;
  const content = r.test.content;
  const info = itemInfo(content);
  const titles = partTitles(content.parts);
  const [testRow] = await db.select({ answerKey: tests.answerKey }).from(tests).where(eq(tests.id, r.attempt.testId)).limit(1);
  const key = (testRow?.answerKey ?? {}) as AnswerKey;
  const recordings = await db.select({ id: files.id, name: files.originalName, mime: files.mimeType }).from(files).where(eq(files.attemptId, attemptId));

  const questions = s.questions.map(q => {
    const i = info.get(q.questionId);
    return {
      number: q.number, id: q.questionId, type: q.type, part: titles.get(q.partId) ?? q.partId,
      question: i?.question ?? '',
      yourAnswer: withOption(q.answer, i?.options),
      correctAnswers: q.correctAnswers.map(c => withOption(c, i?.options)),
      result: q.reason,
      ...(q.note ? { note: q.note } : {}),
      ...(q.explanation ? { explanation: q.explanation } : {})
    };
  });

  const openItems = s.openItems.map(o => {
    const answer = r.attempt.answers[o.id] ?? null;
    return {
      id: o.id, type: o.type, part: titles.get(o.partId) ?? o.partId, task: info.get(o.id)?.question ?? '',
      answer, words: o.words, ...(o.minWords !== undefined ? { minWords: o.minWords } : {}),
      ...(key[o.id]?.modelAnswer ? { modelAnswer: key[o.id]!.modelAnswer } : {}),
      ...(key[o.id]?.notes ? { markingNotes: key[o.id]!.notes } : {})
    };
  });

  const perPartTime = Object.fromEntries(Object.entries(r.attempt.timeSpentSec).map(([k, v]) => [k === 'total' ? 'total' : titles.get(k) ?? k, Math.round(v)]));
  return {
    id: r.attempt.id,
    status: r.attempt.status,
    mode: r.attempt.mode,
    test: { id: r.test.id, title: r.test.title, skill: r.test.skill, kind: r.test.kind, variant: content.variant, timeLimitMin: content.timeLimitMin ?? null },
    startedAt: r.attempt.startedAt,
    submittedAt: r.attempt.submittedAt,
    autoSubmittedWhenTimeRanOut: r.attempt.autoSubmitted,
    timeUsedSec: r.attempt.timeUsedSec,
    timePerPartSec: perPartTime,
    score: { raw: s.raw, total: s.total, estimatedBand: s.band, sections: s.sections, perType: s.perType, reasons: s.reasons },
    questions,
    writingAndSpeaking: openItems,
    recordings: recordings.map(f => ({ name: f.name, type: f.mime, url: `${origin}/files/${f.id}` })),
    feedback: r.feedback,
    resultsUrl: `${origin}/#/result/${r.attempt.id}`,
    reasonsExplained: 'correct | wrong | blank (not answered) | over_word_limit (marked wrong, like the real test) | likely_spelling (wrong, but close to a correct answer — see note)'
  };
}
