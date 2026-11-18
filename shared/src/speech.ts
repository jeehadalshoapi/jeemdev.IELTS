/* Listening without a recording: the transcript is read aloud by the browser (spec §4 "Listening audio"). */
import type { Part } from './schema/test';

export interface SpeechLine {
  /** "Narrator", "Woman", "Tom"… (null when the transcript has no speaker label) */
  speaker: string | null;
  text: string;
  /** a silence of this many seconds instead of speech ("[pause 30]" in the transcript, or the reading time) */
  pauseSec?: number;
}

/** "[pause 30]", "[pause: 30s]", "[30 second pause]", "[silence 10 seconds]", "[pause]" (5 s) */
const PAUSE_RE = /\[\s*(?:(?:pause|silence)\s*:?\s*(\d{1,3})?\s*(?:s|sec|secs|seconds?)?|(\d{1,3})\s*(?:s|sec|secs|seconds?)?\s*(?:pause|silence))\s*\]/gi;
export const DEFAULT_READING_TIME_SEC = 30;

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
  for (const full of transcript.split(/\r?\n/)) {
    // a pause marker splits the line: speech, silence, speech
    const pieces = full.split(PAUSE_RE);
    for (let k = 0; k < pieces.length; k += 3) {
      if (k > 0) {
        const sec = Number(pieces[k - 2] ?? pieces[k - 1] ?? '') || 5;
        out.push({ speaker, text: '', pauseSec: Math.min(120, sec) });
      }
      const piece = pieces[k] ?? '';
      if (piece.trim()) speaker = addLine(out, piece, speaker);
    }
  }
  return out;
}

function addLine(out: SpeechLine[], raw: string, speaker: string | null): string | null {
  {
    const line = raw
      .replace(/\[[^\]]*\]/g, ' ')     // stage directions: [pause], [phone rings]
      .replace(/\*\*|__|\*/g, '')        // markdown emphasis
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) return speaker;
    const m = line.match(SPEAKER_RE);
    let text = line;
    if (m && !NOT_SPEAKERS.test(m[1]!.split(' ')[0]!)) { speaker = m[1]!.trim(); text = m[2]!.trim(); }
    for (const c of chunks(text)) out.push({ speaker, text: c });
  }
  return speaker;
}

/**
 * What the browser reads for one part: first the reading time ("You now have 30 seconds to look at questions 11 to 20",
 * then a silence) unless the part sets readingTimeSec: 0 or the transcript already starts with it, then the transcript.
 */
export function partSpeech(part: Part, numbers: number[]): SpeechLine[] {
  const lines = speechLines(part.transcript ?? '');
  const sec = part.readingTimeSec ?? DEFAULT_READING_TIME_SEC;
  if (!sec || !numbers.length || /^you (now )?have \d+ seconds/i.test(lines[0]?.text ?? '')) return lines;
  const lo = Math.min(...numbers), hi = Math.max(...numbers);
  const intro = `You now have ${sec} seconds to look at question${lo === hi ? ` ${lo}` : `s ${lo} to ${hi}`}.`;
  return [{ speaker: null, text: intro }, { speaker: null, text: '', pauseSec: sec }, ...lines];
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
