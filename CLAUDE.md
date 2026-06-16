# Camp Kabeyun Wind Alert

Automated daily wind briefing for Camp Kabeyun sailing instructors, Alton Bay, Lake Winnipesaukee, NH.

## What this repo does

Every morning at 6am EDT, a GitHub Actions workflow runs `weather_alert.py`, which:

1. Reads yesterday's Slack message emoji reactions (💨 / 👍 / 😴) as forecast accuracy feedback
2. Fetches wind forecasts from 4 sources concurrently (NWS, Open-Meteo, Tomorrow.io, OpenWeatherMap)
3. Uses Claude to detect forecast bias patterns from historical feedback
4. Uses Claude to write a plain-English sailing conditions summary tailored to Lake Winnipesaukee
5. Posts a Block Kit Slack message to #camp-weather with raw numbers + summary + Windy.com link
6. Commits updated `history.json` back to the repo (the learning memory)

## Repo structure

```
weather_alert.py       # main script — run this
claude_summarizer.py   # Anthropic API calls (pattern analysis + sailing summary)
slack_client.py        # post messages + read reactions
history.py             # history.json read/write
history.json           # persistent memory — committed after each run
fetchers/
  nws.py               # National Weather Service (free, no key)
  open_meteo.py        # Open-Meteo (free, no key)
  tomorrow_io.py       # Tomorrow.io (needs TOMORROW_IO_API_KEY)
  openweathermap.py    # OpenWeatherMap (needs OPENWEATHERMAP_API_KEY)
.github/workflows/
  daily-weather-alert.yml  # cron at 10:00 UTC (6am EDT)
```

## Required secrets (GitHub repo → Settings → Secrets → Actions)

| Secret | Source |
|---|---|
| `SLACK_BOT_TOKEN` | api.slack.com/apps → OAuth & Permissions → Bot Token (`xoxb-...`) |
| `SLACK_CHANNEL_ID` | Right-click `#camp-weather` in Slack → View channel details → ID at bottom |
| `TOMORROW_IO_API_KEY` | console.tomorrow.io |
| `OPENWEATHERMAP_API_KEY` | openweathermap.org/api |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

## Slack app setup

1. Create app at api.slack.com/apps → "From scratch"
2. OAuth & Permissions → Bot Token Scopes: `chat:write`, `reactions:read`
3. Install to workspace
4. Copy Bot OAuth Token → `SLACK_BOT_TOKEN` secret
5. Invite bot to channel: `/invite @your-bot-name` in #camp-weather

## Feedback loop

React to each morning's Slack message:
- 💨 = windier than forecast
- 👍 = about right
- 😴 = calmer than forecast

The next morning's run reads these reactions and stores them in `history.json`. After 7+ days of feedback, Claude begins detecting patterns and adjusting its sailing summary accordingly.

## Manual test

Trigger via GitHub Actions → daily-weather-alert → Run workflow, or locally:

```bash
pip install -r requirements.txt
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_CHANNEL_ID=C0XXX
export TOMORROW_IO_API_KEY=...
export OPENWEATHERMAP_API_KEY=...
export ANTHROPIC_API_KEY=...
python weather_alert.py
```
