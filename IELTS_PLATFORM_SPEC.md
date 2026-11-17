# IELTS Practice Platform — Claude Integration Spec

## 0. Instructions for Claude Code

- This repo already contains an IELTS test-simulation website. **Explore the existing code first** (stack, routing, how tests and questions are currently stored and rendered) and adapt this spec to it. Do not rewrite working parts without asking.
- If something in this spec conflicts with the existing code, stop and ask me which way to go.
- Build in the phases in section 9. After each phase, run the app, test it, and show me what changed before moving on.
- Use TypeScript everywhere new code is added.
- Check the current official docs for the MCP TypeScript SDK and for claude.ai custom connectors (auth requirements) before writing the MCP server. Don't rely on memory for these.

## 1. Goal

I study for IELTS Academic with Claude (claude.ai chat). Claude writes exams and homework for me. I want:

1. **Claude → website:** Claude uploads a test or homework straight from the chat to my website through a custom connector (remote MCP server).
2. **Me → website:** I do the test on the website from any device (phone, laptop). Progress is saved on the server, so I can start on one device and finish on another.
3. **Website → Claude:** Claude reads my answers, times and auto-scores back through the connector, marks the test (band scores, mistakes explained), and saves the feedback to the website so I can see it there.

Single user (me). No public sign-up.

## 2. Architecture

```
claude.ai chat ──(MCP over HTTPS)──> /mcp endpoint ─┐
                                                     ├─> backend (Node/TS) ──> database
my browser (any device) ──(HTTPS)──> website + API ─┘
```

- One backend serves the website, a REST API for the website, and the MCP endpoint at `/mcp`.
- Hosted on my Ubuntu VPS with Docker Compose, behind a reverse proxy (Caddy or nginx) with a Let's Encrypt certificate, on a subdomain such as `ielts.jeemdev.net`.
- The MCP endpoint must be reachable from the public internet: claude.ai connects to it from Anthropic's cloud, not from my device.
- Database: PostgreSQL (or SQLite if the existing app already uses it). **All test data, attempts and answers live in the database, not in the browser's localStorage.** localStorage may only be used as an offline buffer that syncs to the server.

## 3. Data model

### tests
| field | type | notes |
|---|---|---|
| id | uuid | |
| title | text | e.g. "Day 24 – Writing Task 2 drill" |
| skill | enum | `reading`, `listening`, `writing`, `speaking`, `mixed` |
| kind | enum | `homework`, `practice`, `full_mock` |
| status | enum | `assigned`, `archived` |
| due_date | date, nullable | |
| instructions | text, nullable | shown before starting |
| content | jsonb | the test body, see section 4 |
| answer_key | jsonb | **never sent to the browser before the attempt is submitted** |
| source | text | `claude` or `manual` |
| created_at / updated_at | timestamp | |

### attempts
| field | type | notes |
|---|---|---|
| id | uuid | |
| test_id | uuid | FK |
| status | enum | `in_progress`, `submitted`, `marked` |
| answers | jsonb | `{ questionId: value }`, autosaved |
| time_spent_sec | jsonb | per part/section, plus total |
| started_at / submitted_at | timestamp | |
| auto_score | jsonb | per-question correct/incorrect, raw score, estimated band |
| feedback | jsonb, nullable | written by Claude via MCP, see section 6 |
| device_log | jsonb | optional: which devices touched the attempt |

A test can have many attempts (retakes).

## 4. Test JSON format (`content` + `answer_key`)

Design this as a **zod schema** shared by the API, the MCP tools and the frontend. Validation errors must be clear and specific (path + reason), because Claude will read them and fix its JSON.

```json
{
  "title": "Reading Practice – Urban Heat",
  "skill": "reading",
  "kind": "homework",
  "timeLimitMin": 20,
  "parts": [
    {
      "id": "p1",
      "title": "Passage 1",
      "passage": { "title": "Cooling the Concrete Jungle", "paragraphs": [ {"label": "A", "text": "..."} ] },
      "questionGroups": [
        {
          "id": "g1",
          "type": "tfng",
          "instructions": "Do the following statements agree with the information given in the passage?",
          "questions": [ { "id": "q1", "number": 1, "text": "Green roofs reduce..." } ]
        },
        {
          "id": "g2",
          "type": "sentence_completion",
          "instructions": "Complete the sentences.",
          "wordLimit": { "maxWords": 2, "allowNumber": true },
          "questions": [ { "id": "q2", "number": 2, "text": "Cities absorb heat because of their ______." } ]
        }
      ]
    }
  ],
  "answerKey": {
    "q1": { "accept": ["TRUE"] },
    "q2": { "accept": ["dark surfaces", "dark surface"] }
  }
}
```

