import { it, expect } from "vitest";
import { hashTypedData, keccak256, toBytes, encodeAbiParameters, encodePacked, concat } from "viem";
// Matches QRClaimContract's DOMAIN_SEPARATOR + CLAIM_TYPEHASH encoding exactly.
it("server EIP-712 digest == contract digest", () => {
  const contract = "0x000000000000000000000000000000000000c1a1" as const;
  const m = { slot: keccak256(toBytes("abc")), token: "0x5880cD05605A549f1DAb01a53ca61Ee559244bD1" as const, to: "0x1111111111111111111111111111111111111111" as const, amount: 1000000n, epoch: 3n, nonce: 99n, deadline: 1800000000n };
  const viemHash = hashTypedData({ domain: { name: "QRClaimContract", version: "1", chainId: 8453, verifyingContract: contract },
    types: { Claim: [{ name: "slot", type: "bytes32" }, { name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "epoch", type: "uint64" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Claim", message: m });
  const ds = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
    [keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toBytes("QRClaimContract")), keccak256(toBytes("1")), 8453n, contract]));
  const th = keccak256(toBytes("Claim(bytes32 slot,address token,address to,uint256 amount,uint64 epoch,uint256 nonce,uint256 deadline)"));
  const sh = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "uint256" }, { type: "uint256" }], [th, m.slot, m.token, m.to, m.amount, m.epoch, m.nonce, m.deadline]));
  expect(viemHash).toBe(keccak256(concat(["0x1901", ds, sh])));
  void encodePacked;
});
