import type { AnswerKey, TestContent } from '@ielts/shared';
import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const testSkill = pgEnum('test_skill', ['reading', 'listening', 'writing', 'speaking', 'mixed']);
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
  feedback: jsonb('feedback').$type<Record<string, unknown>>(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('files_test_idx').on(t.testId),
  index('files_attempt_idx').on(t.attemptId)
]);

export type TestRow = typeof tests.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type FileRow = typeof files.$inferSelect;
