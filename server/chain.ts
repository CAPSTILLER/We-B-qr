// Real Base chain adapter (server-only). Reads env; never logs secrets.
import { createPublicClient, createWalletClient, http, fallback, keccak256, toBytes, parseAbi, parseAbiItem, decodeEventLog, toCoinType } from "viem";
import { base, mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { CAPS_MIND, HttpError, type Chain } from "./core.js";
import { envClean } from "./store.js";

const abi = parseAbi([
  "function slots(bytes32) view returns (address token, uint128 balance, uint64 epoch, bool retired)",
  "function balanceOf(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function float(address) view returns (uint256)",
  "function refiller() view returns (address)",
  "function refill(bytes32[] keys, address token, uint128[] amounts)",
]);
const claimedEvent = parseAbiItem("event Claimed(bytes32 indexed slot, address indexed to, address token, uint256 amount, uint64 epoch, uint256 nonce)");

export function realChain(): Chain {
  const rpc = (u: string | undefined, d: string[]) => fallback([...(u ? [http(u)] : []), ...d.map((x) => http(x))]);
  const client = createPublicClient({ chain: base, transport: rpc(envClean("BASE_RPC_URL"), ["https://mainnet.base.org", "https://base.llamarpc.com", "https://base-rpc.publicnode.com"]) });
  const eth = createPublicClient({ chain: mainnet, transport: rpc(envClean("MAINNET_RPC_URL"), ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"]) });
  const c0 = envClean("QRCLAIM_CONTRACT") ?? envClean("VITE_QRCLAIM_CONTRACT");
  const contract = (c0 && /^0x[0-9a-fA-F]{40}$/.test(c0) ? c0 : null) as `0x${string}` | null;
  const account = signerAccount();
  const fromBlock = BigInt(/^\d+$/.test(envClean("QRCLAIM_FROM_BLOCK") ?? "") ? envClean("QRCLAIM_FROM_BLOCK")! : "0");
  const refillAcct = keyAccount("REFILL_WALLET_KEY");
  return {
    contract,
    paused: async () => (contract ? client.readContract({ address: contract, abi, functionName: "paused" }) : false),
    float: async (t) => (contract ? client.readContract({ address: contract, abi, functionName: "float", args: [t] }) : 0n),
    refiller: async () => (contract ? client.readContract({ address: contract, abi, functionName: "refiller" }) : null),
    refillWallet: () => refillAcct?.address ?? null,
    async sendRefill(token, keys, amounts) {
      if (!contract || !refillAcct) throw new HttpError(503, "Refill wallet not configured");
      const w = createWalletClient({ account: refillAcct, chain: base, transport: http(envClean("BASE_RPC_URL") ?? "https://mainnet.base.org") });
      const hash = await w.writeContract({ address: contract, abi, functionName: "refill", args: [keys, token, amounts] });
      await client.waitForTransactionReceipt({ hash, timeout: 25_000 }).catch(() => {});
      return hash;
    },
    slotKey: (id) => keccak256(toBytes(id)),
    verifyLogin: (address, message, signature) => client.verifyMessage({ address, message, signature }), // EOA + smart wallets (1271/6492)
    gateBalance: (g, a) => client.readContract({ address: g, abi, functionName: "balanceOf", args: [a] }).catch(() => 0n),
    capsMindBalance: (a) => client.readContract({ address: CAPS_MIND, abi, functionName: "balanceOf", args: [a] }),
    async primaryBasename(a) {
      try {
        const coinType = toCoinType(base.id);
        const name = await eth.getEnsName({ address: a, coinType });
        if (!name || !name.endsWith(".base.eth")) return null;
        const fwd = await eth.getEnsAddress({ name, coinType });
        return fwd?.toLowerCase() === a.toLowerCase() ? name : null;
      } catch { return null; }
    },
    async slot(key) {
      if (!contract) return null;
      const [token, balance, epoch, retired] = await client.readContract({ address: contract, abi, functionName: "slots", args: [key] });
      return { token, balance, epoch, retired };
    },
    async signClaim(m) {
      if (!account || !contract) return null;
      return account.signTypedData({
        domain: { name: "QRClaimContract", version: "1", chainId: base.id, verifyingContract: contract },
        types: { Claim: [{ name: "slot", type: "bytes32" }, { name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "epoch", type: "uint64" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
        primaryType: "Claim", message: m,
      });
    },
    async claimedBefore(key, to) {
      if (!contract) return false;
      try { return (await client.getLogs({ address: contract, event: claimedEvent, args: { slot: key, to }, fromBlock })).length > 0; }
      catch { return false; } // RPC range limits: fall back to DB record
    },
    async claimTx(tx) {
      if (!contract) return null;
      const r = await client.getTransactionReceipt({ hash: tx });
      for (const l of r.logs) {
        if (l.address.toLowerCase() !== contract.toLowerCase()) continue;
        try { const e = decodeEventLog({ abi: [claimedEvent], data: l.data, topics: l.topics }); return { key: e.args.slot, to: e.args.to }; } catch { /* other event */ }
      }
      return null;
    },
  };
}

/** Signer from CLAIM_SIGNER_KEY; tolerant of a missing 0x prefix, never throws (null = claims paused). */
export function signerAccount() { return keyAccount("CLAIM_SIGNER_KEY"); }
export function keyAccount(name: string) {
  let k = envClean(name);
  if (!k) return null;
  if (!k.startsWith("0x")) k = "0x" + k;
  try { return privateKeyToAccount(k as `0x${string}`); } catch { return null; }
}
