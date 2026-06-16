import requests

LAT = 43.4785
LON = -71.2361

CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]

def _deg_to_cardinal(deg: float) -> str:
    return CARDINALS[round(deg / 22.5) % 16]


def fetch(target_hour: int = 9) -> dict:
    """Fetch Open-Meteo hourly forecast for Alton Bay. Free, no API key."""
    params = {
        "latitude": LAT,
        "longitude": LON,
        "hourly": "windspeed_10m,windgusts_10m,winddirection_10m",
        "windspeed_unit": "mph",
        "timezone": "America/New_York",
        "forecast_days": 1,
    }
    r = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=15)
    r.raise_for_status()
    data = r.json()["hourly"]

    # data["time"] is like ["2026-06-16T00:00", "2026-06-16T01:00", ...]
    idx = target_hour  # index 9 = 09:00 local time
    idx = max(0, min(idx, len(data["windspeed_10m"]) - 1))

    speed = data["windspeed_10m"][idx]
    gust = data["windgusts_10m"][idx]
    deg = data["winddirection_10m"][idx]

    return {
        "source": "Open-Meteo",
        "wind_speed_mph": round(float(speed), 1),
        "wind_gust_mph": round(float(gust), 1) if gust is not None else None,
        "wind_direction": _deg_to_cardinal(float(deg)),
        "wind_direction_deg": float(deg),
    }
