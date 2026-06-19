// Learning loop: reads 👍/💨/😴 reactions on yesterday's brief and maintains a
// rolling windBias (knots) in KV. Fully no-op until SLACK_BOT_TOKEN + KV env exist,
// so the system runs fine on the webhook-only setup.

import { CHANNEL_ID, BIAS_CLAMP } from "./config.js";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOK = process.env.KV_REST_API_TOKEN;

async function kv(cmd) {
  if (!KV_URL || !KV_TOK) return null;
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOK}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    return j.result ?? null;
  } catch { return null; }
}

export async function getBias() {
  const v = await kv(["GET", "windBias"]);
  const n = v == null ? 0 : parseFloat(v);
  return isFinite(n) ? n : 0;
}

export async function recordPost(ts, day) {
  if (!ts) return;
  await kv(["SET", "lastPost", JSON.stringify({ ts, day })]);
}

async function getLastPost() {
  const v = await kv(["GET", "lastPost"]);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}

// Read reactions on yesterday's message and nudge the bias. Returns a summary or null.
export async function learnFromYesterday(botToken) {
  if (!botToken || !KV_URL) return null;
  const last = await getLastPost();
  if (!last?.ts) return null;
  let reactions = [];
  try {
    const r = await fetch(`https://slack.com/api/reactions.get?channel=${CHANNEL_ID}&timestamp=${last.ts}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const j = await r.json();
    if (!j.ok) return null;
    reactions = j.message?.reactions || [];
  } catch { return null; }

  let dash = 0, sleep = 0, up = 0;
  for (const re of reactions) {
    if (re.name === "dash") dash = re.count;                 // 💨 windier than forecast
    else if (re.name === "sleeping") sleep = re.count;        // 😴 calmer than forecast
    else if (re.name === "thumbsup" || re.name === "+1") up = re.count; // 👍 accurate
  }
  if (dash + sleep + up === 0) return null; // no feedback yet

  const prev = await getBias();
  const net = dash - sleep; // + = was windier than we said
  let bias = (up > 0 && net === 0) ? prev * 0.6 : prev * 0.7 + 0.6 * net;
  bias = Math.max(-BIAS_CLAMP, Math.min(BIAS_CLAMP, bias));
  await kv(["SET", "windBias", String(bias)]);
  return { dash, sleep, up, prev, bias };
}
