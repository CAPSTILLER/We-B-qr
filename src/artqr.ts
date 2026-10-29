import QRCode from "qrcode";
// @ts-ignore internal helpers (same package already used for encoding)
import ECCode from "qrcode/lib/core/error-correction-code.js";
// @ts-ignore
import QRUtils from "qrcode/lib/core/utils.js";
// @ts-ignore
import ECLevel from "qrcode/lib/core/error-correction-level.js";

/** For each module: index of the codeword it belongs to and which RS block owns it (-1 = remainder bits). */
export function codewordMap(m: { size: number; isReserved(r: number, c: number): unknown }, version: number) {
  const n = m.size, cw = new Int32Array(n * n).fill(-1);
  let bit = 0;
  for (let col = n - 1, row = n - 1, inc = -1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) { for (let c = 0; c < 2; c++) if (!m.isReserved(row, col - c)) { cw[row * n + col - c] = bit >> 3; bit++; } row += inc; if (row < 0 || row >= n) { row -= inc; inc = -inc; break; } }
  }
  const total: number = QRUtils.getSymbolTotalCodewords(version);
  const ecTotal: number = ECCode.getTotalCodewordsCount(version, ECLevel.H);
  const blocks: number = ECCode.getBlocksCount(version, ECLevel.H);
  const dataTotal = total - ecTotal, g2 = total % blocks, g1 = blocks - g2;
  const d1 = Math.floor(dataTotal / blocks), ecPer = ecTotal / blocks;
  const blockOf = new Int32Array(total);
  let k = 0;
  for (let i = 0; i < d1 + 1; i++) for (let b = 0; b < blocks; b++) { const len = b < g1 ? d1 : d1 + 1; if (i < len) blockOf[k++] = b; }
  for (; k < total; k++) blockOf[k] = (k - dataTotal) % blocks;
  return { cw, blockOf, blocks, ecPer, total };
}

/** Picture sampler: u,v in [0,1) -> darkness 0..1 (1 = dark) */
export type Pic = (u: number, v: number) => number;
export type ArtStyle = "split" | "flip";
export interface ArtGrid { size: number; sub: number; cells: Uint8Array; fixed: Uint8Array; quiet: number; flips: number; dataModules: number; version: number }

const inCircle = (u: number, v: number, cx: number, cy: number, r: number) => Math.hypot(u - cx, v - cy) < r;
export const SHAPES: Record<string, Pic> = {
  Smiley: (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    if (d > 0.46) return 0;
    if (d > 0.4) return 1; // rim
    if (inCircle(u, v, 0.36, 0.38, 0.065) || inCircle(u, v, 0.64, 0.38, 0.065)) return 1; // eyes
    const m = Math.hypot(u - 0.5, v - 0.5);
    if (v > 0.52 && m > 0.2 && m < 0.27) return 1; // smile
    return 0;
  },
  Heart: (u, v) => { const x = (u - 0.5) * 2.6, y = (0.42 - v) * 2.6; const a = x * x + y * y - 1; return a * a * a - x * x * y * y * y < 0 ? 1 : 0; },
  Gear: (u, v) => {
    const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), t = Math.atan2(y, x);
    const tooth = Math.cos(t * 10) > 0.2 ? 0.44 : 0.36;
    return r < tooth && r > 0.14 ? 1 : 0;
  },
  Star: (u, v) => { const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), t = Math.atan2(y, x) + Math.PI / 2; const k = (t / (2 * Math.PI / 5)) % 1; const e = 0.2 + 0.24 * Math.abs(k - 0.5) * 2; return r < e ? 1 : 0; },
};

function hash(x: number, y: number) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

