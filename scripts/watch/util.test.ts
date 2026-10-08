import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  collapse,
  findTerms,
  limiter,
  normalizeUrl,
  sameUrl,
  shortHash,
  stableStringify,
  titleSimilarity,
  toIsoDate,
  truncate,
  wordCount,
} from "./util";

describe("stableStringify", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe(
      '{\n  "a": {\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });
});

describe("urls", () => {
  it("normalises case, ports, fragments and trailing slashes", () => {
    expect(normalizeUrl("HTTPS://Learn.Microsoft.com:443/en-US/Entra/Overview/#top")).toBe("https://learn.microsoft.com/en-us/entra/overview");
    expect(normalizeUrl("https://support.google.com/a/answer/7587183?hl=en")).toBe("https://support.google.com/a/answer/7587183?hl=en");
    expect(sameUrl("https://example.com/a/", "https://example.com/a")).toBe(true);
    expect(sameUrl("https://example.com/A", "https://example.com/a")).toBe(false);
  });
});

describe("titles", () => {
  it("strips site suffixes", () => {
    expect(cleanTitle("Plan a Conditional Access deployment - Microsoft Entra ID | Microsoft Learn")).toBe(
      "Plan a Conditional Access deployment - Microsoft Entra ID",
    );
    expect(cleanTitle("Security checklist for medium and large businesses - Google Workspace Admin Help")).toBe(
      "Security checklist for medium and large businesses",
    );
  });

  it("scores word overlap", () => {
    expect(titleSimilarity("Securing identity with Zero Trust", "Secure identity with Zero Trust | Microsoft Learn")).toBeGreaterThan(0.4);
    expect(titleSimilarity("Microsoft Entra documentation", "Plan a Conditional Access deployment")).toBe(0);
    expect(titleSimilarity("", "")).toBe(1);
  });
});

describe("terms", () => {
  it("finds lifecycle and licence vocabulary on word boundaries", () => {
    const text = "This feature is deprecated and will be retired. Requires Microsoft Entra ID P2 or Microsoft 365 E5.";
    expect(findTerms(text)).toEqual(["entra id p2", "is deprecated", "microsoft 365 e5", "will be retired"]);
    expect(findTerms("Block legacy authentication")).toEqual([]);
  });
});

describe("dates", () => {
  it("parses the formats pages use", () => {
    expect(toIsoDate("2026-09-30T01:02:03Z")).toBe("2026-09-30");
    expect(toIsoDate("09/12/2025")).toBe("2025-09-12");
    expect(toIsoDate("30 September 2026")).toBe("2026-09-30");
    expect(toIsoDate("Sep 30, 2026")).toBe("2026-09-30");
    expect(toIsoDate("yesterday")).toBeUndefined();
    expect(toIsoDate("13/40/2026")).toBeUndefined();
  });
});

describe("text helpers", () => {
  it("counts words and collapses whitespace", () => {
    expect(wordCount("Don't use SMS-based MFA, v1.4.0 instead.")).toBe(6);
    expect(collapse("  a\u00a0\n b\u200b c ")).toBe("a b c");
    expect(truncate("one two three four five", 12)).toBe("one two…");
    expect(shortHash("x")).toHaveLength(16);
  });
});

describe("limiter", () => {
  it("never runs more than n tasks at once", async () => {
    const limit = limiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});
