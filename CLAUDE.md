# IELTS Practice Platform — guide for Claude Code sessions

A private, single-user IELTS practice site at **https://ielts.jeemdev.net**. The owner (Gehad) studies for IELTS Academic with Claude. Claude writes tests and homework, the owner takes them on any device, and (from Phase 5) Claude reads the answers back through an MCP connector and saves feedback. The full requirements are in [IELTS_PLATFORM_SPEC.md](IELTS_PLATFORM_SPEC.md). **Read it before starting a phase.**

## Current status (update this section at the end of every phase)

| Phase | What | State |
|---|---|---|
| 1 | Test format (zod), DB tables, migrations, seed, legacy import | ✅ merged into `main` |
| 2 | Login, dashboard, runner with server autosave + resume on any device, phone layout, deployment | ✅ merged into `main`, **deployed** |
| 3 | Auto-scoring, estimated band, results page, review-in-the-test, history | ✅ merged into `main`, **deployed** 2026-11-18 |
| 4 | Import box (`#/import`: JSON or text format, audio/picture uploads), Tests page (`#/tests`: archive/restore) | ✅ merged into `main`, **deployed** 2026-11-18 |
| 5 | MCP server at `/mcp` (11 tools of spec §6), own OAuth 2.1 server, MCP Inspector checked | ✅ merged into `main`, **deployed** 2026-11-18 (the owner said "make the code then deploy at once") |
| 6 | Task 1 charts (SVG), plan+intro drill timers, speaking recording + optional live transcript + Part 2 timers, listening read aloud | ✅ merged into `main`, **deployed** 2026-11-18 (the owner said "go with phase 6 and deploy after you finish") |
| 7 | Claude's feedback on the results page, progress charts on History (filters in the URL) | ✅ merged, **deployed** 2026-11-18 |
| 8 | Lessons, vocabulary bank, mistakes log: tables (migration `0004_study`), 12 MCP tools (`server/src/mcp/study-tools.ts`), pages `#/lessons` `#/lesson/:id` `#/vocab` `#/vocab/:id` `#/mistakes`; `save_feedback` `addToLog` | ✅ merged, **deployed** 2026-11-18 |
| 9 | Skill `vocabulary` (enum migration `0005`; no band, accuracy; types in `VOCABULARY_TYPES`), `definition_match` / `opposite_match` (matching types), `sentence_rewrite` (a writing type, one open item per sentence; feedback `items` [{itemId, correct, comment, corrected}]), test `vocabularySetId` (on submit → self-test log via `server/src/study/vocab-quiz.ts`, idempotent), "Test me" `POST /api/vocab/sets/:id/quiz`, plan box (state `plan:<groupId>`), study blocks (state `blocks`, runner `trackBlock`) | ✅ merged, **deployed** 2026-11-18 |
| 10 | `upload_asset` (SVG → `server/src/files/svg.ts` allowlist rebuild; `/files/:id` sends `Content-Security-Policy: … sandbox` for SVG), `map_labelling.map` (features drawn by `renderChart`), plan table `plan_days` (migration `0006`) + `set_plan` / `get_plan` / `update_block` (`server/src/mcp/plan-tools.ts`, `server/src/study/plan.ts`), `GET /api/plan/today?date=` (browser date) → dashboard Today card, `#/plan`, blocks with a testId ticked on submit, review rule every 5th day; read-aloud `partSpeech` (reading time, default 30 s, `readingTimeSec`; `[pause N]` silences; Skip in practice) | ✅ merged, **deployed** 2026-11-18 |
| 11 | Recorder `silenceMeter` (Web Audio RMS every 100 ms, adaptive noise floor): `pauses`, `longestPause`, `speaking` sent as upload query params → `files.pauses_over_3s / longest_pause_sec / speaking_sec` (migration `0007`); `get_attempt` recording: + `wordsPerMinute`, `transcript`. `server/src/files/transcribe.ts` (`Transcriber`, one at a time, resumes pending on start) posts to whisper.cpp `POST /inference` (`file`, `response_format=json`) — **only when `WHISPER_URL` is set**. `whisper/Dockerfile` (v1.9.5, base.en, non-root, ffmpeg, `--convert`). | ✅ merged, **deployed** 2026-11-18; **Whisper container NOT started** (see below) |
| 12 | Owner's requests + `ielts-site-spec-mastery.md`: **discard** an in-progress attempt (`DELETE /api/attempts/:id`, 409 once submitted; dashboard card + start page); **Done page** `#/done` (`GET /api/done`, `server/src/attempts/lists.ts`): the dashboard keeps only tests never submitted, plus the newest test of each mastery step not yet passed (one test per mastery attempt; older ones go to Done); **mastery ladders** (table `mastery_steps`, migration `0008`; `server/src/study/mastery.ts`; test `masteryStepId`; recorded on submit, on results of an auto-submitted exam, on rescore and on `save_feedback`; idempotent per attempt; passRule `minBand` uses Claude's overallBand or the reading/listening band, `minPercent` the auto score, else Claude's `feedback.items[].correct` (sentence rewrite); passing opens the next step; `recheck` passes on one good attempt), MCP `upsert_mastery_step` (`steps: [...]`) / `list_mastery` / `get_mastery_step` / `update_mastery_step` (`server/src/mcp/mastery-tools.ts`), `GET /api/mastery`, dashboard Mastery card + `#/mastery`; plan block `section` (review / main / mastery → three headings on Today and `#/plan`); question type **`dictation`** (objective, `questions` or `items` [{id, number, say, sentence?}], `maxPlays` default 2; `say`/`sentence` stripped from public content; `POST /api/attempts/:id/dictation/:qid/play` counts plays in state `dict:<qid>`, autosave cannot change those keys); start page ignores a second tap on Start. **`docs/claude-chat-guide.md`** = the organisation rules the owner pastes into claude.ai (sections, names, ladder step ids, one test per mastery attempt, re-tests on days divisible by 5). | ✅ merged, **deployed** 2026-11-22. Live data tidied the same day: plan Days 24–45 with sections + re-tests on days divisible by 5, the two mastery tests linked, `ref-mastery` points to `#/mastery`. Follow-up (`brief-for-claude-code-mastery.md`, deployed 2026-11-22): `update_mastery_step { id, changes }`, fuller `list_mastery` (attempts, newestTest + url), back-fill of earlier attempts when a step is created. **Ladders created on the live site** the same day: W (6), S (3), V Sets 3–10 (8), R (3), L (4), P (3); `tools/list` = 31. claude.ai showed 27 tools only because its connector kept the old tool list (new chat / reconnect). 2 stray in-progress Repair-task attempts left for the owner to discard. |
| 13 | **Settings** `#/settings` (⚙ in the header): username + password, both need the current password (a wrong one = 403 `wrong_password`, counts towards the login lockout). Table `account` (one row, id 1; migration `0009_account`), `server/src/auth/account.ts`: `loadAccount` puts the row on `config.adminPasswordHash` / `config.adminUsername` before the first request; the site password is used only while its `env_tag` matches `ADMIN_PASSWORD_HASH` (`config.envPasswordHash`), so `change-password.sh` still wins (forgot-password route), the username is kept. New password: min 12, every OTHER session deleted, Claude disconnected (passwordTag). Login: `{username?, password}`, username any case, "Wrong username or password."; `/api/auth/me` → `usernameRequired` shows the Username box. `prod-check.mjs` / `mcp-connect.mjs` take `E2E_USERNAME`. | branch `phase-13-settings`, waiting for the owner's go |

