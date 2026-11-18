import type { z } from 'zod';
import { describeWordLimit, expandOptional, fitsWordLimit, letter, countWords } from './answers';
import { templatePlaceholders } from './document';
import type { WordLimit } from './schema/common';
import type { ObjectiveGroup, QuestionGroup } from './schema/groups';
import { isCompletionType, isMatchingType, isObjectiveType, isSpeakingType, isWritingType, TFNG_CHOICES, YNNG_CHOICES } from './schema/groups';
import type { SectionSkill, TestDocument } from './schema/test';
import { TestDocument as TestDocumentSchema } from './schema/test';

export interface Issue {
  /** where the problem is, e.g. "parts[0].questionGroups[1].questions[2].number" */
  path: string;
  /** what is wrong and how to fix it */
  message: string;
}

export type ValidationResult =
  | { ok: true; test: TestDocument; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

/** ["parts", 0, "questionGroups", 1] -> "parts[0].questionGroups[1]" */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out += (out ? '.' : '') + String(seg);
  }
  return out || '(root)';
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map(i => `- ${i.path}: ${i.message}`).join('\n');
}

/** the value at a path in the raw input, or undefined when it is missing */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = input;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[seg];
  }
  return cur;
}

function zodIssues(error: z.ZodError, input: unknown): Issue[] {
  const out: Issue[] = [];
  for (const iss of error.issues) {
    const path = formatPath(iss.path);
    if (iss.code === 'unrecognized_keys') {
      const keys = iss.keys.map(k => `"${k}"`).join(', ');
      out.push({ path, message: `unknown field${iss.keys.length > 1 ? 's' : ''} ${keys} — check the spelling or remove ${iss.keys.length > 1 ? 'them' : 'it'}` });
    } else if (iss.code === 'invalid_type' && valueAt(input, iss.path) === undefined) {
      out.push({ path, message: 'is required' });
    } else {
      out.push({ path, message: iss.message });
    }
  }
  return out;
}

/** validate a test sent by Claude, the import box or a script */
export function validateTest(input: unknown): ValidationResult {
  const parsed = TestDocumentSchema.safeParse(input);
  if (!parsed.success) {
    const errors = zodIssues(parsed.error, input);
    return { ok: false, errors: [...errors, ...checkRestOfBrokenTest(input, parsed.error)], warnings: [] };
  }
  const { errors, warnings } = crossCheck(parsed.data);
  return errors.length ? { ok: false, errors, warnings } : { ok: true, test: parsed.data, warnings };
}

/**
 * When some question groups are malformed, set them aside and cross-check the rest of the test,
 * so every problem is reported in one round instead of one at a time.
 */
function checkRestOfBrokenTest(input: unknown, error: z.ZodError): Issue[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { parts?: unknown }).parts)) return [];
  const broken = new Set<string>();
  const brokenKeys = new Set<string>();
  for (const iss of error.issues) {
    const [a, pi, b, gi] = iss.path;
    // a malformed answer-key entry: set it aside too
    if (a === 'answerKey' && typeof pi === 'string') { brokenKeys.add(pi); continue; }
    if (a !== 'parts' || typeof pi !== 'number') return []; // a problem outside the groups: report it first
    if (b !== 'questionGroups' || typeof gi !== 'number') return [];
    broken.add(`${pi}:${gi}`);
  }
  const copy = structuredClone(input) as { parts: Array<{ questionGroups?: unknown[] }>; answerKey?: Record<string, unknown> };
  const droppedIds = new Set<string>(brokenKeys);
  if (copy.answerKey && typeof copy.answerKey === 'object') for (const id of brokenKeys) delete copy.answerKey[id];
  copy.parts.forEach((part, pi) => {
    if (!Array.isArray(part?.questionGroups)) return;
    part.questionGroups = part.questionGroups.filter((g, gi) => {
      if (!broken.has(`${pi}:${gi}`)) return true;
      const qs = (g as { questions?: Array<{ id?: unknown }> })?.questions;
      if (Array.isArray(qs)) for (const q of qs) if (typeof q?.id === 'string') droppedIds.add(q.id);
      return false;
    });
  });
  const reparsed = TestDocumentSchema.safeParse(copy);
  if (!reparsed.success) return [];
  // answer-key entries for the set-aside questions would look like "no such question" — leave those out
  return crossCheck(reparsed.data).errors.filter(e => {
    const m = e.path.match(/^answerKey\.([^.[]+)/);
    return !(m && droppedIds.has(m[1] as string));
  });
}

