/* Renders parts and question groups of the new test format (converted from the old js/exam-render.js). */
import {
  describeWordLimit, letter, TFNG_CHOICES, YNNG_CHOICES,
  type AnswerValue, type Chart, type CompletionGroup, type Option, type Part, type QuestionGroup, type SectionSkill
} from '@ielts/shared';
import { $, $$, el } from '../lib/dom';
import { wordCount } from '../lib/format';
import { blankSentenceHTML, inlineMd, mdBlock, passageHTML, templateHTML } from '../lib/markup';

export interface RenderCtx {
  answers: Record<string, AnswerValue>;
  readonly: boolean;
  setAnswer(qid: string, v: AnswerValue): void;
  registerNum(n: number, holder: HTMLElement): void;
  flash(msg: string): void;
  picked: { group: string; label: string } | null;
  afterRender: Array<() => void>;
  root(): HTMLElement;
}

const numLabel = (nums: number[]) => (nums.length > 1 ? `${nums[0]}–${nums[nums.length - 1]}` : String(nums[0] ?? ''));
const qNum = (nums: number[]) => el('span', { class: 'q-num no-hl' }, numLabel(nums));

function groupNumbers(g: QuestionGroup): number[] {
  if (!('questions' in g)) return [];
  return (g.questions as Array<{ number?: number; numbers?: number[] }>).flatMap(q => q.numbers ?? (q.number !== undefined ? [q.number] : []));
}

export function rangeText(nums: number[]): string {
  if (!nums.length) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `Question ${lo}` : `Questions ${lo}–${hi}`;
}

/* ======================================================================
   parts
   ====================================================================== */
/** `earlierRecording`: an earlier part has the recording for the whole test, so this part needs none of its own */
export function renderPart(ctx: RenderCtx, part: Part, pi: number, section: SectionSkill, earlierRecording = false): HTMLElement {
  const sec = el('section', { class: `cd-part sec-${section}`, dataset: { part: String(pi), partId: part.id }, hidden: true });
  const zone = (name: string, cls: string, ...kids: Array<Node | null>) =>
    el('div', { class: `pane ${cls} hl-zone`, dataset: { zone: `${part.id}:${name}` } }, ...kids);

  if (section === 'reading' || section === 'writing') {
    const left = section === 'reading'
      ? zone('passage', 'pane-left passage',
        part.passage?.title ? el('h2', { class: 'psg-title' }, part.passage.title) : null,
        part.passage?.subtitle ? el('p', { class: 'psg-subtitle' }, part.passage.subtitle) : null,
        el('div', { class: 'psg-body', html: part.passage ? passageHTML(part.passage) : '' }))
      : zone('prompt', 'pane-left', ...part.questionGroups.map(g => writingPrompt(g)));
    const right = section === 'reading'
      ? zone('questions', 'pane-right', ...part.questionGroups.map(g => renderGroup(ctx, g)))
      : el('div', { class: 'pane pane-right' }, ...part.questionGroups.map(g => writingAnswer(ctx, g)));
    const split = el('div', { class: 'cd-split show-left' },
      left,
      el('div', { class: 'divider no-hl', title: 'Drag to resize · double-click to reset' }, el('span', null, '⋮')),
      right);
    const tabs = el('div', { class: 'cd-tabs no-hl', role: 'tablist' },
      el('button', { class: 'cd-tab active', dataset: { tab: 'left' }, role: 'tab' }, section === 'reading' ? '📖 Passage' : '📋 Task'),
      el('button', { class: 'cd-tab', dataset: { tab: 'right' }, role: 'tab' }, section === 'reading' ? '✏️ Questions' : '✍️ Your answer'));
    tabs.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLElement>('.cd-tab');
      if (b) showTab(sec, b.dataset.tab as 'left' | 'right');
    });
    sec.append(tabs, split);
    return sec;
  }

  const pane = zone('questions', 'pane-single');
  // transcripts only reach the browser after submission (review mode)
  if (section === 'listening' && part.transcript) {
    pane.appendChild(el('details', { class: 'transcript no-hl' }, el('summary', null, 'Transcript'), el('div', { html: mdBlock(part.transcript) })));
  }
  if (section === 'listening' && !part.audioUrl && !earlierRecording && !ctx.readonly) {
    pane.appendChild(el('div', { class: 'cd-note no-hl' }, '🔈 This part has no recording yet. Reading the transcript aloud in the browser arrives in Phase 6.'));
  }
  if (part.instructions) pane.appendChild(el('div', { class: 'q-instr', html: mdBlock(part.instructions) }));
  for (const g of part.questionGroups) pane.appendChild(section === 'speaking' ? speakingGroup(ctx, g) : renderGroup(ctx, g));
  sec.appendChild(el('div', { class: 'cd-single' }, pane));
  return sec;
}

