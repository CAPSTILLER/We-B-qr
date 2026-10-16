import { useEffect, useState } from "react";
import { api, claimData, connect, sendTx, short } from "./api";
import { baseClient } from "../wallet";
import { GEAR_COLORS } from "../lib";

type Card = { name: string; token: string; amount: string; links: { label: string; url: string }[]; state: "ready" | "empty" | "retired"; basenameOnly: boolean; demo: boolean };

export function ScanPage() {
  const id = location.pathname.startsWith("/c/") ? location.pathname.slice(3) : "";
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState("");
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [auth, setAuth] = useState<any>(null);
  const [step, setStep] = useState<"idle" | "busy" | "mining" | "done">("idle");
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");
  useEffect(() => { if (id) api<Card>("card", { id }).then(setCard).catch((e) => setErr(e.message)); else setErr("This code isn't active"); }, [id]);

  // after read-only connect, prepare the claim (contract mode) so the Claim tap opens the wallet instantly
  useEffect(() => {
    if (!me || !card || card.demo || card.state !== "ready") return;
    api("prepare", { id, wallet: me }).then(setAuth).catch((e) => setMsg(e.message));
  }, [me, card]);

  const onConnect = () => { setMsg(""); connect().then(setMe).catch((e) => setMsg(e?.shortMessage ?? e?.message ?? "Cancelled")); };
  const onClaim = () => {
    setMsg("");
    if (card!.demo) {
      setStep("busy");
      api("prepare", { id, wallet: me }).then(() => setStep("done")).catch((e) => { setStep("idle"); setMsg(e.message); });
      return;
    }
    if (!auth) return;
    setStep("busy");
    sendTx(me!, auth.contract, claimData(auth.args, auth.sig)).then(async (h) => {
      setTx(h); setStep("mining");
      const r = await baseClient.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("Claim failed onchain (someone may have claimed first)");
      await api("confirm", { id, tx: h }).catch(() => {});
      setStep("done");
    }).catch((e) => { setStep("idle"); setMsg(e?.shortMessage ?? e?.message ?? "Cancelled"); });
  };

  const ring = `conic-gradient(${Object.values(GEAR_COLORS).join(",")},${GEAR_COLORS.crimson})`;
  if (err) return <div className="wrap"><div className="card" style={{ textAlign: "center", marginTop: 60 }}><div style={{ fontSize: 48 }}>⚙</div><p>{err}</p></div></div>;
  if (!card) return <div className="wrap"><p className="muted" style={{ marginTop: 60, textAlign: "center" }}>Loading…</p></div>;
  const empty = card.state !== "ready";
  return (<div className="wrap">
    <div style={{ background: ring, padding: 3, borderRadius: 22, marginTop: 20 }}>
      <div style={{ background: "#111114", borderRadius: 20, padding: 18, textAlign: "center" }}>
        <div style={{ fontSize: 13, letterSpacing: ".14em", color: "#a1a1aa" }}>PAYUP · QR CLAIM</div>
        <h2 style={{ margin: "8px 0 2px", fontSize: 26 }}>{card.name}</h2>
        <div className="tok" style={{ margin: "6px 0" }}>{empty ? "—" : card.amount} <small>{card.token}</small></div>
        {card.demo && <div className="warn" style={{ marginBottom: 8 }}>Demo mode: nothing is sent yet.</div>}
        {card.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><button className="big" style={{ background: "#27272a", color: "#fff", border: "1px solid #3f3f46" }}>{l.label} ↗</button></a>)}
        {step === "done" ? (<div style={{ marginTop: 14 }}><div className="tok ok">✓ Claimed</div>{tx && <a style={{ color: "#EAA221" }} href={`https://basescan.org/tx/${tx}`} target="_blank">View on BaseScan ↗</a>}</div>)
          : empty ? <button className="big" disabled>{card.state === "retired" ? "Claim retired" : "Claim empty"}</button>
          : !me ? <button className="big" onClick={onConnect}>Connect wallet to claim</button>
          : <button className="big" disabled={step !== "idle" || (!card.demo && !auth)} onClick={onClaim}>{step === "busy" ? "Approve in wallet…" : step === "mining" ? "Confirming…" : `Claim ${card.amount} ${card.token}`}</button>}
        {me && step !== "done" && <p className="muted">Connected {short(me)}{auth?.name ? ` · ${auth.name}` : ""}</p>}
        {card.basenameOnly && !empty && <p className="muted">Needs a primary Basename (name.base.eth) on your wallet.</p>}
        {msg && <p className="warn">{msg}</p>}
      </div>
    </div>
    <p className="muted" style={{ textAlign: "center", marginTop: 14 }}>Connecting only shares your address. You sign once, to claim. Claimer pays a few cents of Base gas.</p>
  </div>);
}