- `main` is what runs on the server. The server checkout `/opt/ielts/jeemdev.IELTS` tracks `main`.
- **The owner's list `ielts-site-spec.md`** (2026-11-18): decisions taken — deploy each phase when done; pictures = `upload_asset` (SVG cleaned on the server and served with a sandbox CSP) **and** maps drawn from data; vocabulary quizzes = a new skill `vocabulary` (no band, accuracy only). Already true before Phase 8: writing boxes have `spellcheck="false"`; exam-mode read-aloud plays once; the speaking live transcript + recording length reach `get_attempt`.
- Deploy routine (every phase): record the other sites' status codes (see Deployment), `ssh gehad@169.58.112.108 'cd /opt/ielts/stack && ./deploy.sh'`, then check `/health`, the other sites again, and logged-in calls **on the box** (cookie jar; read the password file there, never print it). **The box has no Node:** copy `scripts/e2e/prod-check.mjs` and `scripts/e2e/mcp-connect.mjs` to `/tmp` there and run them with the app image, as the password file's owner: `F=/opt/ielts/stack/initial-password.txt; docker run --rm --user $(stat -c %u:%g $F) --entrypoint node -v /tmp:/w:ro -v $F:/pw:ro -e E2E_PASSWORD_FILE=/pw ielts-app:latest /w/prod-check.mjs https://ielts.jeemdev.net [/api/extra …]` (prints only status codes and counts; `mcp-connect.mjs` the same way prints a 1-hour token for a `tools/list` curl). The password is never printed. If the owner has changed the password, that file is gone: ask the owner to test from claude.ai instead.

