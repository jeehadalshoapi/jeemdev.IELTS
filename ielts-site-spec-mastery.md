# ielts.jeemdev.net: additions for mastery practice

Each day now has three sections: **1 Daily review · 2 Main lesson + homework · 3 Mastery practice**. A mastery step repeats until it is passed (band 7+ or 90%+ on 2 attempts in a row), and then the next step in the same ladder unlocks.

The site can't do this yet, so for now I'm tracking it on the "Mastery practice" reference page and putting "1 · / 2 · / 3 ·" at the start of each block title. Here's what would make it automatic.

---

## 1. Mastery ladders: the main feature

**Where:** a **Mastery** card on the dashboard, with one row per ladder:
`W Writing — W1 Introduction ●○ (1 of 2 passes) → W2 Body …`, and a full page at `#/mastery`.

```json
{
  "id": "w1-introduction",
  "ladder": "W",
  "ladderTitle": "Writing, one part at a time",
  "order": 1,
  "title": "W1 Introduction",
  "task": "5-min plan + 2-sentence introduction",
  "lessonId": "day24-task-response",
  "passRule": { "minBand": 7, "inARow": 2 },
  "status": "locked | active | passed | recheck",
  "attempts": [
    { "attemptId": "uuid", "date": "2026-11-22", "band": 6.5, "passed": false }
  ]
}
```
- `passRule` is either `{ "minBand": 7, "inARow": 2 }` for writing and speaking, or `{ "minPercent": 90, "inARow": 2 }` for objective tests.
- **Linking:** add an optional `"masteryStepId": "w1-introduction"` field to a test. When that test's attempt is scored (auto-marked tests) or gets feedback (`save_feedback` with `overallBand`), the site adds the result to the step's `attempts`. When the pass rule is met, it sets `status = passed` and unlocks the next step in the ladder.
- `recheck`: I set this when a passed skill slips in a full test. The step comes back for one more pass.
- **MCP tools:** `upsert_mastery_step`, `list_mastery({ ladder? })`, `get_mastery_step`, `update_mastery_step({ id, status? })`.

Ladders I'll create right away: **W** (W1–W6), **S** (S1–S3), **V** (one step per set), **R** (R1–R3). **L** and **P** follow in Weeks 3 and 4. The full list is on the "Mastery practice" lesson page.

## 2. Plan blocks: a `section` field

Add `"section": "review" | "main" | "mastery"` to plan blocks. The dashboard then groups today's blocks under three headings (Daily review · Main lesson + homework · Mastery practice) instead of one list.

## 3. Dictation question type (for spelling step S1)

It works now as a listening transcript plus note completion, but the transcript plays only once, start to finish. A dedicated type would be better:

```json
{
  "id": "g1",
  "type": "dictation",
  "instructions": "Type the word you hear.",
  "items": [
    { "id": "s1", "number": 1, "say": "experience", "sentence": "Many graduates lack practical experience." }
  ]
}
```
Each item gets a ▶ button that reads `sentence` and then `say` (browser text-to-speech), with **a maximum of 2 plays** and a text box. Marking stays the normal strict-spelling check against `answerKey.s1.accept`.

## 4. Sentence-rewrite type (if not added yet)

This is for S2 (CAST correction) and small writing repairs: one answer box per numbered sentence, with `answerKey.<id>.modelAnswer`, plus a per-item result in `save_feedback`. Same structure as in the first spec. If it's already on the site, tell me and I'll start using it.
