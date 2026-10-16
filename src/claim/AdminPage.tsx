import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData } from "viem";
import { api, connect, wallet, sendTx, short, CONTRACT_ABI } from "./api";
import { GEAR_COLORS, LORE_COLORS, qrSvg } from "../lib";

type Link = { label: string; url: string };
type Code = { id: string; serial: number; name: string; folderId: string; token: string; amount: string; kind: "digital" | "paper"; basenameOnly: boolean; unlockWindowH: number; dailyCap: number; links: Link[]; status: string; filled: boolean; unlockAt: number; claims: number; lastClaimAt: number };
type Folder = { id: string; name: string; defaults?: any };
type State = { role: "owner" | "teammate"; me: string; folders: Folder[]; codes: Code[]; alerts: any[]; contract: string | null; persistent: boolean };
const TOKEN_ADDR: Record<string, `0x${string}`> = { GEAR: "0x5880cD05605A549f1DAb01a53ca61Ee559244bD1", CAPH: "0x1d1bcd1459259429accde23e24e1782f83e97ba3" };
const DEC: Record<string, number> = { GEAR: 6, CAPH: 18 };
const raw = (a: string, d: number) => { const [w, f = ""] = a.split("."); return BigInt(w || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0"); };
const colorOf = (i: number) => Object.values(GEAR_COLORS)[i % 12];
const when = (t: number) => (t ? new Date(t).toLocaleString() : "—");

export function AdminPage() {
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [msgToSign, setMsgToSign] = useState("");
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [folder, setFolder] = useState("all");
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState<"codes" | "new" | "alerts" | "audit" | { id: string }>("codes");
  const load = () => api<State>("state").then(setSt).catch((e) => { if (e.status === 401) localStorage.removeItem("qrclaim:session"); setErr(e.message); setSt(null); });
  useEffect(() => { if (localStorage.getItem("qrclaim:session")) load(); }, []);

  const onConnect = () => connect().then(async (a) => { setMe(a); setMsgToSign((await api("nonce", { address: a })).message); }).catch((e) => setErr(e.message));
  const onSign = () => {
    setErr("");
    (wallet().request({ method: "personal_sign", params: [msgToSign as any, me!] }) as Promise<`0x${string}`>)
      .then((signature) => api("login", { address: me, signature }))
      .then((r) => { localStorage.setItem("qrclaim:session", r.token); load(); })
      .catch((e) => setErr(e?.shortMessage ?? e.message));
  };
  const logout = () => { localStorage.removeItem("qrclaim:session"); setSt(null); setMe(null); setMsgToSign(""); };

  if (!st) return (<div className="wrap"><h1>QR <span>Claim</span> admin</h1>
    <div className="card"><p className="muted">Owner Ledger sets rules. CAPs Mind NFT holders can view, print and organize. Connecting is read-only. Signing in is one free signature (no gas).</p>
      {!me ? <button className="big" onClick={onConnect}>Connect wallet</button>
        : <><p className="muted">Connected {short(me)}</p><button className="big" disabled={!msgToSign} onClick={onSign}>Sign in (free)</button></>}
      {err && <p className="warn">{err}</p>}</div></div>);

  const owner = st.role === "owner";
  const fname = (id: string) => st.folders.find((f) => f.id === id)?.name ?? "Unfiled";
  const shown = st.codes.filter((c) => folder === "all" || c.folderId === folder);
  const run = (p: Promise<any>) => p.then(load).catch((e) => setErr(e.message));

  return (<div className="wrap" style={{ maxWidth: 760 }}>
    <div className="noprint">
      <h1>QR <span>Claim</span> admin</h1>
      <p className="muted">{owner ? "👑 Owner Ledger" : "🧠 Teammate (CAPs Mind)"} · {short(st.me)} · <a style={{ color: "#EAA221" }} onClick={logout}>log out</a></p>
      {!st.contract && <div className="warn">Demo mode: no QR Claim Contract set, so claims move no tokens.</div>}
      {!st.persistent && <div className="warn">Storage not connected (Upstash env missing). Data resets on redeploy.</div>}
      {err && <p className="warn" onClick={() => setErr("")}>{err} ✕</p>}
      <div className="nav">
        {(["codes", ...(owner ? ["new"] : []), "alerts", ...(owner ? ["audit"] : [])] as const).map((v) => <a key={v} className={view === v ? "on" : ""} onClick={() => setView(v as any)}>{v === "new" ? "+ New code" : v === "codes" ? `Codes (${st.codes.length})` : v === "alerts" ? `Alerts (${st.alerts.length})` : "Audit"}</a>)}
      </div>
    </div>
    {view === "codes" && <>
      <div className="seg">
        <button className={folder === "all" ? "on" : ""} onClick={() => setFolder("all")}>All</button>
        {st.folders.map((f, i) => <button key={f.id} className={folder === f.id ? "on" : ""} onClick={() => setFolder(f.id)}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: f.id === "bot-grab" ? "#DC143C" : colorOf(i), marginRight: 6 }} />{f.name} ({st.codes.filter((c) => c.folderId === f.id).length})</button>)}
        <button onClick={() => { const n = prompt("Folder name"); if (n) run(api("saveFolder", { folder: { name: n } })); }}>+ Folder</button>
      </div>
      {folder !== "all" && folder !== "bot-grab" && <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => { const n = prompt("Rename folder", fname(folder)); if (n) run(api("saveFolder", { folder: { id: folder, name: n } })); }}>Rename</button>
        <button onClick={() => run(api("deleteFolder", { id: folder }).then(() => setFolder("all")))}>Delete (if empty)</button></div>}
      {sel.length > 0 && <div className="card row">
        <select onChange={(e) => { if (e.target.value) run(api("move", { ids: sel, folderId: e.target.value }).then(() => setSel([]))); }} defaultValue=""><option value="">Move {sel.length} to…</option>{st.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        {owner && <RefillButton ids={sel} st={st} done={() => { setSel([]); load(); }} onErr={setErr} />}
      </div>}
      {shown.length === 0 && <p className="muted">No codes here yet.{owner ? " Tap “+ New code” to create and name one." : ""}</p>}
      {shown.map((c) => (
        <div key={c.id} className="card" style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderLeft: `4px solid ${c.folderId === "bot-grab" ? "#DC143C" : c.token === "CAPH" ? LORE_COLORS.master : "#EAA221"}` }}>
          <input type="checkbox" style={{ width: 22 }} checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />
          <div style={{ flex: 1 }} onClick={() => setView({ id: c.id })}>
            <b>#{c.serial} {c.name}</b><div className="muted">{c.amount} {c.token} · {c.kind}{c.basenameOnly ? " · Basename" : ""} · {fname(c.folderId)}</div></div>
          <div style={{ textAlign: "right", fontSize: 13 }}><div className={c.status !== "active" ? "warn" : c.filled ? "ok" : "muted"}>{c.status !== "active" ? "retired" : c.filled ? (Date.now() < c.unlockAt ? "locked" : "ready") : "empty"}</div><div className="muted">{c.claims} claims</div></div>
        </div>))}
    </>}
    {view === "new" && owner && <CodeForm st={st} onSaved={(c) => { load(); setView({ id: c.id }); }} onErr={setErr} />}
    {typeof view === "object" && <CodeDetail id={view.id} st={st} back={() => { setView("codes"); load(); }} onErr={setErr} />}
    {view === "alerts" && <div>{st.alerts.length === 0 && <p className="muted">No bot alerts yet.</p>}{st.alerts.map((a) => {
      const c = st.codes.find((x) => x.id === a.codeId);
      return <div key={a.id} className="card"><b>{a.kind === "instant" ? "⚡ Instant claim" : a.kind === "repeat_wallet" ? "🔁 Repeat wallet" : a.kind === "daily_cap" ? "🧱 Daily cap hit" : "🚫 Failed burst"}</b> · {c ? `#${c.serial} ${c.name}` : "code"}<div className="muted">{a.detail} · {when(a.at)}</div>
        {c && c.folderId !== "bot-grab" && <button style={{ marginTop: 6 }} onClick={() => run(api("move", { ids: [c.id], folderId: "bot-grab" }))}>Move to Bot grab</button>}</div>;
    })}</div>}
    {view === "audit" && owner && <Audit />}
  </div>);
}