export class TestValidationError extends Error {
  constructor(readonly errors: Issue[], readonly warnings: Issue[] = []) {
    super(`The test is not valid:\n${formatIssues(errors)}`);
    this.name = 'TestValidationError';
  }
}

/** validate or throw TestValidationError */
export function parseTest(input: unknown): { test: TestDocument; warnings: Issue[] } {
  const r = validateTest(input);
  if (!r.ok) throw new TestValidationError(r.errors, r.warnings);
  return { test: r.test, warnings: r.warnings };
}

/* ------------------------------------------------------------------ */

interface ObjectiveInfo { path: string; group: ObjectiveGroup; numbers: number[]; options?: string[] }

const allowedInSection: Record<SectionSkill, (t: string) => boolean> = {
  reading: isObjectiveType,
  listening: isObjectiveType,
  writing: isWritingType,
  speaking: isSpeakingType
};

const numbersLabel = (n: number[]) => (n.length > 1 ? `questions ${n.join(' and ')}` : `question ${n[0]}`);

function crossCheck(doc: TestDocument): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  const idSeen = new Map<string, string>();
  const useId = (id: string, path: string) => {
    const prev = idSeen.get(id);
    if (prev) err(path, `duplicate id "${id}" (already used at ${prev}) — ids must be unique in the whole test`);
    else idSeen.set(id, path);
  };
  const numberSeen = new Map<number, string>();
  const objective = new Map<string, ObjectiveInfo>();
  const openItems = new Set<string>();
  const numberOrder: number[] = [];
  /** one recording for the whole test: the audio of an earlier listening part keeps playing through the later parts */
  let recordingSoFar = false;

  doc.parts.forEach((part, pi) => {
    const pp = `parts[${pi}]`;
    useId(part.id, `${pp}.id`);

    let section: SectionSkill | undefined;
    if (doc.skill === 'mixed') {
      section = part.skill;
      if (!section) err(`${pp}.skill`, 'is required when the test skill is "mixed" — set it to reading, listening, writing or speaking');
    } else {
      section = doc.skill;
      if (part.skill && part.skill !== doc.skill) err(`${pp}.skill`, `is "${part.skill}" but the test skill is "${doc.skill}" — remove it, or make the test skill "mixed"`);
    }

    if (section === 'reading' && !part.passage) err(`${pp}.passage`, 'is required for reading parts: { "title": "…", "paragraphs": [{ "label": "A", "text": "…" }] }');
    if (section && section !== 'reading' && part.passage) err(`${pp}.passage`, `only reading parts have a passage (this part is ${section})`);
    if (section === 'listening') {
      if (part.audioUrl) recordingSoFar = true;
      else if (!part.transcript && !recordingSoFar) {
        err(`${pp}.transcript`, 'is required for a listening part without "audioUrl" (unless an earlier part has one recording for the whole test) — the browser reads the transcript aloud, and shows it after submission');
      }
    }
    if (section && section !== 'listening') {
      if (part.audioUrl) err(`${pp}.audioUrl`, `audio belongs to listening parts (this part is ${section})`);
      if (part.transcript) err(`${pp}.transcript`, `a transcript belongs to listening parts (this part is ${section})`);
    }
    if (part.passage) {
      const labels = new Map<string, number>();
      part.passage.paragraphs.forEach((para, i) => {
        if (!para.label) return;
        const prev = labels.get(para.label.toUpperCase());
        if (prev !== undefined) err(`${pp}.passage.paragraphs[${i}].label`, `paragraph label "${para.label}" is already used by paragraphs[${prev}]`);
        else labels.set(para.label.toUpperCase(), i);
      });
    }

    part.questionGroups.forEach((g, gi) => {
      const gp = `${pp}.questionGroups[${gi}]`;
      useId(g.id, `${gp}.id`);
      if (section && !allowedInSection[section](g.type)) {
        err(`${gp}.type`, `"${g.type}" cannot be used in a ${section} part`);
      }
      if (isObjectiveType(g.type)) checkObjectiveGroup(g as ObjectiveGroup, gp);
      else if (isWritingType(g.type)) { openItems.add(g.id); checkWriting(g, gp); }
      else if (g.type === 'speaking_part2') {
        openItems.add(g.id);
        g.followUps.forEach((q, qi) => { useId(q.id, `${gp}.followUps[${qi}].id`); openItems.add(q.id); });
      } else if (g.type === 'speaking_part1' || g.type === 'speaking_part3') {
        g.questions.forEach((q, qi) => { useId(q.id, `${gp}.questions[${qi}].id`); openItems.add(q.id); });
      }
    });
  });

  function checkObjectiveGroup(g: ObjectiveGroup, gp: string) {
    const groupIds = new Set<string>();
    g.questions.forEach((q, qi) => {
      const qp = `${gp}.questions[${qi}]`;
      useId(q.id, `${qp}.id`);
      groupIds.add(q.id);
      const numbers = 'numbers' in q ? q.numbers : [q.number];
      const numPath = 'numbers' in q ? `${qp}.numbers` : `${qp}.number`;
      for (const n of numbers) {
        const prev = numberSeen.get(n);
        if (prev) err(numPath, `question number ${n} is used twice (also at ${prev})`);
        else numberSeen.set(n, numPath);
        numberOrder.push(n);
      }
      const info: ObjectiveInfo = { path: qp, group: g, numbers };
      if ('options' in q) info.options = q.options.map((_, i) => letter(i));
      if (g.type === 'mcq_multi' && 'numbers' in q && q.options.length <= q.numbers.length) {
        err(`${qp}.options`, `has ${q.options.length} options but the question asks for ${q.numbers.length} answers — add more options`);
      }
      objective.set(q.id, info);
    });

    if (isMatchingType(g.type) || (isCompletionType(g.type) && 'options' in g && g.options)) {
      const opts = (g as { options: Array<{ label: string }> }).options;
      const seen = new Map<string, number>();
      opts.forEach((o, oi) => {
        const k = o.label.toLowerCase();
        if (seen.has(k)) err(`${gp}.options[${oi}].label`, `label "${o.label}" is already used by options[${seen.get(k)}]`);
        else seen.set(k, oi);
      });
    }

    if (isCompletionType(g.type)) {
      const cg = g as Extract<QuestionGroup, { template?: string }> & { questions: Array<{ id: string; text?: string }>; wordLimit?: WordLimit; options?: unknown[] };
      if (cg.template) {
        const used = templatePlaceholders(cg.template);
        const counts = new Map<string, number>();
        for (const id of used) counts.set(id, (counts.get(id) ?? 0) + 1);
        for (const [id, c] of counts) {
          if (!groupIds.has(id)) err(`${gp}.template`, `{{${id}}} does not match any question id in this group (ids: ${[...groupIds].join(', ')})`);
          else if (c > 1) err(`${gp}.template`, `{{${id}}} appears ${c} times — each gap must appear once`);
        }
        cg.questions.forEach((q, qi) => {
          if (!counts.has(q.id)) err(`${gp}.questions[${qi}]`, `question "${q.id}" has no {{${q.id}}} gap in the template`);
        });
      } else {
        cg.questions.forEach((q, qi) => {
          if (!q.text || !q.text.trim()) err(`${gp}.questions[${qi}].text`, 'is required when the group has no "template" — write the sentence with "______" where the gap is');
        });
      }
      if (cg.options && cg.wordLimit) warn(`${gp}.wordLimit`, 'is ignored because the answers are chosen from the word box ("options")');
    }
  }

  function checkWriting(g: QuestionGroup, gp: string) {
    if (g.type !== 'writing_task1') return;
    g.charts.forEach((c, ci) => {
      const cp = `${gp}.charts[${ci}]`;
      if (c.chartType === 'line' || c.chartType === 'bar') {
        c.series.forEach((s, si) => {
          if (s.values.length !== c.labels.length) err(`${cp}.series[${si}].values`, `has ${s.values.length} values but there are ${c.labels.length} labels — give one value per label (use null for a gap)`);
        });
      } else if (c.chartType === 'table') {
        c.rows.forEach((r, ri) => {
          if (r.length !== c.columns.length) err(`${cp}.rows[${ri}]`, `has ${r.length} cells but there are ${c.columns.length} columns`);
        });
      }
    });
  }

  /* ---------- answer key ---------- */
  for (const [id, entry] of Object.entries(doc.answerKey)) {
    const kp = `answerKey.${id}`;
    const info = objective.get(id);
    if (info) {
      if (!entry.accept) { err(`${kp}.accept`, `is required — list the accepted answers for ${numbersLabel(info.numbers)}, e.g. ["TRUE"]`); continue; }
      checkKey(kp, entry.accept, info);
    } else if (openItems.has(id)) {
      if (entry.accept) err(`${kp}.accept`, 'writing and speaking tasks are marked by Claude — use "modelAnswer" or "notes" instead of "accept"');
    } else {
      err(kp, `there is no question with id "${id}" in this test`);
    }
  }
  for (const [id, info] of objective) {
    if (!doc.answerKey[id]) err(`answerKey.${id}`, `is missing — ${numbersLabel(info.numbers)} (${info.path}) needs an answer, e.g. "${id}": { "accept": ["…"] }`);
  }

  function checkKey(kp: string, accept: string[], info: ObjectiveInfo) {
    const g = info.group;
    const bad = (i: number, msg: string) => err(`${kp}.accept[${i}]`, msg);
    if (g.type === 'tfng' || g.type === 'ynng') {
      const allowed: readonly string[] = g.type === 'tfng' ? TFNG_CHOICES : YNNG_CHOICES;
      accept.forEach((a, i) => { if (!allowed.includes(a.trim().toUpperCase())) bad(i, `must be ${allowed.join(', ').replace(/, ([^,]*)$/, ' or $1')} (got "${a}")`); });
      return;
    }
    if (g.type === 'mcq_single' || g.type === 'mcq_multi') {
      const letters = info.options ?? [];
      const range = `${letters[0]}–${letters[letters.length - 1]}`;
      accept.forEach((a, i) => { if (!letters.includes(a.trim().toUpperCase())) bad(i, `must be an option letter ${range} (got "${a}")`); });
      if (g.type === 'mcq_multi') {
        const unique = new Set(accept.map(a => a.trim().toUpperCase()));
        if (unique.size !== accept.length) err(`${kp}.accept`, 'lists the same letter twice');
        if (accept.length !== info.numbers.length) {
          err(`${kp}.accept`, `must list exactly ${info.numbers.length} correct letters (the question has numbers [${info.numbers.join(', ')}], one mark each); got ${accept.length}`);
        }
      }
      return;
    }
    const options = 'options' in g && Array.isArray(g.options) ? g.options : undefined;
    if (isMatchingType(g.type) || options) {
      const labels = (options ?? []).map(o => o.label);
      accept.forEach((a, i) => {
        if (!labels.some(l => l.toLowerCase() === a.trim().toLowerCase())) bad(i, `must be one of the option labels ${labels.join(', ')} (got "${a}")`);
      });
      return;
    }
    // free-text answers: check the word limit
    const limit = 'wordLimit' in g ? g.wordLimit : undefined;
    if (!limit) return;
    const fitting = accept.map(a => expandOptional(a).some(f => fitsWordLimit(f, limit)));
    if (!fitting.some(Boolean)) {
      const sample = accept[0] ?? '';
      const c = countWords(sample);
      err(`${kp}.accept`, `no accepted answer fits the word limit (${describeWordLimit(limit)}): "${sample}" has ${c.words} word${c.words === 1 ? '' : 's'}${c.numbers ? ` and ${c.numbers} number${c.numbers === 1 ? '' : 's'}` : ''}`);
    } else {
      fitting.forEach((ok, i) => {
        if (!ok) warn(`${kp}.accept[${i}]`, `"${accept[i]}" is over the word limit (${describeWordLimit(limit)}), so it can never be marked correct`);
      });
    }
  }

  /* ---------- numbering ---------- */
  if (numberOrder.length) {
    const sorted = [...new Set(numberOrder)].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let n = 1; n <= (sorted[sorted.length - 1] ?? 0); n++) if (!numberSeen.has(n)) missing.push(n);
    if (missing.length) warn('parts', `question numbers skip ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''} — numbering usually runs 1, 2, 3… without gaps`);
    for (let i = 1; i < numberOrder.length; i++) {
      if ((numberOrder[i] ?? 0) < (numberOrder[i - 1] ?? 0)) {
        warn('parts', `question ${numberOrder[i]} comes after question ${numberOrder[i - 1]} — numbers usually increase through the test`);
        break;
      }
    }
  }

  return { errors, warnings };
}
