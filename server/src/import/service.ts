/* The import box (Phase 4): check and save a test pasted as JSON or in the text format. */
import {
  isObjectiveType, listItems, sectionSkillOf, totalMarks, validateTest,
  type ImportCheckResponse, type ImportIssue, type ImportSummary, type QuestionType, type TestDocument, type TestDocumentInput
} from '@ielts/shared';
import { eq, inArray, and, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { files as filesTable, tests } from '../db/schema';
import { convertLegacyExam } from '../legacy/convert';
import { createTest } from '../tests/repository';
import { parseTestText, type TextLayout } from './textformat';

/** stands in for files that are not attached (used by `npm run validate`, which only checks the text) */
const PLACEHOLDER_FILE = '/files/00000000-0000-0000-0000-000000000000';

export interface PreparedImport extends ImportCheckResponse {
  /** the document to save (valid when ok) */
  doc: unknown;
  /** ids of the attached files the test uses */
  fileIds: string[];
}

/** ```json … ``` copied from a chat: keep what is inside the fence */
export function stripFences(source: string): string {
  const m = source.match(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/);
  return (m?.[1] ?? source).trim();
}

/**
 * Where JSON.parse gave up. Its messages do not always include a position, so walk the text with a small
 * JSON reader of our own and return the offset of the first character it cannot accept (-1 if none).
 */
export function jsonErrorOffset(s: string): number {
  let i = 0;
  const fail = (): never => { throw i; };
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i]!)) i++; };
  const str = () => {
    i++;
    while (i < s.length) {
      const c = s[i]!;
      if (c === '"') { i++; return; }
      if (c === '\\') { i += 2; continue; }
      if (c < ' ') fail();
      i++;
    }
    fail();
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++; ws();
      if (s[i] === close) { i++; return; }
      for (;;) {
        ws();
        if (c === '{') { if (s[i] !== '"') fail(); str(); ws(); if (s[i] !== ':') fail(); i++; }
        value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === close) { i++; return; }
        fail();
      }
    }
    if (c === '"') { str(); return; }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 64));
    if (m) { i += m[0].length; return; }
    fail();
  };
  try {
    value(); ws();
    return i < s.length ? i : -1;
  } catch (e) {
    return typeof e === 'number' ? e : -1;
  }
}

/** "line 3, column 12" (and a hint for the most common slip) for JSON that does not parse */
function jsonErrorWhere(text: string): { where?: string; hint?: string } {
  const at = jsonErrorOffset(text);
  if (at < 0) return {};
  const before = text.slice(0, at);
  const where = `line ${before.split('\n').length}, column ${at - before.lastIndexOf('\n')}`;
  const prev = before.trimEnd().slice(-1);
  if ((text[at] === '}' || text[at] === ']') && prev === ',') return { where, hint: `remove the comma before "${text[at]}"` };
  if (at >= text.length) return { where, hint: 'the text ends too early — is the end of the test missing?' };
  return { where };
}

const baseName = (name: string) => (name.split(/[\\/]/).pop() ?? name).trim().toLowerCase();
const isUrl = (s: string) => /^https?:\/\//i.test(s) || /^\/files\//.test(s);

