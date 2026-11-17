/* Convert tests from the old browser-only site (its "Export all" .json file) into the new test format. */
import type { AnswerKeyEntry, PassageParagraph, TestDocumentInput, WordLimit } from '@ielts/shared';

/* ---------- the old format (js/model.js) ---------- */
export interface LegacyOption { label: string; text: string }
export interface LegacyQuestion { id: string; text?: string; answer?: string | string[]; options?: string[]; choose?: number }
export interface LegacyGroup {
  id: string;
  type: 'tfng' | 'ynng' | 'mcq' | 'mcq_multi' | 'matching' | 'completion' | 'short';
  instructions?: string;
  title?: string;
  imageId?: string | null;
  questions?: LegacyQuestion[];
  options?: Array<LegacyOption | string>;
  content?: string;
  reuse?: boolean;
  labelStyle?: string;
}
export interface LegacyPart {
  id?: string; title?: string; passageTitle?: string; passage?: string; audioId?: string | null; transcript?: string;
  prompt?: string; imageId?: string | null; minWords?: number; modelAnswer?: string; groups?: LegacyGroup[];
}
export interface LegacyExam {
  id?: string; title?: string; module?: 'reading' | 'listening' | 'writing'; variant?: 'academic' | 'general';
  durationMinutes?: number; description?: string; parts?: LegacyPart[];
}
export interface LegacyFile { name: string; type: string; data: string }
export interface LegacyExport { exams: LegacyExam[]; files: Record<string, LegacyFile> }

/** accept the "Export all" file, a single-test export, a bare array of tests or a single test */
export function readLegacyExport(data: unknown): LegacyExport {
  if (Array.isArray(data)) return { exams: data as LegacyExam[], files: {} };
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.exams)) return { exams: d.exams as LegacyExam[], files: (d.files as Record<string, LegacyFile>) ?? {} };
    if (Array.isArray(d.parts)) return { exams: [d as LegacyExam], files: {} };
  }
  throw new Error('This is not an export from the old site: expected { "exams": [...], "files": {...} }');
}

/** every file id a legacy test refers to */
export function legacyFileIds(exam: LegacyExam): string[] {
  const ids: string[] = [];
  for (const p of exam.parts ?? []) {
    if (p.audioId) ids.push(p.audioId);
    if (p.imageId) ids.push(p.imageId);
    for (const g of p.groups ?? []) if (g.imageId) ids.push(g.imageId);
  }
  return ids;
}

/* ---------- helpers ---------- */
const NUMBER_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** "Choose NO MORE THAN TWO WORDS AND/OR A NUMBER" -> { maxWords: 2, allowNumber: true } */
export function inferWordLimit(instructions = ''): WordLimit | undefined {
  const s = instructions.toUpperCase().replace(/\*+/g, '').replace(/\s+/g, ' ');
  const allowNumber = /AND\/OR A NUMBER/.test(s);
  const m = s.match(/NO MORE THAN (ONE|TWO|THREE|FOUR|FIVE|\d+) WORDS?/);
  if (m?.[1]) return { maxWords: NUMBER_WORDS[m[1]] ?? Number(m[1]), allowNumber };
  if (/ONE WORD ONLY/.test(s)) return { maxWords: 1, allowNumber: false };
  if (/ONE WORD AND\/OR A NUMBER/.test(s)) return { maxWords: 1, allowNumber: true };
  return undefined;
}

/** old answers used "/" between alternatives: "lamp / light" */
const alternatives = (answer: unknown): string[] => String(answer ?? '').split('/').map(s => s.trim()).filter(Boolean);

function convertPassage(text = ''): PassageParagraph[] {
  const out: PassageParagraph[] = [];
  let heading: string | undefined;
  for (const block of text.trim().split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t) continue;
    if (t.startsWith('## ')) { heading = t.slice(3).trim(); continue; }
    const m = t.match(/^\[([A-Za-z0-9]{1,3})\]\s*/);
    const para: PassageParagraph = { text: m ? t.slice(m[0].length).trim() : t };
    if (m?.[1]) para.label = m[1];
    if (heading) { para.heading = heading; heading = undefined; }
    out.push(para);
  }
  if (heading) out.push({ text: heading });
  return out;
}

