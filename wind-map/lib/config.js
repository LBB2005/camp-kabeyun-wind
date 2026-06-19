// Single source of truth for the Camp Kabeyun forecast system.

export const TZ = "America/New_York";
export const CAMP = { lat: 43.52598, lon: -71.25059 }; // Fort Point waterfront
export const MAP_URL = "https://wind-map.vercel.app";
export const CHANNEL_ID = "C0BATRD00HY";

// NWS gridpoint for Fort Point (Gray ME office). Hourly forecast endpoint.
export const NWS_HOURLY = "https://api.weather.gov/gridpoints/GYX/41,46/forecast/hourly";
export const UA = "camp-kabeyun-weather (liamblackshawbrown@gmail.com)";

// Camp activity periods (local time) — the only windows sailing happens.
export const WINDOWS = [
  { label: "Morning",   time: "9:30–12",  hrs: [9, 10, 11, 12] },
  { label: "Afternoon", time: "3–5pm",    hrs: [15, 16, 17] },
  { label: "Evening",   time: "7–8:30pm", hrs: [19, 20] },
];

// Weighted ensemble — "most likely" engine. Weights re-normalize over present sources.
export const SOURCE_WEIGHTS = { nws: 0.30, hrrr: 0.30, ecmwf: 0.20, icon: 0.12, gfs: 0.08 };
// Open-Meteo model id -> our source key
export const OPEN_METEO_MODELS = {
  gfs_hrrr: "hrrr",
  ecmwf_ifs025: "ecmwf",
  icon_seamless: "icon",
  gfs_seamless: "gfs",
};

// Particle-field grid bounds (region-wide so the flow fills the viewport at any zoom).
export const GRID = { latN: 44.080, latS: 42.980, lonW: -71.980, lonE: -70.620, N: 9 };

// Verdict thresholds (knots / %). Documented so they're easy to tune.
export const THRESH = {
  noGoWind: 25, noGoGust: 32,     // too strong — off the water
  cautionWind: 19, cautionGust: 26, // brisk — rig down, hold younger sailors
  heavyPop: 70,                    // heavy rain / low viz
  lightWind: 4,                    // drifter
  briskWind: 14,                   // powered-up but GO
  thunderHoldPop: 60,              // >= this with thunder => hard lightning hold
};

export const BIAS_CLAMP = 3;       // max |windBias| in knots from the learning loop
