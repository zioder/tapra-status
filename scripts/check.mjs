// One status check: probe Tapra's public endpoints and fold the result into status.json.
// Run by GitHub Actions every 5 minutes; also runs locally: node scripts/check.mjs data/status.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'data/status.json';
const MAINTENANCE_FILE = process.argv[3] || 'maintenance.json';
const HISTORY_DAYS = 90;
const TIMEOUT_MS = 15_000;
// Slower than this counts as degraded performance.
const DEGRADED_MS = 4_000;

const API_HEALTH = 'https://api.tapra.tn/health';
const WEBSITE = 'https://www.tapra.tn/';
const PLATFORM = 'https://platform.tapra.tn/auth/sign-in';

/** The order here is the order on the page. */
const COMPONENTS = [
  {
    id: 'scribe',
    group: 'API',
    name: 'Tapra-Scribe',
    description: 'Speech to text: file transcription and realtime streaming'
  },
  { id: 'speak', group: 'API', name: 'Tapra-Speak', description: 'Text to speech' },
  {
    id: 'translate',
    group: 'API',
    name: 'Tapra-Translate',
    description: 'Translation between Tunisian, Arabic, French and English'
  },
  {
    id: 'diarization',
    group: 'API',
    name: 'Speaker detection',
    description: 'Who spoke when, in transcripts and subtitles'
  },
  { id: 'website', group: 'Web', name: 'Website', description: 'www.tapra.tn and the studios' },
  {
    id: 'platform',
    group: 'Web',
    name: 'Developer platform',
    description: 'Dashboard, API keys and billing at platform.tapra.tn'
  }
];

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'user-agent': 'tapra-status/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, ms: Date.now() - started, text };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';
    return { ok: false, status: 0, ms: Date.now() - started, text: '', error: timedOut ? 'timeout' : 'unreachable' };
  }
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** operational | degraded | down, from a probe and an optional health flag. */
function stateOf(result, healthy = result.ok) {
  if (!result.ok || !healthy) return 'down';
  return result.ms > DEGRADED_MS ? 'degraded' : 'operational';
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const [health, website, platform] = await Promise.all([
  probe(API_HEALTH),
  probe(WEBSITE),
  probe(PLATFORM)
]);
const body = health.ok ? parse(health.text) : null;
const nested = (key) => Boolean(body?.[key]?.ok);

const states = {
  scribe: stateOf(health, Boolean(body?.ok && String(body.model || '').startsWith('tapra-scribe'))),
  speak: stateOf(health, nested('speak')),
  translate: stateOf(health, nested('translate')),
  diarization: stateOf(health, nested('diarization')),
  website: stateOf(website),
  platform: stateOf(platform)
};
const latency = {
  scribe: health.ms,
  speak: health.ms,
  translate: health.ms,
  diarization: health.ms,
  website: website.ms,
  platform: platform.ms
};

// maintenance.json: { "translate": "Offline while we upgrade the model." }
// A component under maintenance that is down shows as maintenance and doesn't count
// against its uptime.
const maintenance = await readJson(MAINTENANCE_FILE, {});

const now = new Date();
const today = now.toISOString().slice(0, 10);
const previous = await readJson(OUT, { history: {} });
const history = previous.history || {};

const components = COMPONENTS.map((component) => {
  const note = maintenance[component.id];
  let state = states[component.id];
  if (note && state === 'down') state = 'maintenance';

  const days = (history[component.id] ||= {});
  const day = (days[today] ||= { n: 0, up: 0, deg: 0, down: 0, mnt: 0 });
  day.n += 1;
  day[{ operational: 'up', degraded: 'deg', down: 'down', maintenance: 'mnt' }[state]] += 1;

  // Keep the last HISTORY_DAYS days only.
  const cutoff = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const date of Object.keys(days)) if (date < cutoff) delete days[date];

  return { ...component, state, latencyMs: latency[component.id], note: note || null };
});

const status = { checkedAt: now.toISOString(), intervalMinutes: 5, components, history };
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(status));

console.log(
  components.map((c) => `${c.id.padEnd(12)} ${c.state.padEnd(12)} ${c.latencyMs}ms`).join('\n')
);
