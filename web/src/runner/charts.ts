/*
 * Writing Task 1 visuals drawn from data (spec §4): line, bar, pie, table, process and map.
 * Plain SVG/HTML, no library: the exam needs simple, high-contrast charts that follow the
 * exam's colour settings. Colours are the validated reference palette (fixed slot order,
 * light steps on white, dark steps for white/yellow-on-black) — see .chart vars in exam.css.
 */
import type { Chart } from '@ielts/shared';
import { el, esc } from '../lib/dom';

type LineOrBar = Extract<Chart, { chartType: 'line' | 'bar' }>;
type Pie = Extract<Chart, { chartType: 'pie' }>;
type MapChart = Extract<Chart, { chartType: 'map' }>;
type Process = Extract<Chart, { chartType: 'process' }>;

const MAX_SLOTS = 8;
/** fixed slot order, never cycled; past 8 the category falls back to a neutral grey (and stays labelled) */
const fill = (i: number) => (i < MAX_SLOTS ? `var(--series-${i + 1})` : 'var(--chart-muted)');

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString('en-GB') : String(Math.round(n * 100) / 100));
const withUnit = (n: number | null, unit?: string) => (n === null ? 'no data' : `${fmt(n)}${unit ? ` ${unit}` : ''}`);

/** 0, 20, 40 … — a few round steps that cover [min, max] */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function legend(names: string[]): HTMLElement | null {
  if (names.length < 2) return null;
  return el('div', { class: 'chart-legend' }, names.map((n, i) => el('span', { class: 'chart-key' }, el('i', { style: { background: fill(i) } }), n)));
}

function caption(c: Chart): HTMLElement | null {
  if (!c.title && !c.unit) return null;
  return el('div', { class: 'chart-title' }, c.title ?? '', c.unit ? el('span', { class: 'chart-unit' }, c.title ? ` (${c.unit})` : c.unit) : null);
}

/** the numbers behind a chart, for checking values and for screen readers */
function numbers(head: string[], rows: Array<Array<string | number | null>>, label = 'Show the numbers'): HTMLElement {
  return el('details', { class: 'chart-numbers no-hl' }, el('summary', null, label),
    el('table', { class: 'cmp-table chart-table' },
      el('tr', null, head.map(h => el('th', null, h))),
      rows.map(r => el('tr', null, r.map(v => el('td', null, v === null ? '–' : typeof v === 'number' ? fmt(v) : v))))));
}

