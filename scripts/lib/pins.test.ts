// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keepDates, keepRetrievalDate } from "./dates";
import { checkedAgainst, headerTag, listTag, setCheckedAgainst, setSourceRelease, sourceReleaseTag } from "./pins";
import { readRepoFile } from "./repo";
import { ESSENTIALS_IT, ISM, pinnedRelease, PROWLER, SCUBAGOGGLES } from "./upstreams";
import { compareTags, compareVersions, isTag } from "./versions";

describe("version tags", () => {
  it("compares part by part, numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2", "2.0")).toBe(0);
    expect(compareTags("5.47.0", "5.44.0")).toBe(1);
    expect(compareTags("5.10.0", "5.9.0")).toBe(1);
    expect(compareTags("v1.1.0", "v1.0.1")).toBe(1);
    expect(compareTags("v2026.10.15", "v2026.09.4")).toBe(1);
    expect(compareTags("v2026.09.4", "v2026.09.4")).toBe(0);
    expect(compareTags("v2026.06.18", "v2026.09.4")).toBe(-1);
    expect(compareTags("1.2", "1.2.0")).toBe(0);
  });

  it("only follows plain release tags", () => {
    expect(isTag("5.47.0")).toBe(true);
    expect(isTag("v2026.09.4")).toBe(true);
    for (const t of ["5.47.0-rc1", "latest", "v1", "", "1.0.0; rm -rf /", 'v1.0"']) expect(isTag(t), t).toBe(false);
    expect(() => compareTags("main", "5.0.0")).toThrow(/not version tags/);
  });
});

describe("the committed pins", () => {
  it("agree for every upstream, wherever each is recorded", () => {
    for (const u of [ISM, ESSENTIALS_IT]) expect(headerTag(readRepoFile(u.idsFile)), u.idsFile).toBe(pinnedRelease(u, readRepoFile).tag);
    expect(sourceReleaseTag(readRepoFile(ISM.source!.file), ISM.source!.id)).toBe(pinnedRelease(ISM, readRepoFile).tag);
    for (const u of [PROWLER, SCUBAGOGGLES])
      for (const l of u.lists) expect(listTag(readRepoFile(l.file)), l.file).toBe(checkedAgainst(readRepoFile(`content/imports/${l.mapping}.yaml`)));
  });

  it("says which pin it could not find", () => {
    expect(() => checkedAgainst("id: x\n")).toThrow(/checkedAgainst/);
    expect(() => headerTag("# no tag here\n")).toThrow(/release tag in the file header/);
  });
});

describe("moving pins", () => {
  const prowler = [
    "# Prowler AWS check ids mapped to crownguard questions.",
    "# Check ids were checked against Prowler 5.44.0 (2026-09-29); `checkedAgainst` records that so an import from",
    "# another major version is flagged.",
    "id: prowler-aws",
    "checkedAgainst: 5.44.0",
    "mappings: []",
    "",
  ].join("\n");
  const changedLines = (a: string, b: string) => b.split("\n").filter((l, i) => l !== a.split("\n")[i]);

  it("moves checkedAgainst and the header line that names the release, with its date", () => {
    const out = setCheckedAgainst(prowler, "5.47.0", { date: "2026-10-29" });
    expect(out).toContain("checkedAgainst: 5.47.0\n");
    expect(out).toContain("checked against Prowler 5.47.0 (2026-10-29); `checkedAgainst`");
    expect(changedLines(prowler, out)).toHaveLength(2);
  });

  it("leaves notes written for the old release alone", () => {
    const scuba = [
      "# Control ids were checked against ScubaGoggles release v1.0.1 (the SCuBA Google Workspace",
      "# Coverage (of the SCuBA policies at v1.0.1): Gmail 26 of 36.",
      "checkedAgainst: v1.0.1",
      "",
    ].join("\n");
    const out = setCheckedAgainst(scuba, "v1.1.0", { date: "2026-10-22" });
    expect(out).toBe(scuba.replace("release v1.0.1 (the", "release v1.1.0 (the").replace("checkedAgainst: v1.0.1", "checkedAgainst: v1.1.0"));
    expect(() => setCheckedAgainst(scuba, "v1.1.0\nevil: true")).toThrow(/refusing/);
  });

  it("points the source at the new release page", () => {
    const sources = readRepoFile("content/sources/standards.yaml");
    const out = setSourceRelease(sources, "asd-ism-oscal", "v2027.01.2", "2027-01-20");
    expect(sourceReleaseTag(out, "asd-ism-oscal")).toBe("v2027.01.2");
    expect(out).toContain("title: ISM OSCAL catalog (release v2027.01.2)");
    const changed = changedLines(sources, out);
    expect(changed).toHaveLength(3);
    expect(changed[2]).toBe("  retrieved: 2027-01-20");
  });
});

describe("keeping retrieval dates", () => {
  const base = "# at release tag v1\n# Retrieved 2026-10-10.\nx: 1\n";
  const pr = "# at release tag v2\n# Retrieved 2026-11-01.\nx: 2\n";
  const tonight = "# at release tag v2\n# Retrieved 2026-11-04.\nx: 2\n";

  it("keeps a generated file's date when nothing else moved", () => {
    expect(keepRetrievalDate(tonight, pr)).toBe(pr);
    expect(keepRetrievalDate(tonight.replace("x: 2", "x: 3"), pr)).toBe(tonight.replace("x: 2", "x: 3"));
    expect(keepRetrievalDate(tonight, undefined)).toBe(tonight);
  });

  it("keeps the open PR's date line by line when only the date would move", () => {
    expect(keepDates(tonight, base, pr)).toBe(pr);
    expect(keepDates(tonight.replace("x: 2", "x: 3"), base, pr)).toBe("# at release tag v2\n# Retrieved 2026-11-01.\nx: 3\n");
    expect(keepDates(tonight, base, undefined)).toBe(tonight);
    expect(keepDates(tonight, base, "short\n")).toBe(tonight);
  });

  it("never rolls back a date the base branch moved itself", () => {
    const src = "- id: a\n  retrieved: 2026-11-02\n- id: b\n  url: x/v2\n";
    const prSrc = "- id: a\n  retrieved: 2026-10-01\n- id: b\n  url: x/v2\n";
    expect(keepDates(src, src, prSrc)).toBe(src);
  });
});