### Question types to support

**Reading / Listening (auto-scored):**
- `tfng` (TRUE / FALSE / NOT GIVEN), `ynng` (YES / NO / NOT GIVEN)
- `mcq_single`, `mcq_multi` (choose TWO/THREE, each correct option = 1 mark)
- `matching_headings`, `matching_information` (which paragraph), `matching_features`, `matching_sentence_endings`
- `sentence_completion`, `summary_completion` (free text or from a word box), `note_completion`, `table_completion`, `flowchart_completion`, `diagram_labelling`, `form_completion`
- `short_answer`
- `map_labelling` (listening): image URL + letter options

**Writing (marked by Claude, not auto-scored):**
- `writing_task1`: prompt plus chart data. Store the chart as **data** (`chartType`: line/bar/pie/table/process/map, series, labels) and render it on the page with a chart library, so Claude can create Task 1 visuals without image files. Also allow an optional image URL.
- `writing_task2`: prompt. Also support my drill format: `plan` field + `introduction` field only (no full essay), with separate timers for the plan and the intro.
- `paragraph` (single PEEL body paragraph).
- Show a live word count and a minimum word target (150 / 250, or custom).

**Speaking:**
- `speaking_part1`, `speaking_part2` (cue card + 1 min prep timer + 2 min talk timer), `speaking_part3`
- Answers: optional audio recording (MediaRecorder, uploaded to the server) and/or typed notes or transcript.

**Listening audio:** Claude cannot produce audio files. Each listening part has `transcript` (required) and `audioUrl` (optional). If there is no audio, play the transcript with the browser's speech synthesis (pick an English voice, adjustable speed, play once only in exam mode). Hide the transcript until the attempt is submitted.

### Auto-scoring rules
- Case-insensitive, trim spaces, ignore a trailing full stop.
- Accept any string in `accept[]`. Optional parts allowed with brackets in the key, e.g. `"(the) dark surfaces"`.
- Enforce `wordLimit`: an answer over the limit is wrong (like the real test). Show this as the reason.
- **Spelling counts**: misspelled = wrong. Store the exact typed answer so Claude can show me the misspelling.
- Raw score → estimated band using an **IELTS Academic conversion table stored in config** (separate tables for Listening and Academic Reading, scaled for tests shorter than 40 questions). Label it "estimated band".

## 5. Website features

1. **Login**: single user, password + secure httpOnly session cookie (or passkey). All pages and API routes require login.
2. **Dashboard**: assigned homework (newest first, due dates), in-progress attempts with "Resume", completed attempts with score, band and a "Feedback ready" badge.
3. **Test runner**, like computer-delivered IELTS:
   - Split view (passage left, questions right) on desktop; stacked with a tab switch on mobile.
   - Countdown timer, question navigator at the bottom, flag-for-review, text highlighting in the passage, notes.
   - **Autosave to the server** every few seconds and on every answer change. Resume exactly where I left off on any device.
   - **15-minute blocks:** I study in short blocks. Allow pausing and resuming a test, and allow doing one part/section at a time. Track time per part.
   - Practice mode (pause allowed, transcript after submit) vs exam mode (strict timer, no pause).
4. **Results page**: my answer vs correct answer per question, reason when wrong (wrong word, over word limit, spelling), raw score, estimated band, time used. Below it, Claude's feedback when it exists.
5. **History / progress**: list of all attempts, with scores over time per skill and question type (e.g. TFNG accuracy trend).

## 6. MCP server (custom connector for claude.ai)

