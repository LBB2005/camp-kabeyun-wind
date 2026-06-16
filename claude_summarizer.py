import json
import os
import anthropic

MODEL = "claude-sonnet-4-6"

LAKE_SYSTEM = """You are a sailing conditions expert for Lake Winnipesaukee, NH, writing daily briefings for Camp Kabeyun on Alton Bay.

Lake knowledge:
- Alton Bay (south end) is sheltered by surrounding hills. Wind here typically reads 20–30% lower than The Broads.
- The Broads (center-west of the lake) have maximum fetch and exposure — lightest days there still produce sailable breeze.
- Moultonborough Bay (NW arm) favors NW and N winds due to its orientation.
- SW winds are most common in summer and funnel well through the center of the lake.
- Sea breeze often develops by late morning on calm summer days, especially when temps are high.
- The camp sails regardless of conditions — this briefing is purely situational awareness for the instructor.

Write short, practical advisories. Plain English. No fluff. Max 3 sentences."""

PATTERN_SYSTEM = """You are analyzing historical forecast accuracy for a weather alert serving a sailing camp on Lake Winnipesaukee, NH."""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def get_pattern_insight(recent_entries: list[dict], today_consensus_mph: float, today_direction: str) -> str:
    """Analyze recent feedback to detect systematic forecast bias. Returns 1–2 sentences."""
    if len(recent_entries) < 7:
        return ""

    entries_summary = json.dumps(
        [
            {
                "date": e["date"],
                "consensus_mph": e.get("consensus_mph"),
                "consensus_direction": e.get("consensus_direction"),
                "feedback_verdict": e.get("feedback", {}).get("verdict"),
            }
            for e in recent_entries
        ],
        indent=2,
    )

    user_msg = f"""Here are the last {len(recent_entries)} days of forecast data with user feedback:

{entries_summary}

Today's consensus forecast: {today_consensus_mph:.1f} mph from {today_direction}.

In 1–2 sentences, note any systematic bias pattern (e.g. forecasts have consistently under- or over-estimated wind). If there is no clear pattern, say "No systematic bias detected in recent history." """

    response = _client().messages.create(
        model=MODEL,
        max_tokens=150,
        system=PATTERN_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )
    return response.content[0].text.strip()


def get_sailing_summary(
    forecasts: list[dict],
    consensus_mph: float,
    consensus_gust_mph: float | None,
    consensus_direction: str,
    location_notes: str,
    pattern_insight: str = "",
) -> str:
    """Generate a 2–3 sentence plain-English sailing conditions summary."""
    lines = []
    for f in forecasts:
        gust_str = f"{f['wind_gust_mph']:.0f} mph" if f.get("wind_gust_mph") else "—"
        lines.append(
            f"  {f['source']}: {f['wind_speed_mph']:.0f} mph {f['wind_direction']}, gusts {gust_str}"
        )

    gust_str = f", gusts ~{consensus_gust_mph:.0f} mph" if consensus_gust_mph else ""
    forecast_block = "\n".join(lines)

    pattern_block = ""
    if pattern_insight and pattern_insight != "No systematic bias detected in recent history.":
        pattern_block = f"\nHistorical pattern note: {pattern_insight}"

    user_msg = f"""Today's forecast for Alton Bay, Lake Winnipesaukee (9am–noon window):

{forecast_block}

Consensus: ~{consensus_mph:.0f} mph {consensus_direction}{gust_str}
{pattern_block}

Write a 2–3 sentence plain-English sailing conditions summary for camp staff.
Include: expected conditions on the water, whether conditions favour beginners/intermediates/advanced sailors,
any notable caveats (building or dropping wind, where to find breeze if it's light, thunderstorm risk if relevant)."""

    response = _client().messages.create(
        model=MODEL,
        max_tokens=300,
        system=LAKE_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
    )
    return response.content[0].text.strip()
