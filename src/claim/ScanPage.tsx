import { useEffect, useState } from "react";
import type { EIP1193Provider } from "viem";
import { api, claimData, short, humanError } from "./api";
import { baseClient, injected } from "../wallet";
import { GEAR_COLORS } from "../lib";

// Same invite as the gearup.wtf lander
const INVITE_URL = "https://base.app/invite/capzero/FPR4HYZ0";
const INVITE_CODE = "FPR4HYZ0";

type Card = { mode?: "rotating" | "faucet"; perWalletHours?: number; name: string; token: string; amount: string; links: { label: string; url: string }[]; state: "ready" | "locked" | "empty" | "retired"; basenameOnly: boolean; demo: boolean };

/** Detect only: never prompts. Any EIP-1193 wallet works. In a wallet's in-app browser, window.ethereum is that
 *  wallet, so prefer it; otherwise the first EIP-6963 announcement (MetaMask, Rabby, Rainbow, Phantom, Trust...). */
function detectWallet(): EIP1193Provider | null {
  return ((window as any).ethereum as EIP1193Provider | undefined) ?? injected[0]?.provider ?? null;
}
const deepLinks = (url: string) => {
  const noScheme = url.replace(/^https?:\/\//, ""), enc = encodeURIComponent(url);
  return [
    ["MetaMask", `https://metamask.app.link/dapp/${noScheme}`],
    ["Coinbase / Base", `https://go.cb-w.com/dapp?cb_url=${enc}`],
    ["Trust", `https://link.trustwallet.com/open_url?coin_id=8453&url=${enc}`],
    ["Rainbow", `https://rnbwapp.com/dapp?url=${enc}`],
  ] as const;
};

export function ScanPage() {
  const id = location.pathname.startsWith("/c/") ? location.pathname.slice(3) : "";
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState("");
  const [prov, setProv] = useState<EIP1193Provider | null>(null);
  const [checked, setChecked] = useState(false);
  const [me, setMe] = useState("");
  const [step, setStep] = useState<"idle" | "busy" | "mining" | "done">("idle");
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");
  const [copied, setCopied] = useState(false);
  const [comeBack, setComeBack] = useState<number | null>(null);
  useEffect(() => { if (id) api<Card>("card", { id }).then(setCard).catch((e) => setErr(e.message)); else setErr("This code isn't active"); }, [id]);
  useEffect(() => { // wallets announce within a few ms (EIP-6963); check again shortly after load
    setProv(detectWallet());
    const t = setTimeout(() => { setProv(detectWallet()); setChecked(true); }, 600);
    return () => clearTimeout(t);
  }, []);

  /** One tap: accounts request fires first, inside the gesture; then the claim approval. */
  const onClaim = () => {
    if (!prov) return;
    setMsg(""); setStep("busy");
    (prov.request({ method: "eth_requestAccounts" }) as Promise<`0x${string}`[]>).then(async ([addr]) => {
      setMe(addr);
      const auth: any = await api("prepare", { id, wallet: addr });
      if (auth.comeBackHours) setComeBack(auth.comeBackHours);
      if (auth.demo) { setStep("done"); return; }
      if (Number(await prov.request({ method: "eth_chainId" })) !== 8453) await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
      const h = (await prov.request({ method: "eth_sendTransaction", params: [{ from: addr, to: auth.contract, data: claimData(auth.args, auth.sig) } as any] })) as `0x${string}`;
      setTx(h); setStep("mining");
      const r = await baseClient.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("Claim failed onchain. Someone may have claimed it first.");
      await api("confirm", { id, tx: h }).catch(() => {});
      setStep("done");
    }).catch((e) => { setStep("idle"); setMsg(humanError(e)); });
  };
  const [copiedLink, setCopiedLink] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(INVITE_CODE).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  const copyLink = () => { navigator.clipboard?.writeText(location.href).then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1500); }); };

  const ring = `conic-gradient(${Object.values(GEAR_COLORS).join(",")},${GEAR_COLORS.crimson})`;
  if (err) return <div className="wrap"><div className="card" style={{ textAlign: "center", marginTop: 60 }}><div style={{ fontSize: 48 }}>⚙</div><p>{err}</p></div></div>;
  if (!card) return <div className="wrap"><p className="muted" style={{ marginTop: 60, textAlign: "center" }}>Loading…</p></div>;
  const ready = card.state === "ready";
  const faucet = card.mode === "faucet";
  const status = faucet && card.state === "empty" ? "Faucet is dry. Check back later." : card.state === "locked" ? "⏳ Refilling soon. Check back later." : card.state === "empty" ? "Empty. Check back later." : card.state === "retired" ? "This code is retired." : "";
  return (<div className="wrap">
    <div style={{ background: ring, padding: 3, borderRadius: 22, marginTop: 20 }}>
      <div style={{ background: "#111114", borderRadius: 20, padding: 18, textAlign: "center" }}>
        <div style={{ fontSize: 13, letterSpacing: ".14em", color: "#a1a1aa" }}>PAYUP · QR CLAIM</div>
        <h2 style={{ margin: "8px 0 2px", fontSize: 26 }}>{card.name}</h2>
        {faucet && <div style={{ display: "inline-block", marginTop: 4, padding: "3px 10px", borderRadius: 999, background: "#EAA22122", color: "#EAA221", fontSize: 13 }}>🚰 Daily claim · once every {card.perWalletHours ?? 24}h per wallet</div>}
        <div className="tok" style={{ margin: "6px 0", opacity: ready ? 1 : 0.55 }}>{card.amount} <small>{card.token}</small></div>
        {card.demo && <div className="warn" style={{ marginBottom: 8 }}>Demo mode: nothing is sent yet.</div>}
        {status && <p style={{ color: card.state === "locked" ? "#EAA221" : "#a1a1aa", margin: "4px 0 8px" }}>{status}</p>}
        {card.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}><button className="big" style={{ background: "#27272a", color: "#fff", border: "1px solid #3f3f46" }}>{l.label} ↗</button></a>)}
        {step === "done" ? (<div style={{ marginTop: 14 }}><div className="tok ok">✓ Claimed</div>{faucet && <p style={{ color: "#EAA221" }}>Come back in {comeBack ?? card.perWalletHours ?? 24}h for your next claim.</p>}{tx && <a style={{ color: "#EAA221" }} href={`https://basescan.org/tx/${tx}`} target="_blank">View on BaseScan ↗</a>}</div>)
          : !ready ? <button className="big" disabled>{faucet ? "Faucet dry" : card.state === "locked" ? "Refilling soon" : card.state === "retired" ? "Claim retired" : "Claim empty"}</button>
          : prov ? <button className="big" disabled={step !== "idle"} onClick={onClaim}>{step === "busy" ? "Approve in wallet…" : step === "mining" ? "Confirming…" : `Claim ${card.amount} ${card.token}`}</button>
          : checked && (<div className="card" style={{ background: "#18181b", marginTop: 12 }}>
              <b>You need a crypto wallet to claim</b>
              <p className="muted">Any wallet works. Open this page in your wallet app's browser:</p>
              <div className="seg">{deepLinks(location.href).map(([n, u]) => <a key={n} href={u} style={{ flex: 1, minWidth: 120 }}><button style={{ width: "100%" }}>{n}</button></a>)}</div>
              <button style={{ width: "100%", marginTop: 8 }} onClick={copyLink}>{copiedLink ? "Link copied ✓" : "Copy link (paste in any wallet's browser)"}</button>
              <div style={{ borderTop: "1px solid #27272a", marginTop: 12, paddingTop: 10 }}>
                <a href={INVITE_URL} target="_blank" rel="noopener noreferrer"><button style={{ width: "100%" }}>New to crypto? Get the Base app ↗</button></a>
                <p className="muted" style={{ marginTop: 8 }}>Invite code: <button onClick={copy} style={{ padding: "4px 10px", fontFamily: "monospace" }}>{INVITE_CODE}</button> {copied ? "Copied!" : "(tap to copy)"}</p>
              </div>
            </div>)}
        {me && step !== "done" && <p className="muted">Wallet {short(me)}</p>}
        {card.basenameOnly && ready && <p className="muted">Needs a primary Basename (name.base.eth) on your wallet.</p>}
        {msg && <p className="warn">{msg}</p>}
      </div>
    </div>
    <p className="muted" style={{ textAlign: "center", marginTop: 14 }}>You approve once in your wallet to claim. Claimer pays a few cents of Base gas.</p>
    <style>{`.gear-home{display:block;width:28px;height:28px;margin:12px auto 20px;color:#8a8a93;opacity:.55;transition:opacity .2s,color .2s}.gear-home:hover,.gear-home:focus-visible{opacity:1;color:#f5b72a}`}</style>
    <a href="https://payup.gearup.wtf/" aria-label="Gear landing page" className="gear-home"><svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg></a>
  </div>);
}
