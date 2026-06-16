import json
import os
from datetime import date, timedelta

HISTORY_PATH = os.path.join(os.path.dirname(__file__), "history.json")

LOCATION_META = {
    "name": "Alton Bay, Lake Winnipesaukee, NH",
    "lat": 43.4785,
    "lon": -71.2361,
    "notes": (
        "South end of lake, sheltered by surrounding hills. "
        "The Broads (center-west) have maximum fetch — often 3–5 mph windier than Alton Bay. "
        "Moultonborough Bay (NW arm) favors NW/N winds. "
        "SW is the dominant summer wind direction. "
        "Sea breeze often develops late morning on calm summer days."
    ),
}


def load() -> dict:
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH) as f:
            return json.load(f)
    return {"schema_version": 1, "location": LOCATION_META, "entries": []}


def save(data: dict) -> None:
    with open(HISTORY_PATH, "w") as f:
        json.dump(data, f, indent=2)


def get_entry(data: dict, target_date: str) -> dict | None:
    for entry in data["entries"]:
        if entry["date"] == target_date:
            return entry
    return None


def get_yesterday_entry(data: dict) -> dict | None:
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    return get_entry(data, yesterday)


def get_recent_entries(data: dict, n: int = 14) -> list[dict]:
    with_feedback = [
        e for e in data["entries"]
        if e.get("feedback", {}).get("verdict")
    ]
    return with_feedback[-n:]


def upsert_today_entry(data: dict, entry: dict) -> None:
    today = date.today().isoformat()
    for i, e in enumerate(data["entries"]):
        if e["date"] == today:
            data["entries"][i] = entry
            return
    data["entries"].append(entry)
