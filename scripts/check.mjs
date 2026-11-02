// Fallback status check, run by GitHub Actions (the main checker is the Cloudflare
// Worker in worker/). Also runs locally: node scripts/check.mjs data/status.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runCheck } from './core.mjs';

const OUT = process.argv[2] || 'data/status.json';
const MAINTENANCE_FILE = process.argv[3] || 'maintenance.json';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const status = await runCheck({
  previous: await readJson(OUT, null),
  maintenance: await readJson(MAINTENANCE_FILE, {})
});
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(status));

console.log(
  status.components.map((c) => `${c.id.padEnd(12)} ${c.state.padEnd(12)} ${c.latencyMs}ms`).join('\n')
);
