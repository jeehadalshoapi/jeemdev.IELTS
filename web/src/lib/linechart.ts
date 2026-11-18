/*
 * Small line charts for the progress page (Phase 7), following the dataviz rules used for the Task 1 charts:
 * one accent hue (--series-1), a 2px line, ≥8px dots with a 2px surface ring, hairline grid, only the last
 * value labelled, a crosshair + tooltip that snaps to the nearest attempt (mouse, touch and arrow keys),
 * and the numbers always available in a table next to the chart.
 * The SVG is drawn at the element's real width (redrawn on resize), so text keeps its size on a phone.
 */
import { el, esc } from './dom';

export interface LinePoint {
  y: number;
  /** short label for the x axis, e.g. "17 Nov" */
  x: string;
  /** tooltip: the value leads, then the date line and an optional detail line */
  tip: { value: string; head: string; sub?: string };
  /** a hash link opened on click / Enter, e.g. "#/result/<id>" */
  href?: string;
}

export interface LineChartOptions {
  points: LinePoint[];
  yMin: number;
  yMax: number;
  yTicks: number[];
  yFormat: (v: number) => string;
  /** accessible name; the chart also lists its values for screen readers */
  label: string;
  height?: number;
}

export function lineChart(o: LineChartOptions): HTMLElement {
  const H = o.height ?? 170;
  const n = o.points.length;
  const plot = el('div', { class: 'lc-plot' });
  const tip = el('div', { class: 'lc-tip', 'aria-hidden': 'true' });
  tip.hidden = true;
  const wrap = el('div', {
    class: 'lc', tabindex: n ? '0' : null, role: 'img',
    'aria-label': `${o.label}: ${o.points.map(p => `${p.x} ${p.tip.value}`).join(', ')}`
  }, plot, tip);

  const m = { top: 14, right: 40, bottom: 26, left: 38 };
  let width = 0;
  let xs: number[] = [];
  let active = -1;
  const yOf = (v: number, ph: number) => m.top + (1 - (v - o.yMin) / (o.yMax - o.yMin || 1)) * ph;

  const draw = () => {
    const pw = Math.max(40, width - m.left - m.right), ph = H - m.top - m.bottom;
    xs = o.points.map((_, i) => (n === 1 ? m.left + pw / 2 : m.left + (i / (n - 1)) * pw));
    const ys = o.points.map(p => yOf(p.y, ph));
    const parts: string[] = [];
    for (const t of o.yTicks) {
      const y = yOf(t, ph).toFixed(1);
      parts.push(`<line class="lc-grid" x1="${m.left}" x2="${m.left + pw}" y1="${y}" y2="${y}"/>`,
        `<text class="lc-tick" x="${m.left - 8}" y="${y}" dy="0.32em" text-anchor="end">${esc(o.yFormat(t))}</text>`);
    }
    // x labels: every k-th point so they are evenly spaced (about one per 64px), always the first and the last
    const fit = Math.max(2, Math.floor(pw / 64));
    const every = n <= fit ? 1 : Math.ceil((n - 1) / (fit - 1));
    const idx: number[] = [];
    for (let i = 0; i < n; i += every) idx.push(i);
    if (n && idx.at(-1) !== n - 1) { if (n - 1 - idx.at(-1)! < every / 2) idx.pop(); idx.push(n - 1); }
    for (const i of idx) {
      const anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
      parts.push(`<text class="lc-tick" x="${xs[i]!.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${esc(o.points[i]!.x)}</text>`);
    }
    if (n > 1) parts.push(`<path class="lc-line" d="${xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join('')}"/>`);
    const dotsAll = n <= 40;
    o.points.forEach((_, i) => { if (dotsAll || i === n - 1) parts.push(`<circle class="lc-dot" cx="${xs[i]!.toFixed(1)}" cy="${ys[i]!.toFixed(1)}" r="4"/>`); });
    if (n) parts.push(`<text class="lc-end" x="${(xs[n - 1]! + 9).toFixed(1)}" y="${ys[n - 1]!.toFixed(1)}" dy="0.32em">${esc(o.yFormat(o.points[n - 1]!.y))}</text>`);
    parts.push(`<line class="lc-cross" x1="0" x2="0" y1="${m.top}" y2="${m.top + ph}" visibility="hidden"/>`,
      `<circle class="lc-hot" r="5" cx="0" cy="0" visibility="hidden"/>`);
    plot.innerHTML = `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${parts.join('')}</svg>`;
    if (active >= 0) show(active);
  };

  const show = (i: number) => {
    if (!n) return;
    active = Math.max(0, Math.min(n - 1, i));
    const p = o.points[active]!;
    const ph = H - m.top - m.bottom;
    const x = xs[active]!, y = yOf(p.y, ph);
    const cross = plot.querySelector('.lc-cross'), hot = plot.querySelector('.lc-hot');
    cross?.setAttribute('x1', String(x)); cross?.setAttribute('x2', String(x)); cross?.setAttribute('visibility', 'visible');
    hot?.setAttribute('cx', String(x)); hot?.setAttribute('cy', String(y)); hot?.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      el('div', { class: 'lc-tip-value' }, el('i', { class: 'lc-key' }), p.tip.value),
      el('div', { class: 'lc-tip-head' }, p.tip.head),
      ...(p.tip.sub ? [el('div', { class: 'lc-tip-sub' }, p.tip.sub)] : []));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(0, Math.min(width - tw, x - tw / 2))}px`;
    tip.style.top = `${y - th - 12 >= 0 ? y - th - 12 : y + 14}px`;
    wrap.style.cursor = p.href ? 'pointer' : '';
  };
  const hide = () => {
    active = -1;
    tip.hidden = true;
    plot.querySelector('.lc-cross')?.setAttribute('visibility', 'hidden');
    plot.querySelector('.lc-hot')?.setAttribute('visibility', 'hidden');
  };
  const nearest = (clientX: number) => {
    const left = plot.getBoundingClientRect().left;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - (clientX - left)) < Math.abs(xs[best]! - (clientX - left))) best = i; });
    return best;
  };
  const open = () => { const href = o.points[active]?.href; if (href) location.hash = href; };

  if (n) {
    wrap.addEventListener('pointermove', e => show(nearest(e.clientX)));
    // touch: the first tap shows a point, a second tap on the same point opens it
    let before = -1;
    wrap.addEventListener('pointerdown', e => { before = active; show(nearest(e.clientX)); });
    wrap.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && document.activeElement !== wrap) hide(); });
    wrap.addEventListener('click', e => {
      const i = nearest(e.clientX);
      show(i);
      if ((e as PointerEvent).pointerType !== 'touch' || i === before) open();
    });
    wrap.addEventListener('focus', () => { if (active < 0) show(n - 1); });
    wrap.addEventListener('blur', hide);
    wrap.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show((active < 0 ? n - 1 : active) + (e.key === 'ArrowRight' ? 1 : -1)); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(e.key === 'Home' ? 0 : n - 1); }
      else if (e.key === 'Enter') open();
      else if (e.key === 'Escape') hide();
    });
  }
  new ResizeObserver(() => {
    const w = Math.round(wrap.clientWidth);
    if (w && w !== width) { width = w; draw(); }
  }).observe(wrap);
  return wrap;
}

/** a thin single-series bar list (name · bar · value), longest first; for counts such as mistake categories */
export function rankedBars(rows: Array<{ label: string; value: number; title?: string }>, opts: { max?: number; unit?: (v: number) => string } = {}): HTMLElement {
  const max = opts.max ?? Math.max(1, ...rows.map(r => r.value));
  const unit = opts.unit ?? ((v: number) => String(v));
  return el('div', { class: 'rank-list' }, rows.map(r => el('div', { class: 'rank-row', title: r.title ?? `${r.label}: ${unit(r.value)}` },
    el('span', { class: 'rank-label' }, r.label),
    el('span', { class: 'rank-track' }, el('span', { class: 'rank-fill', style: { width: `${(r.value / max) * 100}%` } })),
    el('b', { class: 'rank-val' }, unit(r.value)))));
}
