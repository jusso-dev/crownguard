import { describe, expect, it } from "vitest";
import type { Answer } from "../format/vocab";
import { emptyAssessment } from "../format/empty";
import { applyScan } from "./apply";
import type { ScanResult } from "./types";

const scan = (source: string, suggestions: [string, Answer | undefined][]): ScanResult => ({
  tool: source,
  tenant: "Contoso",
  domain: "contoso.example",
  scannedAt: "2026-10-01T03:00:00Z",
  unmapped: 0,
  unmappedFailing: [],
  suggestions: suggestions.map(([question, suggested]) => ({ question, evidence: { source, tenant: "Contoso", scannedAt: "2026-10-01T03:00:00Z", suggested, checks: [] } })),
});
const opts = (overwrite: boolean) => ({ platform: "microsoft", overwrite, licence: false });

describe("applying a scan to an assessment", () => {
  it("keeps the evidence behind an answer it keeps", () => {
    const first = applyScan(emptyAssessment(), scan("first", [["MS-ID-001", "yes"], ["MS-ID-002", "yes"]]), opts(false)).assessment;
    const kept = applyScan(first, scan("second", [["MS-ID-001", "no"], ["MS-ID-003", undefined]]), opts(false));
    expect(kept.applied).toBe(0);
    expect(kept.assessment.answers["MS-ID-001"]).toBe("yes");
    expect(kept.assessment.evidence?.["MS-ID-001"]?.source).toBe("first");
    // Unanswered: the evidence lands so the assessor can see what the scan found, even with nothing to suggest.
    expect(kept.assessment.evidence?.["MS-ID-003"]?.source).toBe("second");

    // Replacing answers only replaces evidence where the scan gave an answer to replace with.
    const replaced = applyScan(first, scan("third", [["MS-ID-001", "no"], ["MS-ID-002", undefined]]), opts(true)).assessment;
    expect(replaced.answers).toMatchObject({ "MS-ID-001": "no", "MS-ID-002": "yes" });
    expect(replaced.evidence?.["MS-ID-001"]?.source).toBe("third");
    expect(replaced.evidence?.["MS-ID-002"]?.source).toBe("first");
  });

  it("records the import with the time it is given", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const a = applyScan(emptyAssessment(), scan("first", [["MS-ID-001", "yes"]]), { ...opts(false), now }).assessment;
    expect(a.imports).toEqual([{ source: "first", tenant: "Contoso", scannedAt: "2026-10-01T03:00:00Z", importedAt: now.toISOString(), applied: 1 }]);
    expect(a.updatedAt).toBe(now.toISOString());
  });
});
