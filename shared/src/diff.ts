/*
 * Word-level diff, used on the results page to show Claude's corrected text next to the student's answer:
 * removed words are marked on the student's side, added words on the corrected side.
 * Words are compared exactly (case and punctuation count: "however" vs "However," is a change).
 */

export interface DiffPiece { text: string; changed: boolean }
export interface WordDiff {
  /** the original text, with the words Claude removed or changed marked */
  before: DiffPiece[];
  /** the corrected text, with the words Claude added or changed marked */
  after: DiffPiece[];
  removed: number;
  added: number;
}

interface Token { ws: string; word: string }

function tokenize(s: string): { tokens: Token[]; tail: string } {
  const tokens: Token[] = [];
  const re = /(\s*)(\S+)/g;
  let m: RegExpExecArray | null;
  let end = 0;
  while ((m = re.exec(s))) { tokens.push({ ws: m[1] ?? '', word: m[2] ?? '' }); end = re.lastIndex; }
  return { tokens, tail: s.slice(end) };
}

/** joins tokens into pieces; whitespace before a changed run stays outside the mark */
function piecesOf(tokens: Token[], kept: boolean[], tail: string): DiffPiece[] {
  const out: DiffPiece[] = [];
  const push = (text: string, changed: boolean) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += text;
    else out.push({ text, changed });
  };
  tokens.forEach((t, i) => {
    if (kept[i]) push(t.ws + t.word, false);
    else if (out[out.length - 1]?.changed) push(t.ws + t.word, true);
    else { push(t.ws, false); push(t.word, true); }
  });
  push(tail, false);
  return out;
}

/**
 * Longest-common-subsequence diff over words. Returns null when the texts are too long to compare
 * quickly (more than `maxCells` word pairs after the shared start and end are set aside).
 */
export function wordDiff(a: string, b: string, maxCells = 4_000_000): WordDiff | null {
  const A = tokenize(a), B = tokenize(b);
  const n0 = A.tokens.length, m0 = B.tokens.length;
  let pre = 0;
  while (pre < n0 && pre < m0 && A.tokens[pre]!.word === B.tokens[pre]!.word) pre++;
  let suf = 0;
  while (suf < n0 - pre && suf < m0 - pre && A.tokens[n0 - 1 - suf]!.word === B.tokens[m0 - 1 - suf]!.word) suf++;
  const a2 = A.tokens.slice(pre, n0 - suf), b2 = B.tokens.slice(pre, m0 - suf);
  const n = a2.length, m = b2.length;
  if (n * m > maxCells) return null;

  // L[i][j] = LCS length of a2[i..] and b2[j..]
  const W = m + 1;
  const L = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = a2[i]!.word === b2[j]!.word ? L[(i + 1) * W + j + 1]! + 1 : Math.max(L[(i + 1) * W + j]!, L[i * W + j + 1]!);
    }
  }
  const keptA = Array<boolean>(n0).fill(true), keptB = Array<boolean>(m0).fill(true);
  for (let i = 0; i < n; i++) keptA[pre + i] = false;
  for (let j = 0; j < m; j++) keptB[pre + j] = false;
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a2[i]!.word === b2[j]!.word) { keptA[pre + i] = true; keptB[pre + j] = true; i++; j++; }
    else if (L[(i + 1) * W + j]! >= L[i * W + j + 1]!) i++;
    else j++;
  }
  return {
    before: piecesOf(A.tokens, keptA, A.tail),
    after: piecesOf(B.tokens, keptB, B.tail),
    removed: keptA.filter(k => !k).length,
    added: keptB.filter(k => !k).length
  };
}
