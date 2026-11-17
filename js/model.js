/* ===== Data model: test structure, question types, numbering, scoring, bands ===== */

const MODULES = {
  reading:   { label: 'Reading',   defaultMinutes: 60, partName: 'Passage', icon: '📖' },
  listening: { label: 'Listening', defaultMinutes: 35, partName: 'Part',    icon: '🎧' },
  writing:   { label: 'Writing',   defaultMinutes: 60, partName: 'Task',    icon: '✍️' }
};

const QTYPES = {
  tfng: {
    label: 'True / False / Not Given',
    choices: ['TRUE', 'FALSE', 'NOT GIVEN'],
    instructions: 'Do the following statements agree with the information given in the passage?\n\nChoose\n**TRUE** if the statement agrees with the information\n**FALSE** if the statement contradicts the information\n**NOT GIVEN** if there is no information on this'
  },
  ynng: {
    label: 'Yes / No / Not Given',
    choices: ['YES', 'NO', 'NOT GIVEN'],
    instructions: 'Do the following statements agree with the claims of the writer?\n\nChoose\n**YES** if the statement agrees with the claims of the writer\n**NO** if the statement contradicts the claims of the writer\n**NOT GIVEN** if it is impossible to say what the writer thinks about this'
  },
  mcq: {
    label: 'Multiple choice — one answer',
    instructions: 'Choose the correct letter, **A**, **B**, **C** or **D**.'
  },
  mcq_multi: {
    label: 'Multiple choice — choose TWO / THREE',
    instructions: 'Choose **TWO** letters, **A–E**.'
  },
  matching: {
    label: 'Matching (headings, information, features, endings)',
    instructions: 'Choose the correct heading for each paragraph from the list of headings below.\n\nDrag the correct heading into each box.'
  },
  completion: {
    label: 'Completion (sentence, summary, notes, table, flow-chart)',
    instructions: 'Complete the sentences below.\n\nChoose **NO MORE THAN TWO WORDS** from the passage for each answer.'
  },
  short: {
    label: 'Short-answer questions',
    instructions: 'Answer the questions below.\n\nChoose **NO MORE THAN THREE WORDS AND/OR A NUMBER** from the passage for each answer.'
  }
};

/* ---------- factories ---------- */
function newExam(module = 'reading') {
  const ex = {
    id: uid('exam'), title: 'Untitled ' + MODULES[module].label + ' test', module,
    variant: 'academic', durationMinutes: MODULES[module].defaultMinutes, description: '',
    parts: [], createdAt: Date.now(), updatedAt: Date.now()
  };
  ex.parts.push(newPart(module, 0));
  if (module === 'writing') ex.parts.push(newPart(module, 1));
  return ex;
}

function newPart(module, index) {
  return {
    id: uid('part'), title: `${MODULES[module].partName} ${index + 1}`,
    passageTitle: '', passage: '',                       // reading
    audioId: null, transcript: '',                        // listening
    prompt: '', imageId: null, minWords: index === 0 ? 150 : 250, modelAnswer: '', // writing
    groups: []
  };
}

function newQuestion(type) {
  const q = { id: uid('q'), text: '', answer: '' };
  if (type === 'mcq') q.options = ['', '', '', ''];
  if (type === 'mcq_multi') { q.options = ['', '', '', '', '']; q.answer = []; }
  return q;
}

function newGroup(type) {
  const g = {
    id: uid('grp'), type, instructions: QTYPES[type].instructions, title: '', imageId: null,
    questions: [], options: [], content: '', reuse: false, labelStyle: 'upper'
  };
  if (type === 'matching') {
    g.labelStyle = 'roman';
    g.options = [0, 1, 2, 3, 4].map(i => ({ label: makeLabel('roman', i), text: '' }));
    g.questions = [newQuestion(type)];
  } else if (type === 'completion') {
    g.content = 'Write your sentences here and put each answer in double brackets, e.g. The bridge was finished in [[1932]].';
  } else {
    g.questions = [newQuestion(type)];
  }
  return g;
}

/** fill in any missing fields so older / hand-written JSON still works */
function normalizeExam(raw) {
  const ex = Object.assign({
    id: uid('exam'), title: 'Untitled test', module: 'reading', variant: 'academic',
    durationMinutes: 60, description: '', parts: [], createdAt: Date.now(), updatedAt: Date.now()
  }, raw || {});
  if (!MODULES[ex.module]) ex.module = 'reading';
  ex.parts = (ex.parts || []).map((p, i) => {
    const part = Object.assign(newPart(ex.module, i), p || {});
    part.id = part.id || uid('part');
    part.groups = (part.groups || []).map(g => {
      const type = QTYPES[g.type] ? g.type : 'short';
      const grp = Object.assign(newGroup(type), g, { type });
      grp.id = grp.id || uid('grp');
      grp.questions = (grp.questions || []).map(q => {
        const nq = Object.assign(newQuestion(type), q || {});
        nq.id = nq.id || uid('q');
        if (type === 'mcq_multi' && !Array.isArray(nq.answer)) nq.answer = parseLetterList(nq.answer);
        return nq;
      });
      grp.options = (grp.options || []).map((o, k) => typeof o === 'string' ? { label: makeLabel(grp.labelStyle, k), text: o } : o);
      return grp;
    });
    return part;
  });
  return ex;
}

