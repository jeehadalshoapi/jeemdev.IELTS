// Bundle the server (and its command-line scripts) into plain JavaScript in server/dist.
// npm packages stay external (installed in node_modules); our own shared/ code is bundled in.
import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'server/src/main.ts',
    'hash-password': 'server/src/scripts/hash-password.ts',
    migrate: 'server/src/scripts/migrate.ts',
    seed: 'server/src/scripts/seed.ts',
    'list-tests': 'server/src/scripts/list-tests.ts',
    'import-legacy': 'server/src/scripts/import-legacy.ts',
    validate: 'server/src/scripts/validate.ts'
  },
  outdir: 'server/dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias: { '@ielts/shared': './shared/src/index.ts' },
  sourcemap: true,
  logLevel: 'info'
});
