import { useEffect, useMemo, useState } from "react";
import { CAP, GEAR_COLORS, LORE_COLORS, TOKENS, artGrid, artQr, contrast, eip681, linksPage, payLink, qrSvg, safeUrl, type LinkItem, type ModuleShape, type TokenId } from "./lib";
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
export function save(url: string, name: string) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }

const G = GEAR_COLORS;
const PRESETS: Record<string, string[]> = {
  "All 12 Gears": Object.values(G), Master: [LORE_COLORS.master, G.orchid], Forged: [LORE_COLORS.forged, G.marigold, G.crimson],
  Crimson: [G.crimson], Base: [G.base], "Crimson→Base": [G.crimson, G.base], "Sapphire→Turquoise": [G.sapphire, G.turquoise],
  "Amethyst→Orchid": [G.amethyst, G.orchid], "Emerald→Chartreuse": [G.emerald, G.chartreuse], Ink: ["#000000"],
};
const cap = (n: string) => n[0].toUpperCase() + n.slice(1);

export function Studio() {
  const [mode, setMode] = useState<"link" | "pay">("link");
  const [multi, setMulti] = useState(false);
  const [links, setLinks] = useState<LinkItem[]>([{ url: "https://gearup.wtf", label: "Gear Up" }]);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState<"modules" | "image">("modules");
  const [art, setArt] = useState<HTMLImageElement>();
  const [artColor, setArtColor] = useState(true);
  const [artContrast, setArtContrast] = useState(0.6);
  const [artPng, setArtPng] = useState("");
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

  const goodLinks = links.map((l) => ({ ...l, url: safeUrl(l.url) ?? "" })).filter((l) => l.url);
  const payload = mode === "link" ? (multi ? linksPage(location.origin, goodLinks, title) : (safeUrl(text) && !/^[a-z][a-z0-9+.-]*:/i.test(text.trim()) ? safeUrl(text)! : text)) : enc === "web" ? payLink(location.origin, token, to, amt, note) : eip681(token, to, amt);
  const cta = mode === "pay" ? `SCAN TO PAY ${amt} ${token}` : "SCAN ME";
  const svg = useMemo(() => {
    try { return qrSvg(payload, { shape, colors, bg, logo, logoImage: img, frameText: frame ? cta : undefined }); } catch { return ""; }
  }, [payload, shape, colors, bg, logo, img, frame, cta]);
  useEffect(() => {
    if (style !== "image" || !art) { setArtPng(""); return; }
    try {
      const G = artGrid(payload);
      const c = document.createElement("canvas"); c.width = c.height = G;
      const x = c.getContext("2d")!; const s0 = Math.min(art.width, art.height);
      x.drawImage(art, (art.width - s0) / 2, (art.height - s0) / 2, s0, s0, 0, 0, G, G);
      const r = artQr(payload, x.getImageData(0, 0, G, G).data, { colors: artColor, contrast: artContrast, dot: 1 / 3, dark: "#000000", light: "#ffffff", px: 4 });
      const o = document.createElement("canvas"); o.width = r.width; o.height = r.height;
      o.getContext("2d")!.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
      setArtPng(o.toDataURL("image/png"));
    } catch { setArtPng(""); }
  }, [style, art, payload, artColor, artContrast]);
  const pickArt = (f?: File) => { if (!f) return; const i = new Image(); i.onload = () => setArt(i); i.src = URL.createObjectURL(f); };
  const setLink = (i: number, k: keyof LinkItem, v: string) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const worst = Math.min(...colors.map((c) => contrast(c, bg)));
  const toggle = (c: string) => setColors((cs) => cs.includes(c) ? (cs.length > 1 ? cs.filter((x) => x !== c) : cs) : [...cs, c]);

  return (<div className="wrap"><Nav on="/" />
    <div className="card">
      <div className="seg"><button className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>🔗 Link / Text</button><button className={mode === "pay" ? "on" : ""} onClick={() => setMode("pay")}>💸 Scan to Pay</button></div>
      {mode === "link" ? (<>
        <div className="seg" style={{ marginTop: 10 }}><button className={!multi ? "on" : ""} onClick={() => setMulti(false)}>Single link</button><button className={multi ? "on" : ""} onClick={() => setMulti(true)}>Multiple links (1–3)</button></div>
        {!multi ? (<><label>Link or text</label><input value={text} onChange={(e) => setText(e.target.value)} /><div className="muted">The QR opens this link directly.</div></>) : (<>
          <label>Card title (optional)</label><input value={title} maxLength={40} placeholder="My links" onChange={(e) => setTitle(e.target.value)} />
          {links.map((l, i) => (<div key={i} className="linkrow">
            <label>Link {i + 1}</label>
            <input value={l.url} placeholder="https://…" onChange={(e) => setLink(i, "url", e.target.value)} />
            <div className="row" style={{ marginTop: 6 }}><input value={l.label ?? ""} maxLength={40} placeholder="Label (optional)" onChange={(e) => setLink(i, "label", e.target.value)} />
              {links.length > 1 && <button style={{ flex: "0 0 auto" }} onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}>✕</button>}</div>
            {l.url.trim() && !safeUrl(l.url) && <div className="warn">Only http(s) links are allowed.</div>}
          </div>))}
          {links.length < 3 && <button style={{ width: "100%", marginTop: 10 }} onClick={() => setLinks((ls) => [...ls, { url: "" }])}>＋ Add link</button>}
          <div className="muted" style={{ marginTop: 6 }}>The QR opens a pop-up card with these links. Nothing is stored. The links live in the QR.</div>
        </>)}
      </>) : (<>
        <div className="row"><div><label>Amount</label><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          <div><label>Token</label><select value={token} onChange={(e) => setToken(e.target.value as TokenId)}>{Object.keys(TOKENS).map((t) => <option key={t}>{t}</option>)}</select></div></div>
        <label>Pay to (address or name.base.eth)</label><input value={to} onChange={(e) => setTo(e.target.value.trim())} />
        <label>Note (optional)</label><input value={note} maxLength={40} onChange={(e) => setNote(e.target.value)} />
        <label>QR opens</label>
        <div className="seg"><button className={enc === "web" ? "on" : ""} onClick={() => setEnc("web")}>Pay page (any camera)</button><button className={enc === "wallet" ? "on" : ""} onClick={() => setEnc("wallet")}>Wallet app (EIP-681)</button></div>
        {enc === "wallet" && to.includes(".") && <div className="warn">Wallet-app mode needs a 0x address, not a name.</div>}
      </>)}
    </div>
    {style === "image" && artPng ? <div className="qr"><img src={artPng} alt="Image QR" /></div> : <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />}
    {style === "image" && !art && <div className="warn">Upload an image below to weave it into the QR.</div>}
    {worst < 4 && <div className="warn">⚠ Low contrast ({worst.toFixed(1)}:1). Some phones may not scan. Use darker colors or a lighter background.</div>}
    <div className="row noprint">{style === "image" && artPng ? <button onClick={() => save(artPng, "we-b-qr-image.png")}>⬇ PNG</button> : <><button onClick={() => download(svg, "we-b-qr", true)}>⬇ PNG</button><button onClick={() => download(svg, "we-b-qr", false)}>⬇ SVG</button></>}<button onClick={() => navigator.share?.({ url: payload }) ?? navigator.clipboard.writeText(payload)}>Share link</button></div>
    <div className="muted" style={{ marginTop: 8 }}>{payload}</div>
    <div className="card">
      <label>Style</label><div className="seg"><button className={style === "modules" ? "on" : ""} onClick={() => setStyle("modules")}>⚙ Gear modules</button><button className={style === "image" ? "on" : ""} onClick={() => setStyle("image")}>🖼 Image QR</button></div>
      {style === "image" ? (<>
        <label>Your image</label><input type="file" accept="image/*" onChange={(e) => pickArt(e.target.files?.[0])} />
        <label>Image look</label><div className="seg"><button className={artColor ? "on" : ""} onClick={() => setArtColor(true)}>Color</button><button className={!artColor ? "on" : ""} onClick={() => setArtColor(false)}>Black &amp; white</button></div>
        <label>Contrast: {Math.round(artContrast * 100)}% (higher scans easier)</label><input type="range" min={0.3} max={1} step={0.05} value={artContrast} onChange={(e) => setArtContrast(+e.target.value)} />
        <div className="muted" style={{ marginTop: 8 }}>Your image is woven through the QR dots. Corner squares stay clean and every dot keeps a solid center, so it still scans. Your image never leaves your phone.</div>
      </>) : (<>
      <label>Modules</label><div className="seg">{(["gear", "dot", "rounded", "square"] as ModuleShape[]).map((s) => <button key={s} className={shape === s ? "on" : ""} onClick={() => setShape(s)}>{s}</button>)}</div>
      <label>Gear lore colors (tap 2+ for a gradient)</label>
      <div className="sw">{Object.entries(LORE_COLORS).map(([n, c]) => <i key={n} title={`${cap(n)} ${c}`} style={{ background: c }} className={colors.includes(c) ? "on" : ""} onClick={() => toggle(c)} />)}<i title="black" style={{ background: "#000" }} className={colors.includes("#000000") ? "on" : ""} onClick={() => toggle("#000000")} /></div>
      <div className="seg" style={{ marginTop: 8 }}>{Object.entries(PRESETS).map(([n, c]) => <button key={n} onClick={() => setColors(c)}>{n}</button>)}</div>
      <div className="row"><div><label>Background</label><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ height: 44 }} /></div>
        <div><label>Center logo</label><select value={logo} onChange={(e) => setLogo(e.target.value as any)}><option value="GEAR">GEAR gear</option><option value="CAPH">CAPH gear</option><option value="image">My image</option><option value="none">None</option></select></div></div>
      {logo === "image" && <input type="file" accept="image/*" style={{ marginTop: 8 }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setImg(r.result as string); r.readAsDataURL(f); } }} />}
      <div className="seg" style={{ marginTop: 10 }}><button className={frame ? "on" : ""} onClick={() => setFrame(!frame)}>Frame: “{cta}”</button></div>
      <div className="muted" style={{ marginTop: 8 }}>Error correction is always High (30%), so styles and logos stay scannable.</div>
      </>)}
    </div>
  </div>);
}
