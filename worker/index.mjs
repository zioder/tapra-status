// Main status checker: a Cloudflare Worker on a 5-minute cron. Runs off GitHub,
// Vercel and AWS, so checks keep their timing when any of them is down.
// - scheduled: probe Tapra, save status.json to KV.
// - GET /status.json: serve it to the page (CORS open, cached 30 s).
import { runCheck } from '../scripts/core.mjs';

const KEY = 'status.json';
const REPO_RAW = 'https://raw.githubusercontent.com/zioder/tapra-status';

async function fetchJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

async function check(env) {
  // History starts at the Worker's first run (launch day); the sparse pre-launch
  // checks on the GitHub data branch are not copied over.
  const previous = await env.STATUS.get(KEY, 'json');
  // maintenance.json stays hand-edited on main.
  const maintenance = await fetchJson(`${REPO_RAW}/main/maintenance.json?t=${Date.now()}`, {});
  const status = await runCheck({ previous, maintenance, intervalMinutes: 5 });
  await env.STATUS.put(KEY, JSON.stringify(status));
  return status;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS'
};

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env));
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET' || pathname !== '/status.json') {
      return new Response('Not found', { status: 404, headers: CORS });
    }
    const body = await env.STATUS.get(KEY);
    if (!body) return new Response('No data yet', { status: 503, headers: CORS });
    return new Response(body, {
      headers: {
        ...CORS,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30'
      }
    });
  }
};
