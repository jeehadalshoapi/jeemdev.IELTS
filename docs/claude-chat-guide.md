# How to organise my IELTS site (ielts.jeemdev.net)

Please follow these rules every time you add or change something on my site through the connector. First, save this whole guide on the site as a reference page with `create_lesson`: id `ref-site-organization`, kind `reference`, skill `general`, title "How the site is organised". Read it again with `get_lesson` whenever you're unsure.

## 1. Every study day has three sections

Each plan day (`set_plan`) has its blocks in this order, each with a `section`:

| section | What | Time |
|---|---|---|
| `review` | My Mistakes review (never-again first), then quiz yesterday's set and study today's set | 10–15 min |
| `main` | Today's lesson, then its homework | 15–30 min |
| `mastery` | ONE small task for my current step in a ladder | 10–15 min |

- Use the `section` field. Don't start titles with "1 ·", "2 ·" or "3 ·": the site prints the section headings itself.
- Block ids are `d<day>b<n>` (`d25b1`, `d25b2` …). Never reuse an id.
- Full-test days (mocks) can have only `main` blocks, plus `review`.
- When a test or lesson for a block exists, put its `testId` / `lessonId` / `vocabularySetId` on the block. A block with a `testId` is ticked by itself when I submit that test. A block without a site task needs a clear `note` saying what to do.
- **Set re-tests go on days 25, 30, 35, 40 and 45.** The site shows "re-test Sets …" on every day divisible by 5. Put the re-test block (section `review`) on those days, not on other days.

## 2. Names and ids

| Thing | Id | Title |
|---|---|---|
| Lesson | `day<N>-<topic>` e.g. `day25-cohesion` | the topic |
| Reference page | `ref-<topic>` e.g. `ref-writing-task2` | the topic |
| Vocabulary set | `set-<N>` (number = N) | theme |
| Main homework test | — | `Day <N> · <what>` |
| Mastery test | — | `Mastery <step> #<attempt> · <what>`, e.g. `Mastery W1 #2 · Plan + introduction` |
| Review / vocabulary quiz | — | `Review · Set <N> quiz` |
| Full test | — | `Mock · <what>` |

Test `kind`: homework = the `main` section, practice = `mastery` and `review`, full_mock = full tests. Only homework gets a `dueDate` (the plan day's date). Mastery tests have no due date, because they repeat until passed.

## 3. Mastery ladders (the site does the counting)

Create the steps with `upsert_mastery_step` (several at once with `steps: [...]`). Step ids:

| Ladder | Steps (id: title) | passRule |
|---|---|---|
| W Writing, one part at a time | `w1-introduction`: W1 Introduction · `w2-body`: W2 Body paragraph · `w3-skeleton`: W3 Essay skeleton · `w4-task2`: W4 Full Task 2 · `w5-task1-overview`: W5 Task 1 overview · `w6-task1`: W6 Full Task 1 | `{ "minBand": 7, "inARow": 2 }` |
| S Spelling and accuracy | `s1-never-again`: S1 Never-again words · `s2-cast`: S2 CAST correction · `s3-collocations`: S3 Collocations | `{ "minPercent": 90, "inARow": 2 }` |
| V Vocabulary sets | `v-set-<N>`: V Set N (order = N), one step per set | `{ "minPercent": 90, "inARow": 2 }` |
| R Reading precision | `r1-word-box` · `r2-tfng` · `r3-completion` | `{ "minPercent": 85, "inARow": 2 }` (7/8 ≈ 87%) |
| L Listening (from Day 30) | `l1-forms` · `l2-maps` · `l3-mcq` · `l4-notes` | `{ "minPercent": 85, "inARow": 2 }` |
| P Speaking (from Day 37) | `p1-part1` · `p2-part2` · `p3-part3` | `{ "minBand": 7, "inARow": 2 }` |

Give each step its `task` (the small task) and, where there is one, its `lessonId`.

**Each mastery attempt is a new test** with the step's `masteryStepId` (a new prompt, new sentences or new words, so I never just remember the answers). Name it with `#<attempt>`. The site then does the rest:

- an auto-marked test counts when I submit it;
- a writing or speaking test counts when you call `save_feedback` with an `overallBand`;
- for a sentence-rewrite step (S2), give every item `"correct": true/false` in `save_feedback.items`, and the site counts the percentage.

When the rule is met, the step is passed and the next step opens on its own. Don't track this by hand. The Mastery page and `list_mastery` are the only record (so remove the "My current steps" table from `ref-mastery` and link to the Mastery page instead).

The dashboard shows only the newest test of each open step, so always create the next attempt's test before the plan day that needs it.

- **V steps:** a vocabulary quiz has both `vocabularySetId` and `masteryStepId`.
- **S1:** use the `dictation` question type (skill `vocabulary`, see `get_test_format`), 15 words in sentences, `accept` = the exact spelling.
- **Stuck rule:** if `get_mastery_step` shows 4 attempts without a pass, change the method (a mini-lesson, a different task type) instead of repeating.
- **Recheck:** after a full test or mock, if a passed skill slips there, call `update_mastery_step` with `status: "recheck"`. The step comes back for one more pass.
- **Mastery blocks in the plan:** section `mastery`, title `Mastery <step> #<n>`, and the `testId` once the test exists.

## 4. Marking

- Mark with `get_latest_attempt` / `get_attempt`, then `save_feedback`. Always give `overallBand` for writing and speaking (otherwise the mastery step can't count it).
- Put spelling, grammar and collocation slips in `mistakes` with `"addToLog": true`, so they reach My Mistakes. Never-again words are what S1 dictations are made from.
- Use `update_word` / `record_vocab_result` only for flashcard self-tests done outside the site. Quizzes on the site log themselves.

## 5. One-time clean-up (do this once, now)

1. Create ladders W, S, V (sets 3–10), R with `upsert_mastery_step`. Set the steps I've already passed to `passed`; the first open one becomes active by itself.
2. Link the existing tests with `update_test`:
   - "Mastery S1 · Spelling dictation: never-again words #1" → `masteryStepId: "s1-never-again"`, title `Mastery S1 #1 · Never-again words`;
   - "Day 24 · Plan + introduction drill (15 min)" → `masteryStepId: "w1-introduction"`, title `Mastery W1 #1 · Plan + introduction`, kind `practice`, no dueDate.
3. Rewrite Days 24–45 of the plan with `set_plan`:
   - `section` on every block, and no "1 ·" title prefixes;
   - blocks in the order review → main → mastery;
   - the "Maintenance" blocks of Days 30–43 become `mastery` blocks for my current W step;
   - re-tests moved to Days 25, 30, 35, 40, 45.
   Keep the block ids and their status.
4. Update `ref-mastery` as described in section 3.
5. Tell me what changed, in a short list.
