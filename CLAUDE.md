# Camp Kabeyun Wind

Daily sailing brief and live wind map for Alton Bay, Lake Winnipesaukee, NH. Built as a personal decision-support tool for the camp's head of sailing — go/no-go, boat assignment, and lightning holds.

## Two systems live here — only one is current

**Current: `wind-map/`** — a Vercel project. A cron posts the 6am brief to Slack, and a Leaflet page serves the live map. Both read the same forecast endpoint.

**Retired: the Python files at the repo root** (`weather_alert.py`, `fetchers/`, `claude_summarizer.py`, `history.py`, `.github/workflows/daily-weather-alert.yml`). This was v1 — a GitHub Actions cron with a flat 4-source average and a `history.json` committed back to the repo as memory. It is kept deliberately as a record of the rewrite, and is **not running**. Don't extend it; don't treat it as the source of truth. The README explains why it was replaced.

Note the two systems disagree on basics — v1 uses Alton Bay (43.4785, −71.2361) in mph, v2 uses Fort Point (43.52598, −71.25059) in knots. v2 is correct.

## How the current system works

```
wind-map/
  lib/config.js       # SINGLE SOURCE OF TRUTH — coordinates, activity windows,
                      # source weights, verdict thresholds, bias clamp
  lib/forecast.js     # 5-model weighted ensemble, confidence, verdict rules
  lib/learn.js        # Slack-reaction calibration (stateless — no DB)
  api/forecast.js     # shared endpoint; map AND brief both read this
  api/daily-brief.js  # 6am Slack post, DST-guarded
  index.html          # map, wind particles, depth + course-axis overlays
  bathy.geojson       # Alton Bay bathymetry (also used as a shoreline mask)
```

**Change thresholds in `lib/config.js`, not in the logic.** Weights, the three activity windows, and every verdict cutoff are named constants there.

**Never compute a forecast separately for the map and the brief.** They share `api/forecast.js` precisely because an earlier version computed them independently and they drifted. This is the bug the architecture exists to prevent.

**Safety rules are asymmetric on purpose** (`lib/forecast.js`):
- Rain probability is never allowed below the official NWS value.
- Thunder votes count only from storm-aware sources (NWS text, HRRR weather codes).
- The learned bias adjusts sustained wind only — it never touches thunder or gust thresholds, and the ±3 kn clamp is what guarantees it can't move a day from NO-GO to GO. Preserve that property when editing verdict logic.

**The cron fires twice** (10:00 and 11:00 UTC) and the handler posts only when it is actually 6am in New Hampshire. Cron has no concept of daylight saving; the guard has to live in the handler. Don't "simplify" this to a single schedule.

**Bathymetry is coarse near camp** — 20-foot depth bands only. It is used as a shoreline mask for course placement, not as a depth check. Don't reintroduce logic claiming to identify mark-settable depth from it.

## Environment

| Variable | Purpose |
|---|---|
| `SLACK_WEBHOOK_URL` | Primary posting path |
| `SLACK_BOT_TOKEN` | Fallback posting; also required by the calibration loop (needs `channels:history`) |
| `CRON_SECRET` | Protects the cron route |

Forecast sources (NWS, Open-Meteo) need no keys.

## Running and testing

```bash
cd wind-map && vercel dev
```

Preview the brief without posting to Slack:

```bash
curl "localhost:3000/api/daily-brief?preview=1"
```

`?force=1` bypasses the 6am guard. There is no test suite.

## Deploys

The Vercel project is **not connected to this GitHub repo** — pushing does not deploy. Ship with `vercel` from `wind-map/`.
