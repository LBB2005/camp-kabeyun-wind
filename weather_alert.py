"""
Camp Kabeyun daily wind briefing.
Fetches from 4 weather sources, generates a Claude sailing summary, posts to Slack,
reads yesterday's emoji feedback, and commits the updated history.json.
"""

import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date, timezone
from math import sin, cos, atan2, radians, degrees

import pytz

import history
import slack_client
import claude_summarizer
from fetchers import nws, open_meteo, tomorrow_io, openweathermap

WINDY_URL = "https://www.windy.com/?wind,43.479,-71.236,11"
TARGET_HOUR = 9  # 9am ET sailing window

CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]


def _deg_to_cardinal(deg: float) -> str:
    return CARDINALS[round(deg / 22.5) % 16]


def _cardinal_to_deg(c: str) -> float:
    if c in CARDINALS:
        return CARDINALS.index(c) * 22.5
    return 0.0


def compute_consensus(forecasts: list[dict]) -> tuple[float, float | None, str]:
    """Returns (consensus_mph, consensus_gust_mph, consensus_direction)."""
    speeds = [f["wind_speed_mph"] for f in forecasts if f.get("wind_speed_mph") is not None]
    gusts  = [f["wind_gust_mph"]  for f in forecasts if f.get("wind_gust_mph")  is not None]

    # Circular mean for direction
    dirs = []
    for f in forecasts:
        if f.get("wind_direction_deg") is not None:
            dirs.append(f["wind_direction_deg"])
        elif f.get("wind_direction") in CARDINALS:
            dirs.append(_cardinal_to_deg(f["wind_direction"]))

    if dirs:
        rads = [radians(d) for d in dirs]
        avg_sin = sum(sin(r) for r in rads) / len(rads)
        avg_cos = sum(cos(r) for r in rads) / len(rads)
        avg_deg = (degrees(atan2(avg_sin, avg_cos)) + 360) % 360
        direction = _deg_to_cardinal(avg_deg)
    else:
        direction = "—"

    return (
        round(sum(speeds) / len(speeds), 1) if speeds else 0.0,
        round(sum(gusts)  / len(gusts),  1) if gusts  else None,
        direction,
    )


def fetch_all_sources() -> list[dict]:
    fetchers = {
        "NWS": lambda: nws.fetch(TARGET_HOUR),
        "Open-Meteo": lambda: open_meteo.fetch(TARGET_HOUR),
        "Tomorrow.io": lambda: tomorrow_io.fetch(TARGET_HOUR),
        "OpenWeatherMap": lambda: openweathermap.fetch(TARGET_HOUR),
    }
    results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {executor.submit(fn): name for name, fn in fetchers.items()}
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                results.append(future.result())
                print(f"  ✓ {name}")
            except Exception as e:
                print(f"  ✗ {name}: {e}", file=sys.stderr)
                results.append({"source": name, "error": str(e)})
    return results


def _fmt_source_row(f: dict) -> str:
    if f.get("error"):
        return f"• *{f['source']}:* unavailable ({f['error'][:60]})"
    speed = f"{f['wind_speed_mph']:.0f}" if f.get("wind_speed_mph") is not None else "?"
    gust  = f"{f['wind_gust_mph']:.0f}" if f.get("wind_gust_mph") else "—"
    dirn  = f.get("wind_direction", "?")
    return f"• *{f['source']}:*  💨 {speed} mph  ↑ gusts {gust}  ↗ {dirn}"


def build_blocks(
    forecasts: list[dict],
    consensus_mph: float,
    consensus_gust_mph: float | None,
    consensus_direction: str,
    claude_summary: str,
    today_str: str,
) -> list[dict]:
    et = pytz.timezone("America/New_York")
    now_et = datetime.now(et)
    day_label = now_et.strftime("%a %b %-d, %Y")

    gust_str = f" | gusts ~{consensus_gust_mph:.0f} mph" if consensus_gust_mph else ""
    source_rows = "\n".join(_fmt_source_row(f) for f in forecasts)

    return [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"⛵ Camp Kabeyun Wind Forecast — {day_label}"},
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": "_Alton Bay, Lake Winnipesaukee · 9am–noon window_"}],
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Raw Forecasts:*\n{source_rows}\n\n*Consensus:* ~{consensus_mph:.0f} mph {consensus_direction}{gust_str}",
            },
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": claude_summary},
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "_Alton Bay is sheltered — The Broads (center-west) may be 3–5 mph windier._"},
            ],
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"🗺️ <{WINDY_URL}|Live Wind Map — Alton Bay>"},
        },
        {"type": "divider"},
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": "_React to help me learn: 💨 windier than forecast  •  👍 about right  •  😴 calmer than forecast_"},
            ],
        },
    ]


