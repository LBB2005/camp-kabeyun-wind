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
    """Fetch OpenWeatherMap 3-hour forecast for Alton Bay. Requires OPENWEATHERMAP_API_KEY."""
    api_key = os.environ["OPENWEATHERMAP_API_KEY"]
    params = {
        "lat": LAT,
        "lon": LON,
        "appid": api_key,
        "units": "imperial",
        "cnt": 8,
    }
    r = requests.get(
        "https://api.openweathermap.org/data/2.5/forecast",
        params=params,
        timeout=15,
    )
    r.raise_for_status()

    et = pytz.timezone("America/New_York")
    items = r.json()["list"]

    best = None
    best_delta = 99
    for item in items:
        dt_utc = datetime.fromtimestamp(item["dt"], tz=pytz.utc)
        dt_et = dt_utc.astimezone(et)
        delta = abs(dt_et.hour - target_hour)
        if delta < best_delta:
            best_delta = delta
            best = item

    wind = best["wind"]
    deg = wind.get("deg", 0)
    return {
        "source": "OpenWeatherMap",
        "wind_speed_mph": round(float(wind.get("speed", 0)), 1),
        "wind_gust_mph": round(float(wind["gust"]), 1) if wind.get("gust") else None,
        "wind_direction": _deg_to_cardinal(float(deg)),
        "wind_direction_deg": float(deg),
        "forecast_label": best["weather"][0]["description"] if best.get("weather") else "",
    }
