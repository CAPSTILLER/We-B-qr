import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { baseClient, claimVoucher, pickProvider, voucherAbi, injected } from "./wallet";

const CONTRACT = import.meta.env.VITE_VOUCHER_CONTRACT as `0x${string}` | undefined;

export function ClaimPage() {
  const q = new URLSearchParams(location.search);
  const id = q.get("id") ?? "";
  const s = q.get("s") ?? "";
  const amtHint = q.get("a");
  const valid = /^\d+$/.test(id) && /^[0-9a-f]{64}$/i.test(s);
  const [info, setInfo] = useState<{ amount: string; status: number } | null>(null);
  const [state, setState] = useState("idle");
  const [hash, setHash] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!CONTRACT || !valid) return;
    baseClient.readContract({ address: CONTRACT, abi: voucherAbi, functionName: "vouchers", args: [BigInt(id)] })
      .then(([, a, st]) => setInfo({ amount: formatUnits(a, 6), status: st })).catch(() => {});
  }, []);
  const go = () => {
    if (!CONTRACT) { setState("demo"); return; }
    setState("wait");
    claimVoucher(pickProvider(injected[0]?.info.rdns), CONTRACT, BigInt(id), `0x${s}`).then(async (h) => {
      setHash(h); setState("mining"); const r = await baseClient.waitForTransactionReceipt({ hash: h });
      setState(r.status === "success" ? "done" : "err");
    }).catch((e) => { setState("err"); setMsg(e?.shortMessage ?? e?.message ?? "Cancelled"); });
  };
  const amount = info?.amount ?? amtHint ?? "?";
  return (<div className="wrap"><h1>Paper <span>Gear</span> #{id}</h1>
    {!CONTRACT && <div className="card warn">DEMO MODE: no voucher contract is set yet, so nothing will be sent.</div>}
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 60 }}>⚙</div><div className="tok">{amount} <small>GEAR</small></div>
      {!valid && <div className="warn">This card's code is damaged.</div>}
      {info?.status === 2 && <div className="warn">Already claimed.</div>}
      {info?.status === 3 && <div className="warn">This card was revoked.</div>}
    </div>
    {state === "done" ? <div className="card tok ok">✓ Claimed <a style={{ color: "#EAA221", fontSize: 16 }} href={`https://basescan.org/tx/${hash}`}>BaseScan ↗</a></div>
      : state === "demo" ? <div className="card ok">✓ Demo claim works. When the contract is live this tap sends {amount} GEAR to your wallet.</div>
      : <button className="big" disabled={!valid || state === "wait" || state === "mining" || (info !== null && info.status !== 1)} onClick={go}>Connect + Claim</button>}
    {state === "mining" && <p className="muted">Confirming on Base…</p>}
    {state === "err" && <p className="warn">{msg || "Claim failed."}</p>}
    <p className="muted">First wallet to claim gets it. Keep the card hidden until you claim.</p>
  </div>);
}
