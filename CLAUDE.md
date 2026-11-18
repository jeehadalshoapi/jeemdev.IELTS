# IELTS Practice Platform — guide for Claude Code sessions

A private, single-user IELTS practice site at **https://ielts.jeemdev.net**. The owner (Gehad) studies for IELTS Academic with Claude. Claude writes tests and homework, the owner takes them on any device, and (from Phase 5) Claude reads the answers back through an MCP connector and saves feedback. The full requirements are in [IELTS_PLATFORM_SPEC.md](IELTS_PLATFORM_SPEC.md). **Read it before starting a phase.**

## Current status (update this section at the end of every phase)

| Phase | What | State |
|---|---|---|
| 1 | Test format (zod), DB tables, migrations, seed, legacy import | ✅ merged into `main` |
| 2 | Login, dashboard, runner with server autosave + resume on any device, phone layout, deployment | ✅ merged into `main`, **deployed** |
| 3 | Auto-scoring, estimated band, results page, review-in-the-test, history | ✅ done on branch **`phase-3-scoring`** (pushed). **Waiting for the owner's "go"**, then merge and deploy |
| 4 | Import box: an admin page where the owner pastes test JSON, which is validated and saved | next |
| 5 | MCP server (all tools in spec §6), auth, MCP Inspector, connect to claude.ai | |
| 6 | Task 1 chart drawing, plan+intro drill timers, speaking recording (MediaRecorder upload), listening speech synthesis from transcript | |
| 7 | Render Claude's feedback (spec §6 JSON) on the results page, progress charts | |

- `main` = Phase 2 and is what runs on the server. The server checkout `/opt/ielts/jeemdev.IELTS` tracks `main`.
- When the owner says **"go"**:
  1. `git switch main && git merge --no-ff phase-3-scoring`, then push.
  2. Deploy: `ssh gehad@169.58.112.108 'cd /opt/ielts/stack && ./deploy.sh'`.
  3. Check `curl https://ielts.jeemdev.net/health`.
  4. Create `phase-4-import-box` and start Phase 4.

### Ideas already noted for Phase 4
- A page (e.g. `#/admin/import`, login required like everything else) with a textarea for the JSON. Validate with `validateTest()` and show every issue (path + message). Show the warnings, then save with `createTest(db, input, { source: 'manual' })`. Add a `POST /api/tests` route; mind the 1 MB body limit in `express.json`.
- Optional, but it was liked: also accept the old **text format** (`templates/*.txt`, [HOW-TO-ADD-TESTS.md](HOW-TO-ADD-TESTS.md)). The old parser is `js/textformat.js` in commit `38d7c76` (`git show 38d7c76:js/textformat.js`). It produced the OLD format, so it would have to output the new `TestDocument` (see `server/src/legacy/convert.ts` for how old → new mapping works). Update HOW-TO-ADD-TESTS.md when done.
- Also useful: archive / list tests from the website (status `archived`; never hard-delete).

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
   - A listening transcript is required **unless the part has `audioUrl`** (the spec says always; relaxed so real recordings without transcripts work). The owner was told about this.
7. Deployment follows the box's own runbook (see Deployment). It does **not** ship its own reverse proxy, even though spec §8 suggested one.

## Commands
```bash
npm install
npm run dev                 # API :3000 (tsx watch) + website :5173 (Vite); dev password "ielts-dev"
npm test                    # vitest — 75 tests (shared/test, server/test)
npm run typecheck           # tsc for shared, server, web (TypeScript 7 — type-checking only)
npm run build               # vite build web -> web/dist ; esbuild server -> server/dist
npm start                   # production build on :3000
npm run db:migrate | db:seed | db:tests | db:generate   # drizzle-kit generate after editing server/src/db/schema.ts
npm run validate -- test.json              # check a test JSON without saving
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
  src/answers.ts       normalizeAnswer, expandOptional "(the) x", countWords / fitsWordLimit / describeWordLimit
  src/scoring.ts       scoreAnswers() -> AutoScore (reasons: correct | blank | wrong | over_word_limit | likely_spelling)
  src/config/band-tables.ts   raw -> estimated band (listening, academic_reading, general_reading), scaled to 40
  src/api.ts           REST request/response types + AttemptPatch zod schema
  src/examples/        URBAN_BEEKEEPING (seed) + one example per question type (tests, and get_test_format in Phase 5)
server/  Express 5 + Drizzle (Postgres / PGlite)
  src/db/schema.ts, src/db/client.ts, drizzle/*.sql (migrations run on app start)
  src/http/app.ts      routes, helmet CSP/HSTS, session middleware, pages (/ and /login), /files/:id, /health
  src/http/security.ts cookies, CSRF (double submit: ielts_csrf cookie + X-CSRF-Token header + Origin check), rate limits
  src/auth/            scrypt password hash (format scrypt:N:r:p:salt:hash — no "$", safe in compose .env), sessions
  src/attempts/service.ts  timing, autosave merge (only changed keys), submit + scoring, auto-submit on exam expiry, results, rescore
  src/attempts/history.ts  history aggregation
  src/tests/repository.ts  createTest / getTest / listTests;  src/legacy/  old-site import
web/     Vite + TypeScript, hash router (web/src/main.ts): #/  #/test/:id  #/attempt/:id  #/result/:id  #/review/:id  #/history
  src/runner/          runner.ts (exam UI, clock, nav, review mode), render.ts (all question types), tools.ts (highlights/notes),
                       sync.ts (autosave + offline buffer in localStorage), panels.ts (settings/notes/help/audio)
  src/pages/           dashboard, start, result, history;  src/lib/ dom/ui/api/markup/format helpers
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