- Implement with the official MCP TypeScript SDK, **Streamable HTTP** transport, mounted at `/mcp` on the same backend.
- **Auth:** use what claude.ai custom connectors support (check current docs). Preferred: OAuth for a single user. Do not leave `/mcp` open without any protection. Add rate limiting and log every tool call.
- Each tool validates input with the same zod schemas and returns clear errors.

### Tools

| tool | input | does |
|---|---|---|
| `get_test_format` | — | returns the JSON schema + one example per question type, so Claude always knows the current format |
| `create_test` | test JSON (content + answerKey + meta) | validates, saves, returns `id` + website URL of the test |
| `update_test` | `id`, partial or full test JSON | fixes a test (e.g. a wrong answer key); also re-scores existing attempts |
| `list_tests` | filters: `skill`, `kind`, `status`, `limit` | short list (id, title, skill, created, attempt count) |
| `get_test` | `id` | full test including answer key |
| `archive_test` | `id` | sets status to archived (no hard delete) |
| `list_attempts` | filters: `testId`, `status`, `since`, `limit` | id, test title, status, score, band, dates |
| `get_attempt` | `id` | full detail: every question, my exact answer, correct answer, correct/incorrect + reason, time per part, writing/speaking text, links to audio |
| `get_latest_attempt` | optional `skill` | shortcut for "mark my last attempt" |
| `save_feedback` | `attemptId`, feedback JSON | stores Claude's marking; sets status `marked` |
| `get_progress` | optional `skill`, `since` | aggregated stats: scores over time, accuracy per question type, most common mistake reasons |

### Feedback JSON (written by `save_feedback`)
```json
{
  "overallBand": 6.5,
  "criteria": { "TR": 6, "CC": 6.5, "LR": 6.5, "GRA": 6 },
  "summary": "...",
  "mistakes": [
    { "questionId": "q2", "yourAnswer": "dark surface's", "correct": "dark surfaces", "explanation": "...", "category": "spelling" }
  ],
  "correctedText": "optional corrected version of a writing answer",
  "nextSteps": ["..."]
}
```
`criteria` is optional and its keys depend on the skill (Writing: TR/TA, CC, LR, GRA; Speaking: FC, LR, GRA, P). The website renders this nicely on the results page.

## 7. Security

- HTTPS only; secure, httpOnly, sameSite cookies; CSRF protection on form posts.
- Answer keys and transcripts are never sent to the browser before submission.
- Rate limiting on login and `/mcp`.
- Secrets (DB password, session secret, OAuth secrets) in `.env`, never committed.
- Daily database backup (pg_dump to a backup folder, keep 14 days).

## 8. Deployment

- `docker-compose.yml` with: app, database, (optional) Redis for sessions.
- Reverse proxy config for the subdomain with automatic HTTPS.
- A `README` section: how to deploy/update on the VPS, how to add the connector in claude.ai (Customize → Connectors → add custom connector → `https://<domain>/mcp`), and how to test the MCP server with the MCP Inspector before connecting it.

## 9. Build phases

1. **Format + storage**: zod schema for tests, DB tables, migrations, seed one sample reading test. Move any existing localStorage test data into the database.
2. **Runner + sync**: login, dashboard, test runner with server autosave and resume across devices, mobile layout.
3. **Scoring + results**: auto-scoring, band estimate, results page, history.
4. **Import box (temporary)**: an admin page where I paste test JSON and it is validated and saved. This lets me use the system before the connector is ready.
5. **MCP server**: all tools in section 6, auth, test with MCP Inspector, then connect to claude.ai.
6. **Writing, speaking, listening extras**: chart rendering for Task 1, plan+intro drill mode, audio recording, speech-synthesis playback for listening.
7. **Feedback + progress**: render Claude's feedback, progress charts.

## 10. Acceptance checks

- In claude.ai: "Upload this reading homework to my site" → the test appears on the dashboard within seconds.
- I start it on my phone, answer 5 questions, close the browser, open it on my laptop → the same 5 answers are there and the timer continues correctly.
- After I submit: "Mark my last attempt" in claude.ai → Claude gets every answer with correct/incorrect and reasons, writes feedback, and the feedback appears on the results page.
- An over-the-limit answer (3 words where the limit is 2) is marked wrong with the reason shown.
- Opening the site or `/mcp` without logging in / without auth is refused.