function RefillButton({ ids, st, done, onErr }: { ids: string[]; st: State; done: () => void; onErr: (e: string) => void }) {
  const [pending, setPending] = useState<any[] | null>(null);
  const refill = () => api("refill", { ids }).then((r) => (st.contract ? setPending(r.codes) : done())).catch((e) => onErr(e.message));
  const sendOnchain = () => {
    const byToken: Record<string, any[]> = {};
    pending!.forEach((c) => (byToken[c.token] ??= []).push(c));
    const [tok, list] = Object.entries(byToken)[0];
    const data = encodeFunctionData({ abi: CONTRACT_ABI, functionName: "refill", args: [list.map((c) => c.slotKey), TOKEN_ADDR[tok] ?? tok, list.map((c) => raw(c.amount, DEC[tok] ?? 18))] });
    sendTx(st.me as `0x${string}`, st.contract as `0x${string}`, data).then(() => { setPending(null); done(); }).catch((e) => onErr(e?.shortMessage ?? e.message));
  };
  return pending ? <button className="on" onClick={sendOnchain}>Approve refill on Ledger ({pending.length})</button> : <button onClick={refill}>Refill {ids.length}</button>;
}

function CodeForm({ st, onSaved, onErr, edit }: { st: State; onSaved: (c: Code) => void; onErr: (e: string) => void; edit?: Code }) {
  const [f, setF] = useState<any>(edit ?? { name: "", folderId: st.folders.find((x) => x.id !== "bot-grab")?.id ?? "", token: "GEAR", amount: "1", kind: "paper", basenameOnly: false, unlockWindowH: 24, dailyCap: 3, links: [] });
  const set = (k: string, v: any) => setF((o: any) => ({ ...o, [k]: v }));
  const links: Link[] = [...f.links, ...Array(3).fill({ label: "", url: "" })].slice(0, 3);
  const setLink = (i: number, k: keyof Link, v: string) => set("links", links.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const save = () => (edit ? api("updateCode", { id: edit.id, code: f }) : api("createCode", { code: f })).then(onSaved).catch((e) => onErr(e.message));
  return (<div className="card">
    <label>Code name</label><input value={f.name} placeholder="e.g. Coffee shop gear #1" onChange={(e) => set("name", e.target.value)} />
    <label>Folder</label><select value={f.folderId} onChange={(e) => set("folderId", e.target.value)}><option value="">Unfiled</option>{st.folders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <label>Token</label><div className="seg">{["GEAR", "CAPH"].map((t) => <button key={t} className={f.token === t ? "on" : ""} onClick={() => set("token", t)}>{t}</button>)}</div>
    <input style={{ marginTop: 6 }} placeholder="or allowlisted token 0x…" value={["GEAR", "CAPH"].includes(f.token) ? "" : f.token} onChange={(e) => set("token", e.target.value.trim() || "GEAR")} />
    <div className="row"><div><label>Amount per claim</label><input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^0-9.]/g, ""))} /></div>
      <div><label>Unlock window (h)</label><input type="number" value={f.unlockWindowH} onChange={(e) => set("unlockWindowH", +e.target.value)} /></div>
      <div><label>Wallet claims/day</label><input type="number" value={f.dailyCap} onChange={(e) => set("dailyCap", +e.target.value)} /></div></div>
    <label>Type</label><div className="seg">
      <button className={f.kind === "paper" ? "on" : ""} onClick={() => setF((o: any) => ({ ...o, kind: "paper", basenameOnly: false }))}>🧾 Paper</button>
      <button className={f.kind === "digital" ? "on" : ""} onClick={() => setF((o: any) => ({ ...o, kind: "digital", basenameOnly: true }))}>📱 Digital</button>
      <button className={f.basenameOnly ? "on" : ""} onClick={() => set("basenameOnly", !f.basenameOnly)}>Basename only: {f.basenameOnly ? "on" : "off"}</button></div>
    <label>Link buttons on the card (up to 3)</label>
    {links.map((l, i) => <div className="row" key={i} style={{ marginBottom: 6 }}><input placeholder={`Button ${i + 1} label`} value={l.label} onChange={(e) => setLink(i, "label", e.target.value)} /><input placeholder="https://…" value={l.url} onChange={(e) => setLink(i, "url", e.target.value)} /></div>)}
    <p className="muted">Each claim: once per wallet per code. Empty until you refill; refill unlocks at a random time inside the window.</p>
    <button className="big" onClick={save}>{edit ? "Save rules" : "Create code"}</button>
  </div>);
}

