import { URBAN_BEEKEEPING } from '@ielts/shared';
import type { Db } from './db/client';
import { createTest, getTest } from './tests/repository';

/** fixed id so seeding twice does nothing */
export const SAMPLE_TEST_ID = '5a3f6c1e-0000-4000-8000-000000000001';

export async function seedSample(db: Db): Promise<{ created: boolean; id: string }> {
  if (await getTest(db, SAMPLE_TEST_ID)) return { created: false, id: SAMPLE_TEST_ID };
  await createTest(db, URBAN_BEEKEEPING, { source: 'manual', id: SAMPLE_TEST_ID });
  return { created: true, id: SAMPLE_TEST_ID };
}
