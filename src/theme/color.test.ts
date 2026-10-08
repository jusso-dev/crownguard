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
