import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, partSpeech, speechLines, validateTest, type TodayResponse } from '@ielts/shared';
import { sanitizeSvg, SvgError } from '../src/files/svg';
import { getPlan, setPlan, today } from '../src/study/plan';
import { createTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

let srv: TestServer;
let me: Client;
const json = async <T>(r: Response) => (await r.json()) as T;

beforeAll(async () => {
  srv = await startServer();
  me = new Client(srv.url);
  expect((await me.login()).status).toBe(200);
});
afterAll(async () => { await srv.close(); });

describe('SVG from Claude is cleaned', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><title>Map</title><rect x="1" y="2" width="30" height="20" fill="#eee" stroke="#333"/><text x="5" y="15" font-size="8">A &amp; B</text><path d="M0 0L10 10" marker-end="url(#arrow)"/><defs><marker id="arrow"><path d="M0 0L4 2L0 4z"/></marker></defs></svg>';

  it('keeps plain drawing as it is', () => {
    const r = sanitizeSvg(ok);
    expect(r.removed).toEqual([]);
    expect(r.svg).toContain('<rect x="1" y="2" width="30" height="20" fill="#eee" stroke="#333"/>');
    expect(r.svg).toContain('A &amp; B');
    expect(r.svg).toContain('marker-end="url(#arrow)"');
  });

  it('removes scripts, event handlers, external links and other unsafe parts', () => {
    const r = sanitizeSvg('<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><a href="https://evil.example"><text>x</text></a>'
      + '<image href="https://evil.example/x.png"/><foreignObject><div>hi</div></foreignObject><rect width="5" height="5" fill="url(https://evil.example/p)" style="fill:red; background:url(javascript:alert(1))"/>'
      + '<use href="https://evil.example/s.svg#x"/><use href="#ok"/></svg>');
    expect(r.svg).not.toMatch(/script|onload|evil|foreignObject|<image|<a\b|javascript/i);
    expect(r.svg).toContain('style="fill:red"');
    expect(r.svg).toContain('<use href="#ok"/>');
    expect(r.removed).toEqual(expect.arrayContaining(['<script>', 'event handlers (on…)', '<a>', '<image>', '<foreignobject>', 'links outside the drawing', 'unsafe value in fill']));
  });

  it('refuses what it cannot clean', () => {
    const bad = ['<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>', '<svg viewBox="0 0 1 1"><g></svg>', '<div>no</div>', '<svg><rect/></svg>', `<svg viewBox="0 0 1 1">${'x'.repeat(500 * 1024)}</svg>`];
    for (const b of bad) expect(() => sanitizeSvg(b)).toThrow(SvgError);
  });
});

describe('listening pauses and reading time', () => {
  it('reads "[pause 30]" as a silence and adds the reading time before a part', () => {
    expect(speechLines('A: one [pause 30] two\n[10 second pause]')).toEqual([
      { speaker: 'A', text: 'one' }, { speaker: 'A', text: '', pauseSec: 30 }, { speaker: 'A', text: 'two' }, { speaker: 'A', text: '', pauseSec: 10 }]);
    const part = { id: 'p1', title: 'Part 2', transcript: 'Guide: Welcome.', questionGroups: [] } as never;
    expect(partSpeech(part, [11, 15, 20]).slice(0, 2)).toEqual([
      { speaker: null, text: 'You now have 30 seconds to look at questions 11 to 20.' }, { speaker: null, text: '', pauseSec: 30 }]);
    expect(partSpeech({ ...(part as object), readingTimeSec: 0 } as never, [11])).toHaveLength(1);
    expect(partSpeech({ ...(part as object), transcript: 'You now have 20 seconds to look at questions 1 to 5. [pause 20] Man: Hi' } as never, [1, 5])[0]!.text).toMatch(/^You now have 20/);
  });

  it('the read-aloud endpoint sends the reading time first', async () => {
    const { id: testId } = await createTest(srv.database.db, exampleTestForType('form_completion'), { source: 'claude' });
    const att = await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode: 'exam' }));
    const s = await json<{ lines: Array<{ text: string; pauseSec?: number }> }>(await me.get(`/api/attempts/${att.id}/speech/p1`));
    expect(s.lines[0]!.text).toBe('You now have 30 seconds to look at questions 1 to 2.');
    expect(s.lines[1]!.pauseSec).toBe(30);
  });
});

