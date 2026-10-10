export type RGB = [number, number, number];

export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

export function fromHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}

/**
 * Parse "oklch(L C H)" — the form the design tokens in `src/index.css` use — to sRGB 0–255. L can be a percentage
 * ("98.5%") or a fraction (0.985). Out-of-gamut colours are clipped per channel, as the browser paints them.
 */
export function parseOklch(input: string): RGB {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(deg)?\s*\)$/i.exec(input.trim());
  if (!m) throw new Error(`not an oklch() colour: ${input}`);
  const rawL = parseFloat(m[1]);
  const L = m[2] === "%" || rawL > 1 ? rawL / 100 : rawL;
  const C = parseFloat(m[3]);
  const H = parseFloat(m[4]);
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m3 + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m3 - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m3 + 1.707614701 * s),
  ];
}

/** An oklch() design token as hex, for `contrast` and friends. */
export const oklchToHex = (input: string) => toHex(parseOklch(input));

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

/**
 * Decide whether a logo needs a white panel behind it on the cover.
 * Logos with their own background (opaque edges) never get one. Transparent logos get one only when their
 * average colour would be hard to see on the cover colour.
 */
export function chooseLogoBackdrop(pixels: Uint8ClampedArray | number[], width: number, height: number, cover: string): "none" | "white" {
  const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3];
  let edge = 0;
  let solidEdge = 0;
  for (let x = 0; x < width; x++)
    for (const y of [0, height - 1]) {
      edge++;
      if (alpha(x, y) >= 250) solidEdge++;
    }
  for (let y = 1; y < height - 1; y++)
    for (const x of [0, width - 1]) {
      edge++;
      if (alpha(x, y) >= 250) solidEdge++;
    }
  if (edge > 0 && solidEdge / edge >= 0.95) return "none";

  const sum: RGB = [0, 0, 0];
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4)
    if (pixels[i + 3] >= 128) {
      sum[0] += pixels[i];
      sum[1] += pixels[i + 1];
      sum[2] += pixels[i + 2];
      n++;
    }
  if (n === 0) return "none";
  const avg = toHex(sum.map((c) => Math.round(c / n)) as RGB);
  return contrast(avg, cover) < 3 ? "white" : "none";
}
