import { spawnSync } from 'node:child_process';

const [accountId, command, ...args] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || !command) {
  throw new Error('Usage: node scripts/with-cloudflare-token.mjs ACCOUNT_ID COMMAND [ARGS...]');
}

async function readToken() {
  if (process.env.QB_D1_API_TOKEN?.trim()) return process.env.QB_D1_API_TOKEN.trim();
  process.stderr.write('Cloudflare token (hidden; used only for this command): ');
  const input = process.stdin;
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();
  return new Promise((resolve, reject) => {
    let buffer = '';
    const finish = () => {
      input.off('data', onData);
      input.pause();
      if (input.isTTY) input.setRawMode(Boolean(wasRaw));
      process.stderr.write('\n');
    };
    const onData = (chunk) => {
      if (chunk.includes('\u0003')) { finish(); reject(new Error('Cancelled')); return; }
      buffer += chunk;
      if (/[\r\n]/.test(buffer)) {
        finish();
        const token = buffer.split(/[\r\n]/, 1)[0].trim();
        if (!token) reject(new Error('No token supplied'));
        else resolve(token);
      }
    };
    input.on('data', onData);
  });
}

// Do not write credentials to a file, command argument, or inherited shell history.
const token = await readToken();
const result = spawnSync(command, args, {
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token },
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
