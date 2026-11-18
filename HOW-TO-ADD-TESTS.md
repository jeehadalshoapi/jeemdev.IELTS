# How to add tests

There are three ways to put a test on the site:

| Way | Best for | How |
|---|---|---|
| **1. Claude, through the connector** | Everyday homework and drills | In claude.ai (with the connector on): "Upload this reading homework to my site". Setup: README → *The Claude connector*. |
| **2. Import box: JSON** | A test Claude wrote in a chat without the connector | **Tests → ＋ Import a test**, paste the JSON |
| **3. Import box: text format** | Whole tests from a book or PDF | **Tests → ＋ Import a test**, paste the text (format below) |

Tests from the old browser-only site come in with `npm run db:import-legacy -- export.json` (its "Export all" file).

---

## The import box

1. Open **Tests → ＋ Import a test** (or `#/import`).
2. **Paste the test** in the box. It can be:
   - **JSON** that Claude wrote. Copying the whole chat answer is fine: if the JSON is inside a ` ```json ` block, the box takes what is inside.
   - The **text format** below. You can also drop a `.txt` file on the page.
3. If the test names **audio or pictures** (`AUDIO: part1.mp3`, `IMAGE: map.png`, or `"audioUrl": "part1.mp3"` in JSON), press **📎 Attach audio / pictures** and choose those files, or drop them on the page. File names match without regard to capital letters. Limits: 100 MB per recording (MP3, M4A, WAV, OGG, WEBM, FLAC), 10 MB per picture (PNG, JPG, GIF, WEBP).
4. Press **Check** (or **Ctrl+Enter**). You get one of these:
   - **✗ problems to fix.** Every problem is listed at once, with where it is (*line 14 · Part 1 › group 2 (MATCHING HEADINGS) › question 9*) and what is wrong. **Copy list** copies them so you can paste them to Claude ("fix these").
   - **✓ Ready to save**, with a summary: each part, its question numbers and types, the time limit and how many questions have an answer. Read it before you save.
   - **Warnings** don't stop the save (for example: a test with the same title already exists, or a line was ignored).
5. Press **Save test**. It appears on the dashboard. **Save test** works only after a successful check of the exact text and files on screen.

For a text-format test, **The test as JSON** shows what the text turned into, answers included.

### Archiving
**Tests** lists every test. **Archive** hides a test from the dashboard; its attempts and results stay. Tick **Show archived** and press **Restore** to bring it back. Tests are never deleted.

### Checking a file without the website
```bash
npm run validate -- my-test.txt      # or my-test.json
```
It prints the same problems and warnings as the import box. File names are not checked here.

---

## The text format

A test file has three levels:

```
TITLE: …            ← 1. test details at the top
MODULE: …

=== PASSAGE 1 ===   ← 2. a passage / part / task starts with === … ===
TEXT:
…

--- TRUE FALSE NOT GIVEN ---   ← 3. a question group starts with --- … ---
QUESTIONS:
…
```

**Rules**
- A line like `KEY:` starts a section. The text after it, including the following lines, belongs to that section until the next `KEY:`, `===` or `---` line. Inside long texts (`TEXT:`, `PROMPT:`, `TRANSCRIPT:`…) only an UPPER-CASE key starts a new section, so a line like `Name: Sarah` in a form stays part of the text.
- Lines starting with `//` are comments and are ignored.
- **Question numbers are added automatically.** Numbers you write (`1.`, `2)`, `14`) are just for your own reference. They can be wrong or missing.
- The answer goes **after a `|`** at the end of the question line: `The museum opened in 1990. | FALSE`

### 1. Test details (top of the file)

```
TITLE: Cambridge 18 — Test 1 Reading
MODULE: Reading              ← Reading, Listening or Writing
TYPE: Academic               ← Academic or General Training (sets the band table; not needed for Listening)
TIME: 60                     ← minutes on the clock; "TIME: none" for no countdown (default: 60 / 35 / 60)
KIND: Homework               ← optional: Homework, Practice (default) or Full mock
DUE: 2026-11-30              ← optional due date, shown on the dashboard
DESCRIPTION: optional note shown before the test starts
```