describe('map labelling from data', () => {
  const ex = exampleTestForType('map_labelling') as { parts: Array<{ questionGroups: Array<Record<string, unknown>> }> };
  const withMap = (g: Record<string, unknown>) => ({ ...ex, parts: [{ ...ex.parts[0], questionGroups: [g] }] });
  it('takes "map" features instead of a picture, but needs one of the two', () => {
    const { imageUrl: _drop, ...g } = ex.parts[0]!.questionGroups[0]!;
    expect(validateTest(withMap({ ...g, map: { features: [{ label: 'A', shape: 'point', x: 20, y: 30 }, { label: 'Main entrance', x: 50, y: 95, width: 20, height: 6 }] } })).ok).toBe(true);
    const none = validateTest(withMap(g));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0]!.message).toContain('a map is needed');
    expect(validateTest(withMap({ ...g, imageUrl: '/files/abc', map: { features: [{ label: 'A', x: 1, y: 1 }] } })).ok).toBe(false);
  });
});

describe('study plan', () => {
  it('saves days, keeps block status when a day is replaced, refuses duplicate block ids, and ticks a block when its test is submitted', async () => {
    const { id: testId } = await createTest(srv.database.db, exampleTestForType('tfng'), { source: 'claude' });
    await setPlan(srv.database.db, { days: [
      { day: 24, date: '2026-11-18', title: 'Thesis precision', skill: 'writing', blocks: [{ id: 'd24b1', title: 'TFNG drill', minutes: 12, testId }, { id: 'd24b2', title: 'Lesson', lessonId: 'day24-x' }] },
      { day: 25, date: '2026-11-19', title: 'Review day', blocks: [{ id: 'd25b1', title: 'Re-test' }] },
      { day: 23, date: '2026-11-17', title: 'Band 6/7/8', blocks: [{ id: 'd23b1', title: 'Old homework' }, { id: 'd23b2', title: 'Done', status: 'done' }] }
    ] });
    expect((await me.patch('/api/plan/blocks/d24b2', { status: 'skipped' })).status).toBe(200);
    // the same day again (other title): the skipped status stays
    await setPlan(srv.database.db, { days: [{ day: 24, date: '2026-11-18', title: 'Thesis precision (v2)', blocks: [{ id: 'd24b1', title: 'TFNG drill', testId }, { id: 'd24b2', title: 'Lesson' }] }] });
    await expect(setPlan(srv.database.db, { days: [{ day: 26, date: '2026-11-20', title: 'x', blocks: [{ id: 'd23b1', title: 'clash' }] }] })).rejects.toThrow('already used on day 23');

    const att = await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode: 'practice' }));
    await me.post(`/api/attempts/${att.id}/submit`, { answers: { q1: 'TRUE' } });

    const t = await json<TodayResponse>(await me.get('/api/plan/today?date=2026-11-18'));
    expect(t.today).toMatchObject({ day: 24, title: 'Thesis precision (v2)', done: 2, total: 2 });
    expect(t.today!.blocks.map(b => b.status)).toEqual(['done', 'skipped']);
    expect(t.links.tests[testId]).toBe('Example — tfng');
    expect(t.pending.map(p => p.block.id)).toEqual(['d23b1']);
    expect(t.review).toBeNull();
    expect((await me.get('/api/plan/today?date=tomorrow')).status).toBe(400);

    const none = await today(srv.database.db, '2026-11-01');
    expect(none.today).toBeNull();
    expect(none.next?.day).toBe(23);
    expect((await getPlan(srv.database.db)).map(d => d.day)).toEqual([23, 24, 25]);
  });

  it('every 5th day reminds to re-test the sets met so far', async () => {
    await srv.database.db.execute('select 1');
    const { upsertVocabSet } = await import('../src/study/store');
    await upsertVocabSet(srv.database.db, { id: 'set-1', number: 1, theme: 'Trends', studyDay: 18, words: [{ word: 'dwindle' }] });
    await upsertVocabSet(srv.database.db, { id: 'set-9', number: 9, theme: 'Later', studyDay: 40, words: [{ word: 'x' }] });
    const t = await today(srv.database.db, '2026-11-19'); // day 25
    expect(t.review).toEqual({ day: 25, sets: [{ id: 'set-1', number: 1, theme: 'Trends' }] });
  });
});
