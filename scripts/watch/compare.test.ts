import { describe, expect, it } from "vitest";
import {
  citedVersion,
  classifyChange,
  compareSections,
  compareVersions,
  diffTexts,
  equivalentUrls,
  excerpt,
  newLifecycleWording,
  redirectKind,
  versionsOnPage,
} from "./compare";
import type { SourceState } from "./types";

const para = (n: number, word = "word") => Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ");

describe("diffTexts", () => {
  it("counts words changed inside an edited paragraph, not the whole paragraph", () => {
    const before = `${para(100)}\nSecond paragraph stays the same.\n`;
    const after = `${para(100).replace("word50", "changed50")}\nSecond paragraph stays the same.\n`;
    const d = diffTexts(before, after);
    expect(d.wordsAdded).toBe(1);
    expect(d.wordsRemoved).toBe(1);
    expect(d.changedRatio).toBeLessThan(0.02);
  });

  it("scores a rewrite near 100%", () => {
    const d = diffTexts(para(50, "old"), para(50, "new"));
    expect(d.changedRatio).toBeGreaterThan(0.9);
  });

  it("builds hunks with one line of context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const after = ["a", "b", "C", "d", "e", "f", "G"].join("\n");
    const lines = diffTexts(before, after).lines;
    expect(lines.map((l) => (l ? `${l.op}${l.text}` : "|"))).toEqual([" b", "-c", "+C", " d", "|", " f", "-g", "+G"]);
    expect(excerpt(diffTexts(before, after), 3)).toContain("more changed line");
  });
});

const state = (over: Partial<SourceState> = {}): SourceState => ({
  url: "https://learn.microsoft.com/en-us/x",
  status: "ok",
  title: "Plan a Conditional Access deployment",
  contentHash: "aaaa",
  words: 1000,
  sections: [
    { h: "Prerequisites", hash: "p1", words: 120 },
    { h: "Steps", hash: "s1", words: 800 },
  ],
  terms: [],
  ...over,
});

describe("classifyChange", () => {
  it("treats a small edit as minor", () => {
    const c = classifyChange(state(), state({ contentHash: "bbbb" }), { wordsAdded: 3, wordsRemoved: 2, changedRatio: 0.0025, lines: [] });
    expect(c.severity).toBe("minor");
    expect(c.reasons[0]).toMatch(/small edit/);
  });

  it("flags new lifecycle language and licence changes as major", () => {
    const c = classifyChange(state({ terms: ["entra id p1"] }), state({ terms: ["entra id p2", "will be retired"] }), {
      wordsAdded: 10,
      wordsRemoved: 2,
      changedRatio: 0.006,
      lines: [],
    });
    expect(c.severity).toBe("major");
    expect(c.detail.termsAdded).toEqual(["entra id p2", "will be retired"]);
    expect(c.detail.termsRemoved).toEqual(["entra id p1"]);
    expect(c.reasons[0]).toBe('now says "will be retired"');
  });

  it("flags added or removed sections and big rewrites", () => {
    const after = state({ sections: [{ h: "Steps", hash: "s2", words: 790 }, { h: "Rollout plan", hash: "r1", words: 300 }] });
    const c = classifyChange(state(), after);
    expect(c.severity).toBe("major");
    expect(c.detail.sectionsAdded).toEqual(["Rollout plan"]);
    expect(c.detail.sectionsRemoved).toEqual(["Prerequisites"]);
    expect(c.detail.sectionsChanged).toEqual(["Steps"]);
    expect(c.detail.noPreviousText).toBe(true);
  });

  it("notices a retitle", () => {
    const c = classifyChange(state(), state({ title: "Microsoft Entra documentation | Microsoft Learn" }), { wordsAdded: 0, wordsRemoved: 0, changedRatio: 0, lines: [] });
    expect(c.severity).toBe("major");
    expect(c.detail.newTitle).toBe("Microsoft Entra documentation");
  });

  it("treats a reworded heading over an unchanged body as a rename, not a section removed and added", () => {
    const before = [{ h: "Before you begin", hash: "x", words: 78 }, { h: "Steps", hash: "y", words: 200 }];
    const after = [{ h: "Prerequisites", hash: "x", words: 78 }, { h: "Steps", hash: "y", words: 200 }];
    const s = compareSections(before, after);
    expect(s).toMatchObject({ added: [], removed: [], renamed: [{ before: before[0], after: after[0] }] });
    const c = classifyChange(state({ sections: before }), state({ sections: after, contentHash: "b" }));
    expect(c.severity).toBe("minor");
    expect(c.detail.sectionsChanged).toEqual(["Before you begin → Prerequisites"]);
  });

  it("matches repeated headings by occurrence", () => {
    const s = compareSections(
      [{ h: "Example", hash: "1", words: 50 }, { h: "Example", hash: "2", words: 50 }],
      [{ h: "Example", hash: "1", words: 50 }, { h: "Example", hash: "3", words: 50 }],
    );
    expect(s.changed).toHaveLength(1);
    expect(s.added).toHaveLength(0);
  });
});

