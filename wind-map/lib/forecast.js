// Weighted multi-source forecast ensemble for Camp Kabeyun.
// Blends NWS + 4 Open-Meteo models (HRRR, ECMWF, ICON, GFS) into a "most likely"
// value per variable, with spread-based confidence and safety-first hazard rules.

import { CAMP, TZ, NWS_HOURLY, UA, WINDOWS, SOURCE_WEIGHTS, OPEN_METEO_MODELS, GRID, THRESH } from "./config.js";

const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export const compass = (d) => DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const CARD2DEG = Object.fromEntries(DIRS.map((d, i) => [d, i * 22.5]));
const mphToKn = (m) => m * 0.868976;
const THUNDER_WC = new Set([95, 96, 99]);

export function dirNote(c) {
  if (["W","WNW","NW","NNW"].includes(c)) return `${c} — offshore off Derby Mountain, flat water along the west shore`;
  if (["S","SSW","SW","SSE","SE"].includes(c)) return `${c} — blows up the bay with fetch, expect building chop`;
  if (["N","NNE","NE"].includes(c)) return `${c} — down-lake breeze, shifty near the point`;
  return `${c} — cross-bay breeze, watch for shifts`;
}

async function fetchWithTimeout(url, opts = {}, ms = 5000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      clearTimeout(t);
      if (attempt === retries) throw e;
      await new Promise((res) => setTimeout(res, 400));
    }
  }
}

