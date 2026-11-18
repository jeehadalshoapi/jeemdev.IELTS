/* Listening without a recording: the transcript is read aloud by the browser (spec §4 "Listening audio"). */
import type { Part } from './schema/test';

export interface SpeechLine {
  /** "Narrator", "Woman", "Tom"… (null when the transcript has no speaker label) */
  speaker: string | null;
  text: string;
}

/** "WOMAN: Good morning." / "**Tom:** Hi" — a label of up to four words before a colon */
const SPEAKER_RE = /^([A-Z][A-Za-z0-9.'’-]*(?: [A-Za-z0-9.'’-]+){0,3})\s*:\s+(.+)$/;
const NOT_SPEAKERS = /^(note|notes|example|answer|time|date|address|tel|phone|email|http|https)$/i;
/** browsers cut off very long utterances, so speak in chunks of about this many characters */
const MAX_CHUNK = 220;

function chunks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  const push = (s: string) => {
    if (s.length <= MAX_CHUNK) { out.push(s); return; }
    // a very long sentence: break at commas, then at spaces
    let rest = s;
    while (rest.length > MAX_CHUNK) {
      const cut = Math.max(rest.lastIndexOf(', ', MAX_CHUNK), rest.lastIndexOf(' ', MAX_CHUNK));
      const at = cut > 40 ? cut + 1 : MAX_CHUNK;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  };
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > MAX_CHUNK) { push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) push(cur);
  return out;
}

/** split a transcript into what each speaker says, in order, ready for speech synthesis */
export function speechLines(transcript: string): SpeechLine[] {
  const out: SpeechLine[] = [];
  let speaker: string | null = null;
  for (const raw of transcript.split(/\r?\n/)) {
    const line = raw
      .replace(/\[[^\]]*\]/g, ' ')     // stage directions: [pause], [phone rings]
      .replace(/\*\*|__|\*/g, '')        // markdown emphasis
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    const m = line.match(SPEAKER_RE);
    let text = line;
    if (m && !NOT_SPEAKERS.test(m[1]!.split(' ')[0]!)) { speaker = m[1]!.trim(); text = m[2]!.trim(); }
    for (const c of chunks(text)) out.push({ speaker, text: c });
  }
  return out;
}

/**
 * Parts whose transcript the browser reads aloud: listening parts with no recording of their own
 * and no earlier listening part whose recording plays on (one recording for the whole test).
 */
export function speechPartIds(parts: readonly Part[], sectionOf: (p: Part) => string | undefined): string[] {
  const out: string[] = [];
  let recording = false;
  for (const p of parts) {
    if (sectionOf(p) !== 'listening') continue;
    if (p.audioUrl) { recording = true; continue; }
    if (!recording) out.push(p.id);
  }
  return out;
}
