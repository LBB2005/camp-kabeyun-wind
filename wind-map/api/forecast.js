// Shared forecast endpoint — consumed by BOTH the map (index.html) and the daily
// brief, so the two can never disagree. Edge-cached 10 min.

import { getForecast } from "../lib/forecast.js";
import { getBias } from "../lib/learn.js";

export default async function handler(req, res) {
  try {
    const bias = await getBias();
    const data = await getForecast(bias);
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
