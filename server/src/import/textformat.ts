/* The plain-text test format (HOW-TO-ADD-TESTS.md), ported from the old site's js/textformat.js (commit 38d7c76).
   The text is read into the old site's test shape; convertLegacyExam() then turns that into the new TestDocument,
   so text imports and the old "Export all" import share one tested conversion. */
import type { Kind } from '@ielts/shared';
import type { LegacyExam, LegacyGroup, LegacyOption, LegacyPart, LegacyQuestion } from '../legacy/convert';

const KEY_RE = /^\s*(TITLE|MODULE|TYPE|KIND|DUE|TIME|DESCRIPTION|TEXT|PASSAGE|AUDIO|TRANSCRIPT|PROMPT|IMAGE|MIN WORDS|MODEL ANSWER|INSTRUCTIONS|OPTIONS|QUESTIONS|REUSE|ANSWERS?)\s*:[ \t]?(.*)$/i;
/** sections whose text may contain lines like "Name: …" — inside them only an UPPER-CASE key starts a new section */
const FREE = ['TEXT', 'PASSAGE', 'TRANSCRIPT', 'PROMPT', 'MODEL ANSWER', 'INSTRUCTIONS', 'DESCRIPTION'];
const PART_RE = /^\s*={3,}\s*(.*?)\s*=*\s*$/;
const GROUP_RE = /^\s*-{3,}\s*(.*?)\s*-*\s*$/;

type OldType = LegacyGroup['type'];
type Module = 'reading' | 'listening' | 'writing';

const TYPE_NAMES: Record<OldType, string> = {
  tfng: 'TRUE FALSE NOT GIVEN', ynng: 'YES NO NOT GIVEN', mcq: 'MULTIPLE CHOICE', mcq_multi: 'CHOOSE TWO',
  matching: 'MATCHING', completion: 'COMPLETION', short: 'SHORT ANSWER'
};
const CHOICES = { tfng: ['TRUE', 'FALSE', 'NOT GIVEN'], ynng: ['YES', 'NO', 'NOT GIVEN'] } as const;
const MODULES: Record<Module, { label: string; partName: string; defaultMinutes: number }> = {
  reading: { label: 'Reading', partName: 'Passage', defaultMinutes: 60 },
  listening: { label: 'Listening', partName: 'Part', defaultMinutes: 35 },
  writing: { label: 'Writing', partName: 'Task', defaultMinutes: 60 }
};
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];

function makeLabel(style: 'roman' | 'number' | 'upper', i: number): string {
  if (style === 'roman') return ROMAN[i] ?? String(i + 1);
  if (style === 'number') return String(i + 1);
  return String.fromCharCode(65 + i);
}

