import { it, expect, beforeEach, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { memoryStore, setStoreForTests } from "./store";
import { handle, setChainForTests } from "./router";
import { makeSession, OWNER, type Chain } from "./core";

const TM = "0x3333333333333333333333333333333333333333";
const W = (i: number) => "0x" + String(i).repeat(40).slice(0, 40);
const chain: Chain = {
  contract: null, slotKey: (id) => keccak256(toBytes(id)), verifyLogin: async () => true, capsMindBalance: async () => 1n, gateBalance: async () => 0n,
  primaryBasename: async () => null, slot: async () => null, signClaim: async () => null, claimedBefore: async () => false, claimTx: async () => null,
  paused: async () => false, float: async () => 0n, refiller: async () => null, refillWallet: () => null, sendRefill: async () => "0x",
};
const owner = { authorization: "Bearer " + makeSession(OWNER, "owner") };
const mate = { authorization: "Bearer " + makeSession(TM, "teammate") };
beforeEach(() => { setStoreForTests(memoryStore()); setChainForTests(chain); vi.useRealTimers(); });

it("faucet: teammate creates + funds; many wallets claim; once per 24h each; total cap; refill adds", async () => {
  const c: any = (await handle({ action: "createCode", code: { name: "Daily GEAR", mode: "faucet", kind: "paper", amount: "1", totalCap: 4 } }, mate)).json;
  expect(c).toMatchObject({ mode: "faucet", unlockWindowH: 0, perWalletHours: 24 });
  expect((await handle({ action: "card", id: c.id }, {}) as any).json.state).toBe("empty");
  const f: any = await handle({ action: "fundFaucet", id: c.id, amount: "3" }, mate);
  expect(f.json.codes[0].amountRaw).toBe("3000000");
  expect((await handle({ action: "card", id: c.id }, {}) as any).json).toMatchObject({ state: "ready", mode: "faucet" });
  for (const i of [1, 2]) expect(((await handle({ action: "prepare", id: c.id, wallet: W(i) }, {})) as any).json.comeBackHours).toBe(24);
  const again: any = await handle({ action: "prepare", id: c.id, wallet: W(1) }, {});
  expect(again.status).toBe(429); expect(again.json.error).toMatch(/Come back in 2[34]h/);
  expect((await handle({ action: "prepare", id: c.id, wallet: W(3) }, {})).status).toBe(200);
  expect((await handle({ action: "card", id: c.id }, {}) as any).json.state).toBe("empty"); // 3 funded, 3 claimed
  await handle({ action: "refill", ids: [c.id] }, mate); // bulk refill adds fundAmount (default 25x amount)
  const d: any = await handle({ action: "code", id: c.id }, owner);
  expect(d.json.stats).toMatchObject({ remaining: "25", claims24h: 3, uniqueWallets: 3 });
  expect((await handle({ action: "prepare", id: c.id, wallet: W(4) }, {})).status).toBe(200);
  expect((await handle({ action: "card", id: c.id }, {}) as any).json.state).toBe("empty"); // total cap 4 reached
  // after 24h wallet 1 may claim again (raise cap first)
  await handle({ action: "updateCode", id: c.id, code: { totalCap: 0 } }, owner);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 24.1 * 3600e3);
  expect((await handle({ action: "prepare", id: c.id, wallet: W(1) }, {})).status).toBe(200);
});
it("rotating mode unchanged: once per wallet ever", async () => {
  const c: any = (await handle({ action: "createCode", code: { name: "R", kind: "paper", unlockWindowH: 0 } }, owner)).json;
  expect(c.mode).toBe("rotating");
  await handle({ action: "refill", ids: [c.id] }, owner);
  expect((await handle({ action: "prepare", id: c.id, wallet: W(1) }, {})).status).toBe(200);
  await handle({ action: "refill", ids: [c.id] }, owner);
  expect((await handle({ action: "prepare", id: c.id, wallet: W(1) }, {})).status).toBe(403);
});
