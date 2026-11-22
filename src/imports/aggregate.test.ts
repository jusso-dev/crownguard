import { describe, expect, it } from "vitest";
import type { ImportMapping } from "../content/schema";
import type { ScanStatus } from "../format/vocab";
import { emptyAssessment } from "../format/empty";
import { parseAssessment } from "../format/parse";
import { toSaveFile } from "../format/saveFile";
import { evidenceLimits } from "../format/schema";
import { buildScanResult, type CheckRow } from "./aggregate";
import { applyScan } from "./apply";

const mapping = (over: Partial<ImportMapping["mappings"][number]> = {}, checks = ["A", "B", "C"]): ImportMapping => ({
  id: "test",
  name: "Test Scanner",
  platform: "microsoft",
  url: "https://example.com",
  mappings: [{ question: "Q-1", checks, rationale: "test only", ...over }],
});
const row = (id: string, status: ScanStatus, over: Partial<CheckRow> = {}): CheckRow => ({ id, status, setting: id, current: "", expected: "", ...over });
const facts = { tenant: "Contoso", domain: "contoso.example", scannedAt: "2026-10-01T03:00:00Z" };
const suggest = (statuses: ScanStatus[], over: Partial<ImportMapping["mappings"][number]> = {}) =>
  buildScanResult(mapping(over), statuses.map((s, i) => row("ABC"[i], s)), facts).suggestions[0]?.evidence.suggested;

describe("turning check statuses into a suggested answer", () => {
  it("says Yes when every check passes, No when every check fails, and Partial for a mix or a warning", () => {
    expect(suggest(["pass", "pass"])).toBe("yes");
    expect(suggest(["fail", "fail"])).toBe("no");
    expect(suggest(["pass", "fail"])).toBe("partial");
    expect(suggest(["warning"])).toBe("partial");
    expect(suggest(["review", "unknown", "notlicensed"])).toBeUndefined();
  });

  it("never says Yes while a mapped check still needs review", () => {
    expect(suggest(["pass", "review"])).toBe("partial");
    expect(suggest(["pass", "notlicensed"])).toBe("partial");
    expect(suggest(["pass", "pass", "info"])).toBe("partial");
    expect(suggest(["fail", "review"])).toBe("no");
    expect(suggest(["pass", "fail", "review"])).toBe("partial");
  });

  it("caps a partial-coverage mapping at Partial and sends a known false fail to review", () => {
    expect(suggest(["pass"], { cap: "partial" })).toBe("partial");
    expect(suggest(["fail"], { cap: "partial" })).toBe("no");
    expect(suggest(["fail"], { failIsInconclusive: true })).toBeUndefined();
    expect(suggest(["pass"], { failIsInconclusive: true })).toBe("yes");
    expect(suggest(["pass", "fail"], { failIsInconclusive: true })).toBe("partial");
  });

  it("suggests nothing for a question none of whose checks is in the scan", () => {
    expect(buildScanResult(mapping(), [row("OTHER", "pass")], facts).suggestions).toEqual([]);
  });
});

describe("what the result records", () => {
  it("names the scanner as the source of every piece of evidence", () => {
    const ev = buildScanResult(mapping(), [row("A", "pass")], { ...facts, toolVersion: "1.2.3", account: "123" }).suggestions[0].evidence;
    expect(ev).toMatchObject({ source: "Test Scanner", tool: "Test Scanner", toolVersion: "1.2.3", account: "123", tenant: "Contoso" });
  });

  it("counts unmapped checks and lists the failing and warning ones, sorted", () => {
    const r = buildScanResult(mapping(), [row("A", "pass"), row("Z", "fail"), row("Y", "warning"), row("X", "review"), row("Z", "fail")], facts);
    expect(r.unmapped).toBe(3);
    expect(r.unmappedFailing).toEqual(["Y", "Z"]);
  });

  it("keeps account names out of the evidence and the tenant", () => {
    const r = buildScanResult(
      mapping(),
      [row("A", "fail", { current: "Excluded: bg1@contoso.example, Guest alice_fabrikam.com#EXT#@contoso.onmicrosoft.com", examples: ["bob@contoso.example", "/vm/a"] })],
      { ...facts, tenant: "admin@contoso.example", account: "carol@contoso.example" },
    );
    const ev = r.suggestions[0].evidence;
    expect(ev.checks[0].current).toBe("Excluded: [account], Guest [account]");
    expect(ev.checks[0].examples).toEqual(["[account]", "/vm/a"]);
    expect(r.tenant).toBe("[account]");
    expect(JSON.stringify(r)).not.toMatch(/bg1|alice|fabrikam|bob|carol|admin@/);
  });

  it("removes an address before cutting long text, so half an address never survives", () => {
    const ev = buildScanResult(mapping(), [row("A", "fail", { current: `${"x".repeat(1990)} alice.smith@contoso.example` })], facts).suggestions[0].evidence;
    expect(ev.checks[0].current).toHaveLength(2000);
    expect(JSON.stringify(ev)).not.toMatch(/alice/);
  });

  it("leaves version pins that only look like addresses alone", () => {
    const ev = buildScanResult(mapping(), [row("A", "pass", { current: "lodash@4.17.21, owner admin@contoso.example; josé@contoso.example, alice!ops@contoso.example; jürgen@exämple.com" })], facts)
      .suggestions[0].evidence;
    expect(ev.checks[0].current).toBe("lodash@4.17.21, owner [account]; [account], [account]; [account]");
  });
});