const optionsOf = (g: LegacyGroup): LegacyOption[] =>
  (g.options ?? []).map((o, i) => (typeof o === 'string' ? { label: String.fromCharCode(65 + i), text: o } : { label: String(o.label), text: o.text ?? '' }));

function completionType(g: LegacyGroup, hasBank: boolean): TestDocumentInput['parts'][number]['questionGroups'][number]['type'] {
  const instr = (g.instructions ?? '').toLowerCase();
  const lines = (g.content ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  if (g.imageId || /diagram|label/.test(instr)) return 'diagram_labelling';
  if (/flow-?chart/.test(instr) || lines.some(l => l.startsWith('> '))) return 'flowchart_completion';
  if (/\btable\b/.test(instr) || lines.some(l => l.includes('|'))) return 'table_completion';
  if (/\bform\b/.test(instr)) return 'form_completion';
  if (/\bnotes?\b/.test(instr) || lines.some(l => /^(#|-|•)\s/.test(l))) return 'note_completion';
  if (hasBank || /summary/.test(instr)) return 'summary_completion';
  return 'sentence_completion';
}

function matchingType(g: LegacyGroup, opts: LegacyOption[], hasImage: boolean, listening: boolean) {
  const words = `${g.title ?? ''} ${g.instructions ?? ''}`.toLowerCase();
  const lettersOnly = opts.every(o => !o.text.trim());
  if (listening && hasImage && lettersOnly) return 'map_labelling' as const;
  if (/heading/.test(words) || g.labelStyle === 'roman') return 'matching_headings' as const;
  if (/ending/.test(words)) return 'matching_sentence_endings' as const;
  if (lettersOnly || /paragraph|section/.test(words)) return 'matching_information' as const;
  return 'matching_features' as const;
}

/**
 * Convert one old test. `fileUrl` maps an old file id to its new URL (undefined when the file was not in the export).
 * The result still has to pass validateTest — the import reports anything it rejects.
 */
export function convertLegacyExam(exam: LegacyExam, fileUrl: (legacyFileId: string) => string | undefined): { doc: TestDocumentInput; notes: string[] } {
  const notes: string[] = [];
  const module = exam.module === 'listening' || exam.module === 'writing' ? exam.module : 'reading';
  const answerKey: Record<string, AnswerKeyEntry> = {};
  const urlFor = (id: string | null | undefined, what: string) => {
    if (!id) return undefined;
    const url = fileUrl(id);
    if (!url) notes.push(`${what}: the file was not in the export, so it was left out`);
    return url;
  };
  let num = 1, groupNo = 1;

  const parts = (exam.parts ?? []).map((p, pi) => {
    const title = p.title?.trim() || `Part ${pi + 1}`;
    const part: Record<string, unknown> = { id: `p${pi + 1}`, title };

    if (module === 'writing') {
      const id = `w${pi + 1}`;
      const group: Record<string, unknown> = { id, type: pi === 0 ? 'writing_task1' : 'writing_task2', prompt: p.prompt ?? '' };
      if (p.minWords !== undefined) group.minWords = p.minWords;
      const img = urlFor(p.imageId, `${title} picture`);
      if (img) group.imageUrl = img;
      if (p.modelAnswer?.trim()) answerKey[id] = { modelAnswer: p.modelAnswer.trim() };
      part.questionGroups = [group];
      return part;
    }

    if (module === 'reading') {
      part.passage = { ...(p.passageTitle?.trim() ? { title: p.passageTitle.trim() } : {}), paragraphs: convertPassage(p.passage) };
    } else {
      const audio = urlFor(p.audioId, `${title} audio`);
      if (audio) part.audioUrl = audio;
      if (p.transcript?.trim()) part.transcript = p.transcript.trim();
    }

    part.questionGroups = (p.groups ?? []).map(g => {
      const id = `g${groupNo++}`;
      const group: Record<string, unknown> = { id };
      if (g.instructions?.trim()) group.instructions = g.instructions.trim();
      if (g.title?.trim()) group.title = g.title.trim();
      const image = urlFor(g.imageId, `${title} group picture`);
      if (image) group.imageUrl = image;
      const opts = optionsOf(g);
      const qs = g.questions ?? [];

      switch (g.type) {
        case 'tfng':
        case 'ynng':
        case 'short': {
          group.type = g.type === 'short' ? 'short_answer' : g.type;
          if (g.type === 'short') { const wl = inferWordLimit(g.instructions); if (wl) group.wordLimit = wl; }
          group.questions = qs.map(q => {
            const qid = `q${num}`;
            const ans = alternatives(q.answer);
            answerKey[qid] = { accept: g.type === 'short' ? ans : ans.map(a => a.toUpperCase()) };
            return { id: qid, number: num++, text: q.text ?? '' };
          });
          break;
        }
        case 'mcq': {
          group.type = 'mcq_single';
          group.questions = qs.map(q => {
            const qid = `q${num}`;
            answerKey[qid] = { accept: alternatives(q.answer).map(a => a.toUpperCase()) };
            return { id: qid, number: num++, text: q.text ?? '', options: q.options ?? [] };
          });
          break;
        }
        case 'mcq_multi': {
          group.type = 'mcq_multi';
          group.questions = qs.map(q => {
            const letters = (Array.isArray(q.answer) ? q.answer : alternatives(q.answer)).map(a => String(a).toUpperCase());
            const count = Math.max(1, letters.length || q.choose || 2);
            const qid = `q${num}`;
            answerKey[qid] = { accept: letters };
            const numbers = Array.from({ length: count }, (_, k) => num + k);
            num += count;
            return { id: qid, numbers, text: q.text ?? '', options: q.options ?? [] };
          });
          break;
        }
        case 'matching': {
          group.type = matchingType(g, opts, !!image, module === 'listening');
          if (g.title?.trim()) { group.optionsTitle = g.title.trim(); delete group.title; }
          group.options = opts;
          if (g.reuse) group.allowReuse = true;
          group.questions = qs.map(q => {
            const qid = `q${num}`;
            answerKey[qid] = { accept: alternatives(q.answer) };
            return { id: qid, number: num++, text: q.text ?? '' };
          });
          break;
        }
        case 'completion': {
          const hasBank = opts.length > 0;
          group.type = completionType(g, hasBank);
          if (hasBank) group.options = opts;
          else { const wl = inferWordLimit(g.instructions); if (wl) group.wordLimit = wl; }
          const questions: Array<{ id: string; number: number }> = [];
          group.template = (g.content ?? '').replace(/\[\[(.*?)\]\]/g, (_m, ans: string) => {
            const qid = `q${num}`;
            answerKey[qid] = { accept: alternatives(ans) };
            questions.push({ id: qid, number: num++ });
            return `{{${qid}}}`;
          });
          group.questions = questions;
          break;
        }
        default:
          notes.push(`${title}: question type "${String((g as { type: unknown }).type)}" is unknown and was skipped`);
      }
      return group;
    });
    return part;
  });

  const doc: TestDocumentInput = {
    title: exam.title?.trim() || 'Imported test',
    skill: module,
    kind: 'practice',
    variant: exam.variant === 'general' ? 'general_training' : 'academic',
    parts: parts as unknown as TestDocumentInput['parts'],
    answerKey
  };
  if (exam.durationMinutes) doc.timeLimitMin = exam.durationMinutes;
  if (exam.description?.trim()) doc.instructions = exam.description.trim();
  return { doc, notes };
}
