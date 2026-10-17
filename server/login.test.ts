import { it, expect, beforeEach } from "vitest";
import { keccak256, toBytes, verifyMessage, toHex, hexToString } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { memoryStore, setStoreForTests } from "./store";
import { handle, setChainForTests } from "./router";
import type { Chain } from "./core";

const holder = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
let rpcDown = false;
const chain: Chain = {
  contract: null, slotKey: (id) => keccak256(toBytes(id)),
  verifyLogin: (address, message, signature) => verifyMessage({ address, message, signature }),
  capsMindBalance: async (a) => { if (rpcDown) { const { HttpError } = await import("./core"); throw new HttpError(503, "Couldn't reach Base to check CAPs Mind ownership. Try again in a moment."); } return a.toLowerCase() === holder.address.toLowerCase() ? 1n : 0n; },
  gateBalance: async () => 0n, primaryBasename: async () => null, slot: async () => null, signClaim: async () => null, claimedBefore: async () => false, claimTx: async () => null, paused: async () => false, float: async () => 0n, refiller: async () => null, refillWallet: () => null, sendRefill: async () => "0x" as `0x${string}`,
};
beforeEach(() => { setStoreForTests(memoryStore()); setChainForTests(chain); rpcDown = false; });

async function signIn(acct: typeof holder) {
  const n: any = await handle({ action: "nonce", address: acct.address }, {});
  // wallet signs the hex-encoded message (what the UI sends to personal_sign)
  const sig = await acct.signMessage({ message: hexToString(toHex(n.json.message)) });
  return handle({ action: "login", address: acct.address, signature: sig }, {}) as Promise<any>;
}
it("CAPs Mind holder signs in as teammate and can create a code", async () => {
  const r = await signIn(holder);
  expect(r.status).toBe(200); expect(r.json.role).toBe("teammate");
  const c: any = await handle({ action: "createCode", code: { name: "Mate drop", kind: "paper" } }, { authorization: "Bearer " + r.json.token });
  expect(c.status).toBe(200);
});
it("no-NFT wallet gets a clear message", async () => {
  const r = await signIn(stranger);
  expect(r.status).toBe(403); expect(r.json.error).toMatch(/doesn't hold a CAPs Mind NFT/);
});
it("RPC failure is a clear retry message, not 'Server error'", async () => {
  rpcDown = true;
  const r = await signIn(holder);
  expect(r.status).toBe(503); expect(r.json.error).toMatch(/Couldn't reach Base/);
});
it("messy env values don't crash the API", async () => {
  setChainForTests(null);
  process.env.CLAIM_SIGNER_KEY = " " + generatePrivateKey().slice(2) + "\n"; // no 0x + whitespace
  process.env.QRCLAIM_SESSION_SECRET = '"abc123"';
  const h: any = await handle({ action: "health" }, {});
  expect(h.json).toMatchObject({ signer: "ok", sessionSecret: true });
  expect(((await handle({ action: "bogus" }, {})) as any).json.error).toBe("Unknown action");
  process.env.CLAIM_SIGNER_KEY = "nonsense";
  expect(((await handle({ action: "health" }, {})) as any).json.signer).toBe("invalid");
  expect(((await handle({ action: "bogus" }, {})) as any).json.error).toBe("Unknown action");
  delete process.env.CLAIM_SIGNER_KEY; delete process.env.QRCLAIM_SESSION_SECRET;
});