A text file holds one module. A full mock with several sections (for example Listening + Reading + Writing in one test) needs the JSON format (`"skill": "mixed"`).

### 2. Passages, parts and tasks

**Reading**
```
=== PASSAGE 1 ===
TITLE: The History of Glass
TEXT:
[A] First paragraph. Leave an empty line between paragraphs.

[B] Second paragraph.

## A sub-heading (optional)

A paragraph without a letter is fine too.
```
- `[A]`, `[B]`… at the start of a paragraph shows the paragraph letter. Use these only if the passage has them.
- `**bold**` and `*italic*` work in passages, questions and instructions.

**Listening**
```
=== PART 1 ===
AUDIO: part1.mp3             ← the audio file's name (attach it in the import box)
TRANSCRIPT:
optional — shown only after you finish
```
- If you have **one audio file for the whole test**, write `AUDIO:` only in Part 1. The recording plays on through the later parts.
- A part with no recording (and none earlier) needs a `TRANSCRIPT:`. The browser will read it aloud (Phase 6).

**Writing**
```
=== TASK 1 ===
MIN WORDS: 150
IMAGE: chart.png             ← optional picture (attach it in the import box)
PROMPT:
You should spend about 20 minutes on this task.
…
MODEL ANSWER:
optional — shown only after you finish
```
The first task becomes Writing Task 1, the others Task 2.

### 3. Question groups

Every group can have these optional lines:

```
INSTRUCTIONS:
Choose NO MORE THAN TWO WORDS from the passage for each answer.
TITLE: a title shown above the questions (e.g. List of Headings)
IMAGE: diagram.png
```
- If you leave out `INSTRUCTIONS:`, standard IELTS instructions for that question type are used.
- A word limit in the instructions (`NO MORE THAN TWO WORDS AND/OR A NUMBER`, `ONE WORD ONLY`) becomes the group's word limit: a longer answer is marked wrong, as in the real test. The check also refuses an answer key whose answers break the limit.

The name after `---` tells the site the question type. Any of these names work:

| Write after `---` | Question type |
|---|---|
| `TRUE FALSE NOT GIVEN` | True / False / Not Given |
| `YES NO NOT GIVEN` | Yes / No / Not Given |
| `MULTIPLE CHOICE` | Multiple choice, one answer |
| `CHOOSE TWO` / `CHOOSE THREE` | Multiple choice, several answers |
| `MATCHING`, `MATCHING HEADINGS`, `MATCHING INFORMATION`, `MATCHING FEATURES`, `MATCHING SENTENCE ENDINGS`, `MAP LABELLING` (letters) | Matching / drag and drop |
| `COMPLETION`, `SENTENCE COMPLETION`, `SUMMARY COMPLETION`, `NOTE COMPLETION`, `TABLE COMPLETION`, `FORM COMPLETION`, `FLOW-CHART COMPLETION`, `DIAGRAM LABELLING` | Gap filling |
| `SHORT ANSWER` | Short-answer questions |

#### True / False / Not Given  ·  Yes / No / Not Given
```
--- TRUE FALSE NOT GIVEN ---
QUESTIONS:
1. The first glass was made in Egypt. | TRUE
2. Glass was expensive in Roman times. | FALSE
3. The Romans exported glass to China. | NOT GIVEN
```
Short answers also work: `T`, `F`, `NG`, `Y`, `N`.

#### Multiple choice: one answer
```
--- MULTIPLE CHOICE ---
QUESTIONS:
4. Why did the Romans use glass?
A. for decoration
B. for windows
C. for trade
D. for medicine
ANSWER: B

5. Next question…
A. …
B. …
C. …
ANSWER: A
```

#### Multiple choice: choose TWO or THREE
```
--- CHOOSE TWO ---
QUESTIONS:
6. Which TWO advantages of glass does the writer mention?
A. it is cheap
B. it is strong
C. it is clear
D. it is light
E. it is easy to recycle
ANSWER: C, E
```
Each correct letter counts as one question, so this question uses numbers 6 and 7.

