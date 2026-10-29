import { useEffect, useMemo, useRef, useState } from "react";
import jsQR from "jsqr";
import { LORE_COLORS, safeUrl } from "./lib";
import { Nav } from "./Nav";
import { save } from "./Studio";
import { buildArt, pxFor, renderRGBA, renderSVG, SHAPES, type ArtGrid, type ArtStyle, type Pic } from "./artqr";

type Src = "shape" | "upload" | "draw";
const PAD = 25;

function decodes(rgba: { width: number; height: number; data: Uint8ClampedArray }, text: string): boolean {
  // check at full size and at two smaller scales (like a phone camera further away)
  const c = document.createElement("canvas"); c.width = rgba.width; c.height = rgba.height;
  c.getContext("2d")!.putImageData(new ImageData(rgba.data as Uint8ClampedArray<ArrayBuffer>, rgba.width, rgba.height), 0, 0);
  for (const s of [1, 0.55, 0.35]) {
    const w = Math.round(rgba.width * s), d = document.createElement("canvas"); d.width = d.height = w;
    const x = d.getContext("2d", { willReadFrequently: true })!; x.imageSmoothingEnabled = true; x.drawImage(c, 0, 0, w, w);
    const img = x.getImageData(0, 0, w, w);
    if (jsQR(img.data, w, w, { inversionAttempts: "attemptBoth" })?.data !== text) return false;
  }
  return true;
}

