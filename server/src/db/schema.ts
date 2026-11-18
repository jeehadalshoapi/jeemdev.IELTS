import type { AnswerKey, Feedback, Lesson, MistakeCategory, TestContent, VocabWordRow } from '@ielts/shared';
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const testSkill = pgEnum('test_skill', ['reading', 'listening', 'writing', 'speaking', 'vocabulary', 'mixed']);
export const testKind = pgEnum('test_kind', ['homework', 'practice', 'full_mock']);
export const testStatus = pgEnum('test_status', ['assigned', 'archived']);
export const testSource = pgEnum('test_source', ['claude', 'manual']);
export const attemptStatus = pgEnum('attempt_status', ['in_progress', 'submitted', 'marked']);
export const attemptMode = pgEnum('attempt_mode', ['exam', 'practice']);
export const fileKind = pgEnum('file_kind', ['audio', 'image', 'recording']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

/** spec §3 "tests" */
export const tests = pgTable('tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  skill: testSkill('skill').notNull(),
  kind: testKind('kind').notNull().default('practice'),
  status: testStatus('status').notNull().default('assigned'),
  dueDate: date('due_date'),
  instructions: text('instructions'),
  /** the test body (parts, passage, questions) — no answers */
  content: jsonb('content').$type<TestContent>().notNull(),
  /** answers; never sent to the browser before the attempt is submitted */
  answerKey: jsonb('answer_key').$type<AnswerKey>().notNull(),
  /** version of the content format, for future changes */
  formatVersion: integer('format_version').notNull().default(1),
  source: testSource('source').notNull().default('manual'),
  ...timestamps
}, t => [
  index('tests_status_created_idx').on(t.status, t.createdAt)
]);

/** spec §3 "attempts" (plus mode and state: see comments) */
export const attempts = pgTable('attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  testId: uuid('test_id').notNull().references(() => tests.id, { onDelete: 'restrict' }),
  status: attemptStatus('status').notNull().default('in_progress'),
  /** exam = strict timer, no pause; practice = pause allowed */
  mode: attemptMode('mode').notNull().default('practice'),
  /** { questionId: value }, autosaved */
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** seconds per part id, plus "total" */
  timeSpentSec: jsonb('time_spent_sec').$type<Record<string, number>>().notNull().default(sql`'{"total":0}'::jsonb`),
  /** where I left off and my annotations: current part/question, flags, highlights, notes */
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** per-question correct/incorrect + reason, raw score, estimated band */
  autoScore: jsonb('auto_score').$type<Record<string, unknown>>(),
  /** Claude's marking (save_feedback) */
  feedback: jsonb('feedback').$type<Feedback>(),
  /** which devices touched the attempt */
  deviceLog: jsonb('device_log').$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`)
}, t => [
  index('attempts_test_idx').on(t.testId),
  index('attempts_status_idx').on(t.status, t.updatedAt)
]);

/** uploaded audio, images and speaking recordings (stored on disk under UPLOAD_DIR) */
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: fileKind('kind').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  /** path relative to UPLOAD_DIR */
  storagePath: text('storage_path').notNull(),
  testId: uuid('test_id').references(() => tests.id, { onDelete: 'set null' }),
  attemptId: uuid('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
  /** speaking recordings: which question (item id) of the attempt this answers */
  itemId: text('item_id'),
  /** speaking recordings: length in seconds, as measured by the browser */
  durationSec: real('duration_sec'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('files_test_idx').on(t.testId),
  index('files_attempt_idx').on(t.attemptId)
]);

/** login sessions; the cookie holds a random token, the table only its SHA-256 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
  ip: text('ip')
}, t => [
  index('sessions_expires_idx').on(t.expiresAt)
]);

/* ---------- Claude connector (MCP) — OAuth 2.1, single user ---------- */

/** OAuth clients registered through dynamic client registration (RFC 7591), e.g. claude.ai */
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientName: text('client_name'),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true })
});

/** access and refresh tokens; only their SHA-256 is stored. A refresh rotation keeps the same family. */
export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<'access' | 'refresh'>().notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  clientId: text('client_id').notNull(),
  clientName: text('client_name'),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  familyId: uuid('family_id').notNull(),
  /** fingerprint of the password hash at issue time: changing the password ends every connection */
  passwordTag: text('password_tag').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true })
}, t => [
  index('oauth_tokens_family_idx').on(t.familyId),
  index('oauth_tokens_expires_idx').on(t.expiresAt)
]);

export type TestRow = typeof tests.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type FileRow = typeof files.$inferSelect;

/* ---------- study material (Phase 8): lessons, vocabulary bank, mistakes log ---------- */

/** a lesson or a permanent reference page; the whole lesson is in `document`, the columns are for lists */
export const lessons = pgTable('lessons', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  day: integer('day'),
  week: text('week'),
  skill: text('skill'),
  kind: text('kind').$type<'lesson' | 'reference'>().notNull().default('lesson'),
  document: jsonb('document').$type<Lesson>().notNull(),
  ...timestamps
}, t => [
  index('lessons_day_idx').on(t.day)
]);

export const vocabSets = pgTable('vocab_sets', {
  id: text('id').primaryKey(),
  number: integer('number'),
  theme: text('theme').notNull(),
  studyDay: integer('study_day'),
  words: jsonb('words').$type<VocabWordRow[]>().notNull(),
  ...timestamps
});

/** the self-test log ("Set 1, quiz 1: 4/7, weak: dwindle …") */
export const vocabResults = pgTable('vocab_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  setId: text('set_id').notNull().references(() => vocabSets.id, { onDelete: 'cascade' }),
  quiz: integer('quiz'),
  date: date('date').notNull(),
  score: integer('score').notNull(),
  total: integer('total').notNull(),
  weakWords: jsonb('weak_words').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  attemptId: uuid('attempt_id').references(() => attempts.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('vocab_results_set_idx').on(t.setId, t.date)
]);

/** misspelled words, grammar slips, reading traps; one row per wrong -> correct pair (pair_key) */
export const mistakes = pgTable('mistakes', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category').$type<MistakeCategory>().notNull(),
  wrong: text('wrong').notNull(),
  correct: text('correct').notNull(),
  pairKey: text('pair_key').notNull().unique(),
  rule: text('rule'),
  arabic: text('arabic'),
  source: jsonb('source').$type<{ date?: string; attemptId?: string; label?: string }>(),
  timesWrong: integer('times_wrong').notNull().default(1),
  neverAgain: boolean('never_again').notNull().default(false),
  /** correct daily reviews in a row */
  streak: integer('streak').notNull().default(0),
  status: text('status').$type<'active' | 'mastered'>().notNull().default('active'),
  lastReviewedOn: date('last_reviewed_on'),
  ...timestamps
}, t => [
  index('mistakes_category_idx').on(t.category, t.status)
]);
