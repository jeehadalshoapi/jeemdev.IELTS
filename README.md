# IELTS Practice Platform

A private IELTS practice site at **https://ielts.jeemdev.net**. Claude writes tests and homework, you take them on any device (phone or laptop), and your progress is saved on the server. The full plan is in [IELTS_PLATFORM_SPEC.md](IELTS_PLATFORM_SPEC.md).

| Phase | What | Status |
|---|---|---|
| 1 | Test format (zod), database, migrations, seed, legacy import | ✅ |
| 2 | Login, dashboard, test runner with server autosave and resume on any device, phone layout, deployment | ✅ |
| 3 | Auto-scoring, band estimate, results page, review in the test, history | ✅ |
| 4 | Import box (paste test JSON) | next |
| 5 | MCP server: the claude.ai connector | |
| 6 | Writing charts, plan+intro timers, speaking recording, listening speech playback | |
| 7 | Claude's feedback on the results page, progress charts | |

## Folders
- `shared/`: the test format (zod schemas, validation, answer helpers) and the API types. Used by everything else.
- `server/`: Express + PostgreSQL (Drizzle). Login, REST API, file serving, migrations (`server/drizzle`), scripts.
- `web/`: the website (TypeScript + Vite). Dashboard and the computer-delivered-IELTS-style test runner.
- `templates/`, `HOW-TO-ADD-TESTS.md`: the old text-file format. It comes back in the Phase 4 import box.

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
npm run validate -- my-test.json           # check a test JSON (e.g. from Claude) without saving it
npm run db:import-legacy -- export.json    # tests from the old browser-only site's "Export all" file
npm run hash-password -- "a password"      # a hash for ADMIN_PASSWORD_HASH
```

## How it works
- **Login:** one password. The server stores only its scrypt hash (`ADMIN_PASSWORD_HASH`). Sessions use an httpOnly cookie. Changes are protected by a CSRF token and a same-origin check. 10 wrong passwords lock that IP out for 15 minutes. Every page, API route and uploaded file needs a login, except the login page and `/health`.
- **Autosave:** each answer change is sent within a second, and a heartbeat goes every 10 seconds. Only changes are sent, so two devices never overwrite each other. Offline, unsent changes stay in the browser (the only use of localStorage besides display settings) and sync when the connection is back.
- **Clock:** exam mode runs on the wall clock: the deadline is fixed on the server and keeps running when the page is closed. When it passes, the server submits the saved answers. Practice mode counts only the time you actually spend in the test, can be paused, and closing the page pauses it.
- **Secrets stay on the server:** the answer key and listening transcripts are never sent to the browser before you submit.
- **Scoring** happens on the server when you submit, and when the exam clock runs out (`shared/src/scoring.ts`):
  - Matching ignores capital letters, extra spaces and a final full stop. Any answer in `accept[]` counts, and `(optional)` words are allowed.
  - An answer **over the word limit is wrong**. A **misspelling is wrong**, but it is labelled, and the exact typed answer is kept.
  - "Choose TWO" gives 1 mark per correct letter.
  - The raw score becomes an **estimated band** using the tables in `shared/src/config/band-tables.ts` (Listening, Academic Reading, General Training Reading), scaled when a test has fewer than 40 questions. A full mock gets a band per section.
  - When an answer key is corrected, `rescoreTestAttempts()` scores the earlier attempts again.

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
