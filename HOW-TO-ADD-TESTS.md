# How to add tests

There are three ways to put a test into IELTS Practice Studio:

| Way | Best for | How |
|---|---|---|
| **1. Text file (.txt)** | Whole tests from a book or PDF. This is the fastest way. | Write the test in the format below, then **Dashboard → ⭳ Import** |
| **2. Editor** | Small tests, or fixing an imported test | **Dashboard → ＋ New test**, then fill in the forms |
| **3. Backup file (.json)** | Moving tests to another computer or browser | **Export all** on one computer, **Import** on the other |

---

## Quick start with a text file

1. Open the **`templates`** folder and copy the template you need:
   - `reading-template.txt`
   - `listening-template.txt`
   - `writing-template.txt`
   - `example-reading-urban-beekeeping.txt` is a complete, real example.
2. Open the copy in Notepad (or VS Code) and replace the example content with your test.
   Save it as **UTF-8** (Notepad does this by default).
3. In the app, click **⭳ Import** and select the `.txt` file.
   - **Listening:** select the `.txt` **and** the audio files together (hold **Ctrl** and click each file).
   - **Pictures** (maps, diagrams, Writing Task 1 charts): select them together with the `.txt` file in the same way.
   - You can also **drag the files** onto the dashboard.
4. An import report appears. A ✓ means everything was understood. A ⚠ lists anything to fix
   (for example a question with no answer). Click **Check in editor** to review the test.

You can import several `.txt` files at once.

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
- A line like `KEY:` starts a section. The text after it, including the following lines, belongs to that section until the next `KEY:`, `===` or `---` line.
- Lines starting with `//` are comments and are ignored.
- **Question numbers are added automatically.** Numbers you write (`1.`, `2)`, `14`) are just for your own reference. They can be wrong or missing.
- The answer goes **after a `|`** at the end of the question line: `The museum opened in 1990. | FALSE`

### 1. Test details (top of the file)

```
TITLE: Cambridge 18 — Test 1 Reading
MODULE: Reading              ← Reading, Listening or Writing
TYPE: Academic               ← Academic or General Training (not needed for Listening)
TIME: 60                     ← minutes on the clock
DESCRIPTION: optional note
```

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
AUDIO: part1.mp3             ← exact file name of the audio (select it when importing)
TRANSCRIPT:
optional — shown only after you finish
```
If you have **one audio file for the whole test**, write `AUDIO:` only in Part 1.

**Writing**
```
=== TASK 1 ===
MIN WORDS: 150
IMAGE: chart.png             ← optional picture (select it when importing)
PROMPT:
You should spend about 20 minutes on this task.
…
MODEL ANSWER:
optional — shown only after you finish
```

### 3. Question groups

Every group can have these optional lines:

```
INSTRUCTIONS:
Choose NO MORE THAN TWO WORDS from the passage for each answer.
TITLE: a title shown above the questions (e.g. List of Headings)
IMAGE: diagram.png
```
If you leave out `INSTRUCTIONS:`, standard IELTS instructions for that question type are used.

The name after `---` tells the app the question type. Any of these names work:

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

Capital letters, extra spaces and a final full stop are ignored.

---

## Turning a PDF into a text file quickly

**By hand:** copy the passage from the PDF and paste it after `TEXT:`. Then copy the questions under `QUESTIONS:` and add `| answer` from the answer key.

**With an AI assistant (ChatGPT, Claude…):** paste the PDF text, the answer key, and this request:

> Convert this IELTS test into the text format below. Use `=== PASSAGE n ===` for each passage (or `=== PART n ===` for listening), `--- TYPE ---` for each question group (TRUE FALSE NOT GIVEN, YES NO NOT GIVEN, MULTIPLE CHOICE, CHOOSE TWO, MATCHING, COMPLETION, SHORT ANSWER), `TEXT:` for passages and gap texts, `OPTIONS:` for lists, and `QUESTIONS:` with one question per line ending in `| answer`. For multiple choice, put options on lines `A. …` and the answer as `ANSWER: X`. In completion texts put each answer inside `[[ ]]`. Start paragraphs that have letters with `[A]`, `[B]`. Here is an example of the format: *(paste the contents of `templates/example-reading-urban-beekeeping.txt`)*

Always check the imported test in the editor. AI assistants sometimes make mistakes.

---

## Full test mode

**Dashboard → 🏁 Full test**: choose a Listening, a Reading and a Writing test (you can skip any of them) and Exam or Practice mode.
The sections run one after another, like the real exam, and your results are shown only at the end:

- a band for each section, and
- an **overall band**: the average of the sections, rounded to the nearest half band as in the real test. Speaking is not included.

Writing is not marked automatically. Open **Score your writing** on the results page to give yourself a band on the four criteria. The overall band then updates.

If you stop in the middle, a **Full test in progress** banner on the dashboard lets you continue later.

---

## Troubleshooting

| Message / problem | Fix |
|---|---|
| “no answer” | Add `\| answer` at the end of the question line, or `ANSWER: X` after multiple-choice options. |
| “answer … is not in the OPTIONS list” | The letter after `\|` must be one of the option labels (e.g. `iii`, not `3`). |
| “no gaps found” | Put each completion answer in double brackets: `[[answer]]`. |
| “file … was not selected” | Import again and select the audio / picture together with the `.txt`, or upload it in the editor. The name after `AUDIO:` must match the file name. |
| “line … was ignored” | That line is not under any `KEY:`. Usually a `TEXT:` or `QUESTIONS:` line is missing above it. |
| Strange characters (Ã©, â€™) | Save the `.txt` file as UTF-8. |
| A test needs a small fix | Open it with **✎ Edit**. You don't need to import again. |

To get any test back as a text file: **⋯ → Export as text (.txt)** on its card.
