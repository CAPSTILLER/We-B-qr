import { it, expect, beforeEach } from "vitest";
import { keccak256, toBytes } from "viem";
import { memoryStore, setStoreForTests } from "./store";
import { handle, handleCron, setChainForTests } from "./router";
import { makeSession, OWNER, type Chain } from "./core";

const TM = "0x3333333333333333333333333333333333333333";
const REF = "0x9999999999999999999999999999999999999999";
let slots: Record<string, bigint> = {}; let pool = 0n; let paused = false; let sent: any[] = []; let onchainRefiller = REF;
const chain: Chain = {
  contract: "0x0f7b4359dc04bad4ec262a7fb25f675f31424fb9", slotKey: (id) => keccak256(toBytes(id)),
  verifyLogin: async () => true, capsMindBalance: async () => 1n, gateBalance: async () => 0n, primaryBasename: async () => null,
  slot: async (k) => ({ token: "0x5880cD05605A549f1DAb01a53ca61Ee559244bD1", balance: slots[k] ?? 0n, epoch: 1n, retired: false }),
  signClaim: async () => null, claimedBefore: async () => false, claimTx: async () => null,
  paused: async () => paused, float: async () => pool, refiller: async () => onchainRefiller, refillWallet: () => REF,
  sendRefill: async (token, keys, amounts) => { sent.push({ token, keys, amounts }); keys.forEach((k, i) => { slots[k] = (slots[k] ?? 0n) + amounts[i]; pool -= amounts[i]; }); return "0xabc"; },
};
const owner = { authorization: "Bearer " + makeSession(OWNER, "owner") };
const mate = { authorization: "Bearer " + makeSession(TM, "teammate") };
const cron = () => handleCron({ authorization: "Bearer s3cret" }) as Promise<any>;
beforeEach(() => { setStoreForTests(memoryStore()); setChainForTests(chain); slots = {}; pool = 10_000000n; paused = false; sent = []; onchainRefiller = REF; process.env.CRON_SECRET = "s3cret"; });

async function mk(n: number, extra: any = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(((await handle({ action: "createCode", code: { name: "A" + i, kind: "paper", unlockWindowH: 0, ...extra } }, owner)) as any).json.id);
  return ids;
}
it("bulk refill (teammate) returns top-ups only, never overfills", async () => {
  const ids = await mk(3);
  slots[keccak256(toBytes(ids[1]))] = 1_000000n; // already full
  const r: any = await handle({ action: "refill", ids }, mate);
  expect(r.status).toBe(200);
  expect(r.json.codes.map((c: any) => c.id)).toEqual([ids[0], ids[2]]);
  expect(r.json.codes[0].amountRaw).toBe("1000000");
});
it("auto-refill: cron auth, interval, only empty, respects pause/approval, pool low alert", async () => {
  expect((await handleCron({ authorization: "Bearer nope" })).status).toBe(401);
  const ids = await mk(3);
  expect((await handle({ action: "setAutoRefill", ids, minutes: 1 }, mate)).status).toBe(200);
  expect((await handle({ action: "setAutoRefill", ids, minutes: 5000 }, mate)).status).toBe(400);
  slots[keccak256(toBytes(ids[2]))] = 1_000000n;
  let r = await cron();
  expect(r.json.refilled.sort()).toEqual([ids[0], ids[1]].sort());
  expect(sent.length).toBe(1); expect(sent[0].keys.length).toBe(2);
  // not due yet
  slots = {}; r = await (handleCron({ authorization: "Bearer s3cret" }) as any);
  expect(r.json.refilled?.length ?? 0).toBe(0);
  // paused / not approved
  paused = true; await new Promise((x) => setTimeout(x, 10));
  const { QrClaim } = await import("./core"); const { getStore } = await import("./store");
  const q = new QrClaim(getStore().store, chain);
  expect((await q.autoRefill()).error).toBe("contract paused");
  paused = false; onchainRefiller = "0x0000000000000000000000000000000000000000";
  expect((await q.autoRefill()).error).toMatch(/setRefiller/);
  onchainRefiller = REF;
  // pool low: force due, pool for 1 only
  const codes: any = (await handle({ action: "state" }, owner) as any).json.codes;
  for (const c of codes) { c.lastAutoAt = 0; await getStore().store.hset("codes", c.id, c); }
  slots = {}; pool = 1_000000n;
  const r2 = await q.autoRefill();
  expect(r2.refilled.length).toBe(1);
  const st: any = await handle({ action: "state" }, owner);
  expect(st.json.alerts.some((a: any) => a.kind === "pool_low")).toBe(true);
});
