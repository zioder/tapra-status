# Tapra Status

The public status page at **https://status.tapra.tn**.

It runs entirely on GitHub, away from Vercel and the GPU host, so it stays up when Tapra is down:

- `.github/workflows/check.yml` runs `scripts/check.mjs` every 5 minutes (GitHub may delay scheduled runs by a few minutes). It probes `https://api.tapra.tn/health` (one response covers Scribe, Speak and speaker detection; Translate is left out until it launches), `https://www.tapra.tn/` and `https://platform.tapra.tn/auth/sign-in`, and saves the result to `status.json` on the `data` branch (one commit, amended each run, 90 days of daily counts).
- `index.html` is a static page served by GitHub Pages from `main`. It reads `status.json` from the `data` branch and `incidents.json` from `main`.

A check slower than 4 s counts as degraded; degraded time still counts as uptime.

## Maintenance

To mark a component as under maintenance (shown in blue, not counted against uptime), add it to `maintenance.json` and push:

```json
{ "speak": "Offline while we upgrade the model." }
```

Component ids: `scribe`, `speak`, `diarization`, `website`, `platform`. Remove the entry when it's back.

## Incidents

Add incidents to `incidents.json`, newest update first. Open incidents (latest update not `resolved`/`completed`) show at the top of the page; all of them appear under Past incidents on the day they started.

```json
[
  {
    "id": "2026-10-29-scribe-latency",
    "title": "Slow transcriptions",
    "impact": "minor",
    "components": ["scribe"],
    "updates": [
      { "status": "resolved", "at": "2026-10-29T15:10:00Z", "body": "Latency is back to normal." },
      { "status": "investigating", "at": "2026-10-29T14:20:00Z", "body": "Transcriptions are taking longer than usual." }
    ]
  }
]
```

`impact`: `minor`, `major`, `critical` or `maintenance`. `status`: `investigating`, `identified`, `monitoring`, `resolved` (or `scheduled`, `in progress`, `completed` for maintenance).

## Local preview

```bash
node scripts/check.mjs data/status.json
python -m http.server 4417
```

Open http://localhost:4417. On localhost the page reads `data/status.json`; `?data=<url>` points it at any other file.