/* ---------- default instructions (the text format lets you leave INSTRUCTIONS: out) ---------- */
const NUMBER_WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).map(x => `**${x}**`).join(', ')} or **${xs[xs.length - 1]}**` : `**${xs[0] ?? ''}**`);

const COMPLETION_NOUN: Partial<Record<QuestionType, string>> = {
  sentence_completion: 'sentences', summary_completion: 'summary', note_completion: 'notes', table_completion: 'table',
  flowchart_completion: 'flow-chart', form_completion: 'form'
};

function defaultInstructions(g: Record<string, unknown>): string | undefined {
  const type = g.type as QuestionType;
  const qs = (g.questions as Array<{ options?: unknown[]; numbers?: number[] }> | undefined) ?? [];
  const bank = Array.isArray(g.options) ? (g.options as Array<{ label: string }>) : [];
  switch (type) {
    case 'tfng':
      return 'Do the following statements agree with the information given in the passage?\n\nChoose\n**TRUE** if the statement agrees with the information\n**FALSE** if the statement contradicts the information\n**NOT GIVEN** if there is no information on this';
    case 'ynng':
      return 'Do the following statements agree with the claims of the writer?\n\nChoose\n**YES** if the statement agrees with the claims of the writer\n**NO** if the statement contradicts the claims of the writer\n**NOT GIVEN** if it is impossible to say what the writer thinks about this';
    case 'mcq_single':
      return `Choose the correct letter, ${orList(letters(Math.max(2, ...qs.map(q => q.options?.length ?? 0))))}.`;
    case 'mcq_multi': {
      const n = Math.max(2, ...qs.map(q => q.numbers?.length ?? 0));
      const ls = letters(Math.max(n + 1, ...qs.map(q => q.options?.length ?? 0)));
      return `Choose **${NUMBER_WORDS[n] ?? n}** letters, **A–${ls[ls.length - 1]}**.`;
    }
    case 'matching_headings': return 'Choose the correct heading for each paragraph from the list of headings below.';
    case 'matching_information': return 'Which paragraph contains the following information?';
    case 'matching_features': return 'Match each statement with the correct option from the list below.';
    case 'matching_sentence_endings': return 'Complete each sentence with the correct ending from the list below.';
    case 'map_labelling': return 'Label the map below.';
    case 'diagram_labelling': return 'Label the diagram below.';
    case 'short_answer': return 'Answer the questions below.';
    default: {
      const noun = COMPLETION_NOUN[type];
      if (!noun) return undefined;
      return bank.length
        ? `Complete the ${noun} using the list of words, **${bank[0]!.label}–${bank[bank.length - 1]!.label}**, below.`
        : `Complete the ${noun} below.`;
    }
  }
}

/* ---------- "where" in words: Part 1 “Passage 1” › MATCHING HEADINGS › question 14 (line 40) ---------- */
interface LooseDoc {
  parts?: Array<{ title?: unknown; questionGroups?: Array<{ id?: unknown; type?: unknown; questions?: Array<{ id?: unknown; number?: unknown; numbers?: unknown }>; followUps?: Array<{ id?: unknown }> }> }>;
}

function findItem(doc: LooseDoc, id: string): [number, number, number] | null {
  for (const [pi, p] of (doc.parts ?? []).entries()) {
    for (const [gi, g] of (p?.questionGroups ?? []).entries()) {
      if (g?.id === id) return [pi, gi, -1];
      const qi = (g?.questions ?? []).findIndex(q => q?.id === id);
      if (qi >= 0) return [pi, gi, qi];
      if ((g?.followUps ?? []).some(q => q?.id === id)) return [pi, gi, -1];
    }
  }
  return null;
}

export function locate(path: string, input: unknown, layout?: TextLayout): string | undefined {
  const doc = (input && typeof input === 'object' ? input : {}) as LooseDoc;
  let pi: number, gi = -1, qi = -1;
  const m = path.match(/^parts\[(\d+)\](?:\.questionGroups\[(\d+)\](?:\.questions\[(\d+)\])?)?/);
  const k = path.match(/^answerKey\.([^.[]+)/);
  if (m) {
    pi = Number(m[1]);
    if (m[2] !== undefined) gi = Number(m[2]);
    if (m[3] !== undefined) qi = Number(m[3]);
  } else if (k) {
    const found = findItem(doc, k[1]!);
    if (!found) return undefined;
    [pi, gi, qi] = found;
  } else {
    return undefined;
  }
  const part = doc.parts?.[pi];
  const group = gi >= 0 ? part?.questionGroups?.[gi] : undefined;
  const q = qi >= 0 ? group?.questions?.[qi] : undefined;
  const lay = layout?.parts[pi];
  const bits: string[] = [];
  const title = lay?.title ?? (typeof part?.title === 'string' ? part.title : '');
  bits.push(title && title.toLowerCase() !== `part ${pi + 1}` ? `Part ${pi + 1} “${title}”` : `Part ${pi + 1}`);
  if (gi >= 0) {
    const name = lay?.groups[gi]?.name ?? (typeof group?.type === 'string' ? group.type : '');
    bits.push(name ? `group ${gi + 1} (${name})` : `group ${gi + 1}`);
  }
  if (q) {
    const nums = Array.isArray(q.numbers) ? q.numbers : typeof q.number === 'number' ? [q.number] : [];
    if (nums.length) bits.push(`question ${nums.join('–')}`);
  }
  const line = gi >= 0 ? lay?.groups[gi]?.line : lay?.line;
  return (line ? `line ${line} · ` : '') + bits.join(' › ');
}

/* ---------- summary of a valid test ---------- */
export function summarize(test: TestDocument): ImportSummary {
  const items = listItems(test.parts);
  return {
    title: test.title,
    skill: test.skill,
    kind: test.kind,
    variant: test.variant,
    timeLimitMin: test.timeLimitMin ?? null,
    dueDate: test.dueDate ?? null,
    marks: totalMarks(test.parts),
    answers: items.filter(i => i.kind === 'objective' && test.answerKey[i.id]?.accept?.length).reduce((s, i) => s + i.marks, 0),
    parts: test.parts.map(p => ({
      title: p.title,
      section: sectionSkillOf(p, test.skill) ?? null,
      marks: totalMarks([p]),
      timeLimitMin: p.timeLimitMin ?? null,
      audio: p.audioUrl ?? null,
      hasTranscript: !!p.transcript,
      groups: p.questionGroups.map(g => {
        const numbers = isObjectiveType(g.type) ? items.filter(i => i.groupId === g.id).flatMap(i => i.numbers) : [];
        return { type: g.type, title: ('title' in g && g.title) || null, numbers, marks: numbers.length };
      })
    }))
  };
}

/**
 * Read and validate a pasted test without saving it.
 * `files` maps the file names written in the test (AUDIO: part1.mp3, or "audioUrl": "part1.mp3") to uploaded files.
 */
export function prepareImport(source: string, files: Record<string, string> = {}, opts: { assumeFiles?: boolean } = {}): PreparedImport {
  const text = stripFences(source);
  const format: 'json' | 'text' = /^[[{]/.test(text) ? 'json' : 'text';
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const byName = new Map(Object.entries(files).map(([name, url]) => [baseName(name), url]));
  const used = new Set<string>();
  const fileFor = (name: string): string | undefined => {
    const url = byName.get(baseName(name));
    if (url) { used.add(baseName(name)); return url; }
    return opts.assumeFiles ? PLACEHOLDER_FILE : undefined;
  };
  const notAttached = (name: string) => `the file "${name}" is not attached — add it with "Attach audio / pictures", or remove this line`;
  const fail = (): PreparedImport => ({ format, ok: false, errors, warnings, summary: null, json: null, doc: null, fileIds: [] });

  let doc: unknown;
  let layout: TextLayout | undefined;

  if (format === 'json') {
    try {
      doc = JSON.parse(text);
    } catch (e) {
      // V8: 'Unexpected token \',\', "…snippet…" is not valid JSON' or '… in JSON at position 85 (line 5 column 33)'
      const short = (e as Error).message
        .replace(/, "[\s\S]*" is not valid JSON$/, '')
        .replace(/\s*\(line \d+ column \d+\)/, '')
        .replace(/ in JSON at position \d+/, '');
      const { where, hint } = jsonErrorWhere(text);
      errors.push({ path: '(json)', message: `is not valid JSON: ${short}${hint ? ` — ${hint}` : ''}`, ...(where ? { where } : {}) });
      return fail();
    }
    if (Array.isArray(doc)) {
      errors.push({ path: '(root)', message: 'is a list — paste one test at a time (a single { … } object)' });
      return fail();
    }
    if (!doc || typeof doc !== 'object') {
      errors.push({ path: '(root)', message: 'must be a test object { "title": …, "skill": …, "parts": [ … ] }' });
      return fail();
    }
    // "audioUrl": "part1.mp3" -> the uploaded file
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const p = path ? `${path}.${key}` : key;
        if ((key === 'audioUrl' || key === 'imageUrl') && typeof value === 'string' && value.trim() && !isUrl(value.trim())) {
          const url = fileFor(value);
          if (!url) errors.push({ path: p, message: notAttached(value) });
          // a placeholder keeps the validator from reporting the same file a second time
          (node as Record<string, unknown>)[key] = url ?? PLACEHOLDER_FILE;
        } else {
          walk(value, p);
        }
      }
    };
    walk(doc, '');
  } else {
    const parsed = parseTestText(text);
    layout = parsed.layout;
    for (const name of new Set(parsed.fileNames)) {
      if (!fileFor(name)) {
        const lineNo = text.split(/\r?\n/).findIndex(l => l.includes(name)) + 1;
        errors.push({ path: '(text)', message: notAttached(name), ...(lineNo ? { where: `line ${lineNo}` } : {}) });
      }
    }
    // missing files are reported above; the placeholder keeps the rest of the check meaningful
    const { doc: converted, notes } = convertLegacyExam(parsed.exam, name => fileFor(name) ?? PLACEHOLDER_FILE);
    const d = converted as TestDocumentInput & Record<string, unknown>;
    if (parsed.kind) d.kind = parsed.kind;
    if (parsed.dueDate) d.dueDate = parsed.dueDate;
    for (const part of d.parts as unknown as Array<{ questionGroups?: Array<Record<string, unknown>> }>) {
      for (const g of part.questionGroups ?? []) {
        if (!g.instructions && g.type) { const t = defaultInstructions(g); if (t) g.instructions = t; }
      }
    }
    for (const n of parsed.notes) warnings.push({ path: '(text)', message: n.message, ...(n.line ? { where: `line ${n.line}` } : {}) });
    for (const n of notes) warnings.push({ path: '(text)', message: n });
    doc = d;
  }

  const result = validateTest(doc);
  const where = (i: ImportIssue): ImportIssue => {
    if (i.where) return i;
    const w = locate(i.path, doc, layout);
    return w ? { ...i, where: w } : i;
  };
  errors.push(...(result.ok ? [] : result.errors));
  warnings.push(...result.warnings);
  for (const name of byName.keys()) if (!used.has(name)) warnings.push({ path: '(files)', message: `"${name}" is attached but the test does not use it` });

  const ok = errors.length === 0 && result.ok;
  const fileIds = [...used].map(n => byName.get(n)!.replace('/files/', ''));
  return {
    format,
    ok,
    errors: errors.map(where),
    warnings: warnings.map(where),
    summary: ok && result.ok ? summarize(result.test) : null,
    json: format === 'text' ? doc : null,
    doc,
    fileIds
  };
}

/** check a pasted test, and warn when a test with the same title is already saved */
export async function checkImport(db: Db, body: { source: string; files: Record<string, string> }): Promise<PreparedImport> {
  const r = prepareImport(body.source, body.files);
  const title = r.summary?.title;
  if (title) {
    const [same] = await db.select({ status: tests.status, createdAt: tests.createdAt }).from(tests).where(eq(tests.title, title)).limit(1);
    if (same) {
      r.warnings.unshift({
        path: 'title',
        message: `a test called "${title}" is already saved (added ${same.createdAt.toISOString().slice(0, 10)}${same.status === 'archived' ? ', archived' : ''}) — saving makes a second copy`
      });
    }
  }
  return r;
}

/** save a checked test (source "manual") and link the attached files to it */
export async function saveImport(db: Db, r: PreparedImport): Promise<{ id: string; title: string }> {
  const { id, test } = await createTest(db, r.doc, { source: 'manual' });
  if (r.fileIds.length) {
    await db.update(filesTable).set({ testId: id }).where(and(inArray(filesTable.id, r.fileIds), isNull(filesTable.testId)));
  }
  return { id, title: test.title };
}
