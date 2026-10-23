import QRCode from "qrcode";
import { parseUnits } from "viem";

export const CHAIN_ID = 8453;
export const CAP = "0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca"; // Cap Ledger (editable in UI)
export type TokenId = "USDC" | "GEAR" | "ETH";
export const TOKENS: Record<TokenId, { address?: `0x${string}`; decimals: number; logo: string; color: string }> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, logo: "$", color: "#2775CA" },
  GEAR: { address: "0x5880cD05605A549f1DAb01a53ca61Ee559244bD1", decimals: 6, logo: "⚙", color: "#EAA221" },
  ETH: { decimals: 18, logo: "Ξ", color: "#627EEA" },
};

export const GEAR_COLORS: Record<string, string> = {
  crimson: "#DC143C", tangerine: "#F28500", amber: "#FFBF00", marigold: "#EAA221",
  canary: "#FFFF99", chartreuse: "#CCFF00", emerald: "#50C878", turquoise: "#30D5BC",
  base: "#0000FF", sapphire: "#0F52BA", amethyst: "#9966CC", orchid: "#9D00D4",
};
/** Gear Hub lore extras: Master badge pink (CURSOR-BRIEF) + Forged gold (chatRules LINE_GOLD). */
export const MASTER_COLORS: Record<string, string> = { master: "#FFC5FF", forged: "#FFD700" };
export const LORE_COLORS: Record<string, string> = { ...GEAR_COLORS, ...MASTER_COLORS };

export function rawAmount(amount: string, token: TokenId): bigint {
  return parseUnits(amount || "0", TOKENS[token].decimals);
}

/** EIP-681 URI that wallet-app scanners open as a ready transfer. */
export function eip681(token: TokenId, to: string, amount: string): string {
  const raw = rawAmount(amount, token).toString();
  if (token === "ETH") return `ethereum:${to}@${CHAIN_ID}?value=${raw}`;
  return `ethereum:${TOKENS[token].address}@${CHAIN_ID}/transfer?address=${to}&uint256=${raw}`;
}

export function payLink(origin: string, token: TokenId, to: string, amount: string, note = ""): string {
  const p = new URLSearchParams({ to, amt: amount, t: token });
  if (note) p.set("n", note);
  return `${origin}/pay?${p}`;
}

export function claimLink(origin: string, id: string, secret: string): string {
  return `${origin}/claim?id=${id}&s=${secret}`;
}

// ---- contrast ----
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---- styled QR SVG ----
export type ModuleShape = "square" | "dot" | "rounded" | "gear";
export interface QrStyle {
  shape: ModuleShape;
  colors: string[]; // 1 = solid, 2+ = gradient
  bg: string;
  logo?: "none" | "GEAR" | "CAPH" | "image";
  logoImage?: string; // data URL
  frameText?: string;
  size?: number;
}

function gearPath(cx: number, cy: number, r: number, teeth = 8) {
  const pts: string[] = [];
  const ri = r * 0.72;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : ri;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(3)},${(cy + rr * Math.sin(a)).toFixed(3)}`);
  }
  return `M${pts.join("L")}Z`;
}

export function qrSvg(text: string, s: QrStyle): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const q = 4; // quiet zone
  const total = n + q * 2;
  const frameH = s.frameText ? 9 : 0;
  const isFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  // logo hole: ~ 22% of width, safe with level H (30%)
  const hole = s.logo && s.logo !== "none" ? Math.floor(n * 0.22) | 1 : 0;
  const h0 = Math.floor((n - hole) / 2);
  const inHole = (x: number, y: number) => hole > 0 && x >= h0 && x < h0 + hole && y >= h0 && y < h0 + hole;
  const fill = s.colors.length > 1 ? "url(#g)" : s.colors[0];
  let mods = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!data[y * n + x] || isFinder(x, y) || inHole(x, y)) continue;
    const X = x + q, Y = y + q;
    if (s.shape === "square") mods += `M${X},${Y}h1v1h-1Z`;
    else if (s.shape === "dot") mods += `M${X + 0.5},${Y + 0.05}a0.45,0.45 0 1,0 0.001,0Z`;
    else if (s.shape === "rounded") mods += `M${X + 0.3},${Y}h0.4a0.3,0.3 0 0 1 0.3,0.3v0.4a0.3,0.3 0 0 1 -0.3,0.3h-0.4a0.3,0.3 0 0 1 -0.3,-0.3v-0.4a0.3,0.3 0 0 1 0.3,-0.3Z`;
    else mods += gearPath(X + 0.5, Y + 0.5, 0.56);
  }
  const rr = s.shape === "square" ? 0 : 1.6;
  const finder = (fx: number, fy: number) => {
    const X = fx + q, Y = fy + q;
    return `<path fill-rule="evenodd" fill="${fill}" d="M${X + rr},${Y}h${7 - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${7 - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${7 - 2 * rr}a${rr},${rr} 0 0 1 -${rr},-${rr}v-${7 - 2 * rr}a${rr},${rr} 0 0 1 ${rr},-${rr}ZM${X + 1},${Y + 1}v5h5v-5Z"/>` +
      `<rect x="${X + 2}" y="${Y + 2}" width="3" height="3" rx="${rr ? 0.8 : 0}" fill="${fill}"/>`;
  };
  const grad = s.colors.length > 1
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${s.colors.map((c, i) => `<stop offset="${i / (s.colors.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient></defs>`
    : "";
  let logo = "";
  if (hole) {
    const c = q + h0 + hole / 2;
    const r = hole / 2 - 0.3;
    logo += `<circle cx="${c}" cy="${c}" r="${r + 0.2}" fill="${s.bg}"/>`;
    if (s.logo === "image" && s.logoImage) {
      logo += `<clipPath id="lc"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath><image href="${s.logoImage}" x="${c - r}" y="${c - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#lc)" preserveAspectRatio="xMidYMid slice"/>`;
    } else {
      logo += `<path d="${gearPath(c, c, r, 10)}" fill="${fill}"/><circle cx="${c}" cy="${c}" r="${r * 0.55}" fill="${s.bg}"/>` +
        `<text x="${c}" y="${c + r * 0.14}" font-family="monospace" font-weight="700" font-size="${r * 0.4}" text-anchor="middle" fill="${s.colors[0]}">${s.logo}</text>`;
    }
  }
  const frame = s.frameText
    ? `<rect x="1" y="${total + 1}" width="${total - 2}" height="${frameH - 2}" rx="2" fill="${s.colors[0]}"/><text x="${total / 2}" y="${total + frameH / 2 + 1.6}" font-family="monospace,sans-serif" font-weight="700" font-size="4" text-anchor="middle" fill="${s.bg}">${esc(s.frameText)}</text>`
    : "";
  const size = s.size ?? 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total + frameH}" width="${size}" height="${(size * (total + frameH)) / total}" shape-rendering="geometricPrecision">${grad}<rect width="${total}" height="${total + frameH}" rx="${frameH ? 3 : 0}" fill="${s.bg}"/><path fill="${fill}" d="${mods}"/>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}${logo}${frame}</svg>`;
}