describe("versions", () => {
  it("reads the cited version and finds newer ones for the same product", () => {
    expect(citedVersion("CIS Microsoft 365 Foundations Benchmark v7.0.0")).toEqual({ product: "365 Foundations Benchmark", version: "7.0.0" });
    expect(citedVersion("Microsoft cloud security benchmark v2: Privileged Access")?.version).toBe("2");
    expect(citedVersion("Zero Trust deployment with Microsoft 365")).toBeUndefined();
    const text = "Download CIS Microsoft 365 Foundations Benchmark v8.0.0. Archive: Microsoft 365 Foundations Benchmark v7.0.0. CIS Controls v8.1.";
    expect(versionsOnPage("CIS Microsoft 365 Foundations Benchmark v7.0.0", text)).toEqual(["7.0.0", "8.0.0"]);
    // CIS benchmark pages list "Name (version)", sometimes with "Foundation" for "Foundations", next to other benchmarks.
    const gcp = "Recent versions available for CIS Benchmark: Google Cloud Platform Foundation  (5.0.0) Google Container-Optimized OS  (1.2.0)";
    expect(versionsOnPage("CIS Google Cloud Platform Foundation Benchmark v5.0.0", gcp)).toEqual(["5.0.0"]);
    expect(versionsOnPage("CIS Google Cloud Platform Foundations Benchmark v5.0.0", gcp.replace("5.0.0", "6.0.0"))).toEqual(["6.0.0"]);
    expect(versionsOnPage("CIS Google Workspace Foundations Benchmark v1.4.0", "Google Workspace Foundations  (1.4.0)")).toEqual(["1.4.0"]);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2", "2.0")).toBe(0);
  });
});

describe("redirects", () => {
  it("ignores redirects that don't change the page", () => {
    expect(equivalentUrls("https://support.google.com/a/answer/1?hl=en", "https://support.google.com/a/answer/1")).toBe(true);
    expect(equivalentUrls("http://www.cyber.gov.au/x/", "https://cyber.gov.au/x")).toBe(true);
  });

  it("tells a move from a redirect elsewhere", () => {
    const old = "https://learn.microsoft.com/en-us/azure/active-directory/conditional-access/plan-conditional-access";
    const moved = "https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan-conditional-access";
    const titles = ["Plan a Conditional Access deployment"];
    expect(redirectKind(old, moved, { title: "Plan a Conditional Access deployment - Microsoft Entra ID", isLanding: false }, { titles })).toBe("moved");
    expect(redirectKind(old, "https://learn.microsoft.com/en-us/entra/", { title: "Microsoft Entra documentation", isLanding: true }, { titles })).toBe("redirected");
    expect(redirectKind(old, "https://example.com/plan", { title: "Plan a Conditional Access deployment", isLanding: false }, { titles })).toBe("redirected");
    expect(redirectKind(old, old + "/", { title: "x", isLanding: false }, { titles: [] })).toBe("none");
  });

  it("trusts Learn document ids over titles and never auto-moves to an archived page", () => {
    const old = "https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-support-authenticator-passkey";
    const next = "https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-enable-authenticator-passkey";
    expect(redirectKind(old, next, { title: "Enable passkeys in Microsoft Authenticator", isLanding: false, documentId: "a" }, { titles: ["Support passkeys"], documentId: "a" })).toBe("moved");
    expect(redirectKind(old, next, { title: "Support passkeys", isLanding: false, documentId: "b" }, { titles: ["Support passkeys"], documentId: "a" })).toBe("redirected");
    expect(redirectKind(old, "https://learn.microsoft.com/en-us/previous-versions/x", { title: "Support passkeys", isLanding: false, retired: "archived" }, { titles: ["Support passkeys"] })).toBe("redirected");
    expect(redirectKind("https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-registry", "https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-registry?view=o365-worldwide", { title: "Agent registry", isLanding: false, documentId: "z" }, { titles: [], documentId: "z" })).toBe("moved");
  });
});

describe("lifecycle wording", () => {
  it("counts only wording the change introduced", () => {
    const before = "Legacy MFA settings are still available.\nUse report-only mode first.";
    const after = "Legacy MFA settings will be retired on 30 September 2026.\nUse report-only mode first.";
    expect(newLifecycleWording(diffTexts(before, after))).toEqual(["will be retired"]);
    const reworded = "The legacy agent will be retired in 2027 as announced.";
    expect(newLifecycleWording(diffTexts("The legacy agent will be retired in 2027.", reworded))).toEqual([]);
  });

  it("needs lifecycle context, so device actions and navigation notes aren't retirement notices", () => {
    const words = (before: string, after: string) => newLifecycleWording(diffTexts(before, after));
    expect(words("Use Retire to remove company data.", "Use Retire to remove company data from devices marked for retirement.")).toEqual([]);
    expect(words("The setting is on the Users page.", "The setting has moved to the Users page.")).toEqual([]);
    expect(words("Use {tenant}.", "{tenant} is replaced by your tenant ID.")).toEqual([]);
    expect(words("Classic Search is available.", "Classic Search retired on November 30, 2023.")).toEqual(["retired on"]);
    expect(words("Read the guide.", "This article has moved. Update your bookmarks.")).toEqual(["this article has moved", "update your bookmarks"]);
    expect(words("Use the old API.", "The old API will be replaced by the v2 API.")).toEqual(["will be replaced by"]);
  });

  it("makes a change major when it adds lifecycle wording or drops a lifecycle term", () => {
    const base = state({ terms: ["will be retired"] });
    const added = classifyChange(state(), state({ contentHash: "b" }), diffTexts("Feature X is available.", "Feature X is deprecated."));
    expect(added.severity).toBe("major");
    expect(added.lifecycle).toEqual(["deprecated"]);
    const gone = classifyChange(base, state({ terms: [] }), diffTexts("It will be retired soon.", "It is available."));
    expect(gone.severity).toBe("major");
    expect(gone.reasons).toContain('no longer says "will be retired"');
  });
});
