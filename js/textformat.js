/* ===== Plain-text test format: parse .txt files into tests, and write tests back as text =====
   See HOW-TO-ADD-TESTS.md for the full description of the format.                                */

const TF_KEY_RE = /^\s*(TITLE|MODULE|TYPE|TIME|DESCRIPTION|TEXT|PASSAGE|AUDIO|TRANSCRIPT|PROMPT|IMAGE|MIN WORDS|MODEL ANSWER|INSTRUCTIONS|OPTIONS|QUESTIONS|REUSE|ANSWERS?)\s*:[ \t]?(.*)$/i;
const TF_FREE = ['TEXT', 'PASSAGE', 'TRANSCRIPT', 'PROMPT', 'MODEL ANSWER', 'INSTRUCTIONS', 'DESCRIPTION'];
const TF_PART_RE = /^\s*={3,}\s*(.*?)\s*=*\s*$/;
const TF_GROUP_RE = /^\s*-{3,}\s*(.*?)\s*-*\s*$/;

const TF_TYPE_NAMES = {
  tfng: 'TRUE FALSE NOT GIVEN', ynng: 'YES NO NOT GIVEN', mcq: 'MULTIPLE CHOICE', mcq_multi: 'CHOOSE TWO',
  matching: 'MATCHING', completion: 'COMPLETION', short: 'SHORT ANSWER'
};

function tfDetectType(name) {
  const n = ' ' + String(name).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
  if (/ TRUE | TFNG /.test(n)) return 'tfng';
  if (/ YES | YNNG /.test(n)) return 'ynng';
  if (/ CHOOSE (TWO|THREE|FOUR|2|3|4) | MULTIPLE ANSWERS? | MULTI /.test(n)) return 'mcq_multi';
  if (/ MULTIPLE CHOICE | MCQ | CHOICE /.test(n)) return 'mcq';
  if (/MATCH|HEADING|ENDINGS|CLASSIF/.test(n)) return 'matching';
  if (/COMPLET|SUMMARY|NOTE|TABLE|FLOW|DIAGRAM|FORM|LABEL|GAP|FILL|MAP|PLAN/.test(n)) return 'completion';
  if (/SHORT|ANSWER THE QUESTION/.test(n)) return 'short';
  return null;
}

function tfTitleCase(s) {
  s = String(s || '').trim();
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : s;
}

function tfLines(text) { return String(text || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim()); }

/** "i. text", "A) text", "B text" (sequential), "C" -> [{label, text}] */
function tfLabeledList(text) {
  const lines = tfLines(text);
  const strict = lines.map(l => l.match(/^\s*([ivxIVX]{1,6}|[A-Za-z]|\d{1,2})\s*[.):\]–-]\s*(.*)$/) || l.match(/^\s*([ivx]{1,6}|[A-Z])\s*$/));
  if (strict.every(Boolean)) return strict.map(m => ({ label: m[1], text: (m[2] || '').trim() }));
  const loose = lines.map(l => l.match(/^\s*([ivx]{1,6}|[A-Z]|\d{1,2})\s+(.+)$/));
  if (loose.every(Boolean)) {
    const labels = loose.map(m => m[1]);
    const style = /^[ivx]+$/.test(labels[0]) && labels[0] === 'i' ? 'roman' : /^\d+$/.test(labels[0]) ? 'number' : 'upper';
    if (labels.every((l, i) => l === makeLabel(style, i))) return loose.map(m => ({ label: m[1], text: m[2].trim() }));
  }
  return lines.map((l, i) => {
    const m = strict[i];
    return m ? { label: m[1], text: (m[2] || '').trim() } : { label: makeLabel('upper', i), text: l.trim() };
  });
}

function tfSplitAnswer(line) {
  const i = line.lastIndexOf('|');
  return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

function tfStripNumber(s) { return s.replace(/^\s*(?:Q(?:uestion)?\s*)?\d{1,2}\s*[.):]?\s+/i, ''); }

function tfNormChoice(type, a) {
  a = String(a || '').trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const map = { T: 'TRUE', F: 'FALSE', NG: 'NOT GIVEN', 'NOT-GIVEN': 'NOT GIVEN', Y: 'YES', N: 'NO' };
  a = map[a] || a;
  return QTYPES[type].choices.includes(a) ? a : '';
}