export function ArtQrPage() {
  const [url, setUrl] = useState("https://payup.gearup.wtf");
  const [style, setStyle] = useState<ArtStyle>("split");
  const [src, setSrc] = useState<Src>("shape");
  const [shape, setShape] = useState("Smiley");
  const [dark, setDark] = useState("#000000");
  const [light, setLight] = useState("#ffffff");
  const [rounded, setRounded] = useState(false);
  const [strength, setStrength] = useState(0.8);
  const [budget, setBudget] = useState(0.7);
  const [boost, setBoost] = useState(2);
  const [thr, setThr] = useState(0.5);
  const [inv, setInv] = useState(false);
  const [img, setImg] = useState<HTMLImageElement>();
  const [pad, setPad] = useState<Uint8Array>(() => { const a = new Uint8Array(PAD * PAD); for (let y = 0; y < PAD; y++) for (let x = 0; x < PAD; x++) a[y * PAD + x] = SHAPES.Smiley((x + 0.5) / PAD, (y + 0.5) / PAD) > 0.5 ? 1 : 0; return a; });
  const [res, setRes] = useState<{ png: string; svg: string; ok: boolean; note: string }>();
  const padRef = useRef<HTMLCanvasElement>(null);
  const text = safeUrl(url) ?? url.trim();

  const lum = useMemo(() => {
    if (!img) return undefined;
    const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, S, S);
    const s0 = Math.min(img.width, img.height); x.drawImage(img, (img.width - s0) / 2, (img.height - s0) / 2, s0, s0, 0, 0, S, S);
    const d = x.getImageData(0, 0, S, S).data, L = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) L[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    return L;
  }, [img]);

  const pic: Pic = useMemo(() => {
    if (src === "shape") return SHAPES[shape];
    if (src === "draw") return (u, v) => pad[Math.min(PAD - 1, Math.floor(v * PAD)) * PAD + Math.min(PAD - 1, Math.floor(u * PAD))];
    if (!lum) return () => 0;
    return (u, v) => { const d = lum[Math.min(255, Math.floor(v * 256)) * 256 + Math.min(255, Math.floor(u * 256))] < thr; return (d !== inv) ? 1 : 0; };
  }, [src, shape, pad, lum, thr, inv]);

  useEffect(() => {
    if (!text) { setRes(undefined); return; }
    const t = setTimeout(() => {
      try {
        let g: ArtGrid, rgba, ok = false, used = style === "split" ? strength : budget;
        for (;;) {
          g = buildArt(text, pic, style, used, boost);
          rgba = renderRGBA(g, pxFor(g, 720), dark, light, rounded);
          ok = decodes(rgba, text);
          if (ok || style === "split" || used <= 0) break;
          used = Math.max(0, +(used - 0.1).toFixed(2)); // auto-reduce flips until it scans
        }
        const c = document.createElement("canvas"); c.width = rgba.width; c.height = rgba.height;
        c.getContext("2d")!.putImageData(new ImageData(rgba.data as Uint8ClampedArray<ArrayBuffer>, rgba.width, rgba.height), 0, 0);
        const note = style === "flip"
          ? `Version ${g.version} · ${g.flips} of ${g.dataModules} data dots flipped (${Math.round(used * 100)}% of correction budget${used < budget ? ", auto-reduced" : ""})`
          : `Version ${g.version} · ${Math.round(strength * 100)}% of outer sub-dots follow the picture`;
        setRes({ png: c.toDataURL("image/png"), svg: renderSVG(g, dark, light, rounded), ok, note });
      } catch (e) { setRes({ png: "", svg: "", ok: false, note: "Link too long for a QR code: " + (e as Error).message }); }
    }, 120);
    return () => clearTimeout(t);
  }, [text, pic, style, strength, budget, boost, dark, light, rounded]);

  useEffect(() => {
    const c = padRef.current; if (!c) return; const x = c.getContext("2d")!; const s = c.width / PAD;
    x.fillStyle = "#09090b"; x.fillRect(0, 0, c.width, c.width);
    for (let i = 0; i < PAD * PAD; i++) { x.fillStyle = pad[i] ? "#EAA221" : "#27272a"; x.fillRect((i % PAD) * s + 1, Math.floor(i / PAD) * s + 1, s - 2, s - 2); }
  }, [pad, src]);
  const paint = useRef<number | null>(null);
  const tap = (e: React.PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * PAD), y = Math.floor((e.clientY - r.top) / r.height * PAD);
    if (x < 0 || y < 0 || x >= PAD || y >= PAD) return;
    const i = y * PAD + x;
    if (start) paint.current = pad[i] ? 0 : 1; if (paint.current === null) return;
    if (pad[i] === paint.current) return;
    const n = pad.slice(); n[i] = paint.current; setPad(n);
  };
  const pickImg = (f?: File) => { if (!f) return; const i = new Image(); i.onload = () => setImg(i); i.src = URL.createObjectURL(f); };
  const lore = Object.entries(LORE_COLORS);

  return (<div className="wrap artqr">
    <Nav on="/art-qr" />
    <div className="card">
      <b>Art QR <span className="muted">(test mode)</span></b>
      <div className="muted">The dots themselves draw your picture. Every result is test-scanned right here before you download.</div>
      <label>Link</label><input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" />
    </div>
    {res && <div className={"badge " + (res.ok ? "good" : "bad")}>{res.ok ? "✅ Scans OK" : "⛔ Won't scan"}</div>}
    {res?.png ? <div className="qr"><img src={res.png} alt="Art QR" /></div> : null}
    {res && <div className="muted" style={{ textAlign: "center" }}>{res.note}</div>}
    {res?.png && <div className="row noprint" style={{ marginTop: 10 }}>
      <button onClick={() => save(res.png, "art-qr.png")}>⬇ PNG</button>
      <button onClick={() => save(URL.createObjectURL(new Blob([res.svg], { type: "image/svg+xml" })), "art-qr.svg")}>⬇ SVG</button>
    </div>}
    {res && !res.ok && <div className="warn">Try less image strength, bigger size, more contrast between colors, or a simpler picture.</div>}

    <div className="card">
      <label>Style</label>
      <div className="seg"><button className={style === "split" ? "on" : ""} onClick={() => setStyle("split")}>Split dots</button><button className={style === "flip" ? "on" : ""} onClick={() => setStyle("flip")}>Flip dots</button></div>
      <div className="muted" style={{ marginTop: 6 }}>{style === "split" ? "Each dot becomes a 3×3 mini-grid. The center always stays true to the code; the outer 8 draw your picture." : "Real dots are flipped toward your picture, using the code's built-in error correction (level H). Corner squares are never touched."}</div>
      {style === "split"
        ? <><label>Image strength: {Math.round(strength * 100)}%</label><input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(+e.target.value)} /></>
        : <><label>Flip budget: {Math.round(budget * 100)}% of error correction</label><input type="range" min={0.1} max={0.95} step={0.05} value={budget} onChange={(e) => setBudget(+e.target.value)} />
          <label>Extra size (more dots = sharper picture): +{boost}</label><input type="range" min={0} max={8} step={1} value={boost} onChange={(e) => setBoost(+e.target.value)} /></>}
    </div>

    <div className="card">
      <label>Picture</label>
      <div className="seg"><button className={src === "shape" ? "on" : ""} onClick={() => setSrc("shape")}>Shapes</button><button className={src === "upload" ? "on" : ""} onClick={() => setSrc("upload")}>Upload</button><button className={src === "draw" ? "on" : ""} onClick={() => setSrc("draw")}>Draw</button></div>
      {src === "shape" && <div className="seg" style={{ marginTop: 8 }}>{Object.keys(SHAPES).map((k) => <button key={k} className={shape === k ? "on" : ""} onClick={() => setShape(k)}>{k}</button>)}</div>}
      {src === "upload" && <>
        <input type="file" accept="image/*" style={{ marginTop: 8 }} onChange={(e) => pickImg(e.target.files?.[0])} />
        <label>Threshold: {Math.round(thr * 100)}%</label><input type="range" min={0.05} max={0.95} step={0.01} value={thr} onChange={(e) => setThr(+e.target.value)} />
        <div className="seg" style={{ marginTop: 8 }}><button className={inv ? "on" : ""} onClick={() => setInv(!inv)}>Invert {inv ? "on" : "off"}</button></div>
        {!img && <div className="warn">Pick a picture. Simple, high-contrast images work best.</div>}
      </>}
      {src === "draw" && <>
        <div className="muted" style={{ margin: "8px 0" }}>Tap or drag to paint squares (gold = dark dots).</div>
        <canvas ref={padRef} width={500} height={500} className="pad" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); tap(e, true); }} onPointerMove={(e) => tap(e, false)} onPointerUp={() => (paint.current = null)} />
        <div className="row" style={{ marginTop: 8 }}><button onClick={() => setPad(new Uint8Array(PAD * PAD))}>Clear</button><button onClick={() => setPad(pad.map((v) => 1 - v))}>Invert</button></div>
      </>}
    </div>

    <div className="card">
      <label>Dot shape</label>
      <div className="seg"><button className={!rounded ? "on" : ""} onClick={() => setRounded(false)}>Square</button><button className={rounded ? "on" : ""} onClick={() => setRounded(true)}>Rounded</button></div>
      <label>Dot color</label>
      <div className="sw">{[["Ink", "#000000"], ...lore].map(([n, c]) => <i key={n} title={n} style={{ background: c }} className={dark === c ? "on" : ""} onClick={() => setDark(c)} />)}<input type="color" value={dark} onChange={(e) => setDark(e.target.value)} style={{ width: 44, padding: 0, height: 30 }} /></div>
      <label>Background</label>
      <div className="sw">{[["White", "#ffffff"], ["Cream", "#fff8e7"], ...lore].map(([n, c]) => <i key={n} title={n} style={{ background: c }} className={light === c ? "on" : ""} onClick={() => setLight(c)} />)}<input type="color" value={light} onChange={(e) => setLight(e.target.value)} style={{ width: 44, padding: 0, height: 30 }} /></div>
      <div className="muted" style={{ marginTop: 8 }}>Keep dots darker than the background for the best scanning.</div>
    </div>
  </div>);
}