### Phase 7 (done 2026-11-18) — what was built
- Results page (`web/src/pages/result.ts`): the feedback card sits right under the hero once feedback exists: overall band, criteria as a meter list in the official order (jsonb does not keep key order — `orderCriteria`), summary via `mdRich` (text + bullets + numbered lines + `#` headings, escaped), mistakes routed by `routeFeedback` (`q14` / `Q14` / `14` → the answer row, which gets a "Claude:" note and a ✎; a writing/speaking item id → that item's card; anything else → the card), `correctedText` side by side with a word diff (`shared/src/diff.ts`, LCS, gives up above 4M word pairs) when there is one writing item (else in a "Corrected version" box), next steps, "Marked by Claude on …", and unknown extra fields under their own heading (text only). A Task 2 drill is compared on its introduction.
- History (`web/src/pages/history.ts`, `web/src/lib/linechart.ts`): small multiples — band over time per skill on one shared band scale, accuracy over time per question type (0–100 %), ranked bars for auto-marking reasons and Claude's mistake categories, tables behind "Show the numbers" / "Show as a table". Tooltips snap to the nearest attempt (mouse, touch: tap shows / second tap opens, keyboard: arrows/Home/End/Enter). The SVG is drawn at the real pixel width (ResizeObserver). Filters (period 7/30/90 days, skill) live in the hash (`#/history?days=30&skill=reading`, updated with `history.replaceState`, so no remount) and call `GET /api/history?skill=&since=YYYY-MM-DD` (`HistoryQuery`, 400 on anything else).
- `buildHistory` now returns `byType[].points` (one per attempt) and `feedbackMistakes` (categories normalised: lower case, `_`/`-` → space, missing → "other"); with a skill filter a full mock counts only that section's questions. `AttemptSummary.feedbackBand` (dashboard + history show Claude's band for writing/speaking). `get_progress` also returns `feedbackMistakeCategories`.
- Chart colours for app pages: `.theme-app` vars in `app.css` (`--series-1` #2a78d6 validated on white, one accent hue everywhere). App pages are light only.

### Phase 7 brief (written at the end of Phase 6, kept for reference)
**Goal** (spec §5.4, §5.5, §6 "Feedback JSON", §9 phase 7): show Claude's marking properly on the results page, and turn History into real progress charts.

1. **Results page: render the feedback** (`web/src/pages/result.ts`, today only `feedbackBlock()`: band, summary, next steps).
   - Stored shape: `shared/src/feedback.ts` (`Feedback`, a zod `looseObject`) + `savedAt`, in `attempts.feedback`; `save_feedback` sets status `marked` (`server/src/mcp/tools.ts`). Type `ResultView.feedback` as `Feedback | null` (`shared/src/api.ts`) instead of `Record<string, unknown>`.
   - Show: overall band (hero already falls back to it via `feedbackBand()`), `criteria` as bands per criterion (Writing TR/TA, CC, LR, GRA; Speaking FC, LR, GRA, P — keys are free, show any), `summary` (markdown via `mdBlock`), `mistakes` (questionId may be an objective question id like `q14` → show its number and link/highlight the row in the answers table; or a writing/speaking item id → attach to that item's card), `correctedText` next to the student's essay (a simple side-by-side or word diff), `nextSteps`, and "Marked by Claude on <savedAt>".
   - Unknown extra fields: keep rendering safe (looseObject allows them); never trust them as HTML (`mdBlock` escapes).
   - Dashboard "✓ Feedback ready" badge and History "✓ Feedback" already exist.
2. **History: progress charts** (`web/src/pages/history.ts`, today mini bar sparklines + a table; the code says "full charts arrive in Phase 7").
   - Data: `GET /api/history` → `HistoryResponse` from `server/src/attempts/history.ts` `buildHistory(db, { skill?, since? })` (filters exist, not exposed on the REST route yet). Writing/speaking bands come from `feedback.overallBand`.
   - Wanted: estimated band over time per skill (line chart), accuracy per question type over time (e.g. TFNG trend), mistake reasons. Maybe a skill / date-range filter row.
   - **Load the `dataviz` skill before any chart code** (it is a hard rule in that skill). Phase 6's `web/src/runner/charts.ts` already uses its validated palette, but its colours live on `.cd` (exam page, `web/src/styles/exam.css`); app pages (`theme-app`, `web/src/styles/app.css`) need the `--series-N` vars too. Tooltips on hover; a table view.
3. **Tests / checks:** vitest for any new server code; a browser check (e.g. `scripts/e2e/feedback.cjs`). To get feedback into the e2e DB, either extend `scripts/e2e/prepare-db.ts` to submit an attempt and write `attempts.feedback` directly, or call the `save_feedback` tool with a token from `scripts/e2e/mcp-connect.mjs`.

**Spec §10 acceptance checks — where they stand:**
- "Upload this reading homework to my site" from claude.ai — **not yet tried by the owner** (they still have to add the connector; the tools work in tests, MCP Inspector and a live check on the server).
- Phone → laptop, same answers, clock continues — ✅ (`cross-device.*.cjs`).
- "Mark my last attempt" → feedback on the results page — tools ✅; real claude.ai run pending the owner; the full rendering is Phase 7.
- Over-the-limit answer marked wrong with the reason — ✅ (Phase 3).
- Site and `/mcp` refuse requests without login / token — ✅.

**Owner's open to-dos (remind them briefly when relevant):**
- Add the connector in claude.ai (README → *The Claude connector*).
- Change the first password: on **⚙ Settings** once Phase 13 is deployed (or `./change-password.sh` in `/opt/ielts/stack`). It also disconnects Claude, so reconnect afterwards. Until then `initial-password.txt` is on the box (the production checks above read it there). **After a change on the Settings page that file is stale:** delete it on the box, and run production checks only with the owner's help (or check from claude.ai).

**Whisper (Phase 11) — waiting for the owner's OK.** Building and starting a new container on the shared box was refused by the session's permission check (new infrastructure), so it was left for the owner to approve. To switch it on: add to `/opt/ielts/stack/docker-compose.yml` (and to `stack-ielts/` on branch `add-ielts` of the contaboserver repo):
```yaml
  whisper:
    build: { context: ../jeemdev.IELTS/whisper }
    image: ielts-whisper:latest
    container_name: ielts-whisper
    restart: unless-stopped
    mem_limit: 768m
    cpus: 2
    networks: [internal]   # no ports, not on edge
```
and `WHISPER_URL: http://ielts-whisper:8080` under `app.environment`; then `./deploy.sh` (the first build compiles whisper.cpp, a few minutes). The JSON answer shape of `/inference` is not documented; `textOf()` accepts `{text}`, segments or plain text — check `docker logs ielts-app | grep whisper` after the first recording. Existing recordings are transcribed when the app starts.

**Known limits / ideas after Phase 7:** no "attach a recording to an existing test" yet (only the import box takes files; Claude's listening tests use read-aloud). Claude marks speaking from text only (recordings need the owner's login), so pronunciation is not marked. Nightly backups copy all uploads (fine at 162 GB free).

## How we work (agreed with the owner)
- **One branch per phase** (`phase-N-name`). At the end of a phase:
  - run `npm test`, `npm run typecheck` and `npm run build`;
  - run the app and check it in a browser (`scripts/e2e`, see below);
  - commit, push the branch, and **show the owner what changed** with the compare link `https://github.com/jeehadalshoapi/jeemdev.IELTS/compare/main...<branch>`;
  - then wait for approval. Never merge to `main` or deploy a phase without the owner's "go".
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. On Windows, write the message to a file and use `git commit -F file`. A PowerShell here-string piped to git does **not** work.
- **Spec §0:** if the spec conflicts with the existing code, stop and ask. All new code is TypeScript. **Before writing the MCP server (Phase 5), check the current official docs** for the MCP TypeScript SDK and for claude.ai custom connectors (auth requirements). Don't rely on memory.
- The owner answers briefly and prefers that Claude does the steps (including on the VPS) and then reports clearly what happened. Explain decisions in plain language with a recommendation.
- The GitHub repo `jeehadalshoapi/jeemdev.IELTS` is **public**. Never commit secrets, real answer keys or personal data. `.env` files are ignored.

### Decisions the owner made (don't re-ask)
1. The old vanilla-JS site was **converted to TypeScript** (Vite) rather than rebuilt. The old form **editor was retired**. Old site files are only in git history (commit `38d7c76`).
2. Database: **PostgreSQL 17 in Docker on the VPS**. Locally (no Docker on this PC) it's **PGlite** in `.data/pglite`, and tests use `memory://`. `DATABASE_URL` set → Postgres.
3. Old browser data: tests can be imported from the old site's "Export all" file (`npm run db:import-legacy`). **Old attempts are not migrated.**
4. Container prefix **`ielts`** (`ielts-app`, `ielts-db`).
5. **Exam mode runs on the wall clock**: the deadline is fixed on the server at start and keeps running while the browser is closed. When it passes, the server submits (and scores) the saved answers. **Practice mode** counts only active time (heartbeats, capped by real elapsed time), can be paused, and closing the page pauses it. This suits the owner's 15-minute study blocks.
6. Extensions to the spec's data model:
   - `attempts.mode`, `attempts.state` (position `pos`, `flags`, highlights `hl:<partId>:<zone>` as text offsets), `tests.format_version`, a `files` table, a `sessions` table.
   - Format additions:
     - `mcq_multi` questions have `numbers: [14, 15]`.
     - Completion groups may have a `template` with `{{questionId}}` gaps.
     - Matching groups have `options` / `optionsTitle` / `allowReuse`.
     - The answer key may have `explanation`, `modelAnswer` and `notes`.
     - `variant: academic | general_training`, with a GT band table.
     - Paragraphs may have a `heading`.
   - A listening transcript is required **unless the part has `audioUrl`, or an earlier listening part has one** ("one recording for the whole test", as in the old text format). The spec says always; relaxed so real recordings without transcripts work. The owner was told about this.
   - Text format additions (Phase 4): `KIND:`, `DUE:`, `TIME: none`. Leaving out `INSTRUCTIONS:` gives standard IELTS instructions per type.
   - Uploads (`POST /api/files?name=…`, raw body, streamed to disk): audio ≤ 100 MB, pictures ≤ 10 MB (PNG/JPG/GIF/WEBP; **no SVG**). Limits in `UPLOAD_MAX_BYTES` (`shared/src/api.ts`).
   - `files.item_id` + `files.duration_sec` (migration `0003_recordings`): a speaking recording belongs to one item of one attempt; a new recording replaces the old (row and file deleted). Client-only state keys: `drill:<groupId>` {stage, planSec, introSec}, `prep:<groupId>` (Part 2 notes), `tts:<partId>` {line} (exam read-aloud position).
   - **Listening transcripts and read-aloud (spec §4 vs §7 conflict, decided in Phase 6):** §4 wants the browser to read the transcript aloud, §7 says transcripts never reach the browser before submission. The transcript is sent ONLY by `GET /api/attempts/:id/speech/:partId`, only for parts with no recording, never rendered, and in exam mode only the lines not yet played. Reported to the owner.
   - Tables `oauth_clients`, `oauth_tokens` (migration `0002_oauth`). `attempts.feedback` holds the `Feedback` JSON + `savedAt`; saving it sets status `marked`.
8. **Connector auth (Phase 5):** the app is its own OAuth 2.1 authorization server, single user (SDK v2 no longer ships one; an external identity provider was overkill for one user). Details in `server/src/mcp/oauth.ts` and README → *The Claude connector*. CIMD is deliberately **not** advertised, so Claude uses dynamic registration.
7. Deployment follows the box's own runbook (see Deployment). It does **not** ship its own reverse proxy, even though spec §8 suggested one.

## Commands
```bash
npm install
npm run dev                 # API :3000 (tsx watch) + website :5173 (Vite); dev password "ielts-dev"
npm test                    # vitest — 171 tests (shared/test, server/test); hookTimeout 90 s because every server file starts its own PGlite
npm run typecheck           # tsc for shared, server, web (TypeScript 7 — type-checking only)
npm run build               # vite build web -> web/dist ; esbuild server -> server/dist
npm start                   # production build on :3000
npm run db:migrate | db:seed | db:tests | db:generate   # drizzle-kit generate after editing server/src/db/schema.ts
npm run validate -- test.json|test.txt     # check a test (JSON or text format) without saving
npm run db:import-legacy -- export.json    # old site's "Export all" file
npm run hash-password -- "pw"              # ADMIN_PASSWORD_HASH value
```

### Browser checks (`scripts/e2e`, headless Microsoft Edge over the DevTools protocol)
```bash
npm run build
npx tsx scripts/e2e/prepare-db.ts                       # fresh DB in .data/e2e (sample + listening + writing)
PGLITE_DIR=.data/e2e/pglite UPLOAD_DIR=.data/e2e/uploads node server/dist/main.js    # run in the background
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/cross-device.phone.cjs  # spec §10 acceptance, part 1
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/cross-device.laptop.cjs # part 2 (a new profile = a new device)
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/results.cjs            # Phase 3 scoring / review / history
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/import.cjs             # Phase 4 import box, uploads (dropped files), tests page
node scripts/e2e/cdp.cjs http://localhost:3000/login scripts/e2e/connector.cjs     # Phase 5 approval page (run a listener on :33418 to see the code)
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/extras.cjs             # Phase 6 charts, drill timers, recording (fake mic), read aloud
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/feedback.cjs           # Phase 7 feedback rendering, progress charts, filters, phone
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/study.cjs              # Phase 8 lessons, vocabulary (table, flashcards), mistakes + review
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/format9.cjs            # Phase 9 Test me quiz, plan box, sentence rewrite, study blocks (fresh DB: it submits)
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/plan10.cjs             # Phase 10 Today card, plan page, map from data, SVG diagram, silence + Skip (fresh DB)
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/mastery12.cjs          # Phase 12 to-do dashboard, discard, Done page, mastery card/page, plan sections, dictation (fresh DB)
node scripts/e2e/cdp.cjs http://localhost:3000/ scripts/e2e/settings13.cjs          # Phase 13 Settings page, Username box on the login page, phone (a restart brings back the dev password)
TOKEN=$(node scripts/e2e/mcp-connect.mjs http://localhost:3000)                    # OAuth like claude.ai does; prints a 1-hour token
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --header "Authorization: Bearer $TOKEN" --method tools/list
```
- Screenshots land in `.data/e2e-shots/`. Look at them with the Read tool.
- Each run of `cdp.cjs` uses a fresh browser profile.
- A step that navigates (login submit) must end there. Put the next check in a new step.
- To stop the background server on Windows: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess`.

## Architecture
```
shared/  test format + logic used everywhere (imported as @ielts/shared, TS source; bundled into the server and the web)
  src/schema/{common,groups,test}.ts   zod schemas: TestDocument, 23 question types (objective, writing, speaking), charts
  src/validate.ts      validateTest(): zod + cross-checks, errors as {path, message}; reports ALL problems in one pass
  src/document.ts      listItems, splitDocument/joinDocument (DB columns), toPublicContent (strips transcripts), progressOf
  src/diff.ts          wordDiff (results page: the student's answer vs Claude's correctedText)
  src/answers.ts       normalizeAnswer, expandOptional "(the) x", countWords / fitsWordLimit / describeWordLimit
  src/scoring.ts       scoreAnswers() -> AutoScore (reasons: correct | blank | wrong | over_word_limit | likely_spelling)
  src/config/band-tables.ts   raw -> estimated band (listening, academic_reading, general_reading), scaled to 40
  src/api.ts           REST request/response types + AttemptPatch / ImportBody zod schemas, upload limits
  src/examples/        URBAN_BEEKEEPING (seed) + one example per question type (tests, and get_test_format in Phase 5)
server/  Express 5 + Drizzle (Postgres / PGlite)
  src/db/schema.ts, src/db/client.ts, drizzle/*.sql (migrations run on app start)
  src/http/app.ts      routes, helmet CSP/HSTS, session middleware, pages (/ and /login), /files/:id, /health
  src/http/security.ts cookies, CSRF (double submit: ielts_csrf cookie + X-CSRF-Token header + Origin check), rate limits
  src/auth/            scrypt password hash (format scrypt:N:r:p:salt:hash — no "$", safe in compose .env), sessions
  src/attempts/service.ts  timing, autosave merge (only changed keys), submit + scoring, auto-submit on exam expiry, results, rescore
  src/attempts/history.ts  history aggregation (per-skill bands, per-type points, mistake reasons, Claude's mistake categories; skill/since filters)
  src/tests/repository.ts  createTest / getTest / listTests / setTestStatus;  src/legacy/  old-site import (convert.ts: old -> new)
  src/import/textformat.ts the text format (HOW-TO-ADD-TESTS.md) -> old test shape -> legacy/convert.ts -> TestDocument
  src/import/service.ts    prepareImport (JSON or text, ``` fences, file names -> /files/<id>, friendly "where" per issue, summary),
                           checkImport / saveImport;  routes: POST /api/import/check, POST /api/import, GET /api/tests,
                           PATCH /api/tests/:id {status}, POST /api/files?name=
  src/files/store.ts       FileStore.save (buffer) / saveStream (uploads, size-capped)
  src/mcp/oauth.ts         OAuth 2.1 server: /.well-known/oauth-protected-resource[/mcp], /.well-known/oauth-authorization-server,
                           /oauth/register (DCR, public clients, Claude callback or loopback only), /oauth/authorize (approval page,
                           needs the site login; /login?next= comes back), /oauth/token (PKCE S256, refresh rotation), /oauth/revoke;
                           tokenVerifier for /mcp; listConnections / revokeAllConnections (Tests page card, /api/connector)
  src/mcp/index.ts         mountMcp: /mcp = cors + rate limit + requireBearerAuth (SDK) + createMcpHandler (a fresh McpServer per request)
  src/mcp/tools.ts         the 11 tools (spec §6), each logged as "[mcp] <tool> ok|refused (ms)"; applyChanges for update_test
  src/mcp/common.ts        ok / fail / logged (a ZodError becomes a refusal listing every path)
  src/mcp/study-tools.ts   Phase 8 tools: lessons, vocabulary, mistakes log
  src/study/store.ts       lessons / vocab sets + self-test log / mistakes (dedupe by pair_key, streak -> mastered at 3); routes.ts = website API; feedback-log.ts = save_feedback addToLog (once per attempt)
  src/mcp/attempts.ts      attemptDetail (question text, exact answer, accepted answers, reason, writing/speaking text, times,
                           Task 1 chart data, drill times, Part 2 notes, recording links)
  src/attempts/media.ts    saveRecording / deleteRecording (speaking), speechFor (listening read-aloud lines)
web/     Vite + TypeScript, hash router (web/src/main.ts): #/  #/done  #/mastery  #/settings  #/test/:id  #/attempt/:id  #/result/:id  #/review/:id  #/history  #/tests  #/import
  src/runner/          runner.ts (exam UI, clock, nav, review mode), render.ts (all question types), tools.ts (highlights/notes),
                       sync.ts (autosave + offline buffer in localStorage), panels.ts (settings/notes/help/audio)
  src/runner/charts.ts  Task 1 charts as SVG/HTML (palette vars --series-N in exam.css, light + dark steps)
  src/runner/extras.ts  drillBox (plan/intro timers), recorder + transcribe switch, speakingGroup (Part 2 timers), speechPlayer
  src/lib/linechart.ts  progress line chart (tooltip/crosshair/keyboard, drawn at real width) + rankedBars
  src/pages/           dashboard, start, result, history, tests, import;  src/lib/ dom/ui/api(+uploadFile, XHR progress)/markup/format helpers
```
- **Security rules from the spec that the code enforces:**
  - Every page, API route and file needs a login, except `/login`, `/assets/*` (hashed bundles) and `/health`.
  - The answer key and transcripts never reach the browser before submission. `/api/attempts/:id/result` returns 409 until the attempt is submitted.
  - Login lockout after 10 wrong passwords per IP for 15 minutes; only failures count.
- **localStorage holds only** the offline buffer (`ielts-buffer-<attemptId>`), display settings, the volume and a random device id. Test data lives in the DB.
- **Autosave sends only what changed**, so two devices never overwrite each other. The server merges answers and state keys shallowly.

## Deployment (Contabo VPS — shared with other projects)
- **Box:** `ssh gehad@169.58.112.108`. Key-only SSH and passwordless sudo work from this PC. **Use the Bash tool for ssh/scp.**
- **Layout:**
  - `/opt/ielts/jeemdev.IELTS`: this repo, tracking `main`.
  - `/opt/ielts/stack/`: `docker-compose.yml`, `deploy.sh`, `backup.sh`, `change-password.sh`, `.env` (chmod 600: `POSTGRES_PASSWORD`, `ADMIN_PASSWORD_HASH`) and `initial-password.txt` (removed when the owner runs `change-password.sh`).
  - Containers: `ielts-app` (internal + `edge` network, 384 MB) and `ielts-db` (postgres:17-alpine, internal only, 256 MB). Volumes: `ielts_db-data`, `ielts_uploads`.
  - Cron at 03:30 runs `backup.sh`: DB dump + uploads into `/opt/ielts/backups`, kept 14 days.
- **Routing:** a shared Caddy, `edge-caddy` in `/opt/edge`, is the ONLY container allowed to publish 80/443. Our site file is `/opt/edge/sites/ielts.caddy` (`reverse_proxy ielts-app:3000`). DNS is in Cloudflare: A record `ielts` → `169.58.112.108`, **grey cloud**.
- **The box's source of truth is the private repo `jeehadalshoapi/contaboserver`**, with a local checkout at `C:\Users\DELL\Desktop\Gehad\contaboserver`:
  - Its `ADD-PROJECT.md` is the runbook.
  - Our files are on branch **`add-ielts`** (`stack-ielts/*`, `edge/sites/ielts.caddy`), not merged into its `main`. That's the same pattern as the owner's other projects (`add-brieflix-bfx`, `add-tibot`).
  - The owner's local checkout of that repo is on another branch. Use a temporary `git worktree` and never disturb it.
  - **Commit and push there after changing anything on the box.**
- **Rules on the shared box:**
  - Never touch other projects (golazo, ti, bfx, ofq, tibot, k90).
  - No `ports:` in compose. Container names prefixed `ielts-`. `mem_limit` on every service.
  - Never `docker system prune -a`.
  - **Before any Caddy reload, run `caddy validate`.** Reload with `cd /opt/edge && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
  - Record the other sites' HTTP status codes before and after. `tradingindex-img` returned 502 even before our first change.
- **Production login checks:** never print or read the owner's password into the conversation. Run curl **on the box** with a cookie jar, reading the password file there.

## Gotchas already paid for
- **PowerShell strips double quotes** from arguments passed to native programs, so `ssh host "..."` with quotes inside breaks. The first Caddy file arrived invalid this way; Caddy refused it, so nothing broke. To send a file: `ssh host 'cat > /path' < localfile` or `scp` from the **Bash** tool.
- **The PC uses an Arabic Windows locale:**
  - Dates must be formatted with `en-GB` (done in `web/src/lib/format.ts`).
  - `<input type=number>` shows Arabic digits, so use text inputs with `inputmode="numeric"` where needed.
- **zod v4:**
  - Issues do not include the input value. `validate.ts` looks it up to tell "is required" from "wrong type".
  - A discriminated union puts the error on the `.type` / `.chartType` field.
- `el(...)` trees are deeply nested and bracket miscounts have happened twice. Run `npm run typecheck` often.
- **TypeScript 7** is the native compiler: type-checking only. Vite, esbuild and tsx do the building.
- The **server bundle** (`scripts/build-server.mjs`) keeps npm packages external and aliases `@ielts/shared` to its source. PGlite and the `drizzle-orm/pglite` driver are imported dynamically, because PGlite is a dev dependency only.
- `vitest` server tests start the real app on a random port (`server/test/helpers.ts`, `Client` keeps cookies and sends the CSRF header). The login lockout is per app instance, so lockout tests use their own server.
- `npm audit` reports 4 moderate advisories: one old esbuild inside `drizzle-kit` (dev tool only, never deployed). The suggested "fix" downgrades drizzle-kit, so it was left as is.
- **`res.sendFile` and dot-folders:** with `dotfiles: 'deny'`, a full path through `.data/` is refused (403 → 500). Pass the upload folder as `root` (done in `/files/:id`). `FileStore` also resolves a relative `UPLOAD_DIR`. The test server's uploads live in a `.data` folder so this stays covered.
- **npm workspace scripts run inside `server/`.** Scripts that take a file path resolve it from `process.env.INIT_CWD` (the folder the command was typed in).
- **JSON.parse messages** in current Node sometimes have no position (`Unexpected token ',', "…" is not valid JSON`). `jsonErrorOffset()` in `server/src/import/service.ts` finds the line and column itself.
- **CSRF is checked before the login.** A client with no CSRF cookie gets 403, not 401. Tests that expect 401 first `GET /login` to receive the cookie.
- **Backups grow with uploads:** `backup.sh` tars the whole uploads volume every night and keeps 14 days. Fine at 162 GB free (Nov 2026); revisit if many recordings are uploaded.
- **MCP SDK v2** (`@modelcontextprotocol/server` 2.4, `/express` 2.0.2, `/node` 2.1.2): a server instance serves ONE request, so `createMcpHandler(factory)` builds a fresh `McpServer` per request. `registerTool` takes a `z.object(...)` (not a raw shape). The auth-server helpers left v2 (frozen in `server-legacy`). `requireBearerAuth` rejects tokens without `expiresAt`, and with `expectedResource` it needs `AuthInfo.resource`.
- **`Referrer-Policy: no-referrer` (helmet) makes browsers send `Origin: null` on form posts.** The approval page sets `same-origin`, and its POST treats `null` like a missing Origin; the CSRF token (SameSite=Strict cookie) is the real protection.
- **CSP `form-action` also covers where a form's redirect goes.** The approval page adds the app's callback origin (e.g. `https://claude.ai`) to `form-action`, or the browser would block the redirect after **Allow**.
- OAuth authorization codes live in memory for 5 minutes: a deploy in the middle of a sign-in loses the code (Claude shows an error; connecting again works).
- **Headless Edge for the e2e checks** runs with a fake, always-allowed microphone (`--use-fake-device-for-media-stream`, in `cdp.cjs`). Its speech synthesis has voices but an utterance never ends there, so the e2e only checks that playback starts; to test silences the e2e transcript starts with `[pause 4]`.
- **MediaRecorder webm files have no duration in their header**, so a player shows 0:00 until played; the browser-measured length is stored in `files.duration_sec` and shown next to it.
- `cross-device.laptop.cjs` always prints two `ERR_INTERNET_DISCONNECTED` lines: they come from its deliberate offline step.
- **PostgreSQL `jsonb` does not keep the order of object keys** (shorter keys first). Anything shown in a fixed order (feedback `criteria`) must be sorted on the page.
- **Shell tooling on this PC:** `python3` is the Windows Store stub (does nothing); use `python`. A Bash heredoc that contains curly quotes (’ “ ”) fails to parse in the Bash tool; write such content with the Write tool (or to a scratch file) instead.
