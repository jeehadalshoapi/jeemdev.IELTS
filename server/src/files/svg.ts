/*
 * SVG from Claude (upload_asset, Phase 10). SVG can carry scripts, so it is never stored as sent: it is parsed and
 * rebuilt from an allowlist of drawing elements and attributes. Anything else (script, foreignObject, image, style
 * elements, event handlers, external links, entities) is dropped or refused. The file is also served with a
 * sandbox CSP (see /files/:id) and the pages show it with <img>, which never runs scripts.
 */

export class SvgError extends Error {}

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'marker', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'pattern', 'symbol', 'use'
]);
/** elements dropped together with everything inside them */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'image', 'a', 'animate', 'set', 'animatetransform', 'animatemotion', 'handler', 'listener']);
const ATTRIBUTES = new Set([
  'id', 'class', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'opacity', 'transform', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift',
  'letter-spacing', 'word-spacing', 'text-decoration', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'fx', 'fy', 'patternunits', 'patterncontentunits', 'patterntransform',
  'markerwidth', 'markerheight', 'markerunits', 'refx', 'refy', 'orient', 'marker-start', 'marker-mid', 'marker-end',
  'preserveaspectratio', 'xmlns', 'xmlns:xlink', 'version', 'href', 'xlink:href', 'clip-path', 'clippathunits', 'clip-rule',
  'visibility', 'display', 'style', 'role', 'aria-label', 'vector-effect', 'paint-order', 'shape-rendering', 'text-rendering', 'color'
]);
/** style properties kept in a style="" attribute */
const STYLE_PROPS = new Set([...ATTRIBUTES].filter(a => a.includes('-') || ['fill', 'stroke', 'opacity', 'display', 'visibility', 'color'].includes(a)));

const MAX_BYTES = 400 * 1024;

/** a value is unsafe if it could run code or fetch anything outside the file (only url(#id) is allowed) */
function unsafeValue(v: string): boolean {
  const s = v.toLowerCase().replace(/\s+/g, '');
  if (/javascript:|vbscript:|data:|expression\(|@import|behavior:|-moz-binding|<|>/.test(s)) return true;
  for (const m of s.matchAll(/url\(([^)]*)\)/g)) if (!/^['"]?#[a-z0-9_-]+['"]?$/.test(m[1] ?? '')) return true;
  return false;
}

const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
  const k = e.toLowerCase();
  if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
});
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

function cleanStyle(v: string): string {
  return v.split(';').map(d => d.trim()).filter(Boolean).filter(d => {
    const [prop, ...rest] = d.split(':');
    return prop && rest.length && STYLE_PROPS.has(prop.trim().toLowerCase()) && !unsafeValue(rest.join(':'));
  }).join('; ');
}

/** returns a clean SVG document, or throws SvgError with the reason */
export function sanitizeSvg(input: string): { svg: string; removed: string[] } {
  if (Buffer.byteLength(input, 'utf8') > MAX_BYTES) throw new SvgError(`The SVG is larger than ${MAX_BYTES / 1024} KB.`);
  let src = input.trim().replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new SvgError('DOCTYPE and ENTITY declarations are not allowed in the SVG.');
  if (/<!\[CDATA\[/i.test(src)) throw new SvgError('CDATA sections are not allowed in the SVG.');
  src = src.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/^<svg[\s>]/i.test(src)) throw new SvgError('The text must be one SVG document starting with <svg …>.');

  const removed = new Set<string>();
  const out: string[] = [];
  const stack: Array<{ name: string; kept: boolean }> = [];
  let dropDepth = 0;
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, closing, rawName, attrText, selfClose, text, stray] = m;
    if (stray) throw new SvgError('The SVG is not well formed (a stray "<").');
    if (text !== undefined) {
      if (!dropDepth && stack.length && stack[stack.length - 1]!.kept) out.push(escText(decode(text)));
      continue;
    }
    const name = rawName!.toLowerCase();
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new SvgError(`The SVG is not well formed (</${rawName}> does not close the open element).`);
      if (DROP_WITH_CONTENT.has(name)) { dropDepth--; continue; }
      if (!dropDepth && top.kept) out.push(`</${rawName}>`);
      continue;
    }
    const keep = !dropDepth && ELEMENTS.has(name);
    if (DROP_WITH_CONTENT.has(name) || !ELEMENTS.has(name)) removed.add(`<${name}>`);
    if (!selfClose) {
      stack.push({ name, kept: keep });
      if (DROP_WITH_CONTENT.has(name)) dropDepth++;
    }
    if (!keep) continue;
    const attrs: string[] = [];
    for (const a of (attrText ?? '').matchAll(/([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const an = a[1]!, lower = an.toLowerCase();
      let value = decode(a[3] ?? a[4] ?? a[5] ?? '');
      if (!ATTRIBUTES.has(lower)) { removed.add(lower.startsWith('on') ? 'event handlers (on…)' : `attribute ${lower}`); continue; }
      if (lower === 'href' || lower === 'xlink:href') { if (!/^#[A-Za-z0-9_-]+$/.test(value.trim())) { removed.add('links outside the drawing'); continue; } }
      else if (lower === 'xmlns' || lower === 'xmlns:xlink') { value = lower === 'xmlns' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xlink'; }
      else if (lower === 'style') { value = cleanStyle(value); if (!value) continue; }
      else if (unsafeValue(value)) { removed.add(`unsafe value in ${lower}`); continue; }
      attrs.push(`${an}="${escAttr(value)}"`);
    }
    if (name === 'svg' && stack.length <= 1 && !attrs.some(a => a.startsWith('xmlns='))) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    out.push(`<${rawName}${attrs.length ? ` ${attrs.join(' ')}` : ''}${selfClose ? '/' : ''}>`);
  }
  if (stack.length) throw new SvgError(`The SVG is not well formed (<${stack[stack.length - 1]!.name}> is never closed).`);
  const svg = out.join('').trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) throw new SvgError('The SVG must be a single <svg> … </svg> element.');
  if (!/viewBox=|width=/.test(svg.slice(0, 400))) throw new SvgError('The <svg> needs a viewBox (e.g. viewBox="0 0 600 400") so it can scale.');
  return { svg, removed: [...removed] };
}
