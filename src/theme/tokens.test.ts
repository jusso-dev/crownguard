import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, oklchToHex } from "./color";

/**
 * The palette in `src/index.css` is the accessibility contract for colour: every text pair meets WCAG 2.2 SC 1.4.3
 * (4.5:1) and every control boundary meets SC 1.4.11 (3:1). Reading the real tokens keeps this test honest when a
 * colour is tuned later.
 */
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const tokens: Record<string, string> = {};
for (const m of css.matchAll(/--color-([\w-]+):\s*(oklch\([^)]*\))/g)) tokens[m[1]] = oklchToHex(m[2]);

/** [foreground, background, minimum ratio, where it's used]. */
const textPairs: [string, string, string][] = [
  ["ink", "paper", "headings on the page"],
  ["ink-2", "paper", "body text on the page"],
  ["ink-2", "surface", "body text in cards"],
  ["ink-2", "sunken", "chips on sunken"],
  ["muted", "paper", "secondary text on the page"],
  ["muted", "surface", "secondary text in cards"],
  ["muted", "sunken", "secondary text on sunken"],
  ["accent", "paper", "links on the page"],
  ["accent", "surface", "links in cards"],
  ["accent", "accent-soft", "the current step's number"],
  ["accent-ink", "accent", "primary button"],
  ["accent-ink", "accent-hover", "primary button, hover"],
  ["ok", "ok-soft", "success notices"],
  ["ok", "paper", "success text on the page"],
  ["ok", "surface", "success text in cards"],
  ["warn", "warn-soft", "warning notices"],
  ["warn", "paper", "warning text on the page"],
  ["warn", "surface", "warning text in cards"],
  ["danger", "danger-soft", "error notices"],
  ["danger", "paper", "error text on the page"],
  ["danger", "surface", "error text in cards"],
  ["paper", "ink", "selected chips and radio options"],
  ["on-graphite", "graphite", "the review headline numbers"],
  ["on-graphite-2", "graphite", "their labels"],
  ["band-low-ink", "band-low", "Low risk badge"],
  ["band-medium-ink", "band-medium", "Medium risk badge"],
  ["band-high-ink", "band-high", "High risk badge"],
  ["band-extreme-ink", "band-extreme", "Extreme risk badge"],
  ["sev-critical", "sev-critical-soft", "critical severity badge"],
  ["sev-high", "sev-high-soft", "high severity badge"],
  ["sev-medium", "sev-medium-soft", "medium severity badge"],
];

/** [foreground, background, where it's used] — control boundaries and the focus ring, at 3:1 (SC 1.4.11). */
const boundaryPairs: [string, string, string][] = [
  ["field", "paper", "input borders on the page"],
  ["field", "surface", "input borders in cards"],
  ["field", "sunken", "input borders on sunken panels"],
  ["focus", "paper", "the focus ring on the page"],
  ["focus", "surface", "the focus ring in cards"],
  ["accent", "paper", "the primary button against the page"],
];

describe("design tokens", () => {
  it("are all parsed", () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(30);
  });

  for (const [fg, bg, where] of textPairs)
    it(`${fg} on ${bg} is readable (${where})`, () => {
      expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
    });

  for (const [fg, bg, where] of boundaryPairs)
    it(`${fg} on ${bg} is a visible boundary (${where})`, () => {
      expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(3);
    });
});