function tfParseMcq(text, multi, warn, where) {
  const qs = [];
  let cur = null;
  for (const line of tfLines(text)) {
    const am = line.match(/^\s*(ANSWERS?|CORRECT)\s*:\s*(.*)$/i);
    if (am) {
      if (!cur) { warn(`${where}: ANSWER line before any question.`); continue; }
      cur.answer = multi ? parseLetterList(am[2]) : (parseLetterList(am[2])[0] || '');
      continue;
    }
    const expected = cur ? makeLabel('upper', cur.options.length) : null;
    let om = cur && line.match(/^\s*(\*?)\s*([A-Ha-h])\s*[.)]\s+(.*)$/);
    if (!om && cur && cur.text) {
      const lm = line.match(/^\s*(\*?)\s*([A-H])\s+(.+)$/);
      if (lm && lm[2] === expected) om = lm;
    }
    if (om) {
      const L = om[2].toUpperCase();
      cur.options.push(om[3].trim());
      if (om[1]) { if (multi) cur.answer = [...new Set([...(cur.answer || []), L])].sort(); else cur.answer = L; }
      continue;
    }
    if (!cur || cur.options.length) {
      const [t, a] = tfSplitAnswer(tfStripNumber(line));
      cur = { id: uid('q'), text: t, options: [], answer: multi ? parseLetterList(a) : (parseLetterList(a)[0] || '') };
      qs.push(cur);
    } else {
      cur.text += ' ' + line.trim();
    }
  }
  qs.forEach((q, i) => {
    if (q.options.length < 2) warn(`${where}, question ${i + 1}: needs at least two options (A. … B. …).`);
    if (multi ? !q.answer.length : !q.answer) warn(`${where}, question ${i + 1}: no answer (add “ANSWER: B”).`);
  });
  return qs;
}

/**
 * Parse a test written in the text format.
 * files: array of File objects selected together with the .txt (audio / images, matched by file name).
 * Returns { exam, warnings, fileRefs: [{target, key, name}] } — call tfAttachFiles to store the files.
 */
