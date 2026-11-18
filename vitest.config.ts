import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts'],
    testTimeout: 30000,
    // every server test file starts its own in-memory PGlite and runs all migrations; in parallel this can take > 10 s
    hookTimeout: 90000
  }
});