const svg = (w: number, h: number, body: string, label: string) =>
  el('div', { class: 'chart-svg', html: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>` });

/** a bar whose data end is rounded (4px) and whose base sits square on the axis */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean, negative: boolean): string {
  const r = Math.max(0, Math.min(4, (horizontal ? h : w) / 2, horizontal ? w : h));
  if (w <= 0 || h <= 0) return '';
  if (!horizontal && !negative) return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  if (!horizontal && negative) return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  if (horizontal && !negative) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}

/* ---------------------------------------------------------------- line + bar */
function cartesian(c: LineOrBar): HTMLElement {
  const horizontal = c.chartType === 'bar' && c.orientation === 'horizontal';
  const stacked = c.chartType === 'bar' && c.stacked;
  const W = 680, H = horizontal ? Math.max(260, 70 + c.labels.length * (stacked ? 34 : 18 + 14 * c.series.length)) : 380;
  const labelW = horizontal ? Math.min(170, 18 + Math.max(...c.labels.map(l => l.length)) * 7) : 0;
  const m = { top: horizontal && c.yLabel ? 24 : 16, right: c.chartType === 'line' && c.series.length <= 4 ? 120 : 24, bottom: horizontal ? 44 : 64, left: horizontal ? labelW : 64 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;

  // value range: from 0 (bars always; lines unless every value is far from 0), stacked bars sum per label
  const vals = c.series.flatMap(s => s.values).filter((v): v is number => v !== null);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (stacked) hi = Math.max(0, ...c.labels.map((_, i) => c.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0)));
  if (c.chartType === 'line' && vals.length && Math.min(...vals) > 0 && Math.min(...vals) > (Math.max(...vals) - Math.min(...vals)) * 2) lo = Math.min(...vals);
  const ticks = niceTicks(lo, hi || 1);
  lo = ticks[0]!; hi = ticks[ticks.length - 1]!;
  const scale = (v: number) => (horizontal ? m.left + ((v - lo) / (hi - lo)) * pw : m.top + ph - ((v - lo) / (hi - lo)) * ph);
  const zero = scale(Math.max(lo, 0));
  const unit = c.unit;
  const parts: string[] = [];

  // grid and value axis (recessive)
  for (const t of ticks) {
    const p = scale(t);
    parts.push(horizontal
      ? `<line class="grid" x1="${p}" x2="${p}" y1="${m.top}" y2="${m.top + ph}"/><text class="tick" x="${p}" y="${m.top + ph + 18}" text-anchor="middle">${esc(fmt(t))}</text>`
      : `<line class="grid" x1="${m.left}" x2="${m.left + pw}" y1="${p}" y2="${p}"/><text class="tick" x="${m.left - 8}" y="${p + 4}" text-anchor="end">${esc(fmt(t))}</text>`);
  }
  parts.push(horizontal
    ? `<line class="axis" x1="${zero}" x2="${zero}" y1="${m.top}" y2="${m.top + ph}"/>`
    : `<line class="axis" x1="${m.left}" x2="${m.left + pw}" y1="${zero}" y2="${zero}"/>`);

  // category positions: bands for bars, evenly spaced points (first to last at the edges) for lines
  const band = (horizontal ? ph : pw) / c.labels.length;
  const catCenter = (i: number) => (horizontal ? m.top : m.left) + band * (i + 0.5);
  const lineX = (i: number) => (c.labels.length === 1 ? m.left + pw / 2 : m.left + (pw / (c.labels.length - 1)) * i);
  c.labels.forEach((l, i) => {
    const p = c.chartType === 'line' ? lineX(i) : catCenter(i);
    if (horizontal) parts.push(`<text class="cat" x="${m.left - 8}" y="${p + 4}" text-anchor="end">${esc(l)}</text>`);
    else {
      const rotate = c.labels.length > 8 || Math.max(...c.labels.map(x => x.length)) * 7 > band;
      parts.push(rotate
        ? `<text class="cat" transform="translate(${p},${m.top + ph + 14}) rotate(-35)" text-anchor="end">${esc(l)}</text>`
        : `<text class="cat" x="${p}" y="${m.top + ph + 20}" text-anchor="middle">${esc(l)}</text>`);
    }
  });

  if (c.chartType === 'line') {
    const x = lineX;
    const ends: Array<{ y: number; name: string; i: number }> = [];
    c.series.forEach((s, si) => {
      // a null value breaks the line
      let d = '';
      s.values.forEach((v, i) => { if (v === null) return; d += `${d && s.values[i - 1] !== null && i > 0 ? 'L' : 'M'}${x(i)},${scale(v)}`; });
      parts.push(`<path class="line" d="${d}" stroke="${fill(si)}"/>`);
      s.values.forEach((v, i) => {
        if (v === null) return;
        parts.push(`<circle class="dot" cx="${x(i)}" cy="${scale(v)}" r="4" fill="${fill(si)}"><title>${esc(`${s.name} — ${c.labels[i]}: ${withUnit(v, unit)}`)}</title></circle>`);
      });
      const last = [...s.values.keys()].reverse().find(i => s.values[i] !== null);
      if (last !== undefined) ends.push({ y: scale(s.values[last]!), name: s.name, i: si });
    });
    // direct labels at the line ends (up to 4 series), nudged apart so they never overlap
    if (c.series.length <= 4 && c.series.length > 1) {
      ends.sort((a, b) => a.y - b.y);
      for (let k = 1; k < ends.length; k++) if (ends[k]!.y - ends[k - 1]!.y < 15) ends[k]!.y = ends[k - 1]!.y + 15;
      for (const e of ends) parts.push(`<text class="end-label" x="${m.left + pw + 10}" y="${e.y + 4}">${esc(e.name.length > 16 ? `${e.name.slice(0, 15)}…` : e.name)}</text>`);
    }
  } else {
    const n = c.series.length;
    const groupW = band * 0.72;
    const gap = 2;
    c.labels.forEach((label, i) => {
      const start = catCenter(i) - groupW / 2;
      let stackPos = 0, stackNeg = 0;
      c.series.forEach((s, si) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        const title = `<title>${esc(`${n > 1 ? `${s.name} — ` : ''}${label}: ${withUnit(v, unit)}`)}</title>`;
        let a: number, b: number, along: number, thick: number;
        if (stacked) {
          const base = v >= 0 ? stackPos : stackNeg;
          a = scale(base); b = scale(base + v);
          if (v >= 0) stackPos += v; else stackNeg += v;
          along = start; thick = groupW;
        } else {
          a = scale(Math.max(lo, 0)); b = scale(v);
          thick = (groupW - gap * (n - 1)) / n;
          along = start + si * (thick + gap);
        }
        const neg = v < 0;
        const top = stacked && si < n - 1 && !neg; // only the end of a stack is rounded
        const len = Math.abs(b - a) - (stacked && si > 0 ? gap : 0);
        if (horizontal) {
          const x0 = Math.min(a, b) + (stacked && si > 0 && !neg ? gap : 0);
          const d = top ? `M${x0},${along}h${len}v${thick}h${-len}Z` : barPath(x0, along, len, thick, true, neg);
          parts.push(`<path class="bar" d="${d}" fill="${fill(si)}">${title}</path>`);
        } else {
          const y0 = Math.min(a, b);
          const d = top ? `M${along},${y0}h${thick}v${len}h${-thick}Z` : barPath(along, y0, thick, len, false, neg);
          parts.push(`<path class="bar" d="${d}" fill="${fill(si)}">${title}</path>`);
        }
      });
    });
  }

  // xLabel names the bottom axis and yLabel the left one, whatever the orientation
  if (c.xLabel) parts.push(`<text class="axis-label" x="${m.left + pw / 2}" y="${H - 6}" text-anchor="middle">${esc(c.xLabel)}</text>`);
  if (c.yLabel) {
    parts.push(horizontal
      ? `<text class="axis-label" x="6" y="12">${esc(c.yLabel)}</text>`
      : `<text class="axis-label" transform="translate(14,${m.top + ph / 2}) rotate(-90)" text-anchor="middle">${esc(c.yLabel)}</text>`);
  }

  const label = `${c.chartType} chart${c.title ? `: ${c.title}` : ''}`;
  return el('figure', { class: `chart chart-${c.chartType}` },
    caption(c), legend(c.series.map(s => s.name)), svg(W, H, parts.join(''), label),
    numbers(['', ...c.labels], c.series.map(s => [s.name, ...s.values])));
}

/* ---------------------------------------------------------------- pie */
function pies(c: Pie): HTMLElement {
  // one colour per category across all pies (colour follows the entity)
  const cats: string[] = [];
  for (const p of c.pies) for (const s of p.slices) if (!cats.includes(s.label)) cats.push(s.label);
  const colour = (label: string) => fill(cats.indexOf(label));
  const R = 110, size = 2 * R + 40;
  const one = (p: Pie['pies'][number]) => {
    const total = p.slices.reduce((s, x) => s + x.value, 0) || 1;
    let angle = -Math.PI / 2;
    const parts: string[] = [];
    for (const s of p.slices) {
      const frac = s.value / total;
      const a0 = angle, a1 = angle + frac * 2 * Math.PI;
      angle = a1;
      const cx = size / 2, cy = size / 2;
      const pt = (a: number, r = R) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      const pct = `${Math.round(frac * 1000) / 10}%`;
      const title = `<title>${esc(`${s.label}: ${fmt(s.value)}${c.unit && c.unit !== '%' ? ` ${c.unit}` : ''} (${pct})`)}</title>`;
      const d = frac >= 0.9999 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0` : `M${cx},${cy}L${pt(a0)}A${R},${R} 0 ${frac > 0.5 ? 1 : 0},1 ${pt(a1)}Z`;
      parts.push(`<path class="slice" d="${d}" fill="${colour(s.label)}">${title}</path>`);
      if (frac >= 0.06) {
        const mid = (a0 + a1) / 2;
        const [lx, ly] = pt(mid, R * 0.64).split(',');
        parts.push(`<text class="slice-label" x="${lx}" y="${Number(ly) + 4}" text-anchor="middle">${pct}</text>`);
      }
    }
    return el('div', { class: 'chart-pie' }, p.title ? el('b', null, p.title) : null, svg(size, size, parts.join(''), `pie chart${p.title ? `: ${p.title}` : ''}`));
  };
  const rows: Array<Array<string | number | null>> = cats.map(cat => [cat, ...c.pies.map(p => p.slices.find(s => s.label === cat)?.value ?? null)]);
  return el('figure', { class: 'chart chart-pie-group' },
    caption(c),
    el('div', { class: 'chart-legend' }, cats.map((cat, i) => el('span', { class: 'chart-key' }, el('i', { style: { background: fill(i) } }), cat))),
    el('div', { class: 'chart-pies' }, c.pies.map(one)),
    numbers(['', ...c.pies.map((p, i) => p.title ?? `Chart ${i + 1}`)], rows));
}

