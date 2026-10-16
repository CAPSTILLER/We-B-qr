import { useMemo, useState } from "react";
import { CAP, GEAR_COLORS, LORE_COLORS, TOKENS, contrast, eip681, payLink, qrSvg, type ModuleShape, type TokenId } from "./lib";
import { Nav } from "./Nav";

export function download(svg: string, name: string, png: boolean) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  if (!png) return save(url, name + ".svg");
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = img.width * 2; c.height = img.height * 2;
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => save(URL.createObjectURL(b!), name + ".png"));
  };
  img.src = url;
}
function save(url: string, name: string) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }

const G = GEAR_COLORS;
const PRESETS: Record<string, string[]> = {
  "All 12 Gears": Object.values(G), Master: [LORE_COLORS.master, G.orchid], Forged: [LORE_COLORS.forged, G.marigold, G.crimson],
  Crimson: [G.crimson], Base: [G.base], "Crimson→Base": [G.crimson, G.base], "Sapphire→Turquoise": [G.sapphire, G.turquoise],
  "Amethyst→Orchid": [G.amethyst, G.orchid], "Emerald→Chartreuse": [G.emerald, G.chartreuse], Ink: ["#000000"],
};
const cap = (n: string) => n[0].toUpperCase() + n.slice(1);

export function Studio() {
  const [mode, setMode] = useState<"link" | "pay">("pay");
  const [text, setText] = useState("https://gearup.wtf");
  const [token, setToken] = useState<TokenId>("USDC");
  const [amt, setAmt] = useState("5");
  const [to, setTo] = useState(CAP);
  const [note, setNote] = useState("");
  const [enc, setEnc] = useState<"web" | "wallet">("web");
  const [shape, setShape] = useState<ModuleShape>("gear");
  const [colors, setColors] = useState<string[]>(["#DC143C", "#0000FF"]);
  const [bg, setBg] = useState("#ffffff");
  const [logo, setLogo] = useState<"none" | "GEAR" | "CAPH" | "image">("GEAR");
  const [img, setImg] = useState<string>();
  const [frame, setFrame] = useState(true);
  const [anim, setAnim] = useState(true);

  const payload = mode === "link" ? text : enc === "web" ? payLink(location.origin, token, to, amt, note) : eip681(token, to, amt);
  const cta = mode === "pay" ? `SCAN TO PAY ${amt} ${token}` : "SCAN ME";
  const svg = useMemo(() => {
    try { return qrSvg(payload, { shape, colors, bg, logo, logoImage: img, frameText: frame ? cta : undefined }); } catch { return ""; }
  }, [payload, shape, colors, bg, logo, img, frame, cta]);
  const worst = Math.min(...colors.map((c) => contrast(c, bg)));
  const toggle = (c: string) => setColors((cs) => cs.includes(c) ? (cs.length > 1 ? cs.filter((x) => x !== c) : cs) : [...cs, c]);

  return (<div className="wrap"><Nav on="/" />
    <div className="card">
      <div className="seg"><button className={mode === "pay" ? "on" : ""} onClick={() => setMode("pay")}>💸 Scan to Pay</button><button className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>🔗 Link / Text</button></div>
      {mode === "link" ? (<><label>Link or text</label><input value={text} onChange={(e) => setText(e.target.value)} /></>) : (<>
        <div className="row"><div><label>Amount</label><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          <div><label>Token</label><select value={token} onChange={(e) => setToken(e.target.value as TokenId)}>{Object.keys(TOKENS).map((t) => <option key={t}>{t}</option>)}</select></div></div>
        <label>Pay to (address or name.base.eth)</label><input value={to} onChange={(e) => setTo(e.target.value.trim())} />
        <label>Note (optional)</label><input value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} />
        <label>QR opens</label>
        <div className="seg"><button className={enc === "web" ? "on" : ""} onClick={() => setEnc("web")}>Pay page (any camera)</button><button className={enc === "wallet" ? "on" : ""} onClick={() => setEnc("wallet")}>Wallet app (EIP-681)</button></div>
        {enc === "wallet" && to.includes(".") && <div className="warn">Wallet-app mode needs a 0x address, not a name.</div>}
      </>)}
    </div>
    <div className={"qr " + (anim ? "spin" : "")} dangerouslySetInnerHTML={{ __html: svg }} />
    {worst < 4 && <div className="warn">⚠ Low contrast ({worst.toFixed(1)}:1). Some phones may not scan. Use darker colors or a lighter background.</div>}
    <div className="row noprint"><button onClick={() => download(svg, "we-b-qr", true)}>⬇ PNG</button><button onClick={() => download(svg, "we-b-qr", false)}>⬇ SVG</button><button onClick={() => navigator.share?.({ url: payload }) ?? navigator.clipboard.writeText(payload)}>Share link</button></div>
    <div className="muted" style={{ marginTop: 8 }}>{payload}</div>
    <div className="card">
      <label>Modules</label><div className="seg">{(["gear", "dot", "rounded", "square"] as ModuleShape[]).map((s) => <button key={s} className={shape === s ? "on" : ""} onClick={() => setShape(s)}>{s}</button>)}</div>
      <label>Gear lore colors (tap 2+ for a gradient)</label>
      <div className="sw">{Object.entries(LORE_COLORS).map(([n, c]) => <i key={n} title={`${cap(n)} ${c}`} style={{ background: c }} className={colors.includes(c) ? "on" : ""} onClick={() => toggle(c)} />)}<i title="black" style={{ background: "#000" }} className={colors.includes("#000000") ? "on" : ""} onClick={() => toggle("#000000")} /></div>
      <div className="seg" style={{ marginTop: 8 }}>{Object.entries(PRESETS).map(([n, c]) => <button key={n} onClick={() => setColors(c)}>{n}</button>)}</div>
      <div className="row"><div><label>Background</label><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ height: 44 }} /></div>
        <div><label>Center logo</label><select value={logo} onChange={(e) => setLogo(e.target.value as any)}><option value="GEAR">GEAR gear</option><option value="CAPH">CAPH gear</option><option value="image">My image</option><option value="none">None</option></select></div></div>
      {logo === "image" && <input type="file" accept="image/*" style={{ marginTop: 8 }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setImg(r.result as string); r.readAsDataURL(f); } }} />}
      <div className="seg" style={{ marginTop: 10 }}><button className={frame ? "on" : ""} onClick={() => setFrame(!frame)}>Frame: “{cta}”</button><button className={anim ? "on" : ""} onClick={() => setAnim(!anim)}>Wobble</button></div>
      <div className="muted" style={{ marginTop: 8 }}>Error correction is always High (30%), so styles and logos stay scannable.</div>
    </div>
  </div>);
}
