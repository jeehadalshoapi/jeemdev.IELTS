// Make a password hash for ADMIN_PASSWORD_HASH.
//   npm run hash-password -- "my password"          (development)
//   printf '%s' "$PW" | node server/dist/hash-password.js   (on the server; keeps the password out of shell history)
import { hashPassword } from '../auth/password';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const password = process.argv[2] ?? (await readStdin());
if (!password) {
  console.error('Usage: hash-password "your password"   (or pipe the password in)');
  process.exit(1);
}
try {
  console.log(await hashPassword(password));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