export function detectType(name: string): OldType | null {
  const n = ` ${name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
  if (/ TRUE | TFNG /.test(n)) return 'tfng';
  if (/ YES | YNNG /.test(n)) return 'ynng';
  if (/ CHOOSE (TWO|THREE|FOUR|2|3|4) | MULTIPLE ANSWERS? | MULTI /.test(n)) return 'mcq_multi';
  if (/ MULTIPLE CHOICE | MCQ | CHOICE /.test(n)) return 'mcq';
  if (/MATCH|HEADING|ENDINGS|CLASSIF/.test(n)) return 'matching';
  if (/COMPLET|SUMMARY|NOTE|TABLE|FLOW|DIAGRAM|FORM|LABEL|GAP|FILL|MAP|PLAN/.test(n)) return 'completion';
  if (/SHORT|ANSWER THE QUESTION/.test(n)) return 'short';
  return null;
}

function titleCase(s: string): string {
  const t = s.trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : t;
}

const nonEmptyLines = (text: string) => text.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());

/** "i. text", "A) text", "B text" (in sequence), "C" -> [{ label, text }] */
export function labeledList(text: string): LegacyOption[] {
  const lines = nonEmptyLines(text);
  const strict = lines.map(l => l.match(/^\s*([ivxIVX]{1,6}|[A-Za-z]|\d{1,2})\s*[.):\]–-]\s*(.*)$/) ?? l.match(/^\s*([ivx]{1,6}|[A-Z])\s*$/));
  if (strict.every(Boolean)) return strict.map(m => ({ label: m![1]!, text: (m![2] ?? '').trim() }));
  const loose = lines.map(l => l.match(/^\s*([ivx]{1,6}|[A-Z]|\d{1,2})\s+(.+)$/));
  if (loose.every(Boolean)) {
    const labels = loose.map(m => m![1]!);
    const first = labels[0] ?? '';
    const style = first === 'i' ? 'roman' : /^\d+$/.test(first) ? 'number' : 'upper';
    if (labels.every((l, i) => l === makeLabel(style, i))) return loose.map(m => ({ label: m![1]!, text: m![2]!.trim() }));
  }
  return lines.map((l, i) => {
    const m = strict[i];
    return m ? { label: m[1]!, text: (m[2] ?? '').trim() } : { label: makeLabel('upper', i), text: l.trim() };
  });
}

function splitAnswer(line: string): [string, string] {
  const i = line.lastIndexOf('|');
  return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

const stripNumber = (s: string) => s.replace(/^\s*(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.):]?\s+/i, '');

export function parseLetterList(v: string): string[] {
  return v.split(/[\s,;/&]+|\band\b/i).map(s => s.trim().toUpperCase()).filter(Boolean);
}

function normChoice(type: 'tfng' | 'ynng', raw: string): string {
  let a = raw.trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const map: Record<string, string> = { T: 'TRUE', F: 'FALSE', NG: 'NOT GIVEN', 'NOT-GIVEN': 'NOT GIVEN', Y: 'YES', N: 'NO' };
  a = map[a] ?? a;
  return (CHOICES[type] as readonly string[]).includes(a) ? a : '';
}

const countGaps = (content: string) => (content.match(/\[\[(.*?)\]\]/g) ?? []).length;

export interface TextNote { line?: number; message: string }

function parseMcq(text: string, multi: boolean, note: (m: string) => void, where: string): LegacyQuestion[] {
  const qs: Array<LegacyQuestion & { options: string[]; text: string }> = [];
  let cur: (typeof qs)[number] | null = null;
  const answerOf = (s: string) => (multi ? parseLetterList(s) : (parseLetterList(s)[0] ?? ''));
  for (const line of nonEmptyLines(text)) {
    const am = line.match(/^\s*(ANSWERS?|CORRECT)\s*:\s*(.*)$/i);
    if (am) {
      if (!cur) { note(`${where}: ANSWER line before any question.`); continue; }
      cur.answer = answerOf(am[2] ?? '');
      continue;
    }
    const expected = cur ? makeLabel('upper', cur.options.length) : null;
    let om = cur ? line.match(/^\s*(\*?)\s*([A-Ha-h])\s*[.)]\s+(.*)$/) : null;
    if (!om && cur?.text) {
      const lm = line.match(/^\s*(\*?)\s*([A-H])\s+(.+)$/);
      if (lm && lm[2] === expected) om = lm;
    }
    if (om && cur) {
      const L = om[2]!.toUpperCase();
      cur.options.push(om[3]!.trim());
      // "*B. text" marks the correct option
      if (om[1]) cur.answer = multi ? [...new Set([...(Array.isArray(cur.answer) ? cur.answer : []), L])].sort() : L;
      continue;
    }
    if (!cur || cur.options.length) {
      const [t, a] = splitAnswer(stripNumber(line));
      cur = { id: `q${qs.length + 1}`, text: t, options: [], answer: answerOf(a) };
      qs.push(cur);
    } else {
      cur.text += ` ${line.trim()}`;
    }
  }
  // missing options or answers are reported by the validator, with the question numbers
  return qs;
}

interface Block { key: string; lines: string[]; line: number }
interface Container { fields: Record<string, Block> }
interface GroupBlock extends Container { name: string; line: number }
interface PartBlock extends Container { name: string; line: number; groups: GroupBlock[] }

/** where each part and group of the text starts, so problems can be reported by line */
export interface TextLayout {
  parts: Array<{ title: string; line: number; groups: Array<{ name: string; line: number }> }>;
}

export interface ParsedText {
  exam: LegacyExam;
  /** KIND: and DUE: header lines (the old format had no such fields) */
  kind?: Kind;
  dueDate?: string;
  /** TIME: none / 0 = no countdown */
  noTimeLimit: boolean;
  /** problems found while reading the text */
  notes: TextNote[];
  layout: TextLayout;
  /** audio / picture file names written in the text (AUDIO:, IMAGE:) */
  fileNames: string[];
}

/** read a test written in the text format. Audio and image lines keep the file NAME in audioId / imageId. */
export function parseTestText(input: string): ParsedText {
  const notes: TextNote[] = [];
  const header: Container = { fields: {} };
  const parts: PartBlock[] = [];
  let part: PartBlock | null = null;
  let group: GroupBlock | null = null;
  let cur: Block | null = null;
  const target = (): Container => group ?? part ?? header;

  input.replace(/^﻿/, '').split(/\r?\n/).forEach((line, idx) => {
    const ln = idx + 1;
    if (/^\s*\/\//.test(line)) return;
    let m: RegExpMatchArray | null;
    const inFree = !!cur && FREE.includes(cur.key);
    if ((m = line.match(PART_RE)) && m[1] && !/^[=\s]*$/.test(m[1])) {
      part = { name: m[1], line: ln, fields: {}, groups: [] };
      parts.push(part);
      group = null; cur = null;
      return;
    }
    if ((m = line.match(GROUP_RE)) && m[1] && !/^[-\s|]*$/.test(m[1])) {
      if (!part) { part = { name: 'Part 1', line: ln, fields: {}, groups: [] }; parts.push(part); }
      group = { name: m[1], line: ln, fields: {} };
      part.groups.push(group);
      cur = null;
      return;
    }
    if ((m = line.match(KEY_RE))) {
      const key = m[1]!.toUpperCase().replace(/\s+/g, ' ');
      const upper = m[1] === m[1]!.toUpperCase();
      const groupType = group ? detectType((group as GroupBlock).name) : null;
      const mcqAnswer = cur?.key === 'QUESTIONS' && /^ANSWERS?$/.test(key) && (groupType === 'mcq' || groupType === 'mcq_multi');
      if (!(inFree && !upper) && !mcqAnswer) {
        cur = { key: key === 'ANSWERS' ? 'ANSWER' : key, lines: m[2] ? [m[2]] : [], line: ln };
        const t = target();
        if (t.fields[cur.key] !== undefined && cur.key !== 'ANSWER') notes.push({ line: ln, message: `${cur.key} appears twice in the same block — the second one is used.` });
        t.fields[cur.key] = cur;
        return;
      }
    }
    if (cur) cur.lines.push(line);
    else if (line.trim()) notes.push({ line: ln, message: `This line was ignored because it is not inside any section: "${line.trim().slice(0, 60)}"` });
  });

  const val = (c: Container, key: string) => {
    const f = c.fields[key];
    return f ? f.lines.join('\n').replace(/^\s*\n+|\s+$/g, '') : '';
  };
  const lineOf = (c: Container, key: string) => c.fields[key]?.line;

  /* ---------- test details ---------- */
  const modRaw = val(header, 'MODULE').toLowerCase();
  let module: Module | null = /listen/.test(modRaw) ? 'listening' : /writ/.test(modRaw) ? 'writing' : /read/.test(modRaw) ? 'reading' : null;
  if (!module) {
    module = parts.some(p => p.fields.AUDIO || p.fields.TRANSCRIPT) ? 'listening' : parts.some(p => p.fields.PROMPT) ? 'writing' : 'reading';
    if (modRaw) notes.push({ line: lineOf(header, 'MODULE'), message: `MODULE "${modRaw}" is not Reading, Listening or Writing — using ${module}.` });
  }
  const timeRaw = val(header, 'TIME');
  const noTimeLimit = /^(0|none|no|-)$/i.test(timeRaw.trim());
  const time = parseFloat(timeRaw);
  if (timeRaw && !noTimeLimit && !(time > 0)) notes.push({ line: lineOf(header, 'TIME'), message: `TIME "${timeRaw}" is not a number of minutes — using ${MODULES[module].defaultMinutes}.` });

  const exam: LegacyExam = {
    title: val(header, 'TITLE') || `Imported ${MODULES[module].label} test`,
    module,
    variant: /gen|gt/i.test(val(header, 'TYPE')) ? 'general' : 'academic',
    durationMinutes: noTimeLimit ? 0 : time > 0 ? time : MODULES[module].defaultMinutes,
    description: val(header, 'DESCRIPTION'),
    parts: []
  };

  const out: ParsedText = { exam, noTimeLimit, notes, layout: { parts: [] }, fileNames: [] };
  const kindRaw = val(header, 'KIND').toLowerCase();
  if (kindRaw) {
    const kind = /home/.test(kindRaw) ? 'homework' : /mock|full/.test(kindRaw) ? 'full_mock' : /pract/.test(kindRaw) ? 'practice' : null;
    if (kind) out.kind = kind;
    else notes.push({ line: lineOf(header, 'KIND'), message: `KIND "${kindRaw}" is not Homework, Practice or Full mock — using Practice.` });
  }
  const dueRaw = val(header, 'DUE');
  if (dueRaw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) out.dueDate = dueRaw;
    else notes.push({ line: lineOf(header, 'DUE'), message: `DUE "${dueRaw}" must be a date like 2026-11-30 — it was left out.` });
  }

  if (!parts.length) notes.push({ message: 'No parts found. Start each passage / part / task with a line like "=== PASSAGE 1 ===".' });
  const fileName = (raw: string) => { const n = raw.trim(); out.fileNames.push(n); return n; };

  parts.forEach((pb, pi) => {
    const p: LegacyPart = { title: titleCase(pb.name) || `${MODULES[module!].partName} ${pi + 1}`, groups: [] };
    const where = p.title!;
    if (module === 'reading') {
      p.passageTitle = val(pb, 'TITLE');
      p.passage = val(pb, 'TEXT') || val(pb, 'PASSAGE');
      if (!p.passage) notes.push({ line: pb.line, message: `${where}: no passage text (add "TEXT:" followed by the passage).` });
    } else if (module === 'listening') {
      if (val(pb, 'TITLE')) p.title = val(pb, 'TITLE');
      p.transcript = val(pb, 'TRANSCRIPT');
      const audio = val(pb, 'AUDIO');
      if (audio) p.audioId = fileName(audio);
    } else {
      if (val(pb, 'TITLE')) p.title = val(pb, 'TITLE');
      p.prompt = val(pb, 'PROMPT') || val(pb, 'TEXT');
      const mw = parseInt(val(pb, 'MIN WORDS'), 10);
      if (mw >= 0) p.minWords = mw;
      p.modelAnswer = val(pb, 'MODEL ANSWER');
      const img = val(pb, 'IMAGE');
      if (img) p.imageId = fileName(img);
      if (!p.prompt) notes.push({ line: pb.line, message: `${where}: no task text (add "PROMPT:" followed by the question).` });
      if (pb.groups.length) notes.push({ line: pb.groups[0]!.line, message: `${where}: question groups are ignored in a Writing test.` });
    }
    out.layout.parts.push({ title: p.title!, line: pb.line, groups: module === 'writing' ? [] : pb.groups.map(g => ({ name: g.name, line: g.line })) });

    if (module !== 'writing') pb.groups.forEach(gb => {
      let type = detectType(gb.name);
      const gwhere = `${where}, "${gb.name}"`;
      const gnote = (message: string) => notes.push({ line: gb.line, message });
      const hasText = !!val(gb, 'TEXT'), hasQ = !!val(gb, 'QUESTIONS'), hasOpt = !!val(gb, 'OPTIONS');
      if (!type) {
        type = hasText ? 'completion' : hasOpt ? 'matching' : 'short';
        gnote(`${gwhere}: question type not recognised — treated as ${TYPE_NAMES[type]}.`);
      }
      // the content decides between labelling styles: QUESTIONS + OPTIONS = letters (matching), TEXT with [[gaps]] = completion
      if (type === 'completion' && !hasText && hasQ) type = hasOpt ? 'matching' : 'short';
      if (type === 'matching' && hasText && !hasQ) type = 'completion';

      const g: LegacyGroup = { id: `g${pi + 1}_${p.groups!.length + 1}`, type };
      const instr = val(gb, 'INSTRUCTIONS');
      if (instr) g.instructions = instr;
      const title = val(gb, 'TITLE');
      if (title) g.title = title;
      if (/^(y|yes|true|1)/i.test(val(gb, 'REUSE'))) g.reuse = true;
      const img = val(gb, 'IMAGE');
      if (img) g.imageId = fileName(img);
      const optText = val(gb, 'OPTIONS');
      const qText = val(gb, 'QUESTIONS');

      if (type === 'completion') {
        g.content = val(gb, 'TEXT') || qText;
        const opts = optText ? labeledList(optText) : [];
        if (opts.length) { g.options = opts; g.labelStyle = /^[ivx]+$/.test(opts[0]!.label) ? 'roman' : 'upper'; }
        if (!countGaps(g.content)) gnote(`${gwhere}: no gaps found — put each answer in double brackets like [[answer]].`);
      } else if (type === 'mcq' || type === 'mcq_multi') {
        g.questions = parseMcq(qText, type === 'mcq_multi', gnote, gwhere);
      } else {
        if (type === 'matching') {
          const opts = labeledList(optText);
          g.options = opts;
          g.labelStyle = opts[0]?.label === 'i' ? 'roman' : 'upper';
          if (!opts.length) gnote(`${gwhere}: no OPTIONS list.`);
        }
        const oldType = type;
        // missing or wrong answers are reported by the validator, with the question numbers
        g.questions = nonEmptyLines(qText).map((line, qi) => {
          const [t, a] = splitAnswer(stripNumber(line));
          // T / F / NG -> TRUE / FALSE / NOT GIVEN; anything else is kept so the validator can show it
          const answer = oldType === 'tfng' || oldType === 'ynng' ? normChoice(oldType, a) || a : a;
          return { id: `q${qi + 1}`, text: t, answer };
        });
      }
      if (type !== 'completion' && !g.questions?.length) gnote(`${gwhere}: no questions (add "QUESTIONS:" and one question per line).`);
      p.groups!.push(g);
    });
    exam.parts!.push(p);
  });
  return out;
}
