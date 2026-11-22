/* Website API for lessons, the vocabulary bank and the mistakes log (Phase 8). Mounted behind the login. */
import { BlockPatch, MISTAKE_CATEGORIES, MistakePatch, MistakeReviewBody, TodayQuery, WordPatch, type MistakeCategory } from '@ielts/shared';
import { getPlan, today, updateBlock } from './plan';
import type { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/client';
import { notFound } from '../http/errors';
import { listMastery } from './mastery';
import { makeQuiz } from './vocab-quiz';
import { getLesson, getVocabSet, listLessons, listMistakes, listVocabSets, reviewMistake, updateMistake, updateWord } from './store';

const MistakeQuery = z.strictObject({
  category: z.enum(MISTAKE_CATEGORIES).optional(),
  status: z.enum(['active', 'mastered']).optional()
});

export function mountStudyRoutes(api: Router, db: Db): void {
  /* ---------- study plan (Phase 10) ---------- */
  api.get('/plan/today', async (req, res) => { res.json(await today(db, TodayQuery.parse(req.query).date)); });
  api.get('/plan', async (_req, res) => { res.json(await getPlan(db)); });
  api.patch('/plan/blocks/:id', async (req, res) => { res.json(await updateBlock(db, req.params.id, BlockPatch.parse(req.body ?? {}).status)); });

  /* ---------- mastery ladders (Phase 12) ---------- */
  api.get('/mastery', async (_req, res) => { res.json(await listMastery(db)); });

  api.get('/lessons', async (_req, res) => { res.json(await listLessons(db)); });
  api.get('/lessons/:id', async (req, res) => {
    const v = await getLesson(db, req.params.id);
    if (!v) throw notFound('Lesson not found');
    res.json(v);
  });

  api.get('/vocab/sets', async (_req, res) => { res.json(await listVocabSets(db)); });
  api.get('/vocab/sets/:id', async (req, res) => {
    const v = await getVocabSet(db, req.params.id);
    if (!v) throw notFound('Vocabulary set not found');
    res.json(v);
  });
  /** "Test me": a quiz made from the set (an unused one is reused) */
  api.post('/vocab/sets/:id/quiz', async (req, res) => { res.json(await makeQuiz(db, req.params.id)); });
  /** the owner marks a word (flashcards, table) */
  api.patch('/vocab/sets/:id/words', async (req, res) => {
    const p = WordPatch.parse(req.body ?? {});
    res.json(await updateWord(db, req.params.id, p.word, { ...(p.status ? { status: p.status } : {}), ...(p.timesMissed !== undefined ? { timesMissed: p.timesMissed } : {}) }));
  });

  api.get('/mistakes', async (req, res) => {
    const q = MistakeQuery.parse(req.query);
    res.json(await listMistakes(db, { ...(q.category ? { category: q.category as MistakeCategory } : {}), ...(q.status ? { status: q.status } : {}) }));
  });
  api.patch('/mistakes/:id', async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success) throw notFound('Mistake not found');
    res.json(await updateMistake(db, req.params.id, MistakePatch.parse(req.body ?? {})));
  });
  api.post('/mistakes/:id/review', async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success) throw notFound('Mistake not found');
    const b = MistakeReviewBody.parse(req.body ?? {});
    res.json(await reviewMistake(db, req.params.id, b.correct, b.today));
  });
}