// ---- weighted aggregation helpers ----
function weightedMean(samples) {
  // samples: [{ v, w }] with non-null v
  const s = samples.filter((x) => x.v != null && isFinite(x.v));
  if (!s.length) return null;
  const sw = s.reduce((a, b) => a + b.w, 0);
  return sw ? s.reduce((a, b) => a + b.v * b.w, 0) / sw : null;
}
function weightedVectorDir(samples) {
  const s = samples.filter((x) => x.v != null && isFinite(x.v));
  if (!s.length) return null;
  let x = 0, y = 0;
  for (const { v, w } of s) { const r = (v * Math.PI) / 180; x += w * Math.cos(r); y += w * Math.sin(r); }
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// ---- source fetchers ----
async function fetchEnsemble() {
  const models = Object.keys(OPEN_METEO_MODELS).join(",");
  const vars = "wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,weathercode,temperature_2m";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CAMP.lat}&longitude=${CAMP.lon}` +
    `&hourly=${vars}&wind_speed_unit=kn&temperature_unit=fahrenheit&timezone=${TZ}&forecast_days=1&models=${models}`;
  const d = await (await fetchWithTimeout(url)).json();
  const h = d.hourly || {};
  if (!h.time || !h.time.length) throw new Error("Open-Meteo empty");
  const day = h.time[0].slice(0, 10);
  // perHour[hour][srcKey] = { w, g, dir, pop, wc, temp }
  const perHour = {};
  h.time.forEach((t, i) => {
    const hr = parseInt(t.slice(11, 13), 10);
    perHour[hr] = perHour[hr] || {};
    for (const [model, key] of Object.entries(OPEN_METEO_MODELS)) {
      const w = h[`wind_speed_10m_${model}`]?.[i];
      const g = h[`wind_gusts_10m_${model}`]?.[i];
      const dir = h[`wind_direction_10m_${model}`]?.[i];
      const pop = h[`precipitation_probability_${model}`]?.[i];
      const wc = h[`weathercode_${model}`]?.[i];
      const temp = h[`temperature_2m_${model}`]?.[i];
      perHour[hr][key] = { w, g, dir, pop, wc, temp };
    }
  });
  return { day, perHour };
}

async function fetchNWS(day) {
  try {
    const r = await fetchWithTimeout(NWS_HOURLY, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    const d = await r.json();
    const periods = d?.properties?.periods;
    if (!Array.isArray(periods)) return null;
    const by = {};
    for (const p of periods) {
      if (p.startTime.slice(0, 10) !== day) continue;
      const hr = parseInt(p.startTime.slice(11, 13), 10);
      const sf = (p.shortForecast || "").toLowerCase();
      by[hr] = {
        w: mphToKn(Math.max(0, ...(p.windSpeed?.match(/\d+/g) || ["0"]).map(Number))),
        dir: CARD2DEG[p.windDirection] ?? null,
        pop: p.probabilityOfPrecipitation?.value ?? 0,
        thunder: sf.includes("thunder"),
        temp: p.temperature,
      };
    }
    return Object.keys(by).length ? by : null;
  } catch { return null; }
}

// Region grid of HRRR wind for the particle field (one multi-point call).
async function fetchGrid() {
  const { latN, latS, lonW, lonE, N } = GRID;
  const dLat = (latN - latS) / (N - 1), dLon = (lonE - lonW) / (N - 1);
  const lats = [], lons = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { lats.push((latN - r * dLat).toFixed(4)); lons.push((lonW + c * dLon).toFixed(4)); }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
    `&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=${TZ}&forecast_days=1&models=gfs_hrrr`;
  const d = await (await fetchWithTimeout(url)).json();
  const arr = Array.isArray(d) ? d : [d];
  const speed = [], dir = [];
  for (let hr = 0; hr < 24; hr++) {
    speed.push(arr.map((p) => p.hourly?.wind_speed_10m?.[hr] ?? 0));
    dir.push(arr.map((p) => p.hourly?.wind_direction_10m?.[hr] ?? 0));
  }
  return { bounds: { latN, latS, lonW, lonE }, N, speed, dir };
}

// ---- blend one hour across all present sources ----
function blendHour(omSources, nws) {
  // omSources: { hrrr:{...}, ecmwf:{...}, icon:{...}, gfs:{...} }, nws: {...}|null
  const all = { ...omSources };
  if (nws) all.nws = nws;

  const windSamples = [], gustSamples = [], dirSamples = [], popSamples = [], temps = [];
  let gustPeak = null, thunder = false, nwsPop = null;
  for (const [key, s] of Object.entries(all)) {
    const w = SOURCE_WEIGHTS[key] ?? 0;
    if (s.w != null) windSamples.push({ v: s.w, w, src: key });
    if (s.dir != null) dirSamples.push({ v: s.dir, w });
    if (s.g != null) { gustSamples.push({ v: s.g, w }); gustPeak = Math.max(gustPeak ?? 0, s.g); }
    if (s.pop != null) popSamples.push({ v: s.pop, w });
    if (s.temp != null) temps.push(s.temp);
    if (key === "nws" && s.pop != null) nwsPop = s.pop;
    // thunder votes only from storm-aware sources
    if (key === "nws" && s.thunder) thunder = true;
    if (key === "hrrr" && THUNDER_WC.has(s.wc)) thunder = true;
  }
  const w = weightedMean(windSamples);
  let pop = weightedMean(popSamples);
  if (pop != null && nwsPop != null) pop = Math.max(pop, nwsPop); // never below official
  return {
    w,
    gust: weightedMean(gustSamples),
    gustPeak,
    dir: weightedVectorDir(dirSamples),
    pop: pop ?? nwsPop ?? 0,
    temp: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    thunder,
    windSamples, // kept for confidence/spread
  };
}

export function buildHourly(ensemble, nws) {
  const hourly = {};
  for (const hr of Object.keys(ensemble.perHour).map(Number)) {
    hourly[hr] = blendHour(ensemble.perHour[hr], nws ? nws[hr] : null);
  }
  return hourly;
}

// ---- per-window assessment + verdict ----
export function assess(win, hourly, windBias = 0) {
  const hrs = win.hrs.map((h) => hourly[h]).filter((x) => x && x.w != null);
  if (!hrs.length) return null;
  const mostLikely = hrs.map((x) => x.w + windBias);
  const lo = Math.max(0, Math.round(Math.min(...mostLikely)));
  const hi = Math.max(0, Math.round(Math.max(...mostLikely)));
  const gustMean = Math.round(Math.max(...hrs.map((x) => x.gust ?? x.gustPeak ?? x.w)));   // verdict basis (blended)
  const gustPeak = Math.round(Math.max(...hrs.map((x) => x.gustPeak ?? x.gust ?? x.w)));   // display heads-up (highest model)
  const dom = compass(weightedVectorDir(hrs.map((x) => ({ v: x.dir ?? 0, w: 1 }))) ?? 0);
  const pop = Math.round(Math.max(...hrs.map((x) => x.pop ?? 0)));
  const thunder = hrs.some((x) => x.thunder);
  const temps = hrs.map((x) => x.temp).filter((t) => t != null);
  const temp = temps.length ? Math.round(temps[0]) : null;

  // confidence: spread of per-source window-mean wind speed
  const bySource = {};
  for (const x of hrs) for (const s of x.windSamples) { (bySource[s.src] = bySource[s.src] || []).push(s.v); }
  const srcMeans = Object.values(bySource).map((a) => a.reduce((p, q) => p + q, 0) / a.length);
  const spread = srcMeans.length > 1 ? Math.max(...srcMeans) - Math.min(...srcMeans) : 0;
  const confidence = spread <= 3 ? "high" : spread <= 6 ? "moderate" : "low";

  // verdict (safety-first; bias never softens hazards)
  let icon, tag, note;
  if (thunder && pop >= THRESH.thunderHoldPop) { icon = "🔴"; tag = "NO-GO"; note = "⚡ lightning hold — keep boats ashore"; }
  else if (thunder) { icon = "🟡"; tag = "CAUTION"; note = "⚡ storms possible — be ready to clear the water fast"; }
  else if (hi >= THRESH.noGoWind || gustMean >= THRESH.noGoGust) { icon = "🔴"; tag = "NO-GO"; note = "💨 too strong — off the water"; }
  else if (hi >= THRESH.cautionWind || gustMean >= THRESH.cautionGust) { icon = "🟡"; tag = "CAUTION"; note = "💨 brisk — rig down, hold younger sailors"; }
  else if (pop >= THRESH.heavyPop) { icon = "🟡"; tag = "CAUTION"; note = "☔ heavy rain / low visibility"; }
  else if (hi < THRESH.lightWind) { icon = "🟡"; tag = "LIGHT"; note = "🪶 drifter — may not fill in"; }
  else if (hi >= THRESH.briskWind) { icon = "✅"; tag = "GO"; note = "powered-up but manageable"; }
  else { icon = "✅"; tag = "GO"; note = "clean breeze, good for all levels"; }

  let wx;
  if (thunder) wx = `⚡ t-storms ${pop}%`;
  else if (pop >= 50) wx = `☔ showers ${pop}%`;
  else if (pop >= 20) wx = `${pop}% rain`;
  else wx = "dry";

  return { ...win, lo, hi, gustMean, gustPeak, dom, pop, thunder, temp, confidence, spread, icon, tag, note, wx };
}

// ---- top-level: everything both the brief and the map need ----
export async function getForecast(windBias = 0) {
  const ensemble = await fetchEnsemble();
  const [nws, grid] = await Promise.all([fetchNWS(ensemble.day), fetchGrid().catch(() => null)]);
  const hourly = buildHourly(ensemble, nws);
  const windows = WINDOWS.map((w) => assess(w, hourly, windBias)).filter(Boolean);
  const camp = {};
  for (const [hr, v] of Object.entries(hourly)) {
    camp[hr] = { w: v.w == null ? null : Math.round(v.w + windBias), gust: v.gustPeak == null ? null : Math.round(v.gustPeak), dir: v.dir == null ? null : Math.round(v.dir) };
  }
  const sources = nws ? "NWS + HRRR + ECMWF + ICON + GFS" : "HRRR + ECMWF + ICON + GFS (NWS unavailable)";
  const worst = windows.reduce((a, b) => Math.min(a, b.confidence === "high" ? 2 : b.confidence === "moderate" ? 1 : 0), 2);
  const confidence = !nws ? "single-network" : worst === 2 ? "✅ models in close agreement" : worst === 1 ? "models mostly agree" : "⚠️ models differ — treat as uncertain";
  return { day: ensemble.day, windows, camp, grid, sources, confidence, windBias };
}
