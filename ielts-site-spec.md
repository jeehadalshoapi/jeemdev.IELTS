# ielts.jeemdev.net: what to add

What works now: tests, homework, attempts, auto-marking with answer keys, writing and speaking feedback with bands, progress per question type.

What's missing: the site holds tests only. It has nowhere to store lessons, vocabulary sets, the misspelled-words list or a study plan, and the MCP server has no tools to write them.

For each feature below: the data structure, the MCP tools Claude needs, and the screen it belongs on. Priority 1 covers the Writing Week (now). Priority 2 must be ready before Listening Week (Day 30). Priority 3 must be ready before Speaking Week (Day 37).

---

## Priority 1: needed this week

### 1. Lessons (Review Guide, Reading Summary, daily lessons)

**Where:** a new **Lessons** page in the nav, grouped by Week → Day, with search. Each lesson page links to its tests.

```json
{
  "id": "day23-band-6-7-8",
  "day": 23,
  "week": "writing",
  "title": "What separates band 6, 7 and 8",
  "skill": "writing",
  "kind": "lesson | reference",
  "summary": "One line shown in the list",
  "sections": [
    { "heading": "The one-line difference", "markdown": "…" },
    { "heading": "Band descriptors", "table": { "header": ["", "Band 6", "Band 7", "Band 8"], "rows": [["Task Response", "…", "…", "…"]] } },
    { "heading": "Same paragraph at three levels", "examples": [ { "label": "Band 6", "text": "…", "notes": ["…"] } ] },
    { "tip": "Box text shown highlighted (like the blue boxes in the Word files)" }
  ],
  "relatedTestIds": ["uuid"],
  "vocabularySetIds": ["set-3"]
}
```
- `kind: "reference"` is for permanent pages: Task 2 method (PEEL, the 2-lens brainstorm, CAST), T/F/NG rules, the phrase bank, the Task 1 language.
- **MCP tools:** `create_lesson`, `update_lesson`, `get_lesson`, `list_lessons({ week?, day?, skill? })`.

### 2. Vocabulary bank (10 sets now, more later)

**Where:** a **Vocabulary** page with one card per set and a set page offering three modes: **Table** (word · Arabic · meaning · opposite · example), **Flashcards** (hide Arabic and meaning, tap to reveal) and **Test me** (starts a quiz test, see 4).

```json
{
  "id": "set-3",
  "number": 3,
  "theme": "Good and bad effects",
  "studyDay": 23,
  "words": [
    {
      "word": "mitigate",
      "pos": "v",
      "arabic": "يخفف (من حدة)",
      "meaning": "make less severe",
      "opposite": "aggravate",
      "trap": "mitigate risks/effects; alleviate pain/poverty",
      "example": "Trees can mitigate the effects of heat.",
      "status": "new | learning | learned | weak",
      "timesMissed": 0
    }
  ]
}
```
Self-test log (the table at the end of the Word file):
```json
{ "setId": "set-1", "quiz": 1, "date": "2026-11-17", "score": 4, "total": 7, "weakWords": ["dwindle", "proliferate", "unprecedented"] }
```
- **Review rule** (from the Word file): every 5th day, show "Re-test Sets 1–N" on the dashboard.
- **MCP tools:** `upsert_vocab_set`, `list_vocab_sets`, `get_vocab_set`, `record_vocab_result`, `update_word({ setId, word, status?, timesMissed? })`.

### 3. Mistakes log (misspelled words, grammar slips, reading traps)

**Where:** a **My Mistakes** page with tabs for Spelling · Grammar · Capitals · Word choice · Reading traps. At the top, a "never again" banner with the 10 words. A **5-minute daily review** button hides the Correct column, has me type it, and asks for 3 practice entries when I'm wrong.

```json
{
  "id": "auto",
  "category": "spelling | grammar | capitals | word_choice | collocation | reading_trap",
  "wrong": "experiance",
  "correct": "experience",
  "rule": "experi-ence, like science and evidence.",
  "arabic": "optional",
  "source": { "date": "2026-11-16", "attemptId": "uuid or null", "label": "Two homework essays" },
  "timesWrong": 3,
  "neverAgain": true,
  "streak": 0,
  "status": "active | mastered"
}
```
- `streak` counts correct daily reviews in a row. When it reaches 3, set `status = mastered` (the "tick it ✓" rule).
- **Dedupe:** when the same `wrong → correct` pair is added again, increase `timesWrong` instead of creating a duplicate. At 2 or more, set `neverAgain = true` automatically.
- For reading traps, use `wrong` = my answer, `correct` = the right answer, `rule` = the lesson (e.g. "many ≠ most").
- **MCP tools:** `add_mistakes([...])` (bulk, with dedupe), `list_mistakes({ category?, status?, neverAgain? })`, `update_mistake`.
- Also let `save_feedback.mistakes[]` accept `"addToLog": true`, so marking an essay files its mistakes in one step.

