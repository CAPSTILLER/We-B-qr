import { encodeFunctionData, parseAbi, type EIP1193Provider } from "viem";
import { createBaseAccountSDK } from "@base-org/account";
import { injected } from "../wallet";

export async function api<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = localStorage.getItem("qrclaim:session");
  const r = await fetch("/api/qrclaim", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ action, ...body }) });
  const j = await r.json().catch(() => ({ error: "Server unreachable" }));
  if (!r.ok) throw Object.assign(new Error(j.error ?? "Error"), { status: r.status });
  return j;
}

// No wallet picker: first announced wallet, else window.ethereum, else Base Account (created at load for popups).
let baseAcct: EIP1193Provider | null = null;
try { baseAcct = createBaseAccountSDK({ appName: "payup QR Claim", appChainIds: [8453] }).getProvider() as unknown as EIP1193Provider; } catch { /* */ }
export const wallet = (): EIP1193Provider => injected[0]?.provider ?? (window as any).ethereum ?? baseAcct!;

/** Read-only connect: just asks for the address. Call directly in the tap. */
export async function connect(): Promise<`0x${string}`> {
  const [a] = (await wallet().request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  return a;
}
async function ensureBase(p: EIP1193Provider) {
  if (Number(await p.request({ method: "eth_chainId" })) !== 8453) await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
}
export const CONTRACT_ABI = parseAbi([
  "function claim(bytes32 key, address token, address to, uint256 amount, uint64 epoch, uint256 nonce, uint256 deadline, bytes sig)",
  "function refill(bytes32[] keys, address token, uint128[] amounts)",
  "function retire(bytes32 key)",
]);
export async function sendTx(from: `0x${string}`, to: `0x${string}`, data: `0x${string}`) {
  const p = wallet();
  await ensureBase(p); // eth_chainId is answered locally, so the send popup stays inside the tap
  return p.request({ method: "eth_sendTransaction", params: [{ from, to, data, chainId: "0x2105" } as any] }) as Promise<`0x${string}`>;
}
export function claimData(a: any, sig: `0x${string}`) {
  return encodeFunctionData({ abi: CONTRACT_ABI, functionName: "claim", args: [a.slot, a.token, a.to, BigInt(a.amount), BigInt(a.epoch), BigInt(a.nonce), BigInt(a.deadline), sig] });
}
export const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
