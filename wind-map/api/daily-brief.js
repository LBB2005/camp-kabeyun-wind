// Daily Camp Kabeyun wind + weather brief — Vercel Cron -> Slack.
// Uses the shared weighted-ensemble forecast (lib/forecast) so it matches the map,
// posts via bot token (chat.postMessage) when available else Incoming Webhook,
// and runs the learning loop (lib/learn) when a bot token + KV are configured.

import { getForecast } from "../lib/forecast.js";
import { MAP_URL, TZ, CHANNEL_ID } from "../lib/config.js";
import { learnBias } from "../lib/learn.js";

function fmtDate(iso) {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
}
function etHour() {
  return parseInt(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: TZ }).format(new Date()), 10);
}

function buildMessage(f) {
  const lines = f.windows.map((s) => {
    const g = s.gustPeak > s.hi + 3 ? ` (g${s.gustPeak})` : "";
    return `${s.icon} *${s.label}* _(${s.time})_ — ${s.tag}\n    ${s.dom} ${s.lo}–${s.hi} kn${g} · ${s.wx} · ${s.note}`;
  });
  const temps = f.windows.map((w) => w.temp).filter((t) => t != null);
  const tempLine = temps.length ? `🌡️ ${Math.min(...temps)}–${Math.max(...temps)}°F` : "";
  const banner = f.windows.some((w) => w.thunder) ? "\n⚠️ *Thunderstorms in the forecast today — watch the holds below.*" : "";
  const calib = Math.abs(f.windBias) >= 1 ? `\n📈 Calibrated ${f.windBias > 0 ? "+" : ""}${Math.round(f.windBias)} kn from your recent feedback.` : "";

  return (
`⛵ *Camp Kabeyun — Wind & Weather Brief*
_Fort Point, Alton Bay · ${fmtDate(f.day)}_${banner}

${lines.join("\n\n")}

${tempLine}  ·  📊 ${f.confidence}${calib}
🗺️ *Tap for live map:* <${MAP_URL}|Alton Bay — wind · depth · course axis>
_Sources: ${f.sources}.  React to calibrate:_  👍 spot-on · 💨 windier · 😴 calmer`
  );
}

async function postSlack(text) {
  // Webhook is primary (proven, no channel-membership dependency). Bot token is a fallback.
  const wh = process.env.SLACK_WEBHOOK_URL;
  if (wh) {
    const r = await fetch(wh, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (r.ok) return;
  }
  const bot = process.env.SLACK_BOT_TOKEN;
  if (bot) {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${bot}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: CHANNEL_ID, text, unfurl_links: false, unfurl_media: false }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(`Slack chat.postMessage: ${j.error}`);
    return;
  }
  throw new Error("no Slack credential (SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN)");
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const preview = req.query && req.query.preview === "1";
  const force = req.query && req.query.force === "1";
  if (secret && !preview) {
    const auth = req.headers["authorization"] === `Bearer ${secret}`;
    const key = req.query && req.query.key === String(secret);
    if (!auth && !key) return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  // DST-safe 6am: cron fires at 10 & 11 UTC; only post when it's 6am in NH.
  // preview and ?force=1 bypass the guard (for testing).
  if (!preview && !force && etHour() !== 6) {
    return res.status(200).json({ ok: true, skipped: true, reason: `not 6am ET (now ${etHour()})` });
  }

  try {
    const bias = await learnBias(process.env.SLACK_BOT_TOKEN).catch(() => 0);
    const f = await getForecast(bias);
    const text = buildMessage(f);
    if (preview) return res.status(200).json({ ok: true, text, bias });
    await postSlack(text);
    return res.status(200).json({ ok: true, posted: true, bias });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
