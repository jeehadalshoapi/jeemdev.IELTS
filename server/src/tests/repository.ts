import { joinDocument, parseTest, splitDocument, totalMarks, type Issue, type Kind, type Skill, type Source, type TestDocument, type TestStatus } from '@ielts/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attempts, tests, type TestRow } from '../db/schema';

export interface StoredTest {
  id: string;
  status: TestStatus;
  source: Source;
  createdAt: Date;
  updatedAt: Date;
  /** the full document including the answer key — server / Claude only */
  document: TestDocument;
}

export interface TestSummary {
  id: string;
  title: string;
  skill: Skill;
  kind: Kind;
  status: TestStatus;
  source: Source;
  dueDate: string | null;
  marks: number;
  attemptCount: number;
  createdAt: Date;
}

/**
 * Validate and save a test. Throws TestValidationError (with path + reason for every problem) when invalid.
 * `id` lets callers choose the uuid (e.g. the seed, or an import that stores files first).
 */
export async function createTest(db: Db, input: unknown, opts: { source: Source; id?: string }): Promise<{ id: string; warnings: Issue[]; test: TestDocument }> {
  const { test, warnings } = parseTest(input);
  const { meta, content, answerKey } = splitDocument(test);
  const [row] = await db.insert(tests).values({
    ...(opts.id ? { id: opts.id } : {}),
    title: meta.title,
    skill: meta.skill,
    kind: meta.kind,
    dueDate: meta.dueDate ?? null,
    instructions: meta.instructions ?? null,
    content,
    answerKey,
    source: opts.source
  }).returning({ id: tests.id });
  if (!row) throw new Error('insert returned no row');
  return { id: row.id, warnings, test };
}

function toStored(row: TestRow): StoredTest {
  const meta = {
    title: row.title, skill: row.skill, kind: row.kind,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    ...(row.dueDate ? { dueDate: row.dueDate } : {})
  };
  return {
    id: row.id, status: row.status, source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt,
    document: joinDocument(meta, row.content, row.answerKey)
  };
}

export async function getTest(db: Db, id: string): Promise<StoredTest | null> {
  const [row] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
  return row ? toStored(row) : null;
}

/**
 * Replace a test's content and answer key (e.g. Claude fixing a wrong answer). Throws TestValidationError when invalid.
 * The caller re-scores the submitted attempts (rescoreTestAttempts).
 */
export async function replaceTest(db: Db, id: string, input: unknown): Promise<{ warnings: Issue[]; test: TestDocument } | null> {
  const { test, warnings } = parseTest(input);
  const { meta, content, answerKey } = splitDocument(test);
  const [row] = await db.update(tests).set({
    title: meta.title,
    skill: meta.skill,
    kind: meta.kind,
    dueDate: meta.dueDate ?? null,
    instructions: meta.instructions ?? null,
    content,
    answerKey,
    updatedAt: new Date()
  }).where(eq(tests.id, id)).returning({ id: tests.id });
  return row ? { warnings, test } : null;
}

/** archive a test (hidden from the dashboard; attempts and results stay) or bring it back. Never hard-deletes. */
export async function setTestStatus(db: Db, id: string, status: TestStatus): Promise<{ id: string; status: TestStatus } | null> {
  const [row] = await db.update(tests).set({ status, updatedAt: new Date() }).where(eq(tests.id, id)).returning({ id: tests.id, status: tests.status });
  return row ?? null;
}

export async function listTests(db: Db, filters: { skill?: Skill; kind?: Kind; status?: TestStatus; limit?: number } = {}): Promise<TestSummary[]> {
  const where = and(
    filters.skill ? eq(tests.skill, filters.skill) : undefined,
    filters.kind ? eq(tests.kind, filters.kind) : undefined,
    filters.status ? eq(tests.status, filters.status) : undefined
  );
  const rows = await db.select().from(tests).where(where).orderBy(desc(tests.createdAt)).limit(Math.min(filters.limit ?? 50, 200));
  const ids = rows.map(r => r.id);
  const counts = ids.length
    ? await db.select({ testId: attempts.testId, n: count() }).from(attempts).where(inArray(attempts.testId, ids)).groupBy(attempts.testId)
    : [];
  const countOf = new Map(counts.map(c => [c.testId, Number(c.n)]));
  return rows.map(r => ({
    id: r.id, title: r.title, skill: r.skill, kind: r.kind, status: r.status, source: r.source, dueDate: r.dueDate,
    marks: totalMarks(r.content.parts), attemptCount: countOf.get(r.id) ?? 0, createdAt: r.createdAt
  }));
}