### 4. Vocabulary quizzes without a passage

Right now a reading part *must* have a passage, so a plain vocabulary quiz can't be uploaded. (Today I wrapped the Set 3 quiz in a short passage, which is good practice but can't be used every day.)

Add `"skill": "vocabulary"` (or let parts skip `passage`). Allow the existing types `sentence_completion`, `short_answer`, `matching_features` and `mcq_single` in it. Two new types would also help:
- `definition_match`: word ↔ meaning (options = meanings)
- `opposite_match`: word ↔ opposite (trains the word-box near-opposite trap)

Optional: link the test to a set (`"vocabularySetId": "set-3"`), so the result is written to the self-test log and missed words are marked `weak` automatically.

### 5. Sentence rewrite / error correction

The repair task and the "8 sentences" homework currently go into one `paragraph` box. A dedicated type would let me mark each line separately.

```json
{
  "id": "w1",
  "type": "sentence_rewrite",
  "instructions": "Rewrite each sentence at band 7+.",
  "items": [
    { "id": "r1", "number": 1, "text": "Many graduates can not find job because of leak of experience." }
  ]
}
```
One answer box per item, with `answerKey.r1.modelAnswer` shown after marking. `save_feedback` needs per-item results: `{ "itemId": "r1", "correct": true, "comment": "…" }`.

### 6. Writing-page settings

- **`spellcheck="false"`** on every writing textarea. The real computer-delivered test has no spellcheck, and your "never again" words will only show if it's off.
- **Pause / resume** with a time log per block, because you study in 15-minute blocks. Store `blocks: [{ start, end, words }]` in the attempt and return it in `get_attempt`.
- A **plan box** above the essay for full Task 2 (`writing_task2` without `plan_intro`), so the plan and the essay are stored separately.

---

## Priority 2: before Listening Week (Day 30)

### 7. Images for maps, plans and diagrams

`map_labelling` and `diagram_labelling` need an `imageUrl`, and Claude can't upload images. Day 33 (maps, plans, flow charts) depends on this. Either:
- (a) add an `upload_asset` MCP tool that takes an SVG as text and returns a URL; **or**
- (b) let the site draw maps from data, like the Task 1 charts: `{ "mapType": "grid", "cells": [{ "label": "A", "x": 2, "y": 1 }], "features": [{ "name": "Main entrance", "x": 0, "y": 3 }] }`.

(a) is simpler and also covers Reading diagrams.

### 8. Study plan and "Today" dashboard

```json
{
  "days": [
    {
      "day": 24,
      "date": "2026-11-18",
      "title": "Task Response: thesis precision",
      "skill": "writing",
      "blocks": [
        { "id": "d24b1", "title": "Set 3 quiz", "minutes": 12, "testId": "uuid", "status": "todo | done | skipped" },
        { "id": "d24b2", "title": "Lesson: answering the exact question", "minutes": 15, "lessonId": "…" }
      ]
    }
  ]
}
```
The dashboard shows "Today: Day 24, 3 of 5 blocks done", plus the pending homework from earlier days.
- **MCP tools:** `set_plan`, `get_plan`, `update_block({ id, status })`.

### 9. Listening exam mode

Check that the text-to-speech plays the transcript **once** with no pause control in exam mode, and adds a short reading pause before each section ("You now have 30 seconds to look at questions 11–20"). Supporting `[pause 30]` in the transcript would cover this.

---

## Priority 3: before Speaking Week (Day 37)

### 10. Speaking transcripts

Claude can't listen to audio. `get_attempt` needs a **transcript** of each recording (the browser's SpeechRecognition API, or Whisper on your VPS), plus the length in seconds and the number of pauses longer than 3 seconds. Without this, speaking can only be marked from typed notes.

---

## Once the tools exist

Tell me, and I'll move everything from the four Word files onto the site:
- Vocabulary Bank: 10 sets, 100 words, plus the self-test results so far
- Misspelled Words: about 120 entries, with the 10 "never again" words flagged
- Review Guide and Reading Week Summary: reference lessons
- The Day 23 lesson (band 6/7/8), then each new lesson from Day 24 on
