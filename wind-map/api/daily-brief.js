// Daily Camp Kabeyun wind + weather brief — Vercel Cron -> Slack Incoming Webhook.
// Accuracy: blends NWS (official US forecast) with Open-Meteo's high-res HRRR model,
// cross-checks them, and is safety-first (takes the worse of the two for hazards).
// No API keys required.

const CAMP = { lat: 43.5260, lon: -71.2506 };
const MAP_URL = "https://wind-map.vercel.app";
const TZ = "America/New_York";
const NWS_HOURLY = "https://api.weather.gov/gridpoints/GYX/41,46/forecast/hourly"; // Gray ME office, Fort Point cell
const UA = "camp-kabeyun-weather (liamblackshawbrown@gmail.com)";

// Camp activity periods (local time) — the only windows sailing happens.
const WINDOWS = [
  { label: "Morning",   time: "9:30–12",  hrs: [9, 10, 11, 12] },
  { label: "Afternoon", time: "3–5pm",    hrs: [15, 16, 17] },
  { label: "Evening",   time: "7–8:30pm", hrs: [19, 20] },
];

const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = (d) => DIRS[Math.round(d / 22.5) % 16];
const mphToKn = (m) => m * 0.868976;

function dirNote(c) {
  if (["W","WNW","NW","NNW"].includes(c)) return `${c} — offshore off Derby Mountain, flat water along the west shore`;
  if (["S","SSW","SW","SSE","SE"].includes(c)) return `${c} — blows up the bay with fetch, expect building chop`;
  if (["N","NNE","NE"].includes(c)) return `${c} — down-lake breeze, shifty near the point`;
  return `${c} — cross-bay breeze, watch for shifts`;
}
function parseMph(str) {
  const nums = (str.match(/\d+/g) || []).map(Number);
  return nums.length ? Math.max(...nums) : 0;
}

