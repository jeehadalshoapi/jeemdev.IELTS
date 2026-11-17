import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, TestValidationError, URBAN_BEEKEEPING, validateTest } from '@ielts/shared';
import { sql } from 'drizzle-orm';
import { openDatabase, type Database } from '../src/db/client';
import { attempts, tests } from '../src/db/schema';
import { SAMPLE_TEST_ID, seedSample } from '../src/seed';
import { createTest, getTest, listTests } from '../src/tests/repository';

let database: Database;

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate();
});
afterAll(async () => { await database.close(); });

describe('migrations', () => {
  it('create the tests, attempts and files tables', async () => {
    const r = await database.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
    const names = (r as unknown as { rows: Array<{ table_name: string }> }).rows.map(x => x.table_name);
    expect(names).toEqual(expect.arrayContaining(['attempts', 'files', 'tests']));
  });

  it('can run twice', async () => {
    await expect(database.migrate()).resolves.toBeUndefined();
  });
});

describe('tests table', () => {
  it('seeds the sample reading test once', async () => {
    expect(await seedSample(database.db)).toEqual({ created: true, id: SAMPLE_TEST_ID });
    expect(await seedSample(database.db)).toEqual({ created: false, id: SAMPLE_TEST_ID });
  });

  it('stores the body and the answer key in separate columns, and reads back the same document', async () => {
    const [row] = await database.db.select().from(tests).where(sql`${tests.id} = ${SAMPLE_TEST_ID}`);
    expect(row?.title).toBe('Sample Reading — Urban Beekeeping');
    expect(row?.skill).toBe('reading');
    expect(row?.status).toBe('assigned');
    expect(JSON.stringify(row?.content)).not.toContain('accept');
    expect(row?.answerKey.q1).toEqual({ accept: ['iii'] });

    const stored = await getTest(database.db, SAMPLE_TEST_ID);
    const expected = validateTest(URBAN_BEEKEEPING);
    if (!expected.ok) throw new Error('sample invalid');
    expect(stored?.document).toEqual(expected.test);
  });

  it('rejects an invalid test with path + reason, and saves nothing', async () => {
    const before = (await listTests(database.db)).length;
    const bad = structuredClone(exampleTestForType('tfng')) as any;
    bad.answerKey.q1 = { accept: ['T'] };
    await expect(createTest(database.db, bad, { source: 'claude' })).rejects.toThrow(TestValidationError);
    try { await createTest(database.db, bad, { source: 'claude' }); } catch (e) {
      expect((e as TestValidationError).errors).toEqual([{ path: 'answerKey.q1.accept[0]', message: 'must be TRUE, FALSE or NOT GIVEN (got "T")' }]);
    }
    expect((await listTests(database.db)).length).toBe(before);
  });

  it('lists tests with marks and attempt counts, and filters', async () => {
    const { id } = await createTest(database.db, exampleTestForType('writing_task1'), { source: 'claude' });
    await database.db.insert(attempts).values([{ testId: SAMPLE_TEST_ID }, { testId: SAMPLE_TEST_ID, mode: 'exam' }]);
    const all = await listTests(database.db);
    const sample = all.find(t => t.id === SAMPLE_TEST_ID);
    expect(sample).toMatchObject({ marks: 17, attemptCount: 2, source: 'manual' });
    expect(all[0]?.id).toBe(id); // newest first
    expect((await listTests(database.db, { skill: 'writing' })).map(t => t.id)).toEqual([id]);
  });

  it('attempts must belong to an existing test, with sensible defaults', async () => {
    const [a] = await database.db.insert(attempts).values({ testId: SAMPLE_TEST_ID }).returning();
    expect(a).toMatchObject({ status: 'in_progress', mode: 'practice', answers: {}, timeSpentSec: { total: 0 }, deviceLog: [] });
    await expect(database.db.insert(attempts).values({ testId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow();
  });

  it('stores every question-type example', async () => {
    for (const type of ['mcq_multi', 'map_labelling', 'table_completion', 'writing_task2', 'speaking_part2'] as const) {
      const { id } = await createTest(database.db, exampleTestForType(type), { source: 'claude' });
      const back = await getTest(database.db, id);
      expect(back?.document.parts[0]?.questionGroups[0]?.type).toBe(type);
    }
  });
});