function parseTestText(text) {
  const warnings = [];
  const warn = m => warnings.push(m);
  const header = { fields: {} };
  const parts = [];
  let part = null, group = null, cur = null;
  const target = () => group || part || header;

  String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((line, ln) => {
    if (/^\s*\/\//.test(line)) return;
    let m;
    const inFree = cur && TF_FREE.includes(cur.key);
    if ((m = line.match(TF_PART_RE)) && m[1] && !/^[=\s]*$/.test(m[1])) {
      part = { name: m[1], fields: {}, groups: [] }; parts.push(part); group = null; cur = null; return;
    }
    if ((m = line.match(TF_GROUP_RE)) && m[1] && !/^[-\s|]*$/.test(m[1])) {
      if (!part) { part = { name: 'Part 1', fields: {}, groups: [] }; parts.push(part); }
      group = { name: m[1], fields: {}, line: ln + 1 }; part.groups.push(group); cur = null; return;
    }
    if ((m = line.match(TF_KEY_RE))) {
      const key = m[1].toUpperCase().replace(/\s+/g, ' ');
      const upper = m[1] === m[1].toUpperCase();
      const mcqAnswer = cur && cur.key === 'QUESTIONS' && /^ANSWERS?$/.test(key) && group && /^(mcq|mcq_multi)$/.test(tfDetectType(group.name) || '');
      if (!(inFree && !upper) && !mcqAnswer) {
        cur = { key: key === 'ANSWERS' ? 'ANSWER' : key, lines: m[2] ? [m[2]] : [] };
        const t = target();
        if (t.fields[cur.key] !== undefined && !/ANSWER/.test(cur.key)) warn(`Line ${ln + 1}: ${cur.key} appears twice in the same block — the second one is used.`);
        t.fields[cur.key] = cur;
        return;
      }
    }
    if (cur) cur.lines.push(line);
    else if (line.trim()) warn(`Line ${ln + 1} was ignored (it is not inside any section): “${line.trim().slice(0, 60)}”`);
  });

  const val = (obj, key) => {
    const f = obj.fields[key];
    if (!f) return '';
    return f.lines.join('\n').replace(/^\s*\n+|\s+$/g, '');
  };

  // module
  const modRaw = val(header, 'MODULE').toLowerCase();
  let module = /listen/.test(modRaw) ? 'listening' : /writ/.test(modRaw) ? 'writing' : /read/.test(modRaw) ? 'reading' : null;
  if (!module) {
    module = parts.some(p => p.fields.AUDIO || p.fields.TRANSCRIPT) ? 'listening'
      : parts.some(p => p.fields.PROMPT) ? 'writing' : 'reading';
    if (modRaw) warn(`MODULE “${modRaw}” not recognised — using ${module}.`);
  }
  const exam = newExam(module);
  exam.parts = [];
  exam.title = val(header, 'TITLE') || 'Imported ' + MODULES[module].label + ' test';
  exam.variant = /gen|gt/i.test(val(header, 'TYPE')) ? 'general' : 'academic';
  const time = parseFloat(val(header, 'TIME'));
  exam.durationMinutes = time > 0 ? time : MODULES[module].defaultMinutes;
  exam.description = val(header, 'DESCRIPTION');
  const fileRefs = [];

  if (!parts.length) warn('No parts found. Start each passage / part / task with a line like “=== PASSAGE 1 ===”.');

  parts.forEach((pb, pi) => {
    const p = newPart(module, pi);
    p.title = tfTitleCase(pb.name) || p.title;
    const where = p.title;
    if (module === 'reading') {
      p.passageTitle = val(pb, 'TITLE');
      p.passage = val(pb, 'TEXT') || val(pb, 'PASSAGE');
      if (!p.passage) warn(`${where}: no passage text (add “TEXT:” followed by the passage).`);
    } else if (module === 'listening') {
      if (val(pb, 'TITLE')) p.title = val(pb, 'TITLE');
      p.transcript = val(pb, 'TRANSCRIPT');
      const audio = val(pb, 'AUDIO');
      if (audio) fileRefs.push({ target: p, key: 'audioId', name: audio.trim(), where });
    } else {
      if (val(pb, 'TITLE')) p.title = val(pb, 'TITLE');
      p.prompt = val(pb, 'PROMPT') || val(pb, 'TEXT');
      const mw = parseInt(val(pb, 'MIN WORDS'), 10);
      if (mw >= 0) p.minWords = mw;
      p.modelAnswer = val(pb, 'MODEL ANSWER');
      const img = val(pb, 'IMAGE');
      if (img) fileRefs.push({ target: p, key: 'imageId', name: img.trim(), where });
      if (!p.prompt) warn(`${where}: no task text (add “PROMPT:” followed by the question).`);
      if (pb.groups.length) warn(`${where}: question groups are ignored in a Writing test.`);
    }

    if (module !== 'writing') pb.groups.forEach((gb, gi) => {
      let type = tfDetectType(gb.name);
      const gwhere = `${where}, group “${gb.name}” (line ${gb.line})`;
      const hasText = !!val(gb, 'TEXT'), hasQ = !!val(gb, 'QUESTIONS'), hasOpt = !!val(gb, 'OPTIONS');
      if (!type) {
        type = hasText ? 'completion' : hasOpt ? 'matching' : 'short';
        warn(`${gwhere}: question type not recognised — treated as ${TF_TYPE_NAMES[type]}.`);
      }
      // the content decides between labelling styles: QUESTIONS + OPTIONS = letters (matching), TEXT with [[gaps]] = completion
      if (type === 'completion' && !hasText && hasQ) type = hasOpt ? 'matching' : 'short';
      if (type === 'matching' && hasText && !hasQ) type = 'completion';
      const g = newGroup(type);
      const instr = val(gb, 'INSTRUCTIONS');
      if (instr) g.instructions = instr;
      g.title = val(gb, 'TITLE');
      g.reuse = /^(y|yes|true|1)/i.test(val(gb, 'REUSE'));
      const img = val(gb, 'IMAGE');
      if (img) fileRefs.push({ target: g, key: 'imageId', name: img.trim(), where: gwhere });
      const optText = val(gb, 'OPTIONS');
      const qText = val(gb, 'QUESTIONS');

      if (type === 'completion') {
        g.content = val(gb, 'TEXT') || qText;
        g.options = optText ? tfLabeledList(optText) : [];
        if (g.options.length) g.labelStyle = /^[ivx]+$/.test(g.options[0].label) ? 'roman' : 'upper';
        if (!parseGaps(g.content).length) warn(`${gwhere}: no gaps found — put each answer in double brackets like [[answer]].`);
      } else if (type === 'mcq' || type === 'mcq_multi') {
        g.questions = tfParseMcq(qText, type === 'mcq_multi', warn, gwhere);
      } else {
        if (type === 'matching') {
          g.options = tfLabeledList(optText);
          g.labelStyle = g.options[0] && /^[ivx]+$/.test(g.options[0].label) && g.options[0].label === 'i' ? 'roman' : 'upper';
          if (!g.options.length) warn(`${gwhere}: no OPTIONS list.`);
        }
        g.questions = tfLines(qText).map(line => {
          const [t, a] = tfSplitAnswer(tfStripNumber(line));
          let answer = a;
          if (type === 'tfng' || type === 'ynng') {
            answer = tfNormChoice(type, a);
            if (a && !answer) warn(`${gwhere}: answer “${a}” is not ${QTYPES[type].choices.join(' / ')}.`);
          }
          return Object.assign(newQuestion(type), { text: t, answer });
        });
        g.questions.forEach((q, i) => { if (!String(q.answer).trim()) warn(`${gwhere}, question ${i + 1}: no answer (add “| answer” at the end of the line).`); });
        if (type === 'matching') {
          const labels = g.options.map(o => String(o.label).toLowerCase());
          g.questions.forEach((q, i) => { if (q.answer && !labels.includes(q.answer.toLowerCase())) warn(`${gwhere}, question ${i + 1}: answer “${q.answer}” is not in the OPTIONS list.`); });
        }
      }
      if (type !== 'completion' && !g.questions.length) warn(`${gwhere}: no questions (add “QUESTIONS:” and one question per line).`);
      p.groups.push(g);
    });
    exam.parts.push(p);
  });
  if (!exam.parts.length) exam.parts.push(newPart(module, 0));
  return { exam, warnings, fileRefs };
}

/** store the audio / image files named in the text (matched by file name, case-insensitive) */
async function tfAttachFiles(parsed, files) {
  const byName = {};
  for (const f of files || []) byName[f.name.toLowerCase()] = f;
  const missing = [];
  for (const ref of parsed.fileRefs) {
    const base = ref.name.split(/[\\/]/).pop().toLowerCase();
    const f = byName[base];
    if (f) ref.target[ref.key] = await DB.saveFile(f, f.name);
    else missing.push(`${ref.where}: file “${ref.name}” was not selected — upload it in the editor, or import again selecting it with the .txt file.`);
  }
  return missing;
}

/** write a test in the text format (file names are used for audio / images) */
async function examToText(exam) {
  const out = [];
  const nameOf = async id => { const i = id ? await DB.fileInfo(id) : null; return i ? i.name : ''; };
  const block = (key, text) => { if (String(text || '').trim()) out.push(`${key}:`, String(text).trim()); };
  out.push('// IELTS Practice Studio test file — see HOW-TO-ADD-TESTS.md for the format', '');
  out.push(`TITLE: ${exam.title}`, `MODULE: ${MODULES[exam.module].label}`);
  if (exam.module !== 'listening') out.push(`TYPE: ${exam.variant === 'general' ? 'General Training' : 'Academic'}`);
  out.push(`TIME: ${exam.durationMinutes}`);
  if (exam.description) out.push(`DESCRIPTION: ${exam.description.replace(/\n+/g, ' ')}`);
  const { itemStart } = numberExam(exam);
  for (const p of exam.parts) {
    out.push('', `=== ${p.title} ===`);
    if (exam.module === 'reading') {
      if (p.passageTitle) out.push(`TITLE: ${p.passageTitle}`);
      block('TEXT', p.passage);
    } else if (exam.module === 'listening') {
      const a = await nameOf(p.audioId);
      if (a) out.push(`AUDIO: ${a}`);
      block('TRANSCRIPT', p.transcript);
    } else {
      out.push(`MIN WORDS: ${p.minWords || 0}`);
      const img = await nameOf(p.imageId);
      if (img) out.push(`IMAGE: ${img}`);
      block('PROMPT', p.prompt);
      block('MODEL ANSWER', p.modelAnswer);
      continue;
    }
    for (const g of p.groups) {
      const typeName = g.type === 'mcq_multi'
        ? 'CHOOSE ' + (['', 'ONE', 'TWO', 'THREE', 'FOUR'][Math.max(...g.questions.map(q => (q.answer || []).length), 2)] || 'TWO')
        : TF_TYPE_NAMES[g.type];
      out.push('', `--- ${typeName} ---`);
      block('INSTRUCTIONS', g.instructions);
      if (g.title) out.push(`TITLE: ${g.title}`);
      const img = await nameOf(g.imageId);
      if (img) out.push(`IMAGE: ${img}`);
      if (g.type === 'matching' && g.reuse) out.push('REUSE: yes');
      if (g.type === 'completion') {
        block('TEXT', g.content);
        if (g.options.length) out.push('OPTIONS:', ...g.options.map(o => `${o.label}. ${o.text}`.trim()));
        continue;
      }
      if (g.type === 'matching') out.push('OPTIONS:', ...g.options.map(o => o.text ? `${o.label}. ${o.text}` : `${o.label}`));
      out.push('QUESTIONS:');
      for (const q of g.questions) {
        const n = itemStart[q.id];
        if (g.type === 'mcq' || g.type === 'mcq_multi') {
          out.push(`${n}. ${q.text}`, ...q.options.map((o, i) => `${makeLabel('upper', i)}. ${o}`),
            `ANSWER: ${g.type === 'mcq_multi' ? (q.answer || []).join(', ') : q.answer}`, '');
        } else {
          out.push(`${n}. ${q.text} | ${q.answer || ''}`);
        }
      }
      if (out[out.length - 1] === '') out.pop();
    }
  }
  return out.join('\n') + '\n';
}
