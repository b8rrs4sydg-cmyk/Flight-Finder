// Build step of the Cloudflare deploy: the page is static, so there is nothing to compile. Sanity-check the inputs instead,
// so a broken checkout fails here and not after the deploy.
import { existsSync, readFileSync } from 'node:fs';

for (const f of ['public/index.html', 'worker/index.js', 'migrations/0001_init.sql', 'wrangler.toml']) {
  if (!existsSync(f)) {
    console.error(`[build] missing ${f}`);
    process.exit(1);
  }
}
if (!readFileSync('public/index.html', 'utf8').includes('id="fare-snapshot"')) {
  console.error('[build] public/index.html has no embedded fare snapshot');
  process.exit(1);
}
console.log('[build] ok');
