import { describe, expect, it } from "vitest";
import type { Question } from "../content/schema";
import { idcfRows, jewelDsl, notVerifiedText, suggestDsl, systemCell } from "./idcf";
import type { E8Result } from "./maturity";
import type { CrownJewel } from "./types";

const q = (id: string, refs: string[], e8: { strategy: string; level: number }[] = []): Question =>
  ({ id, refs: refs.map((ref) => ({ framework: "idcf", ref })), e8 }) as unknown as Question;
const e8 = (title: string, level: E8Result["level"], ceiling: number, strategy = "mfa") =>
  ({ strategy, title, level, ceiling, blockers: [], unasked: null }) as unknown as E8Result & { title: string };

const questions = [
  q("A-1", ["DSL-2 Physical", "DSL-3 Physical"]),
  q("A-2", ["DSL-3 Authorised person"]),
  q("A-3", ["DSL-2 Authorised person", "Movement"]),
  q("A-4", ["DSL-4 Authorised person"]),
];

describe("idcfRows", () => {
  it("reads physical and authorised-person cells from mapped questions at or below each level", () => {
    const rows = idcfRows(questions, { "A-1": "yes", "A-2": "no", "A-3": "yes", "A-4": "yes" }, []);
    expect(rows.map((r) => r.person.status)).toEqual(["clear", "gaps", "gaps"]);
    expect(rows[1].person.gaps.map((x) => x.id)).toEqual(["A-2"]);
  });

  it("never shows a level clear when nothing maps to that level's own requirements", () => {
    const rows = idcfRows(questions, { "A-1": "yes", "A-2": "yes", "A-3": "yes", "A-4": "yes" }, []);
    expect(rows.map((r) => r.physical.status)).toEqual(["clear", "clear", "not-verified"]);
    expect(rows[2].physical.notVerified).toEqual(["DSL-4 device requirements not asked"]);
    const failing = idcfRows(questions, { "A-1": "no" }, []);
    expect(failing[2].physical).toMatchObject({ status: "gaps", notVerified: ["DSL-4 device requirements not asked"] });
  });

  it("lists every open Essential Eight question up to the required level, and the first level not asked", () => {
    const mfa1 = q("M-1", [], [{ strategy: "mfa", level: 1 }]);
    const mfa2 = q("M-2", [], [{ strategy: "mfa", level: 2 }]);
    const backup1 = q("B-1", [], [{ strategy: "regular-backups", level: 1 }]);
    const qs = [mfa1, mfa2, backup1];
    const results = [e8("Multi-factor authentication", 0, 2), e8("Regular backups", 1, 1, "regular-backups"), e8("Application control", null, 0, "application-control")];
    const rows = idcfRows([], { "M-1": "no", "M-2": "no", "B-1": "yes" }, results, qs);
    expect(rows[0].cyber.gaps.map((x) => x.id)).toEqual(["M-1"]);
    expect(rows[1].cyber.gaps.map((x) => x.id)).toEqual(["M-1", "M-2"]);
    expect(rows[1].cyber.notVerified).toEqual(["Regular backups (Maturity Level 2 not asked)", "Application control (not covered by this assessment)"]);
    expect(rows[2].cyber.notVerified).toContain("Multi-factor authentication (Maturity Level 3 not asked)");
    expect(idcfRows([], {}, [e8("Regular backups", 3, 3, "regular-backups")])[2].cyber.status).toBe("clear");
  });

  it("collects whole-system and data-movement questions on their own", () => {
    expect(systemCell(questions, { "A-3": "no" })).toMatchObject({ status: "gaps", gaps: [{ id: "A-3" }] });
    expect(systemCell([q("X", ["DSL-2 Physical"])], {}).status).toBe("not-assessed");
  });

  it("groups not-verified items by reason", () => {
    expect(notVerifiedText(["Application control (not covered by this assessment)", "Patch applications (not covered by this assessment)", "Regular backups (Maturity Level 1 not asked)", "DSL-4 device requirements not asked"])).toBe(
      "Application control and Patch applications (not covered by this assessment); Regular backups (Maturity Level 1 not asked); DSL-4 device requirements not asked",
    );
  });
});

const jewel = (over: Partial<CrownJewel>): CrownJewel =>
  ({ id: "j", name: "Payroll", classification: "confidential", confidentiality: 4, integrity: 4, availability: 3, regulations: [], exposures: [], ...over }) as CrownJewel;

describe("jewelDsl", () => {
  const answers = { "A-1": "yes", "A-2": "no", "A-3": "yes", "A-4": "yes", "M-1": "yes" } as const;
  const rows = idcfRows(questions, answers, [e8("Multi-factor authentication", 1, 1)], [q("M-1", [], [{ strategy: "mfa", level: 1 }])]);

  it("checks Rule 2 at the jewel's level, including whole-system and movement questions", () => {
    expect(jewelDsl(jewel({ dsl: "dsl-2" }), rows)?.gaps).toEqual([]);
    const d3 = jewelDsl(jewel({ dsl: "dsl-3" }), rows, systemCell(questions, { ...answers, "A-3": "no" }))!;
    expect(d3.gaps.map((x) => x.id)).toEqual(["A-2", "A-3"]);
    expect(d3.text).toContain("Not verified: Multi-factor authentication (Maturity Level 2 not asked)");
    expect(d3.text).not.toContain("jurisdiction");
  });

  it("says what wasn't assessed for the jewel, flags unmanaged devices, and adds jurisdiction at DSL-4", () => {
    const scoped = idcfRows([q("P-1", ["DSL-3 Authorised person"])], { "P-1": "yes" }, [e8("Multi-factor authentication", 3, 3)]);
    const d4 = jewelDsl(jewel({ dsl: "dsl-4", exposures: ["unmanaged-devices"] }), scoped, systemCell([], {}))!;
    expect(d4.text).toContain("Not assessed for this crown jewel: device protection and whole-system and data-movement controls.");
    expect(d4.text).toContain("reachable from unmanaged or personal devices");
    expect(d4.text).toContain("data residency and jurisdiction controls DSL-4 needs");
    expect(d4.text).toContain("found no gaps. Not verified: DSL-4 authorised-person requirements not asked.");
  });

  it("explains levels outside a configuration review, and skips unlabelled jewels", () => {
    expect(jewelDsl(jewel({ dsl: "dsl-5-plus" }), rows)?.text).toMatch(/agreed between the parties/);
    expect(jewelDsl(jewel({ dsl: "dsl-1" }), rows)?.text).toMatch(/No cloud configuration controls are required at DSL-1/);
    expect(jewelDsl(jewel({}), rows)).toBeUndefined();
  });
});

describe("suggestDsl", () => {
  it("combines impact, classification and obligations", () => {
    expect(suggestDsl(jewel({ classification: "internal", confidentiality: 2, integrity: 2, availability: 1 }))).toBe("dsl-2");
    expect(suggestDsl(jewel({}))).toBe("dsl-3");
    expect(suggestDsl(jewel({ confidentiality: 5 }))).toBe("dsl-4");
    expect(suggestDsl(jewel({ classification: "public", confidentiality: 1, integrity: 1, availability: 1, regulations: ["privacy-act"] }))).toBe("dsl-3");
    expect(suggestDsl(jewel({ regulations: ["soci"] }))).toBe("dsl-4");
  });
});
