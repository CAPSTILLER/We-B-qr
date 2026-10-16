import { useEffect, useState } from "react";
import { TOKENS, type TokenId } from "./lib";
import { baseClient, injected, pay, pickProvider, resolveName } from "./wallet";

export function PayPage() {
  const q = new URLSearchParams(location.search);
  const token = (q.get("t") ?? "USDC").toUpperCase() as TokenId;
  const amt = q.get("amt") ?? "0";
  const toRaw = q.get("to") ?? "";
  const note = q.get("n") ?? "";
  const [to, setTo] = useState<`0x${string}` | null>(null);
  const [state, setState] = useState<"idle" | "wait" | "mining" | "done" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [hash, setHash] = useState("");
  const [, force] = useState(0);
  useEffect(() => { resolveName(toRaw).then(setTo); const t = setTimeout(() => force(1), 400); return () => clearTimeout(t); }, [toRaw]);
  const bad = !TOKENS[token] || !(Number(amt) > 0);

  const go = (rdns?: string) => {
    if (!to) return;
    setState("wait"); setMsg("");
    pay(pickProvider(rdns), token, to, amt).then(async (h) => {
      setHash(h); setState("mining");
      const r = await baseClient.waitForTransactionReceipt({ hash: h });
      setState(r.status === "success" ? "done" : "err"); if (r.status !== "success") setMsg("Transaction failed onchain.");
    }).catch((e) => { setState("err"); setMsg(e?.shortMessage ?? e?.message ?? "Cancelled"); });
  };

  return (<div className="wrap">
    <h1>We B <span>qr</span> pay</h1>
    <div className="card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 46, width: 80, height: 80, lineHeight: "80px", borderRadius: "50%", margin: "0 auto", background: TOKENS[token]?.color ?? "#333" }}>{TOKENS[token]?.logo}</div>
      <div className="tok">{amt} <small>{token}</small></div>
      <div className="muted">on Base · to {toRaw.includes(".") ? <b>{toRaw}</b> : null}<br />{to ?? (toRaw ? "resolving…" : "no recipient")}</div>
      {note && <p>“{note}”</p>}
    </div>
    {bad ? <div className="warn">This pay link is broken (bad amount or token).</div> : state === "done" ? (
      <div className="card" style={{ textAlign: "center" }}><div className="tok ok">✓ Paid</div>
        <a style={{ color: "#EAA221" }} href={`https://basescan.org/tx/${hash}`} target="_blank">View on BaseScan ↗</a></div>
    ) : (<>
      {injected.length > 0
        ? injected.map((w) => <button key={w.info.rdns} className="big" disabled={!to || state === "wait" || state === "mining"} onClick={() => go(w.info.rdns)}>
            <img src={w.info.icon} width={22} style={{ verticalAlign: "middle", marginRight: 8 }} />Pay with {w.info.name}</button>)
        : <button className="big" disabled={!to || state === "wait" || state === "mining"} onClick={() => go()}>Connect + Pay</button>}
      <button className="big" style={{ background: "#0000FF", color: "#fff" }} disabled={!to || state === "wait" || state === "mining"} onClick={() => go("base")}>Pay with Base Account</button>
      {state === "wait" && <p className="muted">Approve in your wallet…</p>}
      {state === "mining" && <p className="muted">Confirming on Base… <a style={{ color: "#EAA221" }} href={`https://basescan.org/tx/${hash}`} target="_blank">BaseScan ↗</a></p>}
      {state === "err" && <p className="warn">{msg}</p>}
      <p className="muted">Double-check the amount and recipient before approving. Payments are final.</p>
    </>)}
  </div>);
}
