import type { QuestionType } from './schema/groups';
import { isObjectiveType, isSpeakingType, isWritingType } from './schema/groups';
import type { AnswerKey, Part, SectionSkill, Skill, TestContent, TestDocument, TestMeta } from './schema/test';

/** {{questionId}} placeholders in completion templates */
export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*\}\}/g;

export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map(m => m[1] as string);
}

/** something the candidate answers: an objective question, a writing task or a speaking question */
export interface AnswerItem {
  id: string;
  kind: 'objective' | 'writing' | 'speaking';
  type: QuestionType;
  partId: string;
  groupId: string;
  /** question numbers (objective only); "choose TWO" has two */
  numbers: number[];
  /** marks available (objective only) */
  marks: number;
}

export function sectionSkillOf(part: Part, testSkill: Skill): SectionSkill | undefined {
  return part.skill ?? (testSkill === 'mixed' ? undefined : testSkill);
}

/** every answerable item, in test order */
export function listItems(parts: readonly Part[]): AnswerItem[] {
  const items: AnswerItem[] = [];
  for (const part of parts) {
    for (const g of part.questionGroups) {
      const base = { partId: part.id, groupId: g.id, type: g.type };
      if (isObjectiveType(g.type)) {
        for (const q of (g as { questions: Array<{ id: string; number?: number; numbers?: number[] }> }).questions) {
          const numbers = q.numbers ?? (q.number !== undefined ? [q.number] : []);
          items.push({ ...base, id: q.id, kind: 'objective', numbers, marks: numbers.length });
        }
      } else if (g.type === 'sentence_rewrite') {
        for (const it of g.items) items.push({ ...base, id: it.id, kind: 'writing', numbers: [], marks: 0 });
      } else if (isWritingType(g.type)) {
        items.push({ ...base, id: g.id, kind: 'writing', numbers: [], marks: 0 });
      } else if (isSpeakingType(g.type)) {
        if (g.type === 'speaking_part2') {
          items.push({ ...base, id: g.id, kind: 'speaking', numbers: [], marks: 0 });
          for (const q of g.followUps) items.push({ ...base, id: q.id, kind: 'speaking', numbers: [], marks: 0 });
        } else if (g.type === 'speaking_part1' || g.type === 'speaking_part3') {
          for (const q of g.questions) items.push({ ...base, id: q.id, kind: 'speaking', numbers: [], marks: 0 });
        }
      }
    }
  }
  return items;
}

/** an answer that is not empty (text, chosen letters, or a Task 2 drill with some text) */
export function isAnswered(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return Object.values(v as object).some(x => typeof x === 'string' && x.trim() !== '');
}

/** answered / total, counted in question numbers ("choose TWO" = 2); writing and speaking tasks count 1 each */
export function progressOf(answers: Record<string, unknown>, parts: readonly Part[]): { answered: number; total: number } {
  let answered = 0, total = 0;
  for (const item of listItems(parts)) {
    const units = Math.max(1, item.marks);
    const v = answers[item.id];
    total += units;
    answered += item.type === 'mcq_multi' ? Math.min(Array.isArray(v) ? v.length : 0, units) : isAnswered(v) ? units : 0;
  }
  return { answered, total };
}

/** total auto-scored marks (e.g. 40 for a full reading test) */
export function totalMarks(parts: readonly Part[]): number {
  return listItems(parts).reduce((s, i) => s + i.marks, 0);
}

/** split a validated document into the database columns */
export function splitDocument(doc: TestDocument): { meta: TestMeta; content: TestContent; answerKey: AnswerKey } {
  const { title, skill, kind, instructions, dueDate, variant, timeLimitMin, vocabularySetId, masteryStepId, parts, answerKey } = doc;
  const meta: TestMeta = { title, skill, kind };
  if (instructions !== undefined) meta.instructions = instructions;
  if (dueDate !== undefined) meta.dueDate = dueDate;
  const content: TestContent = { variant, parts };
  if (timeLimitMin !== undefined) content.timeLimitMin = timeLimitMin;
  if (vocabularySetId !== undefined) content.vocabularySetId = vocabularySetId;
  if (masteryStepId !== undefined) content.masteryStepId = masteryStepId;
  return { meta, content, answerKey };
}

/** rebuild the full document (e.g. for get_test) */
export function joinDocument(meta: TestMeta, content: TestContent, answerKey: AnswerKey): TestDocument {
  const doc: TestDocument = { title: meta.title, skill: meta.skill, kind: meta.kind, variant: content.variant, parts: content.parts, answerKey };
  if (content.timeLimitMin !== undefined) doc.timeLimitMin = content.timeLimitMin;
  if (content.vocabularySetId !== undefined) doc.vocabularySetId = content.vocabularySetId;
  if (content.masteryStepId !== undefined) doc.masteryStepId = content.masteryStepId;
  if (meta.instructions) doc.instructions = meta.instructions;
  if (meta.dueDate) doc.dueDate = meta.dueDate;
  return doc;
}

/**
 * What the browser may see before the attempt is submitted:
 * the content without listening transcripts or dictation words. (The answer key is stored separately and never included.)
 */
export function toPublicContent(content: TestContent): TestContent {
  const copy = structuredClone(content);
  for (const part of copy.parts) {
    delete part.transcript;
    for (const g of part.questionGroups) {
      if (g.type !== 'dictation') continue;
      for (const q of g.questions) { (q as { say?: string }).say = ''; delete q.sentence; }
    }
  }
  return copy;
}

/** the test format says "items" for dictation words in one place; the schema calls them "questions" like every objective type */
export function normalizeTestInput(input: unknown): unknown {
  const parts = (input as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts)) return input;
  let changed = false;
  const fixed = parts.map(p => {
    const groups = (p as { questionGroups?: unknown } | null)?.questionGroups;
    if (!Array.isArray(groups)) return p;
    return {
      ...(p as object), questionGroups: groups.map(g => {
        const gg = g as { type?: unknown; items?: unknown; questions?: unknown } | null;
        if (!gg || gg.type !== 'dictation' || gg.items === undefined || gg.questions !== undefined) return g;
        changed = true;
        const { items, ...rest } = gg;
        return { ...rest, questions: items };
      })
    };
  });
  return changed ? { ...(input as object), parts: fixed } : input;
}
