// One HTTP entry for all QR Claim actions: POST /api/qrclaim {action, ...}
import { createHash } from "node:crypto";
import { HttpError, QrClaim, readSession, type Chain } from "./core.js";
import { getStore, ConfigError, envClean } from "./store.js";
import { realChain, signerAccount, keyAccount } from "./chain.js";

const OWNER_ONLY = new Set(["updateCode", "setAllowedTokens", "rotate", "audit", "resolveAlert"]);
const STAFF = new Set(["createCode", "refill", "retire", "setAutoRefill", "state", "code", "saveFolder", "deleteFolder", "move", "logPrint", ...OWNER_ONLY]);
let chainOverride: Chain | null = null;
export const setChainForTests = (c: Chain | null) => { chainOverride = c; };

export async function handle(body: any, headers: Record<string, string | undefined>): Promise<{ status: number; json: unknown }> {
  try {
    const a0 = String(body?.action ?? "");
    if (a0 === "health") {
      // Non-secret config check: which settings are present/valid (never values)
      let storage = "memory (not saved)";
      try { const { store, persistent } = getStore(); if (persistent) { await store.get("health"); storage = "upstash ok"; } } catch (e: any) { storage = "error: " + (e instanceof ConfigError ? e.message : "can't reach Upstash"); }
      return { status: 200, json: { storage, refillWallet: envClean("REFILL_WALLET_KEY") ? (keyAccount("REFILL_WALLET_KEY")?.address ?? "invalid") : "missing", cronSecret: !!envClean("CRON_SECRET"), sessionSecret: !!envClean("QRCLAIM_SESSION_SECRET"), signer: envClean("CLAIM_SIGNER_KEY") ? (signerAccount() ? "ok" : "invalid") : "missing", contract: !!envClean("QRCLAIM_CONTRACT") } };
    }
    const { store, persistent } = getStore();
    const chain = chainOverride ?? realChain();
    const q = new QrClaim(store, chain);
    const a = String(body?.action ?? "");
    const sess = readSession((headers.authorization ?? "").replace(/^Bearer /, ""));
    if (STAFF.has(a)) {
      if (!sess) throw new HttpError(401, "Sign in first");
      if (OWNER_ONLY.has(a) && sess.r !== "owner") throw new HttpError(403, "Only the owner Ledger can change rules");
    }
    const ip = createHash("sha256").update((headers["x-forwarded-for"] ?? "").split(",")[0] + "qrclaim").digest("hex").slice(0, 16);
    const actor = sess?.a ?? "";
    let json: unknown;
    switch (a) {
      case "nonce": json = await q.nonce(body.address); break;
      case "login": json = await q.login(body.address, body.signature); break;
      case "demoLogin": {
        if (process.env.QRCLAIM_DEMO_LOGIN !== "1" || process.env.VERCEL) throw new HttpError(404, "Unknown action");
        const { makeSession } = await import("./core.js"); json = { token: makeSession(body.address, body.role), role: body.role }; break;
      }
      case "state": json = { ...(await q.state(actor, sess!.r)), persistent, me: actor }; break;
      case "code": json = await q.codeDetail(actor, body.id); break;
      case "saveFolder": json = await q.saveFolder(actor, body.folder, sess!.r); break;
      case "deleteFolder": json = await q.deleteFolder(actor, body.id); break;
      case "move": json = await q.move(actor, body.ids, body.folderId); break;
      case "logPrint": json = await q.logPrint(actor, body.ids); break;
      case "createCode": json = await q.createCode(actor, body.code, sess!.r); break;
      case "setAllowedTokens": json = await q.setAllowedTokens(actor, body.tokens); break;
      case "updateCode": json = await q.updateCode(actor, body.id, body.code); break;
      case "refill": json = await q.refill(actor, body.ids, sess!.r); break;
      case "retire": json = await q.retire(actor, body.id, sess!.r); break;
      case "rotate": json = await q.rotate(actor, body.id); break;
      case "setAutoRefill": json = await q.setAutoRefill(actor, body.ids, body.minutes); break;
      case "audit": json = await q.auditLog(); break;
      case "resolveAlert": json = await q.resolveAlert(actor, body.id); break;
      case "card": json = await q.card(body.id); break;
      case "prepare": {
        if ((await store.incr(`rl:${ip}:${Math.floor(Date.now() / 60000)}`, 120)) > 20) throw new HttpError(429, "Slow down");
        json = await q.prepare(body.id, body.wallet, ip); break;
      }
      case "confirm": {
        const ev = await chain.claimTx(body.tx);
        if (!ev || ev.key.toLowerCase() !== chain.slotKey(body.id).toLowerCase()) throw new HttpError(400, "No matching claim in that transaction");
        json = await q.confirm(body.id, ev.to, body.tx); break;
      }
      default: throw new HttpError(404, "Unknown action");
    }
    return { status: 200, json };
  } catch (e: any) {
    if (e instanceof HttpError) return { status: e.status, json: { error: e.message } };
    if (e instanceof ConfigError) return { status: 503, json: { error: "Server setup problem: " + e.message } };
    if (/upstash|redis|fetch failed|WRONGPASS|unauthorized/i.test(String(e?.message))) return { status: 503, json: { error: "Server storage (Upstash) isn't reachable. Check the Upstash URL/token on Vercel." } };
    console.error("qrclaim error", e?.message);
    return { status: 500, json: { error: "Server error" } };
  }
}

/** Cron entry (Vercel Cron or Upstash QStash). Requires Authorization: Bearer CRON_SECRET. */
export async function handleCron(headers: Record<string, string | undefined>): Promise<{ status: number; json: unknown }> {
  const secret = envClean("CRON_SECRET");
  const auth = headers.authorization ?? headers["upstash-forward-authorization"] ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return { status: 401, json: { error: "unauthorized" } };
  try {
    const { store } = getStore();
    const lock = await store.incr(`cronlock:${Math.floor(Date.now() / 50000)}`, 120);
    if (lock > 1) return { status: 200, json: { note: "already ran this window" } };
    const q = new QrClaim(store, chainOverride ?? realChain());
    return { status: 200, json: await q.autoRefill(Number(envClean("AUTO_REFILL_MIN_POOL") ?? "0")) };
  } catch (e: any) {
    console.error("qrclaim cron", e?.shortMessage ?? e?.message);
    return { status: 500, json: { error: e instanceof HttpError ? e.message : "cron failed: " + String(e?.shortMessage ?? e?.message).slice(0, 200) } };
  }
}
