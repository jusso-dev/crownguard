import { describe, expect, it } from "vitest";
import { contrast, extractPalette, readableOn, textOn } from "./color";

const px = (rgba: number[], n: number) => Array.from({ length: n }, () => rgba).flat();

describe("color", () => {
  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("darkens light brand colours until readable on white", () => {
    const fixed = readableOn("#ffd400");
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(readableOn("#003366")).toBe("#003366");
  });

  it("chooses text colour by contrast", () => {
    expect(textOn("#003366")).toBe("#ffffff");
    expect(textOn("#ffd400")).toBe("#111111");
  });

  it("extracts dominant and contrasting hue, ignoring white, black, grey and transparent", () => {
    const pixels = [
      ...px([255, 255, 255, 255], 500),
      ...px([0, 0, 0, 255], 300),
      ...px([128, 128, 128, 255], 300),
      ...px([200, 30, 30, 0], 400),
      ...px([0, 82, 155, 255], 200),
      ...px([5, 85, 150, 255], 20),
      ...px([240, 160, 0, 255], 80),
    ];
    const p = extractPalette(pixels)!;
    expect(p.primary).toMatch(/^#0[0-9a-f]5[0-9a-f]9[0-9a-f]$/);
    expect(p.accent).toBe("#f0a000");
  });

  it("returns null for monochrome logos", () => {
    expect(extractPalette(px([0, 0, 0, 255], 10))).toBeNull();
  });
});

describe("parseHex", () => {
  it("normalises full, shorthand and hash-less hex codes", async () => {
    const { parseHex } = await import("./color");
    expect(parseHex("#0B5D4B")).toBe("#0b5d4b");
    expect(parseHex("0b5d4b")).toBe("#0b5d4b");
    expect(parseHex(" #0b5 ")).toBe("#00bb55");
  });

  it("rejects anything else", async () => {
    const { parseHex } = await import("./color");
    for (const bad of ["", "#12", "#12345", "#gggggg", "rgb(0,0,0)", "#1234567"]) expect(parseHex(bad)).toBeNull();
  });
});

describe("chooseLogoBackdrop", () => {
  const img = (w: number, h: number, at: (x: number, y: number) => number[]) => {
    const out: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(...at(x, y));
    return out;
  };

  it("never panels a logo that has its own background", async () => {
    const { chooseLogoBackdrop } = await import("./color");
    const redBoxWithWhiteMark = img(10, 6, (x, y) => (x > 3 && x < 6 && y > 1 && y < 4 ? [255, 255, 255, 255] : [185, 40, 20, 255]));
    expect(chooseLogoBackdrop(redBoxWithWhiteMark, 10, 6, "#b82c14")).toBe("none");
  });

  it("panels a transparent logo only when it would disappear on the cover colour", async () => {
    const { chooseLogoBackdrop } = await import("./color");
    const darkMark = img(10, 6, (x, y) => (x > 2 && x < 7 && y > 1 && y < 5 ? [20, 30, 40, 255] : [0, 0, 0, 0]));
    expect(chooseLogoBackdrop(darkMark, 10, 6, "#1f3a5f")).toBe("white");
    expect(chooseLogoBackdrop(darkMark, 10, 6, "#f4f1e8")).toBe("none");
  });
});