function parseLetterList(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim().toUpperCase()).filter(Boolean);
  return String(v || '').split(/[\s,;/&]+|and/i).map(s => s.trim().toUpperCase()).filter(Boolean);
}

/* ---------- questions & numbering ---------- */
const GAP_RE = /\[\[(.*?)\]\]/g;

function parseGaps(content) {
  const out = [];
  String(content || '').replace(GAP_RE, (m, a) => { out.push(a); return m; });
  return out;
}

/** uniform list of answerable items in a group: {id, text, answer, count, options} */
function groupItems(g) {
  if (g.type === 'completion') {
    return parseGaps(g.content).map((a, i) => ({ id: `${g.id}_g${i}`, text: '', answer: a.trim(), count: 1, gapIndex: i }));
  }
  if (g.type === 'mcq_multi') {
    return g.questions.map(q => ({ ...q, count: Math.max(1, (q.answer || []).length || q.choose || 2) }));
  }
  return g.questions.map(q => ({ ...q, count: 1 }));
}

/**
 * Number every question slot in a test.
 * Returns { slots: [...], groupRange: {groupId: [from, to]}, partRange: {partIndex: [from, to]} }
 */
function numberExam(exam) {
  const slots = [], groupRange = {}, partRange = {}, itemStart = {};
  let n = 1;
  exam.parts.forEach((part, pi) => {
    const pStart = n;
    if (exam.module !== 'writing') {
      part.groups.forEach(g => {
        const gStart = n;
        groupItems(g).forEach(item => {
          itemStart[item.id] = n;
          for (let s = 0; s < item.count; s++) {
            slots.push({ num: n++, partIndex: pi, groupId: g.id, type: g.type, qid: item.id, sub: s, count: item.count, item, group: g });
          }
        });
        groupRange[g.id] = [gStart, n - 1];
      });
    }
    partRange[pi] = [pStart, n - 1];
  });
  return { slots, groupRange, partRange, itemStart };
}

function rangeText(r) {
  if (!r || r[1] < r[0]) return '';
  return r[0] === r[1] ? `Question ${r[0]}` : `Questions ${r[0]}–${r[1]}`;
}

/* ---------- answer checking ---------- */
function normAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?"]+|[\s.,;:!?"]+$/g, '')
    .trim();
}

function expandOptional(s) {
  const m = s.match(/\(([^()]*)\)/);
  if (!m) return [s.replace(/\s+/g, ' ').trim()];
  const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
  return [...expandOptional(before + m[1] + after), ...expandOptional(before + ' ' + after)];
}

/** "(the) river / stream" -> ["the river", "river", "stream"] */
function answerVariants(spec) {
  return String(spec ?? '').split('/').map(s => s.trim()).filter(Boolean).flatMap(expandOptional).map(normAnswer).filter(Boolean);
}

function isTextCorrect(user, spec) {
  const u = normAnswer(user);
  if (!u) return false;
  return answerVariants(spec).includes(u);
}

function displayAnswer(spec) { return String(spec ?? '').trim(); }

/** returns per-slot results and totals (writing tests are not auto-marked) */
function scoreAttempt(exam, answers) {
  const { slots } = numberExam(exam);
  const items = [];
  const perPart = exam.parts.map(() => ({ correct: 0, total: 0 }));
  const multiCache = {};
  for (const s of slots) {
    const raw = answers[s.qid];
    let ok = false, user = '', correct = '';
    if (s.type === 'mcq_multi') {
      const sel = Array.isArray(raw) ? raw : [];
      const key = parseLetterList(s.item.answer);
      if (!(s.qid in multiCache)) multiCache[s.qid] = Math.min(sel.filter(x => key.includes(x)).length, s.count);
      ok = s.sub < multiCache[s.qid];
      user = sel.slice().sort().join(', ');
      correct = key.join(', ');
    } else if (s.type === 'tfng' || s.type === 'ynng' || s.type === 'mcq' || s.type === 'matching' ||
               (s.type === 'completion' && (s.group.options || []).length)) {
      user = raw || '';
      correct = displayAnswer(s.item.answer);
      const keys = String(s.item.answer || '').split('/').map(x => normAnswer(x)).filter(Boolean);
      ok = !!user && keys.includes(normAnswer(user));
    } else {
      user = raw || '';
      correct = displayAnswer(s.item.answer);
      ok = isTextCorrect(user, s.item.answer);
    }
    items.push({ num: s.num, partIndex: s.partIndex, qid: s.qid, sub: s.sub, type: s.type, user, correct, ok });
    perPart[s.partIndex].total++;
    if (ok) perPart[s.partIndex].correct++;
  }
  const correct = items.filter(i => i.ok).length;
  return { total: items.length, correct, items, perPart };
}

