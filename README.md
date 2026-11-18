# IELTS Practice Platform

A private IELTS practice site at **https://ielts.jeemdev.net**. Claude writes tests and homework, you take them on any device (phone or laptop), and your progress is saved on the server. The full plan is in [IELTS_PLATFORM_SPEC.md](IELTS_PLATFORM_SPEC.md).

| Phase | What | Status |
|---|---|---|
| 1 | Test format (zod), database, migrations, seed, legacy import | ✅ |
| 2 | Login, dashboard, test runner with server autosave and resume on any device, phone layout, deployment | ✅ |
| 3 | Auto-scoring, band estimate, results page, review in the test, history | ✅ |
| 4 | Import box (paste JSON or the text format, attach audio / pictures), Tests page (archive / restore) | ✅ |
| 5 | MCP server: the claude.ai connector (OAuth, 11 tools) | ✅ |
| 6 | Task 1 charts drawn from data, plan+intro drill timers, speaking recording (+ optional live transcript) with Part 2 timers, listening read aloud | ✅ |
| 7 | Claude's feedback on the results page (criteria, mistakes linked to the answers, corrected essay side by side), progress charts with period / skill filters | ✅ |
| 8 | Lessons, vocabulary bank (table, flashcards, self-test log), My Mistakes (never-again list, 5-minute daily review); Claude files essay mistakes into the log | ✅ |
| 9 | Vocabulary quizzes (skill `vocabulary`, word → meaning / opposite, "Test me" on a set, results go into the set's self-test log), sentence rewrite with a mark per sentence, a plan box above Task 2 essays, a study-block log per attempt | ✅ |
| 10 | Pictures: Claude uploads SVG drawings (`upload_asset`, cleaned on the server) and listening maps can be drawn from data; the study plan with a **Today** card on the dashboard (re-test reminder every 5th day); listening read-aloud gives reading time before each part and honours `[pause 30]` | ✅ |
| 11 | Speaking: each recording stores pauses over 3 s, the longest pause and the speaking time (measured in the browser); Claude also gets words per minute. Server-side transcripts with whisper.cpp are built in but **off** until the `ielts-whisper` container is approved and started (`WHISPER_URL`) | ✅ (Whisper: waiting) |

## Folders
- `shared/`: the test format (zod schemas, validation, answer helpers) and the API types. Used by everything else.
- `server/`: Express + PostgreSQL (Drizzle). Login, REST API, file serving, migrations (`server/drizzle`), scripts.
- `web/`: the website (TypeScript + Vite). Dashboard, import box, and the computer-delivered-IELTS-style test runner.
- `templates/`, [HOW-TO-ADD-TESTS.md](HOW-TO-ADD-TESTS.md): how to add tests, the text format and its templates.

## Run it on your PC
Needs Node.js 22 or newer.

```bash
npm install
npm run dev          # API on :3000 + website on http://localhost:5173 (development password: ielts-dev)
npm test             # all automated tests
npm run typecheck
npm run build && npm start     # the production build on http://localhost:3000
```

On your PC the database is a local PGlite folder (`.data/pglite`), so you don't need to install PostgreSQL. Other commands:

```bash
npm run db:seed                            # add the sample reading test
npm run db:tests                           # list the tests in the database
npm run validate -- my-test.json           # check a test (JSON from Claude, or a .txt in the text format) without saving it
npm run db:import-legacy -- export.json    # tests from the old browser-only site's "Export all" file
npm run hash-password -- "a password"      # a hash for ADMIN_PASSWORD_HASH
```

## How it works
- **Login:** one password. The server stores only its scrypt hash (`ADMIN_PASSWORD_HASH`). Sessions use an httpOnly cookie. Changes are protected by a CSRF token and a same-origin check. 10 wrong passwords lock that IP out for 15 minutes. Every page, API route and uploaded file needs a login, except the login page and `/health`.
- **Autosave:** each answer change is sent within a second, and a heartbeat goes every 10 seconds. Only changes are sent, so two devices never overwrite each other. Offline, unsent changes stay in the browser (the only use of localStorage besides display settings) and sync when the connection is back.
- **Clock:** exam mode runs on the wall clock: the deadline is fixed on the server and keeps running when the page is closed. When it passes, the server submits the saved answers. Practice mode counts only the time you actually spend in the test, can be paused, and closing the page pauses it.
- **Secrets stay on the server:** the answer key and listening transcripts are never sent to the browser before you submit.
- **Writing:** Task 1 charts (line, bar, pie, table, process, map) are drawn from the test's data as SVG (`web/src/runner/charts.ts`), in the exam's colour settings too. A Task 2 drill (`"mode": "plan_intro"`) has its own plan and introduction timers.
- **Speaking:** each answer can be recorded in the browser (MediaRecorder) and is saved on the server with the attempt (`POST /api/attempts/:id/recordings?item=`, up to 30 MB). An optional switch writes down what you say with the browser's speech recognition, so Claude can read it. Part 2 has the 1-minute preparation and 2-minute talk timers; the talk records itself.
- **Listening without a recording:** the browser reads the transcript aloud (speech synthesis, a different voice per speaker). The transcript is fetched only by the player, never shown before you submit; in exam mode each part plays once and only the lines not yet heard are sent.
- **Adding tests:** the import box (**Tests → Import a test**) takes JSON from Claude or the text format, plus audio and pictures (stored in `UPLOAD_DIR`, served only after login). It lists every problem at once and saves only a checked test. See [HOW-TO-ADD-TESTS.md](HOW-TO-ADD-TESTS.md).
- **Scoring** happens on the server when you submit, and when the exam clock runs out (`shared/src/scoring.ts`):
  - Matching ignores capital letters, extra spaces and a final full stop. Any answer in `accept[]` counts, and `(optional)` words are allowed.
  - An answer **over the word limit is wrong**. A **misspelling is wrong**, but it is labelled, and the exact typed answer is kept.
  - "Choose TWO" gives 1 mark per correct letter.
  - The raw score becomes an **estimated band** using the tables in `shared/src/config/band-tables.ts` (Listening, Academic Reading, General Training Reading), scaled when a test has fewer than 40 questions. A full mock gets a band per section.
  - When an answer key is corrected, `rescoreTestAttempts()` scores the earlier attempts again.

## The Claude connector (MCP)
Claude reaches the site through a remote MCP server at **`https://ielts.jeemdev.net/mcp`** (Streamable HTTP, stateless; official TypeScript SDK v2: `@modelcontextprotocol/server`, `/express`, `/node`).

**Connect it (once):**
1. claude.ai → **Customize → Connectors → ＋ Add → Add custom connector**.
2. Name: `IELTS Practice`. Server URL: `https://ielts.jeemdev.net/mcp`. Continue.
3. Sign-in: keep the suggested OAuth option (*Use Claude's published identity* or *Register automatically* both work: the site supports automatic registration). Add.
4. Claude opens the site: log in if asked, then press **Allow**. The Tests page now shows *Connected*.

**Tools:** `get_test_format`, `create_test`, `update_test` (re-scores earlier attempts), `list_tests`, `get_test`, `archive_test`, `list_attempts`, `get_attempt`, `get_latest_attempt`, `save_feedback`, `get_progress`. Every call is logged (`docker compose logs app | grep '\[mcp\]'`). Phase 8 adds `create_lesson`, `update_lesson`, `get_lesson`, `list_lessons`, `upsert_vocab_set`, `list_vocab_sets`, `get_vocab_set`, `record_vocab_result`, `update_word`, `add_mistakes`, `list_mistakes`, `update_mistake`; `save_feedback` files mistakes marked `addToLog` into the log.

**Security:** the site is its own small OAuth 2.1 server (`server/src/mcp/oauth.ts`): dynamic client registration for Claude's callback (`https://claude.ai/api/mcp/auth_callback`) or loopback addresses only, PKCE S256, an approval page that needs your site login, access tokens for 1 hour, refresh tokens for 60 days and rotated on every use, only SHA-256 hashes stored. **Disconnect** on the Tests page ends every connection; changing the password does too. `/mcp` and the OAuth endpoints are rate-limited.

**Test it with the MCP Inspector** (before or instead of claude.ai):
```bash
TOKEN=$(node scripts/e2e/mcp-connect.mjs http://localhost:3000)     # signs in like Claude does (dev password), prints a 1-hour token
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer $TOKEN" --method tools/list
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer $TOKEN" --method tools/call --tool-name list_tests
```
Without `--cli`, the Inspector opens its web UI, which can also run the OAuth flow itself (it uses a `http://localhost` callback, which the site accepts).

## Deploy (VPS)
The VPS runs several projects behind one shared Caddy proxy (`/opt/edge`), following the `contaboserver` repo's `ADD-PROJECT.md`. The IELTS files are in that repo under `stack-ielts/` and on the box in `/opt/ielts/stack/`:

| | |
|---|---|
| `/opt/ielts/jeemdev.IELTS` | this repo (the Dockerfile builds it) |
| `/opt/ielts/stack/docker-compose.yml` | `ielts-app` (internal + edge network) and `ielts-db` (PostgreSQL 17, internal network only). No published ports |
| `/opt/ielts/stack/.env` | `POSTGRES_PASSWORD`, `ADMIN_PASSWORD_HASH` (chmod 600, in no repo) |
| `/opt/edge/sites/ielts.caddy` | `ielts.jeemdev.net → ielts-app:3000`, automatic HTTPS |

```bash
ssh gehad@169.58.112.108
cd /opt/ielts/stack
./deploy.sh              # git pull + rebuild + restart; migrations run on start
./change-password.sh     # set a new login password (logs out every device)
./backup.sh              # also runs daily from cron: database + uploads, kept 14 days in /opt/ielts/backups
docker compose logs -f app
```

Check it from anywhere with `curl https://ielts.jeemdev.net/health`, which should return `{"ok":true,"db":"up"}`.