function CodeDetail({ id, st, back, onErr }: { id: string; st: State; back: () => void; onErr: (e: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [showQr, setShowQr] = useState(false);
  const [editing, setEditing] = useState(false);
  const owner = st.role === "owner";
  const load = () => api("code", { id }).then(setD).catch((e) => onErr(e.message));
  useEffect(() => { load(); }, [id]);
  const url = `${location.origin}/c/${id}`;
  const svg = useMemo(() => (showQr && d ? qrSvg(url, { shape: "rounded", colors: ["#000000"], bg: "#ffffff", logo: "GEAR", frameText: d.code.name.toUpperCase().slice(0, 22) }) : ""), [showQr, d]);
  if (!d) return <p className="muted">Loading…</p>;
  const c: Code = d.code;
  const secs = d.claims.map((x: any) => x.secsFromUnlock).filter((n: number) => n >= 0);
  const act = (a: string) => api(a, { id }).then(async (r) => {
    if (st.contract && a === "retire") await sendTx(st.me as `0x${string}`, st.contract as `0x${string}`, encodeFunctionData({ abi: CONTRACT_ABI, functionName: "retire", args: [r.slotKey] }));
    if (st.contract && a === "rotate") await sendTx(st.me as `0x${string}`, st.contract as `0x${string}`, encodeFunctionData({ abi: CONTRACT_ABI, functionName: "retire", args: [r.oldSlotKey] }));
    back();
  }).catch((e) => onErr(e?.shortMessage ?? e.message));
  if (editing) return <CodeForm st={st} edit={c} onSaved={() => { setEditing(false); load(); }} onErr={onErr} />;
  return (<div>
    <p className="noprint"><a style={{ color: "#EAA221" }} onClick={back}>← Codes</a></p>
    <div className="card noprint"><h2 style={{ margin: 0 }}>#{c.serial} {c.name}</h2>
      <p className="muted">{c.amount} {c.token} · {c.kind} · Basename {c.basenameOnly ? "on" : "off"} · unlock ≤{c.unlockWindowH}h · {c.dailyCap}/day · {c.status}</p>
      <p className="muted">Claims {c.claims} · last {when(c.lastClaimAt)} · median refill→claim {secs.length ? Math.round(secs.sort((a: number, b: number) => a - b)[secs.length >> 1] / 60) + " min" : "—"}</p>
      {c.links.map((l) => <div key={l.url} className="muted">🔗 {l.label}: {l.url}</div>)}
      <div className="seg" style={{ marginTop: 10 }}>
        <button onClick={() => setShowQr(!showQr)}>{showQr ? "Hide QR" : "Show QR"}</button>
        {showQr && <button onClick={() => api("logPrint", { ids: [id] }).then(() => print())}>🖨 Print</button>}
        {owner && c.status === "active" && <RefillButton ids={[id]} st={st} done={load} onErr={onErr} />}
        {owner && <button onClick={() => setEditing(true)}>Edit rules</button>}
        {owner && c.status === "active" && <button onClick={() => confirm("Rotate: new random link, old one dies?") && act("rotate")}>Rotate</button>}
        {owner && c.status === "active" && <button onClick={() => confirm("Retire this code?") && act("retire")}>Retire</button>}
        <button onClick={() => api("move", { ids: [id], folderId: "bot-grab" }).then(back)}>→ Bot grab</button>
      </div></div>
    {showQr && <div className="card" style={{ background: "#fff", textAlign: "center" }}><div style={{ maxWidth: 320, margin: "0 auto" }} dangerouslySetInnerHTML={{ __html: svg }} /><div className="muted noprint" style={{ color: "#555" }}>{url}</div></div>}
    <div className="card noprint"><b>Claims</b>{d.claims.length === 0 && <p className="muted">None yet.</p>}
      {d.claims.map((x: any, i: number) => <div key={i} className="muted" style={{ padding: "6px 0", borderBottom: "1px solid #27272a" }}>{when(x.at)} · {x.name ?? short(x.wallet)} · {x.secsFromUnlock}s after unlock · {x.status}{x.tx ? <> · <a style={{ color: "#EAA221" }} href={`https://basescan.org/tx/${x.tx}`} target="_blank">tx</a></> : null}</div>)}</div>
  </div>);
}

function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api("audit").then(setRows); }, []);
  return <div className="card">{rows.map((r, i) => <div key={i} className="muted" style={{ padding: "4px 0" }}>{when(r.at)} · {short(r.actor || "0x0000000000")} · <b>{r.action}</b> {r.ids?.length ? `(${r.ids.length})` : ""} {r.extra}</div>)}</div>;
}
