// Daily Camp Kabeyun wind brief — runs on Vercel Cron, posts to Slack via Incoming Webhook.
// No API keys needed: free Open-Meteo forecast + a rule-based sailing read.

const CAMP = { lat: 43.5260, lon: -71.2506 };
const MAP_URL = "https://wind-map.vercel.app";
const TZ = "America/New_York";

const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = (d) => DIRS[Math.round(d / 22.5) % 16];

function dirNote(c) {
  if (["W","WNW","NW","NNW"].includes(c)) return `${c} — offshore off Derby Mountain, flat water along the west shore`;
  if (["S","SSW","SW","SSE","SE"].includes(c)) return `${c} — blows up the bay with some fetch, expect a building chop`;
  if (["N","NNE","NE"].includes(c)) return `${c} — down-lake breeze, can be shifty near the point`;
  return `${c} — cross-bay breeze, watch for shifts`;
}

function sailingRead(lo, hi, peakGust, gustySpread, bestBlock) {
  const avg = (lo + hi) / 2;
  let core;
  if (hi < 5) core = "Very light, drifter conditions — tough to keep boats moving. Good for a rules chalk-talk or light-air boat-handling, but don't expect racing.";
  else if (hi < 8) core = "A light-air day. Gentle and forgiving — ideal for beginners and trim/spinnaker drills, though the quick boats won't plane.";
  else if (hi <= 13) core = "Right in the sweet spot — steady enough to plane the faster boats and teach proper trim, manageable for most levels.";
  else if (hi <= 18) core = "A brisk, powered-up day. Great for experienced sailors and breeze-on technique; rig down and pair up newer sailors.";
  else core = "Heavy air — small-craft caution. Strong for instruction; keep beginners ashore or in a safety-boat drill and reef the bigger rigs.";
  let gust = "";
  if (peakGust >= 18 && gustySpread >= 8) gust = ` Watch the gusts to ~${Math.round(peakGust)} kn — keep crews hiking and hands on the mainsheet.`;
  else if (gustySpread >= 8) gust = ` Puffy (gusts to ~${Math.round(peakGust)} kn), so expect some big shifts in pressure.`;
  return `${core}${gust} Best pressure looks like ${bestBlock}.`;
}

function fmtDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
}

async function buildMessage() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CAMP.lat}&longitude=${CAMP.lon}` +
    `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation_probability` +
    `&wind_speed_unit=kn&temperature_unit=fahrenheit&timezone=${TZ}&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();
  const h = d.hourly;
  const day = []; // 8:00–18:00 indices
  for (let i = 8; i <= 18; i++) day.push(i);

  const winds = day.map(i => h.wind_speed_10m[i]);
  const gusts = day.map(i => h.wind_gusts_10m[i]);
  const dirsArr = day.map(i => h.wind_direction_10m[i]);
  const lo = Math.round(Math.min(...winds));
  const hi = Math.round(Math.max(...winds));
  const peakGust = Math.max(...gusts);
  const dom = compass(dirsArr.slice().sort((a, b) => a - b)[Math.floor(dirsArr.length / 2)]);
  const t0 = Math.round(h.temperature_2m[8]);
  const tMid = Math.round(h.temperature_2m[13]);
  const rainMax = Math.max(...day.map(i => h.precipitation_probability[i]));
  const gustySpread = peakGust - (lo + hi) / 2;

  // best block: hours whose wind is closest to the 8–12 kn ideal
  let bestI = day[0], bestScore = 1e9;
  for (const i of day) {
    const w = h.wind_speed_10m[i];
    const score = Math.abs(w - 10) + (i < 8 ? 5 : 0);
    if (score < bestScore) { bestScore = score; bestI = i; }
  }
  const bh = (x) => { const ap = x < 12 ? "am" : "pm"; let hh = x % 12; if (hh === 0) hh = 12; return `${hh}${ap}`; };
  const bestBlock = `around ${bh(bestI)}–${bh(Math.min(bestI + 2, 18))}`;

  const rainTxt = rainMax <= 10 ? "none, clear all day" : rainMax <= 40 ? `low chance (~${rainMax}%)` : `likely (~${rainMax}%) — keep an eye on the sky`;
  const gustTxt = peakGust > hi + 3 ? ` · peak gusts ~${Math.round(peakGust)} kn` : "";

  const text =
`⛵ *Camp Kabeyun — Daily Wind Brief*
_Fort Point, Alton Bay · ${fmtDate(h.time[0])}_

*Wind:* ${dom} ${lo}–${hi} kn${gustTxt}
*Direction:* ${dirNote(dom)}
*Temp:* ${t0}°F → ${tMid}°F  ·  *Rain:* ${rainTxt}

🌊 *Sailing read:* ${sailingRead(lo, hi, peakGust, gustySpread, bestBlock)}

🗺️ *Tap for live wind map:* <${MAP_URL}|Alton Bay — wind · depth · course spots>

_React to calibrate tomorrow:_  👍 spot-on  ·  💨 windier  ·  😴 calmer`;
  return text;
}

export default async function handler(req, res) {
  // Optional protection: if CRON_SECRET is set, require it (Vercel Cron sends it as a Bearer token).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers["authorization"] === `Bearer ${secret}`;
    const key = req.query && req.query.key === secret;
    if (!auth && !key) return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return res.status(500).json({ ok: false, error: "SLACK_WEBHOOK_URL not set" });
  try {
    const text = await buildMessage();
    const post = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!post.ok) throw new Error(`Slack webhook ${post.status}: ${await post.text()}`);
    return res.status(200).json({ ok: true, posted: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
