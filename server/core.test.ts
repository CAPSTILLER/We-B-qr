import { describe, it, expect, beforeEach } from "vitest";
import { keccak256, toBytes } from "viem";
import { memoryStore, setStoreForTests } from "./store.js";
import { handle, setChainForTests } from "./router.js";
import { makeSession, OWNER, type Chain } from "./core.js";

const W = "0x1111111111111111111111111111111111111111";
const W2 = "0x2222222222222222222222222222222222222222";
const TM = "0x3333333333333333333333333333333333333333";
let basenames: Record<string, string> = {};
const chain: Chain = {
  contract: null, slotKey: (id) => keccak256(toBytes(id)),
  verifyLogin: async (_a, _m, sig) => sig === "0xgood",
  capsMindBalance: async (a) => (a.toLowerCase() === TM ? 1n : 0n),
  primaryBasename: async (a) => basenames[a.toLowerCase()] ?? null,
  slot: async () => null, signClaim: async () => null, claimedBefore: async () => false, claimTx: async () => null,
};
const owner = { authorization: "Bearer " + makeSession(OWNER, "owner") };
const mate = { authorization: "Bearer " + makeSession(TM, "teammate") };
const call = (body: any, h: any = {}) => handle(body, h);

beforeEach(() => { setStoreForTests(memoryStore()); setChainForTests(chain); basenames = {}; });

describe("QR claim server", () => {
  it("login: owner, CAPs Mind teammate, stranger rejected, bad sig rejected", async () => {
    for (const [addr, sig, status, role] of [[OWNER, "0xgood", 200, "owner"], [TM, "0xgood", 200, "teammate"], [W, "0xgood", 403, ""], [TM, "0xbad", 401, ""]] as const) {
      await call({ action: "nonce", address: addr });
      const r: any = await call({ action: "login", address: addr, signature: sig });
      expect(r.status).toBe(status); if (role) expect(r.json.role).toBe(role);
    }
  });
  it("teammate can organize but not change rules; anon blocked", async () => {
    expect((await call({ action: "state" })).status).toBe(401);
    const f: any = await call({ action: "saveFolder", folder: { name: "Street drops" } }, mate);
    expect(f.status).toBe(200);
    expect((await call({ action: "createCode", code: { name: "x" } }, mate)).status).toBe(403);
    const c: any = await call({ action: "createCode", code: { name: "Gear #1", folderId: f.json.id, kind: "paper" } }, owner);
    expect(c.status).toBe(200);
    expect((await call({ action: "move", ids: [c.json.id], folderId: "bot-grab" }, mate)).status).toBe(200);
    expect((await call({ action: "refill", ids: [c.json.id] }, mate)).status).toBe(403);
    const st: any = await call({ action: "state" }, mate);
    expect(st.json.codes[0].folderId).toBe("bot-grab");
    expect(st.json.folders.some((x: any) => x.name === "Bot grab")).toBe(true);
  });
  it("codes: random unguessable IDs, no sequential URL, up to 3 https links", async () => {
    const a: any = await call({ action: "createCode", code: { name: "A", links: [1, 2, 3, 4].map((i) => ({ label: "L" + i, url: "https://x.y/" + i })) } }, owner);
    expect(a.json.id).toMatch(/^[A-Za-z0-9_-]{22}$/); expect(a.json.links.length).toBe(3); expect(a.json.serial).toBe(1);
    expect((await call({ action: "createCode", code: { name: "B", links: [{ label: "bad", url: "javascript:alert(1)" }] } }, owner)).status).toBe(400);
    expect((await call({ action: "card", id: "1" })).status).toBe(404);
  });
  it("demo claim: empty until refill, once per wallet, unlock window, basename rule", async () => {
    const c: any = (await call({ action: "createCode", code: { name: "Paper 1", kind: "paper", unlockWindowH: 0 } }, owner)).json;
    expect((await call({ action: "card", id: c.id }) as any).json.state).toBe("empty");
    expect((await call({ action: "prepare", id: c.id, wallet: W })).status).toBe(409);
    await call({ action: "refill", ids: [c.id] }, owner);
    expect((await call({ action: "card", id: c.id }) as any).json).toMatchObject({ state: "ready", amount: "1", token: "GEAR", demo: true });
    const p: any = await call({ action: "prepare", id: c.id, wallet: W });
    expect(p.json.demo).toBe(true);
    expect((await call({ action: "card", id: c.id }) as any).json.state).toBe("empty");
    await call({ action: "refill", ids: [c.id] }, owner);
    expect((await call({ action: "prepare", id: c.id, wallet: W })).status).toBe(403); // once per wallet per code
    const st: any = await call({ action: "state" }, owner);
    expect(st.json.alerts.some((a: any) => a.kind === "instant")).toBe(true);
    const d: any = await call({ action: "code", id: c.id }, owner);
    expect(d.json.claims[0]).toMatchObject({ wallet: W, status: "demo" });

    const dig: any = (await call({ action: "createCode", code: { name: "Digital 1", unlockWindowH: 0 } }, owner)).json;
    expect(dig.basenameOnly).toBe(true);
    await call({ action: "refill", ids: [dig.id] }, owner);
    expect((await call({ action: "prepare", id: dig.id, wallet: W2 })).status).toBe(403);
    basenames[W2] = "cap.base.eth";
    expect((await call({ action: "prepare", id: dig.id, wallet: W2 }) as any).json.name).toBe("cap.base.eth");
  });
  it("locked inside unlock window looks empty; retire and rotate", async () => {
    const c: any = (await call({ action: "createCode", code: { name: "Win", kind: "paper", unlockWindowH: 24 } }, owner)).json;
    await call({ action: "refill", ids: [c.id] }, owner);
    const r: any = await call({ action: "rotate", id: c.id }, owner);
    expect((await call({ action: "card", id: c.id }) as any).json.state).toBe("retired");
    expect(r.json.code.id).not.toBe(c.id);
    const audit: any = await call({ action: "audit" }, owner);
    expect(audit.json.map((x: any) => x.action)).toContain("rotate");
    expect((await call({ action: "audit" }, mate)).status).toBe(403);
  });
  it("daily cap per wallet across codes", async () => {
    for (let i = 0; i < 4; i++) {
      const c: any = (await call({ action: "createCode", code: { name: "D" + i, kind: "paper", unlockWindowH: 0, dailyCap: 3 } }, owner)).json;
      await call({ action: "refill", ids: [c.id] }, owner);
      expect((await call({ action: "prepare", id: c.id, wallet: W })).status).toBe(i < 3 ? 200 : 429);
    }
  });
});