/* ---------------------------------------------------------------- process */
function process(c: Process): HTMLElement {
  return el('figure', { class: 'chart chart-process' },
    caption(c),
    el('ol', { class: 'process-steps' }, c.steps.map((s, i) => el('li', { class: 'process-step' },
      el('span', { class: 'process-num' }, String(i + 1)),
      el('div', null, el('b', null, s.label), s.detail ? el('div', { class: 'process-detail' }, s.detail) : null)))),
    c.cyclic ? el('p', { class: 'process-cycle' }, `↻ After step ${c.steps.length}, the cycle starts again at step 1.`) : null);
}

/* ---------------------------------------------------------------- map */
function maps(c: MapChart): HTMLElement {
  const W = 400, H = 300;
  const one = (mp: MapChart['maps'][number]) => {
    const parts: string[] = [`<rect class="map-frame" x="1" y="1" width="${W - 2}" height="${H - 2}"/>`];
    const labels: string[] = [];
    for (const f of mp.features) {
      const cx = (f.x / 100) * W, cy = (f.y / 100) * H;
      const title = `<title>${esc(f.label)}</title>`;
      const box = (dw: number, dh: number) => {
        const w = ((f.width ?? dw) / 100) * W, h = ((f.height ?? dh) / 100) * H;
        return { x: cx - w / 2, y: cy - h / 2, w, h };
      };
      let labelY = cy + 4;
      switch (f.shape) {
        case 'building': { const b = box(12, 10); parts.push(`<rect class="m-building" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}">${title}</rect>`); labelY = b.y + b.h + 13; break; }
        case 'area': { const b = box(30, 24); parts.push(`<rect class="m-area" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6">${title}</rect>`); break; }
        case 'water': { const b = box(30, 20); parts.push(`<rect class="m-water" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(b.w, b.h) / 2}">${title}</rect>`); break; }
        case 'road': {
          const b = box(f.width === undefined && f.height !== undefined ? 3 : 100, f.height === undefined ? 3 : f.height);
          parts.push(`<rect class="m-road" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}">${title}</rect>`);
          labelY = b.h > b.w ? cy : b.y - 5;
          break;
        }
        case 'trees': {
          const b = box(14, 12);
          const cols = Math.max(2, Math.round(b.w / 12)), rows = Math.max(1, Math.round(b.h / 12));
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) parts.push(`<circle class="m-tree" cx="${b.x + (i + 0.5) * (b.w / cols)}" cy="${b.y + (j + 0.5) * (b.h / rows)}" r="${Math.min(b.w / cols, b.h / rows) * 0.45}">${title}</circle>`);
          labelY = b.y + b.h + 13;
          break;
        }
        case 'point': parts.push(`<circle class="m-point" cx="${cx}" cy="${cy}" r="5">${title}</circle>`); labelY = cy - 9; break;
      }
      labels.push(`<text class="m-label" x="${cx}" y="${labelY}" text-anchor="middle">${esc(f.label)}</text>`);
    }
    parts.push(...labels, `<g class="m-north"><text x="${W - 22}" y="24" text-anchor="middle">N</text><path d="M${W - 22},30 l-6,14 h12 z"/></g>`);
    return el('div', { class: 'chart-map' }, el('b', null, mp.title), svg(W, H, parts.join(''), `map: ${mp.title}`));
  };
  return el('figure', { class: 'chart chart-maps' }, caption(c), el('div', { class: 'chart-pies' }, c.maps.map(one)),
    numbers(['Map', 'Feature', 'Kind'], c.maps.flatMap(mp => mp.features.map(f => [mp.title, f.label, f.shape])), 'List the features'));
}

/* ---------------------------------------------------------------- table */
function table(c: Extract<Chart, { chartType: 'table' }>): HTMLElement {
  return el('figure', { class: 'chart chart-table-wrap' }, caption(c),
    el('div', { class: 'chart-scroll' }, el('table', { class: 'cmp-table chart-table' },
      el('tr', null, c.columns.map(h => el('th', null, h))),
      c.rows.map(r => el('tr', null, r.map(v => el('td', null, typeof v === 'number' ? fmt(v) : v)))))));
}

export function renderChart(c: Chart): HTMLElement {
  switch (c.chartType) {
    case 'line': case 'bar': return cartesian(c);
    case 'pie': return pies(c);
    case 'process': return process(c);
    case 'map': return maps(c);
    case 'table': return table(c);
  }
}
