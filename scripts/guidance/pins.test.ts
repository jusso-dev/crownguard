// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkedAgainst,
  compareTags,
  feedPin,
  headerTag,
  isTag,
  keepDates,
  listTag,
  setCheckedAgainst,
  setFeedPin,
  setSourceRelease,
  sourceReleaseTag,
} from "./pins";

const repo = (path: string) => readFileSync(join(import.meta.dirname, "..", "..", path), "utf8");

describe("version tags", () => {
  it("compares part by part, numerically", () => {
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

describe("reading the committed pins", () => {
  it("finds each pin where it lives", () => {
    expect(headerTag(repo("content/frameworks/ism.yaml"))).toMatch(/^v\d{4}\.\d{2}\.\d+$/);
    expect(headerTag(repo("scripts/ism/fixtures/ism-controls.txt"))).toBe(headerTag(repo("content/frameworks/ism.yaml")));
    const prowler = checkedAgainst(repo("content/imports/prowler-aws.yaml"));
    expect(listTag(repo("e2e/fixtures/prowler-checks-aws.txt"))).toBe(prowler);
    expect(listTag(repo("e2e/fixtures/prowler-checks-azure.txt"))).toBe(checkedAgainst(repo("content/imports/prowler-azure.yaml")));
    expect(listTag(repo("e2e/fixtures/scubagoggles-controls.txt"))).toBe(checkedAgainst(repo("content/imports/scubagoggles.yaml")));
    const feeds = repo("scripts/watch/feeds.ts");
    expect(feedPin(feeds, "prowler-releases")).toBe(prowler);
    expect(feedPin(feeds, "scubagoggles-releases")).toBe(checkedAgainst(repo("content/imports/scubagoggles.yaml")));
    expect(feedPin(feeds, "ism-oscal-releases")).toBe(headerTag(repo("content/frameworks/ism.yaml")));
    expect(sourceReleaseTag(repo("content/sources/standards.yaml"), "asd-ism-oscal")).toBe(headerTag(repo("content/frameworks/ism.yaml")));
  });

  it("says which pin it could not find", () => {
    expect(() => checkedAgainst("id: x\n")).toThrow(/checkedAgainst/);
    expect(() => feedPin(repo("scripts/watch/feeds.ts"), "asd-news")).toThrow(/reviewMapping.pinned for feed asd-news/);
    expect(() => feedPin("", "nope")).toThrow(/no feed nope/);
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

  it("moves checkedAgainst and the header line that names the release, with its date", () => {
    const out = setCheckedAgainst(prowler, "5.47.0", { date: "2026-10-29" });
    expect(out).toContain("checkedAgainst: 5.47.0\n");
    expect(out).toContain("checked against Prowler 5.47.0 (2026-10-29); `checkedAgainst`");
    expect(out.split("\n").filter((l, i) => l !== prowler.split("\n")[i])).toHaveLength(2);
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

  it("moves one feed's pin and nothing else in feeds.ts", () => {
    const feeds = repo("scripts/watch/feeds.ts");
    const out = setFeedPin(feeds, "scubagoggles-releases", "v9.9.9");
    expect(feedPin(out, "scubagoggles-releases")).toBe("v9.9.9");
    expect(feedPin(out, "prowler-releases")).toBe(feedPin(feeds, "prowler-releases"));
    const changed = out.split("\n").filter((l, i) => l !== feeds.split("\n")[i]);
    expect(changed).toEqual(['    reviewMapping: { file: "content/imports/scubagoggles.yaml", pinned: "v9.9.9" },']);
    expect(() => setFeedPin(feeds, "prowler-releases", '1.0.0", evil: "')).toThrow(/refusing/);
  });

  it("points the source at the new release page", () => {
    const sources = repo("content/sources/standards.yaml");
    const from = sourceReleaseTag(sources, "asd-ism-oscal");
    const out = setSourceRelease(sources, "asd-ism-oscal", from, "v2027.01.2", "2027-01-20");
    expect(sourceReleaseTag(out, "asd-ism-oscal")).toBe("v2027.01.2");
    expect(out).toContain("title: ISM OSCAL catalog (release v2027.01.2)");
    const changed = out.split("\n").filter((l, i) => l !== sources.split("\n")[i]);
    expect(changed).toHaveLength(3);
    expect(changed[2]).toBe("  retrieved: 2027-01-20");
  });
});

describe("keeping retrieval dates", () => {
  const base = "# at release tag v1\n# Retrieved 2026-10-10.\nx: 1\n";
  const pr = "# at release tag v2\n# Retrieved 2026-11-01.\nx: 2\n";
  const tonight = "# at release tag v2\n# Retrieved 2026-11-04.\nx: 2\n";

  it("keeps the open PR's date when only the date would move", () => {
    expect(keepDates(tonight, base, pr)).toBe(pr);
  });

  it("takes tonight's text when anything else moved, or there is no PR", () => {
    const moved = tonight.replace("x: 2", "x: 3");
    expect(keepDates(moved, base, pr)).toBe("# at release tag v2\n# Retrieved 2026-11-01.\nx: 3\n");
    expect(keepDates(tonight, base, undefined)).toBe(tonight);
    expect(keepDates(tonight, base, "short\n")).toBe(tonight);
  });

  it("never rolls back a date the base branch moved itself", () => {
    const src = "- id: a\n  retrieved: 2026-11-02\n- id: b\n  url: x/v2\n";
    const prSrc = "- id: a\n  retrieved: 2026-10-01\n- id: b\n  url: x/v2\n";
    expect(keepDates(src, src, prSrc)).toBe(src);
  });
});