async function fetchOpenMeteo() {
  const vars = "wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,weathercode,cape,temperature_2m";
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${CAMP.lat}&longitude=${CAMP.lon}` +
    `&hourly=${vars}&wind_speed_unit=kn&temperature_unit=fahrenheit&timezone=${TZ}&forecast_days=1`;
  let d = await (await fetch(`${base}&models=gfs_hrrr`)).json();
  if (!d.hourly || d.hourly.wind_speed_10m.every(v => v == null)) {
    d = await (await fetch(base)).json(); // fall back to seamless blend
  }
  const h = d.hourly, by = {};
  const day = h.time[0].slice(0, 10);
  h.time.forEach((t, i) => {
    by[parseInt(t.slice(11, 13), 10)] = {
      w: h.wind_speed_10m[i], g: h.wind_gusts_10m[i], dir: h.wind_direction_10m[i],
      pop: h.precipitation_probability[i] ?? 0, wc: h.weathercode[i] ?? 0,
      cape: h.cape[i] ?? 0, temp: h.temperature_2m[i],
    };
  });
  return { day, by };
}

async function fetchNWS(day) {
  try {
    const r = await fetch(NWS_HOURLY, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    if (!r.ok) return null;
    const d = await r.json();
    const by = {};
    for (const p of d.properties.periods) {
      if (p.startTime.slice(0, 10) !== day) continue;
      const hr = parseInt(p.startTime.slice(11, 13), 10);
      const sf = (p.shortForecast || "").toLowerCase();
      by[hr] = {
        wkn: mphToKn(parseMph(p.windSpeed || "0")),
        pop: p.probabilityOfPrecipitation?.value ?? 0,
        thunder: sf.includes("thunder"),
        temp: p.temperature,
      };
    }
    return by;
  } catch { return null; }
}

const THUNDER_WC = new Set([95, 96, 99]);
const HEAVY_WC = new Set([65, 67, 82, 75]);

function assess(win, om, nws) {
  const winds = [], gusts = [], dirsArr = [];
  let pop = 0, thunder = false, heavy = false, omSum = 0, omN = 0, nwsSum = 0, nwsN = 0, temp = null;
  for (const hr of win.hrs) {
    const o = om.by[hr];
    if (o) {
      winds.push(o.w); gusts.push(o.g); dirsArr.push(o.dir);
      pop = Math.max(pop, o.pop);
      if (THUNDER_WC.has(o.wc)) thunder = true;
      if (HEAVY_WC.has(o.wc)) heavy = true;
      omSum += o.w; omN++;
      if (temp == null) temp = o.temp;
    }
    const n = nws && nws[hr];
    if (n) {
      winds.push(n.wkn);
      pop = Math.max(pop, n.pop);
      if (n.thunder) thunder = true;
      nwsSum += n.wkn; nwsN++;
      if (n.temp != null) temp = n.temp;
    }
  }
  if (!winds.length) return null;
  const lo = Math.round(Math.min(...winds)), hi = Math.round(Math.max(...winds));
  const gust = gusts.length ? Math.round(Math.max(...gusts)) : hi;
  const dom = dirsArr.length ? compass(dirsArr.slice().sort((a,b)=>a-b)[Math.floor(dirsArr.length/2)]) : "—";
  const disagree = omN && nwsN ? Math.abs(omSum/omN - nwsSum/nwsN) > 4 : false;
  if (pop >= 80) heavy = true;

  // safety verdict (worst-case wins)
  let icon, tag, note;
  if (thunder && pop >= 60) { icon = "🔴"; tag = "NO-GO"; note = "⚡ lightning hold — keep boats ashore"; }
  else if (thunder) { icon = "🟡"; tag = "CAUTION"; note = "⚡ storms possible — be ready to clear the water fast"; }
  else if (hi >= 25 || gust >= 32) { icon = "🔴"; tag = "NO-GO"; note = "💨 too strong — off the water"; }
  else if (hi >= 19 || gust >= 26) { icon = "🟡"; tag = "CAUTION"; note = "💨 brisk — rig down, hold younger sailors"; }
  else if (heavy || pop >= 70) { icon = "🟡"; tag = "CAUTION"; note = "☔ heavy rain / low visibility"; }
  else if (hi < 4) { icon = "🟡"; tag = "LIGHT"; note = "🪶 drifter — may not fill in"; }
  else if (hi >= 14) { icon = "✅"; tag = "GO"; note = "powered-up but manageable"; }
  else { icon = "✅"; tag = "GO"; note = "clean breeze, good for all levels"; }

  let wx;
  if (thunder) wx = `⚡ t-storms ${pop}%`;
  else if (pop >= 50) wx = `☔ showers ${pop}%`;
  else if (pop >= 20) wx = `${pop}% rain`;
  else wx = "dry";

  return { ...win, lo, hi, gust, dom, pop, thunder, temp, disagree, icon, tag, note, wx };
}

function fmtDate(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
}

async function buildMessage() {
  const om = await fetchOpenMeteo();
  const nws = await fetchNWS(om.day);
  const rows = WINDOWS.map(w => assess(w, om, nws)).filter(Boolean);
  if (!rows.length) throw new Error("no forecast data for any window");

  const lines = rows.map(s => {
    const g = s.gust > s.hi + 3 ? ` (g${s.gust})` : "";
    return `${s.icon} *${s.label}* _(${s.time})_ — ${s.tag}\n    ${s.dom} ${s.lo}–${s.hi} kn${g} · ${s.wx} · ${s.note}`;
  });

  const temps = rows.map(r => r.temp).filter(t => t != null);
  const tLo = temps.length ? Math.round(Math.min(...temps)) : null;
  const tHi = temps.length ? Math.round(Math.max(...temps)) : null;
  const tempLine = tLo != null ? `🌡️ ${tLo}–${tHi}°F` : "";

  const anyStorm = rows.some(r => r.thunder);
  const banner = anyStorm ? "\n⚠️ *Thunderstorms in the forecast today — watch the holds below.*" : "";

  const srcCount = nws ? "NWS + Open-Meteo HRRR" : "Open-Meteo HRRR (NWS unavailable)";
  const disagreeWin = rows.filter(r => r.disagree).map(r => r.label.toLowerCase());
  const conf = !nws ? "single-source" :
    disagreeWin.length ? `⚠️ models differ on ${disagreeWin.join(" & ")} wind — treat as uncertain` : "✅ NWS & HRRR agree";

  return (
`⛵ *Camp Kabeyun — Wind & Weather Brief*
_Fort Point, Alton Bay · ${fmtDate(om.day)}_${banner}

${lines.join("\n\n")}

${tempLine}  ·  📊 ${conf}
🗺️ *Tap for live map:* <${MAP_URL}|Alton Bay — wind · depth · course spots>
_Sources: ${srcCount}.  React to calibrate:_  👍 spot-on · 💨 windier · 😴 calmer`
  );
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers["authorization"] === `Bearer ${secret}`;
    const key = req.query && req.query.key === secret;
    if (!auth && !key) return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const webhook = process.env.SLACK_WEBHOOK_URL;
  try {
    const text = await buildMessage();
    if (req.query && req.query.preview === "1") return res.status(200).json({ ok: true, text });
    if (!webhook) return res.status(500).json({ ok: false, error: "SLACK_WEBHOOK_URL not set" });
    const post = await fetch(webhook, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (!post.ok) throw new Error(`Slack webhook ${post.status}: ${await post.text()}`);
    return res.status(200).json({ ok: true, posted: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
