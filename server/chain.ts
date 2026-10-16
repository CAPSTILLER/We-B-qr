// Real Base chain adapter (server-only). Reads env; never logs secrets.
import { createPublicClient, http, keccak256, toBytes, parseAbi, parseAbiItem, decodeEventLog, toCoinType } from "viem";
import { base, mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { CAPS_MIND, type Chain } from "./core.js";

const abi = parseAbi([
  "function slots(bytes32) view returns (address token, uint128 balance, uint64 epoch, bool retired)",
  "function balanceOf(address) view returns (uint256)",
]);
const claimedEvent = parseAbiItem("event Claimed(bytes32 indexed slot, address indexed to, address token, uint256 amount, uint64 epoch, uint256 nonce)");

export function realChain(): Chain {
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
  const eth = createPublicClient({ chain: mainnet, transport: http(process.env.MAINNET_RPC_URL) });
  const contract = (process.env.QRCLAIM_CONTRACT || process.env.VITE_QRCLAIM_CONTRACT || null) as `0x${string}` | null;
  const pk = process.env.CLAIM_SIGNER_KEY as `0x${string}` | undefined;
  const account = pk ? privateKeyToAccount(pk) : null;
  const fromBlock = BigInt(process.env.QRCLAIM_FROM_BLOCK ?? "0");
  return {
    contract,
    slotKey: (id) => keccak256(toBytes(id)),
    verifyLogin: (address, message, signature) => client.verifyMessage({ address, message, signature }), // EOA + smart wallets (1271/6492)
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
