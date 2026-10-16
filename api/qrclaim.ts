import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handle } from "../server/router.js";

export default async function (req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  const r = await handle(body, req.headers as Record<string, string>);
  res.status(r.status).json(r.json);
}
