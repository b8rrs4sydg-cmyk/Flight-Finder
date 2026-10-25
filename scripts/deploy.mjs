// Deploy command of the Cloudflare deploy (Workers Builds runs `npm run deploy`):
//   1. apply the D1 migrations (idempotent),
//   2. make sure a private AUTH_SECRET exists (GENERATED_AUTH_SECRET: created once, then kept),
//   3. deploy the Worker with the static assets.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '.wrangler-config' };
const wrangler = (...args) => execFileSync('npx', ['--no-install', 'wrangler', ...args], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const run = (...args) => execFileSync('npx', ['--no-install', 'wrangler', ...args], { env, stdio: 'inherit' });

function secretNames() {
  try {
    return new Set(JSON.parse(wrangler('secret', 'list', '--format', 'json')).map(s => s.name));
  } catch {
    return new Set();   // the Worker does not exist yet (first deploy)
  }
}

console.log('[deploy] applying database migrations');
run('d1', 'migrations', 'apply', 'DB', '--remote');

const args = ['deploy'];
const have = secretNames();
let dir = null;
if (!have.has('GENERATED_AUTH_SECRET')) {
  dir = mkdtempSync(join(tmpdir(), 'ff-secrets-'));
  const file = join(dir, 'secrets.env');
  writeFileSync(file, `GENERATED_AUTH_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  args.push('--secrets-file', file);
  console.log('[deploy] generating a private AUTH_SECRET (kept for later deploys)');
}
try {
  run(...args);
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
console.log('[deploy] done');