/** Build the art grid. strength: split = share of outer subpixels following picture; flip = share of the per-block error-correction capacity spent on flips. */
export function buildArt(text: string, pic: Pic, style: ArtStyle, strength: number, extraVersion = 0): ArtGrid {
  const base = QRCode.create(text, { errorCorrectionLevel: "H" });
  const version = Math.min(40, base.version + (style === "flip" ? extraVersion : 0));
  const qr = version === base.version ? base : QRCode.create(text, { errorCorrectionLevel: "H", version });
  const m = qr.modules, n = m.size, quiet = 4;
  const dk = (r: number, c: number) => m.get(r, c) === 1 || (m.get(r, c) as unknown) === true;
  const sub = style === "split" ? 3 : 1;
  const size = (n + quiet * 2) * sub;
  const cells = new Uint8Array(size * size), fixed = new Uint8Array(size * size);
  let flips = 0, dataModules = 0;
  const flip = new Uint8Array(n * n);
  if (style === "flip") {
    const map = codewordMap(m, version);
    const gain = new Float64Array(map.total);
    const want: number[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (m.isReserved(r, c)) continue;
      dataModules++;
      const p = pic((c + 0.5) / n, (r + 0.5) / n);
      if ((p > 0.5) === dk(r, c)) continue;
      const k = map.cw[r * n + c];
      if (k < 0 || k >= map.total) { flip[r * n + c] = 1; flips++; continue; } // remainder bits are free
      const nb = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([a, b]) => (pic((c + 0.5 + b) / n, (r + 0.5 + a) / n) > 0.5) !== (p > 0.5));
      gain[k] += Math.abs(p - 0.5) + (p > 0.5 ? 0.5 : 0) + (nb ? 0.3 : 0);
      want.push(r * n + c);
    }
    // RS at level H corrects floor(ecPer/2) wrong codewords per block; spend `strength` of that, best codewords first.
    const cap = Math.floor(Math.floor(map.ecPer / 2) * strength);
    const byBlock: number[][] = Array.from({ length: map.blocks }, () => []);
    for (let k = 0; k < map.total; k++) if (gain[k] > 0) byBlock[map.blockOf[k]].push(k);
    const chosen = new Uint8Array(map.total);
    for (const list of byBlock) { list.sort((a, b) => gain[b] - gain[a]); for (const k of list.slice(0, cap)) chosen[k] = 1; }
    for (const i of want) if (chosen[map.cw[i]]) { flip[i] = 1; flips++; }
  } else for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!m.isReserved(r, c)) dataModules++;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const res = !!m.isReserved(r, c);
    const d = dk(r, c) !== !!flip[r * n + c];
    for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
      const Y = (r + quiet) * sub + sy, X = (c + quiet) * sub + sx, i = Y * size + X;
      let v = d;
      if (style === "split" && !res && !(sx === 1 && sy === 1) && hash(X, Y) < strength) v = pic((c * 3 + sx + 0.5) / (n * 3), (r * 3 + sy + 0.5) / (n * 3)) > 0.5;
      cells[i] = v ? 1 : 0; fixed[i] = res ? 1 : 0;
    }
  }
  return { size, sub, cells, fixed, quiet, flips, dataModules, version };
}

/** Rasterize to RGBA. */
export function renderRGBA(g: ArtGrid, px: number, dark: string, light: string, rounded: boolean) {
  const W = g.size * px, out = new Uint8ClampedArray(new ArrayBuffer(W * W * 4));
  const D = hex(dark), L = hex(light);
  for (let i = 0; i < W * W; i++) out.set(L, i * 4);
  const rad = px / 2;
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    const i = y * g.size + x; if (!g.cells[i]) continue;
    const round = rounded && !g.fixed[i];
    for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) {
      if (round && Math.hypot(xx + 0.5 - rad, yy + 0.5 - rad) > rad * 0.98) continue;
      out.set(D, ((y * px + yy) * W + x * px + xx) * 4);
    }
  }
  return { width: W, height: W, data: out };
}

export function renderSVG(g: ArtGrid, dark: string, light: string, rounded: boolean) {
  let sq = "", dots = "";
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
    const i = y * g.size + x; if (!g.cells[i]) continue;
    if (rounded && !g.fixed[i]) dots += `M${x + 0.5} ${y}a.5 .5 0 1 0 .001 0z`; else sq += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.size} ${g.size}" width="${g.size * 8}" height="${g.size * 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${sq}" fill="${dark}"/><path d="${dots}" fill="${dark}" shape-rendering="geometricPrecision"/></svg>`;
}

function hex(h: string): number[] { const s = h.replace("#", ""); const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).concat(255); }

/** Pixels per cell so the image is ~target px wide. */
export function pxFor(g: ArtGrid, target = 900) { return Math.max(2, Math.round(target / g.size)); }