#### Matching (headings, information, features, sentence endings, map letters)
```
--- MATCHING HEADINGS ---
TITLE: List of Headings
OPTIONS:
i. The origins of glass
ii. A Roman innovation
iii. Glass in modern buildings
iv. The cost of production
QUESTIONS:
8. Paragraph A | i
9. Paragraph B | ii
10. Paragraph C | iii
```
- Options can be labelled `i. ii. iii.`, `A. B. C.` or `1. 2. 3.`. For paragraph letters only, write one letter per line:
  ```
  OPTIONS:
  A
  B
  C
  ```
- Add `REUSE: yes` if an option can be used more than once ("You may use any letter more than once").
- For **map labelling** in Listening, add `IMAGE: map.png` and use letters as options.

#### Completion (sentence, summary, notes, table, form, flow-chart, diagram)
Write the text and put **each answer in double square brackets**. Each `[[ ]]` becomes a numbered gap.
```
--- SUMMARY COMPLETION ---
INSTRUCTIONS:
Complete the summary below. Choose ONE WORD ONLY from the passage for each answer.
TITLE: How glass is made
TEXT:
Glass is made by heating [[sand]] to a very high temperature.
It was first used for [[windows / glazing]] by the Romans.
```

Inside `TEXT:` you can also lay things out:
```
# Heading of the notes
- a bullet point with a [[gap]]
Column 1 | Column 2 | Column 3        ← a line with | is a table row (first row = header)
Mon      | [[£15]]  | museum
> first box of a flow-chart
> second box with a [[gap]]          ← lines starting with "> " are flow-chart boxes
```

**Completion with a word bank** (the answers are letters chosen from a list):
```
--- SUMMARY COMPLETION ---
TEXT:
The method was [[C]] and quite [[A]] to use.
OPTIONS:
A. simple
B. expensive
C. effective
D. dangerous
```

#### Short-answer questions
```
--- SHORT ANSWER ---
QUESTIONS:
11. In which year did the factory open? | 1998
12. Who paid for the research? | (the) government
```

---

## Writing answers so the marking is fair

| You write | Accepted answers |
|---|---|
| `colour / color` | colour, color |
| `(the) river` | the river, river |
| `(a) deposit / down payment` | a deposit, deposit, down payment |
| `1998` | 1998 |
| `1,000` | 1,000 and 1000 |

Capital letters, extra spaces and a final full stop are ignored. Spelling counts: a misspelled answer is wrong (the results page labels it as spelling).

---

## Turning a PDF into a test quickly

**By hand:** copy the passage from the PDF and paste it after `TEXT:`. Then copy the questions under `QUESTIONS:` and add `| answer` from the answer key.

**With Claude:** paste the PDF text and the answer key, and ask for one of these:
- *"Convert this into the text format below."* Then paste the contents of `templates/example-reading-urban-beekeeping.txt` as the example. This works today.
- With the connector on: *"Upload this as a test to my IELTS site."* Claude reads the exact format from the site (`get_test_format`), saves the test, and fixes any problems the site reports.

Then paste the result into the import box and press **Check**. Read the summary: the question numbers and types should match the book.

---

## Troubleshooting

| Message | Fix |
|---|---|
| "is not valid JSON … line 12, column 5" | Something is broken at that spot, often a missing or extra comma. Ask Claude to send the whole JSON again. |
| "the file "part1.mp3" is not attached" | Press **Attach audio / pictures** and choose that file. The name must match the one in the test. |
| "no accepted answer fits the word limit" | The answer in the key is longer than the instructions allow. Fix the answer or the instructions. |
| "must be one of the option labels …" | The answer after `\|` must be one of the option labels (e.g. `iii`, not `3`). |
| "needs at least one accepted answer" | Add `\| answer` at the end of the question line, or `ANSWER: X` after the multiple-choice options. |
| "no gaps found" | Put each completion answer in double brackets: `[[answer]]`. |
| "This line was ignored…" | That line is not under any `KEY:`. Usually a `TEXT:` or `QUESTIONS:` line is missing above it. |
| Strange characters (Ã©, â€™) | Save the `.txt` file as UTF-8 before copying it. |
