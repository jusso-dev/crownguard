export type RGB = [number, number, number];

export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

export function fromHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(fromHex(a)), luminance(fromHex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Darken a colour until it reaches the target contrast against `background`. */
export function readableOn(color: string, background = "#ffffff", target = 4.5): string {
  let rgb = fromHex(color);
  for (let i = 0; i < 40 && contrast(toHex(rgb), background) < target; i++) rgb = rgb.map((c) => Math.round(c * 0.92)) as RGB;
  return toHex(rgb);
}

/** Black or white, whichever reads better on `background`. */
export const textOn = (background: string) => (contrast("#ffffff", background) >= contrast("#111111", background) ? "#ffffff" : "#111111");

/** Mix towards white; amount 0–1. */
export function tint(color: string, amount: number): string {
  return toHex(fromHex(color).map((c) => Math.round(c + (255 - c) * amount)) as RGB);
}

function saturation([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function hue([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/**
 * Pick brand colours from RGBA pixels (e.g. canvas ImageData.data).
 * Buckets pixels to 4 bits per channel, ignores transparent, near-white, near-black and grey pixels,
 * returns the most common colour and the most common one with a clearly different hue.
 */
export function extractPalette(pixels: Uint8ClampedArray | number[]): { primary: string; accent: string } | null {
  const counts = new Map<number, { n: number; sum: RGB }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const rgb: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (pixels[i + 3] < 128) continue;
    const max = Math.max(...rgb);
    if (max < 30 || Math.min(...rgb) > 225 || saturation(rgb) < 0.25) continue;
    const key = ((rgb[0] >> 4) << 8) | ((rgb[1] >> 4) << 4) | (rgb[2] >> 4);
    const e = counts.get(key) ?? { n: 0, sum: [0, 0, 0] };
    e.n++;
    e.sum = e.sum.map((s, k) => s + rgb[k]) as RGB;
    counts.set(key, e);
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n).map((e) => e.sum.map((s) => Math.round(s / e.n)) as RGB);
  if (!ranked.length) return null;
  const primary = ranked[0];
  const hueGap = (c: RGB) => {
    const d = Math.abs(hue(c) - hue(primary));
    return Math.min(d, 360 - d);
  };
  const accent = ranked.find((c) => hueGap(c) > 30) ?? ranked.find((c) => c !== primary) ?? primary;
  return { primary: toHex(primary), accent: toHex(accent) };
}

/** Accepts "#0b5d4b", "0B5D4B" or shorthand "#0b5"; returns lowercase "#rrggbb", or null if it isn't a hex colour. */
export function parseHex(input: string): string | null {
  const h = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) return `#${[...h].map((c) => c + c).join("")}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(h)) return `#${h}`.toLowerCase();
  return null;
}
