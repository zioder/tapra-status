// Shared status check: probe Tapra's public endpoints and fold the result into the
// previous status. Used by the Cloudflare Worker (main checker) and scripts/check.mjs
// (GitHub Actions fallback and local runs). Only uses fetch, so it runs in both.

export const HISTORY_DAYS = 90;
const TIMEOUT_MS = 15_000;
// Slower than this counts as degraded performance.
const DEGRADED_MS = 4_000;
// A gap longer than this between two checks is not counted as checked time.
const MAX_GAP_MINUTES = 15;

const API_HEALTH = 'https://api.tapra.tn/health';
const WEBSITE = 'https://www.tapra.tn/';
const PLATFORM = 'https://platform.tapra.tn/auth/sign-in';

/** The order here is the order on the page. */
export const COMPONENTS = [
  {
    id: 'scribe',
    group: 'API',
    name: 'Tapra-Scribe',
    description: 'Speech to text: file transcription and realtime streaming'
  },
  { id: 'speak', group: 'API', name: 'Tapra-Speak', description: 'Text to speech' },
  // Tapra-Translate isn't launched yet. When it is, put this back:
  // {
  //   id: 'translate',
  //   group: 'API',
  //   name: 'Tapra-Translate',
  //   description: 'Translation between Tunisian, Arabic, French and English'
  // },
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

/**
 * Run one check and return the new status.
 * previous: the last status ({ checkedAt, history }) or null.
 * maintenance: { componentId: "note" } for planned downtime.
 * intervalMinutes: how often this checker runs (used for the first check of a day).
 */
export async function runCheck({ previous, maintenance = {}, intervalMinutes = 5, now = new Date() }) {
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

  // Minutes this check stands for: the real time since the last one, so the
  // "about N min of outage" figures stay right even if a run is late.
  const sinceLast = previous?.checkedAt ? (now - new Date(previous.checkedAt)) / 60_000 : intervalMinutes;
  const minutes = sinceLast > 0 && sinceLast <= MAX_GAP_MINUTES ? sinceLast : intervalMinutes;

  const today = now.toISOString().slice(0, 10);
  const history = previous?.history || {};

  // Drop history of components no longer listed.
  for (const id of Object.keys(history)) {
    if (!COMPONENTS.some((component) => component.id === id)) delete history[id];
  }

  const cutoff = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const components = COMPONENTS.map((component) => {
    const note = maintenance[component.id];
    let state = states[component.id];
    // A component under maintenance that is down shows as maintenance and doesn't
    // count against its uptime.
    if (note && state === 'down') state = 'maintenance';

    const days = (history[component.id] ||= {});
    const day = (days[today] ||= { n: 0, up: 0, deg: 0, down: 0, mnt: 0 });
    const key = { operational: 'up', degraded: 'deg', down: 'down', maintenance: 'mnt' }[state];
    day.n += 1;
    day[key] += 1;
    // Minutes per state, for the tooltips. Older days only have counts.
    day.min ||= { up: 0, deg: 0, down: 0, mnt: 0 };
    day.min[key] = Math.round((day.min[key] + minutes) * 10) / 10;

    for (const date of Object.keys(days)) if (date < cutoff) delete days[date];

    return { ...component, state, latencyMs: latency[component.id], note: note || null };
  });

  return { checkedAt: now.toISOString(), intervalMinutes, components, history };
}
