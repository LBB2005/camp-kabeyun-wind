// Learning loop: reads 👍/💨/😴 reactions on recent briefs and returns a rolling
// windBias (knots). Stateless — reactions live on the Slack messages themselves,
// so no database is needed. No-op (bias 0) until a bot token with channels:history
// exists and the bot is in the channel.

import { CHANNEL_ID, BIAS_CLAMP } from "./config.js";

const BRIEF_TAG = "Camp Kabeyun — Wind & Weather Brief";

// Read the last few briefs' reactions and fold them into a decayed wind bias.
// 💨 (dash) = was windier than forecast (+), 😴 (sleeping) = calmer (−), 👍 = accurate.
export async function learnBias(botToken) {
  if (!botToken) return 0;
  try {
    const r = await fetch(`https://slack.com/api/conversations.history?channel=${CHANNEL_ID}&limit=40`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const j = await r.json();
    if (!j.ok) return 0; // missing scope / not in channel -> stay neutral
    const briefs = (j.messages || []).filter((m) => (m.text || "").includes(BRIEF_TAG));
    let bias = 0, decay = 1;
    for (const m of briefs.slice(0, 6)) {       // most recent briefs, newest first
      let dash = 0, sleep = 0;
      for (const x of (m.reactions || [])) {
        if (x.name === "dash") dash = x.count;
        else if (x.name === "sleeping") sleep = x.count;
      }
      bias += decay * 0.6 * (dash - sleep);     // + => model ran light, nudge up
      decay *= 0.6;                              // recent days weigh more
    }
    return Math.max(-BIAS_CLAMP, Math.min(BIAS_CLAMP, bias));
  } catch {
    return 0;
  }
}