function isSlotAnswered(slot, answers) {
  const v = answers[slot.qid];
  if (slot.type === 'mcq_multi') return Array.isArray(v) && v.length > slot.sub;
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/* ---------- band scores (approximate official conversion tables) ---------- */
const BAND_TABLES = {
  listening: [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0]],
  academic:  [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0]],
  general:   [[40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [3, 2], [1, 1], [0, 0]]
};

function bandFor(exam, correct, total) {
  if (!total || exam.module === 'writing') return null;
  const table = exam.module === 'listening' ? BAND_TABLES.listening : BAND_TABLES[exam.variant === 'general' ? 'general' : 'academic'];
  const scaled = total === 40 ? correct : Math.round(correct / total * 40);
  const band = (table.find(([min]) => scaled >= min) || [0, 0])[1];
  return { band, scaled, estimated: total !== 40 };
}

function fmtBand(b) { return b == null ? '–' : Number(b).toFixed(1).replace(/\.0$/, '.0'); }

/* ---------- light markup ---------- */
/** escape + **bold** + *italic* */
function inlineMd(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
}

/** multi-line text -> paragraphs; single newlines become <br>; a block of "- " lines becomes a list */
function mdBlock(text) {
  return String(text || '').trim().split(/\n\s*\n/).map(p => {
    const lines = p.split('\n');
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) return '<ul>' + lines.map(l => `<li>${inlineMd(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('') + '</ul>';
    return `<p>${inlineMd(p).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

const QTYPE_SHORT = {
  tfng: 'True / False / Not Given', ynng: 'Yes / No / Not Given', mcq: 'Multiple choice', mcq_multi: 'Multiple choice (pick 2+)',
  matching: 'Matching', completion: 'Completion', short: 'Short answer'
};

/**
 * Reading passage: blank line = new paragraph, "[A] text" = labelled paragraph,
 * "## Heading" = sub-heading.
 */
function renderPassageHTML(text) {
  return String(text || '').trim().split(/\n\s*\n/).map(block => {
    const b = block.trim();
    if (b.startsWith('## ')) return `<h4 class="psg-sub">${inlineMd(b.slice(3))}</h4>`;
    const m = b.match(/^\[([A-Za-z0-9]{1,3})\]\s*/);
    if (m) {
      return `<div class="psg-para labelled" data-para="${esc(m[1])}"><span class="para-label no-hl">${esc(m[1])}</span><p>${inlineMd(b.slice(m[0].length)).replace(/\n/g, '<br>')}</p></div>`;
    }
    return `<div class="psg-para"><p>${inlineMd(b).replace(/\n/g, '<br>')}</p></div>`;
  }).join('');
}

/**
 * Completion content -> HTML with <span class="gap" data-gap="i"></span> placeholders.
 * "# Heading", "- bullet", "a | b | c" table rows (first row = header), "> step" flow-chart boxes.
 */
function renderCompletionHTML(content) {
  let gi = 0;
  const gapify = line => inlineMd(line).replace(/\[\[(.*?)\]\]/g, () => `<span class="gap" data-gap="${gi++}"></span>`);
  const lines = String(content || '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    if (t.includes('|') && !t.startsWith('>')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        const r = lines[i].trim().replace(/^\||\|$/g, '');
        if (!/^[\s|:-]+$/.test(r)) rows.push(r.split('|').map(c => c.trim()));
        i++;
      }
      const cols = Math.max(...rows.map(r => r.length));
      out.push('<div class="cmp-table-wrap"><table class="cmp-table">' + rows.map((r, ri) =>
        '<tr>' + Array.from({ length: cols }, (_, ci) => {
          const tag = ri === 0 ? 'th' : 'td';
          return `<${tag}>${gapify(r[ci] || '')}</${tag}>`;
        }).join('') + '</tr>').join('') + '</table></div>');
      continue;
    }
    if (t.startsWith('> ')) {
      const steps = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) { steps.push(lines[i].trim().slice(2)); i++; }
      out.push('<div class="cmp-flow">' + steps.map(s => `<div class="flow-box">${gapify(s)}</div>`).join('<div class="flow-arrow">↓</div>') + '</div>');
      continue;
    }
    if (/^[-•]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^[-•]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-•]\s+/, '')); i++; }
      out.push('<ul class="cmp-list">' + items.map(s => `<li>${gapify(s)}</li>`).join('') + '</ul>');
      continue;
    }
    if (t.startsWith('# ')) { out.push(`<h4 class="cmp-head">${gapify(t.slice(2))}</h4>`); i++; continue; }
    out.push(`<p class="cmp-line">${gapify(t)}</p>`);
    i++;
  }
  return out.join('');
}

function countQuestions(exam) {
  return exam.module === 'writing' ? exam.parts.length : numberExam(exam).slots.length;
}