/** mobile: show the passage or the questions */
export function showTab(sec: HTMLElement, tab: 'left' | 'right'): void {
  const split = $('.cd-split', sec);
  if (!split) return;
  split.classList.toggle('show-left', tab === 'left');
  split.classList.toggle('show-right', tab === 'right');
  $$('.cd-tab', sec).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

/* ======================================================================
   objective question groups
   ====================================================================== */
export function renderGroup(ctx: RenderCtx, g: QuestionGroup): HTMLElement {
  const box = el('div', { class: 'q-group', dataset: { group: g.id } });
  box.appendChild(el('h3', { class: 'q-range' }, rangeText(groupNumbers(g))));
  if (g.instructions) box.appendChild(el('div', { class: 'q-instr', html: mdBlock(g.instructions) }));
  if ('wordLimit' in g && g.wordLimit && !(('options' in g) && g.options)) {
    if (!g.instructions || !/WORD/i.test(g.instructions)) box.appendChild(el('p', { class: 'q-limit' }, `Write ${describeWordLimit(g.wordLimit)} for each answer.`));
  }
  if ('imageUrl' in g && g.imageUrl) box.appendChild(el('img', { class: 'q-img', src: g.imageUrl, alt: '' }));
  if ('title' in g && g.title) box.appendChild(el('h4', { class: 'q-title' }, g.title));

  switch (g.type) {
    case 'tfng': case 'ynng': box.appendChild(choiceGroup(ctx, g.questions, g.type === 'tfng' ? TFNG_CHOICES : YNNG_CHOICES)); break;
    case 'mcq_single': box.appendChild(mcqSingle(ctx, g)); break;
    case 'mcq_multi': box.appendChild(mcqMulti(ctx, g)); break;
    case 'matching_headings': case 'matching_information': case 'matching_features': case 'matching_sentence_endings': case 'map_labelling':
      box.appendChild(matching(ctx, g)); break;
    case 'short_answer': box.appendChild(shortAnswer(ctx, g)); break;
    case 'sentence_completion': case 'summary_completion': case 'note_completion': case 'table_completion':
    case 'flowchart_completion': case 'diagram_labelling': case 'form_completion':
      box.appendChild(completion(ctx, g)); break;
    default: box.appendChild(el('p', { class: 'muted' }, `(${g.type} is shown in its own section)`));
  }
  return box;
}

function radios(ctx: RenderCtx, qid: string, choices: Array<{ value: string; letter?: string; text: string }>): HTMLElement {
  return el('div', { class: 'choices' }, choices.map(c => el('label', { class: 'choice', dataset: { value: c.value } },
    el('input', { type: 'radio', name: `r_${qid}`, value: c.value, checked: ctx.answers[qid] === c.value, disabled: ctx.readonly, onchange: () => ctx.setAnswer(qid, c.value) }),
    c.letter ? el('b', { class: 'choice-letter' }, c.letter) : null,
    el('span', { class: 'choice-text', html: inlineMd(c.text) }))));
}

function choiceGroup(ctx: RenderCtx, questions: Array<{ id: string; number: number; text: string }>, choices: readonly string[]): HTMLElement {
  return el('div', { class: 'q-list' }, questions.map(q => {
    const item = el('div', { class: 'q-item', dataset: { num: String(q.number), qid: q.id } },
      el('div', { class: 'q-text' }, qNum([q.number]), el('span', { html: inlineMd(q.text) })),
      radios(ctx, q.id, choices.map(c => ({ value: c, text: c }))));
    ctx.registerNum(q.number, item);
    return item;
  }));
}

function mcqSingle(ctx: RenderCtx, g: Extract<QuestionGroup, { type: 'mcq_single' }>): HTMLElement {
  return el('div', { class: 'q-list' }, g.questions.map(q => {
    const item = el('div', { class: 'q-item', dataset: { num: String(q.number), qid: q.id } },
      el('div', { class: 'q-text' }, qNum([q.number]), el('span', { html: inlineMd(q.text) })),
      radios(ctx, q.id, q.options.map((o, i) => ({ value: letter(i), letter: letter(i), text: o }))));
    ctx.registerNum(q.number, item);
    return item;
  }));
}

function mcqMulti(ctx: RenderCtx, g: Extract<QuestionGroup, { type: 'mcq_multi' }>): HTMLElement {
  return el('div', { class: 'q-list' }, g.questions.map(q => {
    const count = q.numbers.length;
    const sel = () => (Array.isArray(ctx.answers[q.id]) ? (ctx.answers[q.id] as string[]) : []);
    const item = el('div', { class: 'q-item', dataset: { num: String(q.numbers[0]), qid: q.id } },
      el('div', { class: 'q-text' }, qNum(q.numbers), el('span', { html: inlineMd(q.text) })),
      el('div', { class: 'choices' }, q.options.map((o, i) => {
        const L = letter(i);
        return el('label', { class: 'choice', dataset: { value: L } },
          el('input', {
            type: 'checkbox', value: L, checked: sel().includes(L), disabled: ctx.readonly,
            onchange: (e: Event) => {
              const box = e.target as HTMLInputElement;
              let cur = sel().slice();
              if (box.checked) {
                if (cur.length >= count) { box.checked = false; ctx.flash(`You can choose only ${count} answers. Untick one first.`); return; }
                cur.push(L);
              } else cur = cur.filter(x => x !== L);
              ctx.setAnswer(q.id, cur.sort());
            }
          }),
          el('b', { class: 'choice-letter' }, L),
          el('span', { class: 'choice-text', html: inlineMd(o) }));
      })));
    q.numbers.forEach(n => ctx.registerNum(n, item));
    return item;
  }));
}

function textInput(ctx: RenderCtx, qid: string, n: number): HTMLInputElement {
  const v = ctx.answers[qid];
  return el('input', {
    class: 'gap-input no-hl', type: 'text', placeholder: String(n), value: typeof v === 'string' ? v : '', disabled: ctx.readonly,
    autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', maxlength: 120, 'aria-label': `Answer ${n}`,
    dataset: { qid, num: String(n) },
    oninput: (e: Event) => ctx.setAnswer(qid, (e.target as HTMLInputElement).value)
  });
}

function shortAnswer(ctx: RenderCtx, g: Extract<QuestionGroup, { type: 'short_answer' }>): HTMLElement {
  return el('div', { class: 'q-list' }, g.questions.map(q => {
    const item = el('div', { class: 'q-item q-short', dataset: { num: String(q.number), qid: q.id } },
      el('div', { class: 'q-text' }, qNum([q.number]), el('span', { html: inlineMd(q.text) })),
      textInput(ctx, q.id, q.number));
    ctx.registerNum(q.number, item);
    return item;
  }));
}

function completion(ctx: RenderCtx, g: CompletionGroup): HTMLElement {
  const options = g.options;
  const numberOf = new Map(g.questions.map(q => [q.id, q.number]));
  const html = g.template
    ? templateHTML(g.template)
    : g.questions.map(q => `<p class="cmp-line cmp-sentence" data-sentence="${q.id}"><span class="q-num no-hl">${q.number}</span> ${blankSentenceHTML(q.text ?? '', q.id)}</p>`).join('');
  const wrap = el('div', { class: 'cmp', html });
  for (const span of $$<HTMLElement>('.gap', wrap)) {
    const qid = span.dataset.qid!;
    const n = numberOf.get(qid);
    if (n === undefined) continue;
    const ctl = options ? dropZone(ctx, g.id, options, qid, n, true) : textInput(ctx, qid, n);
    const holder = el('span', { class: 'gap-holder', dataset: { num: String(n), qid } }, ctl);
    span.replaceWith(holder);
    ctx.registerNum(n, holder);
  }
  return options ? el('div', null, wrap, optionBank(ctx, g.id, options, g.questions.map(q => q.id), false, true)) : wrap;
}

/* ---------- matching: drag & drop, or click an option then a box ---------- */
type MatchingG = Extract<QuestionGroup, { type: 'matching_headings' | 'matching_information' | 'matching_features' | 'matching_sentence_endings' | 'map_labelling' }>;

function matching(ctx: RenderCtx, g: MatchingG): HTMLElement {
  const qs = el('div', { class: 'match-qs' }, g.questions.map(q => {
    const item = el('div', { class: 'q-item match-item', dataset: { num: String(q.number), qid: q.id } },
      el('div', { class: 'q-text' }, qNum([q.number]), el('span', { html: inlineMd(q.text) })),
      dropZone(ctx, g.id, g.options, q.id, q.number, false));
    ctx.registerNum(q.number, item);
    return item;
  }));
  return el('div', { class: 'match' }, qs, optionBank(ctx, g.id, g.options, g.questions.map(q => q.id), g.allowReuse, false, g.optionsTitle));
}

const findOption = (options: Option[], label: unknown) => options.find(o => o.label.toLowerCase() === String(label ?? '').toLowerCase());

function dropZone(ctx: RenderCtx, groupId: string, options: Option[], qid: string, n: number, inline: boolean): HTMLElement {
  const zone = el('span', {
    class: `drop-zone no-hl${inline ? ' inline' : ''}`, tabindex: ctx.readonly ? '-1' : '0',
    dataset: { qid, group: groupId, num: String(n) }, role: 'button', 'aria-label': `Answer box ${n}`
  });
  const draw = () => {
    const v = ctx.answers[qid];
    zone.innerHTML = '';
    zone.classList.toggle('filled', typeof v === 'string' && !!v);
    if (typeof v !== 'string' || !v) { zone.appendChild(el('span', { class: 'dz-placeholder' }, String(n))); return; }
    const o = findOption(options, v);
    zone.draggable = !ctx.readonly;
    zone.appendChild(el('b', null, o?.label ?? v));
    if (o?.text) zone.appendChild(el('span', { class: 'dz-text' }, ` ${o.text}`));
  };
  (zone as HTMLElement & { _draw?: () => void })._draw = draw;
  draw();
  if (ctx.readonly) return zone;

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    let data: { group: string; label: string; from?: string };
    try { data = JSON.parse(e.dataTransfer?.getData('text/plain') ?? ''); } catch { return; }
    if (data.group !== groupId) return;
    if (data.from && data.from !== qid) ctx.setAnswer(data.from, (ctx.answers[qid] as string) || null); // swap boxes
    ctx.setAnswer(qid, data.label);
    refreshGroup(ctx, groupId);
  });
  zone.addEventListener('dragstart', e => {
    const v = ctx.answers[qid];
    if (typeof v !== 'string' || !v) { e.preventDefault(); return; }
    e.dataTransfer?.setData('text/plain', JSON.stringify({ group: groupId, label: v, from: qid }));
  });
  const activate = () => {
    if (ctx.picked && ctx.picked.group === groupId) {
      ctx.setAnswer(qid, ctx.picked.label);
      ctx.picked = null;
      $$('.chip-opt.picked', ctx.root()).forEach(c => c.classList.remove('picked'));
    } else if (ctx.answers[qid]) {
      ctx.setAnswer(qid, null);
    }
    refreshGroup(ctx, groupId);
  };
  zone.addEventListener('click', activate);
  zone.addEventListener('keydown', e => { if (['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); activate(); } });
  return zone;
}

function optionBank(ctx: RenderCtx, groupId: string, options: Option[], qids: string[], reuse: boolean, row: boolean, title?: string): HTMLElement {
  const bank = el('div', { class: `opt-bank no-hl${row ? ' row' : ''}`, dataset: { bank: groupId, reuse: reuse ? '1' : '' } },
    title ? el('h4', { class: 'q-title' }, title) : null,
    el('div', { class: 'chips' }, options.map(o => {
      const chip = el('div', {
        class: 'chip-opt', draggable: ctx.readonly ? null : 'true', dataset: { label: o.label, group: groupId }, tabindex: ctx.readonly ? '-1' : '0', role: 'button',
        title: ctx.readonly ? '' : 'Drag into a box, or click here and then click a box'
      }, el('b', null, o.label), o.text ? el('span', null, o.text) : null);
      if (!ctx.readonly) {
        chip.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/plain', JSON.stringify({ group: groupId, label: o.label })); chip.classList.add('dragging'); });
        chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
        const pick = () => {
          if (chip.classList.contains('used')) return;
          const was = chip.classList.contains('picked');
          $$('.chip-opt.picked', ctx.root()).forEach(c => c.classList.remove('picked'));
          ctx.picked = was ? null : { group: groupId, label: o.label };
          if (!was) chip.classList.add('picked');
        };
        chip.addEventListener('click', pick);
        chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      }
      return chip;
    })));
  (bank as HTMLElement & { _qids?: string[] })._qids = qids;
  if (!ctx.readonly) {
    // dropping a used option back on the list empties that box
    bank.addEventListener('dragover', e => e.preventDefault());
    bank.addEventListener('drop', e => {
      e.preventDefault();
      try {
        const data = JSON.parse(e.dataTransfer?.getData('text/plain') ?? '') as { group: string; from?: string };
        if (data.group === groupId && data.from) { ctx.setAnswer(data.from, null); refreshGroup(ctx, groupId); }
      } catch { /* not ours */ }
    });
  }
  ctx.afterRender.push(() => refreshGroup(ctx, groupId));
  return bank;
}

export function refreshGroup(ctx: RenderCtx, groupId: string): void {
  const root = ctx.root();
  $$(`.drop-zone[data-group="${groupId}"]`, root).forEach(z => (z as HTMLElement & { _draw?: () => void })._draw?.());
  const bank = $(`[data-bank="${groupId}"]`, root) as (HTMLElement & { _qids?: string[] }) | null;
  if (!bank) return;
  const used = new Set((bank._qids ?? []).map(id => String(ctx.answers[id] ?? '').toLowerCase()).filter(Boolean));
  $$('.chip-opt', bank).forEach(c => c.classList.toggle('used', !bank.dataset.reuse && used.has(String(c.dataset.label).toLowerCase())));
}

/* ======================================================================
   writing
   ====================================================================== */
function chartTable(c: Chart): HTMLElement {
  const caption = el('div', { class: 'chart-title' }, c.title ?? '', c.unit ? el('span', { class: 'muted' }, ` (${c.unit})`) : null);
  const table = (head: string[], rows: Array<Array<string | number | null>>) => el('table', { class: 'cmp-table chart-table' },
    el('tr', null, head.map(h => el('th', null, h))),
    rows.map(r => el('tr', null, r.map(v => el('td', null, v === null ? '–' : String(v))))));
  let body: HTMLElement;
  switch (c.chartType) {
    case 'line': case 'bar': body = table(['', ...c.labels], c.series.map(s => [s.name, ...s.values])); break;
    case 'pie': body = el('div', { class: 'chart-pies' }, c.pies.map(p => el('div', null, p.title ? el('b', null, p.title) : null, table(['', 'Value'], p.slices.map(s => [s.label, s.value]))))); break;
    case 'table': body = table(c.columns, c.rows); break;
    case 'process': body = el('ol', { class: 'chart-steps' }, c.steps.map(s => el('li', null, el('b', null, s.label), s.detail ? ` — ${s.detail}` : '')), c.cyclic ? el('li', { class: 'muted' }, '↻ back to the first step') : null); break;
    case 'map': body = el('div', { class: 'chart-pies' }, c.maps.map(m => el('div', null, el('b', null, m.title), el('ul', null, m.features.map(f => el('li', null, `${f.label} (${f.shape})`)))))); break;
  }
  return el('figure', { class: `chart chart-${c.chartType}` }, caption, body, el('figcaption', { class: 'muted' }, `${c.chartType} chart — drawing it as a picture arrives in Phase 6`));
}

function writingPrompt(g: QuestionGroup): HTMLElement {
  if (g.type !== 'writing_task1' && g.type !== 'writing_task2' && g.type !== 'paragraph') return el('div');
  return el('div', { class: 'w-prompt', dataset: { group: g.id } },
    g.instructions ? el('div', { class: 'q-instr', html: mdBlock(g.instructions) }) : null,
    el('div', { html: mdBlock(g.prompt) }),
    g.type === 'writing_task1' && g.imageUrl ? el('img', { class: 'w-img', src: g.imageUrl, alt: '' }) : null,
    g.type === 'writing_task1' ? g.charts.map(chartTable) : null,
    g.type === 'paragraph' && g.structure === 'PEEL' ? el('p', { class: 'muted' }, 'Structure: Point · Explain · Example · Link') : null);
}

function textArea(ctx: RenderCtx, value: string, minWords: number, label: string | null, onChange: (v: string) => void, rows?: number): HTMLElement {
  const count = el('span', { class: 'wc-num' }, String(wordCount(value)));
  const ta = el('textarea', {
    class: 'w-text', spellcheck: 'false', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', disabled: ctx.readonly,
    placeholder: 'Type your answer here', value, ...(rows ? { rows } : {}),
    oninput: (e: Event) => { const v = (e.target as HTMLTextAreaElement).value; count.textContent = String(wordCount(v)); onChange(v); }
  });
  return el('div', { class: 'w-answer' + (rows ? ' w-small' : '') },
    label ? el('div', { class: 'w-label' }, label) : null, ta,
    el('div', { class: 'wc no-hl' }, 'Words: ', count, minWords ? el('span', { class: 'muted' }, ` (minimum ${minWords})`) : null));
}

function writingAnswer(ctx: RenderCtx, g: QuestionGroup): HTMLElement {
  if (g.type === 'writing_task2' && g.mode === 'plan_intro') {
    const cur = (ctx.answers[g.id] && typeof ctx.answers[g.id] === 'object' && !Array.isArray(ctx.answers[g.id]) ? ctx.answers[g.id] : {}) as { plan?: string; introduction?: string };
    const value = { plan: cur.plan ?? '', introduction: cur.introduction ?? '' };
    const save = () => ctx.setAnswer(g.id, { ...value });
    return el('div', { class: 'w-drill', dataset: { group: g.id } },
      el('p', { class: 'muted' }, `Drill: plan (about ${g.planTimeMin} min), then the introduction (about ${g.introTimeMin} min). Separate timers arrive in Phase 6.`),
      textArea(ctx, value.plan, 0, '1 · Plan', v => { value.plan = v; save(); }, 8),
      textArea(ctx, value.introduction, g.introMinWords, '2 · Introduction', v => { value.introduction = v; save(); }, 8));
  }
  if (g.type === 'writing_task1' || g.type === 'writing_task2' || g.type === 'paragraph') {
    const v = ctx.answers[g.id];
    return textArea(ctx, typeof v === 'string' ? v : '', g.minWords, null, val => ctx.setAnswer(g.id, val));
  }
  return el('div');
}

/* ======================================================================
   speaking (typed notes now; recording arrives in Phase 6)
   ====================================================================== */
function notesBox(ctx: RenderCtx, id: string, prompt: string): HTMLElement {
  const v = ctx.answers[id];
  return el('div', { class: 'sp-item' },
    el('div', { class: 'q-text', html: inlineMd(prompt) }),
    el('textarea', {
      class: 'w-text sp-notes', rows: 3, placeholder: 'Notes or what you said (recording arrives in Phase 6)', value: typeof v === 'string' ? v : '', disabled: ctx.readonly,
      oninput: (e: Event) => ctx.setAnswer(id, (e.target as HTMLTextAreaElement).value)
    }));
}

function speakingGroup(ctx: RenderCtx, g: QuestionGroup): HTMLElement {
  const box = el('div', { class: 'q-group sp-group', dataset: { group: g.id } });
  const titles: Record<string, string> = { speaking_part1: 'Part 1 — Introduction and interview', speaking_part2: 'Part 2 — Long turn', speaking_part3: 'Part 3 — Discussion' };
  box.appendChild(el('h3', { class: 'q-range' }, titles[g.type] ?? g.type));
  if ('instructions' in g && g.instructions) box.appendChild(el('div', { class: 'q-instr', html: mdBlock(g.instructions) }));
  if (g.type === 'speaking_part1' || g.type === 'speaking_part3') {
    if (g.topic) box.appendChild(el('h4', { class: 'q-title' }, g.topic));
    g.questions.forEach(q => box.appendChild(notesBox(ctx, q.id, q.text)));
  } else if (g.type === 'speaking_part2') {
    box.appendChild(el('div', { class: 'cue-card' },
      el('p', { class: 'cue-topic', html: inlineMd(g.cueCard.topic) }),
      el('p', null, 'You should say:'),
      el('ul', null, g.cueCard.bullets.map(b => el('li', { html: inlineMd(b) }))),
      g.cueCard.closing ? el('p', { html: inlineMd(g.cueCard.closing) }) : null,
      el('p', { class: 'muted' }, `Preparation ${Math.round(g.prepTimeSec / 60)} min · talk ${Math.round(g.talkTimeSec / 60)} min (timers arrive in Phase 6)`)));
    box.appendChild(notesBox(ctx, g.id, 'Your notes'));
    g.followUps.forEach(q => box.appendChild(notesBox(ctx, q.id, q.text)));
  }
  return box;
}
