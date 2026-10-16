import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Local dev only: serve /api/qrclaim with the same handler Vercel uses.
const qrclaimDev = (): Plugin => ({
  name: "qrclaim-dev-api",
  configureServer(server) {
    server.middlewares.use("/api/qrclaim", async (req, res) => {
      let raw = ""; for await (const ch of req) raw += ch;
      const { handle } = await server.ssrLoadModule("/server/router.ts");
      const r = await handle(JSON.parse(raw || "{}"), req.headers as Record<string, string>);
      res.statusCode = r.status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(r.json));
    });
  },
});
export default defineConfig({ plugins: [react(), qrclaimDev()] });
