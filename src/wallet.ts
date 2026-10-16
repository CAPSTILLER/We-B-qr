import { createPublicClient, http, encodeFunctionData, erc20Abi, isAddress, numberToHex, type EIP1193Provider } from "viem";
import { base, mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { createBaseAccountSDK } from "@base-org/account";
import { TOKENS, rawAmount, type TokenId } from "./lib";

export const baseClient = createPublicClient({ chain: base, transport: http() });
const ethClient = createPublicClient({ chain: mainnet, transport: http() });

// EIP-6963 discovery at page load, so the tap fires the wallet request immediately
type Info = { name: string; icon: string; rdns: string };
export const injected: { info: Info; provider: EIP1193Provider }[] = [];
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: any) => {
    if (!injected.some((p) => p.info.rdns === e.detail.info.rdns)) injected.push(e.detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
// Base Account (smart wallet) created at load, not on tap (popup blockers)
let baseAcct: EIP1193Provider | null = null;
try {
  baseAcct = createBaseAccountSDK({ appName: "We B qr", appChainIds: [8453] }).getProvider() as unknown as EIP1193Provider;
} catch { /* ignore */ }

export function pickProvider(rdns?: string): EIP1193Provider {
  if (rdns === "base") return baseAcct!;
  const p = injected.find((x) => x.info.rdns === rdns) ?? injected[0];
  return p?.provider ?? ((window as any).ethereum as EIP1193Provider) ?? baseAcct!;
}

export async function resolveName(name: string): Promise<`0x${string}` | null> {
  const n = name.trim();
  if (isAddress(n)) return n;
  if (!n.includes(".")) return null;
  try {
    return (await ethClient.getEnsAddress({ name: normalize(n), coinType: 2147492101n })) ??
      (await ethClient.getEnsAddress({ name: normalize(n) }));
  } catch { return null; }
}

/** Must be called synchronously from the click handler: first await is the wallet request. */
export async function pay(provider: EIP1193Provider, token: TokenId, to: `0x${string}`, amount: string) {
  const [from] = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  const chain = await provider.request({ method: "eth_chainId" });
  if (Number(chain) !== 8453) {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }); }
    catch { await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }] }); }
  }
  const raw = rawAmount(amount, token);
  const tx = token === "ETH"
    ? { from, to, value: numberToHex(raw) }
    : { from, to: TOKENS[token].address!, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, raw] }) };
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx as any] })) as `0x${string}`;
  return hash;
}

export const voucherAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }, { name: "secret", type: "bytes32" }, { name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "vouchers", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "hash", type: "bytes32" }, { name: "amount", type: "uint128" }, { name: "status", type: "uint8" }] },
] as const;

export async function claimVoucher(provider: EIP1193Provider, contract: `0x${string}`, id: bigint, secret: `0x${string}`) {
  const [from] = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
  const chain = await provider.request({ method: "eth_chainId" });
  if (Number(chain) !== 8453) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  const data = encodeFunctionData({ abi: voucherAbi, functionName: "claim", args: [id, secret, from] });
  return (await provider.request({ method: "eth_sendTransaction", params: [{ from, to: contract, data } as any] })) as `0x${string}`;
}
