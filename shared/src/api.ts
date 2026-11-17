/* Types for the website <-> server REST API (shared so both sides agree). */
import { z } from 'zod';
import type { Kind, Skill, TestContent, TestStatus } from './schema/test';

export const ATTEMPT_MODES = ['exam', 'practice'] as const;
export type AttemptMode = (typeof ATTEMPT_MODES)[number];
export type AttemptStatus = 'in_progress' | 'submitted' | 'marked';

/** one answer: text / option letter, "choose TWO" letters, Task 2 drill parts */
export const AnswerValue = z.union([
  z.string().max(30000),
  z.array(z.string().max(20)).max(10),
  z.strictObject({ plan: z.string().max(15000).optional(), introduction: z.string().max(15000).optional() }),
  z.null()
]);
export type AnswerValue = z.infer<typeof AnswerValue>;

/** autosave body: only what changed since the last save */
export const AttemptPatch = z.strictObject({
  /** changed answers; null clears an answer */
  answers: z.record(z.string().max(64), AnswerValue).optional(),
  /** changed state keys (position, flags, highlights); shallow-merged */
  state: z.record(z.string().max(100), z.unknown()).optional(),
  /** seconds of active work per part since the last save */
  activeSec: z.record(z.string().max(64), z.number().min(0).max(3600)).optional(),
  /** random id of this browser, for the device log */
  device: z.string().max(64).optional()
});
export type AttemptPatch = z.infer<typeof AttemptPatch>;

export const CreateAttemptBody = z.strictObject({
  mode: z.enum(ATTEMPT_MODES).default('practice'),
  /** random id of this browser, for the device log */
  device: z.string().max(64).optional()
});

/** clock information; the server is the source of truth */
export interface Timing {
  /** whole-test limit in seconds, or null for no time limit */
  limitSec: number | null;
  /** seconds left (negative = over time in practice mode); null without a limit */
  remainingSec: number | null;
  /** exam mode: the wall-clock moment the test ends (ISO) */
  deadline: string | null;
  /** server time when this was computed (ISO) — lets the browser correct its clock */
  serverNow: string;
  /** active seconds spent, per part id, plus "total" */
  spentSec: Record<string, number>;
}

export interface PublicTest {
  id: string;
  title: string;
  skill: Skill;
  kind: Kind;
  status: TestStatus;
  instructions: string | null;
  dueDate: string | null;
  /** content without answers or transcripts */
  content: TestContent;
  marks: number;
}

export interface AttemptView {
  attempt: {
    id: string;
    testId: string;
    status: AttemptStatus;
    mode: AttemptMode;
    answers: Record<string, AnswerValue>;
    state: Record<string, unknown>;
    startedAt: string;
    submittedAt: string | null;
    /** true when the exam clock ran out and the server submitted the attempt */
    autoSubmitted: boolean;
  };
  test: PublicTest;
  timing: Timing;
}

export interface SaveResult {
  status: AttemptStatus;
  savedAt: string;
  timing: Timing;
}

export interface AttemptSummary {
  id: string;
  testId: string;
  title: string;
  skill: Skill;
  kind: Kind;
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: string;
  updatedAt: string;
  submittedAt: string | null;
  answered: number;
  items: number;
  timing: Timing;
  feedbackReady: boolean;
  autoScore: { raw?: number; total?: number; band?: number | null } | null;
}

export interface TestListItem {
  id: string;
  title: string;
  skill: Skill;
  kind: Kind;
  dueDate: string | null;
  timeLimitMin: number | null;
  marks: number;
  parts: number;
  createdAt: string;
  attemptCount: number;
  inProgressAttemptId: string | null;
}

export interface DashboardResponse {
  assigned: TestListItem[];
  inProgress: AttemptSummary[];
  completed: AttemptSummary[];
}

export interface TestDetailResponse {
  test: Omit<PublicTest, 'content'> & { timeLimitMin: number | null; parts: Array<{ id: string; title: string; skill: string | null; marks: number }> };
  attempts: AttemptSummary[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
