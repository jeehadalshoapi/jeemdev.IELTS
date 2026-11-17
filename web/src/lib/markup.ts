/* Light text formatting for test content. Everything is HTML-escaped first, so test text can never inject markup. */
import type { Passage } from '@ielts/shared';
import { esc } from './dom';

/** escape + **bold** + *italic* */
export function inlineMd(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
}

/** paragraphs separated by blank lines; single newlines become <br>; a block of "- " lines becomes a list */
export function mdBlock(text: string | undefined): string {
  return String(text ?? '').trim().split(/\n\s*\n/).filter(Boolean).map(p => {
    const lines = p.split('\n');
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inlineMd(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${inlineMd(p).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export function passageHTML(p: Passage): string {
  return p.paragraphs.map(para => {
    const heading = para.heading ? `<h4 class="psg-sub">${inlineMd(para.heading)}</h4>` : '';
    const body = `<p>${inlineMd(para.text).replace(/\n/g, '<br>')}</p>`;
    return heading + (para.label
      ? `<div class="psg-para labelled" data-para="${esc(para.label)}"><span class="para-label no-hl">${esc(para.label)}</span>${body}</div>`
      : `<div class="psg-para">${body}</div>`);
  }).join('');
}

const GAP = (qid: string) => `<span class="gap" data-qid="${esc(qid)}"></span>`;

/**
 * Completion template -> HTML with <span class="gap" data-qid="…"> where each {{questionId}} goes.
 * "# heading", "- bullet", "a | b | c" table rows (first row = header), "> flow-chart box".
 */
export function templateHTML(template: string): string {
  const gapify = (line: string) => inlineMd(line).replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*\}\}/g, (_m, id: string) => GAP(id));
  const lines = template.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = (lines[i] ?? '').trim();
    if (!t) { i++; continue; }
    if (t.includes('|') && !t.startsWith('>')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().includes('|')) {
        const r = (lines[i] ?? '').trim().replace(/^\||\|$/g, '');
        if (!/^[\s|:-]+$/.test(r)) rows.push(r.split('|').map(c => c.trim()));
        i++;
      }
      const cols = Math.max(...rows.map(r => r.length));
      out.push(`<div class="cmp-table-wrap"><table class="cmp-table">${rows.map((r, ri) =>
        `<tr>${Array.from({ length: cols }, (_, ci) => { const tag = ri === 0 ? 'th' : 'td'; return `<${tag}>${gapify(r[ci] ?? '')}</${tag}>`; }).join('')}</tr>`).join('')}</table></div>`);
      continue;
    }
    if (t.startsWith('> ')) {
      const steps: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('> ')) { steps.push((lines[i] ?? '').trim().slice(2)); i++; }
      out.push(`<div class="cmp-flow">${steps.map(s => `<div class="flow-box">${gapify(s)}</div>`).join('<div class="flow-arrow">↓</div>')}</div>`);
      continue;
    }
    if (/^[-•]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•]\s+/.test((lines[i] ?? '').trim())) { items.push((lines[i] ?? '').trim().replace(/^[-•]\s+/, '')); i++; }
      out.push(`<ul class="cmp-list">${items.map(s => `<li>${gapify(s)}</li>`).join('')}</ul>`);
      continue;
    }
    if (t.startsWith('# ')) { out.push(`<h4 class="cmp-head">${gapify(t.slice(2))}</h4>`); i++; continue; }
    out.push(`<p class="cmp-line">${gapify(t)}</p>`);
    i++;
  }
  return out.join('');
}

/** a sentence with "______" where the gap goes (or a gap at the end when there is none) */
export function blankSentenceHTML(text: string, qid: string): string {
  const html = inlineMd(text);
  return /_{3,}/.test(html) ? html.replace(/_{3,}/, GAP(qid)) : `${html} ${GAP(qid)}`;
}
