import { useMemo, useState } from "react";
import { keccak256 } from "viem";
import { CAP, GEAR_COLORS, TOKENS, claimLink, payLink, qrSvg, randomSecret, type TokenId } from "./lib";
import { Nav } from "./Nav";

function gearOutline(color: string, inner: string, label: string, sub: string) {
  const teeth = 12, R = 100, r = 88, pts: string[] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2, rr = i % 4 < 2 ? R : r;
    pts.push(`${(110 + rr * Math.cos(a)).toFixed(1)},${(110 + rr * Math.sin(a)).toFixed(1)}`);
  }
  const qr = inner.replace("<svg ", `<svg x="58" y="50" width="104" height="104" `).replace(/width="512" height="[\d.]+"/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220"><path d="M${pts.join("L")}Z" fill="${color}" stroke="#000" stroke-width="2"/><circle cx="110" cy="110" r="74" fill="#fff"/>${qr}<text x="110" y="172" font-family="monospace" font-weight="700" font-size="15" text-anchor="middle">${label}</text><text x="110" y="44" font-family="monospace" font-size="9" text-anchor="middle">${sub}</text></svg>`;
}

export function PaperGears() {
  const [kind, setKind] = useState<"PAY" | "CLAIM">("PAY");
  const [count, setCount] = useState(9);
  const [amt, setAmt] = useState("5");
  const [token, setToken] = useState<TokenId>("USDC");
  const [to, setTo] = useState(CAP);
  const [startId, setStartId] = useState(1);
  const [seed, setSeed] = useState(0);
  const cards = useMemo(() => {
    const names = Object.keys(GEAR_COLORS);
    return Array.from({ length: Math.min(count, 60) }, (_, i) => {
      const color = GEAR_COLORS[names[(startId + i - 1) % 12]];
      if (kind === "PAY") {
        const link = payLink(location.origin, token, to, amt);
        return { svg: gearOutline(color, qrSvg(link, { shape: "rounded", colors: ["#000000"], bg: "#ffffff", logo: "none" }), `PAY ${amt} ${token}`, "SCAN TO PAY") };
      }
      const id = startId + i, secret = randomSecret();
      const link = claimLink(location.origin, String(id), secret) + `&a=${amt}`;
      return { id, secret, hash: keccak256(`0x${secret}`), svg: gearOutline(color, qrSvg(link, { shape: "rounded", colors: ["#000000"], bg: "#ffffff", logo: "none" }), `${amt} GEAR`, `PAPER GEAR #${id}`) };
    });
  }, [kind, count, amt, token, to, startId, seed]);
  const csv = () => {
    const rows = ["id,hash,amount_raw", ...cards.map((c: any) => `${c.id},${c.hash},${BigInt(Math.round(Number(amt) * 1e6))}`)].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows])); a.download = `paper-gears-${startId}.csv`; a.click();
  };
  return (<div className="wrap"><Nav on="/paper" />
    <div className="card noprint">
      <p className="muted">💸 Pay cards. Claim codes now live in <a style={{ color: "#EAA221" }} href="/claim-admin">QR Claim admin</a>.</p>
      <div className="row"><div><label>Amount</label><input value={amt} inputMode="decimal" onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
        <div><label>Cards</label><input type="number" value={count} onChange={(e) => setCount(+e.target.value || 1)} /></div>
        {kind === "CLAIM" ? <div><label>First #</label><input type="number" value={startId} onChange={(e) => setStartId(+e.target.value || 1)} /></div>
          : <div><label>Token</label><select value={token} onChange={(e) => setToken(e.target.value as TokenId)}>{Object.keys(TOKENS).map((t) => <option key={t}>{t}</option>)}</select></div>}</div>
      {kind === "PAY" && <><label>Pay to</label><input value={to} onChange={(e) => setTo(e.target.value)} /></>}
      {kind === "CLAIM" && <p className="muted">Each card gets a fresh secret made on this phone. Download the CSV and register the hashes in the voucher contract before handing cards out. The secrets are only on the printed cards, and a new batch is made every time you reload.</p>}
      <div className="row"><button onClick={() => print()}>🖨 Print sheet</button>{kind === "CLAIM" && <><button onClick={csv}>⬇ Hash CSV</button><button onClick={() => setSeed(seed + 1)}>New secrets</button></>}</div>
    </div>
    <div className="sheet">{cards.map((c, i) => <div key={i} dangerouslySetInnerHTML={{ __html: c.svg }} />)}</div>
  </div>);
}
