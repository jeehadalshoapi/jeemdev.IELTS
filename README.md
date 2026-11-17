# IELTS Practice Studio

A personal IELTS simulator. Build tests in the dashboard, then take them in an interface that works like the computer-delivered exam.

> **Moving to a server.** The site is being rebuilt as an online platform: a database on the VPS, login, tests uploaded by Claude through an MCP connector, and progress synced across devices. See [IELTS_PLATFORM_SPEC.md](IELTS_PLATFORM_SPEC.md).
> Until Phase 2 is done, the browser-only site described below keeps working as before.

## Platform (in development)

Needs Node.js 22 or newer.

```bash
npm install
npm test                 # all automated tests
npm run typecheck
npm run db:migrate       # create / update the database tables
npm run db:seed          # add the sample reading test
npm run db:tests         # list the tests in the database
npm run validate -- my-test.json             # check a test JSON (e.g. from Claude) without saving it
npm run db:import-legacy -- export.json      # bring in tests from the old site's "Export all" file
```

- On your PC the database is a local PGlite folder (`.data/pglite`). On the VPS, set `DATABASE_URL` in `.env` (see `.env.example`) to use PostgreSQL.
- Folders: `shared/` holds the test format (zod schemas, validation, answer helpers), `server/` the database, migrations (`server/drizzle`) and scripts.

## Open it
Double-click `index.html` (Chrome or Edge recommended). You don't need to install anything or run a server.
Tests, audio and results are saved in this browser on this computer, so use **Export all** now and then as a backup.

## Add a test
**→ Read [HOW-TO-ADD-TESTS.md](HOW-TO-ADD-TESTS.md).** It explains the text-file format, every question type, and has an AI prompt for converting PDFs.

The fastest way is with a text file:
1. Copy a template from the [templates](templates/) folder (`reading-template.txt`, `listening-template.txt`, `writing-template.txt`).
2. Replace the example content with your test, then save.
3. Dashboard → **⭳ Import** → select the `.txt` file, plus its audio and pictures (hold Ctrl). You can also drag the files onto the page.

You can also build a test in the editor (**＋ New test**) and fix any imported test there.

## Full test mode
Dashboard → **🏁 Full test**: Listening → Reading → Writing back-to-back, with one result page and an overall band at the end.

## Exam tools
- Highlights and notes: select text, then right-click or use the pop-up menu.
- Timer: warnings at 10 and 5 minutes. Click the timer to hide it.
- Question navigator with answered and "Review" markers. Use ◀ ▶ or Alt + ← / →.
- Matching: drag and drop, or click an option and then a box.
- Resizable passage/question split, text size, and colour schemes (white on black, yellow on black). Full screen.
- Exam mode (strict) or Practice mode (pause, replay audio, change speed).
- Auto-save: close the page and resume later.
- Results: score, estimated band, breakdown by part and question type, and a review of your answers inside the test view.
