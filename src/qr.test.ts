import { describe, it, expect } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { readBarcodes } from "zxing-wasm/reader";
import { qrSvg, eip681, payLink, claimLink, GEAR_COLORS, ModuleShape, rawAmount } from "./lib";

function render(svg: string) { return new Resvg(svg, { fitTo: { mode: "width", value: 600 }, background: "white" }).render(); }
function jsqr(svg: string) { const png = render(svg); return jsQR(new Uint8ClampedArray(png.pixels), png.width, png.height)?.data; }
// ZXing = same decoder family as Android camera / Google Lens scanners
async function zxing(svg: string) { const r = await readBarcodes(new Blob([render(svg).asPng()]), { formats: ["QRCode"] }); return r[0]?.text; }
const to = "0xD8382719b8fF90eE3Dd521B9d7c5dc23E8e4EAca";
const payloads = [
  eip681("USDC", to, "5"), eip681("GEAR", to, "25"), eip681("ETH", to, "0.01"),
  payLink("https://we-b-qr.vercel.app", "USDC", to, "5", "coffee"),
  claimLink("https://we-b-qr.vercel.app", "7", "a".repeat(32)),
];
describe("encoding", () => {
  it("eip681 usdc", () => expect(payloads[0]).toBe(`ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=${to}&uint256=5000000`));
  it("raw", () => expect(rawAmount("0.01", "ETH")).toBe(10n ** 16n));
});
describe("styled QRs decode", () => {
  const shapes: ModuleShape[] = ["square", "dot", "rounded", "gear"];
  for (const shape of shapes) for (const logo of ["none", "GEAR"] as const) for (const p of payloads)
    it(`${shape}/${logo}/${p.slice(0, 30)}`, async () => {
      const svg = qrSvg(p, { shape, logo, colors: [GEAR_COLORS.crimson, GEAR_COLORS.base], bg: "#ffffff", frameText: "SCAN TO PAY 5 USDC" });
      expect(await zxing(svg)).toBe(p);
      if (shape === "square") expect(jsqr(svg)).toBe(p);
    });
});