function esc(t: string) {
  return t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export function randomSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- multi-link share pages (no server storage) ----
export interface LinkItem { url: string; label?: string }
/** Only http(s) links are allowed (blocks javascript:, data:, etc.). Bare domains get https://. */
export function safeUrl(raw: string): string | null {
  let s = (raw || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname || !u.hostname.includes(".")) return null;
    return u.href;
  } catch { return null; }
}
const b64u = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export function encodeLinks(items: LinkItem[], title = ""): string {
  const l = items.slice(0, 3).map((i) => (i.label?.trim() ? [i.url, i.label.trim().slice(0, 40)] : [i.url]));
  return b64u(JSON.stringify(title.trim() ? { t: title.trim().slice(0, 40), l } : { l }));
}
export function decodeLinks(data: string): { title: string; links: LinkItem[] } {
  try {
    const o = JSON.parse(unb64u(data));
    const links: LinkItem[] = [];
    for (const e of Array.isArray(o.l) ? o.l.slice(0, 3) : []) {
      const url = safeUrl(String(e?.[0] ?? ""));
      if (url) links.push({ url, label: e[1] ? String(e[1]).slice(0, 40) : undefined });
    }
    return { title: typeof o.t === "string" ? o.t.slice(0, 40) : "", links };
  } catch { return { title: "", links: [] }; }
}
export function linksPage(origin: string, items: LinkItem[], title = ""): string {
  return `${origin}/l#${encodeLinks(items, title)}`;
}

// ---- image QR art (halftone: image woven through the modules) ----
export interface ArtOpts { colors: boolean; contrast: number; dot: number; dark: string; light: string; px?: number }
const hexRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/**
 * Each module becomes a 3x3 cell. The center (size = dot) always carries the true module color,
 * function patterns (finders, timing, alignment, format) stay solid, and the outer ring shows the
 * image, pushed darker on dark modules and lighter on light ones (contrast 0..1). Level H.
 * img: RGBA pixels already resized to (n*3) x (n*3).
 */
export function artQr(text: string, img: Uint8ClampedArray, o: ArtOpts) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const m = qr.modules, n = m.size, sub = 3, q = 4;
  const px = o.px ?? 4; // pixels per sub-cell
  const W = (n + q * 2) * sub * px;
  const out = new Uint8ClampedArray(W * W * 4);
  const D = hexRgb(o.dark), L = hexRgb(o.light);
  const k = Math.max(0, Math.min(1, o.contrast));
  const lo = 0.42 * (1 - k) * 255 + 0, hi = 255 - 0.42 * (1 - k) * 255; // max luminance on dark, min on light
  for (let i = 0; i < W * W; i++) out.set([...L, 255], i * 4);
  const c0 = (1 - o.dot) / 2 * sub, c1 = sub - c0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dark = m.get(y, x) === 1 || (m.get(y, x) as unknown) === true;
    const solid = !!m.isReserved(y, x);
    for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
      const center = sx + 0.5 > c0 && sx + 0.5 < c1 && sy + 0.5 > c0 && sy + 0.5 < c1;
      let rgb: number[];
      if (solid || center) rgb = dark ? D : L;
      else {
        const ii = ((y * sub + sy) * n * sub + (x * sub + sx)) * 4;
        let r = img[ii], g = img[ii + 1], b = img[ii + 2];
        const a = img[ii + 3] / 255; r = r * a + 255 * (1 - a); g = g * a + 255 * (1 - a); b = b * a + 255 * (1 - a);
        if (!o.colors) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (dark && l > lo) { const f = lo / Math.max(l, 1); r *= f; g *= f; b *= f; }
        if (!dark && l < hi) { const f = (255 - hi) / Math.max(255 - l, 1); r = 255 - (255 - r) * f; g = 255 - (255 - g) * f; b = 255 - (255 - b) * f; }
        rgb = [r, g, b];
      }
      const X0 = ((x + q) * sub + sx) * px, Y0 = ((y + q) * sub + sy) * px;
      for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) out.set([rgb[0], rgb[1], rgb[2], 255], ((Y0 + yy) * W + X0 + xx) * 4);
    }
  }
  return { width: W, height: W, data: out, grid: n * sub };
}
/** Side length (in sub-cells) the source image must be resized to for artQr. */
export function artGrid(text: string): number { return QRCode.create(text, { errorCorrectionLevel: "H" }).modules.size * 3; }