describe("version mismatches against the mapping", () => {
  it("warns when the scan came from a different major version than the mapping was checked against", () => {
    const m = { ...mapping(), checkedAgainst: "5.47.0" };
    expect(buildScanResult(m, [row("A", "pass")], { ...facts, toolVersion: "6.0.0" }).warnings?.join(" ")).toMatch(/came from Test Scanner 6\.0\.0.*checked against 5\.47\.0/);
    expect(buildScanResult(m, [row("A", "pass")], { ...facts, toolVersion: "5.1.0" }).warnings).toBeUndefined();
  });

  it("matches versioned ids on their base and names any that differ", () => {
    const base = (id: string) => id.replace(/v\d+$/, "");
    const r = buildScanResult({ ...mapping({}, ["A.1v1"]), checkedAgainst: "v1" }, [row("A.1v2", "pass")], facts, base);
    expect(r.suggestions[0].evidence.checks[0].id).toBe("A.1v2");
    expect(r.warnings?.join(" ")).toContain("A.1v2 here against A.1v1 in crownguard");
  });
});

describe("check ids and counts longer than the saved file allows", () => {
  const L = evidenceLimits;
  const long = (n: number, prefix = "") => `${prefix}${"x".repeat(n - prefix.length)}`;
  const opens = (r: ReturnType<typeof buildScanResult>) => {
    const a = applyScan(emptyAssessment(), r, { platform: "microsoft", overwrite: false, licence: false }).assessment;
    const opened = parseAssessment(JSON.parse(toSaveFile(a)));
    expect(opened.kind).toBe("ok");
    return opened.kind === "ok" ? opened.assessment.evidence?.["Q-1"] : undefined;
  };
  const shortening = (r: ReturnType<typeof buildScanResult>) => r.warnings?.filter((w) => w.includes("shortened")) ?? [];

  it("keeps an id at the limit exactly as it is, with no warning", () => {
    const id = long(L.checkId);
    const r = buildScanResult(mapping({}, [id]), [row(id, "pass")], facts);
    expect(r.suggestions[0].evidence.checks[0].id).toBe(id);
    expect(shortening(r)).toEqual([]);
    expect(opens(r)?.checks[0].id).toBe(id);
  });

  it("shortens an id one over the limit and says so", () => {
    const id = long(L.checkId + 1);
    const r = buildScanResult(mapping({}, [id]), [row(id, "fail")], facts);
    const saved = r.suggestions[0].evidence.checks[0].id;
    expect(saved).toHaveLength(L.checkId);
    expect(saved.endsWith("…")).toBe(true);
    expect(id.startsWith(saved.slice(0, -1))).toBe(true);
    expect(shortening(r)).toHaveLength(1);
    expect(shortening(r)[0]).toContain(`1 check id was longer than ${L.checkId} characters`);
    expect(opens(r)?.checks[0].id).toBe(saved);
  });

  it("keeps two long ids that share their start as two rows, and answers from both", () => {
    const shared = long(220, "shared_");
    const a = `${shared}${"a".repeat(30)}`;
    const b = `${shared}${"b".repeat(30)}`;
    const r = buildScanResult(mapping({}, [a, b]), [row(a, "pass"), row(b, "fail")], facts);
    const ev = r.suggestions[0].evidence;
    expect(ev.checks.map((c) => c.status)).toEqual(["pass", "fail"]);
    expect(ev.checks[0].id).toBe(ev.checks[1].id);
    expect(ev.suggested).toBe("partial");
    expect(shortening(r)).toHaveLength(1);
    expect(shortening(r)[0]).toContain("2 check ids were longer");
    expect(opens(r)?.checks).toHaveLength(2);
  });

  it("names at most three shortened ids in the warning, each kept short", () => {
    const ids = [1, 2, 3, 4, 5].map((i) => long(300, `id${i}_`));
    const r = buildScanResult(mapping({}, ids), ids.map((id) => row(id, "pass")), facts);
    const [w] = shortening(r);
    expect(w).toContain("5 check ids were longer");
    expect(w).toContain("id3_");
    expect(w).not.toContain("id4_");
    expect(w.length).toBeLessThan(400);
  });

  it("keeps a count at the limit and shortens a longer one", () => {
    const at = buildScanResult(mapping(), [row("A", "fail", { count: long(L.count) })], facts);
    expect(at.suggestions[0].evidence.checks[0].count).toBe(long(L.count));
    opens(at);
    const over = buildScanResult(mapping(), [row("A", "fail", { count: long(L.count + 1) })], facts);
    expect(over.suggestions[0].evidence.checks[0].count).toHaveLength(L.count);
    expect(opens(over)?.checks[0].count).toHaveLength(L.count);
  });

  it("lands a versioned id with an over-long version suffix, shortened", () => {
    const base = (id: string) => id.replace(/v[\d.]+$/, "");
    const id = `A.1v${"1.".repeat(150)}1`;
    const r = buildScanResult({ ...mapping({}, ["A.1v1"]), checkedAgainst: "v1" }, [row(id, "pass")], facts, base);
    expect(r.suggestions[0].evidence.checks[0].id).toHaveLength(L.checkId);
    expect(shortening(r)).toHaveLength(1);
    expect(opens(r)?.checks[0].id).toHaveLength(L.checkId);
  });
});
