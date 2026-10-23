import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { readBarcodes } from "zxing-wasm/reader";
import { writeFileSync, mkdirSync } from "node:fs";
import { artQr, artGrid, safeUrl, encodeLinks, decodeLinks, linksPage } from "./lib";

function sample(kind: string, G: number) {
  const a = new Uint8ClampedArray(G * G * 4);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const i = (y * G + x) * 4; const u = x / G, v = y / G;
    let c = [0, 0, 0];
    if (kind === "gradient") c = [255 * u, 80, 255 * v];
    if (kind === "black") c = [10, 10, 10];
    if (kind === "white") c = [250, 250, 250];
    if (kind === "noise") c = [Math.random() * 255, Math.random() * 255, Math.random() * 255];
    if (kind === "pumpkin") { const d = Math.hypot(u - 0.5, (v - 0.55) * 1.2); c = d < 0.38 ? [242, 133, 0] : [20, 10, 40]; if (d < 0.38 && v < 0.5 && Math.abs(u - 0.5) > 0.1 && Math.abs(u - 0.5) < 0.2 && v > 0.4) c = [0, 0, 0]; }
    if (kind === "stripes") c = (Math.floor(x / 5) % 2) ? [255, 255, 255] : [0, 0, 0];
    a.set([...c, 255], i);
  }
  return a;
}
const urls = ["https://gearup.wtf", "https://payup.gearup.wtf/l#" + "x".repeat(120)];
describe("image QR art decodes", () => {
  mkdirSync("/workspace/qr-art-tests", { recursive: true });
  for (const kind of ["gradient", "black", "white", "noise", "pumpkin", "stripes"]) for (const colors of [true, false]) for (const url of urls)
    it(`${kind}/${colors ? "color" : "bw"}/${url.length}`, async () => {
      const G = artGrid(url);
      const r = artQr(url, sample(kind, G), { colors, contrast: 0.6, dot: 1 / 3, dark: "#000000", light: "#ffffff", px: 3 });
      expect(jsQR(r.data, r.width, r.height)?.data).toBe(url);
      const png = new PNG({ width: r.width, height: r.height }); png.data = Buffer.from(r.data);
      const buf = PNG.sync.write(png);
      if (url.length < 30) writeFileSync(`/workspace/qr-art-tests/${kind}-${colors ? "color" : "bw"}.png`, buf);
      const z = await readBarcodes(new Blob([buf]), { formats: ["QRCode"] });
      expect(z[0]?.text).toBe(url);
    });
});
describe("links", () => {
  it("safeUrl", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("gearup.wtf")).toBe("https://gearup.wtf/");
    expect(safeUrl("http://a.com/x?y=1")).toBe("http://a.com/x?y=1");
  });
  it("roundtrip + filters bad", () => {
    const d = decodeLinks(encodeLinks([{ url: "https://a.com/", label: "Shop 🎃" }, { url: "https://b.com/" }], "My links"));
    expect(d).toEqual({ title: "My links", links: [{ url: "https://a.com/", label: "Shop 🎃" }, { url: "https://b.com/", label: undefined }] });
    const evil = Buffer.from(JSON.stringify({ l: [["javascript:alert(1)"], ["https://ok.com"]] })).toString("base64url");
    expect(decodeLinks(evil).links.map((l) => l.url)).toEqual(["https://ok.com/"]);
    expect(linksPage("https://payup.gearup.wtf", [{ url: "https://a.com/" }])).toMatch(/^https:\/\/payup\.gearup\.wtf\/l#/);
  });
});
