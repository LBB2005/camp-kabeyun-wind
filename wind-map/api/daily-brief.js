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

// Camp activity periods (local time) — the only windows sailing actually happens.
const WINDOWS = [
  { label: "Morning",   time: "9:30–12",  hrs: [9, 10, 11, 12] },
  { label: "Afternoon", time: "3–5pm",    hrs: [15, 16, 17] },
  { label: "Evening",   time: "7–8:30pm", hrs: [19, 20] },
];

function windRead(hi, gustySpread) {
  let s;
  if (hi < 5) s = "drifter — very light";
  else if (hi < 8) s = "light & gentle, good for beginners";
  else if (hi <= 13) s = "steady, in the sweet spot";
  else if (hi <= 18) s = "brisk, powered up — rig down newer sailors";
  else s = "heavy, small-craft caution";
  if (gustySpread >= 8) s += ", puffy";
  return s;
}

function windowStats(h, hrs) {
  const winds = hrs.map(i => h.wind_speed_10m[i]);
  const gusts = hrs.map(i => h.wind_gusts_10m[i]);
  const dirs = hrs.map(i => h.wind_direction_10m[i]);
  const lo = Math.round(Math.min(...winds));
  const hi = Math.round(Math.max(...winds));
  const peak = Math.round(Math.max(...gusts));
  const dom = compass(dirs.slice().sort((a, b) => a - b)[Math.floor(dirs.length / 2)]);
  const avg = winds.reduce((a, b) => a + b, 0) / winds.length;
  const rain = Math.max(...hrs.map(i => h.precipitation_probability[i]));
  return { lo, hi, peak, dom, avg, rain, gustySpread: peak - avg };
}

function fmtDate(iso) {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
}

async function buildMessage() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CAMP.lat}&longitude=${CAMP.lon}` +
    `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation_probability` +
    `&wind_speed_unit=kn&temperature_unit=fahrenheit&timezone=${TZ}&forecast_days=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();
  const h = d.hourly;

  const stats = WINDOWS.map(w => ({ ...w, ...windowStats(h, w.hrs) }));
  const lines = stats.map(s => {
    const gust = s.peak > s.hi + 3 ? ` (g${s.peak})` : "";
    const rain = s.rain > 40 ? ` · ☔ ~${s.rain}%` : "";
    return `• *${s.label}* _(${s.time})_ — ${s.dom} ${s.lo}–${s.hi} kn${gust} · ${windRead(s.hi, s.gustySpread)}${rain}`;
  });

  // best window = avg wind closest to the 8–12 kn ideal
  const best = stats.slice().sort((a, b) => Math.abs(a.avg - 10) - Math.abs(b.avg - 10))[0];
  const tHi = Math.round(Math.max(...WINDOWS.flatMap(w => w.hrs).map(i => h.temperature_2m[i])));
  const tLo = Math.round(Math.min(...WINDOWS.flatMap(w => w.hrs).map(i => h.temperature_2m[i])));
  const domDay = stats[0].dom;

  const text =
`⛵ *Camp Kabeyun — Daily Wind Brief*
_Fort Point, Alton Bay · ${fmtDate(h.time[0])}_

${lines.join("\n")}

🌊 *Best window:* ${best.label.toLowerCase()} (${best.time}) looks sweetest at ${best.lo}–${best.hi} kn. ${dirNote(domDay)}.
🌡️ ${tLo}–${tHi}°F across the periods.

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
