import os
import requests
from datetime import datetime
import pytz

LAT = 43.4785
LON = -71.2361
CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]

def _deg_to_cardinal(deg: float) -> str:
    return CARDINALS[round(deg / 22.5) % 16]


def fetch(target_hour: int = 9) -> dict:
    """Fetch Tomorrow.io hourly forecast for Alton Bay. Requires TOMORROW_IO_API_KEY."""
    api_key = os.environ["TOMORROW_IO_API_KEY"]
    params = {
        "location": f"{LAT},{LON}",
        "apikey": api_key,
        "units": "imperial",
        "timesteps": "1h",
        "fields": "windSpeed,windGust,windDirection",
    }
    r = requests.get(
        "https://api.tomorrow.io/v4/weather/forecast",
        params=params,
        timeout=15,
    )
    r.raise_for_status()

    intervals = r.json()["timelines"]["hourly"]
    et = pytz.timezone("America/New_York")

    best = None
    best_delta = 99
    for interval in intervals:
        # startTime like "2026-06-16T09:00:00Z"
        dt_utc = datetime.fromisoformat(interval["time"].replace("Z", "+00:00"))
        dt_et = dt_utc.astimezone(et)
        delta = abs(dt_et.hour - target_hour)
        if delta < best_delta:
            best_delta = delta
            best = interval["values"]

    deg = best.get("windDirection", 0)
    return {
        "source": "Tomorrow.io",
        "wind_speed_mph": round(float(best.get("windSpeed", 0)), 1),
        "wind_gust_mph": round(float(best["windGust"]), 1) if best.get("windGust") else None,
        "wind_direction": _deg_to_cardinal(float(deg)),
        "wind_direction_deg": float(deg),
    }