def main():
    et = pytz.timezone("America/New_York")
    now_et = datetime.now(et)
    today_str = now_et.date().isoformat()

    slack_token = os.environ["SLACK_BOT_TOKEN"]
    channel_id  = os.environ["SLACK_CHANNEL_ID"]

    print("Loading history...")
    hist = history.load()

    # Step 1: collect yesterday's emoji feedback
    yesterday_entry = history.get_yesterday_entry(hist)
    if yesterday_entry and yesterday_entry.get("slack_message_ts"):
        print("Reading yesterday's reactions...")
        try:
            reactions = slack_client.get_reactions(slack_token, channel_id, yesterday_entry["slack_message_ts"])
            verdict   = slack_client.derive_verdict(reactions)
            yesterday_entry["feedback"] = {
                "raw_reactions": reactions,
                "verdict": verdict,
                "collected_at": now_et.isoformat(),
            }
            print(f"  Verdict: {verdict} | reactions: {reactions}")
            history.upsert_today_entry(hist, yesterday_entry)  # update with feedback
        except Exception as e:
            print(f"  Warning: could not read reactions: {e}", file=sys.stderr)

    # Step 2: fetch weather from all sources
    print("\nFetching weather sources...")
    all_fetched = fetch_all_sources()

    good_forecasts = [f for f in all_fetched if not f.get("error")]
    if len(good_forecasts) < 2:
        raise RuntimeError(f"Too few sources succeeded ({len(good_forecasts)}). Aborting.")

    consensus_mph, consensus_gust_mph, consensus_direction = compute_consensus(good_forecasts)
    print(f"\nConsensus: {consensus_mph:.0f} mph {consensus_direction}, gusts {consensus_gust_mph}")

    # Step 3: pattern analysis (if enough history)
    recent = history.get_recent_entries(hist, n=14)
    print(f"\nRunning Claude analysis ({len(recent)} feedback entries)...")
    pattern_insight = claude_summarizer.get_pattern_insight(recent, consensus_mph, consensus_direction)
    if pattern_insight:
        print(f"  Pattern: {pattern_insight}")

    # Step 4: sailing summary from Claude
    sailing_summary = claude_summarizer.get_sailing_summary(
        forecasts=good_forecasts,
        consensus_mph=consensus_mph,
        consensus_gust_mph=consensus_gust_mph,
        consensus_direction=consensus_direction,
        location_notes=hist["location"]["notes"],
        pattern_insight=pattern_insight,
    )
    print(f"\nSummary: {sailing_summary}")

    # Step 5: post to Slack
    print("\nPosting to Slack...")
    blocks = build_blocks(
        all_fetched, consensus_mph, consensus_gust_mph, consensus_direction,
        sailing_summary, today_str,
    )
    ts = slack_client.post_message(slack_token, channel_id, blocks)
    print(f"  Posted. ts={ts}")

    # Step 6: write today's entry to history
    forecasts_dict = {}
    for f in all_fetched:
        key = f["source"]
        forecasts_dict[key] = {k: v for k, v in f.items() if k != "source"}

    today_entry = {
        "date": today_str,
        "forecasts": forecasts_dict,
        "consensus_mph": consensus_mph,
        "consensus_gust_mph": consensus_gust_mph,
        "consensus_direction": consensus_direction,
        "claude_summary": sailing_summary,
        "pattern_insight": pattern_insight,
        "slack_message_ts": ts,
        "slack_channel_id": channel_id,
        "feedback": None,
    }
    history.upsert_today_entry(hist, today_entry)
    history.save(hist)
    print("  history.json updated.")


if __name__ == "__main__":
    main()
