import requests

SLACK_API = "https://slack.com/api"

# Emoji names for the three feedback reactions
EMOJI_WINDIER = "wind_blowing_face"   # 💨
EMOJI_RIGHT   = "+1"                  # 👍
EMOJI_CALMER  = "sleeping"            # 😴


def post_message(token: str, channel_id: str, blocks: list) -> str:
    """Post a Block Kit message. Returns the Slack message timestamp (ts)."""
    r = requests.post(
        f"{SLACK_API}/chat.postMessage",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": channel_id, "blocks": blocks, "unfurl_links": False},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"Slack postMessage failed: {data.get('error')}")
    return data["message"]["ts"]


def get_reactions(token: str, channel_id: str, ts: str) -> dict:
    """Read emoji reactions on a message. Returns {emoji_name: count}."""
    r = requests.get(
        f"{SLACK_API}/reactions.get",
        headers={"Authorization": f"Bearer {token}"},
        params={"channel": channel_id, "timestamp": ts, "full": "true"},
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("ok"):
        return {}

    result = {}
    for reaction in data.get("message", {}).get("reactions", []):
        result[reaction["name"]] = reaction["count"]
    return result


def derive_verdict(reactions: dict) -> str:
    windier = reactions.get(EMOJI_WINDIER, 0)
    right   = reactions.get(EMOJI_RIGHT, 0)
    calmer  = reactions.get(EMOJI_CALMER, 0)

    if windier == 0 and right == 0 and calmer == 0:
        return "no_feedback"
    if windier > right and windier > calmer:
        return "windier_than_forecast"
    if calmer > right and calmer > windier:
        return "calmer_than_forecast"
    return "about_right"
