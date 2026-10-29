import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import { buildArt, renderRGBA, pxFor, SHAPES } from "./artqr";
const url = "https://payup.gearup.wtf";
describe("art qr", () => {
  for (const shape of Object.keys(SHAPES)) for (const rounded of [false, true]) {
    it(`split ${shape} ${rounded}`, () => {
      const g = buildArt(url, SHAPES[shape], "split", 1);
      const r = renderRGBA(g, pxFor(g, 600), "#000000", "#ffffff", rounded);
      expect(jsQR(r.data, r.width, r.height)?.data).toBe(url);
    });
    it(`flip ${shape} ${rounded} autoreduce`, () => {
      let s = 0.9, ok = false;
      while (s >= 0) { const g = buildArt(url, SHAPES[shape], "flip", s, 2); const r = renderRGBA(g, pxFor(g, 600), "#000000", "#ffffff", rounded); if (jsQR(r.data, r.width, r.height)?.data === url) { ok = true; break; } s -= 0.1; }
      console.log(shape, rounded, "flip ok at", s.toFixed(2), "flips", buildArt(url, SHAPES[shape], "flip", s, 2).flips, "/", buildArt(url, SHAPES[shape], "flip", s, 2).dataModules);
      expect(ok).toBe(true);
    });
  }
});
