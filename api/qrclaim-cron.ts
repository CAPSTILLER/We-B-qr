import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCron } from "../server/router.js";

export default async function (req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  const r = await handleCron(req.headers as Record<string, string>);
  res.status(r.status).json(r.json);
}
