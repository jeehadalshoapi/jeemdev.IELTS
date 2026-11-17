import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns changes in src/db/schema.ts into a new SQL migration in ./drizzle
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle'
});
