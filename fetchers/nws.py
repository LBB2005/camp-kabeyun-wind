import time
import requests

# Hardcoded for Alton Bay, NH — NWS office GYX (Gray, ME)
# Verify/refresh with: GET https://api.weather.gov/points/43.4785,-71.2361
HOURLY_FORECAST_URL = "https://api.weather.gov/gridpoints/GYX/52,35/forecast/hourly"

HEADERS = {"User-Agent": "kabeyun-wind-alert/1.0 (liamblackshawbrown@gmail.com)"}

CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]


def fetch(target_hour: int = 9) -> dict:
    """Fetch NWS hourly forecast for Alton Bay. target_hour in local (ET) 24h time."""
    for attempt in range(3):
        try:
            r = requests.get(HOURLY_FORECAST_URL, headers=HEADERS, timeout=15)
            r.raise_for_status()
            break
        except requests.RequestException as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt * 2)

    periods = r.json()["properties"]["periods"]

    # Find the period whose startTime local hour is closest to target_hour
    best = None
    best_delta = 99
    for p in periods:
        # startTime looks like "2026-06-16T09:00:00-04:00"
        hour = int(p["startTime"][11:13])
        delta = abs(hour - target_hour)
        if delta < best_delta:
            best_delta = delta
            best = p

    wind_speed_str = best.get("windSpeed", "0 mph")
    wind_speed = int(wind_speed_str.split()[0]) if wind_speed_str else 0

    gust_str = best.get("windGust")
    wind_gust = int(gust_str.split()[0]) if gust_str and gust_str != "null" else None

    return {
        "source": "NWS",
        "wind_speed_mph": float(wind_speed),
        "wind_gust_mph": float(wind_gust) if wind_gust is not None else None,
        "wind_direction": best.get("windDirection", "—"),
        "forecast_label": best.get("shortForecast", ""),
    }
