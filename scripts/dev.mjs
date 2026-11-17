// npm run dev — the API server (port 3000, restarts on changes) and the website (port 5173, live reload) together.
import { spawn } from 'node:child_process';

const run = (name, cmd, color) => {
  const p = spawn(cmd, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const out = stream => d => stream.write(d.toString().split('\n').filter(Boolean).map(l => prefix + l).join('\n') + '\n');
  p.stdout.on('data', out(process.stdout));
  p.stderr.on('data', out(process.stderr));
  return p;
};

const children = [
  run('server', 'npx tsx watch --clear-screen=false server/src/main.ts', 36),
  run('web', 'npx vite web', 35)
];
const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Open http://localhost:5173  (development password: ielts-dev, unless ADMIN_PASSWORD_HASH is set)');
